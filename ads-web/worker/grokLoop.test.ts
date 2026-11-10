import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brief, chatVoice, reviewAd } from './grokLoop.ts';

test('reviewAd: graduates on real orders at 1.5× break-even, stops only when nothing sold anywhere', () => {
  assert.equal(reviewAd({ days: 4, spend: 520, meta_purchases: 6, real_orders: 5, real_value: 2600 }, 2.9).action, 'graduate'); // 5.0 ≥ 4.35
  assert.equal(reviewAd({ days: 4, spend: 520, meta_purchases: 6, real_orders: 3, real_value: 1500 }, 2.9).action, 'wait'); // 2.88
  assert.equal(reviewAd({ days: 4, spend: 520, meta_purchases: 6, real_orders: 5, real_value: 2600 }, null).action, 'wait');
  assert.equal(reviewAd({ days: 2, spend: 180, meta_purchases: 5, real_orders: 5, real_value: 2254 }, 2.9).action, 'wait'); // too little spend
  assert.equal(reviewAd({ days: 6, spend: 320, meta_purchases: 0, real_orders: 0, real_value: 0 }, 2.9).action, 'stop');
  assert.equal(reviewAd({ days: 6, spend: 320, meta_purchases: 1, real_orders: 0, real_value: 0 }, 2.9).action, 'wait'); // Meta saw a sale
  assert.equal(reviewAd({ days: 3, spend: 320, meta_purchases: 0, real_orders: 0, real_value: 0 }, 2.9).action, 'wait'); // too early
});

test('brief: goal gap → extra spend → winners → tests → images for the free slots', () => {
  const b = brief({ needed_per_day: 7206, avg_net: 5409, mer: 4.65, gross_margin: 0.342, running: 6, max_active: 9, waiting_images: 0, proposed: 1, finished: 0, graduated: 0 });
  assert.equal(b.gap_per_day, 1797);
  assert.equal(b.extra_ads_per_day, 3044); // 1797 / (4.65 × 0.342 − 1)
  assert.equal(b.winners_needed, 4);
  assert.equal(b.tests_needed, 12); // assumed 1 in 3
  assert.equal(b.free_slots, 3);
  assert.equal(b.images_now, 2); // 3 free − 1 waiting on Max
  assert.ok(b.hit_rate_assumed);
});

test('brief: real hit rate after 5 finished; no gap or no profit per baht asks for nothing extra', () => {
  const base = { needed_per_day: 7000, avg_net: 5000, mer: 4.65, gross_margin: 0.342, running: 9, max_active: 9, waiting_images: 0, proposed: 0 };
  const b = brief({ ...base, finished: 6, graduated: 3 });
  assert.equal(b.hit_rate, 0.5); assert.equal(b.images_now, 0); // slots full
  assert.equal(brief({ ...base, avg_net: 8000, finished: 0, graduated: 0 }).tests_needed, 0);
  assert.equal(brief({ ...base, mer: 2.5, finished: 0, graduated: 0 }).extra_ads_per_day, null);
  assert.equal(brief({ ...base, needed_per_day: null, avg_net: null, finished: 0, graduated: 0 }).gap_per_day, 0);
});

test('chatVoice: keeps the two sections, drops citations and duplicates', () => {
  const read = '**❓ ลูกค้าถามบ่อย**\n- ถามไซส์ 36 มีไหม 12 จาก 40 คน ลูกค้า 3 (10:15 น., แอด 801)\n- ผ้ายืดไหม 5 คน\n**🚫 ทำไมไม่ซื้อ**\n- กลัวไซส์ไม่พอดี 4 คน\n**🛍 ชวนเป็นเซ็ต**\n- ไม่เกี่ยว 2 ครั้ง';
  const v = chatVoice([read, read]);
  assert.equal(v.split('\n').length, 3);
  assert.ok(v.includes('[ลูกค้าถามบ่อย] ถามไซส์ 36 มีไหม 12 จาก 40 คน'));
  assert.ok(!v.includes('ลูกค้า 3') && !v.includes('ไม่เกี่ยว'));
  assert.equal(chatVoice(['ไม่มีหัวข้อ']), '');
});
