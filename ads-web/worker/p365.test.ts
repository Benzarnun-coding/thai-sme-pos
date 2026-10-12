import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actualByCampaign, creditOrders, hashName, normaliseOrders, parseExportTime, parseItems, type StoredOrder } from './p365.ts';

test('items are read from Page365 item detail', () => {
  const items = parseItems('501/3  ยีนส์กระบอกเล็กผ้าไม่ยืดสีดำ Ni9 (5013-PK-BL-30) (5013-PK-BL-30) x1 THB 369.0. NI9-1 ขาสั้นสีดำ (NI91-PK-BL-28) (NI91-PK-BL-28) x2 THB 319.');
  assert.deepEqual(items.map((i) => [i.code, i.sku, i.qty, i.price]), [['5013', '5013-PK-BL-30', 1, 369], ['NI91', 'NI91-PK-BL-28', 2, 319]]);
  assert.equal(items[0].name, '501/3  ยีนส์กระบอกเล็กผ้าไม่ยืดสีดำ Ni9');
  assert.deepEqual(parseItems(''), []);
});

test('export times carry their offset; the Bangkok day follows', async () => {
  assert.equal(parseExportTime('2026-10-08 23:30:00 +0700')!.toISOString(), '2026-10-08T16:30:00.000Z');
  const { orders, errors } = await normaliseOrders([
    { order_no: '28750.0', created_at: '2026-10-08 08:36:56 +0700', total: 877, shipping: 50, cost: 600, payment: 'cod', item_detail: '(NI91-PK-BL-28) x1 THB 319.', profile_name: ' Somchai  Jaidee ' },
    { order_no: '', created_at: '2026-10-08 08:36:56 +0700', total: 1 },
    { order_no: '28751', created_at: 'garbage', total: 1 },
  ], 'salt');
  assert.equal(errors.length, 2);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].order_no, '28750');
  assert.equal(orders[0].date, '2026-10-08');
  assert.equal(orders[0].units, 1);
  assert.equal(orders[0].name_hash, await hashName('somchai jaidee', 'salt'));
  assert.notEqual(orders[0].name_hash, await hashName('somchai jaidee', 'other-salt'));
});

const order = (no: string, hhmm: string, total: number, extra: Partial<StoredOrder> = {}): StoredOrder => ({
  order_no: no, date: '2026-10-08', created_at: `2026-10-08T${hhmm}:00+07:00`, total, subtotal: null, discount: null, shipping: 50, cost: null,
  payment: 'cod', paid_at: null, units: 1, items: [], name_hash: null, campaign_id: null, match: 'none', ...extra,
});

test('orders are credited by customer first, then by hour and value', () => {
  const orders = [
    order('1', '08:10', 877, { name_hash: 'h1' }),   // customer came from campaign B's ad
    order('2', '08:20', 249),
    order('3', '08:30', 549),
    order('4', '08:40', 399),
    order('5', '09:05', 1000),                         // nothing tagged for it: organic
  ];
  const hours = [
    { campaign_id: 'A', hour: '08:00', purchases: 2, value: 249 + 549 },
    { campaign_id: 'B', hour: '08:00', purchases: 2, value: 877 + 399 - 50 },   // one tagged without the COD fee
  ];
  const counts = creditOrders(orders, hours, [{ name_hash: 'h1', campaign_id: 'B', at: '2026-10-08T07:50:00+07:00' }]);
  assert.deepEqual(orders.map((o) => [o.order_no, o.campaign_id, o.match]), [
    ['1', 'B', 'customer'], ['2', 'A', 'exact'], ['3', 'A', 'exact'], ['4', 'B', 'exact'], ['5', null, 'none'],
  ]);
  assert.deepEqual(counts, { customer: 1, exact: 3, approx: 0, none: 1 });
  const by = actualByCampaign(orders, { cod_pct: 1, loss_pct: 1, ship: 18, vat_pct: 5, bag: 1 });
  assert.equal(by.get('A')!.revenue, 798);
  // 7% of 798 + 2 × (18 + 1) — the team's per-order deductions
  assert.equal(Math.round(by.get('A')!.fees * 100) / 100, Math.round((798 * 0.07 + 38) * 100) / 100);
  assert.equal(by.get('B')!.orders, 2);
  assert.equal(by.get(null)!.revenue, 1000);
});

test('an order tagged in the next hour is still credited, marked approximate', () => {
  const orders = [order('1', '09:59', 549), order('2', '10:01', 549)];
  const hours = [{ campaign_id: 'A', hour: '10:00', purchases: 2, value: 1098 }];
  creditOrders(orders, hours, []);
  assert.deepEqual(orders.map((o) => [o.campaign_id, o.match]), [['A', 'approx'], ['A', 'approx']]);
});
