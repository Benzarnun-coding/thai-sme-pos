// Thin client for the Meta Marketing API. No SDK, just fetch.

import type { Entity, Level, Metrics, Window } from './types.ts';

const DEFAULT_API_VERSION = 'v21.0';

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
      throw new Error(`Meta GET ${path}: ${body?.error?.message ?? res.statusText}`);
    }
    return body as T;
  }

  private async post(path: string, params: Record<string, string>): Promise<any> {
    const form = new URLSearchParams({ ...params, access_token: this.token });
    const res = await fetch(`${this.api}/${path}`, { method: 'POST', body: form });
    const body: any = await res.json();
    if (!res.ok || body.error) {
      throw new Error(`Meta POST ${path}: ${body?.error?.message ?? res.statusText}`);
    }
    return body;
  }

  /** Page through an edge until Meta stops returning a `next` cursor. */
  private async getAll(path: string, params: Record<string, string>): Promise<any[]> {
    const out: any[] = [];
    let after: string | undefined;
    for (let i = 0; i < 50; i++) {
      const body = await this.get(path, { ...params, limit: '200', ...(after ? { after } : {}) });
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
      date_preset: WINDOW_TO_PRESET[window],
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

  async setStatus(id: string, status: 'ACTIVE' | 'PAUSED'): Promise<void> {
    await this.post(id, { status });
  }

  /** amount in account currency; Meta wants minor units */
  async setDailyBudget(id: string, amount: number): Promise<void> {
    await this.post(id, { daily_budget: String(Math.round(amount * 100)) });
  }
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
