// Purchases for Meta from Page365 orders (Benz 2026-10-15: admins stop tagging sales in Meta's inbox once this
// is live). Meta's Conversions API for Business Messaging takes a Purchase with the Page id + the customer's PSID,
// so the ad the chat came from gets the conversion, exactly like the inbox's "create order".
//
// When an order counts (decided with Benz): COD once the bill has been sent to the customer (stage unpaid or
// later); bank transfer once paid (transferred or later). Value = what the customer pays (Page365 total).
// event_time = when the bill was opened, so Meta's hourly purchases still line up with the orders (crediting in
// p365.ts relies on that). event_id = "p365-<order no>": Meta drops a second copy.
//
// Runs at most every 10 minutes, from webhook deliveries (no extra cron). Modes (settings page): off — nothing;
// test — sent with Meta's test_event_code (shows in Events Manager → Test events, not counted); live — counted,
// only orders created after live_from (earlier ones were tagged by hand).

import { call, type P365Env } from './p365fill.ts';

export interface CapiEnv extends P365Env { DB: D1Database; META_ACCESS_TOKEN?: string; META_API_VERSION?: string }
export type CapiMode = 'off' | 'test' | 'live';
export interface CapiConfig { mode: CapiMode; dataset_id: string; test_code: string; live_from: string; last_sync: string }

const PAGE_ID = (env: P365Env) => env.P365_PAGE_ID ?? '115748303500549';
const SYNC_EVERY_MS = 10 * 60_000;
const MAX_DETAILS = 30; // order look-ups per run (free plan: 50 outbound requests per invocation)

export async function loadCapi(db: D1Database): Promise<CapiConfig> {
  const { results } = await db.prepare('SELECT key, value FROM meta_capi').all<{ key: string; value: string }>().catch(() => ({ results: [] as { key: string; value: string }[] }));
  const kv = Object.fromEntries(results.map((r) => [r.key, r.value]));
  const mode = (['off', 'test', 'live'] as const).includes(kv.mode as CapiMode) ? (kv.mode as CapiMode) : 'off';
  return { mode, dataset_id: kv.dataset_id ?? '', test_code: kv.test_code ?? '', live_from: kv.live_from ?? '', last_sync: kv.last_sync ?? '' };
}

export async function saveCapi(db: D1Database, input: unknown): Promise<CapiConfig> {
  const x = (input ?? {}) as Record<string, unknown>;
  const cur = await loadCapi(db);
  const mode = (['off', 'test', 'live'] as const).includes(x.mode as CapiMode) ? (x.mode as CapiMode) : cur.mode;
  const dataset_id = typeof x.dataset_id === 'string' ? x.dataset_id.trim() : cur.dataset_id;
  const test_code = typeof x.test_code === 'string' ? x.test_code.trim() : cur.test_code;
  if (dataset_id && !/^\d{5,25}$/.test(dataset_id)) throw new Error('Dataset ID ต้องเป็นตัวเลข');
  if (mode !== 'off' && !dataset_id) throw new Error('ต้องใส่ Dataset ID ก่อนเปิด');
  if (mode === 'test' && !test_code) throw new Error('โหมดทดสอบต้องมี Test event code (Events Manager → Test events)');
  // Going live starts the clock: orders opened before this were tagged by the admins.
  const live_from = mode === 'live' && cur.mode !== 'live' ? new Date().toISOString() : cur.live_from;
  const rows = { mode, dataset_id, test_code, live_from };
  await db.batch(Object.entries(rows).map(([k, v]) => db.prepare('INSERT OR REPLACE INTO meta_capi (key, value) VALUES (?, ?)').bind(k, v)));
  return { ...cur, ...rows };
}

// ---- which orders count ----

interface ListOrder { id: number; no: number; created_at: string; stage: string; cod?: boolean }
interface DetailOrder { id: number; no: number; stage: string; created_at: string; cod: boolean; total: number; customer_fbid: string | null; customer_type?: string | null }

const COD_COUNTS = new Set(['unpaid', 'transferred', 'paid', 'shipped']);
const TRANSFER_COUNTS = new Set(['transferred', 'paid', 'shipped']);

/** Has this order become a sale? COD: bill sent. Transfer: money in. */
export function counts(o: { stage: string; cod: boolean }): boolean {
  return o.cod ? COD_COUNTS.has(o.stage) : TRANSFER_COUNTS.has(o.stage);
}

export interface PurchaseEvent {
  event_name: 'Purchase'; event_time: number; event_id: string; action_source: 'business_messaging'; messaging_channel: 'messenger';
  user_data: { page_id: string; page_scoped_user_id: string }; custom_data: { currency: 'THB'; value: number };
}

export function purchaseEvent(o: DetailOrder, pageId: string): PurchaseEvent {
  return {
    event_name: 'Purchase',
    event_time: Math.floor(Date.parse(o.created_at) / 1000),
    event_id: `p365-${o.no}`,
    action_source: 'business_messaging',
    messaging_channel: 'messenger',
    user_data: { page_id: pageId, page_scoped_user_id: o.customer_fbid! },
    custom_data: { currency: 'THB', value: Number(o.total) },
  };
}

export interface SyncResult { mode: CapiMode; dry: boolean; checked: number; sent: { no: number; value: number; cod: boolean; stage: string }[]; skipped: { no: number; why: string }[]; error: string | null }

/**
 * One pass: recent Page365 orders (last 7 days — Meta refuses older events) that count and haven't been sent,
 * looked up for the customer's PSID, sent as one batch. `dry` lists what would be sent and writes nothing.
 */
