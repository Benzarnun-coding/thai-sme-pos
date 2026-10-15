import assert from 'node:assert/strict';
import { test } from 'node:test';
import { counts, purchaseEvent } from './metaPurchases.ts';

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
