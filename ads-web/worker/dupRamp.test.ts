import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rampCopies, zeroMetrics } from './run.ts';
import type { Entity } from '../../ads-engine/src/types.ts';

const now = new Date('2026-10-22T01:00:00Z');
const camp = (id: string, budget: number, spend: number, roas: number): Entity => ({
  level: 'campaign', id, name: `c${id}`, campaign_id: id, campaign_name: `c${id}`, status: 'ACTIVE', daily_budget: budget,
  metrics: { last_3d: { ...zeroMetrics(), spend, roas } },
});
const testing = (ids: string[]) => new Map(ids.map((id) => [id, { stage_id: 'testing' }]));

test('a copy climbs +20% while early or above break-even, stops below it', () => {
  const es = [camp('1', 50, 40, 0), camp('2', 200, 600, 3.2), camp('3', 200, 600, 2.0), camp('4', 50, 0, 0)];
  const out = rampCopies(es, new Set(['1', '2', '3']), testing(['1', '2', '3', '4']), [], 2.9, { last_action: {} }, now);
  assert.deepEqual(out.map((d) => [d.entity.id, d.action.pct]), [['1', 20], ['2', 20]]);
});

test('the last step only reaches the target; cooldown, other stages and stage-rule actions stop it', () => {
  const es = [camp('1', 900, 0, 0), camp('2', 50, 0, 0), camp('3', 50, 0, 0), camp('4', 50, 0, 0), camp('5', 1000, 0, 0)];
  const cs = testing(['1', '2', '4', '5']);
  cs.set('3', { stage_id: 'winning' });
  const state = { last_action: { 'dup-ramp:2': '2026-10-21T20:00:00Z' } };
  const ruled = [{ rule_id: 'x', entity: { level: 'campaign' as const, id: '4', name: '', campaign_name: '' }, window: 'last_3d' as const, metric: 'roas' as const, observed: 0, threshold: 0, action: { type: 'pause' as const }, plan: '' }];
  const out = rampCopies(es, new Set(['1', '2', '3', '4', '5']), cs, ruled, 2.9, state, now);
  assert.deepEqual(out.map((d) => [d.entity.id, d.action.pct]), [['1', 11]]);
});
