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

test('the same file as CSV: UTF-8 commas, Bigseller UTF-16 tabs, Thai Excel (Windows-874), English headers', async () => {
  const { parseExport } = await import('../web/src/gosell.ts');
  const header = ['ร้านค้า BigSeller', 'SKU', 'ชื่อสินค้า', 'ชื่อตัวเลือก', 'จำนวน', 'หมายเลขคำสั่งซื้อ'];
  const lines = [
    ['STM-SHOP', '5011-PK-MD-30', 'กางเกงยีนส์, ทรงกระบอก', '501 (มิดไนท์), 30', '2', '586549686037481268'],
    ['Shopee PK-JEANS', 'J41-BB-BL-34', 'ขาสั้น', 'J41-2, 34', '1', '261012E7C5RBY5'],
  ];
  const quote = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  const groupsOf = (headers: string[], rows: Record<string, string>[]) => {
    assert.equal(missingOrderColumns(headers), null);
    return groupLines(buildLines(readOrderItems(rows, headers), makeLookup(CATALOG, new Map()))).map((g) => [g.name, g.pieces]);
  };
  const expected = [['แพลนเนท', 1], ['PK', 2]];

  // UTF-8 with BOM, commas, quoted cells containing commas
  const utf8 = new TextEncoder().encode('﻿' + [header, ...lines].map((r) => r.map(quote).join(',')).join('\r\n'));
  const a = parseExport(utf8);
  assert.deepEqual(groupsOf(a.headers, a.rows), expected);

  // Bigseller's own CSV: UTF-16 LE with BOM, tabs
  const tsv = [header, ...lines].map((r) => r.join('\t')).join('\r\n');
  const u16 = new Uint8Array(2 + tsv.length * 2);
  u16[0] = 0xff; u16[1] = 0xfe;
  for (let i = 0; i < tsv.length; i++) { u16[2 + i * 2] = tsv.charCodeAt(i) & 0xff; u16[3 + i * 2] = tsv.charCodeAt(i) >> 8; }
  const b = parseExport(u16);
  assert.deepEqual(groupsOf(b.headers, b.rows), expected);

  // Re-saved by Thai Excel: Windows-874 (Thai U+0E01–U+0E5B → 0xA1–0xFB)
  const csv = [header, ...lines].map((r) => r.map(quote).join(',')).join('\r\n');
  const tis = Uint8Array.from([...csv].map((ch) => { const c = ch.charCodeAt(0); return c >= 0x0e01 && c <= 0x0e5b ? c - 0x0e01 + 0xa1 : c; }));
  const c = parseExport(tis);
  assert.ok(c.headers.includes('ร้านค้า BigSeller'), 'Thai headers decoded');
  assert.deepEqual(groupsOf(c.headers, c.rows), expected);

  // English Bigseller headers
  const en = ['Store', 'SKU', 'Product Name', 'Variation', 'Quantity', 'Order No.'];
  const d = parseExport(new TextEncoder().encode([en, ...lines].map((r) => r.map(quote).join(',')).join('\n')));
  assert.deepEqual(groupsOf(d.headers, d.rows), expected);
  assert.equal(readOrderItems(d.rows, d.headers)[0].option, '501 (มิดไนท์), 30');

  assert.deepEqual(missingOrderColumns(['Store', 'Product Name']), ['SKU', 'จำนวน']);
});

