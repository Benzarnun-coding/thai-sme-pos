// The day's sales as Max reads them (instead of Meta's "Manage Orders"): one row per admin order note, with the
// customer's Facebook name, the Page365 bill and its stage, and whether the sale went to Meta; plus the day's
// totals. Names come live from Page365 (conversation list: customer fbid → name + last bill) and are never
// stored. Notes for the same customer within 2 hours count as one order.

import { parseOrderNote, type StoredNote } from './orderNotes.ts';
import { call, type P365Env } from './p365fill.ts';

export type Stage = 'draft' | 'unpaid' | 'transferred' | 'paid' | 'shipped' | 'expired' | 'voided' | 'none';
export interface DayOrder {
  mid: string; at: string; text: string; customer: string | null;
  items: { code: string; size: string; qty: number }[]; pieces: number; total: number; payment: 'cod' | 'transfer' | null;
  bill: { id: number; no: number; stage: Stage; total: number } | null;
  meta: 'sent' | 'skipped' | 'error' | null;
  repeat: boolean;
}
export interface DaySummary {
  orders: number; sales: number; pieces: number; cod: number; transfer: number; avg: number;
  by_stage: Record<string, { orders: number; sales: number }>;
  meta_sent: number;
}

const DEDUPE_MS = 2 * 3_600_000;

/** Page365: fbid → { name, last bill id } from the conversation list, and bill id → { no, stage, total } from the bill list. */
async function page365Lookup(env: P365Env, psids: Set<string>, billIds: Set<number>) {
  const people = new Map<string, { name: string; last_order_id: number | null }>();
  for (let page = 1; page <= 4 && [...psids].some((p) => !people.has(p)); page++) {
    const r = await call<{ conversations?: { customer?: { fbid?: string; name?: string; last_order_id?: number | null } }[] }>(env, `conversations.json?page=${page}`);
    for (const c of r.conversations ?? []) if (c.customer?.fbid && psids.has(c.customer.fbid) && !people.has(c.customer.fbid)) people.set(c.customer.fbid, { name: c.customer.name ?? '', last_order_id: c.customer.last_order_id ?? null });
    if ((r.conversations ?? []).length < 50) break;
  }
  for (const p of people.values()) if (p.last_order_id) billIds.add(p.last_order_id);
  const bills = new Map<number, { id: number; no: number; stage: Stage; total: number }>();
  for (let page = 1; page <= 4 && [...billIds].some((id) => !bills.has(id)); page++) {
    const r = await call<{ orders: { id: number; no: number; stage: Stage; total: number }[] }>(env, `orders.json?page=${page}`);
    for (const o of r.orders) bills.set(o.id, { id: o.id, no: o.no, stage: o.stage, total: Number(o.total) });
    if (r.orders.length < 50) break;
  }
  return { people, bills };
}

export function summarize(rows: DayOrder[]): DaySummary {
  const real = rows.filter((r) => !r.repeat && r.total > 0);
  const by_stage: Record<string, { orders: number; sales: number }> = {};
  for (const r of real) {
    const k = r.bill?.stage ?? 'none';
    by_stage[k] = { orders: (by_stage[k]?.orders ?? 0) + 1, sales: (by_stage[k]?.sales ?? 0) + r.total };
  }
  const sales = real.reduce((t, r) => t + r.total, 0);
  return {
    orders: real.length, sales, pieces: real.reduce((t, r) => t + r.pieces, 0),
    cod: real.filter((r) => r.payment === 'cod').length, transfer: real.filter((r) => r.payment === 'transfer').length,
    avg: real.length ? sales / real.length : 0, by_stage, meta_sent: real.filter((r) => r.meta === 'sent').length,
  };
}

