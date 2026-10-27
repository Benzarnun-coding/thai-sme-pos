import assert from 'node:assert/strict';
import { test } from 'node:test';
import { costTiers } from './costing.ts';
import { codOf, DEFAULT_ORDER_FEES } from './db.ts';
import { economics, type CostRow, type Section } from './model.ts';
import { orderFees } from './p365.ts';
import { catalogCostOf, codeCandidates, withCatalogCosts, type CatalogCostRow } from './unitCosts.ts';

const cat = (code: string, cost: number | null, typed: number | null = null): CatalogCostRow => ({ code, cost, typed });

test('linked product codes expand to catalog codes', () => {
  assert.deepEqual(codeCandidates('501/1-3').exact[0], ['501/1-3', '501/1', '501/2', '501/3']);
  assert.deepEqual(codeCandidates('E444/5-6-7').exact[0].slice(1), ['E444/5', 'E444/6', 'E444/7']);
  assert.deepEqual(codeCandidates('KZ-070-073').exact[0].slice(1), ['KZ-070', 'KZ-071', 'KZ-072', 'KZ-073']);
  assert.deepEqual(codeCandidates('444/1-444/2').exact[0].slice(1), ['444/1', '444/2']);
  assert.deepEqual(codeCandidates('N นูดดี้ 888/1-6').exact[1].slice(1, 3), ['888/1', '888/2']);
  assert.deepEqual(codeCandidates('801').families, ['801/']);
  assert.deepEqual(codeCandidates('LX-154').exact, [['LX-154']]);
});

test('catalog cost: typed cost wins, sizes averaged, codes averaged, family as last resort', () => {
  const rows = [cat('501/1', 110), cat('501/2', 110), cat('501/3', null, 120), cat('801/1', null), cat('801/2', 117), cat('LX-154', 200), cat('LX-154', 210)];
  assert.deepEqual(catalogCostOf('501/1-3', rows), { cost: (110 + 110 + 120) / 3, codes: ['501/1', '501/2', '501/3'] });
  assert.deepEqual(catalogCostOf('801', rows), { cost: 117, codes: ['801/2'] });
  assert.deepEqual(catalogCostOf('lx-154', rows), { cost: 205, codes: ['LX-154'] });
  assert.equal(catalogCostOf('E200', [cat('E200', null)]), null);
});

test('cost rows: catalog replaces the typed cost, otherwise the typed one stays', () => {
  const row = (code: string, avg: number): CostRow => ({ tab: 'WEB', code, name: code, sku_count: 1, avg_cost: avg, min_cost: avg, max_cost: avg, avg_price: 249 });
  const [a, b] = withCatalogCosts([row('501/1-3', 142.43), row('E200', 149)], [cat('501/1', 110)]);
  assert.equal(a.avg_cost, 110);
  assert.equal(a.cost_from, 'catalog');
  assert.equal(b.avg_cost, 149);
  assert.equal(b.cost_from, 'typed');
});

test('ads fees per order match orderFees on Page365 orders (no COD share)', () => {
  const fees = { cod_pct: 1, loss_pct: 1, ship: 15, vat_pct: 7, vat_base: 'after_ship' as const, bag: 1 };
  const cod = codOf({ cod_share_pct: 0, cod_fee: 50, order_fees: fees });
  for (const total of [249, 599]) {
    const want = orderFees({ total, payment: 'transfer', shipping: 0 }, fees);
    assert.ok(Math.abs(total * cod.pct! + cod.per_order! - want) < 1e-9);
  }
  // "โพสผี : 501/1" 1 for 249 with catalog ทุน 110 → 110 + the same fees
  const [t] = costTiers([{ units: 1, price: 249 }], 110, cod);
  assert.ok(Math.abs(t.cost - (110 + orderFees({ total: 249, payment: 'transfer', shipping: 0 }, fees))) < 1e-9);
  assert.deepEqual(codOf({ cod_share_pct: 0, cod_fee: 50 }), { share: 0, fee: 50 });
  assert.ok(codOf({ cod_share_pct: 50, cod_fee: 50, order_fees: DEFAULT_ORDER_FEES }).pct! > 0);
});

test('break-even includes the per-order fees', () => {
  const section: Section = { id: 's', name: 's', keywords: [], products: [{ tab: 'WEB', code: 'X' }], tiers: [{ units: 1, price: 200 }], units_per_order: 1, extra_cost_per_order: 0, price_per_order: null, sort: 1 };
  const costs: CostRow[] = [{ tab: 'WEB', code: 'X', name: 'X', sku_count: 1, avg_cost: 100, min_cost: 100, max_cost: 100, avg_price: 200 }];
  const m = { spend: 1000, purchases: 10, purchase_value: 2000 };
  const plain = economics(section, costs, m);
  const withFees = economics(section, costs, m, { share: 0, fee: 0, pct: 0.1, per_order: 20 });
  assert.equal(plain.breakeven_roas, 2);
  // margin = 1 − 0.5 − 0.1 − 20/200 = 0.3
  assert.ok(Math.abs(withFees.breakeven_roas! - 1 / 0.3) < 1e-9);
  // profit = 2000 × 0.9 − 10 × 20 − 1000 − 10 pieces × 100
  assert.equal(withFees.profit, -400);
});
