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

  async setStatus(id: string, status: 'ACTIVE' | 'PAUSED'): Promise<void> {
    await this.post(id, { status });
  }

  /**
   * What a deep copy of the campaign would copy: its ad sets + ads. Meta copies at most 3 such objects in one
   * synchronous call ("Invalid parameter" otherwise), so 1 ad set + 3 ads is already too many.
   */
  async copyObjectCount(campaignId: string): Promise<{ adsets: number; ads: number }> {
    const [s, a] = await Promise.all([
      this.get(`${campaignId}/adsets`, { fields: 'id', limit: '10' }),
      this.get(`${campaignId}/ads`, { fields: 'id', limit: '10' }),
    ]);
    return { adsets: (s.data ?? []).length, ads: (a.data ?? []).length };
  }

  /**
   * Deep copy of a campaign (ad sets + ads), everything PAUSED so the caller can set the budget before anything
   * spends; returns the new campaign id and the ids of every copied ad set and ad (to switch on afterwards).
   */
  async copyCampaign(campaignId: string, suffix: string): Promise<{ id: string; children: string[] }> {
    const b = await this.post(`${campaignId}/copies`, {
      deep_copy: 'true',
      status_option: 'PAUSED',
      rename_options: JSON.stringify({ rename_strategy: 'ONLY_TOP_LEVEL_RENAME', rename_suffix: suffix }),
    });
    if (!b.copied_campaign_id) throw new Error('Meta ไม่ได้ส่ง id แคมเปญใหม่กลับมา');
    const children = (b.ad_object_ids ?? []).filter((o: any) => o.ad_object_type === 'ad_set' || o.ad_object_type === 'ad').map((o: any) => String(o.copied_id));
    return { id: String(b.copied_campaign_id), children };
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
