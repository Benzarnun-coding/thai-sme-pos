import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proposalMessage, verifyDiscord } from './discord.ts';

test('Discord signatures are checked with the app key', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const pub = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('hex');
  const body = '{"type":1}', ts = '1791900000';
  const sig = Buffer.from(await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(ts + body))).toString('hex');
  const req = (s: string) => new Request('https://x/webhook/discord', { method: 'POST', headers: { 'X-Signature-Ed25519': s, 'X-Signature-Timestamp': ts } });
  assert.equal(await verifyDiscord(req(sig), body, pub), true);
  assert.equal(await verifyDiscord(req(sig), body + ' ', pub), false);
  assert.equal(await verifyDiscord(req('00'.repeat(64)), body, pub), false);
});

test('a pause question carries approve / not now / move-to-testing buttons', () => {
  const m = proposalMessage({ id: 'p1', created_at: '', kind: 'pause', entity_id: '1', entity_name: 'REV 801', rule_id: 're-stop', plan: 'PAUSE campaign "REV 801" [last_7d roas=2.54 vs 2.78]', detail: '{}', status: 'pending', decided_by: null, decided_at: null, message_id: null });
  const ids = (m.components[0] as any).components.map((c: any) => c.custom_id);
  assert.deepEqual(ids, ['approve:p1', 'reject:p1', 'totesting:p1']);
  assert.match(m.content, /น้องจิบิ/);
  assert.match(m.content, /หยุดแคมเปญ/);
});
