// Stored hourly purchases (see migration 0008) and how pages cost a window with them.

import type { HourlyConversion } from '../../ads-engine/src/meta.ts';
import type { Window } from '../../ads-engine/src/types.ts';
import type { CostTier } from './campaignCosts.ts';
import type { MetaLike } from './run.ts';
import { campaignDay } from './transactions.ts';

const DAY = 86_400_000;
/** The ad account reports in Bangkok time. */
export const bkkDate = (offsetDays = 0, now = Date.now()) => new Date(now + 7 * 3_600_000 - offsetDays * DAY).toISOString().slice(0, 10);

/** Dates Meta's presets cover: last_Nd = the N days before today; today/yesterday as named. */
export function windowDates(window: Window, now = Date.now()): string[] {
  const n: Record<Window, [number, number]> = { today: [0, 0], yesterday: [1, 1], last_3d: [3, 1], last_7d: [7, 1], last_14d: [14, 1], last_30d: [30, 1] };
  const [from, to] = n[window];
  const out: string[] = [];
  for (let d = from; d >= to; d--) out.push(bkkDate(d, now));
  return out;
}

export async function saveConversionDay(db: D1Database, date: string, rows: HourlyConversion[]): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM conversion_hours WHERE date = ?').bind(date),
    db.prepare(
      `INSERT INTO conversion_hours (date, campaign_id, hour, purchases, value)
       SELECT ?1, value ->> '$.campaign_id', value ->> '$.hour', value ->> '$.purchases', value ->> '$.purchase_value' FROM json_each(?2)
       WHERE true ON CONFLICT(date, campaign_id, hour) DO UPDATE SET purchases = excluded.purchases, value = excluded.value`,
    ).bind(date, JSON.stringify(rows)),
    db.prepare('INSERT INTO conversion_days (date, fetched_at) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET fetched_at = excluded.fetched_at').bind(date, new Date().toISOString()),
  ]);
}

export type HourRow = { date: string; hour: string; purchases: number; purchase_value: number };

/** Stored hours for the dates, per campaign, plus which of the dates are stored at all. */
export async function loadConversionHours(db: D1Database, dates: string[]): Promise<{ byCampaign: Map<string, HourRow[]>; stored: Set<string> }> {
  const [h, d] = await db.batch([
    db.prepare('SELECT * FROM conversion_hours WHERE date IN (SELECT value FROM json_each(?))').bind(JSON.stringify(dates)),
    db.prepare('SELECT date FROM conversion_days WHERE date IN (SELECT value FROM json_each(?))').bind(JSON.stringify(dates)),
  ]);
  const byCampaign = new Map<string, HourRow[]>();
  for (const r of h.results as { date: string; campaign_id: string; hour: string; purchases: number; value: number }[]) {
    byCampaign.set(r.campaign_id, [...(byCampaign.get(r.campaign_id) ?? []), { date: r.date, hour: r.hour, purchases: r.purchases, purchase_value: r.value }]);
  }
  return { byCampaign, stored: new Set((d.results as { date: string }[]).map((r) => r.date)) };
}

/**
 * Refreshes recent days (late tags) and fills older missing days, a few per call to stay inside the free plan's
 * outbound-request budget (each day is 1–3 Meta pages).
 */
export async function syncConversionHours(db: D1Database, meta: MetaLike, opts: { recent?: number; backfill?: number; keepDays?: number } = {}): Promise<{ fetched: string[]; missing: number; errors: string[] }> {
  const recent = opts.recent ?? 3, backfill = opts.backfill ?? 5, keep = opts.keepDays ?? 30;
  const wanted = Array.from({ length: keep }, (_, i) => bkkDate(i + 1));
  const { results } = await db.prepare('SELECT date FROM conversion_days WHERE date IN (SELECT value FROM json_each(?))').bind(JSON.stringify(wanted)).all<{ date: string }>();
  const have = new Set(results.map((r) => r.date));
  const todo = [...new Set([...wanted.slice(0, recent), ...wanted.filter((d) => !have.has(d)).slice(0, backfill)])];
  const fetched: string[] = [], errors: string[] = [];
  for (const date of todo) {
    try { await saveConversionDay(db, date, await meta.hourlyConversions(date)); fetched.push(date); }
    catch (err: any) { errors.push(`${date}: ${err?.message ?? err}`); break; } // rate limited: stop, try next run
  }
  const missing = wanted.filter((d) => !have.has(d) && !fetched.includes(d)).length;
  await db.prepare('DELETE FROM conversion_hours WHERE date < ?').bind(bkkDate(keep + 5)).run();
  return { fetched, missing, errors };
}

export interface TxCosting {
  /** cost ÷ value and pieces ÷ value from the matched orders, applied to the window's revenue */
  cost_ratio: number;
  units_per_baht: number;
  orders: number;
  matched: number;
  match_rate: number;
  /** How many of the window's days had stored hours */
  days: number;
}

/** Order-by-order costing of one campaign's stored hours in a window; null when nothing is stored or no promos. */
export function txCosting(hours: HourRow[] | undefined, tiers: CostTier[], codFee: number, storedDays: number): TxCosting | null {
  if (!hours?.length || !tiers.length) return null;
  const d = campaignDay(hours.map((h) => ({ hour: `${h.date} ${h.hour}`, purchases: h.purchases, purchase_value: h.purchase_value })), tiers, codFee);
  if (d.value <= 0) return null;
  return { cost_ratio: d.cost / d.value, units_per_baht: d.units / d.value, orders: d.count, matched: d.matched, match_rate: d.match_rate, days: storedDays };
}
