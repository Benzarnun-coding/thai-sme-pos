import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transcript } from './chatInsights.ts';

test('transcript numbers customers, labels sides and keeps no ids', () => {
  const t = transcript([
    { psid: 'secret-psid', campaign: 'ni9 ผ้าสี', ordered: true, messages: [{ from_page: 0, text: 'เอว 32 มีไหม', attachments: null }, { from_page: 1, text: 'มีค่ะ', attachments: null }, { from_page: 0, text: null, attachments: 'image' }] },
  ]);
  assert.equal(t.used, 1);
  assert.ok(!t.text.includes('secret-psid'));
  assert.match(t.text, /### ลูกค้า 1 · แอด: ni9 ผ้าสี · มีโน้ตออเดอร์: ใช่\nลูกค้า: เอว 32 มีไหม\nเพจ: มีค่ะ\nลูกค้า: \[ส่งรูป\]/);
});
