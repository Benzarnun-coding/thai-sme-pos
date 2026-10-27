import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actualDays, overlayActual } from './actualMetrics.ts';
import type { StoredOrder } from './p365.ts';
import type { Entity, Metrics } from '../../ads-engine/src/types.ts';

const order = (date: string, campaign: string | null, total: number): StoredOrder => ({
  order_no: `${date}-${Math.random()}`, date, created_at: `${date} 10:00:00 +0700`, total, subtotal: null, discount: null, shipping: 0, cost: 100,
  payment: 'cod', paid_at: null, units: 1, items: '', name_hash: null, campaign_id: campaign, match: campaign ? 'exact' : 'none', uploaded_at: '',
} as unknown as StoredOrder);

const metrics = (spend: number, purchases: number, value: number): Metrics => ({
  spend, impressions: 0, clicks: 0, ctr: 0, cpc: 0, purchases, purchase_value: value, cpa: spend / purchases, roas: value / spend, frequency: 0, messages: 0, cost_per_message: Infinity,
});

// 2026-10-14 10:00 Bangkok: last_3d = 11, 12, 13 Oct.
const now = Date.parse('2026-10-14T03:00:00Z');

test('uploaded days swap Meta-tagged purchases for the orders Page365 credited', () => {
  const orders = [order('2026-10-13', 'c1', 500), order('2026-10-13', 'c1', 400), order('2026-10-13', 'c2', 300), order('2026-10-13', 'c2', 300), order('2026-10-13', null, 200)];
  const { days, weak } = actualDays(orders, new Set(['2026-10-13']));
  assert.deepEqual(weak, []);
  assert.deepEqual(days.get('2026-10-13')!.get('c1'), { revenue: 900, orders: 2 });

  const e = { id: 'c1', level: 'campaign', metrics: { last_3d: metrics(300, 4, 1200) } } as unknown as Entity;
  // Meta said c1 sold 1 order / 400 on the 13th (an order untagged); Page365 says 2 / 900.
  const notes = overlayActual([e], ['last_3d'], now, days, [{ campaign_id: 'c1', date: '2026-10-13', spend: 100, purchases: 1, purchase_value: 400 } as any]);
  assert.equal(e.metrics.last_3d!.purchase_value, 1700);
  assert.equal(e.metrics.last_3d!.purchases, 5);
  assert.equal(e.metrics.last_3d!.roas.toFixed(2), (1700 / 300).toFixed(2));
  assert.equal(e.metrics.last_3d!.spend, 300);
  assert.match(notes[0], /1\/3 วัน/);
});

test('a day where few orders were credited keeps Meta numbers', () => {
  const orders = [order('2026-10-13', 'c1', 500), order('2026-10-13', null, 400), order('2026-10-13', null, 300)];
  const { days, weak } = actualDays(orders, new Set(['2026-10-13']));
  assert.equal(days.size, 0);
  assert.deepEqual(weak, ['2026-10-13']);
});

test('a campaign with no real orders on an uploaded day drops to what it really sold', () => {
  const orders = Array.from({ length: 5 }, () => order('2026-10-13', 'c2', 300));
  const { days } = actualDays(orders, new Set(['2026-10-13']));
  const e = { id: 'c1', level: 'campaign', metrics: { last_3d: metrics(300, 3, 900) } } as unknown as Entity;
  overlayActual([e], ['last_3d'], now, days, [{ campaign_id: 'c1', date: '2026-10-13', spend: 100, purchases: 1, purchase_value: 300 } as any]);
  assert.equal(e.metrics.last_3d!.purchase_value, 600);
  assert.equal(e.metrics.last_3d!.purchases, 2);
});

test('a day without a Page365 file keeps Meta numbers less its corrections (Monday bill cards, billCards.ts)', () => {
  // Tuesday 2026-10-27 08:00 run: yesterday = Monday 26 Oct, not uploaded yet; Meta counted 25 bill cards on c1.
  const tue = Date.parse('2026-10-27T01:00:00Z');
  const e = { id: 'c1', level: 'campaign', metrics: { yesterday: metrics(4620, 42, 20818) } } as unknown as Entity;
  const adj = [{ date: '2026-10-26', campaign_id: 'c1', hour: '09:00', purchases: 25, value: 10_000, reason: 'card' }, { date: '2026-10-26', campaign_id: '', hour: '09:00', purchases: 5, value: 2000, reason: 'card' }];
  const notes = overlayActual([e], ['yesterday'], tue, new Map(), [], adj);
  assert.equal(e.metrics.yesterday!.purchases, 17);
  assert.equal(e.metrics.yesterday!.purchase_value, 10_818);
  assert.match(notes[0], /หักยอดที่ Meta นับเกิน 25/);
});

test('an uploaded day ignores corrections: Page365 already replaces Meta there', () => {
  const orders = [order('2026-10-13', 'c1', 500), order('2026-10-13', 'c1', 400)];
  const { days } = actualDays(orders, new Set(['2026-10-13']));
  const e = { id: 'c1', level: 'campaign', metrics: { last_3d: metrics(300, 4, 1200) } } as unknown as Entity;
  overlayActual([e], ['last_3d'], now, days, [{ campaign_id: 'c1', date: '2026-10-13', spend: 100, purchases: 1, purchase_value: 400 } as any],
    [{ date: '2026-10-13', campaign_id: 'c1', hour: '09:00', purchases: 1, value: 400, reason: 'x' }]);
  assert.equal(e.metrics.last_3d!.purchases, 5);
});
