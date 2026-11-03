// Returned parcels (idea #20, Mzmuchzeee): staff scan the number on the parcel; the page finds the SKUs from the Bigseller
// file (in the browser — tracking numbers are never stored) and sends parcel hash + SKU + qty here. Nothing touches the
// stock until an owner/admin approves: approval adds the pieces as 'in' (same as รับของเข้า, so พี่เปีย also cuts PK).
// The same parcel is refused while it is pending or already approved (a rejected one may be scanned again).

import { cleanSku } from '../web/src/catalog.ts';
import { BadRequest } from './validate.ts';
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
  const known = new Set(((await db.prepare('SELECT sku FROM stock_locs WHERE loc = ?1').bind(r.loc).all<{ sku: string }>()).results).map((x) => x.sku));
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
