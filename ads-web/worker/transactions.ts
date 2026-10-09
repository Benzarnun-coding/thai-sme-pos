// Turning Meta's "this ad got N purchases worth V in this hour" into orders, each matched to the ad's promos:
// 249 = 199 + COD 50, 698 = 349 + 349. A matched order is costed with its promos' real cost; anything else
// (bought another model, other price) is costed as a share of its value, conservatively.

import type { CostTier } from './campaignCosts.ts';

export interface PromoSet { units: number; price: number; cost: number }

export interface Order {
  hour: string;
  /** Value tagged in Meta for this order (when several orders share an hour and couldn't be split, their total) */
  value: number;
  /** Orders this line stands for: 1, or more when an hour couldn't be split */
  count: number;
  status: 'match' | 'mismatch' | 'no_value' | 'unsplit';
  /** Promo sets the value was matched to */
  sets: PromoSet[];
  /** COD surcharge found in the value (not goods, not cost) */
  cod: number;
  cost: number;
}

const TOLERANCE = 1;
const MAX_SETS = 3;
const MAX_SPLIT = 4;

interface Combo { sets: PromoSet[]; cod: number; total: number; cost: number }

/** Every way to make one order: 1–3 promo sets, with or without the COD surcharge; fewest sets, no COD first. */
function combos(tiers: CostTier[], codFee: number): Combo[] {
  const out: Combo[] = [];
  const rec = (start: number, sets: PromoSet[]) => {
    if (sets.length) {
      const total = sets.reduce((t, s) => t + s.price, 0);
      const cost = sets.reduce((t, s) => t + s.cost, 0);
      out.push({ sets, cod: 0, total, cost });
      if (codFee > 0) out.push({ sets, cod: codFee, total: total + codFee, cost });
    }
    if (sets.length === MAX_SETS) return;
    for (let i = start; i < tiers.length; i++) rec(i, [...sets, { units: tiers[i].units, price: tiers[i].price, cost: tiers[i].cost }]);
  };
  rec(0, []);
  return out.sort((a, b) => a.sets.length - b.sets.length || a.cod - b.cod);
}

/** Splits one campaign-hour into orders matched to promos. */
export function matchHour(hour: string, purchases: number, value: number, tiers: CostTier[], codFee: number): Order[] {
  const n = Math.max(1, Math.round(purchases));
  const ratio = tiers.length ? Math.max(...tiers.map((t) => t.cost / t.price)) : 0;
  const fallback = (status: Order['status'], v: number, count: number): Order => ({ hour, value: v, count, status, sets: [], cod: 0, cost: v * ratio });
  if (value <= 0) return Array.from({ length: n }, () => fallback('no_value', 0, 1));
  const all = combos(tiers, codFee);
  if (n === 1) {
    const c = all.find((x) => Math.abs(x.total - value) <= TOLERANCE);
    return [c ? { hour, value, count: 1, status: 'match', sets: c.sets, cod: c.cod, cost: c.cost } : fallback('mismatch', value, 1)];
  }
  if (n <= MAX_SPLIT) {
    // n orders whose values add up to the hour's total, each a promo combination (multiset search, fewest sets first).
    const found: Combo[] = [];
    const dfs = (start: number, left: number, k: number): boolean => {
      if (k === 0) return Math.abs(left) <= TOLERANCE;
      for (let i = start; i < all.length; i++) {
        if (all[i].total > left + TOLERANCE) continue;
        found.push(all[i]);
        if (dfs(i, left - all[i].total, k - 1)) return true;
        found.pop();
      }
      return false;
    };
    if (dfs(0, value, n)) return found.map((c) => ({ hour, value: c.total, count: 1, status: 'match', sets: c.sets, cod: c.cod, cost: c.cost }));
  }
  return [fallback('unsplit', value, n)];
}

export interface CampaignDay {
  orders: Order[];
  count: number;
  value: number;
  cost: number;
  matched: number;
  /** Share of value that matched a promo (1 = every baht explained by the ad's promos) */
  match_rate: number;
}

export function campaignDay(hours: { hour: string; purchases: number; purchase_value: number }[], tiers: CostTier[], codFee: number): CampaignDay {
  const orders = hours.flatMap((h) => matchHour(h.hour, h.purchases, h.purchase_value, tiers, codFee));
  const value = orders.reduce((t, o) => t + o.value, 0);
  const matchedValue = orders.filter((o) => o.status === 'match').reduce((t, o) => t + o.value, 0);
  return {
    orders,
    count: orders.reduce((t, o) => t + o.count, 0),
    value,
    cost: orders.reduce((t, o) => t + o.cost, 0),
    matched: orders.filter((o) => o.status === 'match').length,
    match_rate: value > 0 ? matchedValue / value : 0,
  };
}
