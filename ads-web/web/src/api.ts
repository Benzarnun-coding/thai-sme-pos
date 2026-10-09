// Typed client for the Worker API. Types mirror worker/model.ts and ads-engine/src/types.ts (the UI never imports worker code).

export type Level = 'campaign' | 'adset';
export type Window = 'today' | 'yesterday' | 'last_3d' | 'last_7d' | 'last_14d' | 'last_30d';
export type Metric = 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'frequency' | 'purchases' | 'cpa' | 'roas' | 'messages' | 'cost_per_message';
export type Op = '>' | '>=' | '<' | '<=';
export type ActionType = 'pause' | 'enable' | 'budget_pct' | 'notify' | 'move';
export type Mode = 'stage' | 'custom' | 'off';

export interface Rule {
  id: string;
  description?: string;
  level: Level;
  window: Window;
  metric: Metric;
  op: Op;
  value: number;
  value_mode?: 'abs' | 'x_breakeven';
  min_spend?: number;
  min_purchases?: number;
  /** move rules only */
  min_days_in_stage?: number;
  action: { type: ActionType; pct?: number; to?: string };
  cooldown_hours?: number;
  enabled?: boolean;
}

export interface Product { tab: string; code: string }
export interface Tier { units: number; price: number }
export interface CostTier { units: number; price: number; cost: number }

export interface Section {
  id: string;
  name: string;
  keywords: string[];
  products: Product[];
  tiers: Tier[];
  units_per_order: number;
  extra_cost_per_order: number;
  price_per_order: number | null;
  sort: number;
}

export interface Stage {
  id: string;
  name: string;
  description: string;
  rules: Rule[];
  automation: boolean;
  sort: number;
}

export interface Metrics {
  spend: number; impressions: number; clicks: number; ctr: number; cpc: number; frequency: number;
  purchases: number; purchase_value: number; cpa: number | null; roas: number; messages: number; cost_per_message: number | null;
}

export interface Totals { spend: number; purchases: number; purchase_value: number; impressions: number; clicks: number }

export interface SectionView extends Section {
  totals: Totals;
  economics: {
    cost_per_unit: number | null; price_per_unit_min: number | null; price_per_unit_max: number | null;
    price_source: 'tiers' | 'manual' | 'sheet' | null;
    breakeven_roas: number | null; breakeven_best: number | null; never_profitable: boolean;
    units_low: number | null; units_high: number | null;
    /** Conservative (cheapest price per piece) — profit_high is the best case */
    profit: number | null; profit_high: number | null;
    missing_products: Product[];
  };
  campaign_count: number;
}

export interface EntityView { id: string; name: string; status: string; daily_budget: number | null; metrics?: Metrics }

export interface CampaignView extends EntityView {
  section_id: string;
  pinned: boolean;
  stage_id: string | null;
  stage_since: string | null;
  mode: Mode;
  rules: Rule[] | null;
  /** Of its product line (7-day), null when no cost is linked */
  breakeven_roas: number | null;
  /** sheet = per-campaign promo costs from the team's sheet; product = the product line's cost */
  cost_source: 'sheet' | 'product' | null;
  cost_tiers: CostTier[] | null;
  /** Sheet block used, by exact name or the same name with another budget/version */
  cost_sheet_name: string | null;
  cost_match: 'exact' | 'similar' | null;
  /** Promo mix solved exactly (two promos) — profit is one number, not a range */
  cost_exact: boolean;
  /** orders = costed order by order from hourly purchases; estimate = from daily totals */
  cost_method?: 'orders' | 'estimate';
  tx?: { match_rate: number; orders: number; matched: number; days: number; window_days: number } | null;
  /** Promo prices read from the campaign name, e.g. 1 for 189, 3 for 549 */
  name_tiers: Tier[];
  /** Selling price per piece this campaign is costed with; null = no price anywhere */
  price_per_unit_min: number | null;
  price_per_unit_max: number | null;
  /** After product cost and ad spend over the window, conservative (most pieces at the cheapest promo price) */
  profit: number | null;
  profit_high: number | null;
  /** Estimated pieces sold (order value ÷ price per piece) */
  units_low: number | null;
  units_high: number | null;
  adsets: EntityView[];
}

