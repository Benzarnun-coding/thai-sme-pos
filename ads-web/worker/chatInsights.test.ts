import assert from 'node:assert/strict';
import { test } from 'node:test';
import { citeKey, transcript } from './chatInsights.ts';

test('transcript numbers customers, labels sides and keeps no ids', () => {
  const t = transcript([
    { psid: 'secret-psid', campaign: 'ni9 ผ้าสี', ordered: true, messages: [{ from_page: 0, text: 'เอว 32 มีไหม', attachments: null, at: '2026-10-15T07:05:00Z' }, { from_page: 1, text: 'มีค่ะ', attachments: null }, { from_page: 0, text: null, attachments: 'image' }] },
  ]);
  assert.equal(t.used, 1);
  assert.ok(!t.text.includes('secret-psid'));
  assert.match(t.text, /### ลูกค้า 1 · ทักครั้งแรก 14:05 น\. · แอด: ni9 ผ้าสี · มีโน้ตออเดอร์: ใช่\nลูกค้า: เอว 32 มีไหม\nเพจ: มีค่ะ\nลูกค้า: \[ส่งรูป\]/);
});

test('customers cited under ⚠️ get their time and ad', () => {
  const c = (at: string, campaign: string | null) => ({ psid: 'x', campaign, ordered: false, messages: [{ from_page: 0, text: 'a', attachments: null, at }] });
  const k = citeKey('**❓** ลูกค้า 2\n**⚠️ ต้องดู**\n- **ลูกค้า 1**: ส่งผิด\n- ลูกค้า 3 ตามของ', [c('2026-10-15T06:04:00Z', 'ni9 ผ้าสี'), c('2026-10-15T07:00:00Z', null), c('2026-10-15T08:30:00Z', null)]);
  assert.equal(k, '\n🔎 **ค้นใน inbox:** ลูกค้า 1 = ทัก 13:04 น. · ni9 ผ้าสี · ลูกค้า 3 = ทัก 15:30 น. · ไม่ระบุแอด');
});
