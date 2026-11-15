import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqliteD1.ts';
import { authenticate } from './auth.ts';
import { commandRoute, countdown, digestJobs, parseRss, fetchFeed, blogUrl, teamFromDigest, validateSnapshot, type CommandEnv, type JobMeta } from './command.ts';

// Every value here is made up: example.com emails, round numbers, "[ทดสอบ]" titles.
const TEAM = 'https://cmd-test.cloudflareaccess.com';
const MAIN_AUD = 'main-aud';
const CMD_AUD = 'command-aud';
const OWNER = 'owner@example.com';
const CLIENT = 'svc-client-1.access';

const { publicKey, privateKey } = (await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'],
)) as CryptoKeyPair;
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1' };

// One fetch for the whole file: certs for TEAM, everything else recorded and answered by `rss` (default: refuse).
const calls: string[] = [];
let rss: (url: string) => Promise<Response> = async () => { throw new Error('no network in tests'); };
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === `${TEAM}/cdn-cgi/access/certs`) return new Response(JSON.stringify({ keys: [jwk] }));
  if (url.includes('down.cloudflareaccess.com')) throw new Error('certs down');
  calls.push(url);
  return rss(url);
}) as typeof fetch;

const b64url = (s: string | Uint8Array) => Buffer.from(typeof s === 'string' ? new TextEncoder().encode(s) : s).toString('base64url');
async function jwt(payload: Record<string, unknown>, kid = 'k1'): Promise<string> {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid }));
  const body = b64url(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}
const exp = () => Math.floor(Date.now() / 1000) + 600;
const userClaims = (o: Record<string, unknown> = {}) => ({ aud: [CMD_AUD], iss: TEAM, email: OWNER, sub: 'user-1', type: 'app', exp: exp(), ...o });
const svcClaims = (o: Record<string, unknown> = {}) => ({ aud: [CMD_AUD], iss: TEAM, sub: '', common_name: CLIENT, type: 'app', exp: exp(), ...o });

const SCHEMA = [
  'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
  'CREATE TABLE p365_uploads (date TEXT PRIMARY KEY, orders INTEGER NOT NULL, uploaded_by TEXT NOT NULL, uploaded_at TEXT NOT NULL);',
  'CREATE TABLE p365_orders (order_no TEXT PRIMARY KEY, date TEXT NOT NULL, total REAL NOT NULL, units INTEGER NOT NULL);',
  readFileSync(new URL('../migrations/0013_proposals.sql', import.meta.url).pathname, 'utf8'),
  readFileSync(new URL('../migrations/0055_command_sources.sql', import.meta.url).pathname, 'utf8'),
].join('\n');

function setup(extra: Partial<CommandEnv> = {}) {
  const { raw, d1 } = sqliteD1(SCHEMA);
  const env: CommandEnv = {
    DB: d1, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: MAIN_AUD, COMMAND_ACCESS_AUD: CMD_AUD,
    COMMAND_ALLOWED_EMAIL: OWNER, COMMAND_SERVICE_CLIENT_IDS: CLIENT, DISCORD_CHANNEL_ID: '200', ...extra,
  };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
  return { raw, env, ctx, pending };
}

const HOST = 'https://pkjeans-test.workers.dev';
function call(path: string, o: { method?: string; token?: string; body?: unknown; origin?: string; host?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.token) headers['Cf-Access-Jwt-Assertion'] = o.token;
  if (o.origin) headers.Origin = o.origin;
  const body = o.body === undefined ? undefined : typeof o.body === 'string' ? o.body : JSON.stringify(o.body);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(`${o.host ?? HOST}${path}`, { method: o.method ?? 'GET', headers, body });
}

const NOW = Date.parse('2026-11-15T09:10:00+07:00');
const iso = (t: number) => new Date(t).toISOString();
const freshRss = (s: ReturnType<typeof setup>, at = NOW) =>
  s.raw.prepare("INSERT INTO command_sources (source, updated_at, generated_at, data) VALUES ('rss', ?, ?, ?)")
    .run(iso(at), iso(at), JSON.stringify({ posts: [{ title: '[ทดสอบ] บทความ', url: 'https://benzarnun.com/test/', published_at: iso(at) }] }));

function job(i: number, status: string, updatedAgoMs: number, extra: Partial<Record<string, unknown>> = {}) {
  const t = new Date(NOW - updatedAgoMs + 7 * 3_600_000).toISOString().slice(0, 19) + '+0700';
  return { job_id: `job-20261115-${String(i).padStart(6, '0')}`, project: 'test-project', title: `[ทดสอบ] งาน ${i}`, status, created: t, updated: t, from: 'marcus', ...extra };
}
const snapshot = (jobs: unknown[], gen = '2026-11-15T09:05:00+07:00') => ({ schema: 1, source: 'orca-pilot', generated_at: gen, jobs });
const DAY = 86_400_000, MIN = 60_000;

// ---------- auth (spec §12.1) ----------

