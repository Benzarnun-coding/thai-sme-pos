import assert from 'node:assert/strict';
import { test } from 'node:test';
import { costTiers } from './costing.ts';
import { codOf, DEFAULT_ORDER_FEES } from './db.ts';
import { economics, type CostRow, type Section } from './model.ts';
import { orderFees } from './p365.ts';
import { catalogCostOf, catalogLinkRows, codeCandidates, withCatalogCosts, type CatalogCostRow } from './unitCosts.ts';

const cat = (code: string, cost: number | null, typed: number | null = null): CatalogCostRow => ({ code, cost, typed });

test('linked product codes expand to catalog codes', () => {
  assert.deepEqual(codeCandidates('501/1-3').exact[0], ['501/1-3', '501/1', '501/2', '501/3']);
  assert.deepEqual(codeCandidates('E444/5-6-7').exact[0].slice(1), ['E444/5', 'E444/6', 'E444/7']);
  assert.deepEqual(codeCandidates('KZ-070-073').exact[0].slice(1), ['KZ-070', 'KZ-071', 'KZ-072', 'KZ-073']);
  assert.deepEqual(codeCandidates('444/1-444/2').exact[0].slice(1), ['444/1', '444/2']);
  assert.deepEqual(codeCandidates('N นูดดี้ 888/1-6').exact[1].slice(1, 3), ['888/1', '888/2']);
  assert.deepEqual(codeCandidates('801').families, ['801/', '801-']);
  assert.deepEqual(codeCandidates('AR 16').families, ['16/', '16-']);
  assert.deepEqual(codeCandidates('BAGGY 711-714').suffixes, ['-711', '-712', '-713', '-714']);
  assert.deepEqual(codeCandidates('LX-154').exact, [['LX-154']]);
});

test('catalog cost: typed cost wins, the cost most sizes have, codes averaged, family as last resort', () => {
  const rows = [cat('501/1', 110), cat('501/2', 110), cat('501/3', null, 120), cat('801/1', null), cat('801/2', 117), cat('LX-154', 200), cat('LX-154', 210), cat('501/1', 135), cat('501/1', 110)];
  assert.deepEqual(catalogCostOf('501/1-3', rows), { cost: (110 + 110 + 120) / 3, codes: ['501/1', '501/2', '501/3'], price: null });
  assert.deepEqual(catalogCostOf('801', rows), { cost: 117, codes: ['801/2'], price: null });
  assert.deepEqual(catalogCostOf('lx-154', rows), { cost: 210, codes: ['LX-154'], price: null });
  assert.equal(catalogCostOf('E200', [cat('E200', null)]), null);
  assert.deepEqual(catalogCostOf('AR 16', [cat('16-1', 170), cat('16-2', 170), cat('160', 999)]), { cost: 170, codes: ['16-1', '16-2'], price: null });
  assert.deepEqual(catalogCostOf('BAGGY 711-714', [cat('RL-711', 210), cat('RL-714', 190), cat('L711', null)]), { cost: 200, codes: ['RL-711', 'RL-714'], price: null });
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

test('a product picked from the catalog (PK · 200) gets a cost row from that tab only', () => {
  const section = (products: { tab: string; code: string }[]) => ({ id: 's', name: 's', keywords: [], products, tiers: [], units_per_order: 1, extra_cost_per_order: 0, price_per_order: null, sort: 1 });
  const links = catalogLinkRows([section([{ tab: 'PK', code: '200' }, { tab: 'WEB', code: 'E200' }])], []);
  assert.deepEqual(links.map((r) => `${r.tab}|${r.code}`), ['PK|200']);
  const [r] = withCatalogCosts(links, [{ tab: 'BB', code: '200', cost: 999, typed: null }, { tab: 'PK', code: '200', cost: 115, typed: null, price: 311 }]);
  assert.equal(r.avg_cost, 115);
  assert.equal(r.avg_price, 311);
  assert.equal(r.cost_from, 'catalog');
});
