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

/** One promo price: `units` pieces for `price` baht (e.g. 3 for 549). */
export interface Tier {
  units: number;
  price: number;
}

export interface Section {
  id: string;
  name: string;
  keywords: string[];
  products: Product[];
  /** Promo prices sold in this product's ads. Empty = use price_per_order / sheet price. */
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
/** Costs typed into the dashboard live under this pseudo tab; sheet syncs never touch it. */
export const WEB_TAB = 'WEB';

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

/**
 * Profit is counted per piece, not per order: Meta reports orders (conversions) and their value, and an order can be
 * 1, 2 or 3 pieces at different promo prices. Pieces ≈ value ÷ price per piece, and the promo prices per piece are close,
 * so the estimate is a narrow range. The sheet cost is all-in (shipping and returns included).
 */
export interface Economics {
  /** Average all-in cost per piece across the section's products; null when nothing is linked or found in the sheet */
  cost_per_unit: number | null;
  /** Lowest / highest selling price per piece (cheapest promo / single piece); null when no price is known */
  price_per_unit_min: number | null;
  price_per_unit_max: number | null;
  /** Where the price came from */
  price_source: 'tiers' | 'manual' | 'sheet' | null;
  /** Conservative break-even ROAS (at the cheapest price per piece) — what rules use. Infinity = never profitable. */
  breakeven_roas: number | null;
  /** Break-even if every order were sold at the best price per piece */
  breakeven_best: number | null;
  /** Over the metrics window: pieces sold and profit after cost and ad spend, low–high */
  units_low: number | null;
  units_high: number | null;
  /** Conservative profit (= profit_low) */
  profit: number | null;
  profit_high: number | null;
  missing_products: Product[];
}

type Money = Pick<Metrics, 'spend' | 'purchases' | 'purchase_value'>;

/**
 * Cash-on-delivery surcharge that admins include in the order value they tag in Meta (e.g. +50).
 * It is income, but not pieces, so it is taken out before dividing by the price per piece.
 */
export interface Cod {
  /** Share of orders paid on delivery, 0–1 */
  share: number;
  /** Surcharge per COD order */
  fee: number;
}
export const NO_COD: Cod = { share: 0, fee: 0 };

export function economics(section: Section, costs: CostRow[], m: Money, cod: Cod = NO_COD): Economics {
  const found: CostRow[] = [];
  const missing: Product[] = [];
  for (const p of section.products) {
    const row = costs.find((c) => c.tab === p.tab && c.code === p.code);
    if (row) found.push(row); else missing.push(p);
  }
  const cost_per_unit = found.length ? found.reduce((s, c) => s + c.avg_cost, 0) / found.length : null;

  let perUnit: number[] = [];
  let price_source: Economics['price_source'] = null;
  if (section.tiers.length) {
    perUnit = section.tiers.map((t) => t.price / t.units);
    price_source = 'tiers';
  } else if (section.price_per_order !== null) {
    perUnit = [section.price_per_order / section.units_per_order];
    price_source = 'manual';
  } else {
    const prices = found.map((c) => c.avg_price).filter((p) => p > 0);
    if (prices.length) { perUnit = [prices.reduce((a, b) => a + b, 0) / prices.length]; price_source = 'sheet'; }
  }
  const price_per_unit_min = perUnit.length ? Math.min(...perUnit) : null;
  const price_per_unit_max = perUnit.length ? Math.max(...perUnit) : null;

  const aov = m.purchases > 0 ? m.purchase_value / m.purchases : null;
  const be = (price: number | null) => (cost_per_unit === null || price === null ? null : breakeven(price, cost_per_unit, section.extra_cost_per_order, aov, cod));
  const range = profitRange({ cost_per_unit, price_per_unit_min, price_per_unit_max }, section.extra_cost_per_order, m, cod);

  return {
    cost_per_unit, price_per_unit_min, price_per_unit_max, price_source,
    breakeven_roas: be(price_per_unit_min),
    breakeven_best: be(price_per_unit_max),
    units_low: range?.units_low ?? null,
    units_high: range?.units_high ?? null,
    profit: range?.low ?? null,
    profit_high: range?.high ?? null,
    missing_products: missing,
  };
}

/**
 * ROAS at which profit is zero: revenue − (revenue − COD surcharges) × cost/price − orders × extra = spend.
 * The per-order terms need the average order value; without it they are left out.
 */
function breakeven(pricePerUnit: number, costPerUnit: number, extraPerOrder: number, aov: number | null, cod: Cod): number {
  const perOrder = aov ? (cod.fee * cod.share * costPerUnit / pricePerUnit - extraPerOrder) / aov : 0;
  const margin = 1 - costPerUnit / pricePerUnit + perOrder;
  return margin > 0 ? 1 / margin : Infinity;
}

/** Pieces and profit for one set of numbers (a campaign or a whole section), low–high. Null when cost or price is unknown. */
export function profitRange(
  e: Pick<Economics, 'cost_per_unit' | 'price_per_unit_min' | 'price_per_unit_max'>, extraPerOrder: number, m: Money, cod: Cod = NO_COD,
): { units_low: number; units_high: number; low: number; high: number } | null {
  if (e.cost_per_unit === null || e.price_per_unit_min === null || e.price_per_unit_max === null) return null;
  // COD surcharges are in the tagged value but are not pieces.
  const goods = Math.max(0, m.purchase_value - cod.fee * cod.share * m.purchases);
  // More pieces (cheapest price per piece) = more cost = lower profit.
  const units_high = goods / e.price_per_unit_min;
  const units_low = goods / e.price_per_unit_max;
  const rest = m.purchase_value - m.purchases * extraPerOrder - m.spend;
  return { units_low, units_high, low: rest - units_high * e.cost_per_unit, high: rest - units_low * e.cost_per_unit };
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
