import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSku, cleanSku, codeToPrefix, compareSize, diffTab, groupProducts, locationOf, normaliseRow, parseSheetTab, parseSizes,
  rowFromArray, rowToArray, search, skuKey, thumb, toSheetTsv, type WebSku,
} from '../web/src/catalog.ts';
import { allowedImageUrl, imageKey, imageType, parseHtmlviewTabs, validateSync, validateWebSku } from './catalog.ts';

// Shaped like the real BB tab export: a title row, the header row, a "ต้นทุน+5" note row, then SKUs.
const BB = [
  'B84,,,ตั้งรหัส - [รหัส - ประเภท - คลังสินค้า - สี - size],,,,,,,,,,,',
  'SPU,SKU,รหัสสินค้า,รายละเอียด,สี,size,คลังสินค้า,Price,,ลิงค์รูป,รูป,ร้านค้า,รหัสแทน,ราคาร้านค้า,รหัสเก่า',
  ',,,,,,,ต้นทุน+5 Baht,19%,,,,,,',
  '03-BB-BL,03-BB-BL-28,03,03 กางเกง ขาสั้น MICRO สีดำ,BL,28,BB,150,349,https://cf.shopee.co.th/file/abc,,แพลนเนท,1306-2 สีดำ,145,',
  '03-BB-BL,03-BB-BL-30,03,03 กางเกง ขาสั้น MICRO สีดำ,BL,30,BB,150,349,https://cf.shopee.co.th/file/abc,,แพลนเนท,1306-2 สีดำ,145,',
  '03-BB-BL,03-BB-BL-30,03,duplicate,BL,30,BB,1,1,,,,,,',
  ',,11,,,,,,,,,J.BIG&PK,501/2,,',
  '"200-BB-MD","200-BB-MD-28​","200","200 ยีนส์, มิดไนท์",MD,28,BB,"1,250",,,,"NBG",Le6,180,old-1',
  '"200-BB-MD","200-BB-MD-S","200","200 ยีนส์, มิดไนท์",MD,S,BB,,,,,"NBG",Le6,180,',
].join('\r\n');

// The PK tab has no ร้านค้า header (column L holds "PK") and calls column M "รหัสแทน BB".
const PK = [
  'ค,,SPU,ตั้งรหัส,,,,,,,,,,',
  'SPU,SKU,รหัสสินค้า,รายละเอียด,สี,size,คลังสินค้า,Price,,ลิงค์รูป,รุป,,รหัสแทน BB,สต็อคสินค้า',
  '5011-PK-MD,5011-PK-MD-30,501/1,501/1 ยีนส์,MD,30,PK,110,297,,,PK,M900/1,12',
].join('\n');

test('reads a tab by position for A–J and by header for the supplier columns', () => {
  const t = parseSheetTab('BB', BB);
  assert.equal(t.error, undefined);
  assert.deepEqual(t.rows.map((r) => r.sku), ['03-BB-BL-28', '03-BB-BL-30', '200-BB-MD-28', '200-BB-MD-S']);
  assert.deepEqual(t.duplicates, ['03-BB-BL-30']);
  const first = t.rows[0];
  assert.equal(first.pos, 4);
  assert.equal(first.cost, 150);
  assert.equal(first.price, 349);
  assert.equal(first.shop, 'แพลนเนท');
  assert.equal(first.alias, '1306-2 สีดำ');
  assert.equal(first.shop_price, 145);
  const jean = t.rows[2];
  assert.equal(jean.sku, '200-BB-MD-28', 'zero-width space removed');
  assert.equal(jean.name, '200 ยีนส์, มิดไนท์');
  assert.equal(jean.cost, 1250);
  assert.equal(jean.price, null);
  assert.equal(jean.old_code, 'old-1');

  const pk = parseSheetTab('PK', PK).rows[0];
  assert.equal(pk.shop, '', 'PK column L is not a supplier column');
  assert.equal(pk.alias, 'M900/1');
  assert.equal(pk.code, '501/1');
});

test('a tab without a SKU header is reported, not read', () => {
  const t = parseSheetTab('AI', 'ชีตนี้เป็นข้อมูล,คำสั่ง\nx,y\n');
  assert.ok(t.error);
  assert.equal(t.rows.length, 0);
});

test('only changed and vanished rows are written', () => {
  const before = parseSheetTab('BB', BB).rows;
  const after = before.map((r) => (r.sku === '03-BB-BL-28' ? { ...r, cost: 155 } : r)).filter((r) => r.sku !== '200-BB-MD-S');
  after.push({ ...before[0], sku: '03-BB-BL-32', size: '32', pos: 99 });
  const d = diffTab(before, after);
  assert.deepEqual(d.upsert.map((r) => r.sku).sort(), ['03-BB-BL-28', '03-BB-BL-32']);
  assert.deepEqual(d.remove, ['200-BB-MD-S']);
  assert.deepEqual(diffTab(before, before), { upsert: [], remove: [] });
  // A row deleted above shifts the rest; that alone is not worth rewriting them.
  assert.deepEqual(diffTab(before, before.map((r) => ({ ...r, pos: r.pos - 1 }))), { upsert: [], remove: [] });
});