export interface Guardrails { max_change_pct_per_run: number; min_daily_budget: number; max_daily_budget: number; max_total_daily_budget: number }

export interface Overview {
  account: string;
  window: Window;
  /** Claude-pulled snapshot: read-only, only these windows have data */
  snapshot: { taken_at: string; windows: Window[] } | null;
  /** When this Meta data was fetched (the server reuses it for a few minutes) */
  meta_fetched_at: string;
  /** Meta refused (e.g. rate limit) and older data is shown */
  meta_warning: string | null;
  settings: { dry_run: boolean; kill_switch: boolean; guardrails: Guardrails; cod_share_pct: number; cod_fee: number };
  costs_loaded: number;
  last_run: { run_at: string; summary: string; dry_run: boolean } | null;
  stages: Stage[];
  sections: SectionView[];
  campaigns: CampaignView[];
}

export interface Settings { dry_run: boolean; kill_switch: boolean; guardrails: Guardrails; sheet_id: string; sheet_tabs: string[]; cod_share_pct: number; cod_fee: number; ads_cost_sheet_id: string; ads_cost_tab: string; cost_editors: string[] }

export interface CostRow { tab: string; code: string; name: string; sku_count: number; avg_cost: number; min_cost: number; max_cost: number; avg_price: number }

export interface Decision {
  rule_id: string;
  group?: string;
  entity: { level: Level; id: string; name: string; campaign_name: string };
  window: Window; metric: Metric; observed: number | null; threshold: number;
  action: { type: ActionType; pct?: number };
  plan: string; applied?: boolean; skipped_reason?: string; error?: string;
  before?: { status?: string; daily_budget?: number | null };
  after?: { status?: string; daily_budget?: number | null };
}

export interface MoveDecision extends Decision { move_from: string | null; move_to: string }

export interface RunReport {
  run_at: string; dry_run: boolean; entities_evaluated: number; decisions: Decision[]; moves?: MoveDecision[];
  totals: { daily_budget_before: number; daily_budget_after: number }; errors: string[]; notes: string[];
}

export interface RunRow { id: number; run_at: string; trigger: string; dry_run: boolean; summary: string; report: RunReport }
export interface AuditRow { id: number; at: string; actor: string; action: string; target: string; detail: string }

export type IdeaAction =
  | { type: 'move'; to: string }
  | { type: 'budget_pct'; pct: number }
  | { type: 'pause' }
  | { type: 'open_stage_tab'; tab: string };

export interface Idea {
  id: string;
  kind: 'declining' | 'rising' | 'underfunded' | 'money_sink' | 'no_sales' | 'fatigue' | 'weak_winner' | 'unassigned';
  severity: 'high' | 'medium' | 'low';
  campaign_id: string | null;
  campaign_name: string;
  title: string;
  detail: string;
  action: IdeaAction | null;
  facts: { label: string; value: string }[];
}

export interface PreviewItem {
  campaign_id: string; entity_id: string; level: Level; name: string;
  action: ActionType; plan: string; skipped_reason: string | null;
  after: { status?: string; daily_budget?: number | null } | null;
  move_to?: string;
}
export interface Preview { dry_run: boolean; kill_switch: boolean; items: PreviewItem[]; notes: string[] }

export interface DailyRow { date: string; spend: number; impressions: number; clicks: number; purchases: number; purchase_value: number }

export interface CampaignHistory {
  audit: AuditRow[];
  runs: { run_id: number; run_at: string; trigger: string; dry_run: boolean; plan: string; skipped_reason: string | null; applied: boolean; error: string | null }[];
}

export interface CampaignStats {
  breakeven_roas: number | null;
  cost_source: 'sheet' | 'product' | null;
  windows: { window: Window; metrics?: Metrics; profit_low: number | null; profit_high: number | null; units_low: number | null; units_high: number | null; method?: 'orders' | 'estimate'; match_rate?: number }[];
  meta_fetched_at: string;
}

