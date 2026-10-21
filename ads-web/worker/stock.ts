// Stock we hold ourselves (Benz 2026-10-15): พี่เปีย's branch at BB ('pia') and the GoSell fulfillment warehouse
// ('gosell'), for the products in stock_items (5 models × sizes 28–36). Balance = Σ stock_moves.qty.
//   pia:    cut by the order sheets — rows in the "พี่เปีย" group of a saved round (put there by the page when stock
//           is there, or moved by hand), each order + SKU once (stock_orders), less pieces ticked "ของไม่มี".
//           Only rounds after the day of the starting balance count (the sheet covered the days before).
//   gosell: cut by a button after a GoSell file (the page sends order + SKU + qty; each order + SKU once).
//   pk:     our PK warehouse (2026-10-19): every size of our own codes, cut by the order sheets' "PK" sheet the same way.
// Which place keeps which SKU: stock_locs. A sold SKU cut from another SKU's stock: stock_links (601/1–3 → 501/1–3 at
// พี่เปีย). The order sheets' Facebook orders and typed lines (purchase_uploads.extra) are cut too.
// Received stock and count corrections are typed on /catalog/stock.

import { cleanSku, cleanText } from '../web/src/catalog.ts';
import { BadRequest } from './validate.ts';

export const LOCS = ['pia', 'gosell', 'pk'] as const;
export type Loc = (typeof LOCS)[number];
/** The order-sheet group that is the พี่เปีย branch (same as the page's STOCK_GROUP). */
export const STOCK_GROUP = 'พี่เปีย';
/** The order-sheet group of our PK warehouse (the catalog tab's name). */
export const PK_GROUP = 'PK';
/** Places cut by an order-sheet group. */
const SHEET_STOCK: { loc: Loc; group: string }[] = [{ loc: 'pia', group: STOCK_GROUP }, { loc: 'pk', group: PK_GROUP }];

export interface StockItem { sku: string; code: string; size: string; sort: number; locs: Loc[] }
export interface StockMove { id: number; loc: Loc; sku: string; qty: number; kind: 'open' | 'in' | 'out' | 'adjust'; ref: string; date: string; note: string; created_by: string; created_at: string }
export interface StockData {
  items: StockItem[];
  balances: { loc: Loc; sku: string; qty: number }[];
  /** The day of each location's starting balance; the order sheets cut from the day after */
  start: Partial<Record<Loc, string>>;
  /** Changes of the last 45 days, newest first */
  moves: StockMove[];
  /** Order + SKU already cut in the last 14 days (the order page keeps them in the พี่เปีย group) */
  cut: { loc: Loc; order_no: string; sku: string; ref: string }[];
  /** Sold SKU → the SKU whose stock it is cut from, per place */
  links: { loc: Loc; sku: string; stock_sku: string }[];
}

const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const minus = (iso: string, d: number) => new Date(Date.parse(iso) - d * 86400_000).toISOString().slice(0, 10);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function stockData(db: D1Database): Promise<StockData> {
  const [items, balances, start, moves, cut, links] = await db.batch([
    db.prepare('SELECT i.sku, i.code, i.size, i.sort, GROUP_CONCAT(m.loc) AS locs FROM stock_items i JOIN stock_locs m ON m.sku = i.sku GROUP BY i.sku ORDER BY i.sort'),
    db.prepare('SELECT loc, sku, SUM(qty) AS qty FROM stock_moves GROUP BY loc, sku'),
    db.prepare("SELECT loc, MAX(date) AS date FROM stock_moves WHERE kind = 'open' GROUP BY loc"),
    db.prepare('SELECT * FROM stock_moves WHERE date >= ?1 ORDER BY date DESC, id DESC LIMIT 3000').bind(minus(today(), 45)),
    db.prepare(
      `SELECT s.loc, s.order_no, s.sku, s.ref FROM stock_orders s
       WHERE s.ref >= ?1 OR s.ref LIKE 'gosell:%'`,
    ).bind(minus(today(), 14)),
    db.prepare('SELECT loc, sku, stock_sku FROM stock_links'),
  ]);
  return {
    items: (items.results as (Omit<StockItem, 'locs'> & { locs: string })[]).map((i) => ({ ...i, locs: i.locs.split(',') as Loc[] })),
    links: links.results as StockData['links'],
    balances: (balances.results as StockData['balances']).map((b) => ({ ...b, qty: Number(b.qty) || 0 })),
    start: Object.fromEntries((start.results as { loc: Loc; date: string }[]).map((r) => [r.loc, r.date])),
    moves: moves.results as StockMove[],
    cut: cut.results as StockData['cut'],
  };
}

