import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Entity, Metrics } from '../../ads-engine/src/types.ts';
import { campaignBreakevens, MIN_ORDERS, ordersBreakeven } from './breakevens.ts';
import { buildGroups, planDecisions, sectionMap } from './engine.ts';
import { NO_COD, type CampaignSetting, type CostRow, type Section, type Stage, type WebRule } from './model.ts';
import type { StoredOrder } from './p365.ts';
import type { OrderFees } from './db.ts';

const NO_FEES: OrderFees = { cod_pct: 0, loss_pct: 0, ship: 0, vat_pct: 0, vat_base: 'total', bag: 0 };
const section = (over: Partial<Section>): Section => ({ id: 's1', name: 'S1', keywords: [], products: [], tiers: [], units_per_order: 1, extra_cost_per_order: 0, price_per_order: null, sort: 0, ...over });
const DEFAULT = section({ id: 'default', name: 'ยังไม่ระบุสินค้า', sort: 999 });
const cost = (tab: string, code: string, c: number, price = 0): CostRow => ({ tab, code, name: code, sku_count: 1, avg_cost: c, min_cost: c, max_cost: c, avg_price: price });
const m = (spend: number, purchases: number, value: number): Metrics => ({ spend, impressions: 0, clicks: 0, purchases, purchase_value: value, roas: spend ? value / spend : 0, cpa: purchases ? spend / purchases : Infinity, ctr: 0, cpc: 0, frequency: 1, messages: 0, cost_per_message: Infinity });
const campaign = (id: string, name: string, metrics: Metrics): Entity => ({ level: 'campaign', id, name, campaign_id: id, campaign_name: name, status: 'ACTIVE', daily_budget: 1000, metrics: { last_3d: metrics, last_7d: metrics } });
const orders = (campaign_id: string, n: number, total: number, c: number | null): StoredOrder[] => Array.from({ length: n }, (_, i) => ({
  order_no: `${campaign_id}-${i}`, date: '2026-10-20', created_at: '', total, subtotal: null, discount: null, shipping: 0, cost: c, payment: 'cod', paid_at: null,
  units: 3, items: [], name_hash: null, campaign_id, match: 'customer',
}));

test('break-even from orders: revenue ÷ (revenue − cost − fees), only with enough costed orders', () => {
  // ni9 3 for 499: cost 360 → 499 / 139 ≈ 3.59 (the catalog's 324 a piece made it 1.84)
  assert.ok(Math.abs(ordersBreakeven(orders('a', MIN_ORDERS, 499, 360), NO_FEES)!.be - 499 / 139) < 1e-9);
  assert.equal(ordersBreakeven(orders('a', MIN_ORDERS - 1, 499, 360), NO_FEES), null);
  // orders without a cost don't count towards the minimum
  assert.equal(ordersBreakeven([...orders('a', MIN_ORDERS - 1, 499, 360), ...orders('b', 5, 499, null)], NO_FEES), null);
  assert.equal(ordersBreakeven(orders('a', MIN_ORDERS, 100, 120), NO_FEES), null);
});

test('own orders → product line orders → promo price → catalog price → shop', () => {
  const ni9 = section({ id: 'ni9', name: 'Ni9-1', products: [{ tab: 'PK', code: 'Ni9-1' }] });
  const e200 = section({ id: 'e200', name: 'E200', products: [{ tab: 'PK', code: '200' }] });
  const costs = [cost('PK', 'Ni9-1', 120, 324), cost('PK', '200', 115, 249)];
  const cs = [
    campaign('own', 'ni9 ผ้าสี 3ตัว499', m(1000, 20, 10000)),
    campaign('line', 'ni9 ใหม่', m(100, 1, 499)),
    campaign('promo', 'E200 1ตัว199', m(100, 1, 199)),
    campaign('list', 'E200 ไม่มีโปร', m(100, 1, 249)),
    campaign('none', 'ยังไม่ผูก', m(100, 1, 300)),
  ];
  const sectionOf = new Map([['own', 'ni9'], ['line', 'ni9'], ['promo', 'e200'], ['list', 'e200'], ['none', 'default']]);
  const bes = campaignBreakevens(cs, [ni9, e200, DEFAULT], sectionOf, [...orders('own', 20, 499, 360), ...orders('promo', 3, 199, 115)], costs, NO_COD, NO_FEES, 2.91);
  assert.deepEqual([...bes].map(([id, b]) => [id, b.be, b.source.split(' ')[0]]), [
    ['own', 3.59, 'ออเดอร์จริงของแคมเปญ'],
    ['line', 3.59, 'ออเดอร์จริงของสินค้า'],
    ['promo', 2.37, 'ราคาโปร'],          // 199 / (199 − 115)
    ['list', 1.86, 'ราคาแคตตาล็อก'],     // 249 / (249 − 115)
    ['none', 2.91, 'คุ้มทุนรวมร้าน'],
  ]);
});

const boost: WebRule = { id: 'boost', level: 'campaign', window: 'last_3d', metric: 'roas', op: '>=', value: 1.5, value_mode: 'x_breakeven', action: { type: 'budget_pct', pct: 20 } };
const setting = (id: string): CampaignSetting => ({ campaign_id: id, section_id: null, stage_id: 'winning', stage_since: null, mode: 'stage', rules: null });

test('the engine judges each campaign against its own break-even when given', () => {
  const s = section({ id: 'p', keywords: ['P'], products: [{ tab: 'PK', code: 'P' }], price_per_order: 300 }); // catalog BE 1.5 → boost at 2.25
  const entities = [campaign('cheap', 'P cheap', m(1000, 10, 3000)), campaign('dear', 'P dear', m(1000, 10, 3000))]; // both ROAS 3
  const settings = new Map([['cheap', setting('cheap')], ['dear', setting('dear')]]);
  const stages: Stage[] = [{ id: 'winning', name: 'ทำเงิน', description: '', rules: [boost], automation: true, sort: 0 }];
  const sections = [s, DEFAULT];
  const sectionOf = sectionMap(entities, sections, settings);
  const groups = buildGroups(entities, sections, stages, settings, sectionOf);
  const plan = (per?: Map<string, { be: number; source: string }>) =>
    planDecisions(groups, entities, sectionOf, [cost('PK', 'P', 100)], settings, stages, { last_action: {} }, new Date(), NO_COD, null, Infinity, per)
      .decisions.map((d) => [d.entity.id, d.threshold]);
  assert.deepEqual(plan(), [['cheap', 2.25], ['dear', 2.25]]);
  // dear's orders say BE 2.5 → boost only at 3.75; cheap has none → keeps the product line's
  assert.deepEqual(plan(new Map([['dear', { be: 2.5, source: 'ออเดอร์จริงของแคมเปญ 20 ใบ' }]])), [['cheap', 2.25]]);
});
