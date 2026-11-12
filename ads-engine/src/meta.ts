// Thin client for the Meta Marketing API. No SDK, just fetch.

import type { Entity, Level, Metrics, Window } from './types.ts';

const DEFAULT_API_VERSION = 'v21.0';

/** Purchases one campaign got in one hour */
export interface HourlyConversion {
  campaign_id: string;
  hour: string; // "08:00"
  purchases: number;
  purchase_value: number;
}

/** One day of one campaign, from the account-wide daily breakdown */
export interface CampaignDayRow extends DailyRow {
  campaign_id: string;
}

/** One day of one campaign, for trend charts */
export interface DailyRow {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchase_value: number;
}

/**
 * Meta's period parameter for a window: a preset (last_7d, yesterday, ...) or a custom date range written as
 * "range:YYYY-MM-DD:YYYY-MM-DD" (Bangkok dates, inclusive), as Ads Manager's date picker does.
 */
export function periodParams(window: string): Record<string, string> {
  const m = /^range:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(window);
  return m ? { time_range: JSON.stringify({ since: m[1], until: m[2] }) } : { date_preset: WINDOW_TO_PRESET[window as Window] };
}

const WINDOW_TO_PRESET: Record<Window, string> = {
  today: 'today',
  yesterday: 'yesterday',
  last_3d: 'last_3d',
  last_7d: 'last_7d',
  last_14d: 'last_14d',
  last_30d: 'last_30d',
};

export class MetaClient {
  private token: string;
  private accountId: string;
  private api: string;

  /** apiVersion: Meta retires Graph API versions ~2 years after release, so keep it configurable. */
  constructor(token: string, accountId: string, apiVersion = DEFAULT_API_VERSION) {
    this.token = token;
    this.accountId = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
    this.api = `https://graph.facebook.com/${apiVersion}`;
  }

