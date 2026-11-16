import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normaliseRow, type CatalogRow } from '../web/src/catalog.ts';
import { buildLines, groupLines, makeLookup, MISSING_GROUP, STOCK_GROUP, stockPlacer, type OrderItem } from '../web/src/purchase.ts';

const row = (o: Record<string, unknown>): CatalogRow => normaliseRow(o);
const CATALOG = [
  row({ tab: 'PK', sku: '5012-PK-NV-30', code: '501/2', color: 'NV', size: '30' }),
  row({ tab: 'PK', sku: '5012-PK-NV-32', code: '501/2', color: 'NV', size: '32' }),
  row({ tab: 'PK', sku: '2003-PK-MR-32', code: '200/3', color: 'MR', size: '32' }),
];
const item = (order: string, sku: string, qty = 1): OrderItem => ({ store: 'TikTok', sku, name: '', option: '', qty, order, tracking: '', carrier: '' });
const stock = (balance: [string, number][], cut: string[] = [], active = true) =>
  stockPlacer({ skus: new Set(['5012-PK-NV-30', '5012-PK-NV-32']), balance: new Map(balance), cut: new Set(cut), active });

test('old out-of-stock sheet is เก็บตกแทน; พี่เปีย is the stock branch', () => {
  assert.equal(MISSING_GROUP, 'เก็บตกแทน');
  assert.equal(STOCK_GROUP, 'พี่เปีย');
});

test('stock products go to พี่เปีย while the balance lasts, first come first served; the rest stay on PK', () => {
  const p = stock([['5012-PK-NV-30', 2], ['5012-PK-NV-32', 0]]);
  const items = [item('A', '5012-PK-NV-30'), item('B', '5012-PK-NV-30'), item('C', '5012-PK-NV-30'), item('D', '5012-PK-NV-32'), item('E', '2003-PK-MR-32')];
  const groups = groupLines(buildLines(items, makeLookup(CATALOG, new Map()), p.place));
  const by = Object.fromEntries(groups.map((g) => [g.name, g]));
  assert.equal(by[STOCK_GROUP].kind, 'warehouse');
  assert.deepEqual(by[STOCK_GROUP].lines.map((l) => [l.sku, l.qty, l.orders]), [['5012-PK-NV-30', 2, ['A', 'B']]]);
  assert.deepEqual(by.PK.lines.map((l) => [l.sku, l.qty]).sort(), [['2003-PK-MR-32', 1], ['5012-PK-NV-30', 1], ['5012-PK-NV-32', 1]]);
  assert.deepEqual([...p.short], [['5012-PK-NV-30', 1], ['5012-PK-NV-32', 1]]);
});

test('an order already cut by an earlier round stays at พี่เปีย without using the balance again', () => {
  const p = stock([['5012-PK-NV-30', 1]], ['A|5012-PK-NV-30']);
  const lines = buildLines([item('A', '5012-PK-NV-30', 2), item('B', '5012-PK-NV-30')], makeLookup(CATALOG, new Map()), p.place);
  assert.deepEqual(lines.map((l) => [l.group, l.qty, l.orders]), [[STOCK_GROUP, 3, ['A', 'B']]]);
  assert.equal(p.short.size, 0);
});

test('before the stock starts (the sheet covered that day) nothing moves', () => {
  const p = stock([['5012-PK-NV-30', 10]], [], false);
  const lines = buildLines([item('A', '5012-PK-NV-30')], makeLookup(CATALOG, new Map()), p.place);
  assert.equal(lines[0].group, 'PK');
});

test('601/1 sold at พี่เปีย uses 501/1 stock of the same size', () => {
  const cat = [...CATALOG, row({ tab: 'PK', sku: '6011-PK-MD-30', code: '601/1', color: 'MD', size: '30' })];
  const p = stockPlacer({ skus: new Set(['5012-PK-NV-30']), balance: new Map([['5012-PK-NV-30', 3]]), cut: new Set(), active: true, link: new Map([['6011-PK-MD-30', '5012-PK-NV-30']]) });
  const lines = buildLines([item('A', '6011-PK-MD-30', 2), item('B', '5012-PK-NV-30', 2)], makeLookup(cat, new Map()), p.place);
  assert.deepEqual(lines.map((l) => [l.group, l.sku, l.qty]), [[STOCK_GROUP, '6011-PK-MD-30', 2], ['PK', '5012-PK-NV-30', 2]]);
  assert.deepEqual([...p.short], [['5012-PK-NV-30', 2]], 'only 1 left for the 501 order');
});

test('"รหัสของเรา": a forced match replaces a SKU even when the catalog has it, so the rows add up', () => {
  const cat = [...CATALOG, row({ tab: 'BB', sku: '39-BB-MD-30', code: '39', color: 'MD', size: '30', shop: 'ร้าน 39' })];
  const items = [item('A', '39-BB-MD-30'), item('B', '5012-PK-NV-30', 2)];
  const plain = buildLines(items, makeLookup(cat, new Map(), new Map(), new Map(), new Map([['39-BB-MD-30', '5012-PK-NV-30']])));
  assert.equal(plain.length, 2, 'an ordinary match never overrides a catalog SKU');
  const forced = buildLines(items, makeLookup(cat, new Map(), new Map(), new Map(), new Map([['39-BB-MD-30', '5012-PK-NV-30']]), new Set(['39-BB-MD-30'])));
  assert.deepEqual(forced.map((l) => [l.group, l.sku, l.qty, l.merged]), [['PK', '5012-PK-NV-30', 3, ['39-BB-MD-30']]]);
});

test('a round opened from history merges its rows as soon as "รหัสของเรา" is picked', async () => {
  const { remapLines } = await import('../web/src/purchase.ts');
  const cat = [...CATALOG, row({ tab: 'BB', sku: '501-BB-MD-30', code: '501', color: 'MD', size: '30', shop: 'ร้าน 501' })];
  const saved = buildLines([item('A', '501-BB-MD-30'), item('B', '5012-PK-NV-30', 2)], makeLookup(cat, new Map()));
  assert.equal(saved.length, 2);
  const before = remapLines(saved, makeLookup(cat, new Map()));
  assert.equal(before, saved, 'nothing to remap → the same lines');
  const after = remapLines(saved.map((l) => (l.sku === '501-BB-MD-30' ? { ...l, missing: 1 } : l)),
    makeLookup(cat, new Map(), new Map(), new Map(), new Map([['501-BB-MD-30', '5012-PK-NV-30']]), new Set(['501-BB-MD-30'])));
  assert.deepEqual(after.map((l) => [l.group, l.sku, l.qty, l.orders, l.missing, l.merged]), [['PK', '5012-PK-NV-30', 3, ['A', 'B'], 1, ['501-BB-MD-30']]]);
});
