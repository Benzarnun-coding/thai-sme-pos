import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCostSync, solveP365Costs } from './p365Costs.ts';

const it = (sku: string, qty = 1) => ({ sku, qty });

test('one-product orders give the cost; mixed orders solve the rest (26 Oct shapes)', () => {
  const { solved, explained, orders } = solveP365Costs([
    { cost: 351, items: [it('8011-PK-MD-30'), it('8012-PK-NV-30'), it('8013-PK-BL-30')] },
    { cost: 117, items: [it('8011-PK-MD-34')] },
    { cost: 117, items: [it('8012-PK-NV-32')] },
    { cost: 117, items: [it('8013-PK-BL-36')] },
    { cost: 465, items: [it('B63-BLD-MD-34'), it('B64-BLD-NV-34'), it('B65-BLD-BL-34')] }, // three unknowns: unsolved
    { cost: 317, items: [it('1712-BLD-MR-30'), it('8011-PK-MD-30')] },                      // 117 known → 1712 = 200
  ]);
  const cost = (k: string) => solved.find((s) => s.key === k && s.band === 'std')?.cost;
  assert.equal(cost('8011-PK-MD'), 117);
  assert.equal(cost('1712-BLD-MR'), 200);
  assert.equal(cost('B63-BLD-MD'), undefined);
  assert.equal(orders, 6);
  assert.equal(explained, 5);
});

test('size 38+ is its own band; orders that disagree give no value', () => {
  const { solved } = solveP365Costs([
    { cost: 135, items: [it('5011-BB-MD-38')] }, { cost: 110, items: [it('5011-BB-MD-30')] },
    { cost: 200, items: [it('X1-PK-BL-30')] }, { cost: 150, items: [it('X1-PK-BL-32')] },
  ]);
  assert.deepEqual(solved.filter((s) => s.key === '5011-BB-MD').map((s) => [s.band, s.cost]).sort(), [['big', 135], ['std', 110]]);
  assert.equal(solved.some((s) => s.key === 'X1-PK-BL'), false);
});

test('every size in the band takes Page365\'s cost where ours differs; same costs and other bands are left', () => {
  const solved = [{ key: '1712-BLD-MR', band: 'std' as const, cost: 200, orders: 2, pieces: 2 }, { key: '8011-BB-MD', band: 'big' as const, cost: 117, orders: 3, pieces: 16 }, { key: '3014-PK-NR', band: 'std' as const, cost: 118, orders: 2, pieces: 11 }];
  const rows = [
    { tab: 'BLD', sku: '1712-BLD-MR-28', spu: '1712-BLD-MR', cost: 155 }, { tab: 'BLD', sku: '1712-BLD-MR-30', spu: '1712-BLD-MR', cost: 155 },
    { tab: 'BLD', sku: '1712-BLD-MR-38', spu: '1712-BLD-MR', cost: 215 },
    { tab: 'BB', sku: '8011-BB-MD-38', spu: '8011-BB-MD', cost: null }, { tab: 'BB', sku: '8011-BB-MD-40', spu: '8011-BB-MD', cost: null },
  ];
  const { changes, missing } = planCostSync(solved, rows, new Map([['BLD|1712-BLD-MR-30', 200]]));
  assert.deepEqual(changes.map((c) => [c.sku, c.from, c.to, c.source]), [['1712-BLD-MR-28', 155, 200, 'sheet'], ['8011-BB-MD-38', null, 117, 'none'], ['8011-BB-MD-40', null, 117, 'none']]);
  assert.deepEqual(missing.map((m) => m.key), ['3014-PK-NR']);
});
