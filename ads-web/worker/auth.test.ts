import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate } from './auth.ts';

const TEAM = 'https://pkjeans.cloudflareaccess.com';
const AUD = 'aud-123';

const { publicKey, privateKey } = (await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
)) as CryptoKeyPair;
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1' };
globalThis.fetch = (async () => new Response(JSON.stringify({ keys: [jwk] }))) as typeof fetch;

const b64url = (b: Uint8Array | string) =>
  Buffer.from(typeof b === 'string' ? new TextEncoder().encode(b) : b).toString('base64url');

async function token(payload: Record<string, unknown>, kid = 'k1'): Promise<string> {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid }));
  const body = b64url(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}
const req = (jwt?: string) => new Request('https://x.workers.dev/api/me', { headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {} });
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
const good = { aud: [AUD], iss: TEAM, email: 'benz@example.com', exp: Math.floor(Date.now() / 1000) + 600 };

test('valid Access token → email', async () => {
  assert.equal(await authenticate(req(await token(good)), env), 'benz@example.com');
});

test('refuses missing, expired, wrong audience, wrong issuer, unknown key and tampered tokens', async () => {
  assert.equal(await authenticate(req(), env), null);
  assert.equal(await authenticate(req(await token({ ...good, exp: Math.floor(Date.now() / 1000) - 1 })), env), null);
  assert.equal(await authenticate(req(await token({ ...good, aud: ['other'] })), env), null);
  assert.equal(await authenticate(req(await token({ ...good, iss: 'https://evil.cloudflareaccess.com' })), env), null);
  assert.equal(await authenticate(req(await token(good, 'k2')), env), null);
  const [h, , s] = (await token(good)).split('.');
  const forged = b64url(JSON.stringify({ ...good, email: 'attacker@example.com' }));
  assert.equal(await authenticate(req(`${h}.${forged}.${s}`), env), null);
});

test('fails closed when Access is not configured; dev bypass only on localhost', async () => {
  assert.equal(await authenticate(req(await token(good)), {}), null);
  assert.equal(await authenticate(req(), { DEV_BYPASS_AUTH: 'true' }), null);
  assert.equal(await authenticate(new Request('http://localhost:8787/api/me'), { DEV_BYPASS_AUTH: 'true' }), 'dev@localhost');
});
