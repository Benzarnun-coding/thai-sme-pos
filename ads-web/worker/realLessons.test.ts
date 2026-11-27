import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDead, lessonLines, lessonsFrom, lessonsPrompt, outcome, summarize, type TestAd } from './realLessons.ts';

const ad = (set_id: number, status: string, image_key: string, caption_key: string, spend: number, real_orders: number, real_value: number): TestAd => ({ set_id, code: 'X', status, image_key, caption_key, spend, real_orders, real_value });

// The 14 "(Grok)" tests in production on 2026-11-26 (wrangler d1, read only).
const prod: TestAd[] = [
  ad(4, 'graduated', 'real', 'price', 586, 14, 5374), ad(5, 'graduated', 'real', 'price', 1739, 13, 6966), ad(6, 'graduated', 'real', 'price', 1361, 11, 4082),
  ad(9, 'stopped', '', 'price', 220, 0, 0), ad(10, 'stopped', '', 'price', 568, 4, 1166), ad(11, 'stopped', '', 'promo_math', 221, 0, 0),
  ad(12, 'done', '', 'price', 698, 4, 2146), ad(13, 'done', '', 'promo_math', 695, 4, 2494), ad(14, 'graduated', '', 'price', 703, 5, 2445),
  ad(25, 'stopped', 'offer1', 'promo_math', 232, 0, 0), ad(26, 'stopped', 'single', 'sizes', 291, 0, 0), ad(28, 'running', 'offer3', 'price', 501, 3, 2096),
  ad(30, 'stopped', 'back', 'price', 289, 0, 0), ad(31, 'stopped', 'front', 'lifestyle', 231, 0, 0),
];

test('outcome: real orders + real ROAS decide, not Meta; running is open until it wins', () => {
  assert.equal(outcome(prod[0], 2.9), 'win'); // graduated
  assert.equal(outcome(prod[6], 2.9), 'win'); // done but 4 orders, ROAS 3.07
  assert.equal(outcome(prod[4], 2.9), 'lose'); // 4 orders but ROAS 2.05
  assert.equal(outcome(prod[11], 2.9), 'win'); // running, already 3 orders ROAS 4.2
  assert.equal(outcome(ad(1, 'running', 'back', 'price', 200, 0, 0), 2.9), 'open');
  assert.equal(outcome(ad(1, 'running', 'back', 'price', 600, 2, 3000), 2.9), 'open'); // < 3 orders
});

test('per caption hook and picture task, on the production tests', () => {
  const l = lessonsFrom(prod, 2.9, { offer3: 'แพ็ก 3 ตัวเด่น' }, { price: 'ราคา', promo_math: 'คุ้มกว่าเมื่อซื้อหลายตัว' });
  assert.equal(l.tests, 14);
  const cap = new Map(l.captions.map((r) => [r.key, r]));
  assert.deepEqual([cap.get('price')!.wins, cap.get('price')!.losses], [6, 3]);
  assert.deepEqual([cap.get('promo_math')!.wins, cap.get('promo_math')!.losses], [1, 2]);
  assert.equal(l.captions[0].key, 'price'); // most wins first
  const img = new Map(l.images.map((r) => [r.key, r]));
  assert.deepEqual([img.get('offer3')!.wins, img.get('back')!.losses, img.get('real')!.wins], [1, 1, 3]);
  assert.equal(img.get('real')!.label, 'ภาพจากแอดที่ยิงอยู่');
  assert.match(l.image_lines.join('\n'), /แพ็ก 3 ตัวเด่น: ชนะ 1 แพ้ 0 · 3 ออเดอร์จริง ROAS จริง 4\.18/);
});

test('a key that lost twice and never won is dead; one loss is not enough', () => {
  assert.equal(isDead({ wins: 0, losses: 2 }), true);
  assert.equal(isDead({ wins: 0, losses: 1 }), false);
  assert.equal(isDead({ wins: 1, losses: 5 }), false);
  const rows = summarize([ad(1, 'stopped', 'back', 'sizes', 300, 0, 0), ad(2, 'done', 'back', 'sizes', 400, 1, 300)], (t) => t.caption_key, { sizes: 'ไซส์' }, 2.9);
  assert.match(lessonLines(rows)[0], /^- ไซส์: ชนะ 0 แพ้ 2 .*แพ้ทุกครั้ง ไม่ใช้อีก$/);
});

test('no prompt section until a test has ended', () => {
  assert.equal(lessonsPrompt(['- x'], 'caption', 0), '');
  assert.equal(lessonsPrompt([], 'image', 3), '');
  assert.match(lessonsPrompt(['- ราคา: ชนะ 6 แพ้ 3'], 'caption', 13), /^## ผลจากแอดทดสอบจริง แยกตามแนวแคปชัน[\s\S]*ราคา: ชนะ 6/);
});