test('rows survive the array wire format and server validation', () => {
  const rows = parseSheetTab('BB', BB).rows;
  const back = rows.map((r) => rowFromArray(JSON.parse(JSON.stringify(rowToArray(r)))));
  assert.deepEqual(back, rows);
  const s = validateSync({ tab: 'BB', gid: '919371951', sort: 2, rows: rows.map(rowToArray), remove: ['x​'], done: { skus: 4 } });
  assert.deepEqual(s.rows, rows);
  assert.deepEqual(s.remove, ['x']);
  assert.throws(() => validateSync({ tab: 'PK', gid: '0', rows: rows.map(rowToArray) }), /ไม่ได้อยู่แท็บ PK/);
  assert.throws(() => validateSync({ tab: 'BB', gid: 'abc', rows: [] }), /gid/);
  assert.throws(() => normaliseRow({ tab: 'BB', sku: '' }), /ไม่มี SKU/);
  assert.equal(normaliseRow({ tab: 'BB', sku: 'A-B-C', image: 'javascript:alert(1)' }).image, '');
});

test('products group sizes, sort them, and search by code + size', () => {
  const products = groupProducts(parseSheetTab('BB', BB).rows);
  assert.equal(products.length, 2);
  const jean = products.find((p) => p.spu === '200-BB-MD')!;
  assert.deepEqual(jean.skus.map((r) => r.size), ['28', 'S']);
  assert.deepEqual(jean.shops, ['NBG']);

  const hits = search(products, '200 s');
  assert.equal(hits.length, 1);
  assert.ok(hits[0].sizes.has('S'));
  assert.equal(search(products, 'แพลนเนท').length, 1, 'finds by supplier');
  assert.equal(search(products, '1306-2').length, 1, 'finds by supplier code');
  assert.equal(search(products, 'มิดไนท์').length, 1, 'finds by colour name');
  const exact = search(products, '03-bb-bl-30');
  assert.equal(exact[0].product.spu, '03-BB-BL');
  assert.ok(exact[0].sizes.has('30'));
  assert.equal(search(products, '200 44').length, 0);
});

test('web SKUs join their product until the sheet has them', () => {
  const rows = parseSheetTab('BB', BB).rows;
  const w = (sku: string, size: string): WebSku => ({ sku, tab: 'BB', code: '03', name: '', color: 'BL', size, cost: 150, price: 349, image: '', shop: 'แพลนเนท', alias: '', note: '', created_by: 'a@b', created_at: '', updated_at: '' });
  const products = groupProducts(rows, [w('03-BB-BL-32', '32'), w('03-bb-bl-28', '28')]);
  const p = products.find((x) => x.spu === '03-BB-BL')!;
  assert.deepEqual(p.skus.map((r) => r.sku), ['03-BB-BL-28', '03-BB-BL-30', '03-BB-BL-32']);
  assert.ok(p.web);
  const tsv = toSheetTsv([w('03-BB-BL-32', '32')], () => 'BB');
  assert.equal(tsv, '03-BB-BL\t03-BB-BL-32\t03\t\tBL\t32\tBB\t150\t349\t\t\tแพลนเนท');
});

test('a picture added on the page replaces column J', () => {
  const rows = parseSheetTab('BB', BB).rows;
  const plain = groupProducts(rows);
  const shorts = plain.find((p) => p.spu === '03-BB-BL')!;
  assert.equal(shorts.imageSource, 'sheet');
  assert.equal(shorts.thumb, 'https://cf.shopee.co.th/file/abc_tn');
  assert.equal(plain.find((p) => p.spu === '200-BB-MD')!.imageSource, '');
  const withAdded = groupProducts(rows, [], new Map([['BB|200-BB-MD', { full: '/api/catalog/image?size=full', thumb: '/api/catalog/image?size=thumb' }]]));
  const jean = withAdded.find((p) => p.spu === '200-BB-MD')!;
  assert.equal(jean.imageSource, 'page');
  assert.equal(jean.thumb, '/api/catalog/image?size=thumb');
});

test('building SKUs the way the sheet does', () => {
  assert.equal(codeToPrefix('501/1'), '5011');
  assert.equal(codeToPrefix('PK-004'), 'PK004');
  assert.equal(codeToPrefix('03-2'), '032');
  assert.equal(buildSku('5011', 'pk', 'md', '30'), '5011-PK-MD-30');
  assert.deepEqual(parseSizes('36 28, 30 xl s 28'), ['28', '30', '36', 'S', 'XL']);
  assert.ok(compareSize('XXL', '3XL') < 0);
  assert.ok(compareSize('5XL', 'FE') < 0);
  const rows = [...parseSheetTab('BB', BB).rows, normaliseRow({ tab: 'MNM', sku: '805-MN-BL-M' })];
  assert.equal(locationOf(rows, 'MNM'), 'MN');
  assert.equal(locationOf(rows, 'BB'), 'BB');
  assert.equal(skuKey(' 5012-pk-nv-30​'), '5012-PK-NV-30');
  assert.equal(cleanSku('a b'), 'ab');
});

