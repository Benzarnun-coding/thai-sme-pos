import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractChats, redactChat } from './chatLog.ts';

test('chat text keeps the conversation and drops contact details', () => {
  assert.equal(redactChat('เอว 32 มีสีดำไหมคะ'), 'เอว 32 มีสีดำไหมคะ');
  assert.equal(redactChat('โทร 081-234-5678 นะคะ'), 'โทร [เบอร์] นะคะ');
  assert.equal(redactChat('เบอร์ 0812345678'), 'เบอร์ [ตัวเลข]');
  assert.equal(redactChat('เลขพัสดุ PAGE02576305CE 1234567890123'), 'เลขพัสดุ [ตัวเลข] [ตัวเลข]');
  assert.equal(redactChat('mail me a@b.co'), 'mail me [อีเมล]');
  assert.equal(redactChat('1206/16 หมู่ 4 ต.คลองขุด อ.เมืองสตูล จ.สตูล 91000'), '[ที่อยู่]');
  assert.equal(redactChat('99/1 ซ.รามคำแหง 24 แขวงหัวหมาก'), '[ที่อยู่]');
  assert.equal(redactChat('501/1 32 cod 249'), '501/1 32 cod 249');
  assert.equal(redactChat('3 ตัว 549 ส่งฟรีไหม'), '3 ตัว 549 ส่งฟรีไหม');
  assert.equal(redactChat('รับทราบค่ะคุณกนิการ รับ 2 ตัว'), 'รับทราบค่ะคุณ[ชื่อ] รับ 2 ตัว');
  assert.equal(redactChat('ค่ะ พี่ Uthumporn อยากดูแบบไหน'), 'ค่ะ พี่[ชื่อ] อยากดูแบบไหน');
  assert.equal(redactChat('ขอบคุณค่ะ พี่สอบถามมาได้เลย'), 'ขอบคุณค่ะ พี่สอบถามมาได้เลย');
  assert.equal(redactChat('ขอบคุณที่สั่งกับทางร้านนะคะ'), 'ขอบคุณที่สั่งกับทางร้านนะคะ');
  assert.equal(redactChat('สวัสดี Prayont! เราต้องการติดตามผล'), 'สวัสดี [ชื่อ]! เราต้องการติดตามผล');
  assert.equal(redactChat('สวัสดี คมกริช! เราต้องการติดตามผล'), 'สวัสดี [ชื่อ]! เราต้องการติดตามผล');
  assert.equal(redactChat('สวัสดีค่ะ สนใจแบบไหนคะ'), 'สวัสดีค่ะ สนใจแบบไหนคะ');
  assert.equal(redactChat('รับทราบค่ะ Adul เลือกดำ 3 ตัว'), 'รับทราบค่ะ [ชื่อ] เลือกดำ 3 ตัว');
  assert.equal(redactChat('Ajax คะ เข้าใจเลยค่ะ'), '[ชื่อ] คะ เข้าใจเลยค่ะ');
  assert.equal(redactChat('รับทราบค่ะคุณ **Bancha** สำหรับรุ่น REV 801'), 'รับทราบค่ะคุณ **[ชื่อ]** สำหรับรุ่น REV 801');
  assert.equal(redactChat('ขอบคุณที่ทักมานะคะ Noppon 🙏'), 'ขอบคุณที่ทักมานะคะ [ชื่อ] 🙏');
  assert.equal(redactChat('Hello Max! What style'), 'Hello [ชื่อ]! What style');
  assert.equal(redactChat('ผ้า Cotton สีไม่ตกค่ะ Jeans ทรงกระบอก'), 'ผ้า Cotton สีไม่ตกค่ะ Jeans ทรงกระบอก');
  assert.equal(redactChat('บ้านกร่าง    ศรีประจันต์     สุพรรณบุรี72140'), '[ที่อยู่]');
  assert.equal(redactChat('72140'), '[ที่อยู่]');
  assert.equal(redactChat('สะดวกให้จัดส่งไปที่ 123 หมู่ 4 วังทองชุก บ้านกร่าง ตามที่แจ้งไว้เลยไหมคะ'), 'สะดวกให้จัดส่งไปที่ [ที่อยู่]ตามที่แจ้งไว้เลยไหมคะ');
  assert.equal(redactChat('ชื่อผิด ชื่อคือ(ร.ต.ชาญ เพ็งกระจ่าง'), 'ชื่อผิด ชื่อคือ [ชื่อ]');
  assert.equal(redactChat('รับ 3 ตัว 549 บาท'), 'รับ 3 ตัว 549 บาท');
});

test('customer messages and page echoes become rows; reads and duplicates are skipped', () => {
  const rows = extractChats([{
    messaging: [
      { sender: { id: 'u1' }, recipient: { id: 'page' }, timestamp: 1791900000000, message: { mid: 'm1', text: 'มีไซส์ 34 ไหม' } },
      { sender: { id: 'page' }, recipient: { id: 'u1' }, timestamp: 1791900060000, message: { mid: 'm2', text: 'มีค่ะ', is_echo: true, app_id: 263902037430900 } },
      { sender: { id: 'u1' }, recipient: { id: 'page' }, timestamp: 1791900000, message: { mid: 'm3', attachments: [{ type: 'image' }] } },
      { sender: { id: 'u1' }, recipient: { id: 'page' }, timestamp: 1791900000000 },
    ],
    standby: [{ sender: { id: 'u1' }, recipient: { id: 'page' }, timestamp: 1791900000000, message: { mid: 'm1', text: 'มีไซส์ 34 ไหม' } }],
  }]);
  assert.deepEqual(rows.map((r) => [r.mid, r.psid, r.from_page, r.text, r.attachments]), [
    ['m1', 'u1', 0, 'มีไซส์ 34 ไหม', null], ['m2', 'u1', 1, 'มีค่ะ', null], ['m3', 'u1', 0, null, 'image'],
  ]);
  assert.equal(rows[2].at, new Date(1791900000 * 1000).toISOString());
  assert.deepEqual(rows.map((r) => r.sender_app), [null, '263902037430900', null]);
});
