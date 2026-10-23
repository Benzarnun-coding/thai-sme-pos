import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kbMessage, kbModal, kbPasteText, parseItems, parseRepeats, parseRewrite, repeatsText, speaker, type KbItem } from './botKb.ts';

test('the AI answer is read even with a fence or text around the JSON', () => {
  const items = parseItems('นี่ค่ะ\n```json\n[{"kind":"fix","question":"ส่งฟรีไหม","answer":"โอนส่งฟรี เก็บปลายทาง +50","rule":"ห้ามลดค่า COD","why":"บอทให้ส่วนลดเอง","evidence":"ลูกค้า 3 (13:47 น.)"},{"kind":"fix","question":"","answer":"x"}]\n```');
  assert.equal(items.length, 1);
  assert.equal(items[0].rule, 'ห้ามลดค่า COD');
  assert.deepEqual(parseItems('ไม่มีอะไรต้องแก้ค่ะ'), []);
});

test('speakers: customer, admin app, bot app, unknown page app', () => {
  const env = { CHAT_HUMAN_APP_IDS: '263902037430900', CHAT_BOT_APP_IDS: '1111111111' };
  assert.equal(speaker(0, null, env), 'ลูกค้า');
  assert.equal(speaker(1, '263902037430900', env), 'แอดมิน');
  assert.equal(speaker(1, '1111111111', env), 'บอท');
  assert.equal(speaker(1, '999', env), 'เพจ');
});

test('paste text: rules first, then question and answer pairs', () => {
  const t = kbPasteText([{ question: 'ส่งฟรีไหม', answer: 'โอนส่งฟรี', rule: 'ห้ามลดค่า COD' } as any, { question: 'มีไซส์ 40 ไหม', answer: 'ส่งต่อแอดมิน', rule: null } as any]);
  assert.match(t, /^กฎ:\n- ห้ามลดค่า COD/);
  assert.match(t, /ถาม: มีไซส์ 40 ไหม\nตอบ: ส่งต่อแอดมิน$/);
});

test('repeats: only fixes that were in the bot before the chats, once each; not mixed into new fixes', () => {
  const text = '[{"kind":"repeat","ref":22,"why":"ยังแนะนำไซส์ 34 เอง","evidence":"ลูกค้า 4 (10:12 น.)"},{"kind":"repeat","ref":"#22"},{"kind":"repeat","ref":99},{"kind":"fix","question":"ส่งฟรีไหม","answer":"ส่งต่อแอดมิน"}]';
  assert.deepEqual(parseRepeats(text, [21, 22]), [{ ref: 22, why: 'ยังแนะนำไซส์ 34 เอง', evidence: 'ลูกค้า 4 (10:12 น.)' }]);
  assert.equal(parseItems(text).length, 1);
  const msg = repeatsText(parseRepeats(text, [22]), [{ id: 22, question: 'ลูกค้าขอไซส์ที่ร้านไม่มี', applied_at: '2026-10-20T03:00:00Z' } as KbItem]);
  assert.match(msg, /แก้แล้วแต่บอทยังพลาด 1 เรื่อง/);
  assert.match(msg, /#22\*\* ลูกค้าขอไซส์ที่ร้านไม่มี \(ใส่บอท 20 ต\.ค\.\)\n  ↳ ยังแนะนำไซส์ 34 เอง · ลูกค้า 4/);
});

test('three buttons on a proposed fix; the form comes filled in with the answer and rule', () => {
  const it = { id: 31, question: 'เปลี่ยนไซส์ได้ไหม', answer: 'ได้ค่ะ', rule: null, why: null, evidence: null } as unknown as KbItem;
  const ids = (kbMessage(it, '').components[0] as any).components.map((b: any) => b.custom_id);
  assert.deepEqual(ids, ['kbok:31', 'kbedit:31', 'kbno:31']);
  const m = kbModal(it) as any;
  assert.equal(m.custom_id, 'kbform:31');
  assert.deepEqual(m.components.map((r: any) => [r.components[0].custom_id, r.components[0].value ?? null, r.components[0].required]), [['answer', 'ได้ค่ะ', true], ['rule', null, false], ['extra', null, false]]);
  assert.ok(m.components.every((r: any) => r.components[0].label.length <= 45));
});

test("อูนิ's rewrite is read from its JSON; nothing usable keeps the team's draft", () => {
  assert.deepEqual(parseRewrite('```json\n{"answer":"เปลี่ยนไซส์ได้ค่ะ มีค่าบริการ 60 บาท","rule":"null"}\n```'), { answer: 'เปลี่ยนไซส์ได้ค่ะ มีค่าบริการ 60 บาท', rule: null });
  assert.deepEqual(parseRewrite('{"answer":"ก","rule":"บอกค่าบริการทุกครั้ง"}'), { answer: 'ก', rule: 'บอกค่าบริการทุกครั้ง' });
  assert.equal(parseRewrite('ขอโทษค่ะ'), null);
  assert.equal(parseRewrite('{"answer":""}'), null);
});