/** Received stock ('in', +), a count correction ('adjust', ±) or a starting balance ('open', owners/admins only). */
export function validateMoves(input: any): { loc: Loc; kind: 'in' | 'adjust' | 'open'; date: string; note: string; items: { sku: string; qty: number }[] } {
  const loc = input?.loc;
  if (!LOCS.includes(loc)) throw new BadRequest('ไม่รู้ว่าเป็นสต็อกที่ไหน');
  const kind = input?.kind;
  if (kind !== 'in' && kind !== 'adjust' && kind !== 'open') throw new BadRequest('ไม่รู้ว่าเป็นของเข้าหรือปรับยอด');
  const date = typeof input?.date === 'string' && DAY.test(input.date) ? input.date : today();
  const raw: any[] = Array.isArray(input?.items) ? input.items : [];
  const items = raw.map((x) => ({ sku: cleanSku(x?.sku), qty: Math.round(Number(x?.qty)) }))
    .filter((x) => x.sku && Number.isFinite(x.qty) && x.qty !== 0);
  if (!items.length) throw new BadRequest('ใส่จำนวนอย่างน้อย 1 ช่อง');
  if (items.length > 200 || items.some((x) => Math.abs(x.qty) > 100_000)) throw new BadRequest('จำนวนไม่ถูกต้อง');
  if (kind === 'in' && items.some((x) => x.qty < 0)) throw new BadRequest('ของเข้าต้องเป็นจำนวนบวก · ถ้านับแล้วขาดให้ใช้ "ปรับยอด"');
  return { loc, kind, date, note: cleanText(input?.note, 200), items };
}

export async function saveMoves(db: D1Database, m: ReturnType<typeof validateMoves>, user: string): Promise<number> {
  const known = new Set(((await db.prepare('SELECT sku FROM stock_locs WHERE loc = ?1').bind(m.loc).all<{ sku: string }>()).results).map((r) => r.sku));
  const bad = m.items.filter((x) => !known.has(x.sku));
  if (bad.length) throw new BadRequest(`ไม่ใช่สินค้าในสต็อก: ${bad.map((x) => x.sku).join(', ')}`);
  const now = new Date().toISOString();
  const rows = m.items.map((x) => ({ loc: m.loc, sku: x.sku, qty: x.qty, kind: m.kind, ref: '', date: m.date, note: m.note, created_by: user, created_at: now }));
  await insertMoves(db, rows);
  return rows.length;
}

/** Removes a typed change (received / correction / starting balance); cuts by orders are undone from their round. */
export async function deleteMove(db: D1Database, id: number): Promise<boolean> {
  const r = await db.prepare("DELETE FROM stock_moves WHERE id = ?1 AND kind IN ('in', 'adjust', 'open')").bind(id).run();
  return (r.meta.changes ?? 0) > 0;
}

async function insertMoves(db: D1Database, rows: Omit<StockMove, 'id'>[]): Promise<void> {
  if (!rows.length) return;
  await db.prepare(
    `INSERT INTO stock_moves (loc, sku, qty, kind, ref, date, note, created_by, created_at)
     SELECT value ->> '$.loc', value ->> '$.sku', value ->> '$.qty', value ->> '$.kind', value ->> '$.ref', value ->> '$.date',
            value ->> '$.note', value ->> '$.created_by', value ->> '$.created_at'
     FROM json_each(?1)`,
  ).bind(JSON.stringify(rows)).run();
}

/**
 * Re-cuts the stock an order-sheet round takes, for each place cut by a group (พี่เปีย ← "พี่เปีย", PK ← "PK"), from what
 * is in that group now (called after the round is saved, ticked or deleted). Bigseller orders come from purchase_items,
 * Facebook orders and typed lines from the round's `extra`. Orders + SKUs already cut by another round are left alone;
 * this round's cut is replaced. Pieces ticked "ของไม่มี" are not cut.
 */
export async function syncRoundStock(db: D1Database, uploadId: string, user: string): Promise<void> {
  for (const { loc, group } of SHEET_STOCK) await syncPlace(db, uploadId, user, loc, group);
}

