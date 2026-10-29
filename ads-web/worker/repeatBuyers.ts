// Returning customers in the real orders (Page365): a customer is the hashed profile name (`name_hash`), so two
// people with the same Facebook name count as one, and history only goes back to the first uploaded day.
// A second bill the same day (a correction, an add-on) is not a return: only an order on an earlier day counts.

export interface DayRepeat {
  orders: number;
  returning: number;
  returning_aov: number | null;
  new_aov: number | null;
}

export interface WindowRepeat { customers: number; repeaters: number }

export interface RepeatStats { day: DayRepeat; window: WindowRepeat; days: number; since: string | null }

/** The day's paid orders split into returning (bought on an earlier day) and new customers. */
export function dayRepeat(orders: { name_hash: string | null; total: number }[], seenBefore: Set<string>): DayRepeat {
  const paid = orders.filter((o) => o.total > 0);
  const ret = paid.filter((o) => o.name_hash && seenBefore.has(o.name_hash));
  const fresh = paid.filter((o) => !(o.name_hash && seenBefore.has(o.name_hash)));
  const avg = (xs: { total: number }[]) => (xs.length ? xs.reduce((t, o) => t + o.total, 0) / xs.length : null);
  return { orders: paid.length, returning: ret.length, returning_aov: avg(ret), new_aov: avg(fresh) };
}

/** Yesterday's returning customers, plus the share of customers who bought on 2+ days in the last `days` days. */
export async function loadRepeat(db: D1Database, date: string, days = 30): Promise<RepeatStats> {
  const from = new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  const [today, seen, win, first] = await Promise.all([
    db.prepare('SELECT name_hash, total FROM p365_orders WHERE date = ?').bind(date).all<{ name_hash: string | null; total: number }>(),
    db.prepare(`SELECT DISTINCT p.name_hash FROM p365_orders p WHERE p.date < ?1 AND p.total > 0
      AND p.name_hash IN (SELECT name_hash FROM p365_orders WHERE date = ?1)`).bind(date).all<{ name_hash: string }>(),
    db.prepare(`SELECT count(*) customers, coalesce(sum(d > 1), 0) repeaters FROM (SELECT count(DISTINCT date) d FROM p365_orders
      WHERE date > ?1 AND date <= ?2 AND total > 0 AND name_hash IS NOT NULL GROUP BY name_hash)`).bind(from, date).first<WindowRepeat>(),
    db.prepare('SELECT min(date) d FROM p365_orders').first<{ d: string | null }>(),
  ]);
  return {
    day: dayRepeat(today.results, new Set(seen.results.map((r) => r.name_hash))),
    window: win ?? { customers: 0, repeaters: 0 },
    days,
    since: first?.d ?? null,
  };
}

export function repeatLine(r: RepeatStats): string {
  const b = (x: number) => Math.round(x).toLocaleString('th-TH');
  const pct = (a: number, n: number) => (n ? `${((a / n) * 100).toFixed(1)}%` : '–');
  const { day, window: w } = r;
  const aov = day.returning_aov !== null && day.new_aov !== null ? ` · ยอดต่อออเดอร์ ลูกค้าเก่า ${b(day.returning_aov)} / ใหม่ ${b(day.new_aov)}` : '';
  const since = r.since ? ` (นับจากไฟล์ตั้งแต่ ${r.since.slice(8)}/${r.since.slice(5, 7)})` : '';
  return `🔁 ลูกค้าเก่า ${day.returning}/${day.orders} ออเดอร์ (${pct(day.returning, day.orders)})${aov} · ซื้อซ้ำใน ${r.days} วัน ${b(w.repeaters)}/${b(w.customers)} คน (${pct(w.repeaters, w.customers)})${since}`;
}
