// Returned parcels (idea #20, Mzmuchzeee): staff scan the number on the parcel; the page finds the SKUs from the Bigseller
// file (in the browser — tracking numbers are never stored) and sends parcel hash + SKU + qty here. Nothing touches the
// stock until an owner/admin approves: approval adds the pieces as 'in' (same as รับของเข้า, so พี่เปีย also cuts PK).
// The same parcel is refused while it is pending or already approved (a rejected one may be scanned again).

import { cleanSku } from '../web/src/catalog.ts';
import { BadRequest } from './validate.ts';
import { isShopLoc, shopLocOfTab, shopTab } from '../web/src/stockLocs.ts';
import { LOCS, saveMoves, validateMoves, type Loc } from './stock.ts';

export interface StockReturn { id: number; loc: Loc; sku: string; qty: number; track_tail: string; status: 'pending' | 'approved' | 'rejected'; created_by: string; created_at: string; decided_by: string | null; decided_at: string | null }

const HASH = /^[0-9a-f]{64}$/;
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

export function validateReturns(input: any): { loc: Loc; parcels: { hash: string; tail: string; items: { sku: string; qty: number }[] }[] } {
  const loc = input?.loc;
  if (!LOCS.includes(loc)) throw new BadRequest('ไม่รู้ว่าคืนเข้าสต็อกที่ไหน');
  const raw: any[] = Array.isArray(input?.parcels) ? input.parcels : [];
  if (!raw.length || raw.length > 100) throw new BadRequest('ใส่พัสดุ 1–100 ชิ้น');
  const parcels = raw.map((p) => {
    const hash = String(p?.hash ?? '');
    if (!HASH.test(hash)) throw new BadRequest('เลขพัสดุไม่ถูกต้อง');
    const items = (Array.isArray(p?.items) ? p.items : [])
      .map((x: any) => ({ sku: cleanSku(x?.sku), qty: Math.round(Number(x?.qty)) }))
      .filter((x: { sku: string; qty: number }) => x.sku && Number.isFinite(x.qty) && x.qty > 0 && x.qty <= 1000);
    if (!items.length) throw new BadRequest('พัสดุนี้ไม่มีสินค้า');
    return { hash, tail: String(p?.tail ?? '').slice(-4).replace(/[^\w-]/g, ''), items };
  });
  return { loc, parcels };
}

/** Adds the scanned parcels as pending returns; skips parcels already pending/approved. Returns what was added and what was a repeat. */
export async function addReturns(db: D1Database, r: ReturnType<typeof validateReturns>, user: string): Promise<{ added: number; repeated: string[] }> {
  // a shop place (AR, BB …) keeps any SKU of its catalog tab; the 5-model places and PK have a fixed list
  const all = [...new Set(r.parcels.flatMap((p) => p.items.map((i) => i.sku)))];
  const known = new Set(((await (isShopLoc(r.loc)
    ? db.prepare('SELECT sku FROM catalog WHERE tab = ?1 AND sku IN (SELECT value FROM json_each(?2))').bind(shopTab(r.loc), JSON.stringify(all))
    : db.prepare('SELECT sku FROM stock_locs WHERE loc = ?1').bind(r.loc)).all<{ sku: string }>()).results).map((x) => x.sku));
  const bad = r.parcels.flatMap((p) => p.items.filter((i) => !known.has(i.sku)).map((i) => i.sku));
  if (bad.length) throw new BadRequest(`ไม่ใช่สินค้าในสต็อกที่นี่: ${[...new Set(bad)].join(', ')}`);
  const seen = new Set(((await db.prepare("SELECT DISTINCT track_hash FROM stock_returns WHERE status != 'rejected'").all<{ track_hash: string }>()).results).map((x) => x.track_hash));
  const now = new Date().toISOString();
  const repeated: string[] = [];
  const rows: { loc: Loc; sku: string; qty: number; hash: string; tail: string }[] = [];
  for (const p of r.parcels) {
    if (seen.has(p.hash)) { repeated.push(p.tail); continue; }
    seen.add(p.hash);
    for (const i of p.items) rows.push({ loc: r.loc, sku: i.sku, qty: i.qty, hash: p.hash, tail: p.tail });
  }
  if (rows.length) {
    await db.prepare(
      `INSERT INTO stock_returns (loc, sku, qty, track_hash, track_tail, status, created_by, created_at)
       SELECT value ->> '$.loc', value ->> '$.sku', value ->> '$.qty', value ->> '$.hash', value ->> '$.tail', 'pending', ?2, ?3
       FROM json_each(?1)`,
    ).bind(JSON.stringify(rows), user, now).run();
  }
  return { added: rows.length, repeated };
}

