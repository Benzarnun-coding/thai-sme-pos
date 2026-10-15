import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarize, type DayOrder } from './orderDay.ts';

const row = (total: number, stage: DayOrder['bill'] extends infer B ? any : never, extra: Partial<DayOrder> = {}): DayOrder => ({
  mid: Math.random().toString(), at: '', text: '', customer: null, items: [], pieces: 1, total, payment: 'cod', bill: stage ? { id: 1, no: 1, stage, total } : null, meta: null, repeat: false, ...extra,
});

test('day totals: repeats and zero totals left out, grouped by bill stage', () => {
  const s = summarize([row(249, 'paid', { meta: 'sent' }), row(448, 'draft', { pieces: 2, payment: 'transfer' }), row(249, 'paid', { repeat: true }), row(0, null), row(199, null)]);
  assert.equal(s.orders, 3);
  assert.equal(s.sales, 896);
  assert.equal(s.pieces, 4);
  assert.deepEqual([s.cod, s.transfer, s.meta_sent], [2, 1, 1]);
  assert.deepEqual(s.by_stage, { paid: { orders: 1, sales: 249 }, draft: { orders: 1, sales: 448 }, none: { orders: 1, sales: 199 } });
});
