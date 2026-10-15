// Admins' order line in the chat: after a customer confirms, the admin types a short note such as
//   "501/1/2/3  32\ncod  649"   or   "ni9-3 32 1 cod 239"
// and another admin later picks the same items in Page365 by hand. Phase 0 of automating that step: read
// the note from the page's own messages (Messenger echoes), turn it into items, and compare with what Page365
// ended up holding once the day's export is uploaded. Nothing is written to Page365.
//
// Only a message that is entirely an order note is kept (codes, sizes, quantities, payment, total) — anything with
// other text (an address, a greeting) is dropped before storage, so no customer details are stored.

import type { OrderItem, StoredOrder } from './p365.ts';

export interface NoteItem { code: string; prefix: string; size: string; qty: number }
export interface ParsedNote { items: NoteItem[]; payment: 'cod' | 'transfer' | null; total: number | null; unknown: string[] }

const SIZE = /^(?:(2[4-9]|[34]\d|50)|xs|s|m|l|xl|xxl|[2-5]xl|f|free)$/i;
const CODE = /^[a-z]{0,4}\d+[a-z0-9]*(?:[/-][a-z0-9]+)*$/i;

/** One message → its items, or null when it is not an order note (no payment + total, or other text in it). */
export function parseOrderNote(text: string | null | undefined): ParsedNote | null {
  const t = (text ?? '').replace(/ /g, ' ').trim();
  if (!t || t.length > 400) return null;
  // Payment + total may be on its own line or at the end of the last item line.
  const pay = t.match(/(?:^|\s)(cod|โอน|ปลายทาง)\s*(\d{2,5})\s*$/i);
  if (!pay) return null;
  const body = t.slice(0, pay.index).trim();
  const lines = body.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const items: NoteItem[] = [];
  const unknown: string[] = [];
  for (const line of lines) {
    // Thai letters or anything long → not an order note at all (keeps addresses and chat out of storage).
    if (line.length > 60 || /[฀-๿]/.test(line)) return null;
    const parsed = parseLine(line);
    if (parsed) items.push(...parsed); else unknown.push(line);
  }
  if (!items.length) return null;
  return { items, payment: /cod|ปลายทาง/i.test(pay[1]) ? 'cod' : 'transfer', total: Number(pay[2]), unknown };
}

/** "501/1/2/3 32" · "801/3 36 3" · "D01 D02 34" · "200 200/2 30": codes, then a size, then an optional quantity. */
function parseLine(line: string): NoteItem[] | null {
  const tok = line.split(/[\s,]+/).filter(Boolean);
  const sizeAt = tok.findIndex((x, i) => i > 0 && SIZE.test(x));
  if (sizeAt < 1) return null;
  const codes = tok.slice(0, sizeAt);
  const rest = tok.slice(sizeAt + 1);
  if (rest.length > 1 || (rest.length === 1 && !/^(?:[1-9]|1\d|20)$/.test(rest[0]))) return null;
  if (!codes.every((c) => CODE.test(c) && !SIZE.test(c))) return null;
  const qty = rest.length ? Number(rest[0]) : 1;
  const size = tok[sizeAt].toUpperCase();
  return codes.flatMap((c) => expandCode(c)).map((code) => ({ code, prefix: skuPrefix(code), size, qty }));
}

/** "501/1/2" → 501/1, 501/2 · "Ni9-1-2-5" → NI9-1, NI9-2, NI9-5 · "200" → 200. */
export function expandCode(raw: string): string[] {
  const c = raw.toUpperCase();
  const sep = c.includes('/') ? '/' : c.includes('-') ? '-' : '';
  if (!sep) return [c];
  const [base, ...colours] = c.split(sep);
  return colours.filter(Boolean).map((v) => `${base}${sep}${v}`);
}

/** The first part of the shop's SKU: 501/1 → 5011, NI9-3 → NI93 (5011-PK-MD-30, NI93-PK-BR-32). */
export function skuPrefix(code: string): string {
  return code.replace(/[/-]/g, '').toUpperCase();
}

// ---- comparing with Page365 ----

export type Verdict = 'same' | 'diff_items' | 'diff_total' | 'unparsed' | 'no_order';

export interface StoredNote { mid: string; psid: string; at: string; text: string; name_hash: string | null }
export interface NoteCheck {
  at: string;
  text: string;
  items: NoteItem[];
  unknown: string[];
  payment: ParsedNote['payment'];
  total: number | null;
  order_no: string | null;
  order_total: number | null;
  order_items: { sku: string; qty: number }[];
  linked_by: 'customer' | 'total' | null;
  verdict: Verdict;
  missing: string[];   // in the note, not in Page365 ("5011 32 ×1")
  extra: string[];     // in Page365, not in the note
}

const key = (prefix: string, size: string) => `${prefix} ${size}`;

function itemsKeyed(items: { k: string; qty: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) m.set(it.k, (m.get(it.k) ?? 0) + it.qty);
  return m;
}