test('picture blocks: one per product, sizes in order, quantities added up', async () => {
  const { pictureBlocks, wantsPictures } = await import('../web/src/purchase.ts');
  const cn: CatalogRow[] = [
    row({ tab: 'CN', sku: 'PK004-CN-BL-L', code: 'PK-004', color: 'BL', size: 'L', image: 'https://cf.shopee.co.th/file/a' }),
    row({ tab: 'CN', sku: 'PK004-CN-BL-2XL', code: 'PK-004', color: 'BL', size: '2XL' }),
    row({ tab: 'CN', sku: 'C01-CN-GN-M', code: 'C01', color: 'GN', size: 'M' }),
  ];
  const items = readOrderItems([
    { SKU: 'PK004-CN-BL-2XL', 'จำนวน': '1' }, { SKU: 'PK004-CN-BL-L', 'จำนวน': '2' }, { SKU: 'pk004-cn-bl-l', 'จำนวน': '1' }, { SKU: 'C01-CN-GN-M', 'จำนวน': '1' },
  ]);
  const lookup = makeLookup(cn, new Map());
  const g = groupLines(buildLines(items, lookup))[0];
  assert.equal(g.name, 'CN');
  assert.ok(wantsPictures(g));
  const info = (sku: string) => { const r = lookup.rows.get(sku.toUpperCase()); return r ? { key: `${r.tab}|${r.sku.split('-').slice(0, -1).join('-')}`, code: r.code, color: r.color, image: r.image } : undefined; };
  const blocks = pictureBlocks(g, info);
  assert.deepEqual(blocks.map((b) => [b.code, b.color, b.qty, b.sizes.map((s) => `${s.size}×${s.qty}`).join(' ')]), [['C01', 'GN', 1, 'M×1'], ['PK-004', 'BL', 4, 'L×3 2XL×1']]);
  assert.equal(blocks[1].image, 'https://cf.shopee.co.th/file/a', 'photo from the first size listed (L), which has one');
  assert.ok(!wantsPictures(groupLines(buildLines(readOrderItems(RAW), makeLookup(CATALOG, new Map())))[0]));
});

test('only BB needs a supplier; BBW without one goes to the BBW sheet, with one to that supplier', () => {
  const rows = [
    row({ tab: 'BBW', sku: 'LCP-BBW-OL-2XL', code: 'LCP', color: 'OL', size: '2XL' }),
    row({ tab: 'BBW', sku: '411-BBW-SB-M', code: '411', color: 'SB', size: 'M', shop: 'นอร์ท' }),
    row({ tab: 'BBW', sku: 'X-BBW-BL-M', code: 'X', color: 'BL', size: 'M', shop: 'หมด' }),
    row({ tab: 'BB', sku: '8000-BB-LB-30', code: '8000/11', color: 'LB', size: '30' }),
  ];
  const items = readOrderItems([{ SKU: 'LCP-BBW-OL-2XL', 'จำนวน': '1' }, { SKU: '411-BBW-SB-M', 'จำนวน': '1' }, { SKU: 'X-BBW-BL-M', 'จำนวน': '1' }, { SKU: '8000-BB-LB-30', 'จำนวน': '1' }]);
  const groups = groupLines(buildLines(items, makeLookup(rows, new Map())));
  assert.deepEqual(groups.map((g) => [g.name, g.kind, g.lines.map((l) => l.sku).join(',')]), [
    ['นอร์ท', 'supplier', '411-BBW-SB-M'],
    ['BB · ยังไม่ระบุร้าน', 'unassigned', '8000-BB-LB-30'],
    ['BBW', 'warehouse', 'LCP-BBW-OL-2XL,X-BBW-BL-M'],
  ]);
});

test('any row can be moved to any supplier or warehouse for the round, typed or picked', async () => {
  const { applyMoves } = await import('../web/src/purchase.ts');
  const lines = buildLines(readOrderItems(RAW), makeLookup(CATALOG, new Map()));
  const review = lines.filter((l) => l.kind === 'review');
  const noSku = review.find((l) => l.sku.startsWith('?') && l.note.includes('L712'))!;
  const moves = new Map([['2004-BB-BI-38', 'J.BIG'], [noSku.sku, ' ร้านใหม่ '], ['5011-PK-MD-30', 'X']]);
  const groups = groupLines(applyMoves(lines, moves, new Set(['PK', 'CN']), makeLookup(CATALOG, new Map())));
  const jbig = groups.find((g) => g.name === 'J.BIG')!;
  const moved = jbig.lines.find((l) => l.moved)!;
  assert.deepEqual([moved.label, moved.size, moved.qty, moved.kind], ['2004-BB-BI', '38', 2, 'supplier']);
  const typed = groups.find((g) => g.name === 'ร้านใหม่')!;
  assert.deepEqual([typed.kind, typed.lines[0].label, typed.lines[0].size], ['supplier', 'L712/2 (มิดไนท์), 30 (ซิป)', '']);
  assert.equal(groups.find((g) => g.name === 'ตรวจสอบ')!.pieces, 1, 'one row left');
  assert.equal(groups.find((g) => g.name === 'PK')!.pieces, 4, 'a matched row moves too (out of stock → another supplier)');
  const x = groups.find((g) => g.name === 'X')!;
  assert.deepEqual([x.lines[0].label, x.lines[0].from, x.lines[0].orders], ['501/1 มิดไนท์', 'PK', ['A1', 'A2']]);
  assert.equal(groupLines(applyMoves(lines, new Map([['2004-BB-BI-38', 'CN']]), new Set(['CN']))).find((g) => g.name === 'CN')!.kind, 'warehouse');
  // moved lines still pass history validation
  assert.ok(validatePurchase({ date: '2026-10-13', round: 1, lines: applyMoves(lines, moves, new Set()) }));
});

