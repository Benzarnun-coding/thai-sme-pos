import test from 'node:test';
import assert from 'node:assert/strict';
import { newCampaignsForFirstStage } from './run.ts';
import type { Entity } from '../../ads-engine/src/types.ts';

const now = new Date('2026-11-03T10:00:00Z');
const c = (id: string, created: string | undefined, level: Entity['level'] = 'campaign'): Entity =>
  ({ level, id, name: id, campaign_id: id, campaign_name: id, status: 'ACTIVE', daily_budget: 200, created_time: created, metrics: {} });

test('only recent campaigns with no stage go to the first stage', () => {
  const list = [c('new', '2026-11-02T01:00:00+0700'), c('old', '2026-10-01T00:00:00+0700'), c('noTime', undefined), c('staged', '2026-11-02T01:00:00+0700'), c('off', '2026-11-02T01:00:00+0700'), c('adset', '2026-11-02T01:00:00+0700', 'adset')];
  const settings = new Map([['staged', { stage_id: 'winning', mode: 'stage' }], ['off', { stage_id: null, mode: 'off' }]]);
  assert.deepEqual(newCampaignsForFirstStage(list, settings, now).map((e) => e.id), ['new']);
});
