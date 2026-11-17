import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MetaClient } from '../../ads-engine/src/meta.ts';

// 2026-11-17: one "(Grok)" launch listed the account's ad sets twice for the verified advertiser; the second listing
// hit Meta's account call limit (subcode 2446079) after the campaign was made and left it empty.
const stub = (failFirstListing = false) => {
  const calls: string[] = [];
  let listings = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = new URL(String(input));
    const path = url.pathname.split('/').slice(2).join('/');
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    const reply = (body: unknown, ok = true) => ({ ok, statusText: '', json: async () => body }) as Response;
    if (path === 'act_1/adsets' && !init?.method) {
      listings++;
      if (failFirstListing && listings === 1) return reply({ error: { message: 'User request limit reached' } }, false);
      return reply({ data: [{ id: 'new', created_time: '2026-11-10', regional_regulated_categories: ['THAILAND_UNIVERSAL'], regional_regulation_identities: { universal_payer: 'p', universal_beneficiary: 'b' } }] });
    }
    if (path === 'act_1/adsets') return reply({ id: 'made' });
    return reply({ targeting: {} }); // the template ad set: made before the Thai rule, names no advertiser
  }) as typeof fetch;
  return { calls, listings: () => listings, restore: () => { globalThis.fetch = real; } };
};

test('the check before a launch and the ad set built after it list the account ad sets once', async () => {
  const s = stub();
  try {
    const meta = new MetaClient('t', 'act_1');
    assert.equal(await meta.verifiedAdvertiser('tpl'), true);
    assert.equal(await meta.createAdsetFrom('tpl', 'camp', 'name', 200), 'made');
    assert.equal(s.listings(), 1);
  } finally { s.restore(); }
});

test('a listing Meta refused is not remembered: the next press asks again', async () => {
  const s = stub(true);
  try {
    const meta = new MetaClient('t', 'act_1');
    await assert.rejects(() => meta.verifiedAdvertiser('tpl'), /User request limit reached/);
    assert.equal(await meta.verifiedAdvertiser('tpl'), true);
    assert.equal(s.listings(), 2);
  } finally { s.restore(); }
});
