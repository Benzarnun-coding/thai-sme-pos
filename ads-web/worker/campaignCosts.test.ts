import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CampaignCostIndex, coreKey, nameKey, parseCampaignCostSheet, tierEconomics } from './campaignCosts.ts';

const rows = [
  ['โปรลับ : 009 2ตัว299 ฿150', 'ราคาขาย 1 ตัว 199 ', 'ต้นทุน 70+28.93', '98.93'],
  ['', 'ราคาขาย 2 ตัว 299', 'ต้นทุน70+70+35.93', '175.93'],
  ['โพสผี : 501/1 3ตัว599 #1\n', 'ราคาขาย 1 ตัว 249 ', 'ต้นทุน 110+32.43', '142.43'],
  ['', ' ราคาขาย 3 ตัว 599', 'ต้นทุน 330+53.93', '386.93'],
  ['โพสผี : 501 กระบอกไม่ยืด 1 ตัว 199 ฿400\n', 'ราคาขาย 1 ตัว 199', 'ต้นทุน 110+28.93', '138.93'],
  ['', '* ไม่มีราคาโปร'],
  ['9723 2 ตัว 399.-', 'ราคาขาย 1ตัว  249', 'ต้นทุน 65+32.43', ''],
  ['C. MONKEY', 'ราคาขาย 1 ตัว 459', '225+47.13', '272.13'],
  ['', 'ราคาขาย 2 ตัว 899', '450+77.93', '527.93'],
  ['', 'ราคาขาย 3 ตัว 1,200', '675+99', '774'],
  ['โพสผี : 501 กระบอกไม่ยืด 1 ตัว 199 ฿400', 'ราคาขาย 1 ตัว 199', '', '999'],
];

test('sheet blocks: one per campaign, promos with all-in cost, stray line breaks, cost from C when D is empty', () => {
  const c = parseCampaignCostSheet(rows);
  assert.equal(c.length, 5);
  assert.deepEqual(c[0], { name: 'โปรลับ : 009 2ตัว299 ฿150', tiers: [{ units: 1, price: 199, cost: 98.93 }, { units: 2, price: 299, cost: 175.93 }] });
  assert.equal(c[1].name, 'โพสผี : 501/1 3ตัว599 #1');
  assert.deepEqual(c[2].tiers, [{ units: 1, price: 199, cost: 138.93 }]); // repeated name keeps the first block
  assert.ok(Math.abs(c[3].tiers[0].cost - 97.43) < 1e-9);
  assert.deepEqual(c[4].tiers.map((t) => t.price), [459, 899, 1200]);
  assert.equal(nameKey('โพสผี :  501/1 3ตัว599 #1\n'), nameKey('โพสผี : 501/1 3ตัว599 #1'));
});

test('two promos: the order mix is solved exactly', () => {
  // 10 orders, value 2,490 = 5×199 + 5×299 → cost 5×98.93 + 5×175.93
  const e = tierEconomics([{ units: 1, price: 199, cost: 98.93 }, { units: 2, price: 299, cost: 175.93 }], { spend: 500, purchases: 10, purchase_value: 2490 });
  assert.equal(e.exact, true);
  assert.ok(Math.abs(e.profit_low! - (2490 - 5 * 98.93 - 5 * 175.93 - 500)) < 1e-6);
  assert.equal(e.profit_low, e.profit_high);
  assert.ok(Math.abs(e.units_low! - 15) < 1e-9);
});

test('average order outside the promos, or three promos: a range from cost ÷ price', () => {
  const tiers = [{ units: 1, price: 199, cost: 98.93 }, { units: 2, price: 299, cost: 175.93 }];
  const e = tierEconomics(tiers, { spend: 500, purchases: 10, purchase_value: 4000 }); // AOV 400 > 299
  assert.equal(e.exact, false);
  assert.ok(Math.abs(e.profit_low! - (4000 - 4000 * (175.93 / 299) - 500)) < 1e-6);
  assert.ok(e.profit_high! > e.profit_low!);
  assert.ok(Math.abs(e.breakeven_roas! - 1 / (1 - 175.93 / 299)) < 1e-9);
  const one = tierEconomics([{ units: 1, price: 199, cost: 138.93 }], { spend: 100, purchases: 3, purchase_value: 600 });
  assert.equal(one.profit_low, one.profit_high);
  assert.equal(tierEconomics(tiers, undefined).profit_low, null);
});

test('same campaign with another budget or version finds the cost; exact name wins; costliest when they differ', () => {
  assert.equal(coreKey('โพสผี : 501 กระบอกไม่ยืด 1 ตัว 199 ฿200'), coreKey('โพสผี : 501 กระบอกไม่ยืด 1 ตัว 199 ฿200 V3'));
  assert.equal(coreKey('STE 2ตัว399 -50฿'), 'ste 2ตัว399');
  assert.notEqual(coreKey('โพสผี : 501 กระบอกไม่ยืด 1 ตัว 189 ฿50'), coreKey('โพสผี : 501 กระบอกไม่ยืด 1 ตัว 199 ฿50'));
  const a = { name: 'X 1 ตัว 199 ฿400', tiers: [{ units: 1, price: 199, cost: 138.93 }] };
  const b = { name: 'X 1 ตัว 199 ฿300 V2', tiers: [{ units: 1, price: 199, cost: 150 }] };
  const idx = new CampaignCostIndex(new Map([[nameKey(a.name), a], [nameKey(b.name), b]]));
  assert.deepEqual(idx.find('X 1 ตัว 199 ฿400'), { cost: a, match: 'exact' });
  assert.deepEqual(idx.find('X 1 ตัว 199 ฿200'), { cost: b, match: 'similar' });
  assert.equal(idx.find('Y 1 ตัว 199'), null);
});
