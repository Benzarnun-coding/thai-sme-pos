// Meta counts Page365's bill card ("ดูออเดอร์ / แจ้งโอน", a generic template sent by app Page365 when a bill is
// sent) as a purchase when we sent no sale for that customer in the 24 hours before (Benz 27 Oct). On weekdays the
// bill goes out the same day as the note, so nothing extra; weekend bills go out together on Monday morning and Meta
// counts them again (19 Oct +62, 26 Oct +150). The team keeps working this way, so those purchases are subtracted
// here (meta_adjustments, which costing, crediting and the rules on not-yet-uploaded days read). Never more than
// Meta's own excess for the hour. Ships off: meta_capi key `card_correction` = 'on' (owner) writes; otherwise dry run.

import type { Adjustment } from './metaAdjust.ts';
import type { HourCount } from './hourCheck.ts';
import { oursFor } from './hourCheck.ts';

export const PAGE365_APP = '237031236431724';
export const CARD_REASON = 'การ์ดบิล Page365 ที่ Meta นับเป็นยอดขาย';
/** A card counts when our last sale for the customer is older than this (or there is none). */
export const QUIET_HOURS = 24;

export interface Card { psid: string; at: string; campaign_id: string | null; last_sale: string | null }
export interface CampaignHour { campaign_id: string; hour: string; purchases: number; value: number }
export interface CardHour { hour: string; cards: number; counted: number; meta: number; ours: number; take: number }
export interface CardPlan { date: string; rows: Adjustment[]; hours: CardHour[]; purchases: number; value: number }

const hourOf = (iso: string) => `${new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(11, 13)}:00`;

/** Pure: which of Meta's purchases on `date` were bill cards, per campaign and hour. */
export function planCardCorrections(date: string, cards: Card[], meta: CampaignHour[], ours: HourCount[]): CardPlan {
  const quiet = (c: Card) => !c.last_sale || Date.parse(c.at) - Date.parse(c.last_sale) > QUIET_HOURS * 3_600_000;
  const hours = [...new Set(cards.map((c) => hourOf(c.at)))].sort();
  const rows: Adjustment[] = [], out: CardHour[] = [];
  for (const h of hours) {
    const inHour = cards.filter((c) => hourOf(c.at) === h);
    const counted = inHour.filter(quiet);
    const m = meta.filter((r) => r.hour.slice(0, 2) === h.slice(0, 2));
    const metaN = m.reduce((t, r) => t + r.purchases, 0), metaV = m.reduce((t, r) => t + r.value, 0);
    const o = ours.filter((r) => r.hour.slice(0, 2) === h.slice(0, 2));
    const oursN = o.reduce((t, r) => t + r.purchases, 0), oursV = o.reduce((t, r) => t + r.value, 0);
    const extra = Math.max(0, metaN - oursN);
    const take = Math.min(counted.length, extra);
    out.push({ hour: h, cards: inHour.length, counted: counted.length, meta: metaN, ours: oursN, take });
    if (!take) continue;
    const each = Math.max(0, metaV - oursV) / extra;
    // Each card on its customer's campaign while that campaign still has Meta purchases left in the hour; else unknown.
    const left = new Map(m.map((r) => [r.campaign_id, r.purchases]));
    const per = new Map<string, number>();
    for (const c of counted.slice(0, take)) {
      const k = c.campaign_id && (left.get(c.campaign_id) ?? 0) >= 1 ? c.campaign_id : '';
      if (k) left.set(k, left.get(k)! - 1);
      per.set(k, (per.get(k) ?? 0) + 1);
    }
    for (const [campaign_id, n] of per) rows.push({ date, campaign_id, hour: h, purchases: n, value: Math.round(n * each), reason: CARD_REASON });
  }
  return { date, rows, hours: out, purchases: rows.reduce((t, r) => t + r.purchases, 0), value: rows.reduce((t, r) => t + r.value, 0) };
}

/** Loads one Bangkok day and plans it; writes nothing. */
export async function cardCorrections(db: D1Database, date: string): Promise<CardPlan> {
  const from = new Date(`${date}T00:00:00+07:00`).toISOString(), to = new Date(Date.parse(from) + 86_400_000).toISOString();
  const [cards, meta] = await db.batch([
    db.prepare(`SELECT c.psid, c.at,
        (SELECT r.campaign_id FROM ad_referrals r WHERE r.psid = c.psid AND r.campaign_id IS NOT NULL AND r.at <= c.at ORDER BY r.at DESC LIMIT 1) AS campaign_id,
        (SELECT MAX(p.at) FROM note_purchases p WHERE p.psid = c.psid AND p.status = 'sent' AND p.at <= c.at) AS last_sale
      FROM chat_messages c WHERE c.from_page = 1 AND c.sender_app = ? AND c.attachments = 'template' AND c.at >= ? AND c.at < ? ORDER BY c.at`).bind(PAGE365_APP, from, to),
    db.prepare('SELECT campaign_id, hour, purchases, value FROM conversion_hours WHERE date = ?').bind(date),
  ]);
  return planCardCorrections(date, cards.results as Card[], meta.results as CampaignHour[], await oursFor(db, date));
}

export async function cardCorrectionOn(db: D1Database): Promise<boolean> {
  const r = await db.prepare("SELECT value FROM meta_capi WHERE key = 'card_correction'").first<{ value: string }>().catch(() => null);
  return r?.value === 'on';
}

/** Replaces the day's card corrections with a fresh plan — only when switched on. */
export async function applyCardCorrections(db: D1Database, dates: string[], by: string): Promise<CardPlan[]> {
  if (!(await cardCorrectionOn(db))) return [];
  const plans: CardPlan[] = [];
  for (const date of dates) {
    const p = await cardCorrections(db, date);
    await db.batch([
      db.prepare('DELETE FROM meta_adjustments WHERE date = ? AND reason = ?').bind(date, CARD_REASON),
      db.prepare(`INSERT OR REPLACE INTO meta_adjustments (date, campaign_id, hour, purchases, value, reason, created_by, created_at)
        SELECT value->>'date', value->>'campaign_id', value->>'hour', value->>'purchases', value->>'value', value->>'reason', ?, ? FROM json_each(?)`)
        .bind(by, new Date().toISOString(), JSON.stringify(p.rows)),
    ]);
    plans.push(p);
  }
  return plans;
}