export interface Competitor { id: string; name: string; page_url: string; page_id: string; notes: string; created_at: string }
export type AdFormat = '' | 'video' | 'image' | 'carousel';
export interface CompetitorAd {
  id: string; competitor_id: string; library_url: string; started_at: string | null; last_seen: string | null;
  status: 'active' | 'stopped'; format: AdFormat; promo: string; hook: string; notes: string; section_id: string | null; created_at: string;
}
export interface CompetitorCheck { id: number; competitor_id: string; checked_at: string; active_ads: number; note: string }
export interface CompetitorData { competitors: Competitor[]; ads: CompetitorAd[]; checks: CompetitorCheck[] }

export type SalesCalc =
  | { method: 'orders'; source: string; tiers: CostTier[]; orders: number; matched: number; match_rate: number; cost_ratio: number; units_per_baht: number }
  | { method: 'sheet_exact'; sheet_name: string; tiers: CostTier[]; mix: number[] }
  | { method: 'sheet_ratio'; sheet_name: string; tiers: CostTier[]; ratio_min: number; ratio_max: number }
  | { method: 'product'; product: string; cost_per_unit: number; price_min: number; price_max: number; cod_deducted: number; extra_per_order: number }
  | { method: 'actual'; orders: number; customer: number; exact: number; approx: number; cost_known: number; shipping: number; goods: number; product_cost: number }
  | { method: 'none'; reason: string };

export interface P365Upload { date: string; orders: number; uploaded_at: string; uploaded_by: string; credits: { customer: number; exact: number; approx: number; none: number }; revenue: number; units: number }
export interface P365Order { order_no: string; date: string; created_at: string; total: number; subtotal: number | null; discount: number | null; shipping: number | null; cost: number | null; payment: string | null; paid_at: string | null; units: number; items: { code: string; sku: string; name: string; qty: number; price: number }[]; campaign_id: string | null; match: 'customer' | 'exact' | 'approx' | 'none' }
export interface UploadedOrder { order_no: string; created_at: string; total: number; subtotal?: number | null; discount?: number | null; shipping?: number | null; cost?: number | null; payment?: string | null; paid_at?: string | null; item_detail?: string | null; profile_name?: string | null }

export interface SalesRow {
  date: string; campaign_id: string; name: string; stage_id: string | null;
  revenue: number; orders: number; spend: number; clicks: number;
  units_low: number | null; units_high: number | null;
  cost_low: number | null; cost_high: number | null;
  profit_low: number | null; profit_high: number | null;
  calc: SalesCalc;
}

export interface ActualSales { date: string; orders: number | null; pieces: number | null; revenue: number | null; note: string; updated_by: string; updated_at: string }

export interface ConversionOrder {
  hour: string; value: number; count: number;
  status: 'match' | 'mismatch' | 'no_value' | 'unsplit';
  sets: { units: number; price: number; cost: number }[]; cod: number; cost: number;
}
export interface WebhookStatus {
  configured: { app_secret: boolean; verify_token: boolean; app_id: boolean };
  callback_url: string;
  app_subscribed: boolean | null;
  page: { id: string; name: string; subscribed: boolean } | null;
  events_total: number;
  referrals_total: number;
  last_event_at: string | null;
  last_referral_at: string | null;
  error: string | null;
}
export interface ReferralSummary { date: string; campaign_id: string | null; ad_id: string | null; ad_name: string | null; people: number; events: number }

export interface ConversionCampaign {
  campaign_id: string; name: string; stage_id: string | null;
  tiers: CostTier[]; cost_source: 'sheet' | 'product' | null; cost_label: string;
  count: number; value: number; matched: number; match_rate: number;
  cost: number | null; spend: number | null; profit: number | null;
  orders: ConversionOrder[];
}

