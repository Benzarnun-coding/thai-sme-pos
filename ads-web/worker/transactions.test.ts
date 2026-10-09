import assert from 'node:assert/strict';
import { test } from 'node:test';
import { campaignDay, matchHour } from './transactions.ts';

const tiers = [{ units: 1, price: 199, cost: 138.93 }, { units: 2, price: 349, cost: 250 }];

test('one order: exact promo, promo + COD, several sets, no match, no value', () => {
  assert.deepEqual(matchHour('08:00', 1, 349, tiers, 50).map((o) => [o.status, o.sets.map((s) => s.price), o.cod]), [['match', [349], 0]]);
  assert.deepEqual(matchHour('08:00', 1, 249, tiers, 50).map((o) => [o.status, o.sets.map((s) => s.price), o.cod, o.cost]), [['match', [199], 50, 138.93]]);
  assert.deepEqual(matchHour('08:00', 1, 698, tiers, 50)[0].sets.map((s) => s.price), [349, 349]);
  const miss = matchHour('08:00', 1, 450, tiers, 50)[0];
  assert.equal(miss.status, 'mismatch');
  assert.ok(Math.abs(miss.cost - 450 * (250 / 349)) < 1e-9); // conservative: costliest promo ratio
  assert.equal(matchHour('08:00', 1, 0, tiers, 50)[0].status, 'no_value');
});

test('several orders in one hour are split into promos when they add up; otherwise kept together', () => {
  const two = matchHour('09:00', 2, 548, tiers, 50); // 199 + 349
  assert.deepEqual(two.map((o) => o.value).sort(), [199, 349]);
  const blob = matchHour('09:00', 2, 777, tiers, 50);
  assert.deepEqual(blob.map((o) => [o.status, o.count]), [['unsplit', 2]]);
});

test('a day: count, value, cost, match rate', () => {
  const d = campaignDay([{ hour: '08:00', purchases: 1, purchase_value: 349 }, { hour: '09:00', purchases: 1, purchase_value: 451 }], tiers, 50);
  assert.equal(d.count, 2);
  assert.equal(d.value, 800);
  assert.equal(d.matched, 1);
  assert.ok(Math.abs(d.match_rate - 349 / 800) < 1e-9);
});
