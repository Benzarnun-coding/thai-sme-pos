import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normaliseRow, type CatalogRow } from '../web/src/catalog.ts';
import { buildLines, groupLines, makeLookup, priceOf, readOrderItems, suggestSkus } from '../web/src/purchase.ts';

const row = (o: Record<string, unknown>): CatalogRow => normaliseRow(o);
const CATALOG: CatalogRow[] = [
  row({ tab: 'PK', sku: '5011-PK-MD-30', code: '501/1', color: 'MD', size: '30', cost: '180' }),
  row({ tab: 'PK', sku: '5011-PK-MD-32', code: '501/1', color: 'MD', size: '32', cost: '180' }),
  row({ tab: 'PK', sku: '5011-PK-BL-32', code: '501/1', color: 'BL', size: '32' }),
  row({ tab: 'BB', sku: 'J41-BB-BL-32', code: 'J41-2', color: 'BL', size: '32', shop: 'แพลนเนท' }),
];

test('suggestions: code + size first, words that are not in the catalog do not hide a match', () => {
  assert.deepEqual(suggestSkus(CATALOG, '501/1 32').map((r) => r.sku), ['5011-PK-BL-32', '5011-PK-MD-32', '5011-PK-MD-30']);
  // A marketplace product name: extra words, the code and the size inside it
  assert.equal(suggestSkus(CATALOG, 'กางเกงยีนส์ขากระบอก 501/1 MD 32')[0].sku, '5011-PK-MD-32');
  assert.deepEqual(suggestSkus(CATALOG, '32'), [], 'a size alone matches nothing');
  assert.deepEqual(suggestSkus(CATALOG, '   '), []);
  assert.equal(suggestSkus(CATALOG, 'j41').length, 1);
});

test('a matched marketplace SKU is read as ours: right sheet, cost', () => {
  const aliases = new Map([['LZ-998877-1', '5011-PK-MD-32'], ['NOPE', 'NOT-IN-CATALOG']]);
  const lookup = makeLookup(CATALOG, new Map(), new Map(), new Map(), aliases);
  assert.equal(lookup.rows.get('LZ-998877-1')?.sku, '5011-PK-MD-32');
  assert.equal(lookup.rows.get('NOPE'), undefined, 'a match to a SKU that left the catalog is ignored');
  assert.equal(priceOf('lz-998877-1', lookup).price, priceOf('5011-PK-MD-32', lookup).price);
  const groups = groupLines(buildLines(readOrderItems([{ SKU: 'lz-998877-1', 'จำนวน': '2', 'หมายเลขคำสั่งซื้อ': 'L1' }]), lookup));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, 'PK');
  assert.equal(groups[0].pieces, 2);
});

test('a real catalog SKU is never overridden by a match', () => {
  const lookup = makeLookup(CATALOG, new Map(), new Map(), new Map(), new Map([['5011-PK-MD-30', 'J41-BB-BL-32']]));
  assert.equal(lookup.rows.get('5011-PK-MD-30')?.sku, '5011-PK-MD-30');
});
