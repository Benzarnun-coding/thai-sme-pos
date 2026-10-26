import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify } from './tambonCheck.ts';

const addr = { street: '12 ม.3', subdistrict: '', district: 'คลองท่อม', province: 'กระบี่', postal_code: '81120' };

test('a bill with ตำบล is fine; a blank one is filled from the book only when the district + postcode allow one', () => {
  assert.equal(classify({ no: 1, stage: 'shipped', structural_address: { ...addr, subdistrict: 'พรุดินนา' } })?.outcome, 'has');
  // คลองท่อม 81120 has several subdistricts: an open bill needs the chat, a shipped one is only counted.
  assert.equal(classify({ no: 2, stage: 'draft', structural_address: addr }), null);
  assert.equal(classify({ no: 3, stage: 'shipped', structural_address: addr })?.outcome, 'shipped blank');
  assert.equal(classify({ no: 4, stage: 'draft', structural_address: null })?.outcome, 'no address');
});

test('a bill with ตำบล also tests the picker on its street', () => {
  const r = classify({ no: 5, stage: 'paid', structural_address: { ...addr, street: '12 บ้านพรุดินนา ม.3', subdistrict: 'พรุดินนา' } });
  assert.deepEqual(r?.pick, { sub: 'พรุดินนา', how: 'clue', n: 5, right: true });
  assert.equal(classify({ no: 6, stage: 'paid', structural_address: { ...addr, subdistrict: 'พรุดินนา' } })?.pick?.sub, null);
});