test('auth 1–4: command JWT + allowed email → summary 200; team email, main-app JWT → 401; command JWT cannot use the dashboard API', async () => {
  const s = setup(); freshRss(s);
  assert.equal((await commandRoute(call('/api/command/summary', { token: await jwt(userClaims()) }), s.env, s.ctx)).status, 200);
  assert.equal((await commandRoute(call('/api/command/summary', { token: await jwt(userClaims({ email: 'team@example.com' })) }), s.env, s.ctx)).status, 401);
  assert.equal((await commandRoute(call('/api/command/summary', { token: await jwt(userClaims({ aud: [MAIN_AUD] })) }), s.env, s.ctx)).status, 401);
  // The dashboard's own check still wants ACCESS_AUD: a command-app token gets nothing there.
  assert.equal(await authenticate(call('/api/me', { token: await jwt(userClaims()) }), s.env), null);
  assert.equal(await authenticate(call('/api/me', { token: await jwt(userClaims({ aud: [MAIN_AUD] })) }), s.env), OWNER);
});

test('auth: the allowlist is the secret, trimmed and case-insensitive, several allowed; empty secret = nobody', async () => {
  const s = setup({ COMMAND_ALLOWED_EMAIL: ' other@example.com , Owner@Example.com ' }); freshRss(s);
  assert.equal((await commandRoute(call('/api/command/summary', { token: await jwt(userClaims()) }), s.env, s.ctx)).status, 200);
  const e = setup({ COMMAND_ALLOWED_EMAIL: undefined });
  assert.equal((await commandRoute(call('/api/command/summary', { token: await jwt(userClaims()) }), e.env, e.ctx)).status, 401);
});

test('auth 5–6: service token → POST /jobs 200, GET /summary 403; unknown client id, wrong type, or a stranger email → 401', async () => {
  const s = setup();
  const ok = await commandRoute(call('/api/command/jobs', { method: 'POST', token: await jwt(svcClaims()), body: snapshot([]) }), s.env, s.ctx, { now: NOW });
  assert.equal(ok.status, 200);
  assert.equal((await commandRoute(call('/api/command/summary', { token: await jwt(svcClaims()) }), s.env, s.ctx)).status, 403);
  for (const c of [svcClaims({ common_name: 'other.access' }), svcClaims({ type: 'org' }), svcClaims({ sub: 'someone' }), svcClaims({ email: 'x@example.com' })]) {
    assert.equal((await commandRoute(call('/api/command/jobs', { method: 'POST', token: await jwt(c), body: snapshot([]) }), s.env, s.ctx, { now: NOW })).status, 401, JSON.stringify(c));
  }
});

test('auth 7: expired, bad signature, no header, empty COMMAND_ACCESS_AUD → 401', async () => {
  const s = setup();
  const r = async (token: string | undefined, env = s.env) => (await commandRoute(call('/api/command/summary', { token }), env, s.ctx)).status;
  assert.equal(await r(await jwt(userClaims({ exp: Math.floor(Date.now() / 1000) - 1 }))), 401);
  const [h, , sig] = (await jwt(userClaims())).split('.');
  assert.equal(await r(`${h}.${b64url(JSON.stringify(userClaims({ email: 'attacker@example.com' })))}.${sig}`), 401);
  assert.equal(await r(await jwt(userClaims(), 'k2')), 401);
  assert.equal(await r(undefined), 401);
  assert.equal(await r(await jwt(userClaims()), { ...s.env, COMMAND_ACCESS_AUD: '' }), 401);
  assert.equal(await r(await jwt(userClaims()), { ...s.env, ACCESS_TEAM_DOMAIN: undefined }), 401);
});

test('auth 8: Benz (user) POSTing /jobs → 403; cross-site Origin on POST → 403', async () => {
  const s = setup();
  assert.equal((await commandRoute(call('/api/command/jobs', { method: 'POST', token: await jwt(userClaims()), body: snapshot([]) }), s.env, s.ctx, { now: NOW })).status, 403);
  assert.equal((await commandRoute(call('/api/command/jobs', { method: 'POST', token: await jwt(svcClaims()), body: snapshot([]), origin: 'https://evil.example' }), s.env, s.ctx, { now: NOW })).status, 403);
  assert.equal((await commandRoute(call('/api/command/jobs', { method: 'POST', token: await jwt(svcClaims()), body: snapshot([]), origin: HOST }), s.env, s.ctx, { now: NOW })).status, 200);
});

test('auth 9: DEV_BYPASS_AUTH only on localhost; dev may use both endpoints and the summary says local_dev', async () => {
  const s = setup({ DEV_BYPASS_AUTH: 'true' }); freshRss(s);
  assert.equal((await commandRoute(call('/api/command/summary'), s.env, s.ctx)).status, 401);
  const res = await commandRoute(call('/api/command/summary', { host: 'http://localhost:8787' }), s.env, s.ctx, { now: NOW });
  assert.equal(res.status, 200);
  assert.equal((await res.json() as any).local_dev, true);
  assert.equal((await commandRoute(call('/api/command/jobs', { host: 'http://127.0.0.1:8787', method: 'POST', body: snapshot([]) }), s.env, s.ctx, { now: NOW })).status, 200);
  // A real user never gets the local label.
  const u = await commandRoute(call('/api/command/summary', { token: await jwt(userClaims()) }), { ...s.env, DEV_BYPASS_AUTH: undefined }, s.ctx, { now: NOW });
  assert.equal('local_dev' in (await u.json() as any), false);
});

