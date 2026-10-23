import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { docIdFrom, docText, writeDoc } from './botKbDoc.ts';
import type { KbItem } from './botKb.ts';

const item = (id: number, status: KbItem['status'], rule: string | null = null): KbItem => ({
  id, created_at: '', kind: 'fix', question: `q${id}`, answer: `a${id}`, rule, why: null, evidence: null, status,
  decided_by: null, decided_at: null, applied_at: null, message_id: null,
});

test('docIdFrom takes a pasted link or a bare id', () => {
  assert.equal(docIdFrom('https://docs.google.com/document/d/1XAbndOMtVUlkpya53mExwDn9OuT61Ac_uvSg_BK3o7o/edit?usp=sharing'), '1XAbndOMtVUlkpya53mExwDn9OuT61Ac_uvSg_BK3o7o');
  assert.equal(docIdFrom(' 1XAbndOMtVUlkpya53mExwDn9OuT61Ac_uvSg_BK3o7o '), '1XAbndOMtVUlkpya53mExwDn9OuT61Ac_uvSg_BK3o7o');
  assert.equal(docIdFrom('https://example.com'), '');
});

test('the Doc holds approved + applied answers only, oldest first, rules on top', () => {
  const t = docText([item(3, 'approved'), item(1, 'applied', 'ไม่ให้ส่วนลด'), item(2, 'rejected'), item(4, 'proposed')], '23 ต.ค. 2569');
  assert.equal(t, 'ข้อมูลร้าน PkJeans สำหรับตอบแชทลูกค้า (อัปเดต 23 ต.ค. 2569)\n\nกฎ:\n- ไม่ให้ส่วนลด\n\nถาม: q1\nตอบ: a1\n\nถาม: q3\nตอบ: a3\n');
  assert.match(docText([], 'x'), /ยังไม่มีคำตอบ/);
});

test('writeDoc signs a service-account token, clears the body and inserts the text', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = JSON.stringify({ client_email: 'kb@x.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const db = { prepare: () => ({ first: async () => JSON.stringify({ doc_id: 'DOC', live: true }) }) } as unknown as D1Database;
  const calls: { url: string; body?: string }[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? String(init.body) : undefined });
    if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'T' }));
    if (String(url).endsWith(':batchUpdate')) return new Response('{}');
    return new Response(JSON.stringify({ body: { content: [{ endIndex: 1 }, { endIndex: 40 }] } }));
  }) as typeof fetch;
  try { await writeDoc({ DB: db, GOOGLE_SA_KEY: key }, 'hello\n'); } finally { globalThis.fetch = orig; }
  const jwt = new URLSearchParams(calls[0].body).get('assertion')!;
  assert.equal(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).iss, 'kb@x.iam.gserviceaccount.com');
  assert.deepEqual(JSON.parse(calls[2].body!).requests, [
    { deleteContentRange: { range: { startIndex: 1, endIndex: 39 } } },
    { insertText: { location: { index: 1 }, text: 'hello' } },
  ]);
});