async function syncPlace(db: D1Database, uploadId: string, user: string, loc: Loc, group: string): Promise<void> {
  const [up, start] = await db.batch([
    db.prepare('SELECT date FROM purchase_uploads WHERE id = ?1').bind(uploadId),
    db.prepare("SELECT MAX(date) AS date FROM stock_moves WHERE loc = ?1 AND kind = 'open'").bind(loc),
  ]);
  const date = (up.results[0] as { date: string } | undefined)?.date;
  const from = (start.results[0] as { date: string | null } | undefined)?.date;
  const clear = [
    db.prepare('DELETE FROM stock_orders WHERE loc = ?2 AND ref = ?1').bind(uploadId, loc),
    db.prepare("DELETE FROM stock_moves WHERE loc = ?2 AND kind = 'out' AND ref = ?1").bind(uploadId, loc),
  ];
  // Deleted round, no starting balance yet, or a day the starting balance already covered: nothing to cut.
  if (!date || !from || date <= from) { await db.batch(clear); return; }
  // An extra item's SKU as the page reads it: through a forced match, or a match of a SKU the catalog doesn't know.
  // `raw` must be qualified (p.sku): a bare "sku" inside these subqueries is catalog_aliases.sku / catalog.sku, which
  // silently skipped every matched SKU (idea #7, 2026-10-21: 501-BB-MD-31 → 5011-PK-MD-31 never cut at พี่เปีย).
  const RESOLVE = (raw: string) => `upper(COALESCE((SELECT a.sku FROM catalog_aliases a WHERE a.alias = upper(${raw})
      AND (a.force = 1 OR NOT EXISTS (SELECT 1 FROM catalog c WHERE upper(c.sku) = upper(${raw})))), ${raw}))`;
  const [, , , cut, missing] = await db.batch([
    ...clear,
    db.prepare(
      `WITH items AS (
         SELECT p.order_no AS key, p.order_no AS match, ${RESOLVE('p.sku')} AS sku, p.qty FROM purchase_items p WHERE p.upload_id = ?1
         UNION ALL
         SELECT CASE WHEN j.value ->> '$.source' = 'manual' OR COALESCE(j.value ->> '$.order', '') = '' THEN 'เพิ่มเอง#' || ?1 || '#' || j.key
                     ELSE 'fb:' || (j.value ->> '$.order') END,
                CASE WHEN j.value ->> '$.source' = 'manual' THEN NULL ELSE j.value ->> '$.order' END,
                ${RESOLVE("(j.value ->> '$.sku')")}, j.value ->> '$.qty'
         FROM purchase_uploads u, json_each(u.extra) j WHERE u.id = ?1
       )
       INSERT OR IGNORE INTO stock_orders (loc, order_no, sku, ref, qty)
       SELECT ?3, it.key, COALESCE(k.stock_sku, l.sku), ?1, SUM(it.qty)
       FROM items it
       JOIN purchase_lines l ON l.upload_id = ?1 AND upper(l.sku) = it.sku AND l.grp = ?2
       LEFT JOIN stock_links k ON k.loc = ?3 AND k.sku = l.sku
       JOIN stock_locs m ON m.loc = ?3 AND m.sku = COALESCE(k.stock_sku, l.sku)
       WHERE it.match IS NULL OR EXISTS (SELECT 1 FROM json_each(l.orders) o WHERE o.value = it.match)
       GROUP BY it.key, COALESCE(k.stock_sku, l.sku)`,
    ).bind(uploadId, group, loc),
    db.prepare('SELECT sku, SUM(qty) AS qty FROM stock_orders WHERE loc = ?2 AND ref = ?1 GROUP BY sku').bind(uploadId, loc),
    db.prepare(
      `SELECT COALESCE(k.stock_sku, l.sku) AS sku, SUM(l.missing) AS missing FROM purchase_lines l
       LEFT JOIN stock_links k ON k.loc = ?3 AND k.sku = l.sku
       JOIN stock_locs m ON m.loc = ?3 AND m.sku = COALESCE(k.stock_sku, l.sku)
       WHERE l.upload_id = ?1 AND l.grp = ?2 GROUP BY COALESCE(k.stock_sku, l.sku)`,
    ).bind(uploadId, group, loc),
  ]);
  const miss = new Map((missing.results as { sku: string; missing: number }[]).map((r) => [r.sku, Number(r.missing) || 0]));
  const now = new Date().toISOString();
  const rows = (cut.results as { sku: string; qty: number }[])
    .map((c) => ({ sku: c.sku, qty: Math.max(0, Number(c.qty) - Math.min(Number(c.qty), miss.get(c.sku) ?? 0)) }))
    .filter((x) => x.qty > 0)
    .map((x) => ({ loc, sku: x.sku, qty: -x.qty, kind: 'out' as const, ref: uploadId, date, note: '', created_by: user, created_at: now }));
  await insertMoves(db, rows);
}

