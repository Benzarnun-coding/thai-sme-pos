import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findSpendSpikes, spendAlertText } from './spendAlert.ts';
import type { Entity, Metrics } from '../../ads-engine/src/types.ts';

const m = (spend: number): Metrics => ({ spend, impressions: 0, clicks: 0, ctr: 0, cpc: 0, purchases: 0, purchase_value: 0, cpa: Infinity, roas: 0, frequency: 0, messages: 0, cost_per_message: Infinity });
const camp = (id: string, daily_budget: number | null, status = 'ACTIVE'): Entity => ({ level: 'campaign', id, name: `แคมเปญ ${id}`, campaign_id: id, campaign_name: `แคมเปญ ${id}`, status, daily_budget, metrics: {} });
const adset = (id: string, campaign_id: string, daily_budget: number | null): Entity => ({ level: 'adset', id, name: id, campaign_id, campaign_name: '', status: 'ACTIVE', daily_budget, metrics: {} });

test('a campaign is flagged over 5,000 or over 3× its budget, whichever is higher; ABO budgets are the ad sets\' sum', () => {
  const entities = [camp('big', 3200), camp('small', 200), camp('none', null), camp('abo', null), adset('a1', 'abo', 400), adset('a2', 'abo', 400), camp('paused', 200, 'PAUSED')];
  const today = new Map([['big', m(9000)], ['small', m(700)], ['none', m(5001)], ['abo', m(2500)], ['paused', m(51157)]]);
  const spikes = findSpendSpikes(entities, today, new Set(['big', 'small']));
  assert.deepEqual(spikes.map((s) => [s.id, s.limit, s.unstaged]), [['paused', 5000, true], ['none', 5000, true]]);
  // 3,200 × 3 = 9,600 > 9,000; 200 × 3 = 600 < 5,000 floor; ABO 800 × 3 = 2,400 < 5,000 floor
  assert.equal(spikes.find((s) => s.id === 'abo'), undefined);
});

test('the message names each campaign, its spend, budget and whether the rules watch it', () => {
  const text = spendAlertText([{ id: 'x', name: 'โพสผี 501', status: 'PAUSED', spend: 51157, budget: null, limit: 5000, unstaged: true }], '2026-11-01');
  assert.match(text, /โพสผี 501 — ใช้ไปแล้ว \*\*51,157\*\* \(ไม่มีงบรายวัน\) · PAUSED · ไม่มี stage/);
  assert.match(text, /ไม่ได้หยุดอะไรให้/);
});
