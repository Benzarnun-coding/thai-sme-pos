import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normaliseRow, type CatalogRow } from '../web/src/catalog.ts';
import {
  buildLines, dateFromFileName, dayMonth, groupLines, makeLookup, missingOrderColumns, orderWorkbook, readOrderItems, sheetRows, textOrder, thaiShortDate,
} from '../web/src/purchase.ts';
import { unzip } from '../web/src/zip.ts';
import { validatePurchase } from './purchase.ts';

const row = (o: Record<string, unknown>): CatalogRow => normaliseRow(o);
const CATALOG: CatalogRow[] = [
  // BB with suppliers in the ร้านค้า column, one with a supplier code (รหัสแทน)
  row({ tab: 'BB', sku: 'J41-BB-BL-34', code: 'J41-2', color: 'BL', size: '34', shop: 'แพลนเนท' }),
  row({ tab: 'BB', sku: 'J41-BB-BL-38', code: 'J41-2', color: 'BL', size: '38', shop: 'แพลนเนท' }),
  row({ tab: 'BB', sku: '13064-BB-OV-30', code: '1306-4', color: 'OV', size: '30', shop: 'J.BIG', alias: '1306-4' }),
  row({ tab: 'BB', sku: '8000-BB-LB-30', code: '8000/11', color: 'LB', size: '30', shop: '' }),
  row({ tab: 'BB', sku: 'OLD-BB-BL-30', code: 'OLD', color: 'BL', size: '30', shop: 'เลิกผลิต' }),
  // PK: no supplier column → its own sheet, unless a supplier is set on the page
  row({ tab: 'PK', sku: '5011-PK-MD-30', code: '501/1', color: 'MD', size: '30' }),
  row({ tab: 'PK', sku: '5011-PK-MD-32', code: '501/1', color: 'MD', size: '32' }),
  row({ tab: 'PK', sku: '2003-PK-MR-32', code: '200/3', color: 'MR', size: '32' }),
];

const RAW: Record<string, string>[] = [
  { 'ร้านค้า BigSeller': 'STM-SHOP', SKU: '5011-PK-MD-30', 'ชื่อสินค้า': 'ยีนส์', 'ชื่อตัวเลือก': '501 (มิดไนท์), 30', 'จำนวน': '2', 'หมายเลขคำสั่งซื้อ': 'A1' },
  { 'ร้านค้า BigSeller': 'Shopee', SKU: '5011-pk-md-30​', 'จำนวน': '1', 'หมายเลขคำสั่งซื้อ': 'A2' },
  { SKU: '5011-PK-MD-32', 'จำนวน': '1', 'หมายเลขคำสั่งซื้อ': 'A2' },
  { SKU: '2003-PK-MR-32', 'จำนวน': '3', 'หมายเลขคำสั่งซื้อ': 'A3' },
  { SKU: 'J41-BB-BL-34', 'จำนวน': '1', 'หมายเลขคำสั่งซื้อ': 'A4' },
  { SKU: 'J41-BB-BL-38', 'จำนวน': '1', 'หมายเลขคำสั่งซื้อ': 'A4' },
  { SKU: '13064-BB-OV-30', 'จำนวน': '1', 'หมายเลขคำสั่งซื้อ': 'A5' },
  { SKU: '8000-BB-LB-30', 'จำนวน': '1', 'หมายเลขคำสั่งซื้อ': 'A6' },
  { SKU: 'OLD-BB-BL-30', 'จำนวน': '1', 'หมายเลขคำสั่งซื้อ': 'A6' },
  { SKU: '2004-BB-BI-38', 'ชื่อตัวเลือก': '200/4, 38', 'จำนวน': '2', 'หมายเลขคำสั่งซื้อ': 'A7' },
  { SKU: '', 'ชื่อสินค้า': 'กางเกง L712', 'ชื่อตัวเลือก': 'L712/2 (มิดไนท์), 30 (ซิป)', 'จำนวน': '1', 'หมายเลขคำสั่งซื้อ': 'A8' },
  { SKU: '', 'ชื่อสินค้า': 'กางเกง R55', 'ชื่อตัวเลือก': 'R55, 31', 'จำนวน': '1', 'หมายเลขคำสั่งซื้อ': 'A9' },
  { SKU: 'X', 'จำนวน': '0' },
];

test('reads the Bigseller rows', () => {
  assert.deepEqual(missingOrderColumns(['ร้านค้า BigSeller', 'SKU', 'จำนวน']), null);
  assert.deepEqual(missingOrderColumns(['SKU']), ['จำนวน']);
  const items = readOrderItems(RAW);
  assert.equal(items.length, 12, 'zero-quantity rows dropped');
  assert.equal(items.reduce((n, i) => n + i.qty, 0), 16);
  assert.equal(dateFromFileName('Order-SKU-inprocess20261013010110576.xlsx'), '2026-10-13');
  assert.equal(dateFromFileName('orders.xlsx'), null);
  assert.equal(thaiShortDate('2026-10-13'), '13/10/69');
  assert.equal(dayMonth('2026-10-03'), '3-10');
});

