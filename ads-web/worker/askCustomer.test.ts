import assert from 'node:assert/strict';
import { test } from 'node:test';
import { missingAddressParts, phoneProblem, askMessage, shouldAsk } from './askCustomer.ts';

const full = { street: '12/3 ม.4', subdistrict: 'บางนา', district: 'บางนา', province: 'กรุงเทพมหานคร', postal_code: '10260', phone: '0812345678' };

test('lists what is missing and asks for it', () => {
  assert.deepEqual(missingAddressParts({ ...full, subdistrict: '', postal_code: ' ' }), ['subdistrict', 'postal_code']);
  assert.equal(askMessage(full), null);
  assert.match(askMessage({ ...full, district: '' })!, /อำเภอ\/เขต/);
});
test('checks phones', () => {
  assert.equal(phoneProblem('081-234-5678'), null);
  assert.equal(phoneProblem('021234567'), null);
  assert.notEqual(phoneProblem('08123456'), null);
  assert.notEqual(phoneProblem('1812345678'), null);
  assert.match(askMessage({ ...full, phone: '0812' })!, /เบอร์โทรไม่ถูกต้อง/);
  assert.equal(askMessage({ ...full, phone: '' }), null);
});
test('never asks twice', () => {
  assert.equal(shouldAsk(null), true);
  assert.equal(shouldAsk('2026-11-04T01:00:00Z'), false);
});
