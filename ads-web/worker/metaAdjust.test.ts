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

import { cutSpendFromMetrics, cutSpendFromRows } from './metaAdjust.ts';

test('spend cuts come off a campaign\'s window metrics only for the days in the window, and the cost-per figures follow', () => {
  const m = new Map([['c1', { spend: 60000, purchases: 20, purchase_value: 30000, clicks: 300, cpc: 200, cpa: 3000, roas: 0.5, messages: 10, cost_per_message: 6000 }]]);
  const cuts = [{ date: '2026-11-01', campaign_id: 'c1', spend: 51157 }, { date: '2026-10-20', campaign_id: 'c1', spend: 1000 }];
  const out = cutSpendFromMetrics(m, cuts, ['2026-10-31', '2026-11-01', '2026-11-02']).get('c1')!;
  assert.equal(out.spend, 8843);
  assert.equal(out.roas, 30000 / 8843);
  assert.equal(out.cpa, 8843 / 20);
  assert.equal(cutSpendFromMetrics(m, cuts, ['2026-10-01']).get('c1')!.spend, 60000);
});

test('spend cuts come off the daily rows of that campaign and day, never below zero', () => {
  const cuts = [{ date: '2026-11-01', campaign_id: 'c1', spend: 51157 }];
  const all = cutSpendFromRows([
    { date: '2026-11-01', campaign_id: 'c1', spend: 51157.4 }, { date: '2026-11-01', campaign_id: 'c2', spend: 300 }, { date: '2026-11-02', campaign_id: 'c1', spend: 275 },
  ], cuts);
  assert.deepEqual(all.map((r) => Math.round(r.spend * 10) / 10), [0.4, 300, 275]);
  const one = cutSpendFromRows([{ date: '2026-11-01', spend: 100 }], cuts, 'c1');
  assert.equal(one[0].spend, 0);
});