export async function listReturns(db: D1Database): Promise<StockReturn[]> {
  return (await db.prepare(
    `SELECT id, loc, sku, qty, track_tail, status, created_by, created_at, decided_by, decided_at FROM stock_returns
     WHERE status = 'pending' OR created_at >= ?1 ORDER BY (status = 'pending') DESC, id DESC LIMIT 300`,
  ).bind(new Date(Date.now() - 14 * 86400_000).toISOString()).all<StockReturn>()).results;
}

/** Approve (→ stock 'in' now) or reject a pending return. False if it was not pending. */
export async function decideReturn(db: D1Database, id: number, approve: boolean, user: string): Promise<boolean> {
  const row = await db.prepare("SELECT loc, sku, qty, track_tail FROM stock_returns WHERE id = ?1 AND status = 'pending'").bind(id).first<{ loc: Loc; sku: string; qty: number; track_tail: string }>();
  if (!row) return false;
  // claim first so a double press can't add the stock twice
  const claim = await db.prepare("UPDATE stock_returns SET status = ?2, decided_by = ?3, decided_at = ?4 WHERE id = ?1 AND status = 'pending'")
    .bind(id, approve ? 'approved' : 'rejected', user, new Date().toISOString()).run();
  if ((claim.meta.changes ?? 0) === 0) return false;
  if (approve) {
    try {
      await saveMoves(db, validateMoves({ loc: row.loc, kind: 'in', date: today(), note: `พัสดุตีกลับ …${row.track_tail}`, items: [{ sku: row.sku, qty: row.qty }] }), user);
    } catch (e) {
      await db.prepare("UPDATE stock_returns SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = ?1").bind(id).run();
      throw e;
    }
  }
  return true;
}

/** Which stock keeps a SKU: PK → pk, a shop tab (AR, BB …) → that shop (SKU = code-TAB-colour-size). */
export function locOfSku(sku: string): Loc | null {
  const tab = sku.split('-')[1]?.toUpperCase() ?? '';
  return tab === 'PK' ? 'pk' : shopLocOfTab(tab);
}

export type ScanResult =
  | { status: 'added'; items: { sku: string; qty: number; loc: Loc }[] }
  | { status: 'repeat' | 'notfound' }
  | { status: 'nostock'; skus: string[] };

/**
 * Idea #28: a scanned parcel (hash of its number) → the SKUs of the saved order rounds (`purchase_items.track_hash`) →
 * straight into the stock they belong to as an 'in' move (history row in `stock_returns`, status approved).
 * The same parcel is refused while it is pending or already approved.
 */
export async function scanReturn(db: D1Database, hash: string, tail: string, user: string): Promise<ScanResult> {
  if (!HASH.test(hash)) throw new BadRequest('เลขพัสดุไม่ถูกต้อง');
  tail = tail.slice(-4).replace(/[^\w-]/g, '');
  const found = (await db.prepare('SELECT sku, SUM(qty) AS qty FROM purchase_items WHERE track_hash = ?1 GROUP BY sku').bind(hash).all<{ sku: string; qty: number }>()).results;
  if (!found.length) return { status: 'notfound' };
  if (await db.prepare("SELECT 1 FROM stock_returns WHERE track_hash = ?1 AND status != 'rejected' LIMIT 1").bind(hash).first()) return { status: 'repeat' };
  const items = found.map((f) => ({ sku: f.sku, qty: f.qty, loc: locOfSku(f.sku) }));
  const bad = items.filter((i) => !i.loc).map((i) => i.sku);
  if (bad.length) return { status: 'nostock', skus: bad };
  const byLoc = new Map<Loc, { sku: string; qty: number }[]>();
  for (const i of items) byLoc.set(i.loc!, [...(byLoc.get(i.loc!) ?? []), { sku: i.sku, qty: i.qty }]);
  // check every place first (nothing is half-added when one SKU is not stocked there)
  for (const [loc, its] of byLoc) await addReturnsCheck(db, loc, its);
  const now = new Date().toISOString();
  for (const [loc, its] of byLoc) {
    await saveMoves(db, validateMoves({ loc, kind: 'in', date: today(), note: `พัสดุตีกลับ …${tail}`, items: its }), user);
  }
  await db.prepare(
    `INSERT INTO stock_returns (loc, sku, qty, track_hash, track_tail, status, created_by, created_at, decided_by, decided_at)
     SELECT value ->> '$.loc', value ->> '$.sku', value ->> '$.qty', ?2, ?3, 'approved', ?4, ?5, ?4, ?5 FROM json_each(?1)`,
  ).bind(JSON.stringify(items), hash, tail, user, now).run();
  return { status: 'added', items: items as { sku: string; qty: number; loc: Loc }[] };
}

