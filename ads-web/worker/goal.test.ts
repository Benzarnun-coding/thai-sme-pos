import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_GOAL, goalLastDay, goalStatus, monthDates, nextCap, type DayNet } from './goal.ts';

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
  assert.ok(Math.abs(g.needed_per_day - (200_000 - perDay * 10) / 21) < 1);
  assert.equal(g.mer_7d?.toFixed(2), (34_000 / 9_350).toFixed(2));
  // gross 35.9% − 1/3.86 → 200,000 a month needs about 67,000 a day
  assert.ok(g.target_revenue_per_day! > 63_000 && g.target_revenue_per_day! < 71_000);
});

test('7-day MER needs at least 6 uploaded days', () => {
  const days = Array.from({ length: 5 }, (_, i) => day(`2026-10-0${i + 1}`, 30_000, 8_000));
  assert.equal(goalStatus('2026-10', 31, days.map((d) => d.date), days, days, DEFAULT_GOAL).mer_7d, null);
});

test('the cap grows by the step, rounded to 100', () => {
  assert.equal(nextCap(10_800, 20), 13_000);
  assert.equal(nextCap(13_000, 20), 15_600);
});

test('the scoreboard of a past month runs to its last day; this, future and bad months to yesterday', () => {
  assert.equal(goalLastDay('2026-10', '2026-11-01'), '2026-10-31');
  assert.equal(goalLastDay('2026-02', '2026-11-01'), '2026-02-28');
  assert.equal(goalLastDay('2026-11', '2026-11-01'), '2026-11-01');
  assert.equal(goalLastDay('2026-12', '2026-11-01'), '2026-11-01');
  assert.equal(goalLastDay(null, '2026-11-01'), '2026-11-01');
  assert.equal(goalLastDay('2026-13', '2026-11-01'), '2026-11-01');
});

test('weeks: 7-day blocks with the goal share, real numbers and the plan per day', () => {
  const days = Array.from({ length: 10 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, '0')}`, 34_000, 9_350));
  const elapsed = [...days.map((d) => d.date), '2026-10-11'];
  const g = goalStatus('2026-10', 31, elapsed, days, days.slice(-7), DEFAULT_GOAL);
  assert.equal(g.weeks.length, 5);
  assert.deepEqual(g.weeks.map((w) => w.days), [7, 7, 7, 7, 3]);
  assert.equal(g.weeks[0].from, '2026-10-01');
  assert.equal(g.weeks[4].to, '2026-10-31');
  assert.ok(Math.abs(g.weeks.reduce((t, w) => t + w.target_net, 0) - 200_000) < 1);
  assert.deepEqual(g.weeks.map((w) => w.state), ['done', 'current', 'future', 'future', 'future']);
  assert.equal(g.weeks[0].counted, 7);
  assert.equal(g.weeks[1].counted, 3);
  assert.equal(g.weeks[2].net, null);
  assert.equal(g.weeks[0].revenue_per_day, 34_000);
  assert.equal(g.weeks[0].mer?.toFixed(2), (34_000 / 9_350).toFixed(2));
  assert.ok(Math.abs(g.weeks[2].target_ads_per_day! - g.target_revenue_per_day! / 3.86) < 1);
});
