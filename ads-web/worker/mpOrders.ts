// Marketplace money (mp_orders) and the profit page's data (/catalog/profit). The browser reads the platform's
// export (web/src/money.ts) and sends one row per order; this validates and stores them, and serves everything the
// profit page needs for a range: Page365 orders with the shop's per-order fees, marketplace money, the order-sheet
// items of marketplace orders, and Meta's daily spend (Facebook ads).

import { cleanSku } from '../web/src/catalog.ts';
import type { OrderFees } from './db.ts';
import { loadOrders, orderFees } from './p365.ts';
import { BadRequest } from './validate.ts';

const PLATFORMS = ['TikTok', 'Shopee', 'Lazada'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown, min = -1e9, max = 1e9): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : null;
};

export interface MpOrderRow {
  order_no: string; platform: string; date: string | null; amount: number; kind: 'gross' | 'net'; fees: number | null; status: string;
  items: { sku: string; qty: number; amount: number | null }[] | null;
}

export function validateMpOrders(input: any): { file: string; orders: MpOrderRow[] } {
  const list: any[] = Array.isArray(input?.orders) ? input.orders : [];
  if (!list.length || list.length > 5000) throw new BadRequest('ส่งได้ครั้งละ 1–5,000 ออเดอร์');
  const orders = list.map((o, i): MpOrderRow => {
    const order_no = String(o?.order_no ?? '').trim();
    if (!order_no || order_no.length > 40 || /\s/.test(order_no)) throw new BadRequest(`แถว ${i + 1}: เลขคำสั่งซื้อไม่ถูกต้อง`);
    if (!PLATFORMS.includes(o?.platform)) throw new BadRequest(`แถว ${i + 1}: ไม่รู้ว่าเป็นช่องทางไหน`);
    const amount = num(o?.amount, -1e7, 1e7);
    if (amount === null) throw new BadRequest(`ออเดอร์ ${order_no}: ยอดเงินไม่ใช่ตัวเลข`);
    const kind = o?.kind === 'net' ? 'net' : 'gross';
    const date = typeof o?.date === 'string' && DAY.test(o.date) ? o.date : null;
    const items = Array.isArray(o?.items) ? o.items.slice(0, 100).map((x: any) => ({
      sku: cleanSku(String(x?.sku ?? '')).slice(0, 80), qty: Math.max(1, Math.min(10_000, Math.round(num(x?.qty, 0, 1e5) ?? 1))), amount: num(x?.amount, -1e7, 1e7),
    })).filter((x: { sku: string }) => x.sku) : null;
    return { order_no, platform: o.platform, date, amount, kind, fees: kind === 'gross' ? num(o?.fees, 0, 1e7) : null, status: String(o?.status ?? '').slice(0, 60), items: items?.length ? items : null };
  });
  return { file: String(input?.file ?? '').slice(0, 200), orders };
}

