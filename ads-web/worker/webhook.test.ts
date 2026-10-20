import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashName } from './p365.ts';
import { extractReferrals, nameHashes } from './webhook.ts';

test('referrals are read from referral, postback and first-message events; echoes and plain messages are not', () => {
  const rows = extractReferrals([
    { messaging: [
      { sender: { id: 'u1' }, timestamp: 1_791_500_000_000, referral: { ref: '', source: 'ADS', type: 'OPEN_THREAD', ad_id: '120250097923720069' } },
      { sender: { id: 'u2' }, timestamp: 1_791_500_001_000, postback: { referral: { source: 'ADS', type: 'OPEN_THREAD', ad_id: '120249738735280069' } } },
      { sender: { id: 'u3' }, timestamp: 1_791_500_002_000, message: { referral: { source: 'SHORTLINK', type: 'OPEN_THREAD', ref: 'promo' } } },
      { sender: { id: 'page' }, timestamp: 1_791_500_003_000, message: { is_echo: true, referral: { source: 'ADS', ad_id: 'x' } } },
      { sender: { id: 'u4' }, timestamp: 1_791_500_004_000, message: {} },
    ] },
    { standby: [{ sender: { id: 'u5' }, timestamp: 1_791_500_005, referral: { source: 'ADS', type: 'OPEN_THREAD', ad_id: '120249724151120069' } }] },
  ]);
  assert.deepEqual(rows.map((r) => [r.psid, r.kind, r.ad_id, r.source, r.ref]), [
    ['u1', 'referral', '120250097923720069', 'ADS', ''],
    ['u2', 'postback', '120249738735280069', 'ADS', null],
    ['u3', 'message', null, 'SHORTLINK', 'promo'],
    ['u5', 'referral', '120249724151120069', 'ADS', null],
  ]);
  assert.equal(rows[0].at, '2026-10-08T22:53:20.000Z');
  assert.equal(rows[3].at, '2026-10-08T22:53:25.000Z', 'seconds are converted too');
  assert.equal(rows[0].campaign_id, null);
});

test('name hashes fall back to the conversation when Meta refuses the profile, and stay inside the request cap', async () => {
  const urls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: any) => {
    const url = String(u);
    urls.push(url);
    const r = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.includes('me/accounts')) return r({ data: [{ id: 'pg', name: 'Page', access_token: 'PT' }] });
    // Real reply 2026-10-20: the profile lookup is refused for customers.
    if (url.includes('fields=name')) return r({ error: { message: '(#100) Missing permissions' } });
    const psid = new URL(url).searchParams.get('user_id');
    if (url.includes('/pg/conversations')) return r({ data: [{ participants: { data: [{ id: 'pg', name: 'Page' }, { id: psid, name: ` Somchai  ${psid} ` }] } }] });
    return r({});
  }) as typeof fetch;
  try {
    const env = { DB: null as any, META_ACCESS_TOKEN: 't', META_WEBHOOK_VERIFY_TOKEN: 'salt' };
    const one = await nameHashes(env, ['p1']);
    assert.equal(one.get('p1'), await hashName('somchai p1', 'salt'));
    urls.length = 0;
    const many = await nameHashes(env, ['a', 'b', 'c', 'd', 'e'], 6);
    assert.deepEqual([...many.keys()], ['a', 'b', 'c']);
    assert.ok(urls.length <= 7, String(urls.length));
  } finally {
    globalThis.fetch = real;
  }
});
