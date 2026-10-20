import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockedByKillSwitch, expireOld, proposalMessage, verifyDiscord } from './discord.ts';
import { sqliteD1 } from './sqliteD1.ts';

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
  assert.match(m.content, /อูนิ/);
  assert.match(m.content, /หยุดแคมเปญ/);
});

test('the Monday cap check closes only old cap questions; the 08:00 run\'s pause/move questions stay open', async () => {
  const { raw, d1 } = sqliteD1(`CREATE TABLE proposals (id TEXT PRIMARY KEY, created_at TEXT, kind TEXT, entity_id TEXT, entity_name TEXT, rule_id TEXT, plan TEXT,
    detail TEXT, status TEXT, decided_by TEXT, decided_at TEXT, message_id TEXT)`);
  const add = (id: string, kind: string, at: string) => raw.prepare(`INSERT INTO proposals (id, created_at, kind, entity_id, entity_name, rule_id, plan, detail, status)
    VALUES (?, ?, ?, 'c', 'C', 'r', '', '{}', 'pending')`).run(id, at, kind);
  add('pause-0800', 'pause', '2026-10-19T01:00:00.000Z'); // posted by the 08:00 run a few seconds earlier
  add('move-0800', 'move', '2026-10-19T01:00:01.000Z');
  add('cap-old', 'cap', '2026-10-12T01:00:00.000Z');       // last Monday's, over 6 days old
  const env = { DB: d1 } as any;
  await expireOld(env, '2026-10-19T01:00:30.000Z', { capOnly: true });
  const status = (id: string) => (raw.prepare('SELECT status FROM proposals WHERE id = ?').get(id) as any).status;
  assert.equal(status('pause-0800'), 'pending');
  assert.equal(status('move-0800'), 'pending');
  assert.equal(status('cap-old'), 'expired');
  // The next run (no capOnly) still closes what it is about to ask again.
  await expireOld(env, '2026-10-19T13:00:00.000Z');
  assert.equal(status('pause-0800'), 'expired');
});

test('kill switch blocks presses that touch Meta or the spend cap, not moves or "no"', () => {
  assert.equal(blockedByKillSwitch('approve', 'pause'), true);
  assert.equal(blockedByKillSwitch('approve', 'dup'), true);
  assert.equal(blockedByKillSwitch('approve', 'cap'), true);
  assert.equal(blockedByKillSwitch('approve', 'move'), false);
  assert.equal(blockedByKillSwitch('reject', 'pause'), false);
  assert.equal(blockedByKillSwitch('totesting', 'pause'), false);
});