async function addReturnsCheck(db: D1Database, loc: Loc, items: { sku: string; qty: number }[]): Promise<void> {
  const all = items.map((i) => i.sku);
  const known = new Set(((await (isShopLoc(loc)
    ? db.prepare('SELECT sku FROM catalog WHERE tab = ?1 AND sku IN (SELECT value FROM json_each(?2))').bind(shopTab(loc), JSON.stringify(all))
    : db.prepare('SELECT sku FROM stock_locs WHERE loc = ?1').bind(loc)).all<{ sku: string }>()).results).map((x) => x.sku));
  const bad = all.filter((s) => !known.has(s));
  if (bad.length) throw new BadRequest(`ไม่ใช่สินค้าในสต็อกที่นี่: ${bad.join(', ')}`);
}

/**
 * "32594", "32594 1071-BB-CR-44", "32594 SKU 1071-BB-CR-44", "32594 x1" or "32594 1071-BB-CR-44 x1" → Facebook order number
 * (+ SKU, + pieces when typed; qty 0 = not typed). Null if it is not one.
 */
export function parseFacebookReturn(text: string): { order: string; sku: string; qty: number } | null {
  const m = /^\s*(\d{3,8})(?:\s+(?:sku\s*:?\s*)?(?![x×*]\s*\d+\s*$)(\S+))?(?:\s+[x×*]\s*(\d{1,3}))?\s*$/i.exec(text);
  if (!m) return null;
  return { order: m[1], sku: m[2] ? cleanSku(m[2]) : '', qty: m[3] ? Number(m[3]) : 0 };
}

/** SKU + qty of a Facebook order from the saved rounds' `extra` JSON (newest round first); the newest round that has the order wins. */
export function facebookOrderItems(extras: string[], order: string): FbItem[] {
  for (const raw of extras) {
    let list: any[] = [];
    try { list = JSON.parse(raw || '[]'); } catch { /* ignore */ }
    const by = new Map<string, number>();
    for (const x of list) {
      if (x?.source !== 'facebook' || String(x?.order ?? '').trim() !== order || !x?.sku) continue;
      by.set(x.sku, (by.get(x.sku) ?? 0) + (Number(x.qty) || 0));
    }
    if (by.size) return [...by].map(([sku, qty]) => ({ sku, qty, max: qty }));
  }
  return [];
}

/**
 * Rounds saved before the Facebook lines were kept in `extra` only have the order in their sheet lines (`purchase_lines.orders`).
 * Newest round first; the newest round holding the order wins. A line with only this order gives its qty; a line shared by
 * several orders does not say how many pieces were this order's, so it counts 1 by default and up to the line's qty when the
 * person types the pieces ("32594 SKU x2").
 */
export function facebookLineItems(rows: { upload_id: string; sku: string; qty: number; orders: string; store: string | null }[]): FbItem[] {
  const fb = rows.filter((r) => String(r.store ?? '').startsWith('Facebook'));
  if (!fb.length) return [];
  const by = new Map<string, { qty: number; max: number }>();
  for (const r of fb.filter((x) => x.upload_id === fb[0].upload_id)) {
    const q = Number(r.qty) || 1;
    let n = 1;
    try { if (JSON.parse(r.orders || '[]').length === 1) n = q; } catch { /* ignore */ }
    const cur = by.get(r.sku) ?? { qty: 0, max: 0 };
    by.set(r.sku, { qty: cur.qty + n, max: cur.max + q });
  }
  return [...by].map(([sku, v]) => ({ sku, ...v }));
}

