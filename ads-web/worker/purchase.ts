// Order sheet history (/catalog/orders). The page builds the sheets from Bigseller's file in the browser; what is
// saved is the result per day + round: SKU, quantity, supplier group, the marketplace order numbers of each line, and
// how many pieces a supplier later reported out of stock ("ของไม่มี" → the พี่เปีย file). Tracking numbers are not kept.
// Saving the same day + round again replaces the lines but keeps the out-of-stock ticks.

import { cleanText } from '../web/src/catalog.ts';
import { BadRequest } from './validate.ts';

const KINDS = new Set(['supplier', 'warehouse', 'unassigned', 'review']);
const MAX_LINES = 5000;

const MAX_ORDERS_PER_LINE = 1000;

export interface PurchaseUpload { id: string; date: string; round: number; file: string; pieces: number; review: number; missing: number; groups: { name: string; kind: string; pieces: number }[]; saved_by: string; saved_at: string }
export interface SavedLine {
  grp: string; kind: string; sku: string; tab: string; label: string; size: string; qty: number; note: string; orders: string[]; missing: number;
  /** order number → sales store ("TikTok · STM-SHOP") */
  stores: Record<string, string>;
  /** price per piece when last saved, and where it came from (web | shop | cost) */
  price: number | null;
  price_source: string;
}
const PRICE_SOURCES = new Set(['web', 'cost', '']);

