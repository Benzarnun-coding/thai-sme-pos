import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SalesData } from '../web/src/api.ts';
import { normaliseRow } from '../web/src/catalog.ts';
import { makeLookup, readOrderItems, saleItems } from '../web/src/purchase.ts';
import { byDay, byProduct, byStore, byWarehouse, channelOfStore, costOf, daysBetween, saleRows } from '../web/src/sales.ts';
import { validatePurchase } from './purchase.ts';
import { parseRange } from './sales.ts';

const CATALOG = [
  normaliseRow({ tab: 'PK', sku: '5011-PK-MD-30', code: '501/1', color: 'MD', size: '30', cost: 110 }),
  normaliseRow({ tab: 'PK', sku: '5011-PK-MD-32', code: '501/1', color: 'MD', size: '32', cost: 110 }),
  normaliseRow({ tab: 'CM', sku: 'ST01-CM-BL-34', code: 'ST-01', color: 'BL', size: '34' }),
];

const DATA: SalesData = {
  from: '2026-10-13', to: '2026-10-15',
  bigseller: [
    { date: '2026-10-13', store: 'TikTok · STM-SHOP', sku: '5011-PK-MD-30', qty: 3 },
    { date: '2026-10-13', store: 'Shopee · Sup-store17', sku: '5011-PK-MD-32', qty: 1 },
    { date: '2026-10-15', store: 'TikTok · STM-SHOP', sku: 'ST01-CM-BL-34', qty: 2 },
    { date: '2026-10-15', store: '', sku: 'UNKNOWN-X-Y-1', qty: 1 },
  ],
  bigsellerOrders: [
    { date: '2026-10-13', store: 'TikTok · STM-SHOP', orders: 2 }, { date: '2026-10-13', store: 'Shopee · Sup-store17', orders: 1 },
    { date: '2026-10-15', store: 'TikTok · STM-SHOP', orders: 2 }, { date: '2026-10-15', store: '', orders: 1 },
  ],
  page365: [{ date: '2026-10-14', sku: '5011-PK-MD-30', name: '501/1 ยีนส์', qty: 4 }],
  page365Orders: [{ date: '2026-10-14', orders: 3, units: 4, total: 800 }],
  bigsellerDays: ['2026-10-13', '2026-10-15'],
  page365Days: ['2026-10-14'],
};

test('channels: TikTok / Shopee from the store label, Facebook = Page365', () => {
  assert.equal(channelOfStore('TikTok · STM-SHOP'), 'TikTok');
  assert.equal(channelOfStore('Shopee · Sup-store17'), 'Shopee');
  assert.equal(channelOfStore('บอยขายยีนส์'), 'อื่นๆ');
  assert.equal(channelOfStore(''), 'อื่นๆ');
  assert.deepEqual(daysBetween('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
});

test('units per day, per channel, with orders and which source had a file', () => {
  const days = byDay(saleRows(DATA), DATA);
  assert.deepEqual(days.map((d) => [d.date, d.total, d.channels.TikTok, d.channels.Shopee, d.channels.Facebook, d.channels['อื่นๆ'], d.orders, d.bigseller, d.page365]), [
    ['2026-10-13', 4, 3, 1, 0, 0, 3, true, false],
    ['2026-10-14', 4, 0, 0, 4, 0, 3, false, true],
    ['2026-10-15', 3, 2, 0, 0, 1, 3, true, false],
  ]);
});

test('per store, product, warehouse and the cost of what was sold', () => {
  const rows = saleRows(DATA);
  assert.deepEqual(byStore(rows, DATA).map((s) => [s.store, s.channel, s.qty, s.orders]), [
    ['TikTok · STM-SHOP', 'TikTok', 5, 4], ['Facebook · Page365', 'Facebook', 4, 3], ['Shopee · Sup-store17', 'Shopee', 1, 1], ['(ไม่ทราบร้าน)', 'อื่นๆ', 1, 1],
  ]);
  const lookup = makeLookup(CATALOG, new Map(), new Map(), new Map([['CM|ST01-CM-BL', 'ขาสั้น ST ดำ']]));
  const products = byProduct(rows, lookup);
  assert.deepEqual(products.map((p) => [p.label, p.qty, p.channels.TikTok, p.channels.Facebook, p.known]), [
    ['501/1 มิดไนท์', 8, 3, 4, true], ['ขาสั้น ST ดำ', 2, 2, 0, true], ['UNKNOWN-X-Y-1', 1, 0, 0, false],
  ]);
  assert.deepEqual(byWarehouse(rows, lookup).map((w) => [w.tab, w.qty, w.products]), [['PK', 8, 1], ['CM', 2, 1], ['(ไม่มีในแคตตาล็อก)', 1, 1]]);
  assert.deepEqual(costOf(rows, lookup), { cost: 8 * 110, unpriced: 3 });
});

test('a saved round keeps one row per order + SKU for counting units', () => {
  const lookup = makeLookup(CATALOG, new Map());
  const items = readOrderItems([
    { 'ร้านค้า BigSeller': 'STM-SHOP', SKU: '5011-pk-md-30', 'จำนวน': '2', 'หมายเลขคำสั่งซื้อ': 'A1', 'ชื่อโลจิสติกส์': 'TikTok-TH-J&T Express' },
    { 'ร้านค้า BigSeller': 'STM-SHOP', SKU: '5011-PK-MD-30', 'จำนวน': '1', 'หมายเลขคำสั่งซื้อ': 'A1', 'ชื่อโลจิสติกส์': 'TikTok-TH-J&T Express' },
    { SKU: '', 'ชื่อสินค้า': 'กางเกง', 'ชื่อตัวเลือก': 'R55, 31', 'จำนวน': '1', 'หมายเลขคำสั่งซื้อ': '' },
  ]);
  const rows = saleItems(items, lookup, '2026-10-15#1');
  assert.deepEqual(rows.map((r) => [r.order, r.sku, r.qty, r.store]), [
    ['A1', '5011-PK-MD-30', 2, 'TikTok · STM-SHOP'], ['A1', '5011-PK-MD-30', 1, 'TikTok · STM-SHOP'], ['?2026-10-15#1#2', '?กางเกง · R55, 31', 1, ''],
  ]);
  const saved = validatePurchase({ date: '2026-10-15', round: 1, lines: [{ group: 'PK', kind: 'warehouse', sku: '5011-PK-MD-30', label: 'x', qty: 3 }], items: rows });
  assert.deepEqual(saved.items!.map((i) => [i.order, i.sku, i.qty]), [['A1', '5011-PK-MD-30', 3], ['?2026-10-15#1#2', '?กางเกง · R55, 31', 1]], 'same order + SKU added up');
  assert.equal(validatePurchase({ date: '2026-10-15', round: 1, lines: [{ group: 'PK', kind: 'warehouse', sku: 'a', label: 'x', qty: 1 }] }).items, null, 'a reopened round sends no rows and keeps its own');
});

test('date range for the units page', () => {
  assert.deepEqual(parseRange('2026-10-01', '2026-10-15'), { from: '2026-10-01', to: '2026-10-15' });
  assert.equal(parseRange(null, '2026-10-15').from, '2026-10-02', 'default 14 days');
  assert.throws(() => parseRange('2026-10-15', '2026-10-01'), /ไม่หลัง/);
  assert.throws(() => parseRange('2026-01-01', '2026-10-15'), /62 วัน/);
});