  private async get<T = any>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.api}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('access_token', this.token);
    const res = await fetch(url);
    const body: any = await res.json();
    if (!res.ok || body.error) {
      throw new Error(`Meta GET ${path}: ${metaError(body) || res.statusText}`);
    }
    return body as T;
  }

  private async post(path: string, params: Record<string, string>): Promise<any> {
    const form = new URLSearchParams({ ...params, access_token: this.token });
    const res = await fetch(`${this.api}/${path}`, { method: 'POST', body: form });
    const body: any = await res.json();
    if (!res.ok || body.error) {
      throw new Error(`Meta POST ${path}: ${metaError(body) || res.statusText}`);
    }
    return body;
  }

  /** Page through an edge until Meta stops returning a `next` cursor. */
  private async getAll(path: string, params: Record<string, string>): Promise<any[]> {
    const out: any[] = [];
    let after: string | undefined;
    for (let i = 0; i < 50; i++) {
      const body = await this.get(path, { ...params, limit: '500', ...(after ? { after } : {}) });
      out.push(...(body.data ?? []));
      after = body.paging?.cursors?.after;
      if (!body.paging?.next || !after) break;
    }
    return out;
  }

  async accountName(): Promise<string> {
    const b = await this.get(this.accountId, { fields: 'name,currency' });
    return `${b.name} (${b.currency})`;
  }

  /** Campaigns and ad sets that are not deleted/archived, with their own daily budget when they hold one. */
  async listEntities(): Promise<Entity[]> {
    const [campaigns, adsets] = await Promise.all([
      this.getAll(`${this.accountId}/campaigns`, {
        fields: 'id,name,status,daily_budget,lifetime_budget',
        effective_status: JSON.stringify(['ACTIVE', 'PAUSED']),
      }),
      this.getAll(`${this.accountId}/adsets`, {
        fields: 'id,name,status,daily_budget,lifetime_budget,campaign_id',
        effective_status: JSON.stringify(['ACTIVE', 'PAUSED']),
      }),
    ]);
    const campaignName = new Map(campaigns.map((c: any) => [c.id, c.name as string]));

    const toBudget = (v?: string) => (v && Number(v) > 0 ? Number(v) / 100 : null);

    const entities: Entity[] = campaigns.map((c: any) => ({
      level: 'campaign' as Level,
      id: c.id,
      name: c.name,
      campaign_id: c.id,
      campaign_name: c.name,
      status: c.status,
      daily_budget: toBudget(c.daily_budget),
      metrics: {},
    }));
    for (const a of adsets) {
      entities.push({
        level: 'adset',
        id: a.id,
        name: a.name,
        campaign_id: a.campaign_id,
        campaign_name: campaignName.get(a.campaign_id) ?? '',
        status: a.status,
        daily_budget: toBudget(a.daily_budget),
        metrics: {},
      });
    }
    return entities;
  }

  /** One insights call per level per window; returns a map of entity id → metrics. */
  async insights(level: Level, window: Window): Promise<Map<string, Metrics>> {
    const rows = await this.getAll(`${this.accountId}/insights`, {
      level,
      ...periodParams(window),
      fields: `${level}_id,spend,impressions,clicks,ctr,cpc,frequency,actions,action_values`,
    });
    const out = new Map<string, Metrics>();
    for (const r of rows) {
      const spend = num(r.spend);
      const purchases = sumPurchases(r.actions);
      const purchase_value = sumPurchases(r.action_values);
      const messages = sumMessages(r.actions);
      out.set(r[`${level}_id`], {
        spend,
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        ctr: num(r.ctr),
        cpc: num(r.cpc),
        frequency: num(r.frequency),
        purchases,
        purchase_value,
        cpa: purchases > 0 ? spend / purchases : Infinity,
        roas: spend > 0 ? purchase_value / spend : 0,
        messages,
        cost_per_message: messages > 0 ? spend / messages : Infinity,
      });
    }
    return out;
  }

  /** Day-by-day numbers for one campaign (one call). */
  async dailyInsights(campaignId: string, window: Window): Promise<DailyRow[]> {
    const rows = await this.getAll(`${campaignId}/insights`, {
      ...periodParams(window),
      time_increment: '1',
      fields: 'spend,impressions,clicks,actions,action_values',
    });
    return rows.map((r) => ({
      date: r.date_start,
      spend: num(r.spend),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      purchases: sumPurchases(r.actions),
      purchase_value: sumPurchases(r.action_values),
    }));
  }

  /** Every campaign, one row per day, in one paged call (for the daily sales report). */
  async dailyCampaignInsights(window: Window): Promise<CampaignDayRow[]> {
    const rows = await this.getAll(`${this.accountId}/insights`, {
      level: 'campaign',
      ...periodParams(window),
      time_increment: '1',
      fields: 'campaign_id,spend,impressions,clicks,actions,action_values',
    });
    return rows.map((r) => ({
      campaign_id: r.campaign_id,
      date: r.date_start,
      spend: num(r.spend),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      purchases: sumPurchases(r.actions),
      purchase_value: sumPurchases(r.action_values),
    }));
  }

  /** One day, every campaign, by hour of the ad account's time zone — only hours with purchases. */
  async hourlyConversions(date: string): Promise<HourlyConversion[]> {
    const rows = await this.getAll(`${this.accountId}/insights`, {
      level: 'campaign',
      breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
      time_range: JSON.stringify({ since: date, until: date }),
      fields: 'campaign_id,actions,action_values',
    });
    return rows
      .map((r) => ({
        campaign_id: r.campaign_id,
        hour: String(r.hourly_stats_aggregated_by_advertiser_time_zone ?? '').slice(0, 5),
        purchases: sumPurchases(r.actions),
        purchase_value: sumPurchases(r.action_values),
      }))
      .filter((r) => r.purchases > 0 || r.purchase_value > 0);
  }

  /**
   * Every switched-on ad with its post: caption + full picture, and the ad's own last-14-day Meta numbers. Read only.
   * Ads of this shop run page posts ("โพสผี"), whose text lives on the post, not on the creative, so posts are read
   * in groups of 50 (`?ids=`); a post the token can't read falls back to the creative's own text and thumbnail.
   */
  async activeAdPosts(): Promise<{ ads: ActiveAdPost[]; post_error: string | null }> {
    const ads = await this.getAll(`${this.accountId}/ads`, {
      fields: 'id,name,campaign_id,campaign{name},adset_id,creative{id,body,title,image_url,thumbnail_url,effective_object_story_id,object_story_spec}',
      effective_status: JSON.stringify(['ACTIVE']),
    });
    const storyIds = [...new Set(ads.map((a: any) => a.creative?.effective_object_story_id).filter(Boolean))] as string[];
    const posts = new Map<string, { message?: string; full_picture?: string; permalink_url?: string }>();
    let post_error: string | null = null;
    for (let i = 0; i < storyIds.length; i += 50) {
      const b = await this.get<Record<string, any>>('', { ids: storyIds.slice(i, i + 50).join(','), fields: 'message,full_picture,permalink_url' })
        .catch((err) => { post_error = String(err?.message ?? err); return {}; });
      for (const [id, p] of Object.entries(b)) posts.set(id, p as any);
    }
    // Posts the token can't read: the creative's own thumbnail, asked for at full size (the default is 64 px).
    const missing = [...new Set(ads.filter((a: any) => !posts.get(a.creative?.effective_object_story_id)?.full_picture).map((a: any) => a.creative?.id).filter(Boolean))] as string[];
    const thumbs = new Map<string, string>();
    for (let i = 0; i < missing.length; i += 50) {
      const b = await this.get<Record<string, any>>('', { ids: missing.slice(i, i + 50).join(','), fields: 'thumbnail_url,image_url', thumbnail_width: '1080', thumbnail_height: '1080' }).catch(() => ({}));
      for (const [id, c] of Object.entries(b)) { const u = (c as any).image_url || (c as any).thumbnail_url; if (u) thumbs.set(id, u); }
    }
    const stats = new Map<string, { spend: number; impressions: number; purchases: number; purchase_value: number; messages: number }>();
    const rows = await this.getAll(`${this.accountId}/insights`, { level: 'ad', date_preset: 'last_14d', fields: 'ad_id,spend,impressions,actions,action_values' }).catch(() => []);
    for (const r of rows) stats.set(String(r.ad_id), { spend: num(r.spend), impressions: num(r.impressions), purchases: sumPurchases(r.actions), purchase_value: sumPurchases(r.action_values), messages: sumMessages(r.actions) });
    return { post_error, ads: ads.map((a: any) => {
      const c = a.creative ?? {}, story = c.effective_object_story_id as string | undefined, post = story ? posts.get(story) : undefined;
      const link = c.object_story_spec?.link_data ?? c.object_story_spec?.photo_data ?? c.object_story_spec?.video_data ?? {};
      return {
        ad_id: String(a.id), ad_name: a.name ?? '', campaign_id: String(a.campaign_id ?? ''), campaign_name: a.campaign?.name ?? '', adset_id: String(a.adset_id ?? ''),
        story_id: story ?? null, creative_id: c.id ? String(c.id) : null,
        message: post?.message ?? c.body ?? link.message ?? '', image_url: post?.full_picture ?? thumbs.get(String(c.id)) ?? c.image_url ?? link.picture ?? link.image_url ?? c.thumbnail_url ?? null,
        permalink: post?.permalink_url ?? null, post_read: !!post,
        stats: stats.get(String(a.id)) ?? { spend: 0, impressions: 0, purchases: 0, purchase_value: 0, messages: 0 },
      };
    }) };
  }

  async setStatus(id: string, status: 'ACTIVE' | 'PAUSED'): Promise<void> {
    await this.post(id, { status });
  }

  /** The campaign's switched-on ad sets and ads: what copyCampaign copies. */
  async copyObjects(campaignId: string): Promise<{ adsets: string[]; ads: { id: string; adset_id: string }[] }> {
    const [s, a] = await Promise.all([
      this.getAll(`${campaignId}/adsets`, { fields: 'id,status', limit: '50' }),
      this.getAll(`${campaignId}/ads`, { fields: 'id,status,adset_id', limit: '100' }),
    ]);
    const adsets = s.filter((x: any) => x.status === 'ACTIVE').map((x: any) => String(x.id));
    const ads = a.filter((x: any) => x.status === 'ACTIVE' && adsets.includes(String(x.adset_id))).map((x: any) => ({ id: String(x.id), adset_id: String(x.adset_id) }));
    return { adsets, ads };
  }

  /**
   * Copy of a campaign with its switched-on ad sets and ads, everything PAUSED so the caller can set the budget before
   * anything spends; returns the new campaign id and the ids of every copied ad set and ad (to switch on afterwards).
   * Copied one object at a time: Meta's one-call deep copy takes at most 3 objects and answers "Invalid parameter"
   * above that (22 Oct 2026, the 801 campaign).
   */
  async copyCampaign(campaignId: string, suffix: string): Promise<{ id: string; children: string[] }> {
    const { adsets, ads } = await this.copyObjects(campaignId);
    const c = await this.post(`${campaignId}/copies`, {
      deep_copy: 'false',
      status_option: 'PAUSED',
      rename_options: JSON.stringify({ rename_strategy: 'ONLY_TOP_LEVEL_RENAME', rename_suffix: suffix }),
    });
    if (!c.copied_campaign_id) throw new Error('Meta ไม่ได้ส่ง id แคมเปญใหม่กลับมา');
    const id = String(c.copied_campaign_id);
    const children: string[] = [];
    for (const adset of adsets) {
      const s = await this.post(`${adset}/copies`, { campaign_id: id, deep_copy: 'false', status_option: 'PAUSED' });
      if (!s.copied_adset_id) throw new Error(`Meta ไม่ได้ส่ง id ชุดโฆษณาใหม่กลับมา (แคมเปญใหม่ ${id})`);
      children.push(String(s.copied_adset_id));
      for (const ad of ads.filter((x) => x.adset_id === adset)) {
        const n = await this.post(`${ad.id}/copies`, { adset_id: String(s.copied_adset_id), status_option: 'PAUSED' });
        if (!n.copied_ad_id) throw new Error(`Meta ไม่ได้ส่ง id โฆษณาใหม่กลับมา (แคมเปญใหม่ ${id})`);
        children.push(String(n.copied_ad_id));
      }
    }
    return { id, children };
  }

  // ---- new ads from the training room (ads-web/worker/grokAds.ts, Benz 2026-11-09) ----

  /** A running ad's creative spec, ad set and campaign: the template a "(Grok)" ad is built from. */
  async adTemplate(adId: string): Promise<{ name: string; adset_id: string; campaign_id: string; spec: any | null }> {
    const a = await this.get(adId, { fields: 'name,adset_id,campaign_id,creative{object_story_spec}' });
    return { name: String(a.name ?? ''), adset_id: String(a.adset_id), campaign_id: String(a.campaign_id), spec: a.creative?.object_story_spec ?? null };
  }

  /** Copy of a campaign with only one of its ad sets and no ads, PAUSED, renamed with the suffix. */
  async copyCampaignShell(campaignId: string, adsetId: string, suffix: string): Promise<{ campaign_id: string; adset_id: string }> {
    const c = await this.post(`${campaignId}/copies`, {
      deep_copy: 'false', status_option: 'PAUSED',
      rename_options: JSON.stringify({ rename_strategy: 'ONLY_TOP_LEVEL_RENAME', rename_suffix: suffix }),
    });
    if (!c.copied_campaign_id) throw new Error('Meta ไม่ได้ส่ง id แคมเปญใหม่กลับมา');
    const s = await this.post(`${adsetId}/copies`, { campaign_id: String(c.copied_campaign_id), deep_copy: 'false', status_option: 'PAUSED' });
    if (!s.copied_adset_id) throw new Error(`Meta ไม่ได้ส่ง id ชุดโฆษณาใหม่กลับมา (แคมเปญใหม่ ${c.copied_campaign_id})`);
    return { campaign_id: String(c.copied_campaign_id), adset_id: String(s.copied_adset_id) };
  }

  /** Copy of the campaign object alone (no ad sets), PAUSED, renamed with the suffix. */
  async copyCampaignOnly(campaignId: string, suffix: string): Promise<string> {
    const c = await this.post(`${campaignId}/copies`, {
      deep_copy: 'false', status_option: 'PAUSED',
      rename_options: JSON.stringify({ rename_strategy: 'ONLY_TOP_LEVEL_RENAME', rename_suffix: suffix }),
    });
    if (!c.copied_campaign_id) throw new Error('Meta ไม่ได้ส่ง id แคมเปญใหม่กลับมา');
    return String(c.copied_campaign_id);
  }

  /** true when the campaign carries the budget (CBO). */
  async campaignHasBudget(campaignId: string): Promise<boolean> {
    const c = await this.get(campaignId, { fields: 'daily_budget,lifetime_budget' });
    return Number(c.daily_budget ?? 0) > 0 || Number(c.lifetime_budget ?? 0) > 0;
  }

  /**
   * A new ad set in `campaignId` with the template ad set's settings (targeting, optimisation, bidding, promoted
   * object, destination), PAUSED. Built instead of copied: Meta refuses to copy ad sets that still carry fields it
   * removed (2026-11-09: "The targeting_optimization field has been removed"), so those are dropped here.
   */
  async createAdsetFrom(templateAdsetId: string, campaignId: string, name: string, dailyBudget: number | null): Promise<string> {
    const t = await this.get(templateAdsetId, { fields: 'optimization_goal,billing_event,bid_strategy,bid_amount,targeting,promoted_object,destination_type' });
    const targeting = { ...(t.targeting ?? {}) };
    for (const k of ['targeting_optimization', 'targeting_automation', 'targeting_relaxation_types']) delete (targeting as any)[k];
    const params: Record<string, string> = { campaign_id: campaignId, name, status: 'PAUSED', targeting: JSON.stringify(targeting) };
    for (const k of ['optimization_goal', 'billing_event', 'bid_strategy', 'destination_type']) if (t[k]) params[k] = String(t[k]);
    if (t.bid_amount) params.bid_amount = String(t.bid_amount);
    if (t.promoted_object) params.promoted_object = JSON.stringify(t.promoted_object);
    // attribution_spec is left out: Meta refuses the template's windows for new ad sets of this objective
    // (2026-11-09: "use one of these supported windows: 1 days") and the default is what it accepts.
    if (dailyBudget !== null) params.daily_budget = String(Math.round(dailyBudget * 100));
    const r = await this.post(`${this.accountId}/adsets`, params);
    if (!r.id) throw new Error('Meta ไม่ได้ส่ง id ชุดโฆษณาใหม่กลับมา');
    return String(r.id);
  }

  /** Paused campaigns named "… (Grok)" with no ad set: what a half-made "(Grok)" launch leaves behind. */
  async emptyGrokCampaigns(): Promise<{ id: string; name: string }[]> {
    const rows = await this.getAll(`${this.accountId}/campaigns`, {
      fields: 'id,name,effective_status,adsets.limit(1){id}',
      filtering: JSON.stringify([{ field: 'name', operator: 'CONTAIN', value: '(Grok)' }]),
    });
    return rows.filter((c: any) => /\(Grok\)\s*$/.test(String(c.name)) && c.effective_status === 'PAUSED' && !(c.adsets?.data ?? []).length)
      .map((c: any) => ({ id: String(c.id), name: String(c.name) }));
  }

  /** Switched-on campaigns whose name starts with "Grok" or ends with "(Grok)", with Meta's created_time. */
  async grokCampaigns(): Promise<{ id: string; name: string; created_time: string }[]> {
    const rows = await this.getAll(`${this.accountId}/campaigns`, {
      fields: 'id,name,effective_status,created_time',
      filtering: JSON.stringify([{ field: 'name', operator: 'CONTAIN', value: 'Grok' }]),
    });
    return rows.filter((c: any) => c.effective_status === 'ACTIVE' && (/^\s*Grok\b/i.test(String(c.name)) || /\(Grok\)\s*$/.test(String(c.name))))
      .map((c: any) => ({ id: String(c.id), name: String(c.name), created_time: String(c.created_time) }));
  }

  async deleteCampaign(id: string): Promise<void> {
    await this.post(id, { status: 'DELETED' });
  }

  /** Uploads a picture (base64) to the ad account's image library; returns its hash. */
  async uploadImage(base64: string): Promise<string> {
    const r = await this.post(`${this.accountId}/adimages`, { bytes: base64 });
    const hash = Object.values(r.images ?? {}).map((x: any) => x?.hash).find(Boolean);
    if (!hash) throw new Error('Meta ไม่ได้ส่ง hash ของภาพกลับมา');
    return String(hash);
  }

  async createCreative(name: string, spec: unknown): Promise<string> {
    const r = await this.post(`${this.accountId}/adcreatives`, { name, object_story_spec: JSON.stringify(spec) });
    if (!r.id) throw new Error('Meta ไม่ได้ส่ง id ครีเอทีฟกลับมา');
    return String(r.id);
  }

  async createAd(adsetId: string, name: string, creativeId: string, status: 'ACTIVE' | 'PAUSED'): Promise<string> {
    const r = await this.post(`${this.accountId}/ads`, { name, adset_id: adsetId, creative: JSON.stringify({ creative_id: creativeId }), status });
    if (!r.id) throw new Error('Meta ไม่ได้ส่ง id โฆษณากลับมา');
    return String(r.id);
  }

  async rename(id: string, name: string): Promise<void> {
    await this.post(id, { name });
  }

  /** amount in account currency; Meta wants minor units */
  async setDailyBudget(id: string, amount: number): Promise<void> {
    await this.post(id, { daily_budget: String(Math.round(amount * 100)) });
  }
}

