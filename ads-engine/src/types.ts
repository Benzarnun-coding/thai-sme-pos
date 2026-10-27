// Shared types for the ads engine. Kept free of runtime code so Node can strip them.

export type Level = 'campaign' | 'adset';
export type Window = 'today' | 'yesterday' | 'last_3d' | 'last_7d' | 'last_14d' | 'last_30d';
export type Metric =
  | 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'frequency'
  | 'purchases' | 'cpa' | 'roas'
  | 'messages' | 'cost_per_message';
export type Op = '>' | '>=' | '<' | '<=';

export interface Action {
  /** pause = set PAUSED, enable = set ACTIVE, budget_pct = change daily budget by pct, notify = report only */
  type: 'pause' | 'enable' | 'budget_pct' | 'notify';
  /** For budget_pct: signed percent, e.g. 20 or -30 */
  pct?: number;
  /**
   * For a budget_pct raise: never above this daily budget. A step-up for small budgets (e.g. 50 → 100 → 200 → 300):
   * when set, max_change_pct_per_run doesn't apply, since +20% of 50 would take days to reach a useful budget.
   */
  up_to?: number;
}

export interface Rule {
  id: string;
  /** Free text shown in the report */
  description?: string;
  level: Level;
  window: Window;
  metric: Metric;
  op: Op;
  value: number;
  /** Only evaluate when spend in the window is at least this (account currency). Avoids acting on noise. */
  min_spend?: number;
  /** Only evaluate when purchases in the window are at least this. Stops a lucky 1–2 sales from triggering a scale-up. */
  min_purchases?: number;
  /** Only entities whose current daily budget is at most this (e.g. a step-up rule meant for small budgets only) */
  max_budget?: number;
  action: Action;
  /** Hours to wait before this rule may act on the same entity again */
  cooldown_hours?: number;
  enabled?: boolean;
}

export interface Guardrails {
  /** Absolute cap on how far a daily budget may move in one run, as percent of current budget */
  max_change_pct_per_run: number;
  /** Never set a daily budget below this (account currency) */
  min_daily_budget: number;
  /** Never set a daily budget above this (account currency) */
  max_daily_budget: number;
  /** Sum of all daily budgets in scope may never exceed this after a run */
  max_total_daily_budget: number;
  /** ads-web: daily budget a new campaign (an approved copy) starts at before it climbs; unset = 50 */
  start_daily_budget?: number;
  /** ads-web: per-campaign ceiling for proven winners (winning stage, real 7-day ROAS ≥ 1.5× shop BE, ≥ 10 orders); unset = 5,000 */
  winner_max_daily_budget?: number;
  /** ads-web: hours between two budget increases on one campaign/ad set, whichever rule raises it; unset = 48 */
  increase_gap_hours?: number;
  /** ads-web: daily budgets under this skip increase_gap_hours; unset = 500 */
  free_increase_below?: number;
  /** ads-web: one bad day (ROAS < 0.8× BE on ≥ 2,000) above max_daily_budget → back to it; 'dry' only reports; unset = 'dry' */
  brake_yesterday?: 'off' | 'dry' | 'on';
  /** ads-web: where the rules' break-even comes from — 'orders' = each campaign's real Page365 orders (breakevens.ts); unset = 'catalog' */
  breakeven_source?: 'catalog' | 'orders';
  /** ads-web: the morning rule run waits for yesterday's Page365 file (runs when it's in, else 13:00); unset/false = 08:00 */
  morning_wait?: boolean;
}

export interface Scope {
  /** Only entities whose campaign name starts with one of these prefixes. Empty = all campaigns. */
  campaign_name_prefixes: string[];
  /** Explicit campaign IDs to include. Empty = no filter. */
  campaign_ids: string[];
}

export interface RulesFile {
  scope: Scope;
  guardrails: Guardrails;
  rules: Rule[];
}

export interface Metrics {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  purchases: number;
  purchase_value: number;
  cpa: number;
  roas: number;
  frequency: number;
  /** Messaging conversations started (Messenger / IG / WhatsApp) — the number Thai chat-commerce shops optimise for */
  messages: number;
  cost_per_message: number;
}

export interface Entity {
  level: Level;
  id: string;
  name: string;
  campaign_id: string;
  campaign_name: string;
  status: 'ACTIVE' | 'PAUSED' | string;
  /** Daily budget in account currency (already divided by 100). null when this entity has no budget (e.g. ad set under CBO). */
  daily_budget: number | null;
  metrics: Partial<Record<Window, Metrics>>;
}

export interface Decision {
  rule_id: string;
  entity: Pick<Entity, 'level' | 'id' | 'name' | 'campaign_name'>;
  window: Window;
  metric: Metric;
  observed: number;
  threshold: number;
  action: Action;
  /** What we intend to do, in words */
  plan: string;
  /** Filled after apply */
  applied?: boolean;
  skipped_reason?: string;
  before?: { status?: string; daily_budget?: number | null };
  after?: { status?: string; daily_budget?: number | null };
  error?: string;
}

export interface State {
  /** key = `${rule_id}:${entity_id}` → ISO time of last applied action */
  last_action: Record<string, string>;
}

export interface RunReport {
  run_at: string;
  account_id: string;
  dry_run: boolean;
  entities_evaluated: number;
  decisions: Decision[];
  totals: { daily_budget_before: number; daily_budget_after: number };
  errors: string[];
}
