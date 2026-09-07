/**
 * Facebook connector (Project 1 = READ ONLY).
 *
 * Pulls page profile, recent posts + insights, and ad insights through the
 * Graph API, lands every response in raw_event, then normalizes into facts.
 *
 * Required env (or a secret manager that maps token_ref → value):
 *   FB_PAGE_ID, FB_PAGE_TOKEN           page profile + posts (pages_read_engagement, read_insights)
 *   FB_AD_ACCOUNT_ID, FB_ADS_TOKEN      ad insights (ads_read)  — FB_ADS_TOKEN defaults to FB_PAGE_TOKEN
 *
 * Nothing here posts, edits, or spends.
 */
import type { Db } from '../db/client.js';

export const GRAPH = 'https://graph.facebook.com/v21.0';

export interface GraphClient {
  get<T = unknown>(path: string, params: Record<string, string>): Promise<T>;
}

export function makeGraphClient(token: string, fetchImpl: typeof fetch = fetch): GraphClient {
  return {
    async get(path, params) {
      const url = new URL(`${GRAPH}/${path.replace(/^\//, '')}`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      url.searchParams.set('access_token', token);
      const res = await fetchImpl(url);
      const body = (await res.json()) as { error?: { message: string; code: number } };
      if (!res.ok || body.error) throw new Error(`Graph API ${path}: ${body.error?.message ?? res.status} (code ${body.error?.code ?? res.status})`);
      return body as never;
    },
  };
}

/* ---------- raw shapes we expect back (only the fields we use) ---------- */
export interface RawPage { id: string; name: string; followers_count?: number; fan_count?: number; category?: string; about?: string }
export interface RawPost {
  id: string; message?: string; created_time: string; permalink_url?: string;
  shares?: { count: number };
  comments?: { summary?: { total_count: number } };
  reactions?: { summary?: { total_count: number } };
  insights?: { data: { name: string; values: { value: number | Record<string, number> }[] }[] };
}
export interface RawAdInsight {
  ad_id: string; ad_name?: string; campaign_name?: string; date_start: string;
  impressions?: string; reach?: string; clicks?: string; spend?: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
}

/* ---------- pure normalizers (unit-tested) ---------- */
export function normalizePage(storeId: string, date: string, p: RawPage) {
  return { store_id: storeId, channel: 'facebook', date, followers: p.followers_count ?? null, fans: p.fan_count ?? null, raw: p };
}

export function normalizePost(storeId: string, date: string, p: RawPost) {
  const metric = (name: string) => {
    const m = p.insights?.data.find((d) => d.name === name);
    const v = m?.values?.[0]?.value;
    return typeof v === 'number' ? v : null;
  };
  return {
    store_id: storeId, channel: 'facebook', external_post_id: p.id, date,
    created_time: p.created_time, message: p.message ?? null, permalink: p.permalink_url ?? null,
    reach: metric('post_impressions_unique'),
    engaged: metric('post_engaged_users'),
    clicks: metric('post_clicks'),
    comments: p.comments?.summary?.total_count ?? null,
    shares: p.shares?.count ?? null,
    reactions: p.reactions?.summary?.total_count ?? null,
    raw: p,
  };
}

const CONVERSATION_ACTIONS = ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.total_messaging_connection'];
const PURCHASE_ACTIONS = ['purchase', 'omni_purchase', 'onsite_conversion.purchase', 'offsite_conversion.fb_pixel_purchase'];

export function normalizeAdInsight(storeId: string, r: RawAdInsight) {
  const sum = (list: { action_type: string; value: string }[] | undefined, types: string[]) =>
    (list ?? []).filter((a) => types.includes(a.action_type)).reduce((s, a) => s + Number(a.value || 0), 0);
  return {
    store_id: storeId, channel: 'facebook', external_ad_id: r.ad_id, ad_name: r.ad_name ?? null, campaign_name: r.campaign_name ?? null,
    date: r.date_start,
    impressions: Number(r.impressions ?? 0), reach: Number(r.reach ?? 0), clicks: Number(r.clicks ?? 0), spend: Number(r.spend ?? 0),
    conversations: sum(r.actions, CONVERSATION_ACTIONS),
    purchases: sum(r.actions, PURCHASE_ACTIONS),
    revenue: sum(r.action_values, PURCHASE_ACTIONS),
    raw: r,
  };
}

/* ---------- sync (network + db) ---------- */
export interface FacebookSyncOptions {
  storeId: string;
  pageId?: string;
  pageToken?: string;
  adAccountId?: string;
  adsToken?: string;
  datePreset?: string;   // last_7d | last_30d ...
  postLimit?: number;
  fetchImpl?: typeof fetch;
  today?: string;
}

export async function syncFacebook(db: Db, o: FacebookSyncOptions) {
  const today = o.today ?? new Date().toISOString().slice(0, 10);
  const out = { page: false, posts: 0, ads: 0, errors: [] as string[] };
  const land = (kind: string, payload: unknown) =>
    db.query('insert into raw_event(store_id, source, kind, payload) values ($1,$2,$3,$4)', [o.storeId, 'facebook', kind, JSON.stringify(payload)]);

  if (o.pageId && o.pageToken) {
    const g = makeGraphClient(o.pageToken, o.fetchImpl);
    try {
      const page = await g.get<RawPage>(o.pageId, { fields: 'id,name,followers_count,fan_count,category,about' });
      await land('page', page);
      const n = normalizePage(o.storeId, today, page);
      await db.query(
        `insert into page_snapshot(store_id, channel, date, followers, fans, raw) values ($1,$2,$3,$4,$5,$6)
         on conflict (store_id, channel, date) do update set followers=excluded.followers, fans=excluded.fans, raw=excluded.raw`,
        [n.store_id, n.channel, n.date, n.followers, n.fans, JSON.stringify(n.raw)],
      );
      out.page = true;
    } catch (e) { out.errors.push((e as Error).message); }

    try {
      const posts = await g.get<{ data: RawPost[] }>(`${o.pageId}/posts`, {
        limit: String(o.postLimit ?? 25),
        fields: 'id,message,created_time,permalink_url,shares,comments.summary(true).limit(0),reactions.summary(true).limit(0),insights.metric(post_impressions_unique,post_engaged_users,post_clicks)',
      });
      await land('posts', posts);
      for (const p of posts.data ?? []) {
        const n = normalizePost(o.storeId, today, p);
        await db.query(
          `insert into fact_post_insight_daily(store_id, channel, external_post_id, date, created_time, message, permalink, reach, engaged, clicks, comments, shares, reactions, raw)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           on conflict (channel, external_post_id, date) do update set reach=excluded.reach, engaged=excluded.engaged, clicks=excluded.clicks, comments=excluded.comments, shares=excluded.shares, reactions=excluded.reactions, raw=excluded.raw`,
          [n.store_id, n.channel, n.external_post_id, n.date, n.created_time, n.message, n.permalink, n.reach, n.engaged, n.clicks, n.comments, n.shares, n.reactions, JSON.stringify(n.raw)],
        );
        out.posts++;
      }
    } catch (e) { out.errors.push((e as Error).message); }
  }

  const adsToken = o.adsToken ?? o.pageToken;
  if (o.adAccountId && adsToken) {
    const g = makeGraphClient(adsToken, o.fetchImpl);
    try {
      const acct = o.adAccountId.startsWith('act_') ? o.adAccountId : `act_${o.adAccountId}`;
      const res = await g.get<{ data: RawAdInsight[] }>(`${acct}/insights`, {
        level: 'ad', time_increment: '1', date_preset: o.datePreset ?? 'last_7d', limit: '500',
        fields: 'ad_id,ad_name,campaign_name,impressions,reach,clicks,spend,actions,action_values',
      });
      await land('ad_insights', res);
      for (const r of res.data ?? []) {
        const n = normalizeAdInsight(o.storeId, r);
        await db.query(
          `insert into fact_ad_insight_daily(store_id, channel, external_ad_id, ad_name, campaign_name, date, impressions, reach, clicks, spend, conversations, purchases, revenue, raw)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           on conflict (channel, external_ad_id, date) do update set impressions=excluded.impressions, reach=excluded.reach, clicks=excluded.clicks, spend=excluded.spend, conversations=excluded.conversations, purchases=excluded.purchases, revenue=excluded.revenue, raw=excluded.raw`,
          [n.store_id, n.channel, n.external_ad_id, n.ad_name, n.campaign_name, n.date, n.impressions, n.reach, n.clicks, n.spend, n.conversations, n.purchases, n.revenue, JSON.stringify(n.raw)],
        );
        out.ads++;
      }
    } catch (e) { out.errors.push((e as Error).message); }
  }

  await db.query(
    `update connection set last_sync_at=now(), status=$3, last_error=$4 where store_id=$1 and channel=$2`,
    [o.storeId, 'facebook', out.errors.length ? 'error' : 'connected', out.errors.join(' | ') || null],
  );
  await db.query(`insert into audit_log(store_id, actor, actor_type, action, after) values ($1,'facebook-sync','automation','connector.sync',$2)`, [o.storeId, JSON.stringify(out)]);
  return out;
}

export function facebookOptionsFromEnv(storeId: string): FacebookSyncOptions {
  return {
    storeId,
    pageId: process.env.FB_PAGE_ID,
    pageToken: process.env.FB_PAGE_TOKEN,
    adAccountId: process.env.FB_AD_ACCOUNT_ID,
    adsToken: process.env.FB_ADS_TOKEN,
    datePreset: process.env.FB_DATE_PRESET ?? 'last_7d',
  };
}
