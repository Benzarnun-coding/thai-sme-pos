import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coverDays, forecast, refill, sizeShares } from '../web/src/forecast.ts';

const days = (qty: number[]) => qty.map((q, i) => ({ age: i + 1, qty: q })); // [yesterday, 2 days ago, …]

test('flat sales: the forecast is the average and days of cover = stock ÷ rate', () => {
  const f = forecast(days(Array(14).fill(10)));
  assert.equal(f.method, 'trend');
  assert.ok(Math.abs(f.at(1) - 10) < 1e-9 && Math.abs(f.at(30) - 10) < 1e-9);
  assert.ok(Math.abs(coverDays(50, f, 1)! - 5) < 1e-9);
  assert.equal(coverDays(0, f, 1), 0);
  assert.equal(refill(50, f, 1, 14), 90);
});

test('rising sales: the forecast follows the trend, so stock runs out sooner than the average says', () => {
  const f = forecast(days([20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7]));
  assert.ok(f.at(1) > 20 && f.at(5) > f.at(1), `rising: ${f.at(1)} → ${f.at(5)}`);
  assert.ok(f.at(60) <= 3 * f.mean + 1e-9, 'capped at 3× the average');
  assert.ok(coverDays(100, f, 1)! < 100 / f.mean);
  assert.equal(f.last7, 17);
  assert.equal(f.prev7, 10);
});

test('falling sales never forecast below a quarter of the average', () => {
  const f = forecast(days([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]));
  assert.ok(f.at(30) >= 0.25 * f.mean - 1e-9);
  assert.ok(f.at(1) < f.mean);
});

test('few days → the average; no days → nothing; today is left out', () => {
  const f = forecast([{ age: 0, qty: 100 }, ...days([4, 6, 5])]);
  assert.equal(f.method, 'average');
  assert.equal(f.days, 3);
  assert.equal(f.at(10), 5);
  assert.equal(forecast([]).method, 'none');
  assert.equal(coverDays(10, forecast([]), 1), null);
});

test('size shares add up to 1 and an unsold size still gets a little', () => {
  const s = sizeShares(new Map([['30', 9], ['32', 1]]), ['30', '32', '36']);
  assert.ok(Math.abs([...s.values()].reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok((s.get('36') ?? 0) > 0 && (s.get('36') ?? 0) < (s.get('32') ?? 0));
});
