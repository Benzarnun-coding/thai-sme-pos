import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCardCorrections, type Card } from './billCards.ts';

// Bangkok 09:xx on 26 Oct = 02:xx UTC.
const card = (min: number, campaign: string | null, lastSale: string | null): Card => ({ psid: `p${min}`, at: `2026-10-26T02:${String(min).padStart(2, '0')}:00.000Z`, campaign_id: campaign, last_sale: lastSale });
const SAT = '2026-10-24T05:00:00.000Z', SUN_EVENING = '2026-10-25T13:00:00.000Z';

test('Monday bill cards for weekend orders are subtracted, capped at Meta\'s excess for the hour', () => {
  const cards = [card(1, 'c1', SAT), card(2, 'c1', SAT), card(3, 'c2', SAT), card(4, 'c2', SUN_EVENING), card(5, null, null)];
  // Meta 09:00: c1 3, c2 2 = 5; ours 1 → excess 4. Counted cards: 4 (the Sunday-evening one is within 24 h).
  const p = planCardCorrections('2026-10-26', cards, [{ campaign_id: 'c1', hour: '09:00', purchases: 3, value: 1350 }, { campaign_id: 'c2', hour: '09:00', purchases: 2, value: 900 }], [{ hour: '09:00', purchases: 1, value: 450 }]);
  assert.equal(p.purchases, 4);
  assert.deepEqual(p.rows.map((r) => [r.campaign_id, r.purchases]).sort(), [['', 1], ['c1', 2], ['c2', 1]]);
  assert.equal(p.value, 1800);
  assert.deepEqual(p.hours[0], { hour: '09:00', cards: 5, counted: 4, meta: 5, ours: 1, take: 4 });
});

test('weekday cards (our sale the same day) and hours where Meta matches us take nothing', () => {
  const p = planCardCorrections('2026-10-26', [card(1, 'c1', '2026-10-26T01:00:00.000Z'), card(2, 'c1', SAT)], [{ campaign_id: 'c1', hour: '09:00', purchases: 2, value: 900 }], [{ hour: '09:00', purchases: 2, value: 900 }]);
  assert.equal(p.purchases, 0);
  assert.equal(p.rows.length, 0);
});

test('a card whose campaign has no Meta purchase left that hour goes to unknown', () => {
  const p = planCardCorrections('2026-10-26', [card(1, 'c9', SAT), card(2, 'c1', SAT)], [{ campaign_id: 'c1', hour: '09:00', purchases: 2, value: 800 }], []);
  assert.deepEqual(p.rows.map((r) => [r.campaign_id, r.purchases]).sort(), [['', 1], ['c1', 1]]);
});