test('web SKU validation', () => {
  const ok = validateWebSku({ sku: '2004-bb-bi-38', tab: 'BB', cost: '124', color: 'bi' }, ['BB']);
  assert.equal(ok.sku, '2004-BB-BI-38');
  assert.equal(ok.cost, 124);
  assert.equal(ok.color, 'BI');
  assert.throws(() => validateWebSku({ sku: '2004', tab: 'BB' }, ['BB']), /รูปแบบ/);
  assert.throws(() => validateWebSku({ sku: '2004-BB-BI-38', tab: 'ZZ' }, ['BB']), /ไม่รู้จักโกดัง/);
  assert.throws(() => validateWebSku({ sku: '2004-BB-BI-38', tab: 'BB', image: 'http://x' }, ['BB']), /https/);
});

test('thumbnails for the image hosts in the sheet', () => {
  assert.equal(thumb('https://cf.shopee.co.th/file/sg-11134201-8258t-mqyblgiqxki4fd'), 'https://cf.shopee.co.th/file/sg-11134201-8258t-mqyblgiqxki4fd_tn');
  assert.equal(thumb('https://down-th.img.susercontent.com/sg-1-a'), 'https://down-th.img.susercontent.com/file/sg-1-a_tn');
  assert.equal(thumb('https://drive.google.com/file/d/1IrD_x/view?usp=sharing'), 'https://drive.google.com/thumbnail?id=1IrD_x&sz=w400');
  const tiktok = 'https://p16-oec-va.ibyteimg.com/tos/x~tplv-origin-jpeg.jpeg?dr=1';
  assert.equal(thumb(tiktok), tiktok);
});

test('warehouse tabs from the sheet html view', () => {
  const html = 'items.push({name: "\\u0e04\\u0e39\\u0e48\\u0e21\\u0e37\\u0e2d", pageUrl: "https://x/htmlview/sheet?headers\\x3dtrue&gid=832342587", gid: "832342587"});'
    + 'items.push({name: "BB", pageUrl: "https://x/htmlview/sheet?headers\\x3dtrue&gid=919371951"});'
    + 'items.push({name: "PK", pageUrl: "https://x/htmlview/sheet?headers\\x3dtrue&gid=0"});'
    + 'items.push({name: "AI", pageUrl: "https://x/htmlview/sheet?headers\\x3dtrue&gid=304155314"});'
    + 'items.push({name: "DB_ALL", pageUrl: "https://x/htmlview/sheet?headers\\x3dtrue&gid=700912967"});'
    + 'items.push({name: "Template", pageUrl: "https://x/htmlview/sheet?headers\\x3dtrue&gid=2113949191"});';
  assert.deepEqual(parseHtmlviewTabs(html), [{ tab: 'BB', gid: '919371951' }, { tab: 'PK', gid: '0' }]);
  assert.deepEqual(parseHtmlviewTabs(html, ['Template']).map((t) => t.tab), ['BB', 'PK', 'Template']);
});

test('sheet link or id', async () => {
  const { parseSheetId } = await import('./catalog.ts');
  assert.equal(parseSheetId('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd/edit?gid=832342587#gid=832342587'), '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd');
  assert.equal(parseSheetId(' 1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd '), '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd');
  assert.throws(() => parseSheetId('hello'), /Google Sheet/);
});

test('uploaded pictures are checked by their bytes', () => {
  assert.equal(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(imageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d])), 'image/png');
  assert.equal(imageType(new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0))))), 'image/webp');
  assert.equal(imageType(new TextEncoder().encode('<svg onload=alert(1)>')), null);
  assert.deepEqual(imageKey('BB', '200-BB-MD'), { key: 'BB|200-BB-MD', tab: 'BB', spu: '200-BB-MD' });
  assert.throws(() => imageKey('', 'x'), /สินค้าไหน/);
});

test('the picture relay only fetches image hosts from the sheet', () => {
  for (const ok of ['https://cf.shopee.co.th/file/abc', 'https://down-th.img.susercontent.com/file/x_tn', 'https://p16-oec-va.ibyteimg.com/a.jpeg?x=1', 'https://assets.page365.net/photos/1.jpg', 'https://drive.google.com/thumbnail?id=1&sz=w400']) {
    assert.ok(allowedImageUrl(ok), ok);
  }
  for (const bad of ['http://cf.shopee.co.th/file/abc', 'https://evil.com/cf.shopee.co.th', 'https://shopee.co.th.evil.com/x', 'https://user:pw@cf.shopee.co.th/x', 'https://cf.shopee.co.th:8443/x', 'https://169.254.169.254/latest', 'file:///etc/passwd', 'not a url']) {
    assert.equal(allowedImageUrl(bad), null, bad);
  }
});