/** Meta's "Invalid parameter" says little; the reason is in error_user_title/error_user_msg (and the subcode). */
function metaError(body: any): string {
  const e = body?.error;
  if (!e) return '';
  const extra = [e.error_user_title, e.error_user_msg].filter((x) => x && x !== e.message).join(': ');
  return [e.message, extra, e.error_subcode ? `(subcode ${e.error_subcode})` : ''].filter(Boolean).join(' — ');
}

export interface ActiveAdPost {
  ad_id: string; ad_name: string; campaign_id: string; campaign_name: string; adset_id: string;
  story_id: string | null; creative_id: string | null; message: string; image_url: string | null; permalink: string | null;
  /** false = the post itself couldn't be read; message/picture came from the creative */
  post_read: boolean;
  stats: { spend: number; impressions: number; purchases: number; purchase_value: number; messages: number };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

type ActionRow = { action_type: string; value: string };

/** Meta reports conversions as a list of {action_type, value}. We count purchases across pixel + on-site. */
function sumPurchases(list?: ActionRow[]): number {
  if (!list) return 0;
  const PURCHASE_TYPES = new Set(['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_conversion.purchase']);
  // omni_purchase already aggregates the others when present; prefer it to avoid double counting.
  const omni = list.find((a) => a.action_type === 'omni_purchase');
  if (omni) return num(omni.value);
  return list.filter((a) => PURCHASE_TYPES.has(a.action_type)).reduce((s, a) => s + num(a.value), 0);
}

/** "Messaging conversations started" — what Ads Manager shows for Messages-objective campaigns. */
function sumMessages(list?: ActionRow[]): number {
  if (!list) return 0;
  const row = list.find((a) => a.action_type === 'onsite_conversion.messaging_conversation_started_7d');
  return row ? num(row.value) : 0;
}
