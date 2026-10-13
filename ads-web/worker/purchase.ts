// Order sheet history (/catalog/orders). The page builds the sheets from Bigseller's file in the browser; what is
// saved is the result per day + round: SKU, quantity, supplier group. Saving the same day + round again replaces it.

import { cleanText } from '../web/src/catalog.ts';
import { BadRequest } from './validate.ts';

const KINDS = new Set(['supplier', 'warehouse', 'unassigned', 'review']);
const MAX_LINES = 5000;

export interface PurchaseUpload { id: string; date: string; round: number; file: string; pieces: number; review: number; groups: { name: string; kind: string; pieces: number }[]; saved_by: string; saved_at: string }
export interface SavedLine { grp: string; kind: string; sku: string; tab: string; label: string; size: string; qty: number; note: string }

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
    };
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
  const upload: PurchaseUpload = { id, date: p.date, round: p.round, file: p.file, pieces, review, groups: [...groups.values()], saved_by: user, saved_at: now };
  const insert = `INSERT INTO purchase_lines (upload_id, grp, kind, sku, tab, label, size, qty, note)
    SELECT ?1, value ->> '$.grp', value ->> '$.kind', value ->> '$.sku', value ->> '$.tab', value ->> '$.label', value ->> '$.size', value ->> '$.qty', value ->> '$.note' FROM json_each(?2)`;
  const chunks: SavedLine[][] = [];
  for (let i = 0; i < p.lines.length; i += 500) chunks.push(p.lines.slice(i, i + 500));
  await db.batch([
    db.prepare('DELETE FROM purchase_lines WHERE upload_id = ?1').bind(id),
    ...chunks.map((c) => db.prepare(insert).bind(id, JSON.stringify(c))),
    db.prepare(
      `INSERT INTO purchase_uploads (id, date, round, file, pieces, review, groups, saved_by, saved_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT (id) DO UPDATE SET file = excluded.file, pieces = excluded.pieces, review = excluded.review, groups = excluded.groups, saved_by = excluded.saved_by, saved_at = excluded.saved_at`,
    ).bind(id, p.date, p.round, p.file, pieces, review, JSON.stringify(upload.groups), user, now),
  ]);
  return upload;
}

export async function listPurchases(db: D1Database, limit = 60): Promise<PurchaseUpload[]> {
  const { results } = await db.prepare('SELECT * FROM purchase_uploads ORDER BY date DESC, round DESC LIMIT ?1').bind(limit).all<Omit<PurchaseUpload, 'groups'> & { groups: string }>();
  return results.map((r) => ({ ...r, groups: JSON.parse(r.groups) }));
}

export async function purchaseLines(db: D1Database, id: string): Promise<SavedLine[]> {
  return (await db.prepare('SELECT grp, kind, sku, tab, label, size, qty, note FROM purchase_lines WHERE upload_id = ?1').bind(id).all<SavedLine>()).results;
}

export async function deletePurchase(db: D1Database, id: string): Promise<boolean> {
  const [, r] = await db.batch([
    db.prepare('DELETE FROM purchase_lines WHERE upload_id = ?1').bind(id),
    db.prepare('DELETE FROM purchase_uploads WHERE id = ?1').bind(id),
  ]);
  return (r.meta.changes ?? 0) > 0;
}
