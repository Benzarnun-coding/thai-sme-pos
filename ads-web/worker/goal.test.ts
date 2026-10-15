import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_GOAL, goalStatus, monthDates, nextCap, type DayNet } from './goal.ts';

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
