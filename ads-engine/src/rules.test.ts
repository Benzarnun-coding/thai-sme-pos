import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDecisions } from './apply.ts';
import { clampBudget, evaluate, onCooldown } from './rules.ts';
import type { Entity, Guardrails, Rule, Scope, State } from './types.ts';

const scope: Scope = { campaign_name_prefixes: [], campaign_ids: [] };
const g: Guardrails = { max_change_pct_per_run: 20, min_daily_budget: 100, max_daily_budget: 3000, max_total_daily_budget: 10000 };

function adset(over: Partial<Entity> & { cpa?: number; roas?: number; spend?: number }): Entity {
  const { cpa = 100, roas = 2, spend = 2000, ...rest } = over;
  return {
    level: 'adset', id: 'a1', name: 'AS1', campaign_id: 'c1', campaign_name: 'PK Jeans', status: 'ACTIVE', daily_budget: 500,
    metrics: { last_3d: { spend, impressions: 1000, clicks: 50, ctr: 5, cpc: 4, purchases: 10, purchase_value: 4000, cpa, roas, frequency: 1.5, messages: 40, cost_per_message: spend / 40 } },
    ...rest,
  };
}

const pauseRule: Rule = { id: 'r1', level: 'adset', window: 'last_3d', metric: 'cpa', op: '>', value: 300, min_spend: 600, action: { type: 'pause' } };
const scaleRule: Rule = { id: 'r2', level: 'adset', window: 'last_3d', metric: 'roas', op: '>', value: 3, action: { type: 'budget_pct', pct: 20 } };

test('rule fires when metric crosses threshold', () => {
  const d = evaluate([adset({ cpa: 350 })], [pauseRule], scope, { last_action: {} });
  assert.equal(d.length, 1);
  assert.equal(d[0].skipped_reason, undefined);
  assert.match(d[0].plan, /^PAUSE/);
});

test('rule does not fire below min_spend', () => {
  const d = evaluate([adset({ cpa: 350, spend: 200 })], [pauseRule], scope, { last_action: {} });
  assert.equal(d.length, 0);
});

test('rule does not fire below min_purchases', () => {
  const rule = { ...scaleRule, min_purchases: 11 };
  assert.equal(evaluate([adset({ roas: 5 })], [rule], scope, { last_action: {} }).length, 0); // fixture has 10 purchases
  assert.equal(evaluate([adset({ roas: 5 })], [{ ...rule, min_purchases: 10 }], scope, { last_action: {} }).length, 1);
});

test('cooldown blocks a repeat action', () => {
  const state: State = { last_action: { 'r1:a1': new Date(Date.now() - 3600_000).toISOString() } };
  assert.equal(onCooldown(pauseRule, 'a1', state, new Date()), true);
  const d = evaluate([adset({ cpa: 350 })], [pauseRule], scope, state);
  assert.equal(d[0].skipped_reason, 'cooldown');
});

test('scope by campaign name prefix', () => {
  const d = evaluate([adset({ cpa: 350 })], [pauseRule], { campaign_name_prefixes: ['CM '], campaign_ids: [] }, { last_action: {} });
  assert.equal(d.length, 0);
});

test('only first matching rule acts on an entity', () => {
  const d = evaluate([adset({ cpa: 350, roas: 5 })], [pauseRule, scaleRule], scope, { last_action: {} });
  assert.equal(d.filter((x) => !x.skipped_reason).length, 1);
  assert.equal(d[0].rule_id, 'r1');
});

test('budget_pct skipped when entity has no daily budget (CBO)', () => {
  const d = evaluate([adset({ roas: 5, daily_budget: null })], [scaleRule], scope, { last_action: {} });
  assert.match(d[0].skipped_reason!, /no daily budget/);
});

test('clampBudget caps percent and respects min/max', () => {
  assert.deepEqual(clampBudget(500, 50, g), { next: 600, note: 'pct capped 50→20' });
  assert.deepEqual(clampBudget(500, -20, g), { next: 400, note: undefined });
  assert.equal(clampBudget(110, -20, g)?.next, 100);
  assert.equal(clampBudget(2900, 20, g)?.next, 3000);
  assert.equal(clampBudget(3000, 20, g), null);
  // Never the other way: a raise on a budget above the max isn't a cut, a cut below the min isn't a raise.
  assert.equal(clampBudget(5000, 20, g), null);
  assert.equal(clampBudget(80, -20, g), null);
  assert.equal(clampBudget(5000, -20, g)?.next, 3000); // a cut that lands under the max still goes through
});

test('over the total cap: cuts still go through, increases are refused', async () => {
  const cutRule: Rule = { id: 'cut', level: 'adset', window: 'last_3d', metric: 'roas', op: '<', value: 1, action: { type: 'budget_pct', pct: -20 } };
  const loser = adset({ id: 'lose', roas: 0.5, daily_budget: 3000 });
  const winner = adset({ id: 'win', roas: 4, daily_budget: 2500 });
  const other = adset({ id: 'other', roas: 2, daily_budget: 5500 }); // total 11,000 > cap 10,000
  const campaign: Entity = { ...adset({}), level: 'campaign', id: 'c1', daily_budget: null }; // ad sets count under an active campaign
  const entities = [campaign, loser, winner, other];
  const decisions = evaluate([loser, winner, other], [cutRule, scaleRule], scope, { last_action: {} });
  const set: Record<string, number> = {};
  const meta = { setStatus: async () => {}, setDailyBudget: async (id: string, amount: number) => { set[id] = amount; } };
  const r = await applyDecisions(decisions, entities, meta, g, { last_action: {} }, { dryRun: false, now: new Date('2026-10-15T01:00:00Z') });
  assert.equal(set.lose, 2400);
  assert.equal(set.win, undefined);
  assert.match(decisions.find((d) => d.entity.id === 'win')!.skipped_reason ?? '', /max_total_daily_budget/);
  assert.equal(r.totalAfter, 10400);
});

test('small-budget step-up: max_budget picks small budgets, up_to skips the per-run % cap', async () => {
  const step: Rule = { id: 'win-small', level: 'adset', window: 'last_3d', metric: 'roas', op: '>=', value: 3, max_budget: 200, action: { type: 'budget_pct', pct: 100, up_to: 300 } };
  assert.deepEqual(clampBudget(100, 100, g, 300), { next: 200, note: undefined });
  assert.deepEqual(clampBudget(200, 100, g, 300), { next: 300, note: 'up to 300' });
  assert.equal(clampBudget(300, 100, g, 300), null);
  assert.equal(clampBudget(500, -20, g, 300)?.next, 400); // up_to never changes a cut
  const small = adset({ id: 'small', roas: 5, daily_budget: 150 });
  const big = adset({ id: 'big', roas: 5, daily_budget: 250 });
  const decisions = evaluate([small, big], [step], scope, { last_action: {} });
  assert.deepEqual(decisions.map((d) => d.entity.id), ['small']);
  const set: Record<string, number> = {};
  const meta = { setStatus: async () => {}, setDailyBudget: async (id: string, amount: number) => { set[id] = amount; } };
  await applyDecisions(decisions, [small, big], meta, g, { last_action: {} }, { dryRun: false, now: new Date('2026-10-23T01:00:00Z') });
  assert.equal(set.small, 300);
});
