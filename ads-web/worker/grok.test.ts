import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyOk, parseProposal, playbookText } from './grok.ts';

test('key: closed without a long enough secret; exact match only', () => {
  assert.equal(keyOk('x', undefined), false);
  assert.equal(keyOk('short', 'short'), false);
  const k = 'abcdefghijklmnop1234';
  assert.equal(keyOk(k, k), true);
  assert.equal(keyOk(k.slice(0, -1) + 'X', k), false);
  assert.equal(keyOk(null, k), false);
  assert.equal(keyOk(k + 'x', k), false);
});

test('a draft needs the playbook and findings that each say where they came from', () => {
  assert.match(parseProposal({}) as string, /playbook/);
  assert.match(parseProposal({ playbook: 'คู่มือ' }) as string, /findings/);
  assert.match(parseProposal({ playbook: 'คู่มือ', findings: [{ point: 'บรรทัดแรกบอกราคา' }] }) as string, /evidence/);
  const ok = parseProposal({ playbook: '  คู่มือ\r\n', findings: [{ point: 'บรรทัดแรกบอกราคา', evidence: 'https://fb.com/p/1' }, { point: '' }] });
  assert.deepEqual(ok, { playbook: 'คู่มือ', findings: [{ point: 'บรรทัดแรกบอกราคา', evidence: 'https://fb.com/p/1' }] });
});

test('what Grok reads: playbook, liked and disliked examples with reasons, how to send a draft', () => {
  const t = playbookText(
    { id: 7, text: 'เปิดด้วยราคา', proposed_by: 'x', approved_by: 'y', created_at: '2026-11-01T03:00:00Z' },
    [{ id: 1, text: 'ยีนส์ 189\nส่งฟรี', liked: 1, reason: 'ราคาชัด', created_by: '', created_at: '' }],
    'https://example.dev',
  );
  assert.match(t, /ฉบับ: 7 · อนุมัติ 2026-11-01/);
  assert.match(t, /- ยีนส์ 189 \/ ส่งฟรี\n  เหตุผล: ราคาชัด/);
  assert.match(t, /ไม่ชอบ \(พร้อมเหตุผล\)\n- \(ยังไม่มี\)/);
  assert.match(t, /POST https:\/\/example\.dev\/webhook\/grok\/playbook/);
});