export async function dayOrders(env: P365Env & { DB: D1Database }, notes: (StoredNote & { fill_order_no?: number | null })[]): Promise<{ rows: DayOrder[]; summary: DaySummary; page365: boolean; error: string | null }> {
  const sorted = [...notes].sort((a, b) => a.at.localeCompare(b.at));
  const lastSale = new Map<string, number>();
  const rows: DayOrder[] = sorted.map((n) => {
    const p = parseOrderNote(n.text);
    const t = Date.parse(n.at);
    const repeat = lastSale.has(n.psid) && t - lastSale.get(n.psid)! < DEDUPE_MS;
    if (!repeat && p?.total) lastSale.set(n.psid, t);
    return {
      mid: n.mid, at: n.at, text: n.text.replace(/\s+/g, ' '), customer: null,
      items: (p?.items ?? []).map((i) => ({ code: i.code, size: i.size, qty: i.qty })), pieces: (p?.items ?? []).reduce((s, i) => s + i.qty, 0),
      total: p?.total ?? 0, payment: p?.payment ?? null, bill: null, meta: null, repeat,
    };
  });
  // Sales sent to Meta (at the note, or the one bill sent by hand).
  if (rows.length) {
    const { results } = await env.DB.prepare('SELECT mid, status FROM note_purchases WHERE mid IN (SELECT value FROM json_each(?))').bind(JSON.stringify(rows.map((r) => r.mid))).all<{ mid: string; status: DayOrder['meta'] }>().catch(() => ({ results: [] as { mid: string; status: DayOrder['meta'] }[] }));
    const st = new Map(results.map((r) => [r.mid, r.status]));
    for (const r of rows) r.meta = st.get(r.mid) ?? null;
  }
  let page365 = false, error: string | null = null;
  if (env.P365_COOKIE && rows.length) {
    try {
      const filled = new Map(sorted.filter((n) => n.fill_order_no).map((n) => [n.mid, n.fill_order_no!]));
      const { people, bills } = await page365Lookup(env, new Set(sorted.map((n) => n.psid)), new Set());
      const byNo = new Map([...bills.values()].map((b) => [b.no, b]));
      for (const [i, r] of rows.entries()) {
        const who = people.get(sorted[i].psid);
        r.customer = who?.name || null;
        const no = filled.get(r.mid);
        r.bill = (no ? byNo.get(no) : undefined) ?? (who?.last_order_id ? bills.get(who.last_order_id) ?? null : null);
      }
      // Sold bills sent by hand (sendOne) count as sent.
      const { results } = await env.DB.prepare("SELECT order_no FROM meta_purchases WHERE status = 'sent' AND order_no IN (SELECT value FROM json_each(?))").bind(JSON.stringify(rows.map((r) => r.bill?.no).filter(Boolean))).all<{ order_no: number }>();
      const sentNos = new Set(results.map((r) => r.order_no));
      for (const r of rows) if (!r.meta && r.bill && sentNos.has(r.bill.no)) r.meta = 'sent';
      page365 = true;
    } catch (err: any) { error = err?.message ?? String(err); }
  }
  return { rows, summary: summarize(rows), page365, error };
}

// ---- against the uploaded Page365 file ----

export interface Recon {
  log: number; file: number; matched: number;
  log_only: { mid: string; at: string; customer: string | null; text: string; total: number }[];
  file_only: { order_no: string; total: number; created_at: string }[];
  diff: { order_no: string; note_total: number; bill_total: number; customer: string | null }[];
  sales_log: number; sales_file: number;
}

/**
 * Notes of the day vs bills of the day in the uploaded file. A note's bill: the one the system filled, else the
 * customer's bill in Page365 now, else the file match (same customer, or unique total and time) — `links`.
 */
export function reconcile(rows: DayOrder[], links: Map<string, string>, file: { order_no: string; total: number; created_at: string }[]): Recon {
  const real = rows.filter((r) => !r.repeat && r.total > 0);
  const byNo = new Map(file.map((o) => [String(o.order_no), o]));
  const used = new Set<string>();
  const log_only: Recon['log_only'] = [];
  const diff: Recon['diff'] = [];
  let matched = 0;
  for (const r of real) {
    const no = [r.bill?.no != null ? String(r.bill.no) : null, links.get(r.mid) ?? null].find((x) => x && byNo.has(x) && !used.has(x));
    if (!no) { log_only.push({ mid: r.mid, at: r.at, customer: r.customer, text: r.text, total: r.total }); continue; }
    used.add(no);
    matched++;
    const bill = byNo.get(no)!;
    if (Math.abs(Number(bill.total) - r.total) > 0.5) diff.push({ order_no: no, note_total: r.total, bill_total: Number(bill.total), customer: r.customer });
  }
  const file_only = file.filter((o) => !used.has(String(o.order_no))).map((o) => ({ order_no: String(o.order_no), total: Number(o.total), created_at: o.created_at }));
  return { log: real.length, file: file.length, matched, log_only, file_only, diff, sales_log: real.reduce((t, r) => t + r.total, 0), sales_file: file.reduce((t, o) => t + Number(o.total), 0) };
}
