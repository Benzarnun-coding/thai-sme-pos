import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addressLine, cleanAddress, trimStreet } from './addressReader.ts';

const base = { found: true, name: 'สมพร ใจดี', phone: '+66 81 234 5678', street: '12 ม.3', subdistrict: 'พรุดินนา', district: 'คลองท่อม', province: 'กระบี่', postal_code: '', from_image: false, doubt: '', cancelled: false, size_mismatch: '', customer_sizes: [] as string[] };

test('a postcode the customer left out is filled, and the model\'s note about it no longer counts', () => {
  const a = cleanAddress({ ...base, doubt: 'ลูกค้าไม่ได้ให้รหัสไปรษณีย์' });
  assert.deepEqual(a.problems, []);
  assert.equal(a.postal_code, '81120');
  assert.equal(a.phone, '0812345678');
  assert.equal(addressLine(a), '12 ม.3 ต.พรุดินนา อ.คลองท่อม จ.กระบี่ 81120');
});

test('real doubts and missing phone still stop it', () => {
  assert.match(cleanAddress({ ...base, doubt: 'มีสองที่อยู่' }).problems.join(), /สองที่อยู่/);
  assert.match(cleanAddress({ ...base, phone: '' }).problems.join(), /เบอร์/);
  assert.match(cleanAddress({ ...base, subdistrict: 'ไม่มีจริง', district: 'ไม่มี', province: 'ไม่มี' }).problems.join(), /ไม่พบ|รหัสไปรษณีย์/);
});

test('a missing ตำบล is flagged, and one left in the street is moved to its field', () => {
  assert.match(cleanAddress({ ...base, subdistrict: '', postal_code: '81120' }).problems.join(), /ตำบล/);
  const a = cleanAddress({ ...base, street: '12 ม.3 ต.พรุดินนา', subdistrict: '' });
  assert.deepEqual(a.problems, []);
  assert.equal(a.subdistrict, 'พรุดินนา');
  assert.equal(addressLine(a), '12 ม.3 ต.พรุดินนา อ.คลองท่อม จ.กระบี่ 81120');
});

test('the house-number box holds only the house number (19 Nov: the whole address came twice)', () => {
  const kk = { subdistrict: 'ในเมือง', district: 'เมืองขอนแก่น', province: 'ขอนแก่น' };
  assert.equal(trimStreet('12 ม.3 บ้านโนนทัน ต.ในเมือง อ.เมืองขอนแก่น จ.ขอนแก่น 40000', kk), '12 ม.3 บ้านโนนทัน');
  assert.equal(trimStreet('12 ม.3 ตำบลในเมือง อำเภอเมืองขอนแก่น จังหวัดขอนแก่น', kk), '12 ม.3');
  assert.equal(trimStreet('99/1 หมู่ 5 ในเมือง เมืองขอนแก่น ขอนแก่น 40000', kk), '99/1 หมู่ 5');
  assert.equal(trimStreet('99/1 ซ.รามคำแหง 24 ถ.รามคำแหง แขวงหัวหมาก เขตบางกะปิ กทม 10240', { subdistrict: 'หัวหมาก', district: 'บางกะปิ', province: 'กรุงเทพมหานคร' }), '99/1 ซ.รามคำแหง 24 ถ.รามคำแหง');
  // already clean, or only a house number: unchanged
  assert.equal(trimStreet('12 ม.3 ถ.มิตรภาพ', kk), '12 ม.3 ถ.มิตรภาพ');
  assert.equal(trimStreet('ในเมือง', kk), 'ในเมือง');
  const a = cleanAddress({ ...base, street: '12 ม.3 ต.พรุดินนา อ.คลองท่อม จ.กระบี่ 81120' });
  assert.equal(a.street, '12 ม.3');
  assert.equal(addressLine(a), '12 ม.3 ต.พรุดินนา อ.คลองท่อม จ.กระบี่ 81120');
});
