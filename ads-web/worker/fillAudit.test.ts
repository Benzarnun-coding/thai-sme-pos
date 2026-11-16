import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diff, expected, stopReason } from './fillAudit.ts';

const bill = (items: [string, number][], total: number, cod = true) => ({ items: items.map(([code, quantity]) => ({ id: 1, name: '', note: null, price: 0, quantity, variant: { id: 1, code, product_id: 1 } })), total, cod });

test('a bill as the note said is ok; what an admin changed is named', () => {
  const want = expected('501/1/2 32\ncod 448')!;
  assert.deepEqual(diff(want, bill([['5011-PK-MD-32', 1], ['5012-PK-NV-32', 1]], 448)), []);
  assert.deepEqual(diff(want, bill([['5011-PK-MD-34', 1], ['5012-PK-NV-34', 1]], 448)), ['size']);
  assert.deepEqual(diff(want, bill([['5011-PK-MD-32', 2]], 448)), ['items']);
  assert.deepEqual(diff(want, bill([['5011-PK-MD-32', 1]], 249)), ['qty', 'total']);
  assert.deepEqual(diff(want, bill([['5011-PK-MD-32', 1], ['5012-PK-NV-32', 1]], 448, false)), ['payment']);
  assert.deepEqual(diff(expected('D01 D02 34\ncod 448')!, bill([['D01-PK-NV-34', 1], ['D02-PK-MD-34', 1]], 448)), [], 'letter codes');
  assert.equal(expected('980 ดำกรม 1\ncod 149'), null, 'colour names: not compared');
});

test('stop reasons fall into a few groups', () => {
  assert.equal(stopReason('ต้องให้คนดู: ในแชทตกลงยอด 349 แต่สรุปไว้ 299 — เช็กกับลูกค้า/แอดมิน'), 'ยอดแชทไม่ตรง');
  assert.equal(stopReason('ต้องให้คนดู: NI9-2 ไม่มีไซส์ 29 — รุ่นนี้มี 28, 30'), 'ไซส์ไม่มี');
  assert.equal(stopReason('ต้องให้คนดู: ไม่พบรุ่น SK004 ใน Page365'), 'หารุ่นไม่เจอ');
  assert.equal(stopReason('ต้องให้คนดู: ลูกค้าขอยกเลิกในแชท (และยังไม่ได้สั่งใหม่)'), 'ลูกค้ายกเลิก');
});
