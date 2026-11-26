import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byTracking, normTrack, trackHash } from '../web/src/returns.ts';
import type { OrderItem } from '../web/src/purchase.ts';

const it = (tracking: string, sku: string, qty: number): OrderItem => ({ store: 'TikTok', sku, name: '', option: '', qty, order: 'O', tracking, carrier: '' });

test('scanner noise is ignored in the parcel number', () => {
  assert.equal(normTrack(' th-123 456x\n'), 'TH123456X');
  assert.equal(normTrack('th123456x'), normTrack('TH 123456X'));
});

test('hash is stable and 64 hex', async () => {
  const h = await trackHash('th123456x');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, await trackHash(' TH123456X '));
});

test('items of one parcel are summed per SKU; rows without a parcel number are skipped', () => {
  const m = byTracking([it('TH1', '5012-PK-NV-30', 1), it('th1', '5012-PK-NV-30', 2), it('TH1', '5012-PK-NV-32', 1), it('', '5012-PK-NV-30', 5)]);
  assert.deepEqual(m.get('TH1'), [{ sku: '5012-PK-NV-30', qty: 3 }, { sku: '5012-PK-NV-32', qty: 1 }]);
  assert.equal(m.size, 1);
});

import { facebookLineItems, facebookOrderItems, fbReturnQty, locOfSku, parseFacebookReturn } from './stockReturns.ts';
test('a returned SKU goes to the stock of its own tab (idea #28)', () => {
  assert.equal(locOfSku('5012-PK-NV-30'), 'pk');
  assert.equal(locOfSku('3012-AR-GY-32'), 'ar');
  assert.equal(locOfSku('2001-BB-BK-30'), 'bb');
  assert.equal(locOfSku('2001-XX-BK-30'), null);
});

test('Facebook return: order number with or without SKU (idea #30)', () => {
  assert.deepEqual(parseFacebookReturn('32594'), { order: '32594', sku: '', qty: 0 });
  assert.deepEqual(parseFacebookReturn(' 32594 SKU 1071-BB-CR-44 '), { order: '32594', sku: '1071-BB-CR-44', qty: 0 });
  assert.deepEqual(parseFacebookReturn('32594 1071-BB-CR-44'), { order: '32594', sku: '1071-BB-CR-44', qty: 0 });
  assert.equal(parseFacebookReturn('TH123456789'), null);
});

test('Facebook return finds the order in the rounds\' extra items, newest round first (idea #35)', () => {
  const x = (order: string, sku: string, qty: number, source = 'facebook') => ({ source, order, sku, name: '', option: '', qty });
  const newest = JSON.stringify([x('32965', '2003-J.BIG-MN-31', 1), x('32965', '2003-PK-BK-31', 1), x('1', 'A', 1)]);
  const older = JSON.stringify([x('32965', '2003-PK-MN-31', 2)]);
  assert.deepEqual(facebookOrderItems([newest, older], '32965'), [{ sku: '2003-J.BIG-MN-31', qty: 1, max: 1 }, { sku: '2003-PK-BK-31', qty: 1, max: 1 }]);
  assert.deepEqual(facebookOrderItems(['[]', older], '32965'), [{ sku: '2003-PK-MN-31', qty: 2, max: 2 }]);
  assert.deepEqual(facebookOrderItems([JSON.stringify([x('32965', 'S', 1, 'manual')]), 'bad json'], '32965'), []);
});

test('Facebook return falls back to the sheet lines of older rounds (idea #35)', () => {
  const r = (u: string, sku: string, qty: number, orders: string[], store: string | null) => ({ upload_id: u, sku, qty, orders: JSON.stringify(orders), store });
  const rows = [r('b', '2003-PK-BK-31', 1, ['32965'], 'Facebook · Page365'), r('b', '2003-J.BIG-MN-31', 3, ['32965', '1'], 'Facebook · Page365'), r('a', '2003-PK-BK-31', 2, ['32965'], 'Facebook · Page365'), r('b', 'X', 1, ['32965'], 'TikTok')];
  assert.deepEqual(facebookLineItems(rows), [{ sku: '2003-PK-BK-31', qty: 1, max: 1 }, { sku: '2003-J.BIG-MN-31', qty: 1, max: 3 }]);
  assert.deepEqual(facebookLineItems([]), []);
});

test('Facebook return: pieces typed after the order / SKU', () => {
  assert.deepEqual(parseFacebookReturn('32594 1071-BB-CR-44 x1'), { order: '32594', sku: '1071-BB-CR-44', qty: 1 });
  assert.deepEqual(parseFacebookReturn('32594 1071-BB-CR-44 ×2'), { order: '32594', sku: '1071-BB-CR-44', qty: 2 });
  assert.deepEqual(parseFacebookReturn('32594 x 1'), { order: '32594', sku: '', qty: 1 });
  assert.deepEqual(parseFacebookReturn('32594 X2'), { order: '32594', sku: '', qty: 2 });
  assert.deepEqual(parseFacebookReturn('32594 1071-BB-XL-44'), { order: '32594', sku: '1071-BB-XL-44', qty: 0 });
});

test('Facebook return counts pieces per order + SKU, so a part return can be finished later', () => {
  const two = { sku: 'S', qty: 2, max: 2 };
  assert.deepEqual(fbReturnQty(two, 0, 0), { add: 2 }); // nothing typed: the whole order line
  assert.deepEqual(fbReturnQty(two, 0, 1), { add: 1 }); // only one came back
  assert.deepEqual(fbReturnQty(two, 1, 0), { add: 1 }); // the other one later, untyped
  assert.deepEqual(fbReturnQty(two, 1, 1), { add: 1 });
  assert.deepEqual(fbReturnQty(two, 1, 2), { over: 1 }); // never more than the order had
  assert.deepEqual(fbReturnQty(two, 2, 0), { repeat: true, left: 0 });
  assert.deepEqual(fbReturnQty(two, 2, 1), { repeat: true, left: 0 });
  // an old round's line shared by several orders: 1 by default, more only when typed, up to the line's qty
  const shared = { sku: 'S', qty: 1, max: 3 };
  assert.deepEqual(fbReturnQty(shared, 0, 0), { add: 1 });
  assert.deepEqual(fbReturnQty(shared, 1, 0), { repeat: true, left: 2 });
  assert.deepEqual(fbReturnQty(shared, 1, 1), { add: 1 });
  assert.deepEqual(fbReturnQty(shared, 0, 4), { over: 3 });
});
