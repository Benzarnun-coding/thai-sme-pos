import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildWorkbook, carrierFor, missingColumns, parseExport, parseItemDetail, splitAddress, toGoSell } from '../web/src/gosell.ts';
import { unzip } from '../web/src/zip.ts';

const HEAD = ['No.', 'Created At', 'Status', 'Profile name', 'Customer Name', 'Customer Phone', 'Customer Address', 'Payment Provider', 'Shipping Option', 'Shipping Cost', 'Subtotal', 'Discount', 'Total', 'Note', 'SKU', 'Item Qty', 'Item Price', 'Item Subtotal'];
const row = (o: Partial<Record<string, string>>) => HEAD.map((h) => o[h] ?? '').join('\t');
const order1 = { 'No.': '100', 'Created At': '2026-10-08 10:27:00 +0700', Status: 'paid', 'Profile name': 'Somchai FB', 'Customer Name': 'PK-0100 สมชาย ใจดี', 'Customer Phone': "'0812345678", 'Customer Address': '70/2 ม.13 ต.ทุ่งปรัง อ.สิชล จ.นครศรีธรรมราช 80120', 'Payment Provider': 'cod', 'Shipping Option': 'Kerry Express (COD)', 'Shipping Cost': '50', Subtotal: '1107', Discount: '308', Total: '849' };

function utf16(text: string): Uint8Array {
  const body = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) { body[i * 2] = text.charCodeAt(i) & 0xff; body[i * 2 + 1] = text.charCodeAt(i) >> 8; }
  return new Uint8Array([0xff, 0xfe, ...body]);
}

const SAMPLE = [
  HEAD.join('\t'),
  row({ ...order1, SKU: '8011-PK-MD-34', 'Item Qty': '2', 'Item Price': '369', 'Item Subtotal': '738' }),
  row({ ...order1, SKU: '8013-PK-BL-34', 'Item Qty': '1', 'Item Price': '369', 'Item Subtotal': '369' }),
  row({ 'No.': '101', 'Created At': '2026-10-08 11:00:00 +0700', Status: 'paid', 'Customer Name': 'BB-0101 Min', 'Customer Phone': '0899999999', 'Customer Address': 'ซอย 7 แขวงสวนหลวง เขตสวนหลวง กรุงเทพฯ 10250', 'Payment Provider': 'kbank', 'Shipping Option': 'Kerry Express  (แบบโอน)', 'Shipping Cost': '0', Subtotal: '299', Discount: '', Total: '299', SKU: '164-AR-BL-32', 'Item Qty': '1', 'Item Price': '299', 'Item Subtotal': '299' }),
  row({ 'No.': '102', Status: 'cancelled', 'Customer Name': 'x', SKU: 'A-B-C-1', 'Item Qty': '1', 'Item Price': '1' }),
].join('\r\n') + '\r\n';

test('reads the UTF-16 tab export and groups items into orders', () => {
  const { rows } = parseExport(utf16(SAMPLE));
  assert.equal(rows.length, 4);
  const { orders, skipped } = toGoSell(rows);
  assert.deepEqual(skipped, [{ orderNo: '102', reason: 'สถานะ cancelled' }]);
  assert.equal(orders.length, 2);
  const [a, b] = orders;
  assert.equal(a.customer, 'PK-0100 สมชาย ใจดี');
  assert.equal(a.social, 'Somchai FB');
  assert.equal(a.phone, '0812345678');
  assert.equal(a.payment, 'COD');
  assert.equal(a.carrier, 'J&T Express (SP)'); // default: every order on the J&T special rate
  assert.equal(toGoSell(rows, '').orders[0].carrier, 'KEX'); // '' = from the file's Shipping Option
  assert.equal(toGoSell(rows, 'Flash Express').orders[1].carrier, 'Flash Express');
  assert.equal(a.skus, '8011-PK-MD-34 (2), 8013-PK-BL-34 (1)');
  assert.equal(a.prices, '369, 369');
  assert.equal(a.orderDiscount, 308);
  assert.equal(a.shipping, 0);
  assert.equal(a.codFee, 50);
  assert.equal(a.orderedAt, '2026-10-08 10:27');
  assert.deepEqual(a.problems, []);
  assert.equal(b.payment, 'การโอนเงิน');
  assert.equal(b.province, 'กรุงเทพมหานคร');
  assert.equal(b.codFee, 0);
  assert.equal(b.orderDiscount, 0);
  assert.deepEqual(b.problems, []);
});

