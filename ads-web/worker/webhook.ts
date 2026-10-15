// Messenger webhook: Meta calls /webhook/meta the moment a customer opens a chat from an ad, with the
// customer's page-scoped id and the ad id. That is the only way to learn which ad each customer came from
// (the Graph API refuses to say afterwards), so we store it from the day the webhook is switched on.
// We keep psid, time, ad, and the campaign the ad belongs to; no names. The admins' own order note ("501/1/2 32 /
// cod 449", see orderNotes.ts) is kept to check against Page365, and since 2026-10-15 every message's text is kept
// for 30 days with phone numbers, e-mails, long numbers and addresses removed first (chatLog.ts).

import { parseOrderNote, saveNotes, type StoredNote } from './orderNotes.ts';
import { hashName } from './p365.ts';
import { extractChats, saveChats } from './chatLog.ts';

export interface WebhookEnv {
  DB: D1Database;
  META_ACCESS_TOKEN?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;
  META_API_VERSION?: string;
}

// standby: when another app (e.g. the chat tool) owns the thread, Meta delivers the same events there instead.
// message_echoes: the page's own messages, for the admins' order notes.
const SUBSCRIBED_FIELDS = 'messages,message_echoes,messaging_postbacks,messaging_referrals,standby';
const GRAPH = (env: WebhookEnv) => `https://graph.facebook.com/${env.META_API_VERSION ?? 'v21.0'}`;

interface Referral { ref?: string; source?: string; type?: string; ad_id?: string }
interface MessagingEvent {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  referral?: Referral;
  postback?: { referral?: Referral };
  message?: { is_echo?: boolean; mid?: string; text?: string; referral?: Referral };
}

export interface ReferralRow { psid: string; at: string; ad_id: string | null; campaign_id: string | null; source: string | null; ref: string | null; kind: string; name_hash?: string | null }

