/**
 * What an AI box is allowed to read, loaded from the database.
 *
 * Each knowledge add-on maps to one loader. The box only ever sees the keys the
 * owner switched on, and it sees them as compact plain text — the same numbers
 * the Marketing screen shows, never a free SQL connection.
 */
import type { Db } from '../db/client.js';
import { buildProductSignals, type ProductSignal } from '../signals/build.js';

export interface AdRow {
  external_ad_id: string; ad_name: string; campaign_name: string; first_date: string; last_date: string;
  impressions: number; clicks: number; spend: string; conversations: number; purchases: number; revenue: string;
}
export interface PostRow {
  external_post_id: string; created_time: string; message: string | null;
  reach: number | null; engaged: number | null; comments: number | null; shares: number | null;
}
export interface CompetitorAd {
  page_name: string; ad_text: string; hook: string | null; price_hint: number | null; format: string | null; first_seen: string;
}
export interface RunRow { agent_id: string; name: string; emoji: string | null; status: string; summary: string; started_at: string }

export interface Knowledge {
  brand: Record<string, string>;      // voice / usp / forbidden / sizes → markdown
  signals?: ProductSignal[];
  ads?: AdRow[];
  posts?: PostRow[];
  competitors?: CompetitorAd[];
  runs?: RunRow[];
}

const BRAND_KEYS = new Set(['voice', 'usp', 'forbidden', 'sizes', 'policy']);

export async function loadAds(db: Db, storeId: string): Promise<AdRow[]> {
  return db.query<AdRow>(
    `select external_ad_id, max(ad_name) as ad_name, max(campaign_name) as campaign_name, min(date)::text as first_date, max(date)::text as last_date,
            sum(impressions)::int as impressions, sum(clicks)::int as clicks, sum(spend)::numeric(12,2)::text as spend,
            sum(conversations)::int as conversations, sum(purchases)::int as purchases, sum(revenue)::numeric(12,2)::text as revenue
       from fact_ad_insight_daily where store_id=$1 group by external_ad_id order by max(date) desc, spend desc`, [storeId]);
}

export async function loadPosts(db: Db, storeId: string): Promise<PostRow[]> {
  const rows = await db.query<PostRow>(
    `select distinct on (external_post_id) external_post_id, created_time::text, message, reach, engaged, comments, shares
       from fact_post_insight_daily where store_id=$1 order by external_post_id, date desc`, [storeId]);
  return rows.sort((a, b) => String(b.created_time).localeCompare(String(a.created_time)));
}

export async function loadCompetitors(db: Db, storeId: string): Promise<CompetitorAd[]> {
  return db.query<CompetitorAd>(
    `select page_name, ad_text, hook, price_hint, format, first_seen::text
       from competitor_ad where store_id=$1 and active order by first_seen desc limit 30`, [storeId]);
}

/** Today's runs across every box, newest first. */
export async function loadRunsToday(db: Db, storeId: string): Promise<RunRow[]> {
  return db.query<RunRow>(
    `select r.agent_id, a.name, a.emoji, r.status, r.summary, r.started_at::text
       from agent_run r join agent a on a.id = r.agent_id
      where r.store_id=$1 and r.started_at >= date_trunc('day', now())
      order by r.id desc limit 40`, [storeId]);
}

export async function loadKnowledge(db: Db, storeId: string, keys: string[]): Promise<Knowledge> {
  const want = new Set(keys);
  const brandKeys = keys.filter((k) => BRAND_KEYS.has(k));
  const brand: Record<string, string> = {};
  if (brandKeys.length) {
    const rows = await db.query<{ key: string; content: string }>(
      'select key, content from brand_doc where store_id=$1 and key = any($2)', [storeId, brandKeys]);
    for (const r of rows) brand[r.key] = r.content;
  }
  return {
    brand,
    signals: want.has('signals') ? await buildProductSignals(db, storeId) : undefined,
    ads: want.has('ads') ? await loadAds(db, storeId) : undefined,
    posts: want.has('posts') ? (await loadPosts(db, storeId)).slice(0, 8) : undefined,
    competitors: want.has('competitors') ? await loadCompetitors(db, storeId) : undefined,
    runs: want.has('runs') ? await loadRunsToday(db, storeId) : undefined,
  };
}

/** Which knowledge keys a Knowledge object actually carries — for the "why" panel. */
export function knowledgeKeys(k: Knowledge): string[] {
  return [
    ...Object.keys(k.brand),
    ...(k.signals ? ['signals'] : []), ...(k.ads ? ['ads'] : []), ...(k.posts ? ['posts'] : []),
    ...(k.competitors ? ['competitors'] : []), ...(k.runs ? ['runs'] : []),
  ];
}

/* ---------- rendering knowledge as text the model (and a human) can read ---------- */

export function renderSignals(signals: ProductSignal[]): string {
  return signals.map((s) => {
    const sizes = Object.entries(s.stock_by_size).map(([z, q]) => `${z}:${q}`).join(' ');
    const set = s.set_price ? ` · เซ็ต ${s.set_price.qty} ตัว ${s.set_price.price}` : '';
    return `- ${s.name} (${s.category ?? '-'}) ราคา ${s.base_price ?? '-'}${set} · ขาย 7 วัน ${s.sales_7d} (${s.trend_pct === null ? '—' : (s.trend_pct >= 0 ? '+' : '') + s.trend_pct + '%'}) · สต็อก ${s.stock_total} [${sizes}] · ${s.promotable ? 'โฆษณาได้' : 'ห้ามโฆษณา: ' + s.note}${s.overstock ? ' · เหลือเยอะ' : ''}`;
  }).join('\n');
}

export function renderAds(ads: AdRow[]): string {
  return ads.map((a) => {
    const spend = Number(a.spend), rev = Number(a.revenue);
    const roas = spend > 0 ? (rev / spend).toFixed(1) : '—';
    const cpc = a.conversations ? Math.round(spend / a.conversations) : '—';
    return `- ${a.ad_name} · ใช้ไป ฿${Math.round(spend).toLocaleString('th-TH')} · ทักแชท ${a.conversations} (฿${cpc}/ทัก) · ซื้อ ${a.purchases} · ROAS ${roas}x · ${a.first_date}→${a.last_date}`;
  }).join('\n');
}

export function renderPosts(posts: PostRow[]): string {
  return posts.map((p) => `- [${String(p.created_time).slice(0, 10)} reach ${p.reach ?? 0} engaged ${p.engaged ?? 0}] ${(p.message ?? '').replace(/\s+/g, ' ').slice(0, 140)}`).join('\n');
}

export function renderCompetitors(rows: CompetitorAd[]): string {
  return rows.map((c) => `- [${c.page_name} · ${c.first_seen} · ${c.format ?? '-'} · มุม ${c.hook ?? '-'}${c.price_hint ? ` · ราคา ${c.price_hint}` : ''}] ${c.ad_text}`).join('\n');
}

export function renderRuns(runs: RunRow[]): string {
  return runs.length ? runs.map((r) => `- ${String(r.started_at).slice(11, 16)} ${r.emoji ?? ''} ${r.name}: ${r.summary}${r.status !== 'ok' ? ` (${r.status})` : ''}`).join('\n') : '- วันนี้ยังไม่มีกล่องไหนรัน';
}
