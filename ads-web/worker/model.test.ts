import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Entity, Metrics } from '../../ads-engine/src/types.ts';
import { economics, materializeRules, parseCostQuery, parseCsv, resolveSectionId, suggestProducts, type CampaignSetting, type CostRow, type Section, type Stage, type WebRule } from './model.ts';
import { buildGroups, planDecisions, sectionMap } from './engine.ts';

function section(over: Partial<Section>): Section {
  return {
    id: 's1', name: 'S1', keywords: [], products: [], tiers: [], units_per_order: 1, extra_cost_per_order: 0,
    price_per_order: null, sort: 0, ...over,
  };
}
function stage(id: string, rules: WebRule[]): Stage {
  return { id, name: id, description: '', rules, automation: true, sort: 0 };
}
function setting(campaign_id: string, over: Partial<CampaignSetting>): CampaignSetting {
  return { campaign_id, section_id: null, stage_id: null, stage_since: null, mode: 'stage', rules: null, ...over };
}
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const DEFAULT = section({ id: 'default', name: 'ยังไม่จัดกลุ่ม', sort: 999 });
const cost = (tab: string, code: string, avg_cost: number): CostRow =>
  ({ tab, code, name: code, sku_count: 1, avg_cost, min_cost: avg_cost, max_cost: avg_cost, avg_price: avg_cost * 2.7 });

function metrics(spend: number, purchases: number, purchase_value: number): Metrics {
  return {
    spend, purchases, purchase_value, impressions: 1000, clicks: 20, ctr: 2, cpc: 3, frequency: 1.5,
    cpa: purchases ? spend / purchases : Infinity, roas: spend ? purchase_value / spend : 0, messages: 0, cost_per_message: Infinity,
  };
}
function campaign(id: string, name: string, m: Metrics, daily_budget = 500): Entity {
  return { level: 'campaign', id, name, campaign_id: id, campaign_name: name, status: 'ACTIVE', daily_budget, metrics: { last_7d: m } };
}

test('explicit assignment beats keyword, keyword beats default', () => {
  const s801 = section({ id: 's801', keywords: ['801'] });
  const sections = [s801, section({ id: 's501', keywords: ['501'] }), DEFAULT];
  const none = new Map<string, CampaignSetting>();
  assert.equal(resolveSectionId({ id: 'c1', name: 'REV 801 - กระบอกยืด' }, sections, none), 's801');
  assert.equal(resolveSectionId({ id: 'c2', name: 'แอดผี : E200' }, sections, none), 'default');
  const pinned = new Map([['c1', setting('c1', { section_id: 's501' })]]);
  assert.equal(resolveSectionId({ id: 'c1', name: 'REV 801' }, sections, pinned), 's501');
});

test('promo tiers: pieces ≈ value ÷ price per piece, profit as a range, break-even at the cheapest price', () => {
  // 801: 1 for 189, 3 for 549 (183 each). All-in cost 100 per piece. Real 21–27 Sep week: 29 orders, value 16,048, spend 2,114.
  const s = section({ products: [{ tab: 'PK', code: '801' }], tiers: [{ units: 1, price: 189 }, { units: 3, price: 549 }] });
  const e = economics(s, [cost('PK', '801', 100)], metrics(2114, 29, 16048));
  assert.equal(e.price_source, 'tiers');
  assert.equal(e.price_per_unit_min, 183);
  assert.equal(e.price_per_unit_max, 189);
  assert.ok(Math.abs(e.units_high! - 16048 / 183) < 1e-9);
  assert.ok(Math.abs(e.units_low! - 16048 / 189) < 1e-9);
  assert.ok(Math.abs(e.profit! - (16048 - (16048 / 183) * 100 - 2114)) < 1e-9);
  assert.ok(e.profit_high! > e.profit!);
  // Break-even: 1 / (1 − 100/183) at worst, 1 / (1 − 100/189) at best
  assert.ok(Math.abs(e.breakeven_roas! - 183 / 83) < 1e-9);
  assert.ok(Math.abs(e.breakeven_best! - 189 / 89) < 1e-9);
});

test('price falls back to manual price per order, then the sheet price; Infinity when cost ≥ price', () => {
  const manual = economics(section({ products: [{ tab: 'PK', code: 'X' }], units_per_order: 3, price_per_order: 600 }), [cost('PK', 'X', 100)], metrics(1000, 10, 6000));
  assert.deepEqual([manual.price_source, manual.price_per_unit_min, manual.breakeven_roas], ['manual', 200, 2]);
  const sheet = economics(section({ products: [{ tab: 'PK', code: 'X' }] }), [{ ...cost('PK', 'X', 150), avg_price: 299 }], metrics(1000, 10, 2990));
  assert.equal(sheet.price_source, 'sheet');
  assert.ok(Math.abs(sheet.breakeven_roas! - 299 / 149) < 1e-9);
  const loss = economics(section({ products: [{ tab: 'PK', code: 'X' }], tiers: [{ units: 2, price: 250 }] }), [cost('PK', 'X', 150)], metrics(1000, 10, 2500));
  assert.equal(loss.breakeven_roas, Infinity);
  const unlinked = economics(section({ products: [{ tab: 'PK', code: 'NOPE' }] }), [], metrics(1000, 10, 3000));
  assert.equal(unlinked.breakeven_roas, null);
  assert.equal(unlinked.profit, null);
  assert.deepEqual(unlinked.missing_products, [{ tab: 'PK', code: 'NOPE' }]);
});