/** A Facebook order's SKU: `qty` = pieces returned when none are typed, `max` = most pieces this order can have had. */
export type FbItem = { sku: string; qty: number; max: number };

/**
 * How many pieces to put back now. Typed pieces (`want` > 0) may go up to `max` minus what came back before; untyped, the
 * order's own count minus what came back before. 0 left → 'repeat' (with `left` when typing pieces could still add some).
 */
export function fbReturnQty(it: FbItem, returned: number, want: number): { add: number } | { repeat: true; left: number } | { over: number } {
  const left = Math.max(0, it.max - returned);
  if (want > 0) return left <= 0 ? { repeat: true, left: 0 } : want > left ? { over: left } : { add: want };
  const add = Math.min(left, it.qty - returned);
  return add > 0 ? { add } : { repeat: true, left };
}

export type FbScanResult = ScanResult | { status: 'pick'; skus: string[] } | { status: 'repeat'; left: number };

/**
 * Idea #30: a returned Facebook order is scanned by its order number (Page365 "No.") — there is no parcel number in that file.
 * Items come from the saved Facebook rounds (see facebookOrderItems / facebookLineItems). One SKU in the order, or a typed SKU →
 * 'in' move at once; several SKUs and none typed → 'pick' (nothing added). Pieces are counted per order + SKU, so a part
 * return can be finished later with "32594 SKU x1", and the same pieces are never put back twice.
 */
export async function scanFacebookReturn(db: D1Database, order: string, sku: string, user: string, want = 0): Promise<FbScanResult> {
  // Facebook lines are kept in the round's `extra` JSON (migration 0049), not in purchase_items.
  const rounds = (await db.prepare("SELECT extra FROM purchase_uploads WHERE extra LIKE '%' || ?1 || '%' ORDER BY date DESC, round DESC").bind(order).all<{ extra: string }>()).results;
  let found = facebookOrderItems(rounds.map((r) => r.extra), order);
  if (!found.length) found = facebookLineItems((await db.prepare(
    `SELECT u.id AS upload_id, l.sku, l.qty, l.orders, json_extract(l.stores, '$."' || ?1 || '"') AS store
     FROM purchase_lines l JOIN purchase_uploads u ON u.id = l.upload_id, json_each(l.orders) j
     WHERE j.value = ?1 AND l.sku != '' ORDER BY u.date DESC, u.round DESC`).bind(order).all<{ upload_id: string; sku: string; qty: number; orders: string; store: string | null }>()).results);
  if (!found.length) return { status: 'notfound' };
  const it = sku ? found.find((f) => cleanSku(f.sku) === sku) : found.length === 1 ? found[0] : undefined;
  if (!it) return { status: 'pick', skus: found.map((f) => f.sku) };
  const key = `fb:${order}:${it.sku}`;
  const returned = Number((await db.prepare("SELECT COALESCE(SUM(qty), 0) AS n FROM stock_returns WHERE track_hash = ?1 AND status != 'rejected'").bind(key).first<{ n: number }>())?.n ?? 0);
  const q = fbReturnQty(it, returned, want);
  if ('repeat' in q) return { status: 'repeat', left: q.left };
  if ('over' in q) throw new BadRequest(`ออเดอร์นี้คืน ${it.sku} ได้อีกไม่เกิน ${q.over} ตัว`);
  const loc = locOfSku(it.sku);
  if (!loc) return { status: 'nostock', skus: [it.sku] };
  const items = [{ sku: it.sku, qty: q.add }];
  await addReturnsCheck(db, loc, items);
  const now = new Date().toISOString();
  await saveMoves(db, validateMoves({ loc, kind: 'in', date: today(), note: `ตีกลับ Facebook #${order}`, items }), user);
  await db.prepare("INSERT INTO stock_returns (loc, sku, qty, track_hash, track_tail, status, created_by, created_at, decided_by, decided_at) VALUES (?1, ?2, ?3, ?4, ?5, 'approved', ?6, ?7, ?6, ?7)")
    .bind(loc, it.sku, q.add, key, order.slice(-4), user, now).run();
  return { status: 'added', items: [{ sku: it.sku, qty: q.add, loc }] };
}
