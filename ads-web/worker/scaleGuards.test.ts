import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provenWinners, spaceIncreases, zeroMetrics } from './run.ts';
import { applyDecisions } from '../../ads-engine/src/apply.ts';
import type { Decision, Entity } from '../../ads-engine/src/types.ts';

const now = new Date('2026-10-22T13:00:00Z');
const up = (id: string, rule = 'win-boost', pct = 20): Decision => ({
  rule_id: rule, entity: { level: 'campaign', id, name: id, campaign_name: id }, window: 'last_3d', metric: 'roas', observed: 5, threshold: 4, action: { type: 'budget_pct', pct }, plan: '',
});

test('one increase per 48 h whichever rule raised it; cuts and copies ramping are not held', () => {
  const ds = [up('a', 'win-up'), up('b'), up('c', 'win-cut', -20), up('d', 'dup-ramp'), up('e')];
  const state = { last_action: { 'win-boost:a': '2026-10-22T01:00:00Z', 'up:b': '2026-10-19T01:00:00Z', 'win-boost:c': '2026-10-22T01:00:00Z', 'up:d': '2026-10-22T01:00:00Z' } };
  spaceIncreases(ds, state, now, 48);
  assert.deepEqual(ds.map((d) => !!d.skipped_reason), [true, false, false, false, false]);
});

test('proven winners get the higher ceiling, others keep the normal one', async () => {
  const camp = (id: string, budget: number, roas: number, purchases: number): Entity => ({
    level: 'campaign', id, name: id, campaign_id: id, campaign_name: id, status: 'ACTIVE', daily_budget: budget,
    metrics: { last_7d: { ...zeroMetrics(), roas, purchases } },
  });
  const es = [camp('w', 3200, 4.5, 30), camp('x', 3200, 4.0, 30), camp('y', 3200, 4.5, 30)];
  const cs = new Map([['w', { stage_id: 'winning' }], ['x', { stage_id: 'winning' }], ['y', { stage_id: 'testing' }]]);
  const winners = provenWinners(es, cs, 2.9, 5000);
  assert.deepEqual([...winners.keys()], ['w']);
  const ds = [up('w'), up('x')];
  const g = { max_change_pct_per_run: 20, min_daily_budget: 50, max_daily_budget: 3200, max_total_daily_budget: 20000 };
  const noop = { setStatus: async () => {}, setDailyBudget: async () => {} };
  await applyDecisions(ds, es, noop, g, { last_action: {} }, { dryRun: true, now, maxBudgetFor: (id) => winners.get(id) });
  assert.equal(ds[0].after?.daily_budget, 3840);
  assert.ok(ds[1].skipped_reason);
});
