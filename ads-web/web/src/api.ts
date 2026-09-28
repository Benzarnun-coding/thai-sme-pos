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

export interface Section {
  id: string;
  name: string;
  keywords: string[];
  products: Product[];
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
    cost_per_unit: number | null; cogs_per_order: number | null; price_per_order: number | null;
    breakeven_roas: number | null; never_profitable: boolean; profit: number | null; missing_products: Product[];
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
  /** After product cost, extra cost and ad spend over the window */
  profit: number | null;
  adsets: EntityView[];
}

export interface Guardrails { max_change_pct_per_run: number; min_daily_budget: number; max_daily_budget: number; max_total_daily_budget: number }

export interface Overview {
  account: string;
  window: Window;
  settings: { dry_run: boolean; kill_switch: boolean; guardrails: Guardrails };
  costs_loaded: number;
  last_run: { run_at: string; summary: string; dry_run: boolean } | null;
  stages: Stage[];
  sections: SectionView[];
  campaigns: CampaignView[];
}

export interface Settings { dry_run: boolean; kill_switch: boolean; guardrails: Guardrails; sheet_id: string; sheet_tabs: string[] }

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

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  me: () => call<{ email: string; mock: boolean }>('GET', '/api/me'),
  overview: (window: Window) => call<Overview>('GET', `/api/overview?window=${window}`),
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
  syncCostTab: (tab: string) => call<{ tab: string; codes: number; error?: string }[]>('POST', `/api/costs/sync?tab=${encodeURIComponent(tab)}`),
  run: (dry_run: boolean) => call<RunReport>('POST', '/api/run', { dry_run }),
  runs: () => call<RunRow[]>('GET', '/api/runs'),
  audit: () => call<AuditRow[]>('GET', '/api/audit'),
  settings: () => call<Settings>('GET', '/api/settings'),
  saveSettings: (s: Settings) => call<Settings>('PUT', '/api/settings', s),
};

// ---- labels ----

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
