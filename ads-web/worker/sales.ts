// Units sold per day (/catalog/sales). Two sources, which do not overlap:
//   Bigseller (TikTok, Shopee): the order rows of saved order-sheet rounds; an order + SKU is counted once, on the
//     day of the round where it first appeared (orders still "in process" come back in later rounds)
//   Page365 (Facebook): the uploaded order export, by the order's own date
// Rows come back aggregated per day (+ store / SKU), so a 62-day range stays small for the free plan.

import { BadRequest } from './validate.ts';

export const MAX_DAYS = 62;

export interface SalesData {
  from: string; to: string;
  /** Bigseller pieces per day, store and SKU (first appearance only) */
  bigseller: { date: string; store: string; sku: string; qty: number }[];
  /** Bigseller orders per day and store (first appearance only) */
  bigsellerOrders: { date: string; store: string; orders: number }[];
  /** Page365 pieces per day and SKU */
  page365: { date: string; sku: string; name: string; qty: number }[];
  page365Orders: { date: string; orders: number; units: number; total: number }[];
  /** days that have a saved Bigseller round with order rows / a Page365 upload */
  bigsellerDays: string[];
  page365Days: string[];
}

export function parseRange(fromIn: string | null, toIn: string | null): { from: string; to: string } {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const to = toIn && re.test(toIn) ? toIn : new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const from = fromIn && re.test(fromIn) ? fromIn : new Date(Date.parse(to) - 13 * 86400_000).toISOString().slice(0, 10);
  if (from > to) throw new BadRequest('วันเริ่มต้องไม่หลังวันสุดท้าย');
  if ((Date.parse(to) - Date.parse(from)) / 86400_000 + 1 > MAX_DAYS) throw new BadRequest(`ดูได้ครั้งละไม่เกิน ${MAX_DAYS} วัน`);
  return { from, to };
}

export async function salesData(db: D1Database, from: string, to: string): Promise<SalesData> {
  const [bs, bsOrders, p365, p365Orders, bsDays, p365Days] = await db.batch([
    db.prepare(
      `WITH first AS (SELECT order_no, sku, MIN(upload_id) AS upload_id FROM purchase_items GROUP BY order_no, sku)
       SELECT substr(i.upload_id, 1, 10) AS date, i.store, i.sku, SUM(i.qty) AS qty
       FROM purchase_items i JOIN first f ON f.upload_id = i.upload_id AND f.order_no = i.order_no AND f.sku = i.sku
       WHERE substr(i.upload_id, 1, 10) BETWEEN ?1 AND ?2
       GROUP BY date, i.store, i.sku`,
    ).bind(from, to),
    db.prepare(
      `WITH first AS (SELECT order_no, MIN(upload_id) AS upload_id, MIN(store) AS store FROM purchase_items GROUP BY order_no)
       SELECT substr(upload_id, 1, 10) AS date, store, COUNT(*) AS orders FROM first
       WHERE substr(upload_id, 1, 10) BETWEEN ?1 AND ?2 GROUP BY date, store`,
    ).bind(from, to),
    db.prepare(
      `SELECT o.date, j.value ->> '$.sku' AS sku, MAX(j.value ->> '$.name') AS name, SUM(j.value ->> '$.qty') AS qty
       FROM p365_orders o, json_each(o.items) j WHERE o.date BETWEEN ?1 AND ?2 GROUP BY o.date, sku`,
    ).bind(from, to),
    db.prepare('SELECT date, COUNT(*) AS orders, SUM(units) AS units, SUM(total) AS total FROM p365_orders WHERE date BETWEEN ?1 AND ?2 GROUP BY date').bind(from, to),
    db.prepare(
      `SELECT DISTINCT u.date FROM purchase_uploads u WHERE u.date BETWEEN ?1 AND ?2 AND EXISTS (SELECT 1 FROM purchase_items i WHERE i.upload_id = u.id)`,
    ).bind(from, to),
    db.prepare('SELECT date FROM p365_uploads WHERE date BETWEEN ?1 AND ?2').bind(from, to),
  ]);
  return {
    from, to,
    bigseller: bs.results as SalesData['bigseller'],
    bigsellerOrders: bsOrders.results as SalesData['bigsellerOrders'],
    page365: (p365.results as SalesData['page365']).map((r) => ({ ...r, sku: r.sku ?? '', name: r.name ?? '', qty: Number(r.qty) || 0 })),
    page365Orders: p365Orders.results as SalesData['page365Orders'],
    bigsellerDays: (bsDays.results as { date: string }[]).map((r) => r.date),
    page365Days: (p365Days.results as { date: string }[]).map((r) => r.date),
  };
}