test('suppliers for BB, warehouses for the rest, ตรวจสอบ for unknown SKUs', () => {
  const groups = groupLines(buildLines(readOrderItems(RAW), makeLookup(CATALOG, new Map())));
  const by = Object.fromEntries(groups.map((g) => [g.name, g]));
  assert.deepEqual(groups.map((g) => [g.name, g.kind, g.pieces]), [
    ['แพลนเนท', 'supplier', 2],
    ['J.BIG', 'supplier', 1],
    ['BB · ยังไม่ระบุร้าน', 'unassigned', 2],
    ['PK', 'warehouse', 7],
    ['ตรวจสอบ', 'review', 4],
  ]);
  // the same SKU written two ways (case, zero-width space) adds up
  assert.deepEqual(by.PK.lines.map((l) => [l.label, l.size, l.qty]), [['200/3 มิดไนท์ย้อมสนิม', '32', 3], ['501/1 มิดไนท์', '30', 3], ['501/1 มิดไนท์', '32', 1]]);
  const order = ['ดำJ-013', '501/1', '1306-4', '1306-36', '2003', 'L68ดำ(ซิป)'].sort(textOrder);
  assert.deepEqual(order, ['1306-36', '1306-4', '2003', '501/1', 'L68ดำ(ซิป)', 'ดำJ-013'], 'same order as the printed J.BIG sheet');
  assert.equal(by['J.BIG'].lines[0].label, '1306-4', 'supplier code when ordering from a supplier');
  assert.equal(by['แพลนเนท'].lines[0].label, 'J41-2 ดำ');
  assert.equal(by['BB · ยังไม่ระบุร้าน'].lines.find((l) => l.sku === 'OLD-BB-BL-30')!.note, 'ชีต: เลิกผลิต');
  const review = by['ตรวจสอบ'];
  assert.deepEqual(review.lines.map((l) => l.label).sort(), ['(ไม่มี SKU)', '(ไม่มี SKU)', '2004-BB-BI-38']);
  assert.equal(sheetRows(review).length, 3, 'review rows are never merged');
});

test('a supplier set on the page moves a PK model to that supplier', () => {
  const groups = groupLines(buildLines(readOrderItems(RAW), makeLookup(CATALOG, new Map([['PK|5011-PK-MD', 'J.BIG']]))));
  const jbig = groups.find((g) => g.name === 'J.BIG')!;
  assert.equal(jbig.pieces, 5);
  assert.deepEqual(sheetRows(jbig).map((r) => `${r.label}/${r.size}×${r.qty}`), ['1306-4/30×1', '501/1 มิดไนท์/30×3', '501/1 มิดไนท์/32×1']);
  assert.equal(groups.find((g) => g.name === 'PK')!.pieces, 3);
});

test('the workbook has a summary and one sheet per group', async () => {
  const groups = groupLines(buildLines(readOrderItems(RAW), makeLookup(CATALOG, new Map())));
  const files = await unzip(await orderWorkbook(groups, '2026-10-13', 2));
  const wb = new TextDecoder().decode(files.get('xl/workbook.xml'));
  assert.deepEqual([...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]), ['สรุป', 'แพลนเนท', 'J.BIG', 'BB · ยังไม่ระบุร้าน', 'PK', 'ตรวจสอบ']);
  const pk = new TextDecoder().decode(files.get('xl/worksheets/sheet5.xml'));
  assert.ok(pk.includes('13/10/69') && pk.includes('รอบ 2') && pk.includes('501/1 มิดไนท์'));
  assert.ok(pk.includes('<v>7</v>'), 'total pieces');
});

test('history validation', () => {
  const lines = buildLines(readOrderItems(RAW), makeLookup(CATALOG, new Map()));
  const ok = validatePurchase({ date: '2026-10-13', round: 1, file: 'Order.xlsx', lines });
  assert.equal(ok.lines.length, lines.length);
  assert.equal(ok.lines.reduce((n, l) => n + l.qty, 0), 16);
  assert.throws(() => validatePurchase({ date: '13/10', round: 1, lines }), /วันที่/);
  assert.throws(() => validatePurchase({ date: '2026-10-13', round: 0, lines }), /รอบ/);
  assert.throws(() => validatePurchase({ date: '2026-10-13', round: 1, lines: [...lines, lines[0]] }), /ซ้ำ/);
  assert.throws(() => validatePurchase({ date: '2026-10-13', round: 1, lines: [{ ...lines[0], kind: 'x' }] }), /ไม่ครบ/);
});