export function validatePurchase(input: any): { date: string; round: number; file: string; lines: SavedLine[] } {
  const date = String(input?.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequest('วันที่ไม่ถูกต้อง');
  const round = Math.trunc(Number(input?.round));
  if (!(round >= 1 && round <= 9)) throw new BadRequest('รอบต้องเป็น 1–9');
  const raw: unknown[] = Array.isArray(input?.lines) ? input.lines : [];
  if (!raw.length) throw new BadRequest('ไม่มีรายการ');
  if (raw.length > MAX_LINES) throw new BadRequest(`รายการเกิน ${MAX_LINES}`);
  const seen = new Set<string>();
  const lines = raw.map((x: any) => {
    const l: SavedLine = {
      grp: cleanText(x?.group, 80), kind: String(x?.kind ?? ''), sku: cleanText(x?.sku, 200), tab: cleanText(x?.tab, 40),
      label: cleanText(x?.label, 200), size: cleanText(x?.size, 40), qty: Math.trunc(Number(x?.qty)), note: cleanText(x?.note, 300),
      orders: [...new Set((Array.isArray(x?.orders) ? x.orders : []).map((o: unknown) => cleanText(o, 60)).filter(Boolean))].slice(0, MAX_ORDERS_PER_LINE) as string[],
      missing: 0,
      stores: {},
      price: x?.price === null || x?.price === undefined || x?.price === '' ? null : Number(x.price),
      price_source: PRICE_SOURCES.has(String(x?.priceSource ?? x?.price_source ?? '')) ? String(x?.priceSource ?? x?.price_source ?? '') : '',
    };
    if (l.price !== null && !(Number.isFinite(l.price) && l.price >= 0 && l.price <= 100_000)) l.price = null;
    if (x?.stores && typeof x.stores === 'object') {
      for (const o of l.orders) { const v = cleanText(x.stores[o], 80); if (v) l.stores[o] = v; }
    }
    if (!l.grp || !l.sku || !KINDS.has(l.kind) || !(l.qty > 0 && l.qty < 100_000)) throw new BadRequest(`รายการไม่ครบ: ${l.sku || '(ไม่มี SKU)'}`);
    const k = `${l.grp}\u0000${l.sku}`;
    if (seen.has(k)) throw new BadRequest(`รายการซ้ำ: ${l.grp} ${l.sku}`);
    seen.add(k);
    return l;
  });
  return { date, round, file: cleanText(input?.file, 200), lines };
}

export async function savePurchase(db: D1Database, p: ReturnType<typeof validatePurchase>, user: string): Promise<PurchaseUpload> {
  const id = `${p.date}#${p.round}`;
  const groups = new Map<string, { name: string; kind: string; pieces: number }>();
  for (const l of p.lines) {
    const g = groups.get(l.grp) ?? { name: l.grp, kind: l.kind, pieces: 0 };
    g.pieces += l.qty;
    groups.set(l.grp, g);
  }
  const pieces = p.lines.reduce((n, l) => n + l.qty, 0);
  const review = p.lines.filter((l) => l.kind === 'review').reduce((n, l) => n + l.qty, 0);
  const now = new Date().toISOString();
  // Out-of-stock ticks made earlier on this round survive a re-save: same group + SKU first, else the same SKU.
  const old = (await db.prepare('SELECT grp, sku, missing FROM purchase_lines WHERE upload_id = ?1 AND missing > 0').bind(id).all<{ grp: string; sku: string; missing: number }>()).results;
  const byLine = new Map(old.map((o) => [`${o.grp}\u0000${o.sku}`, o.missing]));
  const bySku = new Map(old.map((o) => [o.sku, o.missing]));
  for (const l of p.lines) l.missing = Math.min(l.qty, byLine.get(`${l.grp}\u0000${l.sku}`) ?? bySku.get(l.sku) ?? 0);
  const missing = p.lines.reduce((n, l) => n + l.missing, 0);
  const upload: PurchaseUpload = { id, date: p.date, round: p.round, file: p.file, pieces, review, missing, groups: [...groups.values()], saved_by: user, saved_at: now };
  const insert = `INSERT INTO purchase_lines (upload_id, grp, kind, sku, tab, label, size, qty, note, orders, missing, stores, price, price_source)
    SELECT ?1, value ->> '$.grp', value ->> '$.kind', value ->> '$.sku', value ->> '$.tab', value ->> '$.label', value ->> '$.size', value ->> '$.qty', value ->> '$.note',
           json(value -> '$.orders'), value ->> '$.missing', json(value -> '$.stores'), value ->> '$.price', value ->> '$.price_source' FROM json_each(?2)`;
  const chunks: SavedLine[][] = [];
  for (let i = 0; i < p.lines.length; i += 500) chunks.push(p.lines.slice(i, i + 500));
  await db.batch([
    db.prepare('DELETE FROM purchase_lines WHERE upload_id = ?1').bind(id),
    ...chunks.map((c) => db.prepare(insert).bind(id, JSON.stringify(c))),
    db.prepare(
      `INSERT INTO purchase_uploads (id, date, round, file, pieces, review, missing, groups, saved_by, saved_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT (id) DO UPDATE SET file = excluded.file, pieces = excluded.pieces, review = excluded.review, missing = excluded.missing, groups = excluded.groups, saved_by = excluded.saved_by, saved_at = excluded.saved_at`,
    ).bind(id, p.date, p.round, p.file, pieces, review, missing, JSON.stringify(upload.groups), user, now),
  ]);
  return upload;
}

export async function listPurchases(db: D1Database, limit = 60): Promise<PurchaseUpload[]> {
  const { results } = await db.prepare('SELECT * FROM purchase_uploads ORDER BY date DESC, round DESC LIMIT ?1').bind(limit).all<Omit<PurchaseUpload, 'groups'> & { groups: string }>();
  return results.map((r) => ({ ...r, groups: JSON.parse(r.groups) }));
}

export async function purchaseLines(db: D1Database, id: string): Promise<SavedLine[]> {
  const { results } = await db.prepare('SELECT grp, kind, sku, tab, label, size, qty, note, orders, missing, stores, price, price_source FROM purchase_lines WHERE upload_id = ?1').bind(id).all<Omit<SavedLine, 'orders' | 'stores'> & { orders: string; stores: string }>();
  return results.map((r) => ({ ...r, orders: JSON.parse(r.orders || '[]'), stores: JSON.parse(r.stores || '{}') }));
}

/** Ticks from the page: how many pieces of a line the supplier did not have (0 = untick). Clamped to the line's qty. */
export function validateMissing(input: any): { id: string; items: { grp: string; sku: string; missing: number }[] } {
  const id = String(input?.id ?? '');
  if (!/^\d{4}-\d{2}-\d{2}#\d$/.test(id)) throw new BadRequest('ไม่รู้ว่าเป็นใบสั่งรอบไหน');
  const raw: unknown[] = Array.isArray(input?.items) ? input.items : [];
  if (!raw.length || raw.length > MAX_LINES) throw new BadRequest('ไม่มีรายการที่จะติ๊ก');
  const items = raw.map((x: any) => ({ grp: cleanText(x?.grp, 80), sku: cleanText(x?.sku, 200), missing: Math.max(0, Math.trunc(Number(x?.missing) || 0)) }));
  if (items.some((i) => !i.grp || !i.sku)) throw new BadRequest('รายการไม่ครบ');
  return { id, items };
}

export async function setMissing(db: D1Database, m: ReturnType<typeof validateMissing>): Promise<{ missing: number }> {
  const [, , total] = await db.batch([
    db.prepare(
      `UPDATE purchase_lines SET missing = MAX(0, MIN(qty, j.value ->> '$.missing'))
       FROM json_each(?2) AS j WHERE upload_id = ?1 AND grp = j.value ->> '$.grp' AND sku = j.value ->> '$.sku'`,
    ).bind(m.id, JSON.stringify(m.items)),
    db.prepare('UPDATE purchase_uploads SET missing = (SELECT COALESCE(SUM(missing), 0) FROM purchase_lines WHERE upload_id = ?1) WHERE id = ?1').bind(m.id),
    db.prepare('SELECT missing FROM purchase_uploads WHERE id = ?1').bind(m.id),
  ]);
  const row = (total.results as { missing: number }[])[0];
  if (!row) throw new BadRequest('ยังไม่ได้บันทึกใบสั่งรอบนี้');
  return { missing: row.missing };
}

export async function deletePurchase(db: D1Database, id: string): Promise<boolean> {
  const [, r] = await db.batch([
    db.prepare('DELETE FROM purchase_lines WHERE upload_id = ?1').bind(id),
    db.prepare('DELETE FROM purchase_uploads WHERE id = ?1').bind(id),
  ]);
  return (r.meta.changes ?? 0) > 0;
}
