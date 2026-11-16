import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupProducts, normaliseRow, overrideOf, planPrices, type CatalogRow } from '../web/src/catalog.ts';
import { labelFor, makeLookup, priceOf } from '../web/src/purchase.ts';

const row = (o: Record<string, unknown>): CatalogRow => normaliseRow(o);
const ROWS: CatalogRow[] = [
  row({ tab: 'PK', sku: '5011-PK-MD-30', code: '501/1', color: 'MD', size: '30', cost: '180', price: '199' }),
  row({ tab: 'PK', sku: '5011-PK-MD-32', code: '501/1', color: 'MD', size: '32', cost: '180', price: '199' }),
  row({ tab: 'PK', sku: '5011-PK-MD-40', code: '501/1', color: 'MD', size: '40', cost: '200', price: '219' }),
];
const sizes = (typed: (number | null)[], sheet: (number | null)[] = [180, 180, 200]) => ROWS.map((r, i) => ({ sku: r.sku, sheet: sheet[i], typed: typed[i] }));

test('price typed for one size wins over the whole product, which wins over the sheet', () => {
  const typed = new Map([['PK|5011-PK-MD', 190], ['PK|5011-PK-MD-40', 210]]);
  assert.equal(overrideOf(ROWS[0], typed), 190);
  assert.equal(overrideOf(ROWS[2], typed), 210);
  assert.equal(overrideOf(ROWS[0], new Map()), undefined);
  const lookup = makeLookup(ROWS, new Map(), typed);
  assert.deepEqual(priceOf('5011-PK-MD-40', lookup), { price: 210, source: 'web' });
  assert.deepEqual(priceOf('5011-PK-MD-30', lookup), { price: 190, source: 'web' });
});

test('the product view shows the price in use and the sheet price apart', () => {
  const [p] = groupProducts(ROWS, [], new Map(), new Map(), new Map([['PK|5011-PK-MD-40', 210]]), new Map([['PK|5011-PK-MD', 249]]));
  assert.deepEqual(p.cost, [180, 210]);
  assert.deepEqual(p.price, [249, 249]);
  const big = p.skus.find((r) => r.size === '40')!;
  assert.equal(big.cost, 210); assert.equal(big.sheet_cost, 200); assert.equal(big.cost_typed, true);
  assert.equal(p.skus[0].cost_typed, false); assert.equal(p.skus[0].price_typed, true); assert.equal(p.skus[0].sheet_price, 199);
});

test('save plan: same for every size → one price for the product; else per size; nothing changed → nothing sent', () => {
  assert.deepEqual(planPrices('PK', '5011-PK-MD', sizes([190, 190, 190]), new Map()), [{ tab: 'PK', spu: '5011-PK-MD', price: 190 }]);
  assert.deepEqual(planPrices('PK', '5011-PK-MD', sizes([180, 180, 210]), new Map()), [{ tab: 'PK', spu: '5011-PK-MD-40', price: 210 }]);
  assert.deepEqual(planPrices('PK', '5011-PK-MD', sizes([180, 180, 200]), new Map()), [], 'as in the sheet');
  assert.deepEqual(planPrices('PK', '5011-PK-MD', sizes([null, null, null]), new Map()), []);
  // From one product price to per size: the product price goes, sizes that differ from the sheet are stored
  assert.deepEqual(planPrices('PK', '5011-PK-MD', sizes([190, 190, 220]), new Map([['PK|5011-PK-MD', 190]])), [
    { tab: 'PK', spu: '5011-PK-MD', price: null },
    { tab: 'PK', spu: '5011-PK-MD-30', price: 190 },
    { tab: 'PK', spu: '5011-PK-MD-32', price: 190 },
    { tab: 'PK', spu: '5011-PK-MD-40', price: 220 },
  ]);
  // Back to the sheet: everything stored is removed
  assert.deepEqual(planPrices('PK', '5011-PK-MD', sizes([180, null, 200]), new Map([['PK|5011-PK-MD', 190], ['PK|5011-PK-MD-40', 210]])), [
    { tab: 'PK', spu: '5011-PK-MD', price: null },
    { tab: 'PK', spu: '5011-PK-MD-40', price: null },
  ]);
  // Unchanged edit of a stored product price sends nothing
  assert.deepEqual(planPrices('PK', '5011-PK-MD', sizes([190, 190, 190]), new Map([['PK|5011-PK-MD', 190]])), []);
  // No price in the sheet
  assert.deepEqual(planPrices('PK', '5011-PK-MD', sizes([150, null, null], [null, null, null]), new Map()), [{ tab: 'PK', spu: '5011-PK-MD-30', price: 150 }]);
});

test('a SKU without a size part is its own product key', () => {
  assert.deepEqual(planPrices('CN', 'X1', [{ sku: 'X1', sheet: 100, typed: 120 }], new Map()), [{ tab: 'CN', spu: 'X1', price: 120 }]);
  assert.deepEqual(planPrices('CN', 'X1', [{ sku: 'X1', sheet: 100, typed: 100 }], new Map([['CN|X1', 120]])), [{ tab: 'CN', spu: 'X1', price: null }]);
});

test('order-sheet name typed for one size wins over the product name', () => {
  const lookup = makeLookup(ROWS, new Map(), new Map(), new Map([['PK|5011-PK-MD', 'ทั้งตัว'], ['PK|5011-PK-MD-32', 'ไซส์เดียว']]));
  assert.equal(labelFor(ROWS[0], 'warehouse', lookup), 'ทั้งตัว');
  assert.equal(labelFor(ROWS[1], 'warehouse', lookup), 'ไซส์เดียว');
});