/** GoSell: cut the orders of a file sent to GoSell. `dry` only says what would be cut. */
export async function gosellCut(db: D1Database, input: any, user: string): Promise<{ cut: { sku: string; qty: number }[]; orders: number; already: number; other: number }> {
  const file = cleanText(input?.file, 120) || 'ไฟล์ GoSell';
  const raw: any[] = Array.isArray(input?.lines) ? input.lines.slice(0, 5000) : [];
  const known = new Set(((await db.prepare("SELECT sku FROM stock_locs WHERE loc = 'gosell'").all<{ sku: string }>()).results).map((r) => r.sku));
  const lines = raw.map((x) => ({ order_no: cleanText(x?.order_no, 40), sku: cleanSku(x?.sku), qty: Math.round(Number(x?.qty)) }))
    .filter((x) => x.order_no && x.sku && x.qty > 0 && x.qty < 1000);
  const ours = lines.filter((x) => known.has(x.sku));
  const done = ours.length ? new Set(((await db.prepare(
    "SELECT order_no || '|' || sku AS k FROM stock_orders WHERE loc = 'gosell' AND order_no IN (SELECT value FROM json_each(?1))",
  ).bind(JSON.stringify([...new Set(ours.map((x) => x.order_no))])).all<{ k: string }>()).results).map((r) => r.k)) : new Set<string>();
  const todo = new Map<string, { order_no: string; sku: string; qty: number }>();
  for (const x of ours) {
    const k = `${x.order_no}|${x.sku}`;
    if (done.has(k)) continue;
    const t = todo.get(k) ?? { ...x, qty: 0 };
    t.qty += x.qty;
    todo.set(k, t);
  }
  const bySku = new Map<string, number>();
  for (const t of todo.values()) bySku.set(t.sku, (bySku.get(t.sku) ?? 0) + t.qty);
  const result = {
    cut: [...bySku].map(([sku, qty]) => ({ sku, qty })),
    orders: new Set([...todo.values()].map((t) => t.order_no)).size,
    already: new Set(ours.filter((x) => done.has(`${x.order_no}|${x.sku}`)).map((x) => x.order_no)).size,
    other: lines.length - ours.length,
  };
  if (input?.dry || !todo.size) return result;
  const ref = `gosell:${today()}:${Date.now()}`;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO stock_orders (loc, order_no, sku, ref, qty)
       SELECT 'gosell', value ->> '$.order_no', value ->> '$.sku', ?2, value ->> '$.qty' FROM json_each(?1)`,
    ).bind(JSON.stringify([...todo.values()]), ref),
    db.prepare(
      `INSERT INTO stock_moves (loc, sku, qty, kind, ref, date, note, created_by, created_at)
       SELECT 'gosell', value ->> '$.sku', -(value ->> '$.qty'), 'out', ?2, ?3, ?4, ?5, ?6 FROM json_each(?1)`,
    ).bind(JSON.stringify(result.cut), ref, today(), `${file} · ${result.orders} ออเดอร์`, user, now),
  ]);
  return result;
}

/** Sizes at or under `low` pieces, for the morning report. */
export async function lowStock(db: D1Database, low = 5): Promise<{ loc: Loc; code: string; size: string; qty: number }[]> {
  const { results } = await db.prepare(
    `SELECT m.loc, i.code, i.size, SUM(m.qty) AS qty FROM stock_moves m JOIN stock_items i ON i.sku = m.sku
     GROUP BY m.loc, m.sku HAVING SUM(m.qty) <= ?1 ORDER BY m.loc, i.sort`,
  ).bind(low).all<{ loc: Loc; code: string; size: string; qty: number }>();
  return results;
}
