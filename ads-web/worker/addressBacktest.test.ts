import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addressUsage } from './addressReader.ts';
import { compare } from './addressBacktest.ts';

const truth = { phone: '081-234-5678', street: '12/3 หมู่ 4 ซ.สุขใจ', subdistrict: 'พรุดินนา', district: 'คลองท่อม', province: 'กระบี่', postal_code: '81120' };

test('the same address in other words still matches field by field', () => {
  const m = compare({ phone: '0812345678', street: '12/3 ม.4 ซอยสุขใจ', subdistrict: 'ต.พรุดินนา', district: 'อ. คลองท่อม', province: 'จ.กระบี่', postal_code: '81120' }, truth);
  assert.deepEqual(Object.values(m), [true, true, true, true, true, true]);
});

test('a wrong house number or subdistrict is a miss', () => {
  const m = compare({ ...truth, street: '13/3 หมู่ 4', subdistrict: 'คลองท่อมใต้' }, truth);
  assert.equal(m.street, false);
  assert.equal(m.subdistrict, false);
  assert.equal(m.phone, true);
});

test('a read is priced from its tokens; an unknown model has no price', () => {
  assert.equal(addressUsage('claude-opus-5-5', { input_tokens: 4000, output_tokens: 500 }, 1).usd, 0.026);
  assert.equal(addressUsage('claude-haiku-5-5', { input_tokens: 4000, output_tokens: 500 }, 0).usd, 0.00065);
  assert.equal(addressUsage('other', { input_tokens: 1, output_tokens: 1 }, 0).usd, null);
});

