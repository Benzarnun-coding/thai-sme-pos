import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcile, summarize, type DayOrder } from './orderDay.ts';

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

test('notes vs the uploaded file: matched by the bill, by the file match, and what is left on each side', () => {
  const rows = [row(249, 'paid', { mid: 'a', bill: { id: 1, no: 29366, stage: 'paid', total: 249 } }), row(448, null, { mid: 'b' }), row(199, null, { mid: 'c' }), row(249, null, { mid: 'd', repeat: true })];
  const r = reconcile(rows, new Map([['b', '29370']]), [
    { order_no: '29366', total: 249, created_at: '' }, { order_no: '29370', total: 398, created_at: '' }, { order_no: '29371', total: 549, created_at: '' },
  ]);
  assert.deepEqual([r.log, r.file, r.matched], [3, 3, 2]);
  assert.deepEqual(r.log_only.map((x) => x.mid), ['c']);
  assert.deepEqual(r.file_only.map((x) => x.order_no), ['29371']);
  assert.deepEqual(r.diff.map((x) => [x.order_no, x.note_total, x.bill_total]), [['29370', 448, 398]]);
});
