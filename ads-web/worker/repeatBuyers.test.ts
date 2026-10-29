import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayRepeat, repeatLine } from './repeatBuyers.ts';

test('dayRepeat: only customers seen on an earlier day are returning; 0-baht orders skipped', () => {
  const r = dayRepeat([
    { name_hash: 'a', total: 500 },
    { name_hash: 'b', total: 400 },
    { name_hash: 'c', total: 0 },
    { name_hash: null, total: 300 },
  ], new Set(['a', 'c']));
  assert.deepEqual(r, { orders: 3, returning: 1, returning_aov: 500, new_aov: 350 });
});

test('repeatLine: day and 30-day window in one line', () => {
  const line = repeatLine({
    day: { orders: 106, returning: 5, returning_aov: 476, new_aov: 439 },
    window: { customers: 2783, repeaters: 43 }, days: 30, since: '2026-09-28',
  });
  assert.equal(line, '🔁 ลูกค้าเก่า 5/106 ออเดอร์ (4.7%) · ยอดต่อออเดอร์ ลูกค้าเก่า 476 / ใหม่ 439 · ซื้อซ้ำใน 30 วัน 43/2,783 คน (1.5%) (นับจากไฟล์ตั้งแต่ 28/09)');
});

test('repeatLine: no returning customers → no order-value comparison', () => {
  const line = repeatLine({ day: { orders: 10, returning: 0, returning_aov: null, new_aov: 420 }, window: { customers: 0, repeaters: 0 }, days: 30, since: null });
  assert.equal(line, '🔁 ลูกค้าเก่า 0/10 ออเดอร์ (0.0%) · ซื้อซ้ำใน 30 วัน 0/0 คน (–)');
});