test('order numbers follow each line to the sheet and the Excel file', async () => {
  const lines = buildLines(readOrderItems(RAW), makeLookup(CATALOG, new Map()));
  const pk = lines.filter((l) => l.group === 'PK');
  assert.deepEqual(pk.find((l) => l.sku === '5011-PK-MD-30')!.orders, ['A1', 'A2'], 'two orders, case/zero-width variants of one SKU');
  assert.deepEqual(pk.find((l) => l.sku === '2003-PK-MR-32')!.orders, ['A3']);
  const groups = groupLines(lines);
  const files = await unzip(await orderWorkbook([groups.find((g) => g.name === 'PK')!], '2026-10-13', 1));
  const sheet = new TextDecoder().decode(files.get('xl/worksheets/sheet1.xml'));
  assert.ok(sheet.includes('เลขคำสั่งซื้อ') && sheet.includes('A1, A2'));
  const saved = validatePurchase({ date: '2026-10-13', round: 1, lines });
  assert.deepEqual(saved.lines.find((l) => l.sku === '5011-PK-MD-30')!.orders, ['A1', 'A2']);
});

test('ticked out-of-stock lines become the พี่เปีย sheet', async () => {
  const { missingGroup, lineKey, MISSING_GROUP } = await import('../web/src/purchase.ts');
  const lookup = makeLookup(CATALOG, new Map());
  const lines = buildLines(readOrderItems(RAW), lookup);
  const jbig = lines.find((l) => l.group === 'J.BIG')!;
  const pk = lines.find((l) => l.sku === '5011-PK-MD-30')!;
  // a supplier moved to another one keeps its tick (keyed by SKU)
  assert.equal(lineKey(jbig), jbig.sku);
  assert.equal(missingGroup(lines, new Map(), lookup), null);
  const g = missingGroup(lines, new Map([[lineKey(jbig), 1], [lineKey(pk), 5]]), lookup)!;
  assert.equal(g.name, MISSING_GROUP);
  assert.equal(g.pieces, 4, 'ticked quantity, capped at the line quantity (3)');
  assert.deepEqual(g.lines.map((l) => [l.label, l.size, l.qty, l.note]), [
    ['1306-4 โอวัลติน', '30', 1, 'ไม่มีที่ J.BIG'],
    ['501/1 มิดไนท์', '30', 3, 'ไม่มีที่ PK'],
  ], "our own code + colour, not the supplier's code");
  assert.deepEqual(g.lines[1].orders, ['A1', 'A2']);
});

test('out-of-stock ticks are validated', async () => {
  const { validateMissing } = await import('./purchase.ts');
  const ok = validateMissing({ id: '2026-10-13#2', items: [{ grp: 'J.BIG', sku: '13064-BB-OV-30', missing: '2' }, { grp: 'PK', sku: 'x', missing: -3 }] });
  assert.deepEqual(ok.items.map((i) => i.missing), [2, 0]);
  assert.throws(() => validateMissing({ id: '2026-10-13', items: [{ grp: 'a', sku: 'b', missing: 1 }] }), /รอบไหน/);
  assert.throws(() => validateMissing({ id: '2026-10-13#1', items: [] }), /ไม่มีรายการ/);
});