export interface BulkBudgetResult { id: string; name: string; from: number | null; to?: number; ok: boolean; message?: string }

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  me: () => call<{ email: string; role: 'admin' | 'costs'; mock: boolean }>('GET', '/api/me'),
  overview: (window: Window, fresh = false) => call<Overview>('GET', `/api/overview?window=${window}${fresh ? '&fresh=1' : ''}`),
  createSection: (s: Partial<Section>) => call<Section>('POST', '/api/sections', s),
  saveSection: (s: Section) => call<Section>('PUT', `/api/sections/${s.id}`, s),
  deleteSection: (id: string) => call<{ ok: true }>('DELETE', `/api/sections/${id}`),
  saveStage: (s: Stage) => call<Stage>('PUT', `/api/stages/${s.id}`, s),
  saveCampaign: (id: string, c: { name: string; section_id: string | null; stage_id: string | null; mode: Mode; rules: Rule[] | null }) =>
    call('PUT', `/api/campaigns/${id}`, c),
  setStatus: (id: string, status: 'ACTIVE' | 'PAUSED', name: string) => call('POST', `/api/entities/${id}/status`, { status, name }),
  setBudget: (id: string, amount: number, from: number | null, name: string) => call('POST', `/api/entities/${id}/budget`, { amount, from, name }),
  searchCosts: (q: string) => call<{ total: number; results: CostRow[] }>('GET', `/api/costs?q=${encodeURIComponent(q)}`),
  suggestCosts: (text: string) => call<{ total: number; results: CostRow[] }>('GET', `/api/costs?suggest=${encodeURIComponent(text)}`),
  webCosts: () => call<{ total: number; results: CostRow[] }>('GET', `/api/costs?tab=${WEB_TAB}`),
  saveWebCost: (c: { code: string; name: string; cost: number; price: number | null }) => call<{ ok: true }>('POST', '/api/costs', c),
  deleteWebCost: (code: string) => call<{ ok: true }>('DELETE', `/api/costs?code=${encodeURIComponent(code)}`),
  syncCostTab: (tab: string) => call<{ tab: string; codes: number; error?: string }[]>('POST', `/api/costs/sync?tab=${encodeURIComponent(tab)}`),
  run: (dry_run: boolean) => call<RunReport>('POST', '/api/run', { dry_run }),
  runs: () => call<RunRow[]>('GET', '/api/runs'),
  audit: () => call<AuditRow[]>('GET', '/api/audit'),
  settings: () => call<Settings>('GET', '/api/settings'),
  ideas: () => call<{ ideas: Idea[]; costs_loaded: boolean; meta_fetched_at: string; meta_warning: string | null }>('GET', '/api/ideas'),
  preview: () => call<Preview>('GET', '/api/preview'),
  daily: (id: string, window: Window) => call<{ days: DailyRow[] }>('GET', `/api/campaigns/${id}/daily?window=${window}`),
  stats: (id: string) => call<CampaignStats>('GET', `/api/campaigns/${id}/stats`),
  actualSales: () => call<ActualSales[]>('GET', '/api/actual-sales'),
  saveActualSales: (date: string, v: { orders: number | null; pieces: number | null; revenue: number | null }) => call<{ ok: true }>('PUT', `/api/actual-sales/${date}`, v),
  conversions: (date: string, window: Window) => call<{ date: string; cod_fee: number; campaigns: ConversionCampaign[]; fetched_at: string }>('GET', `/api/conversions?date=${date}&window=${window}`),
  salesReport: (window: Window) => call<{ window: Window; rows: SalesRow[]; uploaded: string[]; fetched_at: string; warning: string | null }>('GET', `/api/sales-report?window=${window}`),
  p365Uploads: (window: Window) => call<{ uploads: P365Upload[] }>('GET', `/api/p365?window=${window}`),
  p365Orders: (date: string) => call<{ date: string; orders: P365Order[] }>('GET', `/api/p365/orders?date=${date}`),
  p365Upload: (orders: UploadedOrder[]) => call<{ dates: string[]; orders: number; errors: string[]; credits: Record<string, { customer: number; exact: number; approx: number; none: number }> }>('POST', '/api/p365/upload', { orders }),
  p365Recredit: (date: string) => call<{ date: string; credits: { customer: number; exact: number; approx: number; none: number } | null }>('POST', '/api/p365/recredit', { date }),
  webhook: () => call<WebhookStatus>('GET', '/api/webhook'),
  setupWebhook: () => call<{ app: unknown; page: unknown }>('POST', '/api/webhook/setup'),
  adReferrals: (q: { date?: string; window?: Window }) => call<{ dates: string[]; rows: ReferralSummary[] }>('GET', `/api/ad-referrals?${q.date ? `date=${q.date}` : `window=${q.window ?? 'last_7d'}`}`),
  conversionHours: () => call<{ stored: number; of: number; dates: string[] }>('GET', '/api/conversion-hours'),
  syncConversionHours: () => call<{ fetched: string[]; missing: number; errors: string[] }>('POST', '/api/conversion-hours/sync'),
  campaignCosts: () => call<{ synced_at: string | null; campaigns: { name: string; tiers: CostTier[] }[] }>('GET', '/api/campaign-costs'),
  syncCampaignCosts: () => call<{ campaigns: number; error?: string }>('POST', '/api/campaign-costs/sync'),
  competitors: () => call<CompetitorData>('GET', '/api/competitors'),
  saveCompetitor: (c: Partial<Competitor>) => call<Competitor>('POST', '/api/competitors', c),
  deleteCompetitor: (id: string) => call<{ ok: true }>('DELETE', `/api/competitors/${id}`),
  saveCompetitorAd: (a: Partial<CompetitorAd>) => call<CompetitorAd>('POST', '/api/competitors/ads', a),
  deleteCompetitorAd: (id: string) => call<{ ok: true }>('DELETE', `/api/competitors/ads/${id}`),
  addCompetitorCheck: (id: string, active_ads: number, note: string) => call<{ ok: true }>('POST', `/api/competitors/${id}/checks`, { active_ads, note }),
  history: (id: string) => call<CampaignHistory>('GET', `/api/campaigns/${id}/history`),
  bulkStage: (items: { id: string; name: string }[], stage_id: string | null) => call<{ ok: true; changed: number }>('POST', '/api/bulk/stage', { items, stage_id }),
  bulkBudget: (items: { id: string; name: string }[], pct: number) => call<{ results: BulkBudgetResult[] }>('POST', '/api/bulk/budget', { items, pct }),
  saveSettings: (s: Settings) => call<Settings>('PUT', '/api/settings', s),
};

