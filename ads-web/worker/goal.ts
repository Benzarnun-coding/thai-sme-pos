// Main goal (Benz, 15 Nov 2026): sales of 100,000,000 baht a year — revenue, not profit — tracked month by month as
// a twelfth of it. The monthly net-profit goal stays next to it as the second goal.
// Monthly net-profit goal (Benz, 14 Oct 2026: 120,000/month after product cost, per-order fees and ads) and the
// weekly cap check that goes with it: the shop-wide daily budget cap may grow 20% a week, only when the real
// 7-day MER (Page365 revenue ÷ Meta spend) is at least the MER the goal needs, and only after a button press.

import { orderFees, type StoredOrder } from './p365.ts';
import type { OrderFees } from './db.ts';

export interface Goal {
  /** Main goal: sales (revenue) per year; each month's sales target is a twelfth of it */
  yearly_sales: number;
  /** Net profit per month (revenue − product cost − per-order fees − ads) */
  monthly_net: number;
  /** Real 7-day MER needed before the daily budget cap may grow */
  scale_mer: number;
  /** How much the cap grows per approved step (%) */
  scale_pct: number;
}
export const DEFAULT_GOAL: Goal = { yearly_sales: 100_000_000, monthly_net: 120_000, scale_mer: 3.86, scale_pct: 20 };

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
  /** Main goal, sales (revenue) only — its % is against the sales target, never the profit one */
  sales: SalesStatus;
  /** Main goal, year to date (1 Jan → yesterday) against the full yearly sales target; null when not loaded */
  ytd: YtdStatus | null;
}

export interface YtdStatus {
  year: string;               // YYYY
  from: string;               // YYYY-01-01
  to: string;                 // last counted day (yesterday)
  target: number;             // the yearly sales target
  /** Real Page365 revenue of the uploaded days from 1 Jan */
  revenue: number;
  /** revenue ÷ target × 100, not capped */
  pct: number;
  days_elapsed: number;
  days_in_year: number;
  /** Where the year should be by now, by share of time: target × days_elapsed ÷ days_in_year */
  pace: number;
  /** revenue − pace (negative = behind) */
  gap: number;
  /** Days from 1 Jan with a Page365 file; the rest count as 0 revenue */
  uploaded_days: number;
  /** The same pace counted only over the uploaded days (target ÷ days_in_year × uploaded_days) */
  pace_uploaded: number;
  /** Year-end revenue if every day not yet counted runs at the uploaded days' average */
  projected: number | null;
  /** Revenue per day still needed for the rest of the year (after `to`) */
  needed_per_day: number;
}

/** Year to date against the yearly sales target. `days` = revenue of each uploaded day between 1 Jan and `to`. */
export function ytdStatus(yearly: number, to: string, days: { date: string; revenue: number }[]): YtdStatus {
  const year = to.slice(0, 4), from = `${year}-01-01`;
  const counted = days.filter((d) => d.date >= from && d.date <= to);
  const y = Number(year);
  const daysInYear = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
  const elapsed = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000) + 1;
  const revenue = counted.reduce((t, d) => t + d.revenue, 0);
  const pace = (yearly * elapsed) / daysInYear;
  const left = daysInYear - elapsed;
  return {
    year, from, to, target: yearly, revenue,
    pct: yearly ? (revenue / yearly) * 100 : 0,
    days_elapsed: elapsed, days_in_year: daysInYear, pace, gap: revenue - pace,
    uploaded_days: counted.length,
    pace_uploaded: (yearly * counted.length) / daysInYear,
    projected: counted.length ? revenue + (revenue / counted.length) * (daysInYear - counted.length) : null,
    needed_per_day: left > 0 ? Math.max(0, yearly - revenue) / left : 0,
  };
}

export interface SalesStatus {
  yearly_target: number;
  /** yearly_target ÷ 12 */
  monthly_target: number;
  /** Real revenue of the uploaded days this month (same as GoalStatus.revenue) */
  revenue: number;
  /** revenue ÷ monthly_target × 100, not capped */
  pct: number;
  /** Where revenue should be by now: monthly_target × elapsed days ÷ days in month */
  pace: number;
  /** Revenue if the uncounted days run at the uploaded days' average */
  projected: number | null;
  /** Revenue per uncounted day still needed for the month's sales target */
  needed_per_day: number;
}

export function salesStatus(yearly: number, daysInMonth: number, elapsed: number, days: DayNet[]): SalesStatus {
  const monthly = yearly / 12;
  const revenue = days.reduce((t, d) => t + d.revenue, 0);
  const uncounted = daysInMonth - days.length;
  return {
    yearly_target: yearly, monthly_target: monthly, revenue,
    pct: monthly ? (revenue / monthly) * 100 : 0,
    pace: (monthly * elapsed) / daysInMonth,
    projected: days.length ? revenue + (revenue / days.length) * uncounted : null,
    needed_per_day: uncounted > 0 ? Math.max(0, monthly - revenue) / uncounted : 0,
  };
}

export function goalStatus(month: string, daysInMonth: number, elapsed: string[], days: DayNet[], last7: DayNet[], goal: Goal, ytd: YtdStatus | null = null): GoalStatus {
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
    sales: salesStatus(goal.yearly_sales ?? DEFAULT_GOAL.yearly_sales, daysInMonth, elapsed.length, days),
    ytd,
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