test('auth 10 + M5: every method × path × identity', async () => {
  const s = setup(); freshRss(s);
  const user = await jwt(userClaims()), svc = await jwt(svcClaims());
  const cases: [string, string, string | undefined, number][] = [
    ['GET', '/api/command/ask', user, 404], ['POST', '/api/command/ask', svc, 404], ['GET', '/api/command/ask', undefined, 401],
    ['GET', '/api/command', user, 404], ['GET', '/api/command/', user, 404], ['GET', '/api/command/summary/', user, 404],
    ['GET', '/api/command/%2e%2e/', user, 404], ['GET', '/api/command/SUMMARY', user, 404], ['GET', '/api/command/jobs/x', svc, 404],
    ['POST', '/api/command/summary', user, 405], ['GET', '/api/command/jobs', svc, 405], ['HEAD', '/api/command/summary', user, 405],
    ['OPTIONS', '/api/command/summary', user, 405], ['PUT', '/api/command/jobs', svc, 405], ['DELETE', '/api/command/jobs', svc, 405],
    ['POST', '/api/command/summary', undefined, 401], ['GET', '/api/command/jobs', undefined, 401], ['DELETE', '/api/command/x', undefined, 401],
  ];
  for (const [method, path, token, want] of cases) {
    const res = await commandRoute(call(path, { method, token }), s.env, s.ctx, { now: NOW });
    assert.equal(res.status, want, `${method} ${path} ${token ? 'with' : 'without'} identity`);
    if (want === 405) assert.ok(res.headers.get('Allow'));
  }
});

test('auth M4: certs cannot be fetched → 401, not 500', async () => {
  const s = setup({ ACCESS_TEAM_DOMAIN: 'https://down.cloudflareaccess.com' });
  const res = await commandRoute(call('/api/command/summary', { token: await jwt(userClaims({ iss: 'https://down.cloudflareaccess.com' })) }), s.env, s.ctx);
  assert.equal(res.status, 401);
});

// ---------- snapshot (spec §12.2) ----------

const dev = { host: 'http://localhost:8787', method: 'POST' };
const devEnv = () => setup({ DEV_BYPASS_AUTH: 'true' });
const stored = (s: ReturnType<typeof setup>) => s.raw.prepare("SELECT * FROM command_sources WHERE source = 'jobs'").get() as any;

test('snapshot 1: 178 jobs → 200, read back as counts, +0700 times stored in UTC', async () => {
  const s = devEnv();
  const jobs = Array.from({ length: 178 }, (_, i) => job(i, i < 13 ? 'needs-user' : i < 110 ? 'send-failed' : i < 175 ? 'done' : i < 177 ? 'sent' : 'cancelled', i * MIN));
  const res = await commandRoute(call('/api/command/jobs', { ...dev, body: snapshot(jobs) }), s.env, s.ctx, { now: NOW });
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.stored, 178);
  const row = stored(s);
  assert.equal(row.generated_at, '2026-11-15T02:05:00.000Z');
  const d = JSON.parse(row.data);
  assert.equal(d.total, 178);
  assert.deepEqual(d.counts, { 'needs-user': 13, 'send-failed': 97, done: 65, sent: 2, cancelled: 1 });
  assert.equal(d.pool[0].updated, iso(NOW).replace(/:\d{2}\.\d{3}Z$/, ':00.000Z'));
  assert.ok(d.pool.every((j: JobMeta) => j.status !== 'send-failed'), 'send-failed is never kept for display');
});

test('snapshot 2–3: body/reason keys, bad job_id, duplicate id, status with a space, upper-case project → 400 and nothing written', async () => {
  const s = devEnv();
  const bad = [
    [{ ...job(1, 'done', 0), body: 'งานลับ' }], [{ ...job(1, 'done', 0), reason: 'x' }], [{ ...job(1, 'done', 0), job_id: 'job-1' }],
    [job(1, 'done', 0), job(1, 'done', 0)], [job(1, 'needs user', 0)], [job(1, 'done', 0, { project: 'Thai-SME' })],
  ];
  for (const jobs of bad) {
    const res = await commandRoute(call('/api/command/jobs', { ...dev, body: snapshot(jobs) }), s.env, s.ctx, { now: NOW });
    assert.equal(res.status, 400, JSON.stringify(jobs[jobs.length - 1]));
    assert.ok(((await res.json()) as any).errors.length >= 1);
  }
  assert.equal((await commandRoute(call('/api/command/jobs', { ...dev, body: '{not json' }), s.env, s.ctx, { now: NOW })).status, 400);
  assert.equal((await commandRoute(call('/api/command/jobs', { ...dev, body: { ...snapshot([]), extra: 1 } }), s.env, s.ctx, { now: NOW })).status, 400);
  assert.equal(stored(s), undefined);
});

