// Meta's purchases hour by hour vs the sales we sent it (Benz 2026-10-27). Since 15 Oct every sale reaches Meta from
// our note sender (notePurchases.ts), so an hour where Meta counts many more than we sent was filled by something
// else — 19 and 26 Oct (Mondays 08–10): Meta 81 at 09:00 vs our 9. Dry run only: the Discord text is shown on the
// settings page and never posted (posting ships off until Benz switches it on).

import { bkkDate } from './conversionStore.ts';
import type { HourlyConversion } from '../../ads-engine/src/meta.ts';

export interface HourCount { hour: string; purchases: number; value: number }
export interface HourDiff { hour: string; meta: number; meta_value: number; ours: number; ours_value: number; extra: number; flagged: boolean }
export interface DayCheck { date: string; source: 'stored' | 'live' | 'none'; hours: HourDiff[]; meta: number; meta_value: number; ours: number; ours_value: number; flagged: HourDiff[] }

/** An hour is flagged when Meta counts at least this many more than we sent, and at least 1.5× ours. */
export const MIN_EXTRA = 10;
const MIN_RATIO = 1.5;

/** Pure: per hour, Meta vs ours, flagged where Meta has clearly more. */
export function compareHours(meta: HourCount[], ours: HourCount[]): Omit<DayCheck, 'date' | 'source'> {
  const by = new Map<string, HourDiff>();
  const at = (h: string) => by.get(h) ?? by.set(h, { hour: h, meta: 0, meta_value: 0, ours: 0, ours_value: 0, extra: 0, flagged: false }).get(h)!;
  for (const m of meta) { const r = at(m.hour); r.meta += m.purchases; r.meta_value += m.value; }
  for (const o of ours) { const r = at(o.hour); r.ours += o.purchases; r.ours_value += o.value; }
  const hours = [...by.values()].sort((a, b) => a.hour.localeCompare(b.hour));
  for (const r of hours) {
    r.extra = r.meta - r.ours;
    r.flagged = r.extra >= MIN_EXTRA && r.meta >= MIN_RATIO * r.ours;
  }
  const sum = (f: (r: HourDiff) => number) => hours.reduce((t, r) => t + f(r), 0);
  return { hours, meta: sum((r) => r.meta), meta_value: sum((r) => r.meta_value), ours: sum((r) => r.ours), ours_value: sum((r) => r.ours_value), flagged: hours.filter((r) => r.flagged) };
}

const b = (x: number) => Math.round(x).toLocaleString('th-TH');
const thaiDay = (date: string) => new Date(`${date}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });

/** What would go to Discord for a day; null when no hour is flagged. */
export function hourCheckText(d: DayCheck): string | null {
  if (!d.flagged.length) return null;
  const extra = d.flagged.reduce((t, r) => t + r.extra, 0);
  return [
    `🔎 **Meta นับยอดขายเกินที่ระบบส่ง · ${thaiDay(d.date)}** — Meta ${b(d.meta)} ยอด / เราส่ง ${b(d.ours)} (เกิน ${b(d.meta - d.ours)})`,
    d.flagged.map((r) => `${r.hour.slice(0, 2)} น. Meta ${b(r.meta)} / เรา ${b(r.ours)}`).join(' · '),
    `ส่วนเกิน ${b(extra)} ยอดในชั่วโมงนี้ไม่ได้มาจากสรุปของแอดมิน — ช่วยเช็กว่ามีใครกด Create order หรือจัดการออเดอร์ใน Inbox ของ Meta ช่วงนั้นไหม (ยอดจริงดูจาก Page365)`,
  ].join('\n');
}

/** Hours of `date` (Bangkok) for an ISO time column, as "HH:00" like Meta's hourly breakdown. */
const hourSql = (col: string) => `substr(datetime(${col}, '+7 hours'), 12, 2) || ':00'`;

async function oursFor(db: D1Database, date: string): Promise<HourCount[]> {
  const from = new Date(`${date}T00:00:00+07:00`).toISOString(), to = new Date(Date.parse(from) + 86_400_000).toISOString();
  // Note sales (the live sender) plus any bill sales (the older sender), by the event time Meta got.
  const [n, p] = await db.batch([
    db.prepare(`SELECT ${hourSql('at')} hour, COUNT(*) purchases, SUM(value) value FROM note_purchases WHERE status = 'sent' AND at >= ? AND at < ? GROUP BY 1`).bind(from, to),
    db.prepare(`SELECT ${hourSql('event_time')} hour, COUNT(*) purchases, SUM(value) value FROM meta_purchases WHERE status = 'sent' AND event_time >= ? AND event_time < ? GROUP BY 1`).bind(from, to),
  ]);
  return [...(n.results as HourCount[]), ...(p.results as HourCount[])];
}

/**
 * Dates from..to (≤ 14): Meta's hours from the stored copy (conversion_hours, raw — not the corrections), or fetched
 * live for today and up to 3 days not stored. Nothing is written.
 */
export async function hourCheck(db: D1Database, meta: { hourlyConversions(date: string): Promise<HourlyConversion[]> }, dates: string[]): Promise<DayCheck[]> {
  const { results: stored } = await db.prepare('SELECT date FROM conversion_days WHERE date IN (SELECT value FROM json_each(?))').bind(JSON.stringify(dates)).all<{ date: string }>();
  const have = new Set(stored.map((r) => r.date));
  let live = 0;
  const out: DayCheck[] = [];
  for (const date of dates) {
    let source: DayCheck['source'] = 'none', m: HourCount[] = [];
    if (have.has(date) && date !== bkkDate(0)) {
      const { results } = await db.prepare('SELECT hour, SUM(purchases) purchases, SUM(value) value FROM conversion_hours WHERE date = ? GROUP BY hour').bind(date).all<HourCount>();
      m = results; source = 'stored';
    } else if (live < 3) {
      live++;
      const rows = await meta.hourlyConversions(date).catch(() => null);
      if (rows) { m = rows.map((r) => ({ hour: r.hour, purchases: r.purchases, value: r.purchase_value })); source = 'live'; }
    }
    out.push({ date, source, ...compareHours(m, source === 'none' ? [] : await oursFor(db, date)) });
  }
  return out;
}
