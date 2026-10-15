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

test('an ABO campaign gets one budget rule per run, and an increase stops at the per-campaign cap on the sum of its ad sets', () => {
  const boost: Rule = { id: 'win-boost', level: 'campaign', window: 'last_3d', metric: 'roas', op: '>', value: 3, action: { type: 'budget_pct', pct: 20 } } as Rule;
  const up: Rule = { id: 'win-up', level: 'campaign', window: 'last_3d', metric: 'roas', op: '>', value: 2.5, action: { type: 'budget_pct', pct: 20 } } as Rule;
  const entities = [
    ent({ metrics: { last_3d: m(4) } }),
    ent({ level: 'adset', id: 'a1', name: 'ชุด 1', daily_budget: 1500 }),
    ent({ level: 'adset', id: 'a2', name: 'ชุด 2', daily_budget: 1200 }), // sum 2,700
  ];
  const now = new Date('2026-10-14T13:00:00Z');
  const state = { last_action: {} };
  const out = withAdsetBudgets(evaluate(entities, [boost, up], { campaign_ids: [], campaign_name_prefixes: [] }, state, now), entities, [boost, up], state, now, 3200);
  const adsetDecisions = out.filter((d) => d.entity.level === 'adset');
  // Only win-boost lands on the ad sets; win-up is skipped like it would be on a CBO campaign.
  assert.deepEqual(adsetDecisions.map((d) => [d.entity.id, d.rule_id]), [['a1', 'win-boost'], ['a2', 'win-boost']]);
  assert.equal(out.find((d) => d.rule_id === 'win-up')!.skipped_reason, 'another rule already acted on this entity');
  // +20% would make 3,240 > 3,200: trimmed to +18% (3,186).
  assert.equal(adsetDecisions[0].action.pct, 18);
  // Already at the cap: no increase.
  const full = [entities[0], ent({ level: 'adset', id: 'a1', name: 'ชุด 1', daily_budget: 2000 }), ent({ level: 'adset', id: 'a2', name: 'ชุด 2', daily_budget: 1200 })];
  const out2 = withAdsetBudgets(evaluate(full, [boost], { campaign_ids: [], campaign_name_prefixes: [] }, state, now), full, [boost], state, now, 3200);
  assert.equal(out2.filter((d) => d.entity.level === 'adset').length, 0);
  assert.match(out2[0].skipped_reason!, /เพดานต่อแคมเปญ/);
});

test('an ABO boost on cooldown on every ad set lets the next matching rule act, as on a CBO campaign', () => {
  const boost: Rule = { id: 'win-boost', level: 'campaign', window: 'last_3d', metric: 'roas', op: '>', value: 3, action: { type: 'budget_pct', pct: 20 }, cooldown_hours: 11 } as Rule;
  const up: Rule = { id: 'win-up', level: 'campaign', window: 'last_3d', metric: 'roas', op: '>', value: 2.5, action: { type: 'budget_pct', pct: 20 }, cooldown_hours: 24 } as Rule;
  const entities = [ent({ metrics: { last_3d: m(4) } }), ent({ level: 'adset', id: 'a1', name: 'ชุด 1', daily_budget: 500 })];
  const now = new Date('2026-10-14T13:00:00Z');
  const state = { last_action: { 'win-boost:a1': '2026-10-14T08:00:00Z' } };
  const out = withAdsetBudgets(evaluate(entities, [boost, up], { campaign_ids: [], campaign_name_prefixes: [] }, state, now), entities, [boost, up], state, now, 3200);
  assert.deepEqual(out.filter((d) => d.entity.level === 'adset').map((d) => [d.rule_id, d.skipped_reason ?? 'act']), [['win-boost', 'cooldown'], ['win-up', 'act']]);
});