test('snapshot 4: 1001 jobs → 400; body over 256 KB → 413 (by Content-Length and by real length)', async () => {
  const s = devEnv();
  const many = Array.from({ length: 1001 }, (_, i) => job(i, 'done', 0, { title: null }));
  assert.equal((await commandRoute(call('/api/command/jobs', { ...dev, body: snapshot(many) }), s.env, s.ctx, { now: NOW })).status, 400);
  const big = JSON.stringify(snapshot([job(1, 'done', 0, { title: 'x'.repeat(300_000) })]));
  assert.equal((await commandRoute(call('/api/command/jobs', { ...dev, body: big }), s.env, s.ctx, { now: NOW })).status, 413);
  const lying = call('/api/command/jobs', { ...dev, body: big, headers: { 'Content-Length': '10' } });
  assert.equal((await commandRoute(lying, s.env, s.ctx, { now: NOW })).status, 413);
  assert.equal((await commandRoute(call('/api/command/jobs', { ...dev, body: '{}', headers: { 'Content-Length': '300000' } }), s.env, s.ctx, { now: NOW })).status, 413);
});

test('snapshot 5 + M2: older by > 15 min → 409 and nothing changes; ≤ 15 min older (clock skew) → 200; compared as instants across offsets; 11 min in the future → 400', async () => {
  const s = devEnv();
  const post = (gen: string, jobs: unknown[] = []) => commandRoute(call('/api/command/jobs', { ...dev, body: snapshot(jobs, gen) }), s.env, s.ctx, { now: NOW });
  assert.equal((await post('2026-11-15T09:05:00+07:00', [job(1, 'done', 0)])).status, 200);
  assert.equal((await post('2026-11-15T01:49:59Z')).status, 409);           // 15:01 older, written as Z
  assert.equal(JSON.parse(stored(s).data).total, 1);
  assert.equal((await post('2026-11-15T08:50:00+0700')).status, 200);       // exactly 15 min older: accepted
  assert.equal(JSON.parse(stored(s).data).total, 0);
  assert.equal((await post('2026-11-15T09:05:00+07:00')).status, 200);       // same instant again
  assert.equal((await post('2026-11-15T02:21:00Z')).status, 400);           // 11 min ahead of NOW (02:10Z)
});

test('snapshot 6: jobs [] → 200 (a machine with no jobs is real data, not "not connected")', async () => {
  const s = devEnv(); freshRss(s);
  assert.equal((await commandRoute(call('/api/command/jobs', { ...dev, body: snapshot([]) }), s.env, s.ctx, { now: NOW })).status, 200);
  const sum = await (await commandRoute(call('/api/command/summary', { host: 'http://localhost:8787' }), s.env, s.ctx, { now: NOW })).json() as any;
  assert.equal(sum.team.status, 'ok');
  assert.equal(sum.team.data.total, 0);
  assert.equal(sum.todo.parts.jobs, 'ok');
});

test('snapshot Q2: title optional, ≤ 120 chars, no control characters; null project allowed', () => {
  const v = (j: unknown) => validateSnapshot(snapshot([j]), NOW).ok;
  assert.equal(v(job(1, 'done', 0, { title: 'ก'.repeat(120) })), true);
  assert.equal(v(job(1, 'done', 0, { title: 'ก'.repeat(121) })), false);
  assert.equal(v(job(1, 'done', 0, { title: 'บรรทัด\nสอง' })), false);
  assert.equal(v(job(1, 'done', 0, { title: '   ' })), false);
  assert.equal(v(job(1, 'done', 0, { title: 7 })), false);
  const noTitle: Record<string, unknown> = job(1, 'done', 0, { project: null, created: null }); delete noTitle.title;
  assert.equal(v(noTitle), true);
  assert.equal(v({ job_id: 'job-20261115-000001', status: 'done' }), false, 'updated is required');
});

test('snapshot M7: digesting 1000 jobs stays fast and keeps a small pool', () => {
  const jobs = Array.from({ length: 1000 }, (_, i) => job(i, ['done', 'send-failed', 'needs-user', 'sent', 'failed'][i % 5], i * 30 * MIN));
  const t0 = performance.now();
  const v = validateSnapshot(snapshot(jobs), NOW);
  assert.ok(v.ok);
  const d = digestJobs(v.snapshot.jobs, NOW);
  const team = teamFromDigest(d, iso(NOW), NOW);
  const ms = performance.now() - t0;
  assert.ok(ms < 50, `took ${ms.toFixed(1)} ms`);
  assert.ok(d.pool.length <= 400);
  assert.ok(team.rows.length <= 25);
});

// ---------- business tiles (spec §12.3) ----------

async function summary(s: ReturnType<typeof setup>, now = NOW) {
  const res = await commandRoute(call('/api/command/summary', { host: 'http://localhost:8787' }), { ...s.env, DEV_BYPASS_AUTH: 'true' }, s.ctx, { now });
  assert.equal(res.status, 200);
  return res.json() as Promise<any>;
}
const tile = (sum: any, id: string) => sum.business.tiles.find((t: any) => t.id === id);

