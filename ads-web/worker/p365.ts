// Page365 orders: the shop's real order book, uploaded once a day from Page365's export. Each order is then
// credited to an ad campaign two ways: by customer (the order's profile-name hash matches a chat that opened
// from an ad) or by time + money (admins tag the sale into Meta the minute they open the order, so Meta's
// purchases per campaign per hour must add up to the orders created in that hour).

import { bkkDate } from './conversionStore.ts';
import type { OrderFees } from './db.ts';

/** What the team deducts from one order besides product cost: COD fee (COD orders only), loss, shipping, VAT, packaging. */
export function orderFees(o: Pick<StoredOrder, 'total' | 'payment' | 'shipping'>, f: OrderFees): number {
  const cod = o.payment === 'cod' ? o.total * f.cod_pct / 100 : 0;
  // VAT on what the customer paid, on the goods only (minus the shipping collected), or on the amount after our own
  // shipping cost (the team's rule, 12 Oct 2026: the COD +50 is income and is taxed; the 15 we pay the courier is not)
  const vatBase = f.vat_base === 'goods' ? Math.max(0, o.total - (o.shipping ?? 0)) : f.vat_base === 'after_ship' ? Math.max(0, o.total - f.ship) : o.total;
  return cod + o.total * f.loss_pct / 100 + f.ship + vatBase * f.vat_pct / 100 + f.bag;
}

export interface UploadedOrder {
  order_no: string;
  created_at: string;        // "2026-10-08 08:36:56 +0700" as exported, or ISO
  total: number;
  subtotal?: number | null;
  discount?: number | null;
  shipping?: number | null;
  cost?: number | null;
  payment?: string | null;
  paid_at?: string | null;
  item_detail?: string | null;
  profile_name?: string | null;   // hashed on arrival, never stored
}

export interface OrderItem { code: string; sku: string; name: string; qty: number; price: number }

export interface StoredOrder {
  order_no: string;
  date: string;
  created_at: string;
  total: number;
  subtotal: number | null;
  discount: number | null;
  shipping: number | null;
  cost: number | null;
  payment: string | null;
  paid_at: string | null;
  units: number;
  items: OrderItem[];
  name_hash: string | null;
  campaign_id: string | null;
  match: 'customer' | 'exact' | 'approx' | 'none';
}

/** "501/3 ยีนส์กระบอกเล็ก... (5013-PK-BL-30) (5013-PK-BL-30) x1 THB 369.0" → one item per "(SKU) xN THB P". */
export function parseItems(detail: string | null | undefined): OrderItem[] {
  const out: OrderItem[] = [];
  if (!detail) return out;
  const re = /([^()]*?)\s*\(([A-Z0-9]+)-([A-Z]+)-([A-Z0-9]+)-(\d+)\)\s*(?:\([^)]*\)\s*)*x\s*(\d+)\s*THB\s*(\d+(?:[.,]\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(detail))) {
    const name = m[1].replace(/^[\s.]+/, '').trim();
    out.push({ code: m[2].toUpperCase(), sku: `${m[2]}-${m[3]}-${m[4]}-${m[5]}`.toUpperCase(), name, qty: Number(m[6]), price: Number(m[7].replace(/,/g, '')) });
  }
  return out;
}

