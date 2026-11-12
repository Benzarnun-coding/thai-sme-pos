import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSpec, imagePairs, parseImageVerdict, proposalText, proposalButtons } from './grokAds.ts';

test('new ad = the template creative with our caption and picture; post-based or video templates refused', () => {
  const tpl = { page_id: '1', link_data: { message: 'old', picture: 'https://x/p.jpg', link: 'https://fb.com/messenger', call_to_action: { type: 'MESSAGE_PAGE', value: { app_destination: 'MESSENGER' } }, child_attachments: [{}] } };
  const s = buildSpec(tpl, 'แคปชันใหม่', 'h1');
  assert.deepEqual(s, { page_id: '1', link_data: { message: 'แคปชันใหม่', link: 'https://fb.com/messenger', call_to_action: { type: 'MESSAGE_PAGE', value: { app_destination: 'MESSENGER' } }, image_hash: 'h1' } });
  assert.equal(tpl.link_data.message, 'old', 'template untouched');
  assert.deepEqual(buildSpec({ page_id: '1', photo_data: { caption: 'x', url: 'u' } }, 'c', 'h'), { page_id: '1', photo_data: { caption: 'c', image_hash: 'h' } });
  assert.throws(() => buildSpec(null, 'c', 'h'), /โพสต์เดิม/);
  assert.throws(() => buildSpec({ page_id: '1', video_data: {} }, 'c', 'h'), /ไม่ใช่แอดภาพ/);
});

test('image pairs: same product only, unseen, newest first', () => {
  const seen = new Set(['1:2']);
  const p = imagePairs([{ id: 1, code: 'a' }, { id: 2, code: 'a' }, { id: 3, code: 'a' }, { id: 4, code: 'b' }], seen, 5);
  assert.deepEqual(p, [[3, 2], [3, 1]]);
});

test('image verdict JSON', () => {
  assert.deepEqual(parseImageVerdict('{"winner":"b","reason":"fake","why":"สีตรง"}'), { winner: 'B', reason: 'fake', why: 'สีตรง' });
  assert.equal(parseImageVerdict('{"winner":"C"}'), null);
  assert.equal(parseImageVerdict('ไม่รู้'), null);
});

test('proposal says what will be created, budget, days, and tags Max; buttons carry the set id', () => {
  const t = proposalText({ id: 7, code: '801/3', caption_text: 'แคปชัน' }, { campaign_name: '801 REV' }, { budget: 100, days: 14, max_active: 3, review: 'dry' }, '<@9>');
  assert.match(t, /^📣 <@9> \*\*เสนอลงโพสต์ใหม่/);
  assert.match(t, /"801 REV ชุด#7 \(Grok\)".*"801\/3 ชุด#7 \(Grok\)".*100 บาท\/วัน.*14 วัน/s);
  assert.deepEqual(proposalButtons(7)[0].components.map((c) => c.custom_id), ['grokad:7:yes', 'grokad:7:no']);
  assert.match(proposalText({ id: 7, code: 'X', caption_text: 'c' }, null, { budget: 100, days: 14, max_active: 3, review: 'dry' }, ''), /ยังไม่มีแอดที่ยิงอยู่/);
});

import { parseGate } from './grokAds.ts';
import { AD_RULES } from './studio.ts';

test('ad gate: pass only on an explicit true; the shop rules ask for a person wearing them', () => {
  assert.deepEqual(parseGate('{"pass": true, "why": "มีคนใส่ ราคาชัด"}'), { pass: true, why: 'มีคนใส่ ราคาชัด' });
  assert.deepEqual(parseGate('{"pass": "yes", "why": "กางเกงพับ\n ไม่มีคน"}'.replace('\n', '\\n')), { pass: false, why: 'กางเกงพับ ไม่มีคน' });
  assert.equal(parseGate('ไม่รู้'), null);
  assert.match(AD_RULES, /คนใส่กางเกงจริง/);
  assert.match(AD_RULES, /ห้ามภาพกางเกงพับ/);
});

import { isGrokCampaign } from './grokAds.ts';

test('a (Grok) test campaign: ours ends with "(Grok)", hand-made ones start with "Grok"', () => {
  assert.equal(isGrokCampaign('REV 801 - กระบอกยืด 3 ตัว 799 - V1 ฿200 ชุด#4 (Grok)'), true);
  assert.equal(isGrokCampaign('Grok : Ni9 ขาสั้นผ้า Cotton 3ตัว499 - A ฿50'), true);
  assert.equal(isGrokCampaign('REV 801 - กระบอกยืด 3 ตัว 799'), false);
  assert.equal(isGrokCampaign('แอดผี Grokking 3ตัว'), false);
});
