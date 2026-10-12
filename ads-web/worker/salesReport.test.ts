import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explainDay } from './salesReport.ts';

const base = { date: '2026-10-07', campaign_id: 'c1', name: 'X', stage_id: null };
const tiers = [{ units: 1, price: 199, cost: 98.93 }, { units: 2, price: 299, cost: 175.93 }];

test('sheet with two promos: mix, pieces, cost and profit add up', () => {
  const r = explainDay(base, { spend: 500, purchases: 10, purchase_value: 2490, clicks: 300 }, { kind: 'sheet', sheet_name: 'X', tiers });
  assert.equal(r.calc.method, 'sheet_exact');
  assert.deepEqual(r.calc.method === 'sheet_exact' && r.calc.mix.map(Math.round), [5, 5]);
  assert.ok(Math.abs(r.cost_low! - (5 * 98.93 + 5 * 175.93)) < 1e-6);
  assert.ok(Math.abs(r.revenue - r.cost_high! - r.spend - r.profit_low!) < 1e-6);
  assert.ok(Math.abs(r.units_low! - 15) < 1e-9);
});

test('sheet with a mix that cannot be solved: ratio range; product line: pieces from price', () => {
  const r = explainDay(base, { spend: 500, purchases: 10, purchase_value: 4000, clicks: 0 }, { kind: 'sheet', sheet_name: 'X', tiers });
  assert.equal(r.calc.method, 'sheet_ratio');
  assert.ok(r.cost_high! > r.cost_low!);
  const p = explainDay(base, { spend: 100, purchases: 5, purchase_value: 1000, clicks: 0 }, {
    kind: 'product', product: '801', econ: { cost_per_unit: 100, price_per_unit_min: 200, price_per_unit_max: 200 }, extra: 0, cod: { share: 0, fee: 0 },
  });
  assert.equal(p.calc.method, 'product');
  assert.deepEqual([p.units_low, p.cost_low, p.profit_low], [5, 500, 400]);
  const none = explainDay(base, { spend: 100, purchases: 1, purchase_value: 200, clicks: 0 }, {
    kind: 'product', product: '801', econ: { cost_per_unit: 100, price_per_unit_min: null, price_per_unit_max: null }, extra: 0, cod: { share: 0, fee: 0 },
  });
  assert.deepEqual([none.calc.method, none.profit_low], ['none', null]);
});