test('tiles 1 + m9: no Page365 file for yesterday → missing, data null, link /#sales; with fresh RSS cached nothing is fetched (no Meta)', async () => {
  const s = setup(); freshRss(s);
  calls.length = 0;
  const sum = await summary(s);
  const t = tile(sum, 'pk_sales_yesterday');
  assert.equal(t.status, 'missing');
  assert.equal(t.data, null);
  assert.equal(t.link, '/#sales');
  assert.deepEqual(calls, []);
  assert.equal(s.pending.length, 0);
});

test('tiles 2: an uploaded file with 0 orders → ok with revenue 0 (a real empty day, unlike no file)', async () => {
  const s = setup(); freshRss(s);
  s.raw.prepare("INSERT INTO p365_uploads VALUES ('2026-11-14', 0, 'staff@example.com', '2026-11-15T01:00:00.000Z')").run();
  const t = tile(await summary(s), 'pk_sales_yesterday');
  assert.equal(t.status, 'ok');
  assert.deepEqual(t.data, { date: '2026-11-14', revenue: 0, orders: 0, units: 0, uploaded_at: '2026-11-15T01:00:00.000Z' });
});

test('tiles 3: YTD is cached by upload signature; a new upload recomputes; nothing uploaded → missing', async () => {
  const s = setup(); freshRss(s);
  assert.equal(tile(await summary(s), 'pk_ytd').status, 'missing');
  s.raw.prepare("INSERT INTO p365_uploads VALUES ('2026-11-13', 1, 'staff@example.com', '2026-11-14T01:00:00.000Z')").run();
  s.raw.prepare("INSERT INTO p365_orders VALUES ('T1', '2026-11-13', 1000, 1)").run();
  const a = tile(await summary(s), 'pk_ytd');
  assert.equal(a.status, 'ok');
  assert.equal(a.data.revenue, 1000);
  assert.equal(a.data.target, 100_000_000);
  assert.equal(a.data.uploaded_days, 1);
  assert.match(a.source, /\(1\/318 วัน\)/);
  // Same signature: an order sneaked in without a new upload row is not picked up, proving the cache was used.
  s.raw.prepare("INSERT INTO p365_orders VALUES ('T2', '2026-11-13', 500, 1)").run();
  assert.equal(tile(await summary(s), 'pk_ytd').data.revenue, 1000);
  s.raw.prepare("INSERT INTO p365_uploads VALUES ('2026-11-14', 0, 'staff@example.com', '2026-11-15T01:00:00.000Z')").run();
  const b = tile(await summary(s), 'pk_ytd');
  assert.equal(b.data.revenue, 1500);
  assert.equal(b.data.uploaded_days, 2);
  assert.equal(b.as_of, '2026-11-15T01:00:00.000Z');
});

test('tiles 4: Focus Club countdown in Bangkok days', () => {
  assert.equal(countdown(NOW).days_left, 16);
  const last = countdown(Date.parse('2026-11-30T23:59:59+07:00'));
  assert.equal(last.days_left, 1);
  assert.equal(last.seconds_left, 1);
  assert.equal(last.passed, false);
  const open = countdown(Date.parse('2026-12-01T00:00:00+07:00'));
  assert.deepEqual([open.days_left, open.seconds_left, open.passed], [0, 0, true]);
});

test('tiles 5–6: unconnected tiles are null (never 0); every tile has a source and an as_of key; non-ok tiles carry no data', async () => {
  const s = setup(); freshRss(s);
  const sum = await summary(s);
  for (const id of ['focus_club_members', 'classroom_students']) {
    const t = tile(sum, id);
    assert.equal(t.status, 'not_connected');
    assert.equal(t.data, null);
    assert.equal(t.as_of, null);
    assert.ok(t.source.startsWith('ยังไม่เชื่อม'));
  }
  for (const t of [...sum.business.tiles, sum.team]) {
    assert.ok(typeof t.source === 'string' && t.source.length > 0, t.id);
    assert.ok('as_of' in t, t.id);
    if (!['ok', 'stale'].includes(t.status)) assert.equal(t.data, null, t.id);
    if (['not_connected', 'error'].includes(t.status)) assert.equal(t.as_of, null, t.id);
  }
});

test('tiles 7: one broken source → that part is error, the rest still answers 200', async () => {
  const s = setup(); freshRss(s);
  s.raw.exec('DROP TABLE proposals; DROP TABLE p365_orders;');
  const sum = await summary(s);
  assert.equal(tile(sum, 'pk_sales_yesterday').status, 'error');
  assert.equal(tile(sum, 'pk_sales_yesterday').data, null);
  assert.equal(tile(sum, 'focus_club_countdown').status, 'ok');
  assert.equal(tile(sum, 'blog_latest').status, 'ok');
  assert.equal(sum.todo.parts.proposals, 'error');
  assert.equal(sum.todo.parts.p365, 'error');
});