test('COD surcharge in the tagged value is income but not pieces', () => {
  // 10 orders, all COD (+50 each): value 6,000 = 5,500 of pants at 200/piece + 500 surcharge. Cost 100/piece.
  const s = section({ products: [{ tab: 'PK', code: 'X' }], tiers: [{ units: 1, price: 200 }] });
  const e = economics(s, [cost('PK', 'X', 100)], metrics(1000, 10, 6000), { share: 1, fee: 50 });
  assert.ok(Math.abs(e.units_low! - 27.5) < 1e-9);
  assert.ok(Math.abs(e.profit! - (6000 - 27.5 * 100 - 1000)) < 1e-9);
  // Break-even: ROAS where 6000-style revenue covers cost: margin = 1 − 0.5 + 50·0.5/600
  assert.ok(Math.abs(e.breakeven_roas! - 1 / (0.5 + 25 / 600)) < 1e-9);
  // Without COD set, the surcharge is counted as pieces (more cost, lower profit)
  assert.ok(economics(s, [cost('PK', 'X', 100)], metrics(1000, 10, 6000)).profit! < e.profit!);
});

test('extra cost per order lowers the margin through the average order value', () => {
  const e = economics(section({ products: [{ tab: 'PK', code: 'X' }], tiers: [{ units: 1, price: 200 }], extra_cost_per_order: 40 }), [cost('PK', 'X', 100)], metrics(1000, 10, 4000));
  // margin = 1 − 100/200 − 40/400 = 0.4
  assert.ok(Math.abs(e.breakeven_roas! - 2.5) < 1e-9);
  assert.ok(Math.abs(e.profit! - (4000 - 20 * 100 - 10 * 40 - 1000)) < 1e-9);
});

const beRule: WebRule = { id: 'scale', level: 'campaign', window: 'last_7d', metric: 'roas', op: '>=', value: 1.5, value_mode: 'x_breakeven', action: { type: 'budget_pct', pct: 20 } };

test('x_breakeven rules become absolute, or are dropped with a note; move rules come back separately', () => {
  assert.equal(materializeRules([beRule], 2).actions[0].value, 3);
  assert.equal('value_mode' in materializeRules([beRule], 2).actions[0], false);
  const dropped = materializeRules([beRule], null);
  assert.equal(dropped.actions.length, 0);
  assert.equal(dropped.notes.length, 1);
  assert.equal(materializeRules([{ ...beRule, enabled: false }], 2).actions.length, 0);
  const m = materializeRules([{ ...beRule, action: { type: 'move', to: 'winning' }, min_days_in_stage: 3 }], 2);
  assert.equal(m.actions.length, 0);
  assert.deepEqual([m.moves[0].to, m.moves[0].value, m.moves[0].action.type, m.moves[0].min_days_in_stage], ['winning', 3, 'notify', 3]);
});

test('one stage rule set, different thresholds per product; no stage, off and custom are respected', () => {
  // Cheap product: BE = 300/(300-100) = 1.5 → scale at ROAS >= 2.25. Expensive: BE = 300/(300-200) = 3 → scale at >= 4.5.
  const cheap = section({ id: 'cheap', keywords: ['CHEAP'], products: [{ tab: 'PK', code: 'C' }], price_per_order: 300 });
  const pricey = section({ id: 'pricey', keywords: ['PRICEY'], products: [{ tab: 'PK', code: 'P' }], price_per_order: 300 });
  const costs = [cost('PK', 'C', 100), cost('PK', 'P', 200)];
  const entities = [
    campaign('c1', 'CHEAP a', metrics(1000, 10, 3000)),    // ROAS 3 ≥ 2.25 → scale
    campaign('c2', 'PRICEY a', metrics(1000, 10, 3000)),   // ROAS 3 < 4.5 → nothing
    campaign('c3', 'CHEAP off', metrics(1000, 10, 3000)),  // automation off for this campaign
    campaign('c4', 'CHEAP custom', metrics(1000, 10, 3000)), // own rule needs 5 × BE
    campaign('c5', 'CHEAP no stage', metrics(1000, 10, 3000)), // never put in a stage → untouched
  ];
  const settings = new Map<string, CampaignSetting>([
    ['c1', setting('c1', { stage_id: 'winning' })],
    ['c2', setting('c2', { stage_id: 'winning' })],
    ['c3', setting('c3', { stage_id: 'winning', mode: 'off' })],
    ['c4', setting('c4', { stage_id: 'winning', mode: 'custom', rules: [{ ...beRule, id: 'own', value: 5 }] })],
  ]);
  const sections = [cheap, pricey, DEFAULT];
  const stages = [stage('winning', [beRule])];
  const sectionOf = sectionMap(entities, sections, settings);
  const groups = buildGroups(entities, sections, stages, settings, sectionOf);
  const plan = planDecisions(groups, entities, sectionOf, costs, settings, stages, { last_action: {} }, new Date());
  assert.deepEqual(plan.decisions.map((d) => d.entity.id), ['c1']);
  assert.equal(plan.decisions[0].threshold, 2.25);
  assert.deepEqual(groups.map((g) => g.key).sort(), ['campaign:c4', 'stage:winning|section:cheap', 'stage:winning|section:pricey']);
});

