import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, resetDb, type Db } from '../src/db/client.js';
import { seed } from '../src/seed.js';
import { buildServer } from '../src/api/server.js';
import { parseSignedRequest, signRequest } from '../src/auth/meta-compliance.js';
import { attachAccount, saveGrant, getConnectionToken } from '../src/auth/connections.js';

describe('Meta compliance: privacy page, data deletion and deauthorize callbacks', () => {
  let db: Db;
  let app: ReturnType<typeof buildServer>;
  const SECRET = 'app-secret-for-tests';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.FB_APP_SECRET = SECRET; process.env.TOKEN_ENC_KEY ??= 'a'.repeat(64);
    await resetDb(); db = await getDb();
    await seed(db, 'climax', { sales: true, facebookDemo: true });
    app = buildServer(db); await app.ready();
  });
  afterAll(async () => { await app.close(); await resetDb(); delete process.env.FB_APP_SECRET; });

  it('verifies a signed_request and rejects a forged one', () => {
    const sr = signRequest({ user_id: '10001' }, SECRET);
    expect(parseSignedRequest(sr, SECRET)?.user_id).toBe('10001');
    expect(parseSignedRequest(sr, 'other-secret')).toBeNull();
    expect(parseSignedRequest(sr.replace(/^./, 'x'), SECRET)).toBeNull();
    expect(parseSignedRequest('garbage', SECRET)).toBeNull();
  });

  it('serves the privacy and data-deletion pages', async () => {
    const p = await app.inject({ method: 'GET', url: '/privacy' });
    expect(p.statusCode).toBe(200); expect(p.headers['content-type']).toContain('text/html'); expect(p.body).toContain('Privacy Policy'); expect(p.body).toContain('AES-256-GCM');
    const d = await app.inject({ method: 'GET', url: '/data-deletion' });
    expect(d.statusCode).toBe(200); expect(d.body).toContain('Data deletion');
  });

  it('a deletion callback erases every token the user granted and returns a checkable code', async () => {
    const grant = await saveGrant(db, { storeId: 'climax', channel: 'facebook', userToken: 'user-token-xyz', scopes: ['pages_show_list'], expiresInSec: 5184000, grantedBy: 'Benz', externalUserId: '10001' });
    const cid = await attachAccount(db, { storeId: 'climax', channel: 'facebook', grantId: grant, externalId: 'page-1', displayName: 'Climax', token: 'page-token-abc', capabilities: { posts: true }, connectedBy: 'Benz', avatarUrl: 'https://x/y.png' });
    expect(await getConnectionToken(db, cid)).toBe('page-token-abc');

    const r = await app.inject({ method: 'POST', url: '/api/meta/data-deletion', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `signed_request=${encodeURIComponent(signRequest({ user_id: '10001' }, SECRET))}` });
    expect(r.statusCode).toBe(200);
    const { url, confirmation_code } = r.json() as { url: string; confirmation_code: string };
    expect(url).toContain(`/data-deletion?code=${confirmation_code}`);

    expect(await getConnectionToken(db, cid)).toBeNull();
    const conn = (await db.query<{ status: string; connected_by: string | null; avatar_url: string | null; grant_id: string | null }>('select status, connected_by, avatar_url, grant_id from connection where id=$1', [cid]))[0];
    expect(conn).toMatchObject({ status: 'disconnected', connected_by: null, avatar_url: null, grant_id: null });
    const g = (await db.query<{ token_enc: string | null; granted_by: string | null }>('select token_enc, granted_by from oauth_grant where id=$1', [grant]))[0];
    expect(g).toEqual({ token_enc: null, granted_by: null });

    const status = await app.inject({ method: 'GET', url: `/data-deletion?code=${confirmation_code}` });
    expect(status.body).toContain('ลบเรียบร้อยแล้ว'); expect(status.body).toContain('completed');
    const audit = await db.query<{ action: string }>(`select action from audit_log where action='connection.deletion'`);
    expect(audit.length).toBe(1);
  });

  it('rejects a forged callback and an unknown user is still answered with a code', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/meta/deauthorize', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `signed_request=${encodeURIComponent(signRequest({ user_id: '1' }, 'wrong'))}` });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/meta/deauthorize', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `signed_request=${encodeURIComponent(signRequest({ user_id: 'nobody' }, SECRET))}` });
    expect(ok.statusCode).toBe(200); expect(ok.json().confirmation_code).toMatch(/^[0-9a-f]{12}$/);
  });
});