export async function syncPurchases(env: CapiEnv, opts: { dry?: boolean } = {}): Promise<SyncResult> {
  const cfg = await loadCapi(env.DB);
  const dry = opts.dry || cfg.mode === 'off';
  const res: SyncResult = { mode: cfg.mode, dry, checked: 0, sent: [], skipped: [], error: null };
  const weekAgo = Date.now() - 7 * 86_400_000 + 3_600_000;
  const liveFrom = cfg.mode === 'live' && cfg.live_from ? Date.parse(cfg.live_from) : 0;

  // Newest first; stop at orders older than a week.
  const list: ListOrder[] = [];
  for (let page = 1; page <= 4; page++) {
    const r = await call<{ orders: ListOrder[] }>(env, `orders.json?page=${page}`);
    list.push(...r.orders);
    if (!r.orders.length || Date.parse(r.orders[r.orders.length - 1].created_at) < weekAgo) break;
  }
  const recent = list.filter((o) => Date.parse(o.created_at) >= Math.max(weekAgo, liveFrom) && o.stage !== 'draft' && o.stage !== 'voided' && o.stage !== 'expired');
  const known = new Set<number>();
  if (recent.length) {
    const { results } = await env.DB.prepare('SELECT order_id FROM meta_purchases WHERE order_id IN (SELECT value FROM json_each(?)) AND status IN (\'sent\', \'test\', \'skipped\')')
      .bind(JSON.stringify(recent.map((o) => o.id))).all<{ order_id: number }>();
    for (const r of results) known.add(r.order_id);
  }
  const todo = recent.filter((o) => !known.has(o.id) && (o.cod === undefined || counts({ stage: o.stage, cod: o.cod }))).slice(0, MAX_DETAILS);

  const events: PurchaseEvent[] = [];
  const rows: { order_id: number; order_no: number; psid: string | null; value: number; cod: number; stage: string; event_time: string; status: string; detail: string | null }[] = [];
  for (const o of todo) {
    const d = await call<DetailOrder>(env, `orders/${o.id}.json`);
    res.checked++;
    if (!counts(d)) continue; // a transfer not paid yet: next run
    if (!d.customer_fbid) {
      res.skipped.push({ no: d.no, why: 'ไม่ได้มาจากแชท Messenger (ไม่มีรหัสลูกค้า)' });
      rows.push({ order_id: d.id, order_no: d.no, psid: null, value: d.total, cod: d.cod ? 1 : 0, stage: d.stage, event_time: d.created_at, status: 'skipped', detail: 'no psid' });
      continue;
    }
    events.push(purchaseEvent(d, PAGE_ID(env)));
    res.sent.push({ no: d.no, value: Number(d.total), cod: d.cod, stage: d.stage });
    rows.push({ order_id: d.id, order_no: d.no, psid: d.customer_fbid, value: d.total, cod: d.cod ? 1 : 0, stage: d.stage, event_time: d.created_at, status: cfg.mode === 'live' ? 'sent' : 'test', detail: null });
  }
  if (dry) return res;

  if (events.length) {
    try {
      if (!env.META_ACCESS_TOKEN) throw new Error('ยังไม่ได้ตั้ง META_ACCESS_TOKEN');
      const body: Record<string, unknown> = { data: events };
      if (cfg.mode === 'test') body.test_event_code = cfg.test_code;
      const r = await fetch(`https://graph.facebook.com/${env.META_API_VERSION ?? 'v21.0'}/${cfg.dataset_id}/events?access_token=${encodeURIComponent(env.META_ACCESS_TOKEN)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const b: any = await r.json().catch(() => ({}));
      if (!r.ok || b.error) throw new Error(b?.error?.message ?? `Meta ${r.status}`);
    } catch (err: any) {
      res.error = err?.message ?? String(err);
      for (const row of rows) if (row.status !== 'skipped') { row.status = 'error'; row.detail = res.error; }
    }
  }
  const now = new Date().toISOString();
  const stmts = [env.DB.prepare('INSERT OR REPLACE INTO meta_capi (key, value) VALUES (\'last_sync\', ?)').bind(now)];
  if (rows.length) stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO meta_purchases (order_id, order_no, psid, value, cod, stage, event_time, status, detail, sent_at)
    SELECT value->>'order_id', value->>'order_no', value->>'psid', value->>'value', value->>'cod', value->>'stage', value->>'event_time', value->>'status', value->>'detail', ? FROM json_each(?)`).bind(now, JSON.stringify(rows)));
  await env.DB.batch(stmts);
  return res;
}

/** From the webhook: a pass at most every 10 minutes while the sender is on. Errors are logged, never thrown. */
export async function maybeSyncPurchases(env: CapiEnv): Promise<void> {
  const cfg = await loadCapi(env.DB);
  if (cfg.mode === 'off' || !cfg.dataset_id || !env.P365_COOKIE) return;
  if (cfg.last_sync && Date.now() - Date.parse(cfg.last_sync) < SYNC_EVERY_MS) return;
  // Claim the slot first so overlapping deliveries don't both run.
  const claim = await env.DB.prepare('INSERT INTO meta_capi (key, value) VALUES (\'last_sync\', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1 WHERE value = ?2')
    .bind(new Date().toISOString(), cfg.last_sync).run();
  if (!claim.meta.changes) return;
  await syncPurchases(env).catch((err) => console.error('capi sync', err));
}

export async function recentPurchases(db: D1Database, days = 7): Promise<{ order_no: number; value: number; cod: number; stage: string; event_time: string; status: string; detail: string | null; sent_at: string }[]> {
  const { results } = await db.prepare('SELECT order_no, value, cod, stage, event_time, status, detail, sent_at FROM meta_purchases WHERE sent_at >= ? ORDER BY sent_at DESC, order_no DESC LIMIT 300')
    .bind(new Date(Date.now() - days * 86_400_000).toISOString()).all<any>();
  return results;
}
