// Per-campaign costs from the team's sheet "FB คำนวณค่า ADS" (tab "รวมต้นทุน ที่เปิด ADS"): one block per Meta
// campaign name, one row per promo with the all-in cost of an order of that promo (product + shipping, tax,
// damage, COD already added in the sheet). A matched campaign uses these instead of its product line's cost.

import type { Metrics } from '../../ads-engine/src/types.ts';

export interface CostTier {
  units: number;
  price: number;
  /** All-in cost of one order of this promo */
  cost: number;
}

export interface CampaignCost {
  name: string;
  tiers: CostTier[];
}

/** Matching key: names in the sheet carry stray line breaks and double spaces. */
export function nameKey(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

const toNum = (s: string | undefined) => {
  const n = Number(String(s ?? '').replace(/[,฿\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Rows as exported (A name · B "ราคาขาย 2 ตัว 299" · C "ต้นทุน 70+70+35.93" · D 175.93). A non-empty A starts a
 * campaign; B/D rows add promos; "* ไม่มีราคาโปร" and blank rows are skipped. Cost falls back to the sum in C.
 */
export function parseCampaignCostSheet(rows: string[][]): CampaignCost[] {
  const out = new Map<string, CampaignCost>();
  let current: CampaignCost | null = null;
  for (const [a = '', b = '', c = '', d = ''] of rows) {
    const name = a.replace(/\s+/g, ' ').trim();
    if (name) {
      current = { name, tiers: [] };
      if (!out.has(nameKey(name))) out.set(nameKey(name), current);
    }
    if (!current) continue;
    const m = b.match(/ราคาขาย\s*(\d{1,2})\s*ตัว\s*([\d,]+(?:\.\d+)?)/);
    if (!m) continue;
    const units = Number(m[1]);
    const price = toNum(m[2]);
    const cost = toNum(d) ?? (c.match(/[\d.]+/g)?.reduce((t, x) => t + Number(x), 0) || null);
    if (!price || !cost || units < 1) continue;
    if (!current.tiers.some((t) => t.units === units && t.price === price)) current.tiers.push({ units, price, cost });
  }
  // A repeated name keeps its first block; blocks without any promo are dropped.
  return [...out.values()].map((c) => ({ ...c, tiers: c.tiers.sort((x, y) => x.units - y.units) })).filter((c) => c.tiers.length);
}

export interface TierEconomics {
  /** Conservative / best profit after cost and ad spend over the metrics window */
  profit_low: number | null;
  profit_high: number | null;
  units_low: number | null;
  units_high: number | null;
  /** Break-even ROAS at the costliest promo (cost ÷ price highest) and at the cheapest */
  breakeven_roas: number | null;
  breakeven_best: number | null;
  price_per_unit_min: number;
  price_per_unit_max: number;
  /** True when the promo mix was solved exactly (two promos, average order between their prices) */
  exact: boolean;
}

type Money = Pick<Metrics, 'spend' | 'purchases' | 'purchase_value'>;

/**
 * Meta gives orders N and value R, not which promo each order was. With two promos the mix is solved:
 * n2 = (R − p1·N) / (p2 − p1). Otherwise cost is bounded by the promos' cost ÷ price ratios: R × min..max ratio.
 */
export function tierEconomics(tiers: CostTier[], m: Money | undefined): TierEconomics {
  const ratios = tiers.map((t) => t.cost / t.price);
  const minR = Math.min(...ratios);
  const maxR = Math.max(...ratios);
  const be = (r: number) => (r < 1 ? 1 / (1 - r) : Infinity);
  const perUnit = tiers.map((t) => t.price / t.units);
  const base = {
    breakeven_roas: be(maxR), breakeven_best: be(minR),
    price_per_unit_min: Math.min(...perUnit), price_per_unit_max: Math.max(...perUnit),
  };
  if (!m) return { ...base, profit_low: null, profit_high: null, units_low: null, units_high: null, exact: false };
  const R = m.purchase_value, N = m.purchases, S = m.spend;
  if (tiers.length === 2 && N > 0) {
    const [t1, t2] = tiers;
    const n2 = (R - t1.price * N) / (t2.price - t1.price);
    if (n2 >= -1e-9 && n2 <= N + 1e-9) {
      const n1 = N - n2;
      const profit = R - (n1 * t1.cost + n2 * t2.cost) - S;
      const units = n1 * t1.units + n2 * t2.units;
      return { ...base, profit_low: profit, profit_high: profit, units_low: units, units_high: units, exact: true };
    }
  }
  return {
    ...base,
    profit_low: R - R * maxR - S,
    profit_high: R - R * minR - S,
    units_low: R / base.price_per_unit_max,
    units_high: R / base.price_per_unit_min,
    exact: false,
  };
}
