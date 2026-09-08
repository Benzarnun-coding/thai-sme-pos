import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseSizes, priceMidpoint, readWorkbook, splitStockEvenly } from '../src/catalog/import-xlsx.js';
import { getDb, resetDb, type Db } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { importRows } from '../src/catalog/import.js';
import { buildProductSignals } from '../src/signals/build.js';

describe('helpers (same rules as generate_spu_import.py)', () => {
  it('parseSizes splits on commas and trims', () => {
    expect(parseSizes('28, 30 ,32')).toEqual(['28', '30', '32']);
    expect(parseSizes(null)).toEqual(['']);
    expect(parseSizes('free size')).toEqual(['free size']);
  });
  it('splitStockEvenly keeps the exact total, remainder to first sizes', () => {
    expect(splitStockEvenly(10, 3)).toEqual([4, 3, 3]);
    expect(splitStockEvenly('7', 2)).toEqual([4, 3]);
    expect(splitStockEvenly(null, 2)).toEqual([0, 0]);
  });
  it('priceMidpoint handles ranges and plain numbers', () => {
    expect(priceMidpoint('106.0-260.0')).toBe(183);
    expect(priceMidpoint('112-112')).toBe(112);
    expect(priceMidpoint('199')).toBe(199);
    expect(priceMidpoint('')).toBeUndefined();
    expect(priceMidpoint('n/a')).toBeUndefined();
  });
});

function locationSkuBuffer() {
  const wb = XLSX.utils.book_new();
  const header = ['ประเภท (รุ่น)', 'สี', 'ชื่อสินค้า (ตัวอย่าง)', 'ไซส์ที่มี', 'สต็อกรวม', 'ราคา (ช่วง)'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['LOCATION_SKU · PK'], header,
    ['KB', 'BK', 'ยีนส์ทรงกระบอกเล็ก สีดำ', '30, 32, 34', 10, '199.0-199.0'],
    ['ST', 'MW', 'ยีนส์ผ้ายืด', '28, 34', 5, '247.5-299.0'],
    ['IT01', 'ZZ', 'ยังไม่ตั้งรหัส', '30', 1, ''],
  ]), 'PK');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['LOCATION_SKU · CM'], header, ['KB', 'BK', 'ยีนส์ทรงกระบอกเล็ก สีดำ', '32', 3, '199-199']]), 'CM');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['สถานที่', 'จำนวนแถว'], ['PK', 3], ['CM', 1]]), 'สรุป');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function bigsellerBuffer() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['*เลข SPU (จำเป็นต้องกรอก)', '*ชื่อ SPU (จำเป็นต้องกรอก)', 'SPU Image URL', '*เลข SKU (จำเป็นต้องกรอก)', '*ชื่อ SKU (จำเป็นต้องกรอก)', '*ชื่อตัวเลือกสินค้า 1 (จำเป็นต้องกรอก)', '*ตัวเลือก 1 (จำเป็นต้องกรอก)', 'ชื่อตัวเลือกสินค้า 2', 'ตัวเลือก 2', 'ชื่อตัวเลือกสินค้า 3', 'ตัวเลือก 3', 'หมวดหมู่', 'GTIN', 'คลังสินค้า', 'สต็อก', 'ต้นทุน', 'อ้างอิงราคาต้นทุน', 'อ้างอิงราคาขาย'],
    ['SH-PK-BK', 'ขาสั้นผ้าสี', null, 'SH-PK-BK-32', 'ขาสั้นผ้าสี', 'ไซส์', '32', null, null, null, null, 'PK', null, 'PK', 12, null, null, 189],
    ['SH-PK-BK', 'ขาสั้นผ้าสี', null, 'SH-PK-BK-34', 'ขาสั้นผ้าสี', 'ไซส์', '34', null, null, null, null, 'PK', null, 'PK', 8, null, null, 189],
  ]), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('readWorkbook', () => {
  it('expands LOCATION_SKU tabs into per-size SKUs with even stock split', () => {
    const r = readWorkbook(locationSkuBuffer());
    expect(r.format).toBe('location_sku');
    expect(r.sheets).toEqual(['PK', 'CM']);
    expect(r.rows.map((x) => x.sku)).toEqual(['KB-PK-BK-30', 'KB-PK-BK-32', 'KB-PK-BK-34', 'ST-PK-MW-28', 'ST-PK-MW-34', 'IT01-PK-ZZ-30', 'KB-CM-BK-32']);
    expect(r.rows.slice(0, 3).map((x) => x.qty)).toEqual([4, 3, 3]);
    expect(r.rows[3].price).toBe(273.25);
    expect(r.rows[0].category).toBeUndefined();
    expect(r.warnings.some((w) => w.includes('ZZ'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('IT01'))).toBe(true);
  });
  it('can restrict to one location tab', () => {
    const r = readWorkbook(locationSkuBuffer(), { location: 'CM' });
    expect(r.rows.map((x) => x.sku)).toEqual(['KB-CM-BK-32']);
  });
  it('reads a Bigseller SPU export', () => {
    const r = readWorkbook(bigsellerBuffer());
    expect(r.format).toBe('bigseller_spu');
    expect(r.rows).toEqual([
      { sku: 'SH-PK-BK-32', name: 'ขาสั้นผ้าสี', qty: 12, price: 189 },
      { sku: 'SH-PK-BK-34', name: 'ขาสั้นผ้าสี', qty: 8, price: 189 },
    ]);
  });
});

describe('end to end into the database', () => {
  let db: Db;
  beforeAll(async () => { await resetDb(); db = await getDb(); await migrate(db); await db.query(`insert into store(id,name) values ('t','test')`); await db.query(`insert into size_rule(store_id,category,core_sizes,min_qty_per_size) values ('t','*',$1,3)`, [['30', '32', '34']]); });
  afterAll(async () => { await resetDb(); });
  it('imports and the signal builder sees per-location stock', async () => {
    const parsed = readWorkbook(locationSkuBuffer());
    const res = await importRows(db, 't', parsed.rows, 'test');
    expect(res.errors).toEqual([]);
    expect(res.products).toBe(3); // KB, ST, IT01 (KB appears in two locations → one product)
    expect(res.variants).toBe(7);
    const s = await buildProductSignals(db, 't');
    const kb = s.find((x) => x.sku_group === 'KB')!;
    expect(kb.stock_by_size).toEqual({ '30': 4, '32': 6, '34': 3 }); // 32 = PK 3 + CM 3
    expect(kb.core_size_ok).toBe(true);
    const st = s.find((x) => x.sku_group === 'ST')!;
    expect(st.missing_core_sizes).toEqual(['30', '32', '34']);
  });
});
