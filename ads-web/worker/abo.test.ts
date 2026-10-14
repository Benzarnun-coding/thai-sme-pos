import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate } from '../../ads-engine/src/rules.ts';
import type { Entity, Rule } from '../../ads-engine/src/types.ts';
import { withAdsetBudgets } from './engine.ts';

const m = (roas: number) => ({ spend: 1000, impressions: 0, clicks: 0, ctr: 0, cpc: 0, purchases: 10, purchase_value: roas * 1000, cpa: 100, roas, frequency: 1, messages: 0, cost_per_message: Infinity });
const ent = (o: Partial<Entity>): Entity => ({ level: 'campaign', id: 'c', name: 'REV 801', campaign_id: 'c', campaign_name: 'REV 801', status: 'ACTIVE', daily_budget: null, metrics: {}, ...o } as Entity);
const cut: Rule = { id: 're-cut', level: 'campaign', window: 'last_3d', metric: 'roas', op: '<', value: 2.8, action: { type: 'budget_pct', pct: -20 }, cooldown_hours: 48 } as Rule;

test('an ABO campaign budget cut lands on its active ad sets, each with its own cooldown', () => {
  const entities = [
    ent({ metrics: { last_3d: m(2) } }),
    ent({ level: 'adset', id: 'a1', name: 'ชุด 1', daily_budget: 1000 }),
    ent({ level: 'adset', id: 'a2', name: 'ชุด 2', daily_budget: 500 }),
    ent({ level: 'adset', id: 'a3', name: 'ชุด 3 (หยุด)', daily_budget: 500, status: 'PAUSED' }),
  ];
  const now = new Date('2026-10-14T13:00:00Z');
  const state = { last_action: { 're-cut:a2': '2026-10-14T01:00:00Z' } };
  const out = withAdsetBudgets(evaluate(entities, [cut], { campaign_ids: [], campaign_name_prefixes: [] }, state, now), entities, [cut], state, now);
  assert.match(out[0].skipped_reason!, /ABO/);
  assert.deepEqual(out.slice(1).map((d) => [d.entity.id, d.skipped_reason ?? 'act']), [['a1', 'act'], ['a2', 'cooldown']]);
  assert.equal(out[1].before?.daily_budget, 1000);
});
