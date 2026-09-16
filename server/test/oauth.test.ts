import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, resetDb, type Db } from '../src/db/client.js';
import { seed } from '../src/seed.js';
import { buildServer } from '../src/api/server.js';
import { decryptToken, encryptToken, maskToken, resetKey } from '../src/auth/crypto.js';
import { consumeState, createState, disconnect, getConnectionToken, listConnections } from '../src/auth/connections.js';
import { buildAuthorizeUrl, exchangeCode, listAccounts } from '../src/auth/facebook-oauth.js';

describe('token encryption', () => {
  it('round-trips a token', () => {
    const blob = encryptToken('EAAG-super-secret-token');
    expect(blob).toMatch(/^v1\./);
    expect(blob).not.toContain('super-secret');
    expect(decryptToken(blob)).toBe('EAAG-super-secret-token');
  });
  it('produces a different ciphertext each time (random iv)', () => {
    expect(encryptToken('same')).not.toBe(encryptToken('same'));
  });
  it('refuses to decrypt with the wrong key', () => {
    const blob = encryptToken('secret');
    resetKey();
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    expect(() => decryptToken(blob)).toThrow();
    delete process.env.TOKEN_ENCRYPTION_KEY;
    resetKey();
  });
  it('masks tokens for display', () => {
    expect(maskToken('EAAGabcdefgh1234')).toBe('••••••••1234');
    expect(maskToken('short')).toBe('••••');
  });
});

describe('oauth state', () => {
  let db: Db;
  beforeAll(async () => { await resetDb(); db = await getDb(); await seed(db, 'climax', { sales: false, facebookDemo: false }); });
  afterAll(async () => { await resetDb(); });

  it('is single use', async () => {
    const state = await createState(db, 'climax', 'facebook');
    expect(await consumeState(db, state)).toMatchObject({ store_id: 'climax', channel: 'facebook' });
    expect(await consumeState(db, state)).toBeNull();
  });
  it('rejects an unknown state', async () => {
    expect(await consumeState(db, 'never-issued')).toBeNull();
  });
  it('rejects a state older than 10 minutes', async () => {
    const state = await createState(db, 'climax', 'facebook');
    await db.query(`update oauth_state set created_at = now() - interval '11 minutes' where state = $1`, [state]);
    expect(await consumeState(db, state)).toBeNull();
  });
});

describe('facebook oauth helpers', () => {
  it('builds a consent url with state and scopes', () => {
    const url = new URL(buildAuthorizeUrl({ appId: '123', redirectUri: 'https://app/cb', state: 'st', scopes: ['pages_show_list', 'ads_read'] }));
    expect(url.searchParams.get('client_id')).toBe('123');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('scope')).toBe('pages_show_list,ads_read');
    expect(url.searchParams.get('response_type')).toBe('code');
  });
  it('prefers a Login-for-Business config over a raw scope list', () => {
    const url = new URL(buildAuthorizeUrl({ appId: '123', redirectUri: 'https://app/cb', state: 'st', scopes: ['ads_read'], configId: 'cfg-9' }));
    expect(url.searchParams.get('config_id')).toBe('cfg-9');
    expect(url.searchParams.get('scope')).toBeNull();
  });

  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.pathname.endsWith('/oauth/access_token')) {
      return url.searchParams.get('grant_type') === 'fb_exchange_token'
        ? json({ access_token: 'LONG-TOKEN', expires_in: 5184000 })
        : json({ access_token: 'SHORT-TOKEN' });
    }
    if (url.pathname.endsWith('/me/permissions')) return json({ data: [{ permission: 'ads_read', status: 'granted' }, { permission: 'pages_manage_posts', status: 'declined' }] });
    if (url.pathname.endsWith('/me/accounts')) return json({ data: [{ id: '111', name: 'Climax by PKjeans', access_token: 'PAGE-TOKEN', category: 'ค้าปลีก', followers_count: 44000 }] });
    if (url.pathname.endsWith('/me/adaccounts')) return json({ data: [{ id: 'act_999', account_id: '999', name: 'Climax Ads', currency: 'THB', account_status: 1 }] });
    return new Response(JSON.stringify({ error: { message: 'nope', code: 100 } }), { status: 400 });
  };

  it('exchanges the code for a long-lived token and reads granted scopes', async () => {
    const r = await exchangeCode({ code: 'CODE', appId: '1', appSecret: 's', redirectUri: 'https://app/cb', fetchImpl });
    expect(r.userToken).toBe('LONG-TOKEN');
    expect(r.expiresInSec).toBe(5184000);
    expect(r.scopes).toEqual(['ads_read']);   // declined permissions are dropped
  });

  it('lists pages and ad accounts, keeping the page token', async () => {
    const accounts = await listAccounts({ userToken: 'LONG-TOKEN', fetchImpl });
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({ kind: 'page', id: '111', token: 'PAGE-TOKEN' });
    expect(accounts[0].detail).toContain('44,000');
    expect(accounts[1]).toMatchObject({ kind: 'ad_account', id: 'act_999' });
  });

  it('surfaces a clear error when the page list fails', async () => {
    const failing: typeof fetch = async () => new Response(JSON.stringify({ error: { message: 'token หมดอายุ', code: 190 } }), { status: 400 });
    await expect(listAccounts({ userToken: 'bad', fetchImpl: failing })).rejects.toThrow(/ดึงรายชื่อเพจไม่สำเร็จ.*token หมดอายุ/);
  });
});

