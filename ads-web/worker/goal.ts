// Monthly net-profit goal (Benz, 14 Oct 2026: 120,000/month after product cost, per-order fees and ads) and the
// weekly cap check that goes with it: the shop-wide daily budget cap may grow 20% a week, only when the real
// 7-day MER (Page365 revenue ÷ Meta spend) is at least the MER the goal needs, and only after a button press.

import { orderFees, type StoredOrder } from './p365.ts';
import type { OrderFees } from './db.ts';

export interface Goal {
  /** Net profit per month (revenue − product cost − per-order fees − ads) */
  monthly_net: number;
  /** Real 7-day MER needed before the daily budget cap may grow */
  scale_mer: number;
  /** How much the cap grows per approved step (%) */
  scale_pct: number;
}
export const DEFAULT_GOAL: Goal = { monthly_net: 120_000, scale_mer: 3.86, scale_pct: 20 };

export interface DayNet { date: string; revenue: number; cost: number; fees: number; ads: number; net: number; orders: number; units: number; multi: number }

/** One uploaded day's real numbers. */
export function dayNet(date: string, orders: StoredOrder[], fees: OrderFees, ads: number): DayNet {
  const revenue = orders.reduce((t, o) => t + o.total, 0);
  const cost = orders.reduce((t, o) => t + (o.cost ?? 0), 0);
  const f = orders.reduce((t, o) => t + orderFees(o, fees), 0);
  return { date, revenue, cost, fees: f, ads, net: revenue - cost - f - ads, orders: orders.length, units: orders.reduce((t, o) => t + o.units, 0), multi: orders.filter((o) => o.units >= 2).length };
}

export interface GoalStatus {
  month: string;              // YYYY-MM
  goal: Goal;
  days_in_month: number;
  /** Days of the month so far (up to yesterday) */
  elapsed: string[];
  /** Of those, the days with a Page365 file */
  days: DayNet[];
  missing: string[];
  net: number;                // real net of the uploaded days
  revenue: number;
  ads: number;
  avg_net: number | null;     // per uploaded day
  /** Net if the rest of the month (and the missing days) runs at the average so far */
  projected: number | null;
  /** Per day for every day not yet counted (missing + remaining) to reach the goal */
  needed_per_day: number;
  /** Gross margin before ads of the uploaded days (revenue − cost − fees) ÷ revenue */
  gross_margin: number | null;
  mer: number | null;
  /** Revenue per day the goal needs at the current gross margin and scale MER */
  target_revenue_per_day: number | null;
  /** Real MER of the last 7 days (needs ≥ 6 uploaded days) */
  mer_7d: number | null;
  mer_7d_days: number;
  /** Share of orders with 2+ pieces (the admins' upsell), month so far and last 7 days; pieces per order */
  multi_share: number | null;
  multi_share_7d: number | null;
  units_per_order: number | null;
}

export function goalStatus(month: string, daysInMonth: number, elapsed: string[], days: DayNet[], last7: DayNet[], goal: Goal): GoalStatus {
  const sum = (k: keyof Omit<DayNet, 'date'>, list: DayNet[] = days) => list.reduce((t, d) => t + d[k], 0);
  const net = sum('net'), revenue = sum('revenue'), ads = sum('ads');
  const counted = new Set(days.map((d) => d.date));
  const missing = elapsed.filter((d) => !counted.has(d));
  const avg = days.length ? net / days.length : null;
  const uncounted = daysInMonth - days.length;
  const gross = revenue ? (revenue - sum('cost') - sum('fees')) / revenue : null;
  // Net = revenue × (gross − 1/MER) → revenue = net ÷ (gross − 1/MER)
  const perDay = goal.monthly_net / daysInMonth;
  const spread = gross !== null ? gross - 1 / goal.scale_mer : null;
  const r7 = sum('revenue', last7), a7 = sum('ads', last7);
  return {
    month, goal, days_in_month: daysInMonth, elapsed, days, missing, net, revenue, ads,
    avg_net: avg,
    projected: avg === null ? null : net + avg * uncounted,
    needed_per_day: uncounted > 0 ? Math.max(0, goal.monthly_net - net) / uncounted : 0,
    gross_margin: gross,
    mer: ads ? revenue / ads : null,
    target_revenue_per_day: spread && spread > 0 ? perDay / spread : null,
    mer_7d: last7.length >= 6 && a7 ? r7 / a7 : null,
    mer_7d_days: last7.length,
    multi_share: sum('orders') ? sum('multi') / sum('orders') : null,
    multi_share_7d: sum('orders', last7) ? sum('multi', last7) / sum('orders', last7) : null,
    units_per_order: sum('orders') ? sum('units') / sum('orders') : null,
  };
}

/** Next cap after one approved step, rounded to 100. */
export const nextCap = (cap: number, pct: number) => Math.round((cap * (1 + pct / 100)) / 100) * 100;

/** Month (YYYY-MM) a Bangkok date belongs to, its day count and its dates up to and including `last`. */
export function monthDates(last: string): { month: string; daysInMonth: number; dates: string[] } {
  const [y, m] = last.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dates: string[] = [];
  for (let d = 1; d <= Number(last.slice(8, 10)); d++) dates.push(`${last.slice(0, 8)}${String(d).padStart(2, '0')}`);
  return { month: last.slice(0, 7), daysInMonth, dates };
}
