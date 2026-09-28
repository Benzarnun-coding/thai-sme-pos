// Pure logic for ads-web: product sections (cost → break-even), lifecycle stages (rules), stage moves.
// No I/O so it can be unit-tested with node --test.

import type { Action, Metrics, Rule } from '../../ads-engine/src/types.ts';

/** `move` changes the campaign's stage in D1 only; it never touches Meta. */
export type WebAction = Action | { type: 'move'; to: string };

/**
 * A rule as stored in D1. `value_mode: 'x_breakeven'` means `value` is a multiple of the campaign's product break-even ROAS.
 * `min_days_in_stage` only applies to move rules: the campaign must have been in its current stage that long.
 */
export interface WebRule extends Omit<Rule, 'action'> {
  action: WebAction;
  value_mode?: 'abs' | 'x_breakeven';
  min_days_in_stage?: number;
}

/** A move rule ready for ads-engine's evaluate(): the action is disguised as notify, the target kept alongside. */
export interface MoveRule extends Rule {
  to: string;
  min_days_in_stage: number;
}

export interface Product {
  tab: string;
  code: string;
}

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
  rules: WebRule[];
  automation: boolean;
  sort: number;
}

export type CampaignMode = 'stage' | 'custom' | 'off';

export interface CampaignSetting {
  campaign_id: string;
  section_id: string | null;
  /** null = not put in any stage yet → no rules act on it */
  stage_id: string | null;
  stage_since: string | null;
  mode: CampaignMode;
  rules: WebRule[] | null;
}

export interface CostRow {
  tab: string;
  code: string;
  name: string;
  sku_count: number;
  avg_cost: number;
  min_cost: number;
  max_cost: number;
  avg_price: number;
}

export const DEFAULT_SECTION_ID = 'default';

/** Explicit assignment wins; otherwise the first section (by sort) whose keyword appears in the campaign name; otherwise default. */
export function resolveSectionId(
  campaign: { id: string; name: string },
  sections: Section[],
  settings: Map<string, CampaignSetting>,
): string {
  const explicit = settings.get(campaign.id)?.section_id;
  if (explicit && sections.some((s) => s.id === explicit)) return explicit;
  const name = campaign.name.toLowerCase();
  const ordered = [...sections].sort((a, b) => a.sort - b.sort);
  for (const s of ordered) {
    if (s.id === DEFAULT_SECTION_ID) continue;
    if (s.keywords.some((k) => k.trim() && name.includes(k.trim().toLowerCase()))) return s.id;
  }
  return DEFAULT_SECTION_ID;
}

export interface Economics {
  /** Average cost per unit across the section's products, null when no product is linked or found in the sheet */
  cost_per_unit: number | null;
  cogs_per_order: number | null;
  price_per_order: number | null;
  /** Revenue ÷ ad spend at which profit is zero after product cost and extra cost. Infinity = never profitable at this price. */
  breakeven_roas: number | null;
  /** Profit after product cost, extra cost and ad spend over the metrics window */
  profit: number | null;
  missing_products: Product[];
}

export function economics(section: Section, costs: CostRow[], m: Pick<Metrics, 'spend' | 'purchases' | 'purchase_value'>): Economics {
  const found: CostRow[] = [];
  const missing: Product[] = [];
  for (const p of section.products) {
    const row = costs.find((c) => c.tab === p.tab && c.code === p.code);
    if (row) found.push(row); else missing.push(p);
  }
  const cost_per_unit = found.length ? found.reduce((s, c) => s + c.avg_cost, 0) / found.length : null;
  const cogs_per_order = cost_per_unit === null ? null : cost_per_unit * section.units_per_order;
  const aov = m.purchases > 0 ? m.purchase_value / m.purchases : null;
  const price_per_order = section.price_per_order ?? aov;

  let breakeven_roas: number | null = null;
  if (cogs_per_order !== null && price_per_order !== null && price_per_order > 0) {
    const margin = price_per_order - cogs_per_order - section.extra_cost_per_order;
    breakeven_roas = margin > 0 ? price_per_order / margin : Infinity;
  }
  const profit = cogs_per_order === null
    ? null
    : m.purchase_value - m.purchases * (cogs_per_order + section.extra_cost_per_order) - m.spend;

  return { cost_per_unit, cogs_per_order, price_per_order, breakeven_roas, profit, missing_products: missing };
}

/**
 * Turn stored rules into plain ads-engine rules for one break-even value. Break-even-relative rules are dropped
 * (with a note) when break-even is unknown. Move rules come back separately, disguised as notify for evaluate().
 */