test('tiles 8: the response has exactly the agreed keys and no uploader or email anywhere', async () => {
  const s = setup(); freshRss(s);
  s.raw.prepare("INSERT INTO p365_uploads VALUES ('2026-11-14', 1, 'staff@example.com', '2026-11-15T01:00:00.000Z')").run();
  s.raw.prepare("INSERT INTO p365_orders VALUES ('T1', '2026-11-14', 1000, 2)").run();
  const sum = await summary(s);
  const { local_dev, ...rest } = sum;
  assert.equal(local_dev, true);
  assert.deepEqual(Object.keys(rest).sort(), ['business', 'generated_at', 'team', 'timezone', 'today', 'todo', 'version']);
  assert.deepEqual(Object.keys(sum.todo).sort(), ['as_of', 'items', 'more', 'older_needs_user', 'parts', 'source']);
  assert.deepEqual(sum.business.tiles.map((t: any) => t.id), ['pk_sales_yesterday', 'pk_ytd', 'focus_club_members', 'focus_club_countdown', 'classroom_students', 'blog_latest']);
  const text = JSON.stringify(sum);
  assert.ok(!text.includes('uploaded_by'));
  assert.ok(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(text), 'no email address in the summary');
});

test('tiles 9 + m10: 00:30 Bangkok is still the previous UTC day but yesterday is the Bangkok one; on 1 Jan YTD is last year', async () => {
  const s = setup(); freshRss(s, Date.parse('2027-01-01T00:30:00+07:00'));
  const sum = await summary(s, Date.parse('2026-11-16T00:30:00+07:00'));
  assert.equal(sum.today, '2026-11-16');
  assert.match(tile(sum, 'pk_sales_yesterday').source, /15 พ\.ย\./);
  s.raw.prepare("INSERT INTO p365_uploads VALUES ('2026-12-31', 1, 'staff@example.com', '2027-01-01T00:00:00.000Z')").run();
  s.raw.prepare("INSERT INTO p365_orders VALUES ('T9', '2026-12-31', 2000, 1)").run();
  const ny = tile(await summary(s, Date.parse('2027-01-01T00:30:00+07:00')), 'pk_ytd');
  assert.equal(ny.data.year, '2026');
  assert.equal(ny.data.days_elapsed, 365);
});

// ---------- RSS (spec §12.4) ----------

const item = (n: number, link = `https://benzarnun.com/post-${n}/`, title = `<![CDATA[[ทดสอบ] เรื่อง ${n}]]>`) =>
  `<item><title>${title}</title><link>${link}</link><pubDate>Sun, 15 Nov 2026 0${n % 10}:00:00 +0000</pubDate><content:encoded><![CDATA[${'x'.repeat(1000)}]]></content:encoded></item>`;