test('also reads a UTF-8 comma CSV with quoted cells', () => {
  const csv = 'No.,Customer Address,SKU\r\n1,"1/2, ซอย 3 ต.ก อ.ข จ.เลย 42000",X-1\r\n';
  const { rows } = parseExport(new TextEncoder().encode(csv));
  assert.equal(rows[0]['Customer Address'], '1/2, ซอย 3 ต.ก อ.ข จ.เลย 42000');
});

test('splits Thai addresses', () => {
  assert.deepEqual(splitAddress('25/11หมู่3 ต.นาดี อ.เมืองสมุทรสาคร จ.สมุทรสาคร 74000'), { address: '25/11หมู่3', subdistrict: 'นาดี', district: 'เมืองสมุทรสาคร', province: 'สมุทรสาคร', zip: '74000' });
  assert.deepEqual(splitAddress('99 ถ.เจนจบทิศ ตำบลในเมือง อำเภอบ้านไผ่ จังหวัดขอนแก่น 40110'), { address: '99 ถ.เจนจบทิศ', subdistrict: 'ในเมือง', district: 'บ้านไผ่', province: 'ขอนแก่น', zip: '40110' });
  assert.equal(splitAddress('1 ต.ก อ.ข จ.โคราช 30000').province, 'นครราชสีมา');
  assert.equal(splitAddress('1 ต.ก อ.ข 30000').province, '');
});

test('flags what GoSell would refuse', () => {
  const { rows } = parseExport(new TextEncoder().encode([HEAD.join('\t'), row({ 'No.': '1', 'Customer Phone': '12', 'Customer Address': 'บ้านไม่มีตำบล', 'Shipping Option': 'ส่งเอง', Subtotal: '100', Total: '90', SKU: '', 'Item Qty': '1', 'Item Price': '100' })].join('\n')));
  assert.ok(!toGoSell(rows).orders[0].problems.some((x) => x.includes('ขนส่ง')), 'a picked carrier ignores the file');
  const p = toGoSell(rows, '').orders[0].problems.join(' | ');
  for (const s of ['หาตำบล', 'หาจังหวัด', 'รหัสไปรษณีย์', 'เบอร์', 'ไม่รู้จักขนส่ง', 'ไม่มี SKU', 'ยอดไม่ตรง']) assert.ok(p.includes(s), `${s} in ${p}`);
});

test('carrier names map to the template list', () => {
  assert.equal(carrierFor('Kerry Express (COD)'), 'KEX');
  assert.equal(carrierFor('Flash'), 'Flash Express');
  assert.equal(carrierFor('ไปรษณีย์ไทย EMS'), 'Thailand Post');
  assert.equal(carrierFor('ส่งเอง'), '');
});

