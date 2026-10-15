import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completeAddress } from './thaiAddress.ts';

test('a missing postcode is filled from the subdistrict, short province names are corrected', () => {
  assert.deepEqual(completeAddress({ subdistrict: 'ต.พรุดินนา', district: 'อ.คลองท่อม', province: 'จ.กระบี่', postal_code: '' }),
    { parts: { subdistrict: 'พรุดินนา', district: 'คลองท่อม', province: 'กระบี่', postal_code: '81120' }, doubt: null });
  assert.equal(completeAddress({ subdistrict: 'กำปัง', district: 'โนนไทย', province: 'นม', postal_code: '' }).parts.province, 'นครราชสีมา');
  assert.equal(completeAddress({ subdistrict: 'กำปัง', district: 'โนนไทย', province: 'นม', postal_code: '' }).parts.postal_code, '30220');
});

test('"อ.เมือง" means the capital district; a wrong postcode or an unknown subdistrict is a doubt', () => {
  const r = completeAddress({ subdistrict: 'กกดู่', district: 'เมือง', province: 'เลย', postal_code: '' });
  assert.equal(r.parts.district, 'เมืองเลย');
  assert.equal(r.parts.postal_code, '42000');
  assert.match(completeAddress({ subdistrict: 'พรุดินนา', district: 'คลองท่อม', province: 'กระบี่', postal_code: '10110' }).doubt ?? '', /ไม่ตรง/);
  assert.match(completeAddress({ subdistrict: 'ไม่มีจริง', district: 'คลองท่อม', province: 'กระบี่', postal_code: '' }).doubt ?? '', /ไม่พบ/);
});

test('numbered canals written with a digit', () => {
  const r = completeAddress({ subdistrict: 'คลอง7', district: 'คลองหลวง', province: 'ปทุมธานี', postal_code: '' });
  assert.equal(r.parts.subdistrict, 'คลองเจ็ด');
  assert.equal(r.doubt, null);
});

test('a misspelt subdistrict is matched within its district', () => {
  const { parts, doubt } = completeAddress({ subdistrict: 'ตลาดตะเคียน', district: 'กบินทร์บุรี', province: 'ปราจีนบุรี', postal_code: '' });
  assert.equal(parts.subdistrict, 'ลาดตะเคียน');
  assert.match(parts.postal_code, /^\d{5}$/);
  assert.match(doubt ?? '', /ลาดตะเคียน/);
});
