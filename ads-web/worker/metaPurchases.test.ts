import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billSendFrom, counts, purchaseEvent } from './metaPurchases.ts';

test('when an order is a sale: COD once the bill is sent, transfer once paid', () => {
  assert.equal(counts({ stage: 'draft', cod: true }), false);
  assert.equal(counts({ stage: 'unpaid', cod: true }), true, 'COD bill sent to the customer');
  assert.equal(counts({ stage: 'unpaid', cod: false }), false, 'transfer not paid yet');
  assert.equal(counts({ stage: 'transferred', cod: false }), true);
  assert.equal(counts({ stage: 'paid', cod: false }), true);
  assert.equal(counts({ stage: 'shipped', cod: true }), true);
  assert.equal(counts({ stage: 'voided', cod: true }), false);
});

test('the Purchase Meta gets: page + PSID, bill total in THB, opened-at time, bill number as event id', () => {
  const e = purchaseEvent({ id: 1, no: 29349, stage: 'unpaid', created_at: '2026-10-15T12:06:50.000+07:00', cod: true, total: 249, customer_fbid: '29353617527572724' }, '115748303500549');
  assert.deepEqual(e, {
    event_name: 'Purchase', event_time: 1792040810, event_id: 'p365-29349', action_source: 'business_messaging', messaging_channel: 'messenger',
    user_data: { page_id: '115748303500549', page_scoped_user_id: '29353617527572724' }, custom_data: { currency: 'THB', value: 249 },
  });
});

test('bills are sent only live with source "bill", and only for orders after going live and after the switch to "bill"', () => {
  const live = { mode: 'live' as const, live_from: '2026-10-15T09:08:00Z' };
  // Source "note" (or unset): each sale already went out at the note, a bill would be a second Purchase.
  assert.equal(billSendFrom(live, undefined, undefined), null);
  assert.equal(billSendFrom(live, 'note', '2026-10-16T00:00:00Z'), null);
  assert.equal(billSendFrom({ mode: 'test', live_from: '' }, 'bill', undefined), null);
  assert.equal(billSendFrom({ mode: 'off', live_from: '' }, 'bill', undefined), null);
  // Switched to "bill" after going live: bills opened before the switch were sent at the note.
  assert.equal(billSendFrom(live, 'bill', '2026-10-16T05:00:00Z'), Date.parse('2026-10-16T05:00:00Z'));
  // "bill" from before going live (or set before the switch time was kept): going live is the start.
  assert.equal(billSendFrom(live, 'bill', '2026-10-01T00:00:00Z'), Date.parse('2026-10-15T09:08:00Z'));
  assert.equal(billSendFrom(live, 'bill', undefined), Date.parse('2026-10-15T09:08:00Z'));
});
