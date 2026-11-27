import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MetaClient } from '../../ads-engine/src/meta.ts';

// 2026-11-26: the "คัดลอกเลย" button failed on every press: Meta refuses `<adset>/copies` on ad sets that still carry
// targeting_optimization (subcode 1870197). The copy now builds its ad sets and deletes a half-made campaign.
const stub = (failAdCopy = false, enhancements = false) => {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = new URL(String(input));
    const path = url.pathname.split('/').slice(2).join('/');
    const method = init?.method ?? 'GET';
    const body = init?.body ? new URLSearchParams(String(init.body)) : null;
    calls.push(`${method} ${path}${body?.get('status') ? ` status=${body.get('status')}` : ''}`);
    const reply = (b: unknown, ok = true) => ({ ok, statusText: '', json: async () => b }) as Response;
    if (path === 'camp/adsets') return reply({ data: [{ id: 'as1', status: 'ACTIVE' }, { id: 'as2', status: 'PAUSED' }] });
    if (path === 'camp/ads') return reply({ data: [{ id: 'ad1', status: 'ACTIVE', adset_id: 'as1' }] });
    if (path === 'camp/copies') return reply({ copied_campaign_id: 'copy' });
    if (path === 'copy' && method === 'GET') return reply({ daily_budget: '100000' });
    if (path === 'as1/copies') return reply({ error: { message: 'Invalid parameter', error_subcode: 1870197 } }, false);
    if (path === 'act_1/adsets' && method === 'POST') return reply({ id: 'newset' });
    if (path === 'ad1/copies' && enhancements) return reply({ error: { message: 'Invalid parameter — Creative should not include standard enhancements', error_subcode: 3858504 } }, false);
    if (path === 'ad1' && method === 'GET') return reply({ name: 'แอด 1', creative: { name: 'cr', effective_object_story_id: '111_222', object_story_spec: { page_id: '111' } } });
    if (path === 'act_1/adcreatives') { calls.push(`creative ${body?.get('object_story_id')} spec=${body?.has('object_story_spec')}`); return reply({ id: 'cr2' }); }
    if (path === 'act_1/ads') return reply({ id: 'builtad' });
    if (path === 'ad1/copies') return failAdCopy ? reply({ error: { message: 'boom' } }, false) : reply({ copied_ad_id: 'newad' });
    if (path === 'copy') return reply({ success: true });
    return reply({ name: 'ชุด 1', targeting: { geo_locations: { countries: ['TH'] }, targeting_optimization: 'expansion_all' }, regional_regulated_categories: ['THAILAND_UNIVERSAL'], regional_regulation_identities: { universal_payer: 'p', universal_beneficiary: 'b' } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
};

test('a campaign copy builds its ad sets instead of copying them', async () => {
  const s = stub();
  try {
    const r = await new MetaClient('t', 'act_1').copyCampaign('camp', ' (คัดลอก)');
    assert.deepEqual(r, { id: 'copy', children: ['newset', 'newad'] });
    assert.ok(!s.calls.some((c) => c.startsWith('POST as1/copies')));
    assert.ok(s.calls.includes('POST act_1/adsets status=PAUSED'));
  } finally { s.restore(); }
});

test('a copy that fails half way deletes the paused campaign it made', async () => {
  const s = stub(true);
  try {
    await assert.rejects(() => new MetaClient('t', 'act_1').copyCampaign('camp', ' (คัดลอก)'), /boom/);
    assert.ok(s.calls.includes('POST copy status=DELETED'));
  } finally { s.restore(); }
});

test('an ad Meta will not copy (standard enhancements) is made again on the same post, paused', async () => {
  const s = stub(false, true);
  try {
    const r = await new MetaClient('t', 'act_1').copyCampaign('camp', ' (คัดลอก)');
    assert.deepEqual(r, { id: 'copy', children: ['newset', 'builtad'] });
    assert.ok(s.calls.includes('creative 111_222 spec=false'));
    assert.ok(s.calls.includes('POST act_1/ads status=PAUSED'));
    assert.ok(!s.calls.some((c) => c.includes('status=DELETED')));
  } finally { s.restore(); }
});
