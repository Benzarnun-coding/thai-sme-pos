// Rules decide on real sales where we have them: for every day of a rule window whose Page365 file is uploaded,
// a campaign's Meta-reported purchases and purchase value (admin-tagged, ~92% complete) are swapped for the orders
// Page365 credited to it. Days not uploaded yet (and today) keep Meta's numbers, less the known-wrong purchases in
// meta_adjustments (e.g. Page365 bill cards Meta counts on Monday mornings, billCards.ts). Spend always comes from Meta.

import type { CampaignDayRow } from '../../ads-engine/src/meta.ts';
import type { Entity, Window } from '../../ads-engine/src/types.ts';
import { windowDates } from './conversionStore.ts';
import { loadOrders, loadUploads, type StoredOrder } from './p365.ts';
import { loadAdjustments, type Adjustment } from './metaAdjust.ts';

/** Windows the overlay touches: the short ones rules use for decisions (longer ones feed the economics estimate). */
const OVERLAY: Window[] = ['yesterday', 'last_3d', 'last_7d', 'last_14d'];

/**
 * A day is trusted only when most of its orders were credited to some campaign; otherwise (hourly purchases not
 * synced, a bad file) every campaign would look like it sold nothing, and the rules would cut the lot.
 */
export const MIN_CREDITED_SHARE = 0.8;

export interface DayActual { revenue: number; orders: number }

/** Per date, per campaign: real revenue and orders, for the dates that are uploaded and credited well enough. */
export function actualDays(orders: StoredOrder[], uploaded: Set<string>): { days: Map<string, Map<string, DayActual>>; weak: string[] } {
  const byDate = new Map<string, StoredOrder[]>();
  for (const o of orders) if (uploaded.has(o.date)) byDate.set(o.date, [...(byDate.get(o.date) ?? []), o]);
  const days = new Map<string, Map<string, DayActual>>();
  const weak: string[] = [];
  for (const date of [...uploaded].sort()) {
    const list = byDate.get(date) ?? [];
    const credited = list.filter((o) => o.match !== 'none' && o.campaign_id);
    if (!list.length || credited.length / list.length < MIN_CREDITED_SHARE) { weak.push(date); continue; }
    const m = new Map<string, DayActual>();
    for (const o of credited) {
      const a = m.get(o.campaign_id!) ?? { revenue: 0, orders: 0 };
      a.revenue += o.total; a.orders++;
      m.set(o.campaign_id!, a);
    }
    days.set(date, m);
  }
  return { days, weak };
}

/**
 * Rewrites campaign metrics in place for the given windows. Returns a note per window for the run report, e.g.
 * "last_3d: ยอดจริง Page365 3/3 วัน".
 */
export function overlayActual(
  entities: Entity[], windows: Window[], now: number,
  days: Map<string, Map<string, DayActual>>, meta: CampaignDayRow[], adj: Adjustment[] = [],
): string[] {
  const metaDay = new Map(meta.map((r) => [`${r.campaign_id}|${r.date}`, r]));
  // Corrections per campaign and day, for the days that keep Meta's numbers.
  const fix = new Map<string, { purchases: number; value: number }>();
  for (const a of adj) {
    if (!a.campaign_id) continue;
    const k = `${a.campaign_id}|${a.date}`, cur = fix.get(k) ?? { purchases: 0, value: 0 };
    fix.set(k, { purchases: cur.purchases + a.purchases, value: cur.value + a.value });
  }
  const notes: string[] = [];
  for (const w of windows) {
    const dates = windowDates(w, now);
    const real = dates.filter((d) => days.has(d));
    const fixed = dates.filter((d) => !days.has(d) && adj.some((a) => a.date === d && a.campaign_id));
    if (!real.length && !fixed.length) continue;
    for (const e of entities) {
      const m = e.level === 'campaign' ? e.metrics[w] : undefined;
      if (!m) continue;
      let value = m.purchase_value, purchases = m.purchases;
      for (const d of real) {
        const r = metaDay.get(`${e.id}|${d}`);
        const a = days.get(d)!.get(e.id);
        value += (a?.revenue ?? 0) - (r?.purchase_value ?? 0);
        purchases += (a?.orders ?? 0) - (r?.purchases ?? 0);
      }
      for (const d of fixed) {
        const f = fix.get(`${e.id}|${d}`);
        if (f) { value -= f.value; purchases -= f.purchases; }
      }
      value = Math.max(0, value); purchases = Math.max(0, purchases);
      e.metrics[w] = { ...m, purchase_value: value, purchases, roas: m.spend > 0 ? value / m.spend : 0, cpa: purchases > 0 ? m.spend / purchases : Infinity };
    }
    const n = adj.filter((a) => fixed.includes(a.date) && a.campaign_id).reduce((t, a) => t + a.purchases, 0);
    notes.push(`${w}: ยอดจริง Page365 ${real.length}/${dates.length} วัน${real.length < dates.length ? ' (ที่เหลือใช้ยอดแท็ก Meta)' : ''}${n ? ` · หักยอดที่ Meta นับเกิน ${n} (${fixed.join(', ')})` : ''}`);
  }
  return notes;
}

/** Loads what the overlay needs and applies it; never throws (falls back to Meta's numbers with a note). */
export async function applyActual(
  db: D1Database, entities: Entity[], windows: Window[], daily: (w: Window) => Promise<CampaignDayRow[]>, now: Date,
): Promise<string[]> {
  const use = windows.filter((w) => OVERLAY.includes(w));
  if (!use.length) return [];
  try {
    const all = [...new Set(use.flatMap((w) => windowDates(w, now.getTime())))];
    const [uploads, adj] = await Promise.all([loadUploads(db, all), loadAdjustments(db, all)]);
    if (!uploads.size && !adj.length) return ['ยังไม่มีไฟล์ Page365 ในช่วงที่กฎดู — ตัดสินจากยอดแท็ก Meta'];
    const { days, weak } = uploads.size ? actualDays(await loadOrders(db, [...uploads.keys()]), new Set(uploads.keys())) : { days: new Map<string, Map<string, DayActual>>(), weak: [] as string[] };
    const notes = weak.length ? [`ไฟล์ Page365 ${weak.join(', ')} จับคู่แอดได้ไม่ถึง ${MIN_CREDITED_SHARE * 100}% — วันนั้นใช้ยอดแท็ก Meta`] : [];
    if (!days.size && !adj.some((a) => a.campaign_id)) return notes;
    // One Meta call covers every window: the longest one in use.
    const longest = use.reduce((a, b) => (windowDates(a, now.getTime()).length >= windowDates(b, now.getTime()).length ? a : b));
    const meta = await daily(longest);
    return [...notes, `ตัดสินจากยอดขายจริง — ${overlayActual(entities, use, now.getTime(), days, meta, adj).join(' · ')}`];
  } catch (err: any) {
    return [`ใช้ยอดจริง Page365 ไม่ได้ (${err?.message ?? err}) — ตัดสินจากยอดแท็ก Meta`];
  }
}
