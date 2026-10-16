import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normaliseRow, type CatalogRow } from '../web/src/catalog.ts';
import { buildLines, FACEBOOK_STORE, GOSELL_GROUP, isFacebookExport, makeLookup, MANUAL_STORE, readFacebookItems, saleItems, STOCK_GROUP, stockPlacer, type OrderItem } from '../web/src/purchase.ts';
import { validateExtra } from './purchase.ts';

const row = (o: Record<string, unknown>): CatalogRow => normaliseRow(o);
const CATALOG = [
  row({ tab: 'PK', sku: '5012-PK-NV-30', code: '501/2', color: 'NV', size: '30' }),
  row({ tab: 'PK', sku: '8011-PK-MD-34', code: '801/1', color: 'MD', size: '34' }),
];
const HEADERS = ['No.', 'Alt no.', 'Created At', 'Status', 'Source', 'Profile name', 'Customer Name', 'SKU', 'Variant Name', 'Item Name', 'Item Qty', 'Item Price'];

test('Page365 per-item export is recognised; Bigseller is not', () => {
  assert.equal(isFacebookExport(HEADERS), true);
  assert.equal(isFacebookExport(['ร้านค้า BigSeller', 'SKU', 'จำนวน', 'หมายเลขคำสั่งซื้อ']), false);
});

test('Facebook lines: order no. + our SKU + qty, cancelled left out, customer columns never read', () => {
  const items = readFacebookItems([
    { 'No.': '29333', Status: 'paid', SKU: '5012-PK-NV-30', 'Item Qty': '2', 'Item Name': '501/2 กรม', 'Variant Name': 'ไซส์ 30', 'Customer Name': 'X' },
    { 'No.': '29334', Status: 'shipped', SKU: '8011-PK-MD-34', 'Item Qty': '1', 'Item Name': '801/1', 'Variant Name': 'ไซส์ 34' },
    { 'No.': '29335', Status: 'cancelled', SKU: '8011-PK-MD-34', 'Item Qty': '1' },
  ]);
  assert.deepEqual(items.map((i) => [i.order, i.sku, i.qty, i.store]), [['29333', '5012-PK-NV-30', 2, FACEBOOK_STORE], ['29334', '8011-PK-MD-34', 1, FACEBOOK_STORE]]);
  assert.ok(items.every((i) => !JSON.stringify(i).includes('"X"')));
});

test('Facebook stock products go to GoSell (not พี่เปีย); Bigseller ones to พี่เปีย; typed lines to their usual sheet', () => {
  const skus = new Set(['5012-PK-NV-30']);
  const pia = stockPlacer({ skus, balance: new Map([['5012-PK-NV-30', 10]]), cut: new Set(), active: true });
  const gs = stockPlacer({ skus, balance: new Map([['5012-PK-NV-30', 10]]), cut: new Set(), active: true, group: GOSELL_GROUP });
  const place = (it: OrderItem, r: CatalogRow) => (it.store === FACEBOOK_STORE ? gs.place(it, r) : it.store === MANUAL_STORE ? null : pia.place(it, r));
  const items: OrderItem[] = [
    { store: 'TikTok', sku: '5012-PK-NV-30', name: '', option: '', qty: 1, order: 'T1', tracking: '', carrier: '' },
    { store: FACEBOOK_STORE, sku: '5012-PK-NV-30', name: '', option: '', qty: 2, order: '29333', tracking: '', carrier: '' },
    { store: FACEBOOK_STORE, sku: '8011-PK-MD-34', name: '', option: '', qty: 1, order: '29334', tracking: '', carrier: '' },
    { store: MANUAL_STORE, sku: '5012-PK-NV-30', name: '', option: '', qty: 3, order: '', tracking: '', carrier: '' },
  ];
  const lines = buildLines(items, makeLookup(CATALOG, new Map()), place);
  const by = (g: string) => lines.filter((l) => l.group === g).map((l) => [l.sku, l.qty]);
  assert.deepEqual(by(STOCK_GROUP), [['5012-PK-NV-30', 1]]);
  assert.deepEqual(by(GOSELL_GROUP), [['5012-PK-NV-30', 2]]);
  assert.deepEqual(by('PK').sort(), [['5012-PK-NV-30', 3], ['8011-PK-MD-34', 1]]);
  assert.ok(lines.filter((l) => l.group === GOSELL_GROUP).every((l) => l.kind === 'warehouse'));
});

test('saved extra items are cleaned; the units-sold rows stay Bigseller only (the page sends only those)', () => {
  assert.deepEqual(validateExtra([{ source: 'manual', sku: ' 5012-PK-NV-30 ', qty: 2 }, { source: 'facebook', order: '29333', sku: '', name: '', qty: 1 }, { qty: 0, sku: 'X' }]),
    [{ source: 'manual', order: '', sku: '5012-PK-NV-30', name: '', option: '', qty: 2 }]);
  assert.equal(validateExtra(undefined), null);
  assert.equal(saleItems([{ store: 'TikTok', sku: '5012-PK-NV-30', name: '', option: '', qty: 1, order: 'T1', tracking: '', carrier: '' }], makeLookup(CATALOG, new Map()), 'r').length, 1);
});
