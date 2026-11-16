// Every order-note format the admins have actually typed (Benz 15 Oct: keep them all when a format is fixed).
// When a note is missed or misread, add its real text here with what it should read as, then fix the parser —
// all of these must keep passing. Also listed in docs/orders.md ("Order-note formats").
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOrderNote } from './orderNotes.ts';

/** [what the admin typed, "code size ×qty, … | payment total"] */
export const NOTE_FORMATS: [string, string][] = [
  ["501/1  32\ncod  249", "501/1 32 | cod 249"],
  ["501/1/2  32\ncod  749", "501/1 32, 501/2 32 | cod 749"],
  ["501/1/2/3  32\ncod  649", "501/1 32, 501/2 32, 501/3 32 | cod 649"],
  ["801/1/2/3 sz38\ncod 1029", "801/1 38, 801/2 38, 801/3 38 | cod 1029"],
  ["Ni9-1  30\ncod  239", "NI9-1 30 | cod 239"],
  ["Ni9-1-2-5  31\ncod  549", "NI9-1 31, NI9-2 31, NI9-5 31 | cod 549"],
  ["ni9-1-2-3 sz34\ncod 549", "NI9-1 34, NI9-2 34, NI9-3 34 | cod 549"],
  ["009-1-2  36\ncod  299", "009-1 36, 009-2 36 | cod 299"],
  ["009-1-2  30\ncod299", "009-1 30, 009-2 30 | cod 299"],
  ["16-9 , 16-10 sz36\ncod 549", "16-9 36, 16-10 36 | cod 549"],
  ["D01 32 1\ncod 249", "D01 32 | cod 249"],
  ["D01 D02 34\ncod 448", "D01 34, D02 34 | cod 448"],
  ["D01 D02 sz34\ncod 447", "D01 34, D02 34 | cod 447"],
  ["200  200/2  30\ncod  448", "200 30, 200/2 30 | cod 448"],
  ["200  31\ncod  249", "200 31 | cod 249"],
  ["444/2  38  2\n555/3  38  2\ncod  1290", "444/2 38 ×2, 555/3 38 ×2 | cod 1290"],
  ["200  36\n111  36\n222  36\n301/3  36\n301/1  36\ncod  1299", "200 36, 111 36, 222 36, 301/3 36, 301/1 36 | cod 1299"],
  ["301/1 32 1\nCod 199", "301/1 32 | cod 199"],
  ["cod199\n501/3 34", "501/3 34 | cod 199"], // 15 Oct: total first
  ["Cod599\n501/3 501/1 501/2 sz36", "501/3 36, 501/1 36, 501/2 36 | cod 599"],
  ["cod199\nE200 34", "E200 34 | cod 199"], // 15 Oct: stray letter, Page365 has 200
  ["- สีเทา (16-10) 1 ตัว\n- สีเทาเข้ม (16-12) 1 ตัว\n- สีกากี (16-9) 1 ตัว\n- สีดำ (16-4) 1 ตัว\nsz34 \ncod 1048", "16-10 34, 16-12 34, 16-9 34, 16-4 34 | cod 1048"], // 15 Oct: list style, size on its own line
  ["• ดำ (501/3) 2 ตัว sz32\ncod 449", "501/3 32 ×2 | cod 449"],
  ["โอน349kb\n301/1 sz34  2ตัว", "301/1 34 ×2 | transfer 349"], // 15 Oct, Ou Aumaporn: bank after the total, "2ตัว"
  ["501/1 32 x3\ncod 549 บาท", "501/1 32 ×3 | cod 549"],
  ["501/1 32 2 ชิ้น\nโอน 399 กสิกร", "501/1 32 ×2 | transfer 399"],
  ["cod299\n009/1 36\n009/2 36", "009/1 36, 009/2 36 | cod 299"], // 20 Oct: 009/1 = 009-1
  ["ni9-1/3/4 sz30\ncod 549", "NI9-1 30, NI9-3 30, NI9-4 30 | cod 549"], // 20 Oct: colours split by /
  ["ni9-1 34 1\nni9-2 34 2\nni9-3 34 1\nni9-4 34 1\nni9-5 34 1\nKB โอน 998", "NI9-1 34, NI9-2 34 ×2, NI9-3 34, NI9-4 34, NI9-5 34 | transfer 998"], // 20 Oct: bank before โอน
  ["ni9-3 30 1\nni9-4 30 1\nni9-5 30 1\nkb โอน499", "NI9-3 30, NI9-4 30, NI9-5 30 | transfer 499"],
  ["501/1 32\nkb 399", "501/1 32 | transfer 399"], // 20 Oct: bank alone = โอน
  ["ทi9-3-4-5 sz34\ncod 549", "NI9-3 34, NI9-4 34, NI9-5 34 | cod 549"], // 20 Oct: keyboard still in Thai
  ["301/1/3 หผ34\ncod 349", "301/1 34, 301/3 34 | cod 349"], // 20 Oct: หผ = sz
  ["cod599\n801/1 32 3ตัส", "801/1 32 ×3 | cod 599"], // 20 Oct: ตัส = ตัว
  ["009-1 sz30 1\n009-1 sz32 1\n009-2 sz30 1\ncod 947", "009-1 30, 009-1 32, 009-2 30 | cod 947"], // same model, several sizes
  ["980 สีดำกรม  1\ncod  149", "980 - | cod 149"], // 20 Oct: colour name (980 ดำกรม = 980-31)
  ["980 freesize 1\ncod 149", "980 F | cod 149"], // free size
  ["980-32\n980-29\n980-31\ncod  447", "980-32 -, 980-29 -, 980-31 - | cod 447"], // code only, one-size model
  ["cod607\nC01 L\nดำแดง1\nดำเทา1", "C01 L, C01 L | cod 607"], // colour lines under a code
  ["SH-001  2XL  1\nSH-002  2XL  1\ncod  428", "SH-001 2XL, SH-002 2XL | cod 428"], // 20 Oct: CN letter sizes
];

