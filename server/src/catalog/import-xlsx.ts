/**
 * Excel importers for Benz's real catalog files.
 *
 * 1. LOCATION_SKU.xlsx (master catalog) — one tab per location (PK, CM, BB, AR, BT, AM, SP, MN, JW, MK, CN ...),
 *    header on row 2, data from row 3, one row per typ+color with all sizes in one cell:
 *      ประเภท (รุ่น) | สี | ชื่อสินค้า (ตัวอย่าง) | ไซส์ที่มี ("28, 30, 32") | สต็อกรวม | ราคา (ช่วง) ("106.0-260.0")
 *    Expanded exactly like scripts/generate_spu_import.py: one SKU per size, stock split evenly
 *    (remainder to the first sizes), price = midpoint of the range.
 *
 * 2. Bigseller "นำเข้าเพื่อสร้าง SPU" export — one row per SKU:
 *      *เลข SKU | *ชื่อ SKU | สต็อก | อ้างอิงราคาขาย | คลังสินค้า
 *
 * Both produce ImportRow[] for importRows(); the format is auto-detected from the header.
 */
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import type { ImportRow } from './import.js';

export interface XlsxImport {
  format: 'location_sku' | 'bigseller_spu';
  sheets: string[];
  rows: ImportRow[];
  warnings: string[];
}

export function parseSizes(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [''];
  const parts = String(raw).split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : [''];
}

export function splitStockEvenly(total: unknown, n: number): number[] {
  let t = Math.round(Number(total));
  if (!Number.isFinite(t)) t = 0;
  const base = Math.floor(t / n), rem = t % n;
  return Array.from({ length: n }, (_, i) => (i < rem ? base + 1 : base));
}

export function priceMidpoint(range: unknown): number | undefined {
  if (range === null || range === undefined || range === '') return undefined;
  const s = String(range).trim();
  const m = s.match(/^([\d.]+)\s*-\s*([\d.]+)$/);
  if (m) return Math.round(((Number(m[1]) + Number(m[2])) / 2) * 100) / 100;
  const n = Number(s.replace(/[,฿\s]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

const LOC_COLS = { typ: 'ประเภท (รุ่น)', color: 'สี', name: 'ชื่อสินค้า (ตัวอย่าง)', sizes: 'ไซส์ที่มี', stock: 'สต็อกรวม', price: 'ราคา (ช่วง)' };

function findHeaderRow(rows: unknown[][], mustHave: string[]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = (rows[i] ?? []).map((c) => String(c ?? '').trim());
    if (mustHave.every((h) => cells.some((c) => c.startsWith(h)))) return i;
  }
  return -1;
}

export function readWorkbook(fileOrBuffer: string | Buffer, opts: { location?: string } = {}): XlsxImport {
  const wb = XLSX.read(typeof fileOrBuffer === 'string' ? fs.readFileSync(fileOrBuffer) : fileOrBuffer, { type: 'buffer' });
  const warnings: string[] = [];
  const rows: ImportRow[] = [];
  const used: string[] = [];

  // Try Bigseller SPU export first (single sheet, header on row 1)
  const first = wb.Sheets[wb.SheetNames[0]];
  const firstRows = XLSX.utils.sheet_to_json<unknown[]>(first, { header: 1, defval: null });
  const spuHeader = findHeaderRow(firstRows, ['*เลข SKU', 'สต็อก']);
  if (spuHeader >= 0) {
    const h = (firstRows[spuHeader] as unknown[]).map((c) => String(c ?? '').trim());
    const col = (prefix: string) => h.findIndex((c) => c.startsWith(prefix));
    const iSku = col('*เลข SKU'), iName = col('*ชื่อ SKU'), iStock = col('สต็อก'), iPrice = col('อ้างอิงราคาขาย');
    for (const r of firstRows.slice(spuHeader + 1)) {
      const sku = String(r[iSku] ?? '').trim();
      if (!sku) continue;
      rows.push({ sku, name: String(r[iName] ?? sku).trim(), qty: iStock >= 0 ? Number(r[iStock] ?? 0) : undefined, price: iPrice >= 0 ? priceMidpoint(r[iPrice]) : undefined });
    }
    return { format: 'bigseller_spu', sheets: [wb.SheetNames[0]], rows, warnings };
  }

  // LOCATION_SKU: one tab per location
  const sheets = opts.location ? [opts.location] : wb.SheetNames.filter((n) => n !== 'สรุป');
  for (const name of sheets) {
    const ws = wb.Sheets[name];
    if (!ws) { warnings.push(`ไม่พบ tab '${name}' (มี: ${wb.SheetNames.join(', ')})`); continue; }
    const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
    const hi = findHeaderRow(data, [LOC_COLS.typ, LOC_COLS.sizes]);
    if (hi < 0) { warnings.push(`tab '${name}' ไม่ใช่รูปแบบ LOCATION_SKU (ไม่มีคอลัมน์ ${LOC_COLS.typ})`); continue; }
    const h = (data[hi] as unknown[]).map((c) => String(c ?? '').trim());
    const idx = Object.fromEntries(Object.entries(LOC_COLS).map(([k, v]) => [k, h.findIndex((c) => c === v)])) as Record<keyof typeof LOC_COLS, number>;
    used.push(name);
    for (const r of data.slice(hi + 1)) {
      const typ = String(r[idx.typ] ?? '').trim();
      if (!typ) continue;
      const color = String(r[idx.color] ?? '').trim();
      const pname = String(r[idx.name] ?? '').trim() || `${typ}-${color}`;
      const sizes = parseSizes(r[idx.sizes]);
      const stock = splitStockEvenly(r[idx.stock], sizes.length);
      const price = priceMidpoint(r[idx.price]);
      if (price === undefined) warnings.push(`${name}: typ=${typ} สี=${color}: ราคา (ช่วง)='${r[idx.price]}' แปลงเป็นตัวเลขไม่ได้`);
      if (color === 'ZZ' || !color) warnings.push(`${name}: typ=${typ} ยังไม่มีรหัสสี (ZZ)`);
      if (typ.startsWith('IT')) warnings.push(`${name}: typ=${typ} ยังไม่มีรหัสรุ่นจริง (IT)`);
      sizes.forEach((size, i) => {
        const sku = size ? `${typ}-${name}-${color || 'ZZ'}-${size}` : `${typ}-${name}-${color || 'ZZ'}-NA`;
        rows.push({ sku, name: pname, price, qty: stock[i] });   // location lives in the SKU, not in product.category
      });
    }
  }
  return { format: 'location_sku', sheets: used, rows, warnings };
}
