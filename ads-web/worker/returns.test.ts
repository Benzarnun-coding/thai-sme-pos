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