test('stage moves need the condition, enough purchases and enough days in the stage', () => {
  const s = section({ id: 'p', keywords: ['P'], products: [{ tab: 'PK', code: 'P' }], price_per_order: 300 }); // BE 1.5
  const promote: WebRule = {
    id: 'to-winning', level: 'campaign', window: 'last_7d', metric: 'roas', op: '>=', value: 1.3, value_mode: 'x_breakeven',
    min_purchases: 10, action: { type: 'move', to: 'winning' }, min_days_in_stage: 3,
  };
  const entities = [
    campaign('old', 'P old', metrics(1000, 12, 3000)),    // ROAS 3 ≥ 1.95, 12 buys, 5 days → moves
    campaign('young', 'P young', metrics(1000, 12, 3000)), // only 1 day in testing → reported, not moved
    campaign('few', 'P few', metrics(1000, 4, 3000)),     // 4 buys < 10 → no move at all
  ];
  const settings = new Map<string, CampaignSetting>([
    ['old', setting('old', { stage_id: 'testing', stage_since: daysAgo(5) })],
    ['young', setting('young', { stage_id: 'testing', stage_since: daysAgo(1) })],
    ['few', setting('few', { stage_id: 'testing', stage_since: daysAgo(5) })],
  ]);
  const stages = [stage('testing', [promote]), stage('winning', [])];
  const sections = [s, DEFAULT];
  const sectionOf = sectionMap(entities, sections, settings);
  const plan = planDecisions(buildGroups(entities, sections, stages, settings, sectionOf), entities, sectionOf, [cost('PK', 'P', 100)], settings, stages, { last_action: {} }, new Date());
  assert.deepEqual(plan.moves.map((m) => [m.entity.id, m.move_from, m.move_to, m.skipped_reason ?? 'move']), [
    ['old', 'testing', 'winning', 'move'],
    ['young', 'testing', 'winning', 'อยู่ในกลุ่มนี้ 1 วัน ยังไม่ครบ 3 วัน'],
  ]);
  assert.equal(plan.decisions.length, 0); // moves are not Meta actions
});

test('parse the aggregated cost query CSV (real BB export format)', () => {
  const csv = [
    '"รหัสสินค้า","count SKU","avg Price","min Price","max Price","avg ","max ตั้งรหัส - [รหัส - ประเภท - คลังสินค้า - สี - size] รายละเอียด"',
    '"007","11","213.63636363636363","210","220","496.8287526427061","007 กางเกงยีนส์ ทรงกระบอก ผ้าไม่ยืด (ซิป) VERZARD สีดำ"',
    '"801/1","11","155","155","155","","801/1 กางเกงยีนส์, LiVE FiVE"',
  ].join('\r\n');
  const rows = parseCostQuery('BB', parseCsv(csv));
  assert.deepEqual(rows.map((r) => [r.code, r.sku_count, r.avg_cost, r.min_cost, r.max_cost, r.avg_price]), [
    ['007', 11, 213.64, 210, 220, 496.83],
    ['801/1', 11, 155, 155, 155, 0],
  ]);
  assert.equal(rows[1].name, '801/1 กางเกงยีนส์, LiVE FiVE');
});

test('codes that differ only by spaces are merged, weighted by SKU count (seen in the MNM tab)', () => {
  const rows = parseCostQuery('MNM', [['X1', '3', '100', '90', '110', '300', 'a'], ['X1 ', '1', '140', '140', '140', '380', 'a']]);
  assert.deepEqual(rows.map((r) => [r.code, r.sku_count, r.avg_cost, r.min_cost, r.max_cost, r.avg_price]), [['X1', 4, 110, 90, 140, 320]]);
});

test('suggest sheet codes from a campaign name', () => {
  const costs = [cost('PK', '801/1', 117), cost('PK', '801/2', 117), cost('CM', '501/D1', 180), cost('PK', '501/1', 110), cost('PK', '9', 1)];
  const codes = suggestProducts('REV 801 - กระบอกยืด 3 ตัว 799', costs).map((c) => c.code);
  assert.deepEqual(codes.sort(), ['801/1', '801/2']);
});