// ---- labels ----

/** Costs typed into the dashboard live under this pseudo tab (same as worker/model.ts). */
export const WEB_TAB = 'WEB';
/** The catch-all product line has a fixed meaning; its stored name is never shown. */
export const sectionName = (s: { id: string; name: string }) => (s.id === 'default' ? 'อื่นๆ (ไม่ตรงคำค้น)' : s.name);
export const tabLabel = (tab: string) => (tab === WEB_TAB ? 'กรอกในเว็บ' : tab);

export const WINDOW_LABEL: Record<Window, string> = {
  today: 'วันนี้', yesterday: 'เมื่อวาน', last_3d: '3 วัน', last_7d: '7 วัน', last_14d: '14 วัน', last_30d: '30 วัน',
};
export const METRIC_LABEL: Record<Metric, string> = {
  spend: 'ใช้จ่าย', impressions: 'Impressions', clicks: 'คลิก', ctr: 'CTR %', cpc: 'CPC', frequency: 'Frequency',
  purchases: 'ยอดซื้อ', cpa: 'ต้นทุน/ออเดอร์', roas: 'ROAS', messages: 'แชท', cost_per_message: 'ต้นทุน/แชท',
};
export const ACTION_LABEL: Record<ActionType, string> = {
  pause: 'หยุด', enable: 'เปิด', budget_pct: 'ปรับงบ %', notify: 'แจ้งเตือนอย่างเดียว', move: 'ย้ายไปกลุ่ม',
};
export const LEVEL_LABEL: Record<Level, string> = { campaign: 'แคมเปญ', adset: 'ad set' };
export const MODE_LABEL: Record<Mode, string> = { stage: 'ตามกลุ่ม', custom: 'กฎเฉพาะ', off: 'ไม่อัตโนมัติ' };