describe('connect flow over the API (demo mode)', () => {
  let db: Db;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.FB_APP_ID; delete process.env.FB_APP_SECRET;
    await resetDb(); db = await getDb();
    await seed(db, 'climax', { sales: false, facebookDemo: false });
    app = buildServer(db); await app.ready();
  });
  afterAll(async () => { await app.close(); await resetDb(); });

  it('lists providers and says what is missing', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/providers' });
    const providers = r.json() as { channel: string; configured: boolean; missing_env: string[]; scopes: { scope: string; requested_now: boolean }[] }[];
    const fb = providers.find((p) => p.channel === 'facebook')!;
    expect(fb.configured).toBe(false);
    expect(fb.missing_env).toEqual(['FB_APP_ID', 'FB_APP_SECRET']);
    // phase 1 scopes are requested, later-phase ones are declared but not asked for yet
    expect(fb.scopes.find((s) => s.scope === 'ads_read')?.requested_now).toBe(true);
    expect(fb.scopes.find((s) => s.scope === 'pages_manage_posts')?.requested_now).toBe(false);
  });

  it('walks connect → pick account → attach → disconnect', async () => {
    const start = await app.inject({ method: 'POST', url: '/api/stores/climax/connect/facebook', payload: { by: 'เบนซ์' } });
    const { mode, grant_id } = start.json() as { mode: string; grant_id: string };
    expect(mode).toBe('demo');

    const list = await app.inject({ method: 'GET', url: `/api/stores/climax/connect/facebook/accounts?grant=${grant_id}` });
    const picker = list.json() as { demo: boolean; accounts: { id: string; name: string; kind: string; capabilities: Record<string, boolean> }[] };
    expect(picker.demo).toBe(true);
    expect(picker.accounts.map((a) => a.kind)).toEqual(['page', 'page', 'ad_account']);
    // phase 1 grants read access only — posting stays off until the scope is granted
    const page = picker.accounts[0];
    expect(page.capabilities).toMatchObject({ insights: true, post: false });

    const attach = await app.inject({
      method: 'POST', url: '/api/stores/climax/connect/facebook/attach',
      payload: { grant: grant_id, account_ids: [page.id, 'act_8841000111'], by: 'เบนซ์' },
    });
    const res = attach.json() as { attached: string[]; connections: { id: string; status: string; token_source: string }[] };
    expect(res.attached).toEqual([page.id, 'act_8841000111']);

    const conns = await listConnections(db, 'climax');
    const saved = conns.find((c) => c.external_account_id === page.id)!;
    expect(saved.status).toBe('connected');
    expect(saved.token_source).toBe('demo');
    expect(saved.connected_by).toBe('เบนซ์');
    expect(saved.display_name).toContain('Climax');

    // the token is stored encrypted but readable through the helper
    const stored = await db.query<{ token_enc: string }>('select token_enc from connection where id = $1', [saved.id]);
    expect(stored[0].token_enc).not.toContain('demo-page-token');
    expect(await getConnectionToken(db, saved.id)).toBe('demo-page-token');

    // the API response must never leak a token
    expect(JSON.stringify(res)).not.toContain('demo-page-token');

    const del = await app.inject({ method: 'DELETE', url: `/api/stores/climax/connections/${saved.id}?by=เบนซ์` });
    expect(del.statusCode).toBe(200);
    const after = (await listConnections(db, 'climax')).find((c) => c.id === saved.id)!;
    expect(after.status).toBe('disconnected');
    expect(await getConnectionToken(db, saved.id)).toBeNull();
  });

  it('refuses an account that the grant does not cover', async () => {
    const start = await app.inject({ method: 'POST', url: '/api/stores/climax/connect/facebook' });
    const { grant_id } = start.json() as { grant_id: string };
    const r = await app.inject({ method: 'POST', url: '/api/stores/climax/connect/facebook/attach', payload: { grant: grant_id, account_ids: ['someone-elses-page'] } });
    expect(r.statusCode).toBe(400);
  });

  it('refuses a grant that belongs to another store', async () => {
    await db.query(`insert into store(id, name) values ('other','ร้านอื่น') on conflict do nothing`);
    const start = await app.inject({ method: 'POST', url: '/api/stores/other/connect/facebook' });
    const { grant_id } = start.json() as { grant_id: string };
    const r = await app.inject({ method: 'GET', url: `/api/stores/climax/connect/facebook/accounts?grant=${grant_id}` });
    expect(r.statusCode).toBe(404);
  });

  it('says clearly when a channel is not implemented yet', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/stores/climax/connect/tiktok' });
    expect(r.statusCode).toBe(501);
    expect((r.json() as { error: string }).error).toContain('TikTok');
  });

  it('rejects a callback with a stale state', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/oauth/facebook/callback?code=abc&state=not-a-real-state' });
    expect(r.statusCode).toBe(302);
    expect(decodeURIComponent(r.headers.location as string)).toContain('หมดอายุ');
  });

  it('passes the provider error back to the app when the owner cancels', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/oauth/facebook/callback?error=access_denied&error_description=ผู้ใช้ยกเลิก' });
    expect(decodeURIComponent(r.headers.location as string)).toContain('ผู้ใช้ยกเลิก');
  });

  it('disconnect on an unknown connection is a 404, not a silent success', async () => {
    const r = await app.inject({ method: 'DELETE', url: '/api/stores/climax/connections/does-not-exist' });
    expect(r.statusCode).toBe(404);
  });
});
