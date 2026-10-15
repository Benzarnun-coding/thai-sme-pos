// Corrections to Meta's purchases for days we know are wrong (per Bangkok day × campaign × hour). Meta can't
// delete events, so e.g. the 87 duplicate purchases sent on 2026-10-15 stay in Meta forever; here they are
// subtracted from Meta's hourly purchases wherever we use them (crediting Page365 orders to campaigns, costing
// order by order). Rule windows on uploaded days already use real Page365 sales and need nothing.

export interface Adjustment { date: string; campaign_id: string; hour: string; purchases: number; value: number; reason: string }

export async function loadAdjustments(db: D1Database, dates: string[]): Promise<Adjustment[]> {
  if (!dates.length) return [];
  const { results } = await db.prepare('SELECT date, campaign_id, hour, purchases, value, reason FROM meta_adjustments WHERE date IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(dates)).all<Adjustment>().catch(() => ({ results: [] as Adjustment[] }));
  return results;
}

/** Meta's hourly rows minus the corrections for the same day, campaign and hour (never below zero). */
export function subtractAdjustments<T extends { date: string; campaign_id: string; hour: string; purchases: number }>(rows: T[], adj: Adjustment[], valueKey: keyof T): T[] {
  if (!adj.length) return rows;
  const by = new Map<string, { purchases: number; value: number }>();
  for (const a of adj) {
    const k = `${a.date}|${a.campaign_id}|${a.hour.slice(0, 2)}`;
    const cur = by.get(k) ?? { purchases: 0, value: 0 };
    by.set(k, { purchases: cur.purchases + a.purchases, value: cur.value + a.value });
  }
  return rows.map((r) => {
    const a = by.get(`${r.date}|${r.campaign_id}|${r.hour.slice(0, 2)}`);
    if (!a) return r;
    return { ...r, purchases: Math.max(0, r.purchases - a.purchases), [valueKey]: Math.max(0, Number(r[valueKey]) - a.value) };
  });
}

/**
 * The corrections for purchases we sent ourselves by mistake: each row of meta_purchases sent in the given span,
 * at its bill's Bangkok day and hour, on the campaign of the customer's latest ad chat before the bill.
 */
export async function seedFromSent(db: D1Database, from: string, to: string, reason: string, by: string): Promise<{ rows: number; purchases: number; value: number }> {
  const { results } = await db.prepare(`SELECT p.psid, p.value, p.event_time,
      (SELECT r.campaign_id FROM ad_referrals r WHERE r.psid = p.psid AND r.campaign_id IS NOT NULL AND r.at <= datetime(p.event_time) ORDER BY r.at DESC LIMIT 1) AS campaign_id
    FROM meta_purchases p WHERE p.status IN ('sent', 'test') AND p.sent_at >= ? AND p.sent_at <= ?`).bind(from, to)
    .all<{ psid: string; value: number; event_time: string; campaign_id: string | null }>();
  const agg = new Map<string, Adjustment>();
  for (const r of results) {
    const t = new Date(Date.parse(r.event_time) + 7 * 3_600_000).toISOString();
    const a: Adjustment = { date: t.slice(0, 10), campaign_id: r.campaign_id ?? '', hour: `${t.slice(11, 13)}:00`, purchases: 0, value: 0, reason };
    const k = `${a.date}|${a.campaign_id}|${a.hour}`;
    const cur = agg.get(k) ?? a;
    cur.purchases += 1; cur.value += Number(r.value) || 0;
    agg.set(k, cur);
  }
  const rows = [...agg.values()];
  if (rows.length) {
    await db.prepare(`INSERT OR REPLACE INTO meta_adjustments (date, campaign_id, hour, purchases, value, reason, created_by, created_at)
      SELECT value->>'date', value->>'campaign_id', value->>'hour', value->>'purchases', value->>'value', value->>'reason', ?, ? FROM json_each(?)`)
      .bind(by, new Date().toISOString(), JSON.stringify(rows)).run();
  }
  return { rows: rows.length, purchases: rows.reduce((t, r) => t + r.purchases, 0), value: rows.reduce((t, r) => t + r.value, 0) };
}

/** Per day: what is being subtracted, for the settings page. */
export async function adjustmentDays(db: D1Database): Promise<{ date: string; reason: string; purchases: number; value: number; campaigns: number; unknown: number }[]> {
  const { results } = await db.prepare(`SELECT date, reason, SUM(purchases) purchases, SUM(value) value, COUNT(DISTINCT NULLIF(campaign_id, '')) campaigns,
      SUM(CASE WHEN campaign_id = '' THEN purchases ELSE 0 END) unknown FROM meta_adjustments GROUP BY date, reason ORDER BY date DESC`).all<any>().catch(() => ({ results: [] }));
  return results;
}
