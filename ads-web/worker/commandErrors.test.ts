import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_EXPIRED, summaryError, thrownError } from '../web/src/commandErrors.ts';

// What /command shows when loading /api/command/summary fails (web/src/CommandPage.tsx). The Worker side of the
// signal (an expired command JWT → 401) is in command.test.ts: "auth 7" and "worker entry: bare /api/command …".

// Read the body the way the page does: res.json(), null when it isn't JSON.
const bodyOf = (res: Response) => res.json().catch(() => null);
const expired = (msg: string | null) => msg !== null && msg.startsWith(SESSION_EXPIRED);

test('session expired: Worker 401 → the session message, even with a JSON error body', async () => {
  const res = new Response(JSON.stringify({ error: 'ต้องล็อกอินผ่าน Cloudflare Access (Command)' }), { status: 401 });
  assert.equal(summaryError(res, await bodyOf(res)), SESSION_EXPIRED);
});

test('session expired: a redirected response (to the Access login at cloudflareaccess.com) → the session message', () => {
  // `redirected` and `url` can't be set on new Response(), so this is the shape fetch() hands back after following it.
  const res = { status: 200, ok: true, redirected: true, url: 'https://team.cloudflareaccess.com/cdn-cgi/access/login/example.com' };
  assert.equal(summaryError(res, { version: 1 }), SESSION_EXPIRED);
  assert.equal(summaryError({ ...res, ok: false, status: 302 }, null), SESSION_EXPIRED);
});

test('session expired: 200 with HTML (Access login page) instead of JSON → the session message', async () => {
  const res = new Response('<!doctype html><html><title>Sign in ・ Cloudflare Access</title></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  const body = await bodyOf(res);
  assert.equal(body, null);
  assert.equal(summaryError(res, body), SESSION_EXPIRED);
});

test('session expired: fetch throws TypeError (cross-site redirect blocked) → the session message, internet named as the other cause', async () => {
  const failingFetch = async () => { throw new TypeError('Failed to fetch'); };
  const e = await failingFetch().catch((x: unknown) => x);
  assert.equal(thrownError(e), `${SESSION_EXPIRED} (หรืออินเทอร์เน็ตหลุด)`);
  // The page throws summaryError's message as a plain Error; it comes out unchanged.
  assert.equal(thrownError(new Error(SESSION_EXPIRED)), SESSION_EXPIRED);
});

test('not expired: 500, 403, wrong version, other thrown errors → their own message; a good summary → null', async () => {
  const r500 = new Response(JSON.stringify({ error: 'D1 down' }), { status: 500 });
  assert.equal(summaryError(r500, await bodyOf(r500)), 'D1 down');
  const r500html = new Response('Internal Server Error', { status: 500 });
  assert.equal(summaryError(r500html, await bodyOf(r500html)), 'HTTP 500');
  const r403 = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  assert.equal(summaryError(r403, await bodyOf(r403)), 'forbidden');
  const old = new Response(JSON.stringify({ version: 2 }), { status: 200 });
  assert.equal(summaryError(old, await bodyOf(old)), 'HTTP 200');
  for (const msg of [summaryError(r500, { error: 'D1 down' }), thrownError(new Error('boom')), thrownError(new RangeError('x')), thrownError('plain')]) {
    assert.ok(!expired(msg), String(msg));
  }
  const ok = new Response(JSON.stringify({ version: 1 }), { status: 200 });
  assert.equal(summaryError(ok, await bodyOf(ok)), null);
});