/** Meta's one-time check that the URL is ours: echo the challenge when the verify token matches. */
export function verifyChallenge(url: URL, env: WebhookEnv): Response {
  const ok = url.searchParams.get('hub.mode') === 'subscribe' && !!env.META_WEBHOOK_VERIFY_TOKEN && url.searchParams.get('hub.verify_token') === env.META_WEBHOOK_VERIFY_TOKEN;
  if (!ok) return new Response('verify token mismatch', { status: 403 });
  return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

/** Every delivery is signed with the app secret; anything unsigned or mis-signed is dropped. */
export async function receiveWebhook(req: Request, env: WebhookEnv, ctx: ExecutionContext): Promise<Response> {
  if (!env.META_APP_SECRET) return new Response('META_APP_SECRET not set', { status: 503 });
  const raw = await req.text();
  const sig = req.headers.get('X-Hub-Signature-256') ?? '';
  if (!(await validSignature(raw, sig, env.META_APP_SECRET))) return new Response('bad signature', { status: 401 });

  let body: { object?: string; entry?: { id?: string; messaging?: MessagingEvent[]; standby?: MessagingEvent[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('not json', { status: 400 });
  }
  if (body.object !== 'page') return new Response('ignored', { status: 200 });

  const rows = extractReferrals(body.entry ?? []);
  const notes = extractOrderNotes(body.entry ?? []);
  const echoes = (body.entry ?? []).reduce((n, e) => n + [...(e.messaging ?? []), ...(e.standby ?? [])].filter((ev) => ev.message?.is_echo).length, 0);
  const events = (body.entry ?? []).reduce((n, e) => n + (e.messaging?.length ?? 0) + (e.standby?.length ?? 0), 0);
  // Answer Meta right away; the writes finish in the background (Meta retries deliveries that get no 200).
  ctx.waitUntil(store(env, rows, events, notes, echoes).catch((err) => console.error('webhook store', err)));
  const chats = extractChats(body.entry ?? []);
  if (chats.length) ctx.waitUntil(saveChats(env.DB, chats).catch((err) => console.error('chat store', err)));
  return new Response('ok', { status: 200 });
}

/** One row per event that carries a referral (ad click, m.me link, ...). Echoes of our own messages are skipped. */
export function extractReferrals(entries: { messaging?: MessagingEvent[]; standby?: MessagingEvent[] }[]): ReferralRow[] {
  const out: ReferralRow[] = [];
  for (const e of entries) {
    for (const ev of [...(e.messaging ?? []), ...(e.standby ?? [])]) {
      if (ev.message?.is_echo || !ev.sender?.id) continue;
      const pick: [Referral | undefined, string][] = [[ev.referral, 'referral'], [ev.postback?.referral, 'postback'], [ev.message?.referral, 'message']];
      const found = pick.find(([r]) => r && (r.ad_id || r.ref || r.source));
      if (!found) continue;
      const [r, kind] = found as [Referral, string];
      out.push({
        psid: ev.sender.id,
        at: eventTime(ev.timestamp),
        ad_id: r.ad_id ?? null,
        campaign_id: null,
        source: r.source ?? null,
        ref: r.ref ?? null,
        kind,
      });
    }
  }
  return out;
}

/** The page's own messages (echoes) that are an order note and nothing else; everything else is dropped here. */
export function extractOrderNotes(entries: { messaging?: MessagingEvent[]; standby?: MessagingEvent[] }[]): StoredNote[] {
  const out: StoredNote[] = [];
  for (const e of entries) {
    for (const ev of [...(e.messaging ?? []), ...(e.standby ?? [])]) {
      const m = ev.message;
      if (!m?.is_echo || !m.mid || !m.text || !ev.recipient?.id || !parseOrderNote(m.text)) continue;
      out.push({ mid: m.mid, psid: ev.recipient.id, at: eventTime(ev.timestamp), text: m.text.trim(), name_hash: null });
    }
  }
  return out;
}

/** Meta documents timestamps in milliseconds but delivers some in seconds; anything before 2001 in ms is seconds. */
function eventTime(ts: number | undefined): string {
  if (!ts) return new Date().toISOString();
  return new Date(ts < 1e11 ? ts * 1000 : ts).toISOString();
}

async function store(env: WebhookEnv, rows: ReferralRow[], events: number, notes: StoredNote[] = [], echoes = 0): Promise<void> {
  const now = new Date().toISOString();
  const stmts = [
    bump(env.DB, 'events_total', events),
    env.DB.prepare('INSERT OR REPLACE INTO webhook_status (key, value) VALUES (?, ?)').bind('last_event_at', now),
  ];
  if (rows.length) {
    const [map, hashes] = await Promise.all([
      resolveAds(env, rows.map((r) => r.ad_id).filter((x): x is string => !!x)),
      nameHashes(env, [...new Set(rows.map((r) => r.psid))]),
    ]);
    for (const r of rows) { r.campaign_id = r.ad_id ? map.get(r.ad_id) ?? null : null; r.name_hash = hashes.get(r.psid) ?? null; }
    stmts.push(
      env.DB.prepare(`INSERT OR IGNORE INTO ad_referrals (psid, at, ad_id, campaign_id, source, ref, kind, name_hash)
        SELECT value->>'psid', value->>'at', value->>'ad_id', value->>'campaign_id', value->>'source', value->>'ref', value->>'kind', value->>'name_hash' FROM json_each(?)`).bind(JSON.stringify(rows)),
      bump(env.DB, 'referrals_total', rows.length),
      env.DB.prepare('INSERT OR REPLACE INTO webhook_status (key, value) VALUES (?, ?)').bind('last_referral_at', now),
    );
  }
  // Messages the page sent (any app): shows whether Meta delivers echoes at all, notes or not.
  if (echoes) stmts.push(bump(env.DB, 'echoes_total', echoes), env.DB.prepare('INSERT OR REPLACE INTO webhook_status (key, value) VALUES (?, ?)').bind('last_echo_at', now));
  if (notes.length) {
    const hashes = await nameHashes(env, [...new Set(notes.map((n) => n.psid))]);
    for (const n of notes) n.name_hash = hashes.get(n.psid) ?? null;
    await saveNotes(env.DB, notes);
    stmts.push(bump(env.DB, 'order_notes_total', notes.length), env.DB.prepare('INSERT OR REPLACE INTO webhook_status (key, value) VALUES (?, ?)').bind('last_order_note_at', now));
  }
  await env.DB.batch(stmts);
}

function bump(db: D1Database, key: string, n: number): D1PreparedStatement {
  return db.prepare('INSERT INTO webhook_status (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + ?2 AS TEXT)').bind(key, String(n));
}

/** ad_id → campaign_id, looked up once per ad through the Marketing API and remembered in ad_map. */
async function resolveAds(env: WebhookEnv, adIds: string[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(adIds)];
  const map = new Map<string, string | null>();
  if (!ids.length) return map;
  const { results } = await env.DB.prepare('SELECT ad_id, campaign_id FROM ad_map WHERE ad_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<{ ad_id: string; campaign_id: string | null }>();
  for (const r of results) map.set(r.ad_id, r.campaign_id);
  const missing = ids.filter((id) => !map.has(id));
  if (!missing.length || !env.META_ACCESS_TOKEN) return map;
  const fetched: { ad_id: string; campaign_id: string | null; adset_id: string | null; name: string | null }[] = [];
  for (const id of missing.slice(0, 20)) {
    const res = await fetch(`${GRAPH(env)}/${id}?fields=campaign_id,adset_id,name&access_token=${encodeURIComponent(env.META_ACCESS_TOKEN)}`);
    const body: any = await res.json().catch(() => ({}));
    const row = { ad_id: id, campaign_id: body.campaign_id ?? null, adset_id: body.adset_id ?? null, name: body.name ?? null };
    if (body.error) console.warn('ad lookup', id, body.error.message);
    fetched.push(row);
    map.set(id, row.campaign_id);
  }
  // Failed lookups are stored too (campaign null) so a dead ad id isn't asked for on every delivery; the next
  // successful setup/status call doesn't retry them either — rare enough to leave alone.
  await env.DB.prepare(`INSERT OR REPLACE INTO ad_map (ad_id, campaign_id, adset_id, name, fetched_at)
    SELECT value->>'ad_id', value->>'campaign_id', value->>'adset_id', value->>'name', ? FROM json_each(?)`).bind(new Date().toISOString(), JSON.stringify(fetched)).run();
  return map;
}

/**
 * The customer's profile name, hashed with the same salt as Page365 uploads so the two can be joined — the
 * name itself is never stored. Meta refuses the lookup for some users; those stay unlinked.
 */
async function nameHashes(env: WebhookEnv, psids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!psids.length || !env.META_WEBHOOK_VERIFY_TOKEN) return out;
  const pg = await pageOf(env).catch(() => null);
  if (!pg) return out;
  for (const psid of psids.slice(0, 20)) {
    const res = await fetch(`${GRAPH(env)}/${psid}?fields=name&access_token=${encodeURIComponent(pg.token)}`);
    const body: any = await res.json().catch(() => ({}));
    const h = await hashName(body.name, env.META_WEBHOOK_VERIFY_TOKEN);
    if (h) out.set(psid, h);
  }
  return out;
}

async function validSignature(raw: string, header: string, secret: string): Promise<boolean> {
  if (!header.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  const given = header.slice(7).toLowerCase();
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// ---- status + one-click setup (called from the settings page) ----

export interface WebhookStatus {
  configured: { app_secret: boolean; verify_token: boolean; app_id: boolean };
  callback_url: string;
  app_subscribed: boolean | null;
  page: { id: string; name: string; subscribed: boolean } | null;
  events_total: number;
  referrals_total: number;
  order_notes_total: number;
  echoes_total: number;
  last_echo_at: string | null;
  last_event_at: string | null;
  last_referral_at: string | null;
  last_order_note_at: string | null;
  /** the page subscription still lacks message_echoes (press connect again) */
  echoes_missing: boolean;
  error: string | null;
}

export async function webhookStatus(env: WebhookEnv, callbackUrl: string): Promise<WebhookStatus> {
  const { results } = await env.DB.prepare('SELECT key, value FROM webhook_status').all<{ key: string; value: string }>();
  const kv = Object.fromEntries(results.map((r) => [r.key, r.value]));
  const st: WebhookStatus = {
    configured: { app_secret: !!env.META_APP_SECRET, verify_token: !!env.META_WEBHOOK_VERIFY_TOKEN, app_id: !!env.META_APP_ID },
    callback_url: callbackUrl,
    app_subscribed: null,
    page: null,
    events_total: Number(kv.events_total ?? 0),
    referrals_total: Number(kv.referrals_total ?? 0),
    order_notes_total: Number(kv.order_notes_total ?? 0),
    echoes_total: Number(kv.echoes_total ?? 0),
    last_echo_at: kv.last_echo_at ?? null,
    last_event_at: kv.last_event_at ?? null,
    last_referral_at: kv.last_referral_at ?? null,
    last_order_note_at: kv.last_order_note_at ?? null,
    echoes_missing: false,
    error: null,
  };
  const errors: string[] = [];
  if (env.META_APP_ID && env.META_APP_SECRET) {
    try {
      const subs: any = await graph(env, `${env.META_APP_ID}/subscriptions`, { access_token: `${env.META_APP_ID}|${env.META_APP_SECRET}` });
      const page = (subs.data ?? []).find((s: any) => s.object === 'page');
      st.app_subscribed = !!page && page.active !== false && page.callback_url === callbackUrl;
    } catch (err: any) {
      errors.push(err?.message ?? String(err));
    }
  }
  try {
    const pg = await pageOf(env);
    if (pg) {
      const apps: any = await graph(env, `${pg.id}/subscribed_apps`, { access_token: pg.token, fields: 'id,name,subscribed_fields' });
      const mine = (apps.data ?? []).find((a: any) => String(a.id) === env.META_APP_ID);
      st.page = { id: pg.id, name: pg.name, subscribed: !!mine };
      st.echoes_missing = !!mine && Array.isArray(mine.subscribed_fields) && !mine.subscribed_fields.includes('message_echoes');
    }
  } catch (err: any) {
    errors.push(err?.message ?? String(err));
  }
  st.error = errors.length ? errors.join(' · ') : null;
  return st;
}

/** Points Meta at our URL (app subscription) and asks the page to send its Messenger events to the app. */
export async function setupWebhook(env: WebhookEnv, callbackUrl: string): Promise<{ app: unknown; page: unknown }> {
  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_WEBHOOK_VERIFY_TOKEN) throw new Error('ต้องตั้ง META_APP_ID, META_APP_SECRET และ META_WEBHOOK_VERIFY_TOKEN ก่อน');
  const app = await graph(env, `${env.META_APP_ID}/subscriptions`, {
    access_token: `${env.META_APP_ID}|${env.META_APP_SECRET}`,
    object: 'page',
    callback_url: callbackUrl,
    verify_token: env.META_WEBHOOK_VERIFY_TOKEN,
    fields: SUBSCRIBED_FIELDS,
    include_values: 'true',
  }, 'POST');
  const pg = await pageOf(env);
  if (!pg) throw new Error('โทเค็นนี้ไม่เห็นเพจไหนเลย (ต้องมีสิทธิ์ pages_show_list และ pages_messaging)');
  const page = await graph(env, `${pg.id}/subscribed_apps`, { access_token: pg.token, subscribed_fields: SUBSCRIBED_FIELDS }, 'POST');
  return { app, page };
}

export async function pageOf(env: WebhookEnv): Promise<{ id: string; name: string; token: string } | null> {
  if (!env.META_ACCESS_TOKEN) return null;
  const res: any = await graph(env, 'me/accounts', { access_token: env.META_ACCESS_TOKEN, fields: 'id,name,access_token' });
  const p = res.data?.[0];
  return p ? { id: p.id, name: p.name, token: p.access_token } : null;
}

async function graph(env: WebhookEnv, path: string, params: Record<string, string>, method: 'GET' | 'POST' = 'GET'): Promise<unknown> {
  const url = new URL(`${GRAPH(env)}/${path}`);
  const form = new URLSearchParams(params);
  if (method === 'GET') url.search = form.toString();
  const res = await fetch(url, method === 'GET' ? undefined : { method, body: form });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`Meta ${method} ${path}: ${body?.error?.message ?? res.statusText}`);
  return body;
}

// ---- what the pages read ----

export interface ReferralSummary { date: string; campaign_id: string | null; ad_id: string | null; ad_name: string | null; people: number; bought: number; events: number }

/**
 * People who opened a chat from an ad, per Bangkok day × campaign × ad, for the given dates. "bought" = of
 * those people, how many have a Page365 order (same name hash) within 14 days after the chat.
 * Two indexed reads and the grouping in code: a correlated subquery here once read 160k rows per call and
 * used up D1's free daily read allowance (12 Oct 2026).
 */
export async function referralSummary(db: D1Database, dates: string[]): Promise<ReferralSummary[]> {
  if (!dates.length) return [];
  const sorted = [...dates].sort();
  const from = new Date(`${sorted[0]}T00:00:00+07:00`).toISOString();
  const to = new Date(Date.parse(`${sorted[sorted.length - 1]}T00:00:00+07:00`) + 86_400_000).toISOString();
  const { results: refs } = await db.prepare(`
    SELECT r.psid, r.at, r.campaign_id, r.ad_id, r.name_hash, m.name AS ad_name
    FROM ad_referrals r LEFT JOIN ad_map m ON m.ad_id = r.ad_id
    WHERE r.at >= ? AND r.at < ?`).bind(from, to).all<{ psid: string; at: string; campaign_id: string | null; ad_id: string | null; name_hash: string | null; ad_name: string | null }>();
  const wanted = new Set(dates);
  const bkk = (iso: string) => new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 10);
  const rows = refs.filter((r) => wanted.has(bkk(r.at)));
  const hashes = [...new Set(rows.map((r) => r.name_hash).filter((h): h is string => !!h))];
  const ordersBy = new Map<string, string[]>();
  if (hashes.length) {
    const { results } = await db.prepare('SELECT name_hash, created_at FROM p365_orders WHERE name_hash IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(hashes)).all<{ name_hash: string; created_at: string }>();
    for (const o of results) (ordersBy.get(o.name_hash) ?? ordersBy.set(o.name_hash, []).get(o.name_hash)!).push(o.created_at);
  }
  const groups = new Map<string, ReferralSummary & { _people: Set<string>; _bought: Set<string> }>();
  for (const r of rows) {
    const date = bkk(r.at);
    const key = `${date}|${r.campaign_id ?? ''}|${r.ad_id ?? ''}`;
    const g = groups.get(key) ?? { date, campaign_id: r.campaign_id, ad_id: r.ad_id, ad_name: r.ad_name, people: 0, bought: 0, events: 0, _people: new Set(), _bought: new Set() };
    g.events++; g._people.add(r.psid);
    const t = Date.parse(r.at);
    if (r.name_hash && (ordersBy.get(r.name_hash) ?? []).some((c) => { const x = Date.parse(c); return x >= t && x <= t + 14 * 86_400_000; })) g._bought.add(r.psid);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ _people, _bought, ...g }) => ({ ...g, people: _people.size, bought: _bought.size }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.people - a.people);
}
