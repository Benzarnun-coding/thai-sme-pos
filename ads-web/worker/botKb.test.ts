import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kbPasteText, parseItems, speaker } from './botKb.ts';

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