/** Page365 exports "2026-10-08 08:36:56 +0700"; accept that and ISO. */
export function parseExportTime(s: string): Date | null {
  const t = s.trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*([+-]\d{2}):?(\d{2})?$/);
  if (m) {
    const off = Number(m[7]) * 60 + (Number(m[7]) < 0 ? -1 : 1) * Number(m[8] ?? 0);
    const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - off * 60_000;
    return new Date(utc);
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Salted SHA-256 of the normalised name: links a Page365 order to a Messenger chat without keeping the name. */
export async function hashName(name: string | null | undefined, salt: string): Promise<string | null> {
  const n = (name ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!n) return null;
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}\u0000${n}`)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Exchange / return slips Page365 sometimes exports as 0-baht orders: not sales (decided with the team 12 Oct 2026). */
export function isExchangeSlip(o: Pick<UploadedOrder, 'total' | 'item_detail'>): boolean {
  return Number(o.total) === 0 && /RETURN|\(RE\)|เปลี่ยนของ|คืนของ/i.test(String(o.item_detail ?? ''));
}

export async function normaliseOrders(input: UploadedOrder[], salt: string): Promise<{ orders: StoredOrder[]; errors: string[]; skipped: number }> {
  const orders: StoredOrder[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const [i, o] of input.entries()) {
    const no = String(o.order_no ?? '').replace(/\.0+$/, '').trim();
    if (!no) { errors.push(`แถว ${i + 1}: ไม่มีเลขออเดอร์`); continue; }
    if (seen.has(no)) continue;
    if (isExchangeSlip(o)) { skipped++; continue; }
    const at = parseExportTime(String(o.created_at ?? ''));
    if (!at) { errors.push(`ออเดอร์ ${no}: เวลาไม่ถูกต้อง`); continue; }
    const total = Number(o.total);
    if (!Number.isFinite(total) || total < 0) { errors.push(`ออเดอร์ ${no}: ยอดไม่ถูกต้อง`); continue; }
    seen.add(no);
    const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    const items = parseItems(o.item_detail);
    orders.push({
      order_no: no,
      date: bkkDate(0, at.getTime()),
      created_at: at.toISOString(),
      total,
      subtotal: num(o.subtotal), discount: num(o.discount), shipping: num(o.shipping), cost: num(o.cost),
      payment: o.payment ? String(o.payment).trim().toLowerCase() : null,
      paid_at: o.paid_at ? parseExportTime(String(o.paid_at))?.toISOString() ?? null : null,
      units: items.reduce((n, it) => n + it.qty, 0),
      items,
      name_hash: await hashName(o.profile_name, salt),
      campaign_id: null,
      match: 'none',
    });
  }
  return { orders, errors, skipped };
}

// ---- crediting orders to campaigns ----

export interface HourBudget { campaign_id: string; hour: string; purchases: number; value: number }
export interface ReferralLink { name_hash: string; campaign_id: string | null; at: string }

const COD_FEE = 50;
const NODE_LIMIT = 40_000;

/**
 * Credits each order to a campaign. Customer links win; the rest are solved hour by hour so that each
 * campaign's tagged purchases (count and value, which may or may not include the COD fee) are covered by
 * orders created in that hour, then in the neighbouring hours for what is left. Mutates match/campaign_id.
 */
export function creditOrders(orders: StoredOrder[], hours: HourBudget[], referrals: ReferralLink[]): { customer: number; exact: number; approx: number; none: number } {
  const byHash = new Map<string, ReferralLink[]>();
  for (const r of referrals) if (r.campaign_id) (byHash.get(r.name_hash) ?? byHash.set(r.name_hash, []).get(r.name_hash)!).push(r);
  const remaining = new Map<string, { campaign_id: string; hour: string; n: number; value: number }>();
  for (const h of hours) remaining.set(`${h.campaign_id}|${h.hour.slice(0, 2)}`, { campaign_id: h.campaign_id, hour: h.hour.slice(0, 2), n: Math.round(h.purchases), value: h.value });
  const hourOf = (o: StoredOrder) => new Date(new Date(o.created_at).getTime() + 7 * 3_600_000).toISOString().slice(11, 13);

  for (const o of orders) { o.campaign_id = null; o.match = 'none'; }

  // 1. The customer opened a chat from an ad before ordering (latest such chat within 14 days).
  for (const o of orders) {
    if (!o.name_hash) continue;
    const t = new Date(o.created_at).getTime();
    const link = (byHash.get(o.name_hash) ?? [])
      .filter((r) => { const a = new Date(r.at).getTime(); return a <= t + 60_000 && a >= t - 14 * 86_400_000; })
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!link?.campaign_id) continue;
    o.campaign_id = link.campaign_id; o.match = 'customer';
    const b = remaining.get(`${link.campaign_id}|${hourOf(o)}`);
    if (b && b.n > 0) { b.n--; b.value = Math.max(0, b.value - o.total); }
  }

  // 2. Same hour: find, per campaign, the orders whose totals add up to the tagged value.
  const open = () => orders.filter((o) => o.match === 'none');
  const solveHour = (hour: string, slack: number) => {
    const budgets = [...remaining.values()].filter((b) => b.hour === hour && b.n > 0);
    if (!budgets.length) return;
    const pool = open().filter((o) => Math.abs(Number(hourOf(o)) - Number(hour)) <= slack);
    if (!pool.length) return;
    budgets.sort((a, b) => b.n - a.n || b.value - a.value);
    for (const b of budgets) {
      const cand = pool.filter((o) => o.match === 'none');
      if (!cand.length) break;
      const pick = subsetByValue(cand, b.n, b.value);
      if (!pick) continue;
      for (const o of pick.orders) { o.campaign_id = b.campaign_id; o.match = pick.exact && slack === 0 ? 'exact' : 'approx'; }
      b.n -= pick.orders.length; b.value = Math.max(0, b.value - pick.orders.reduce((s, o) => s + o.total, 0));
    }
  };
  const hoursSeen = [...new Set([...remaining.values()].map((b) => b.hour))].sort();
  for (const h of hoursSeen) solveHour(h, 0);
  for (const h of hoursSeen) solveHour(h, 1);

  const counts = { customer: 0, exact: 0, approx: 0, none: 0 };
  for (const o of orders) counts[o.match]++;
  return counts;
}

/**
 * n orders whose totals sum to `value`, allowing each order to have been tagged with or without its COD fee
 * (tolerance 50 per order) — that counts as exact. Prefers the smallest deviation; gives up after NODE_LIMIT
 * nodes and then takes the n orders closest to the average, marked approximate.
 */
function subsetByValue(cand: StoredOrder[], n: number, value: number): { orders: StoredOrder[]; exact: boolean } | null {
  if (n <= 0 || !cand.length) return null;
  if (n >= cand.length) {
    const sum = cand.reduce((s, o) => s + o.total, 0);
    return { orders: cand, exact: Math.abs(sum - value) <= COD_FEE * cand.length + 1 };
  }
  const sorted = [...cand].sort((a, b) => b.total - a.total);
  let best: { idx: number[]; dev: number } | null = null;
  let nodes = 0;
  const tol = COD_FEE * n + 1;
  const dfs = (start: number, left: number, sum: number, idx: number[]) => {
    if (++nodes > NODE_LIMIT) return;
    if (left === 0) {
      const dev = Math.abs(sum - value);
      if (dev <= tol && (!best || dev < best.dev)) best = { idx: [...idx], dev };
      return;
    }
    for (let i = start; i <= sorted.length - left; i++) {
      const s = sum + sorted[i].total;
      // Largest-first order: once the running sum is already past the target by more than the tolerance, deeper picks only add.
      if (s - value > tol) continue;
      idx.push(i); dfs(i + 1, left - 1, s, idx); idx.pop();
      if (best && best.dev < 1) return;
    }
  };
  dfs(0, n, 0, []);
  if (best) {
    const b = best as { idx: number[]; dev: number };
    return { orders: b.idx.map((i) => sorted[i]), exact: true };
  }
  // No combination fits: credit the n orders nearest the tagged average so the campaign still gets its sales.
  const avg = value / n;
  const near = [...cand].sort((a, b) => Math.abs(a.total - avg) - Math.abs(b.total - avg)).slice(0, n);
  return { orders: near, exact: false };
}

// ---- storage ----

export async function saveOrders(db: D1Database, orders: StoredOrder[], by: string): Promise<void> {
  if (!orders.length) return;
  const now = new Date().toISOString();
  const dates = [...new Set(orders.map((o) => o.date))];
  const rows = orders.map((o) => ({ ...o, items: JSON.stringify(o.items) }));
  await db.batch([
    db.prepare(`INSERT OR REPLACE INTO p365_orders (order_no, date, created_at, total, subtotal, discount, shipping, cost, payment, paid_at, units, items, name_hash, campaign_id, match, uploaded_at)
      SELECT value->>'order_no', value->>'date', value->>'created_at', value->>'total', value->>'subtotal', value->>'discount', value->>'shipping', value->>'cost',
             value->>'payment', value->>'paid_at', value->>'units', value->>'items', value->>'name_hash', value->>'campaign_id', value->>'match', ?
      FROM json_each(?)`).bind(now, JSON.stringify(rows)),
    ...dates.map((d) => db.prepare(`INSERT INTO p365_uploads (date, orders, uploaded_by, uploaded_at) VALUES (?, (SELECT COUNT(*) FROM p365_orders WHERE date = ?), ?, ?)
      ON CONFLICT(date) DO UPDATE SET orders = excluded.orders, uploaded_by = excluded.uploaded_by, uploaded_at = excluded.uploaded_at`).bind(d, d, by, now)),
  ]);
}

export async function updateCredits(db: D1Database, orders: StoredOrder[]): Promise<void> {
  if (!orders.length) return;
  await db.prepare(`UPDATE p365_orders SET campaign_id = j.campaign_id, match = j.match
    FROM (SELECT value->>'order_no' AS order_no, value->>'campaign_id' AS campaign_id, value->>'match' AS match FROM json_each(?)) AS j
    WHERE p365_orders.order_no = j.order_no`).bind(JSON.stringify(orders.map((o) => ({ order_no: o.order_no, campaign_id: o.campaign_id, match: o.match })))).run();
}

export async function loadOrders(db: D1Database, dates: string[]): Promise<StoredOrder[]> {
  if (!dates.length) return [];
  const { results } = await db.prepare('SELECT * FROM p365_orders WHERE date IN (SELECT value FROM json_each(?)) ORDER BY created_at').bind(JSON.stringify(dates)).all<any>();
  return results.map((r) => ({ ...r, items: JSON.parse(r.items || '[]') as OrderItem[] }));
}

export async function loadUploads(db: D1Database, dates: string[]): Promise<Map<string, { orders: number; uploaded_at: string; uploaded_by: string }>> {
  if (!dates.length) return new Map();
  const { results } = await db.prepare('SELECT * FROM p365_uploads WHERE date IN (SELECT value FROM json_each(?))').bind(JSON.stringify(dates)).all<{ date: string; orders: number; uploaded_at: string; uploaded_by: string }>();
  return new Map(results.map((r) => [r.date, { orders: r.orders, uploaded_at: r.uploaded_at, uploaded_by: r.uploaded_by }]));
}

/** Re-credits every order of the given dates against Meta's hourly purchases and the ad chats. */
export async function recreditDates(db: D1Database, dates: string[]): Promise<Record<string, ReturnType<typeof creditOrders>>> {
  const out: Record<string, ReturnType<typeof creditOrders>> = {};
  if (!dates.length) return out;
  const [orders, hours, refs] = await Promise.all([
    loadOrders(db, dates),
    db.prepare('SELECT date, campaign_id, hour, purchases, value FROM conversion_hours WHERE date IN (SELECT value FROM json_each(?))').bind(JSON.stringify(dates)).all<HourBudget & { date: string }>().then((r) => r.results),
    db.prepare(`SELECT name_hash, campaign_id, at FROM ad_referrals WHERE name_hash IS NOT NULL AND at >= ?`).bind(new Date(Date.parse(`${dates.slice().sort()[0]}T00:00:00+07:00`) - 14 * 86_400_000).toISOString()).all<ReferralLink>().then((r) => r.results),
  ]);
  for (const d of dates) {
    const os = orders.filter((o) => o.date === d);
    if (!os.length) continue;
    out[d] = creditOrders(os, hours.filter((h) => h.date === d), refs);
  }
  await updateCredits(db, orders);
  return out;
}

export interface CampaignActual { campaign_id: string | null; orders: number; revenue: number; goods: number; shipping: number; cost: number; fees: number; units: number; customer: number; exact: number; approx: number; cost_known: number }

/** Per campaign for one day: real revenue, cost, fees and pieces from the orders credited to it. */
export function actualByCampaign(orders: StoredOrder[], fees: OrderFees): Map<string | null, CampaignActual> {
  const m = new Map<string | null, CampaignActual>();
  for (const o of orders) {
    const k = o.match === 'none' ? null : o.campaign_id;
    const a = m.get(k) ?? { campaign_id: k, orders: 0, revenue: 0, goods: 0, shipping: 0, cost: 0, fees: 0, units: 0, customer: 0, exact: 0, approx: 0, cost_known: 0 };
    a.orders++; a.revenue += o.total; a.shipping += o.shipping ?? 0; a.goods += o.total - (o.shipping ?? 0); a.units += o.units; a.fees += orderFees(o, fees);
    if (o.cost !== null) { a.cost += o.cost; a.cost_known++; }
    if (o.match === 'customer') a.customer++; else if (o.match === 'exact') a.exact++; else if (o.match === 'approx') a.approx++;
    m.set(k, a);
  }
  return m;
}