/** Upsert by order number (a newer file replaces what an older one said about the same order). */
export async function saveMpOrders(db: D1Database, file: string, orders: MpOrderRow[], user: string): Promise<number> {
  const now = new Date().toISOString();
  const rows = orders.map((o) => ({ ...o, items: o.items ? JSON.stringify(o.items) : null, file, updated_by: user, updated_at: now }));
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    statements.push(db.prepare(
      `INSERT INTO mp_orders (order_no, platform, date, amount, kind, fees, status, items, file, updated_by, updated_at)
       SELECT value ->> '$.order_no', value ->> '$.platform', value ->> '$.date', value ->> '$.amount', value ->> '$.kind', value ->> '$.fees',
              value ->> '$.status', value ->> '$.items', value ->> '$.file', value ->> '$.updated_by', value ->> '$.updated_at'
       FROM json_each(?1) WHERE true
       ON CONFLICT (order_no) DO UPDATE SET platform = excluded.platform, date = excluded.date, amount = excluded.amount, kind = excluded.kind,
         fees = excluded.fees, status = excluded.status, items = excluded.items, file = excluded.file, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(JSON.stringify(rows.slice(i, i + 500))));
  }
  await db.batch(statements);
  return rows.length;
}

export interface ImportMap { signature: string; map: unknown; platform: string; updated_by: string; updated_at: string }

export async function listImportMaps(db: D1Database): Promise<ImportMap[]> {
  const rows = (await db.prepare('SELECT signature, map, platform, updated_by, updated_at FROM mp_import_maps ORDER BY updated_at DESC LIMIT 50').all<ImportMap & { map: string }>()).results;
  return rows.map((r) => ({ ...r, map: JSON.parse(r.map) }));
}

export async function saveImportMap(db: D1Database, input: any, user: string): Promise<void> {
  const signature = String(input?.signature ?? '').slice(0, 2000);
  const m = input?.map;
  if (!signature || !m || typeof m !== 'object' || typeof m.order !== 'string' || typeof m.amount !== 'string') throw new BadRequest('ต้องเลือกคอลัมน์เลขคำสั่งซื้อและยอดเงิน');
  const platform = PLATFORMS.includes(input?.platform) ? input.platform : 'auto';
  const map = JSON.stringify({
    order: m.order.slice(0, 120), amount: m.amount.slice(0, 120), kind: m.kind === 'net' ? 'net' : 'gross',
    fees: Array.isArray(m.fees) ? m.fees.slice(0, 10).map((x: unknown) => String(x).slice(0, 120)) : [],
    ...Object.fromEntries(['date', 'status', 'sku', 'qty', 'itemAmount'].map((k) => [k, String(m[k] ?? '').slice(0, 120)])),
  });
  await db.prepare(
    `INSERT INTO mp_import_maps (signature, map, platform, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (signature) DO UPDATE SET map = excluded.map, platform = excluded.platform, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(signature, map, platform, user, new Date().toISOString()).run();
}

export interface ProfitData {
  from: string; to: string;
  page365: { order_no: string; date: string; total: number; fee: number; items: { sku: string; name: string; qty: number; price: number }[] }[];
  marketplace: (MpOrderRow & { file: string })[];
  /** Order-sheet items (first appearance) of marketplace orders first seen in the range or with money in it */
  sheetItems: { order_no: string; date: string; store: string; sku: string; qty: number }[];
  spend: { date: string; spend: number }[] | null;
  spendError: string | null;
  page365Days: string[];
  mpFiles: { file: string; orders: number; updated_by: string; updated_at: string }[];
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export async function profitData(db: D1Database, from: string, to: string, fees: OrderFees, spend: () => Promise<{ date: string; spend: number }[]>): Promise<ProfitData> {
  const FIRST = `first AS (SELECT order_no, sku, MIN(upload_id) AS upload_id FROM purchase_items GROUP BY order_no, sku),
    seen AS (SELECT order_no, MIN(substr(upload_id, 1, 10)) AS date FROM purchase_items GROUP BY order_no)`;
  const [orders, batch, spendRows] = await Promise.all([
    loadOrders(db, datesBetween(from, to)),
    db.batch([
      db.prepare(
        `WITH ${FIRST}
         SELECT m.order_no, m.platform, COALESCE(m.date, s.date) AS date, m.amount, m.kind, m.fees, m.status, m.items, m.file
         FROM mp_orders m LEFT JOIN seen s ON s.order_no = m.order_no
         WHERE COALESCE(m.date, s.date) BETWEEN ?1 AND ?2`,
      ).bind(from, to),
      db.prepare(
        `WITH ${FIRST}
         SELECT i.order_no, s.date, i.store, i.sku, SUM(i.qty) AS qty
         FROM purchase_items i JOIN first f ON f.upload_id = i.upload_id AND f.order_no = i.order_no AND f.sku = i.sku
         JOIN seen s ON s.order_no = i.order_no
         LEFT JOIN mp_orders m ON m.order_no = i.order_no
         WHERE s.date BETWEEN ?1 AND ?2 OR COALESCE(m.date, s.date) BETWEEN ?1 AND ?2
         GROUP BY i.order_no, i.sku`,
      ).bind(from, to),
      db.prepare('SELECT date FROM p365_uploads WHERE date BETWEEN ?1 AND ?2').bind(from, to),
      db.prepare('SELECT file, COUNT(*) AS orders, MAX(updated_by) AS updated_by, MAX(updated_at) AS updated_at FROM mp_orders GROUP BY file ORDER BY updated_at DESC LIMIT 10'),
    ]),
    spend().then((r) => ({ rows: r, error: null as string | null }), (e: unknown) => ({ rows: null, error: e instanceof Error ? e.message : String(e) })),
  ]);
  const [mp, items, days, files] = batch;
  return {
    from, to,
    page365: orders.map((o) => ({ order_no: o.order_no, date: o.date, total: o.total, fee: Math.round(orderFees(o, fees) * 100) / 100, items: o.items.map((i) => ({ sku: i.sku, name: i.name, qty: i.qty, price: i.price })) })),
    marketplace: (mp.results as any[]).map((r) => ({ ...r, items: r.items ? JSON.parse(r.items) : null })),
    sheetItems: (items.results as ProfitData['sheetItems']).map((r) => ({ ...r, qty: Number(r.qty) || 0 })),
    spend: spendRows.rows, spendError: spendRows.error,
    page365Days: (days.results as { date: string }[]).map((r) => r.date),
    mpFiles: files.results as ProfitData['mpFiles'],
  };
}