/** Page365 item → "5011 30" (SKU prefix + size, the last part of the SKU). */
function orderKey(it: OrderItem): string {
  const parts = it.sku.split('-');
  return key(it.code || parts[0], (parts[parts.length - 1] ?? '').toUpperCase());
}

/**
 * Pairs each note with the Page365 order it became: same customer (name hash) within a day of the note, else the
 * only unpaired order with the same total within 3 hours. Then compares items and totals.
 */
export function checkNotes(notes: StoredNote[], orders: StoredOrder[]): NoteCheck[] {
  const used = new Set<string>();
  const sorted = [...notes].sort((a, b) => a.at.localeCompare(b.at));
  const parsed = sorted.map((n) => ({ n, p: parseOrderNote(n.text) }));
  const pick = new Map<string, { o: StoredOrder; by: 'customer' | 'total' }>();
  const near = (o: StoredOrder, at: string, h: number) => Math.abs(Date.parse(o.created_at) - Date.parse(at)) <= h * 3_600_000;
  // Customer links first (strong), then totals for what is left.
  for (const { n, p } of parsed) {
    if (!n.name_hash) continue;
    const cands = orders.filter((o) => !used.has(o.order_no) && o.name_hash === n.name_hash && near(o, n.at, 24));
    const o = cands.sort((a, b) => Number(b.total === p?.total) - Number(a.total === p?.total)
      || Math.abs(Date.parse(a.created_at) - Date.parse(n.at)) - Math.abs(Date.parse(b.created_at) - Date.parse(n.at)))[0];
    if (o) { used.add(o.order_no); pick.set(n.mid, { o, by: 'customer' }); }
  }
  for (const { n, p } of parsed) {
    if (pick.has(n.mid) || p?.total == null) continue;
    const cands = orders.filter((o) => !used.has(o.order_no) && o.total === p.total && near(o, n.at, 3));
    if (cands.length === 1) { used.add(cands[0].order_no); pick.set(n.mid, { o: cands[0], by: 'total' }); }
  }

  return parsed.map(({ n, p }) => {
    const hit = pick.get(n.mid);
    const o = hit?.o;
    const base: NoteCheck = {
      at: n.at, text: n.text, items: p?.items ?? [], unknown: p?.unknown ?? [], payment: p?.payment ?? null, total: p?.total ?? null,
      order_no: o?.order_no ?? null, order_total: o?.total ?? null, order_items: (o?.items ?? []).map((i) => ({ sku: i.sku, qty: i.qty })),
      linked_by: hit?.by ?? null, verdict: 'no_order', missing: [], extra: [],
    };
    if (!p || p.unknown.length) base.verdict = 'unparsed';
    if (!o) return base;
    const want = itemsKeyed((p?.items ?? []).map((i) => ({ k: key(i.prefix, i.size), qty: i.qty })));
    const got = itemsKeyed(o.items.map((i) => ({ k: orderKey(i), qty: i.qty })));
    for (const [k, q] of want) { const d = q - (got.get(k) ?? 0); if (d > 0) base.missing.push(`${k} ×${d}`); }
    for (const [k, q] of got) { const d = q - (want.get(k) ?? 0); if (d > 0) base.extra.push(`${k} ×${d}`); }
    if (base.verdict === 'unparsed') return base;
    base.verdict = base.missing.length || base.extra.length ? 'diff_items' : p!.total !== o.total ? 'diff_total' : 'same';
    return base;
  });
}

// ---- storage ----

export async function saveNotes(db: D1Database, notes: StoredNote[]): Promise<void> {
  if (!notes.length) return;
  await db.prepare(`INSERT OR IGNORE INTO order_notes (mid, psid, at, text, name_hash)
    SELECT value->>'mid', value->>'psid', value->>'at', value->>'text', value->>'name_hash' FROM json_each(?)`).bind(JSON.stringify(notes)).run();
}

/** Notes per Bangkok day for the last `days` days (today included), for the log's day picker. */
export async function noteDays(db: D1Database, days: number): Promise<{ date: string; notes: number }[]> {
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const { results } = await db.prepare(`SELECT date(at, '+7 hours') AS date, COUNT(*) AS notes FROM order_notes WHERE at >= ? GROUP BY 1 ORDER BY 1 DESC`).bind(from).all<{ date: string; notes: number }>();
  return results;
}

/** Notes typed on one Bangkok day. */
export async function loadNotes(db: D1Database, date: string): Promise<StoredNote[]> {
  const from = new Date(`${date}T00:00:00+07:00`).toISOString();
  const to = new Date(Date.parse(`${date}T00:00:00+07:00`) + 86_400_000).toISOString();
  const { results } = await db.prepare('SELECT mid, psid, at, text, name_hash FROM order_notes WHERE at >= ? AND at < ? ORDER BY at').bind(from, to).all<StoredNote>();
  return results;
}
