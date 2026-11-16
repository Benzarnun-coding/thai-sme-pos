import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_GOAL, goalStatus, monthDates, nextCap, ytdStatus, type DayNet } from './goal.ts';

const day = (date: string, revenue: number, ads: number): DayNet => {
  const cost = revenue * 0.516, fees = revenue * 0.125;
  return { date, revenue, cost, fees, ads, net: revenue - cost - fees - ads, orders: 80, units: 150, multi: 50 };
};

test('month dates run from the 1st to the last counted day', () => {
  const m = monthDates('2026-10-13');
  assert.equal(m.month, '2026-10');
  assert.equal(m.daysInMonth, 31);
  assert.equal(m.dates.length, 13);
  assert.equal(m.dates[0], '2026-10-01');
});

test('goal status: progress, projection, what is needed per day and the revenue the goal needs', () => {
  const days = Array.from({ length: 10 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, '0')}`, 34_000, 9_350));
  const elapsed = [...days.map((d) => d.date), '2026-10-11'];
  const g = goalStatus('2026-10', 31, elapsed, days, days.slice(-7), DEFAULT_GOAL);
  assert.deepEqual(g.missing, ['2026-10-11']);
  const perDay = 34_000 * (1 - 0.516 - 0.125) - 9_350;
  assert.ok(Math.abs(g.net - perDay * 10) < 1);
  assert.ok(Math.abs((g.projected ?? 0) - perDay * 31) < 1);
  assert.ok(Math.abs(g.needed_per_day - (120_000 - perDay * 10) / 21) < 1);
  assert.equal(g.mer_7d?.toFixed(2), (34_000 / 9_350).toFixed(2));
  // gross 35.9% − 1/3.86 → about 40,000 a day
  assert.ok(g.target_revenue_per_day! > 38_000 && g.target_revenue_per_day! < 42_000);
});

test('7-day MER needs at least 6 uploaded days', () => {
  const days = Array.from({ length: 5 }, (_, i) => day(`2026-10-0${i + 1}`, 30_000, 8_000));
  assert.equal(goalStatus('2026-10', 31, days.map((d) => d.date), days, days, DEFAULT_GOAL).mer_7d, null);
});

test('the cap grows by the step, rounded to 100', () => {
  assert.equal(nextCap(10_800, 20), 13_000);
  assert.equal(nextCap(13_000, 20), 15_600);
});

test('sales goal is the main goal: 100M a year, its % is against sales, separate from the profit goal', () => {
  assert.equal(DEFAULT_GOAL.yearly_sales, 100_000_000);
  assert.equal(DEFAULT_GOAL.monthly_net, 120_000); // profit goal kept (production uses settings.goal, 100,000)
  const days = Array.from({ length: 10 }, (_, i) => day(`2026-11-${String(i + 1).padStart(2, '0')}`, 300_000, 60_000));
  const g = goalStatus('2026-11', 30, days.map((d) => d.date), days, days.slice(-7), DEFAULT_GOAL);
  const monthly = 100_000_000 / 12;
  assert.ok(Math.abs(g.sales.monthly_target - monthly) < 1e-6);
  assert.equal(g.sales.revenue, 3_000_000);
  assert.ok(Math.abs(g.sales.pct - (3_000_000 / monthly) * 100) < 1e-9); // 36%
  assert.ok(Math.abs(g.sales.pace - monthly / 3) < 1e-6);
  assert.equal(g.sales.projected, 9_000_000);
  assert.ok(Math.abs(g.sales.needed_per_day - (monthly - 3_000_000) / 20) < 1e-6);
  // the profit % stays its own number
  const profitPct = (g.net / g.goal.monthly_net) * 100;
  assert.notEqual(Math.round(profitPct), Math.round(g.sales.pct));
});

test('sales goal: no uploaded days → no projection, a stored goal without yearly_sales falls back to 100M', () => {
  const { yearly_sales: _, ...old } = DEFAULT_GOAL;
  const g = goalStatus('2026-11', 30, ['2026-11-01'], [], [], old as typeof DEFAULT_GOAL);
  assert.equal(g.sales.yearly_target, 100_000_000);
  assert.equal(g.sales.projected, null);
  assert.equal(g.sales.pct, 0);
});

test('YTD: revenue from 1 Jan against the yearly target, pace by share of time, missing days count as 0', () => {
  // 2026-11-14 is day 318 of 365; 40 uploaded days at 300,000
  const days = Array.from({ length: 40 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 6 + i)).toISOString().slice(0, 10), revenue: 300_000 }));
  const y = ytdStatus(100_000_000, '2026-11-14', [...days, { date: '2025-12-31', revenue: 9e9 }, { date: '2026-11-15', revenue: 9e9 }]);
  assert.equal(y.year, '2026');
  assert.equal(y.from, '2026-01-01');
  assert.equal(y.days_elapsed, 318);
  assert.equal(y.days_in_year, 365);
  assert.equal(y.uploaded_days, 40); // last year and today are left out
  assert.equal(y.revenue, 12_000_000);
  assert.ok(Math.abs(y.pct - 12) < 1e-9);
  assert.ok(Math.abs(y.pace - (100_000_000 * 318) / 365) < 1e-6);
  assert.ok(Math.abs(y.gap - (12_000_000 - (100_000_000 * 318) / 365)) < 1e-6);
  assert.ok(Math.abs(y.pace_uploaded - (100_000_000 * 40) / 365) < 1e-6);
  assert.equal(y.projected, 12_000_000 + 300_000 * 325);
  assert.ok(Math.abs(y.needed_per_day - 88_000_000 / 47) < 1e-6);
});

test('YTD: 1 Jan, leap year, nothing uploaded, target already passed', () => {
  const jan1 = ytdStatus(100_000_000, '2028-01-01', []);
  assert.equal(jan1.days_elapsed, 1);
  assert.equal(jan1.days_in_year, 366);
  assert.equal(jan1.revenue, 0);
  assert.equal(jan1.projected, null);
  assert.ok(Math.abs(jan1.pace - 100_000_000 / 366) < 1e-6);
  const done = ytdStatus(1_000_000, '2026-06-30', [{ date: '2026-06-01', revenue: 1_500_000 }]);
  assert.equal(done.needed_per_day, 0);
  assert.ok(done.pct > 100 && done.gap > 0);
});

test('goal status carries YTD next to the month goals and leaves the profit goal alone', () => {
  const days = Array.from({ length: 3 }, (_, i) => day(`2026-11-0${i + 1}`, 300_000, 60_000));
  const ytd = ytdStatus(DEFAULT_GOAL.yearly_sales, '2026-11-03', days);
  const g = goalStatus('2026-11', 30, days.map((d) => d.date), days, days, DEFAULT_GOAL, ytd);
  assert.equal(g.ytd?.revenue, 900_000);
  assert.equal(g.goal.monthly_net, DEFAULT_GOAL.monthly_net);
  assert.equal(goalStatus('2026-11', 30, [], [], [], DEFAULT_GOAL).ytd, null);
});
