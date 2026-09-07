/**
 * Import products / variants / stock from a CSV export (Bigseller, POS, or the
 * master LOCATION_SKU sheet saved as CSV).
 *
 * Accepted header names (Thai or English, case-insensitive):
 *   sku | รหัสสินค้า            required
 *   name | ชื่อสินค้า           required (product display name)
 *   category | หมวด             optional
 *   price | ราคา                optional (variant price; also sets product base_price if missing)
 *   qty | stock | จำนวน | คงเหลือ  optional (creates a stock snapshot)
 *   set_qty, set_price          optional (e.g. 3, 550 → "3 ตัว 550")
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client.js';
import { parseSku } from './sku.js';

export interface ImportRow {
  sku: string;
  name: string;
  category?: string;
  price?: number;
  qty?: number;
  set_qty?: number;
  set_price?: number;
}

export interface ImportResult {
  products: number;
  variants: number;
  stockRows: number;
  errors: { line: number; error: string }[];
}

const ALIASES: Record<keyof ImportRow, string[]> = {
  sku: ['sku', 'รหัสสินค้า', 'รหัส', 'seller sku', 'seller_sku'],
  name: ['name', 'ชื่อสินค้า', 'ชื่อ', 'product', 'product_name', 'spu'],
  category: ['category', 'หมวด', 'หมวดหมู่', 'ประเภท'],
  price: ['price', 'ราคา', 'ราคาขาย'],
  qty: ['qty', 'stock', 'จำนวน', 'คงเหลือ', 'สต็อก', 'quantity'],
  set_qty: ['set_qty', 'จำนวนต่อเซ็ต'],
  set_price: ['set_price', 'ราคาเซ็ต'],
};

export function parseCsv(text: string): ImportRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (key: keyof ImportRow) => header.findIndex((h) => ALIASES[key].includes(h));
  const idx = {
    sku: col('sku'), name: col('name'), category: col('category'), price: col('price'),
    qty: col('qty'), set_qty: col('set_qty'), set_price: col('set_price'),
  };
  if (idx.sku < 0 || idx.name < 0) throw new Error(`CSV must have sku and name columns (got: ${header.join(', ')})`);
  const num = (v: string | undefined) => (v === undefined || v.trim() === '' ? undefined : Number(v.replace(/[,฿\s]/g, '')));
  return lines.slice(1).map((line) => {
    const c = splitCsvLine(line);
    return {
      sku: c[idx.sku]?.trim() ?? '',
      name: c[idx.name]?.trim() ?? '',
      category: idx.category >= 0 ? c[idx.category]?.trim() || undefined : undefined,
      price: idx.price >= 0 ? num(c[idx.price]) : undefined,
      qty: idx.qty >= 0 ? num(c[idx.qty]) : undefined,
      set_qty: idx.set_qty >= 0 ? num(c[idx.set_qty]) : undefined,
      set_price: idx.set_price >= 0 ? num(c[idx.set_price]) : undefined,
    };
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export async function importRows(db: Db, storeId: string, rows: ImportRow[], source = 'import'): Promise<ImportResult> {
  const result: ImportResult = { products: 0, variants: 0, stockRows: 0, errors: [] };
  await db.query('insert into raw_event(store_id, source, kind, payload) values ($1,$2,$3,$4)', [storeId, source, 'sku_import', JSON.stringify({ rows: rows.length })]);
  const productIds = new Map<string, string>();
  const snapshotAt = new Date().toISOString();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      if (!r.sku || !r.name) throw new Error('missing sku or name');
      const p = parseSku(r.sku);
      let productId = productIds.get(p.type);
      if (!productId) {
        const existing = await db.query<{ id: string }>('select id from product where store_id=$1 and sku_group=$2', [storeId, p.type]);
        if (existing.length) {
          productId = existing[0].id;
          await db.query(
            `update product set name=$3, category=coalesce($4,category), base_price=coalesce($5,base_price), set_price=coalesce($6::jsonb,set_price) where id=$1 and store_id=$2`,
            [productId, storeId, r.name, r.category ?? null, r.price ?? null, r.set_qty && r.set_price ? JSON.stringify({ qty: r.set_qty, price: r.set_price }) : null],
          );
        } else {
          productId = randomUUID();
          await db.query(
            `insert into product(id, store_id, sku_group, name, category, base_price, set_price) values ($1,$2,$3,$4,$5,$6,$7)`,
            [productId, storeId, p.type, r.name, r.category ?? null, r.price ?? null, r.set_qty && r.set_price ? JSON.stringify({ qty: r.set_qty, price: r.set_price }) : null],
          );
          result.products++;
        }
        productIds.set(p.type, productId);
      }
      const v = await db.query<{ id: string }>('select id from variant where sku=$1', [p.sku]);
      let variantId: string;
      if (v.length) {
        variantId = v[0].id;
        if (r.price !== undefined) await db.query('update variant set price=$2 where id=$1', [variantId, r.price]);
      } else {
        variantId = randomUUID();
        await db.query(
          `insert into variant(id, product_id, sku, location, color, size, price) values ($1,$2,$3,$4,$5,$6,$7)`,
          [variantId, productId, p.sku, p.location, p.color, p.size, r.price ?? null],
        );
        result.variants++;
      }
      if (r.qty !== undefined && !Number.isNaN(r.qty)) {
        await db.query('insert into stock_level(variant_id, location, qty, snapshot_at) values ($1,$2,$3,$4)', [variantId, p.location, Math.round(r.qty), snapshotAt]);
        result.stockRows++;
      }
    } catch (e) {
      result.errors.push({ line: i + 2, error: (e as Error).message });
    }
  }
  await db.query(`insert into audit_log(store_id, actor, actor_type, action, target, after) values ($1,'importer','automation','catalog.import',$2,$3)`, [storeId, source, JSON.stringify(result)]);
  return result;
}
