import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Entity, Metrics } from '../../ads-engine/src/types.ts';
import { buildIdeas, type IdeaInput } from './ideas.ts';

function m(spend: number, purchases: number, value: number, frequency = 1.5): Metrics {
  return { spend, purchases, purchase_value: value, frequency, impressions: 0, clicks: 0, ctr: 0, cpc: 0, cpa: purchases ? spend / purchases : Infinity, roas: spend ? value / spend : 0, messages: 0, cost_per_message: Infinity };
}
function c(id: string, budget: number | null = 500): Entity {
  return { level: 'campaign', id, name: `C${id}`, campaign_id: id, campaign_name: `C${id}`, status: 'ACTIVE', daily_budget: budget, metrics: {} };
}
function input(id: string, m7: Metrics, m30?: Metrics, stage_id: string | null = 'testing', breakeven: number | null = null): IdeaInput {
  return { campaign: c(id), m7, m30, stage_id, breakeven };
}
// A steady background so the account average is ~3.0 and CPA ~133.
const steady = [input('1', m(20000, 150, 60000)), input('2', m(20000, 150, 60000))];

test('spend without sales → pause, high', () => {
  const ideas = buildIdeas([...steady, input('9', m(400, 0, 0))]);
  const i = ideas.find((x) => x.campaign_id === '9')!;
  assert.equal(i.kind, 'no_sales');
  assert.equal(i.severity, 'high');
  assert.deepEqual(i.action, { type: 'pause' });
});

test('small spend without sales is not flagged', () => {
  assert.equal(buildIdeas([...steady, input('9', m(100, 0, 0))]).some((x) => x.campaign_id === '9'), false);
});

test('declining: was good, dropped 20%+ and below yardstick → move to retest', () => {
  // prior 23 days: spend 10000 value 40000 (4.0); last 7: spend 3000 value 6000 (2.0)
  const ideas = buildIdeas([...steady, input('5', m(3000, 20, 6000), m(13000, 120, 46000), 'winning')]);
  const i = ideas.find((x) => x.campaign_id === '5')!;
  assert.equal(i.kind, 'declining');
  assert.deepEqual(i.action, { type: 'move', to: 'retest' });
});

test('rising: well above break-even with enough orders → suggest winning', () => {
  const ideas = buildIdeas([...steady, input('6', m(2000, 20, 8000), undefined, 'testing', 2.5)]);
  const i = ideas.find((x) => x.campaign_id === '6')!;
  assert.equal(i.kind, 'rising');
  assert.deepEqual(i.action, { type: 'move', to: 'winning' });
});

test('uses break-even when known instead of account average', () => {
  // ROAS 2.0 is below account 3.0 but above break-even 1.2 → not a money sink
  const ideas = buildIdeas([...steady, input('7', m(5000, 30, 10000), undefined, 'testing', 1.2)]);
  assert.equal(ideas.some((x) => x.campaign_id === '7' && x.kind === 'money_sink'), false);
  const noBe = buildIdeas([...steady, input('7', m(5000, 30, 10000), undefined, 'testing', null)]);
  assert.equal(noBe.find((x) => x.campaign_id === '7')?.kind, 'money_sink');
});

test('unassigned running campaigns are summarised once', () => {
  const ideas = buildIdeas([input('1', m(100, 1, 300), undefined, null), input('2', m(100, 1, 300), undefined, null)]);
  const u = ideas.filter((x) => x.kind === 'unassigned');
  assert.equal(u.length, 1);
  assert.match(u[0].title, /2 แคมเปญ/);
});

test('paused campaigns get no ideas; high severity sorts first', () => {
  const paused = { ...input('8', m(900, 0, 0)), campaign: { ...c('8'), status: 'PAUSED' } };
  const ideas = buildIdeas([...steady, paused, input('3', m(500, 0, 0)), input('4', m(100, 1, 300, 3.5))]);
  assert.equal(ideas.some((x) => x.campaign_id === '8'), false);
  assert.equal(ideas[0].severity, 'high');
});

test('a budget changed in the last days is not suggested again', () => {
  const recent = { at: new Date().toISOString(), from: 1000, to: 500 };
  const ideas = buildIdeas([...steady, { ...input('7', m(5000, 30, 10000)), recent_budget_change: recent }]);
  const i = ideas.find((x) => x.campaign_id === '7')!;
  assert.equal(i.kind, 'money_sink');
  assert.equal(i.action, null);
  assert.equal(i.severity, 'low');
  assert.match(i.detail, /ปรับงบแล้ว/);
});
