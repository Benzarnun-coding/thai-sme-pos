// Daily sales report: for one campaign on one day, the product cost and profit with every number used to get
// there, so the dashboard can show the working like a spreadsheet. Same models as the rest of the dashboard.

import { tierEconomics, type CostTier } from './campaignCosts.ts';
import { profitRange, type Cod, type Economics } from './model.ts';

export interface DayMetrics { spend: number; purchases: number; purchase_value: number; clicks: number }

export type Calc =
  /** Two promos from the cost sheet, mix solved from orders and revenue */
  | { method: 'sheet_exact'; sheet_name: string; tiers: CostTier[]; mix: number[] }
  /** Cost sheet, mix unknown: revenue × cost ÷ price of the promos */
  | { method: 'sheet_ratio'; sheet_name: string; tiers: CostTier[]; ratio_min: number; ratio_max: number }
  /** Product line: pieces = (revenue − COD surcharges) ÷ price per piece, cost = pieces × cost per piece */
  | { method: 'product'; product: string; cost_per_unit: number; price_min: number; price_max: number; cod_deducted: number; extra_per_order: number }
  | { method: 'none'; reason: string };

export interface ReportRow {
  date: string;
  campaign_id: string;
  name: string;
  stage_id: string | null;
  revenue: number;
  orders: number;
  spend: number;
  clicks: number;
  units_low: number | null;
  units_high: number | null;
  /** Product cost, low–high (high goes with profit_low) */
  cost_low: number | null;
  cost_high: number | null;
  profit_low: number | null;
  profit_high: number | null;
  calc: Calc;
}

export function explainDay(
  base: { date: string; campaign_id: string; name: string; stage_id: string | null },
  m: DayMetrics,
  source:
    | { kind: 'sheet'; sheet_name: string; tiers: CostTier[] }
    | { kind: 'product'; product: string; econ: Pick<Economics, 'cost_per_unit' | 'price_per_unit_min' | 'price_per_unit_max'>; extra: number; cod: Cod }
    | { kind: 'none'; reason: string },
): ReportRow {
  const row = { ...base, revenue: m.purchase_value, orders: m.purchases, spend: m.spend, clicks: m.clicks };
  const costFrom = (pLow: number | null, pHigh: number | null) => ({
    cost_high: pLow === null ? null : m.purchase_value - m.spend - pLow,
    cost_low: pHigh === null ? null : m.purchase_value - m.spend - pHigh,
  });
  if (source.kind === 'sheet') {
    const t = tierEconomics(source.tiers, m);
    const ratios = source.tiers.map((x) => x.cost / x.price);
    const calc: Calc = t.exact && t.mix
      ? { method: 'sheet_exact', sheet_name: source.sheet_name, tiers: source.tiers, mix: t.mix }
      : { method: 'sheet_ratio', sheet_name: source.sheet_name, tiers: source.tiers, ratio_min: Math.min(...ratios), ratio_max: Math.max(...ratios) };
    return { ...row, units_low: t.units_low, units_high: t.units_high, ...costFrom(t.profit_low, t.profit_high), profit_low: t.profit_low, profit_high: t.profit_high, calc };
  }
  if (source.kind === 'product') {
    const r = profitRange(source.econ, source.extra, m, source.cod);
    if (r) {
      return {
        ...row, units_low: r.units_low, units_high: r.units_high, ...costFrom(r.low, r.high), profit_low: r.low, profit_high: r.high,
        calc: {
          method: 'product', product: source.product, cost_per_unit: source.econ.cost_per_unit!,
          price_min: source.econ.price_per_unit_min!, price_max: source.econ.price_per_unit_max!,
          cod_deducted: source.cod.fee * source.cod.share * m.purchases, extra_per_order: source.extra,
        },
      };
    }
    source = { kind: 'none', reason: source.econ.cost_per_unit === null ? 'สินค้ายังไม่มีทุน' : 'ยังไม่มีราคาขาย' };
  }
  return { ...row, units_low: null, units_high: null, cost_low: null, cost_high: null, profit_low: null, profit_high: null, calc: { method: 'none', reason: source.reason } };
}
