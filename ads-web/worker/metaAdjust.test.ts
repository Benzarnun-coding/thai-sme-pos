import assert from 'node:assert/strict';
import { test } from 'node:test';
import { subtractAdjustments } from './metaAdjust.ts';

test('known-wrong purchases come off the same day, campaign and hour, never below zero', () => {
  const rows = [
    { date: '2026-10-14', campaign_id: 'c1', hour: '20:00', purchases: 5, value: 1500 },
    { date: '2026-10-14', campaign_id: 'c1', hour: '21:00', purchases: 2, value: 500 },
    { date: '2026-10-14', campaign_id: 'c2', hour: '20:00', purchases: 1, value: 239 },
  ];
  const out = subtractAdjustments(rows, [
    { date: '2026-10-14', campaign_id: 'c1', hour: '20:00', purchases: 3, value: 717, reason: 'x' },
    { date: '2026-10-14', campaign_id: 'c2', hour: '20:00', purchases: 2, value: 478, reason: 'x' },
    { date: '2026-10-13', campaign_id: 'c1', hour: '21:00', purchases: 2, value: 500, reason: 'x' },
  ], 'value');
  assert.deepEqual(out.map((r) => [r.purchases, r.value]), [[2, 783], [2, 500], [0, 0]]);
});