const feed = (items: string[]) => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items.join('')}</channel></rss>`;

test('rss 1: CDATA, &amp; and &#8211; decode', () => {
  const posts = parseRss(feed([item(1), item(2, undefined, 'A &amp; B &#8211; C'), item(3, undefined, 'x &#x2014; y &lt;b&gt;')]));
  assert.deepEqual(posts.map((p) => p.title), ['[ทดสอบ] เรื่อง 1', 'A & B – C', 'x — y <b>']);
  assert.equal(posts[0].published_at, '2026-11-15T01:00:00.000Z');
});

test('rss 2: reading stops after the 3rd item (counted in chunks)', async () => {
  const chunks = feed(Array.from({ length: 10 }, (_, i) => item(i))).match(/[\s\S]{1,500}/g)!;
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({ pull(c) { if (pulled >= chunks.length) return c.close(); c.enqueue(new TextEncoder().encode(chunks[pulled++])); } });
  const posts = await fetchFeed((async () => new Response(body)) as unknown as typeof fetch);
  assert.equal(posts.length, 3);
  assert.ok(pulled < chunks.length / 2, `read ${pulled} of ${chunks.length} chunks`);
});

test('rss 3: 30-min cache → no fetch; 2 h → old posts ok + refresh in waitUntil; 30 h + failing fetch → stale with the error noted', async () => {
  const s = setup();
  freshRss(s, NOW - 30 * MIN);
  calls.length = 0;
  assert.equal(tile(await summary(s), 'blog_latest').status, 'ok');
  assert.deepEqual(calls, []);

  const s2 = setup(); freshRss(s2, NOW - 2 * 3_600_000);
  rss = async () => new Response(feed([item(5)]));
  const t2 = tile(await summary(s2), 'blog_latest');
  assert.equal(t2.status, 'ok');
  assert.equal(t2.data.posts[0].title, '[ทดสอบ] บทความ');
  assert.equal(s2.pending.length, 1);
  await Promise.all(s2.pending);
  const row = s2.raw.prepare("SELECT * FROM command_sources WHERE source = 'rss'").get() as any;
  assert.equal(JSON.parse(row.data).posts[0].title, '[ทดสอบ] เรื่อง 5');

  const s3 = setup(); freshRss(s3, NOW - 30 * 3_600_000);
  rss = async () => new Response('busy', { status: 503 });
  const t3 = tile(await summary(s3), 'blog_latest');
  assert.equal(t3.status, 'stale');
  assert.ok(t3.data.posts.length);
  await Promise.all(s3.pending.map((p) => p.catch(() => null)));
  const t3b = tile(await summary(s3), 'blog_latest');
  assert.equal(t3b.status, 'stale');
  assert.match(t3b.note, /503/);
  assert.equal(s3.pending.length, 1, 'a failed refresh waits an hour before trying again');
  rss = async () => { throw new Error('no network in tests'); };
});

test('rss 4: no cache and the fetch times out → error, data null', async () => {
  const s = setup();
  rss = async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };
  const t = tile(await summary(s), 'blog_latest');
  assert.equal(t.status, 'error');
  assert.equal(t.data, null);
  assert.equal(t.as_of, null);
  assert.match(t.note, /timeout/);
  rss = async () => { throw new Error('no network in tests'); };
});

test('rss 5: links not on https://benzarnun.com/ are dropped (prefix tricks, user@host, backslash, http)', () => {
  assert.equal(blogUrl('https://benzarnun.com.evil.tld/x'), null);
  assert.equal(blogUrl('https://benzarnun.com@evil.tld/'), null);
  assert.equal(blogUrl('http://benzarnun.com/x'), null);
  assert.equal(blogUrl('javascript:alert(1)'), null);
  assert.equal(blogUrl('https://benzarnun.com/a\\@evil.tld'), 'https://benzarnun.com/a/@evil.tld');
  const posts = parseRss(feed([item(1, 'https://evil.tld/'), item(2, 'https://benzarnun.com.evil.tld/'), item(3)]));
  assert.deepEqual(posts.map((p) => p.url), ['https://benzarnun.com/post-3/']);
});

// ---------- team + todo (spec §12.5) ----------

async function pushJobs(s: ReturnType<typeof setup>, jobs: unknown[], receivedAt = NOW) {
  const res = await commandRoute(call('/api/command/jobs', { ...dev, body: snapshot(jobs, iso(receivedAt - MIN)) }), { ...s.env, DEV_BYPASS_AUTH: 'true' }, s.ctx, { now: receivedAt });
  assert.equal(res.status, 200);
}

test('team 1: no snapshot → team not_connected and todo says jobs are not connected (not "nothing to do")', async () => {
  const s = setup(); freshRss(s);
  const sum = await summary(s);
  assert.equal(sum.team.status, 'not_connected');
  assert.equal(sum.team.data, null);
  assert.equal(sum.todo.parts.jobs, 'not_connected');
  assert.equal(sum.todo.older_needs_user, null);
});

test('team 2 + m10: received 24:59 ago → ok, 25:01 → stale with data', async () => {
  const s = setup(); freshRss(s, NOW + 30 * MIN);
  await pushJobs(s, [job(1, 'sent', 0)]);
  assert.equal((await summary(s, NOW + 24 * MIN + 59_000)).team.status, 'ok');
  const late = await summary(s, NOW + 25 * MIN + 1000);
  assert.equal(late.team.status, 'stale');
  assert.equal(late.team.data.groups.working, 1);
});

test('team 3 + D1: the real shape (13 needs-user mostly old, 97 send-failed) → todo lists only ≤ 7-day ones, the rest is a number', async () => {
  const s = setup(); freshRss(s);
  const jobs = [
    ...Array.from({ length: 3 }, (_, i) => job(i, 'needs-user', (i + 1) * 3_600_000)),
    ...Array.from({ length: 10 }, (_, i) => job(100 + i, 'needs-user', (20 + i) * DAY)),
    ...Array.from({ length: 97 }, (_, i) => job(200 + i, 'send-failed', i * 3_600_000)),
    job(400, 'failed', 8 * DAY), job(401, 'failed', DAY),
    ...Array.from({ length: 65 }, (_, i) => job(500 + i, 'done', i < 4 ? i * MIN : (2 + i) * DAY)),
    job(600, 'sent', 40 * DAY), job(601, 'sent', MIN), job(700, 'cancelled', DAY), job(701, 'parked', DAY),
  ];
  await pushJobs(s, jobs);
  const sum = await summary(s);
  const g = sum.team.data.groups;
  assert.deepEqual(g, { done_today: 4, needs_user: 3, needs_user_old: 10, stuck: 1, working: 2, send_failed: 97, cancelled: 1, other: 1 });
  const rows = sum.team.data.rows;
  assert.ok(rows.every((r: JobMeta) => r.status !== 'send-failed' && r.status !== 'cancelled'));
  assert.equal(rows.filter((r: JobMeta) => r.status === 'needs-user').length, 3);
  assert.equal(rows.filter((r: JobMeta) => r.status !== 'needs-user').length, 5);
  assert.ok(!rows.some((r: JobMeta) => r.job_id.endsWith('000400')), 'failed 8 days ago is not listed');
  const jobItems = sum.todo.items.filter((i: any) => i.kind === 'job_needs_user');
  assert.equal(jobItems.length, 3);
  assert.equal(jobItems[0].title, 'ตัดสิน: [ทดสอบ] งาน 0');
  assert.equal(jobItems[0].link, '/command#job-job-20261115-000000');
  assert.equal(sum.todo.older_needs_user, 10);
});

test('team: a job without a title shows "งาน <project>"', () => {
  const d = digestJobs([{ job_id: 'job-20261115-000001', project: null, title: null, status: 'needs-user', created: null, updated: iso(NOW), from: null }], NOW);
  assert.equal(teamFromDigest(d, iso(NOW), NOW).rows.length, 1);
});

test('todo 4 + M6: every pending proposal kind, not working/expired; Discord link only with DISCORD_GUILD_ID', async () => {
  const add = (s: ReturnType<typeof setup>, id: string, kind: string, status: string, msg: string | null) =>
    s.raw.prepare("INSERT INTO proposals (id, created_at, kind, entity_id, entity_name, rule_id, plan, detail, status, message_id) VALUES (?, ?, ?, 'e', '[ทดสอบ] แคมเปญ', 'r', 'p', '{}', ?, ?)")
      .run(id, iso(NOW - Number(id.slice(1)) * MIN), kind, status, msg);
  const seed = (s: ReturnType<typeof setup>) => { add(s, 'p1', 'pause', 'pending', '900'); add(s, 'p2', 'move', 'pending', null); add(s, 'p3', 'cap', 'pending', '901'); add(s, 'p4', 'dup', 'pending', '902'); add(s, 'p5', 'pause', 'working', '903'); add(s, 'p6', 'pause', 'expired', '904'); };
  const s = setup({ DISCORD_GUILD_ID: '100' }); freshRss(s); seed(s);
  const items = (await summary(s)).todo.items;
  assert.deepEqual(items.map((i: any) => i.ref), ['p1', 'p2', 'p3', 'p4']);
  assert.deepEqual(items.map((i: any) => i.title.split(':')[0]), ['หยุดแคมเปญ', 'ย้ายสเตจ', 'ขยายเพดานงบ', 'คัดลอกแคมเปญ']);
  assert.equal(items[0].link, 'https://discord.com/channels/100/200/900');
  assert.equal(items[1].link, '/#history');
  const n = setup(); freshRss(n); seed(n);
  assert.ok((await summary(n)).todo.items.every((i: any) => i.link === '/#history'));
});

test('todo 5 + D2: the missing Page365 line shows only from 10:00 Bangkok; every item has a link; order p365 → proposal → job', async () => {
  const s = setup(); freshRss(s, NOW + DAY);
  s.raw.prepare("INSERT INTO proposals (id, created_at, kind, entity_id, entity_name, rule_id, plan, detail, status) VALUES ('p1', ?, 'pause', 'e', '[ทดสอบ] แคมเปญ', 'r', 'p', '{}', 'pending')").run(iso(NOW));
  await pushJobs(s, [job(1, 'needs-user', MIN)]);
  const before = await summary(s, Date.parse('2026-11-15T09:59:59+07:00'));
  assert.equal(before.todo.items.some((i: any) => i.kind === 'p365_missing'), false);
  const after = await summary(s, Date.parse('2026-11-15T10:00:00+07:00'));
  assert.deepEqual(after.todo.items.map((i: any) => i.kind), ['p365_missing', 'proposal', 'job_needs_user']);
  assert.equal(after.todo.items[0].since, '2026-11-14T17:00:00.000Z');
  assert.ok(after.todo.items.every((i: any) => typeof i.link === 'string' && i.link.length > 0));
});

// ---------- the Worker entry (review MJ1): /api/command/* must reach commandRoute before the dashboard's authenticate() ----------

test('worker entry: command JWT → /api/command/summary 200; main-app JWT → Command 401; command JWT on the dashboard API → 401', async () => {
  const worker = (await import('./index.ts')).default;
  const s = setup(); freshRss(s, Date.now());
  const env = s.env as unknown as Parameters<typeof worker.fetch>[1];
  const ctx = s.ctx as unknown as ExecutionContext;
  const res = await worker.fetch(call('/api/command/summary', { token: await jwt(userClaims()) }), env, ctx);
  assert.equal(res.status, 200);
  assert.equal((await res.json() as { version: number }).version, 1);
  // The main app's token is valid for authenticate() but not for Command; the answer must be Command's own 401.
  const main = await worker.fetch(call('/api/command/summary', { token: await jwt(userClaims({ aud: [MAIN_AUD] })) }), env, ctx);
  assert.equal(main.status, 401);
  assert.equal((await main.json() as { error: string }).error, 'ต้องล็อกอินผ่าน Cloudflare Access (Command)');
  // A Command token opens nothing on the existing dashboard API.
  for (const path of ['/api/goal', '/api/me']) {
    const r = await worker.fetch(call(path, { token: await jwt(userClaims()) }), env, ctx);
    assert.equal(r.status, 401, path);
    assert.equal((await r.json() as { error: string }).error, 'ต้องล็อกอินผ่าน Cloudflare Access', path);
  }
});
