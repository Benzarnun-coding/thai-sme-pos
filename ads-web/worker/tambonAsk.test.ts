import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askText, matchReply, missingTambon } from './tambonAsk.ts';

const cands = ['คลองท่อมเหนือ', 'คลองท่อมใต้', 'คลองพน', 'ทรายขาว', 'พรุดินนา'];

test('the question lists the subdistricts of the district + postcode, numbered', () => {
  const t = askText({ district: 'คลองท่อม', province: 'กระบี่', postal_code: '81120' }, cands);
  assert.match(t, /รบกวนขอตำบล.*อ\.คลองท่อม จ\.กระบี่ 81120/);
  assert.match(t, /5\. พรุดินนา/);
  assert.match(askText({ district: 'บางรัก', province: 'กรุงเทพมหานคร', postal_code: '10500' }, []), /ขอแขวง.*เขตบางรัก กรุงเทพฯ 10500[\s\S]*พิมพ์ชื่อแขวง/);
});

test('an answer is a number or one name of the list', () => {
  assert.equal(matchReply('5', cands), 'พรุดินนา');
  assert.equal(matchReply('ข้อ 2 ค่ะ', cands), 'คลองท่อมใต้');
  assert.equal(matchReply('ต.ทรายขาวค่ะ', cands), 'ทรายขาว');
  assert.equal(matchReply('คลองท่อมเหนือ', cands), 'คลองท่อมเหนือ');
  assert.equal(matchReply('ได้ค่ะ', cands), null);
  assert.equal(matchReply('9', cands), null);
  assert.equal(matchReply('โอนแล้วค่ะ 549', cands), null);
});

test('only a bill complete but for its ตำบล is asked about', () => {
  const s = { street: '12 ม.3', subdistrict: '', district: 'คลองท่อม', province: 'กระบี่', postal_code: '81120' };
  assert.equal(missingTambon({ structural_address: s }), true);
  assert.equal(missingTambon({ structural_address: { ...s, subdistrict: 'พรุดินนา' } }), false);
  assert.equal(missingTambon({ structural_address: { ...s, postal_code: '' } }), false);
  assert.equal(missingTambon({ structural_address: null }), false);
});