test('fills the GoSell template from row 9 and keeps its dropdowns', async () => {
  const template = readFileSync(new URL('../web/src/gosellTemplate.xlsx', import.meta.url).pathname);
  const { orders } = toGoSell(parseExport(utf16(SAMPLE)).rows);
  const files = await unzip(await buildWorkbook(template, orders));
  const dec = (n: string) => new TextDecoder().decode(files.get(n));
  const sheet = dec('xl/worksheets/sheet1.xml');
  const sst = dec('xl/sharedStrings.xml');
  const strings = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
  const cell = (ref: string) => {
    const m = sheet.match(new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>(.*?)</c>)`));
    if (!m?.[2]) return '';
    const v = m[2].replace(/<\/?v>/g, '');
    return m[1].includes('t="s"') ? strings[Number(v)] : v;
  };
  assert.equal(cell('A9'), 'PK-0100 สมชาย ใจดี');
  assert.equal(cell('B9'), '0812345678');
  assert.equal(cell('G9'), 'ทุ่งปรัง');
  assert.equal(cell('L9'), 'J&amp;T Express (SP)'); // raw XML: & must be escaped
  assert.equal(cell('M9'), '8011-PK-MD-34 (2), 8013-PK-BL-34 (1)');
  assert.equal(cell('N9'), '369, 369');
  assert.equal(cell('P9'), '308');
  assert.equal(cell('R9'), '50');
  assert.equal(cell('E10'), 'การโอนเงิน');
  assert.equal(cell('N10'), '299');
  assert.equal(cell('A11'), '');
  assert.equal(cell('A5'), 'คุณโกโก'); // template's example rows untouched
  assert.ok(sheet.includes('carriers!$A$1:$A$15'));
  assert.ok(sheet.includes('COD,การโอนเงิน'));
  assert.equal(Number(sst.match(/uniqueCount="(\d+)"/)?.[1]), strings.length);
  assert.ok(files.has('xl/worksheets/sheet2.xml'));
});

test('reads the one-row-per-order export (Item Detail, THB = line total)', () => {
  assert.deepEqual(parseItemDetail('912  ยีนส์ Max (ซิป) (912-CM-NV-36) (912-CM-NV-36) x3 THB 1107.0\n980-32 Sports (98032-BB-RE-FE) (98032-BB-RE-FE) x1 THB 299.0'), [
    { sku: '912-CM-NV-36', qty: 3, price: 369 },
    { sku: '98032-BB-RE-FE', qty: 1, price: 299 },
  ]);
  assert.equal(parseItemDetail('อะไรก็ไม่รู้'), null);
  const rows = [{ 'Order no.': '28800', 'Customer Name': 'ก', 'Customer Phone': '0812345678', 'Customer Address': '1 ต.ก อ.ข จ.เลย 42000', 'Payment Provider': 'cod', 'Shipping Option': 'Kerry Express (COD)', 'Shipping Cost': '50', Subtotal: '1406', Discount: '400', Total: '1056', 'Item Detail': '801/2 (8012-PK-NV-34) (8012-PK-NV-34) x3 THB 1107.0\nD02 (D02-PK-MD-36) (D02-PK-MD-36) x1 THB 299.0' }];
  const [o] = toGoSell(rows).orders;
  assert.equal(o.orderNo, '28800');
  assert.equal(o.skus, '8012-PK-NV-34 (3), D02-PK-MD-36 (1)');
  assert.equal(o.prices, '369, 299');
  assert.deepEqual(o.problems, []);
  const [bad] = toGoSell([{ ...rows[0], 'Item Detail': 'ไม่มีรูปแบบ' }]).orders;
  assert.ok(bad.problems.some((p) => p.startsWith('อ่านรายการสินค้าไม่ได้')));
});

test('accepts either layout, names what is missing', () => {
  assert.equal(missingColumns(['No.', 'Customer Name', 'Customer Phone', 'Customer Address', 'SKU', 'Item Qty', 'Item Price']), null);
  assert.equal(missingColumns(['Order no.', 'Customer Name', 'Customer Phone', 'Customer Address', 'Item Detail']), null);
  assert.deepEqual(missingColumns(['การนำเข้าข้อมูลคำสั่งซื้อ (Import Orders)']), ['No. / Order no.', 'Customer Name', 'Customer Phone', 'Customer Address', 'SKU, Item Qty, Item Price (หรือ Item Detail)']);
});

test('UTF-16 without a BOM still decodes', () => {
  const withBom = utf16('No.\tSKU\r\n1\tX-1\r\n');
  assert.equal(parseExport(withBom.subarray(2)).rows[0]['SKU'], 'X-1');
});
