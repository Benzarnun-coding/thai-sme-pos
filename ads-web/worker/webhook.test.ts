import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractReferrals } from './webhook.ts';

test('referrals are read from referral, postback and first-message events; echoes and plain messages are not', () => {
  const rows = extractReferrals([
    { messaging: [
      { sender: { id: 'u1' }, timestamp: 1_791_500_000_000, referral: { ref: '', source: 'ADS', type: 'OPEN_THREAD', ad_id: '120250097923720069' } },
      { sender: { id: 'u2' }, timestamp: 1_791_500_001_000, postback: { referral: { source: 'ADS', type: 'OPEN_THREAD', ad_id: '120249738735280069' } } },
      { sender: { id: 'u3' }, timestamp: 1_791_500_002_000, message: { referral: { source: 'SHORTLINK', type: 'OPEN_THREAD', ref: 'promo' } } },
      { sender: { id: 'page' }, timestamp: 1_791_500_003_000, message: { is_echo: true, referral: { source: 'ADS', ad_id: 'x' } } },
      { sender: { id: 'u4' }, timestamp: 1_791_500_004_000, message: {} },
    ] },
  ]);
  assert.deepEqual(rows.map((r) => [r.psid, r.kind, r.ad_id, r.source, r.ref]), [
    ['u1', 'referral', '120250097923720069', 'ADS', ''],
    ['u2', 'postback', '120249738735280069', 'ADS', null],
    ['u3', 'message', null, 'SHORTLINK', 'promo'],
  ]);
  assert.equal(rows[0].at, '2026-10-08T22:53:20.000Z');
  assert.equal(rows[0].campaign_id, null);
});