/** Shop messages that must never become notes (customer details, chat). */
const NOT_NOTES = [
  'สีดำครับ ไซส์30 อรรถพล 31 ม.8 ต.ท่าซุง 61000 สีดำ 1 ตัว',
  '501/1 32\nบ้านเลขที่ 22/6 ม.1\ncod 249',
  'John Smith\n0812345678\ncod 249',
  'cod 249 ขอบคุณค่ะ',
  'ขอบคุณค่ะ',
];

const show = (t: string) => {
  const p = parseOrderNote(t);
  return p && `${p.items.map((i) => `${i.code} ${i.size || '-'}${i.qty > 1 ? ` ×${i.qty}` : ''}`).join(', ')} | ${p.payment} ${p.total}`;
};

test('every format the admins have typed is read', () => {
  for (const [text, want] of NOTE_FORMATS) assert.equal(show(text), want, JSON.stringify(text));
});

test('customer details and chat are never read as notes', () => {
  for (const text of NOT_NOTES) assert.equal(parseOrderNote(text), null, JSON.stringify(text));
});

test('a message that looks like a note but is not read is flagged; chat and read notes are not', async () => {
  const { looksLikeNote } = await import('./orderNotes.ts');
  assert.equal(looksLikeNote('โอน349 ธนชาต 301/1 ไซส์34 สองตัว'), true);
  assert.equal(looksLikeNote('cod 249 501/1 เอวสามสอง'), true);
  for (const [text] of NOTE_FORMATS) assert.equal(looksLikeNote(text), false, 'already read');
  for (const text of NOT_NOTES) assert.equal(looksLikeNote(text), false, JSON.stringify(text));
  assert.equal(looksLikeNote('โปรตอนนี้ 1 ตัว 369 บาท 3 ตัว 799 บาท เก็บเงินปลายทางได้ค่ะ'), false, 'bot prose');
  assert.equal(looksLikeNote('cod 249 คุณสมชาย 0812345678'), false, 'a phone number');
});