export function materializeRules(rules: WebRule[], breakeven: number | null): { actions: Rule[]; moves: MoveRule[]; notes: string[] } {
  const actions: Rule[] = [];
  const moves: MoveRule[] = [];
  const notes: string[] = [];
  for (const r of rules) {
    if (r.enabled === false) continue;
    const { value_mode, min_days_in_stage, action, ...plain } = r;
    let value = r.value;
    if (value_mode === 'x_breakeven') {
      if (breakeven === null || !Number.isFinite(breakeven)) {
        notes.push(`${r.id}: ข้าม เพราะยังคำนวณ ROAS คุ้มทุนไม่ได้ (ยังไม่ผูกต้นทุน หรือยังไม่มียอดขาย)`);
        continue;
      }
      value = round2(r.value * breakeven);
    }
    if (action.type === 'move') {
      moves.push({ ...plain, value, action: { type: 'notify' }, to: action.to, min_days_in_stage: min_days_in_stage ?? 0 });
    } else {
      actions.push({ ...plain, value, action });
    }
  }
  return { actions, moves, notes };
}

/** Which stored rules apply to a campaign, or null when nothing should act on it. */
export function storedRulesFor(stage: Stage | undefined, setting: CampaignSetting | undefined): WebRule[] | null {
  if (setting?.mode === 'off') return null;
  if (setting?.mode === 'custom') return setting.rules ?? [];
  if (!stage) return null;
  return stage.automation ? stage.rules : null;
}

/** Whole days the campaign has spent in its current stage; unknown entry time counts as long enough. */
export function daysInStage(setting: CampaignSetting | undefined, now: Date): number {
  if (!setting?.stage_since) return Infinity;
  return (now.getTime() - new Date(setting.stage_since).getTime()) / 86_400_000;
}

export function sumMetrics(list: Metrics[]): Pick<Metrics, 'spend' | 'purchases' | 'purchase_value' | 'impressions' | 'clicks'> {
  const t = { spend: 0, purchases: 0, purchase_value: 0, impressions: 0, clicks: 0 };
  for (const m of list) {
    t.spend += m.spend; t.purchases += m.purchases; t.purchase_value += m.purchase_value;
    t.impressions += m.impressions; t.clicks += m.clicks;
  }
  return t;
}

// ---- Cost sheet parsing ----

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Master Catalog layout (every location tab): B SKU · C product code · D description · H cost · I price.
 * Google aggregates per product code before sending, so a 2.6 MB tab arrives as ~90 KB — small enough for the
 * Workers free-plan CPU limit. Columns out: code, SKU count, avg/min/max cost, avg price, description.
 */
export const COST_QUERY = 'select C, count(B), avg(H), min(H), max(H), avg(I), max(D) where B is not null and H > 0 group by C';

export function parseCostQuery(tab: string, rows: string[][]): CostRow[] {
  // Google groups "801/1" and "801/1 " separately; after trimming they are one code, merged weighted by SKU count.
  const byCode = new Map<string, CostRow>();
  for (const [rawCode, count, avgCost, minCost, maxCost, avgPrice, name] of rows) {
    const code = rawCode?.trim();
    const sku_count = toNumber(count);
    const avg_cost = toNumber(avgCost);
    if (!code || sku_count === null || sku_count <= 0 || avg_cost === null) continue; // header row
    const row: CostRow = {
      tab,
      code,
      name: (name ?? '').trim(),
      sku_count,
      avg_cost,
      min_cost: toNumber(minCost) ?? avg_cost,
      max_cost: toNumber(maxCost) ?? avg_cost,
      avg_price: toNumber(avgPrice) ?? 0,
    };
    const prev = byCode.get(code);
    if (prev) {
      const n = prev.sku_count + row.sku_count;
      prev.avg_cost = (prev.avg_cost * prev.sku_count + row.avg_cost * row.sku_count) / n;
      prev.avg_price = (prev.avg_price * prev.sku_count + row.avg_price * row.sku_count) / n;
      prev.min_cost = Math.min(prev.min_cost, row.min_cost);
      prev.max_cost = Math.max(prev.max_cost, row.max_cost);
      prev.sku_count = n;
      prev.name ||= row.name;
    } else {
      byCode.set(code, row);
    }
  }
  return [...byCode.values()].map((r) => ({ ...r, avg_cost: round2(r.avg_cost), avg_price: round2(r.avg_price) }));
}

/** Codes from the sheet whose code appears in the campaign name — suggestions for linking products to a section. */
export function suggestProducts(text: string, costs: CostRow[], limit = 8): CostRow[] {
  const t = text.toLowerCase() + ' ';
  return costs
    .filter((c) => {
      const code = c.code.toLowerCase();
      const family = code.split(/[/-]/)[0]; // 801/1 → 801, Ni9-2 → ni9
      return (code.length >= 2 && t.includes(code)) || (family.length >= 2 && t.includes(family + ' '));
    })
    .sort((a, b) => b.code.length - a.code.length)
    .slice(0, limit);
}

function toNumber(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number(v.replace(/[,฿\s]/g, ''));
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
}
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
