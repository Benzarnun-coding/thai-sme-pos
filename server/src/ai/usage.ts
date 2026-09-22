/**
 * The token meter.
 *
 * Every assistant message stores its token counts; this module turns them into
 * baht per box per day, and answers "are we over this month's AI cap". Prices
 * are per million tokens in USD (Anthropic list prices); the baht rate is a
 * setting. Demo-mode calls store an estimate so the meter still teaches the
 * owner what a day of runs would cost.
 */
import type { Db } from '../db/client.js';
import { aiMode } from './llm.js';

/** USD per 1M tokens: input, output, cache read, cache write. */
export const PRICES: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5': { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5': { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-4-5': { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-fable-5-1': { in: 10, out: 50, cacheRead: 0.25, cacheWrite: 12.5 },
};
const DEFAULT_PRICE = PRICES['claude-opus-5'];
export const THB_PER_USD = () => Number(process.env.LOOPDESK_THB_PER_USD ?? 35);

export function costUsd(model: string | null, t: { tokens_in?: number | null; tokens_out?: number | null; cache_read?: number | null; cache_write?: number | null }) {
  const p = PRICES[(model ?? '').replace(/^demo:/, '')] ?? DEFAULT_PRICE;
  return ((t.tokens_in ?? 0) * p.in + (t.tokens_out ?? 0) * p.out + (t.cache_read ?? 0) * p.cacheRead + (t.cache_write ?? 0) * p.cacheWrite) / 1e6;
}

interface Row { slug: string; name: string; emoji: string | null; model: string | null; day: string; calls: number; tokens_in: number; tokens_out: number; cache_read: number; cache_write: number }

async function rows(db: Db, storeId: string, sinceDays: number): Promise<Row[]> {
  return db.query<Row>(
    `select a.slug, a.name, a.emoji, m.model, to_char(m.created_at, 'YYYY-MM-DD') as day, count(*)::int as calls,
            coalesce(sum(m.tokens_in),0)::int as tokens_in, coalesce(sum(m.tokens_out),0)::int as tokens_out,
            coalesce(sum(m.cache_read),0)::int as cache_read, coalesce(sum(m.cache_write),0)::int as cache_write
       from agent_message m join agent_thread t on t.id = m.thread_id join agent a on a.id = t.agent_id
      where a.store_id=$1 and m.role='assistant' and m.created_at >= now() - ($2 || ' days')::interval
      group by a.slug, a.name, a.emoji, m.model, day order by day`, [storeId, String(sinceDays)]);
}

export async function aiCap(db: Db, storeId: string): Promise<number | null> {
  const r = await db.query<{ settings: { aiMonthlyCap?: number } | null }>('select settings from store where id=$1', [storeId]);
  const v = r[0]?.settings?.aiMonthlyCap;
  return typeof v === 'number' && v > 0 ? v : null;
}

/** Baht spent on the model this calendar month (demo estimates count as 0 toward the cap). */
export async function monthSpendThb(db: Db, storeId: string): Promise<number> {
  const r = await db.query<{ model: string | null; tokens_in: number; tokens_out: number; cache_read: number; cache_write: number }>(
    `select m.model, coalesce(sum(m.tokens_in),0)::int as tokens_in, coalesce(sum(m.tokens_out),0)::int as tokens_out,
            coalesce(sum(m.cache_read),0)::int as cache_read, coalesce(sum(m.cache_write),0)::int as cache_write
       from agent_message m join agent_thread t on t.id = m.thread_id join agent a on a.id = t.agent_id
      where a.store_id=$1 and m.role='assistant' and m.mode='claude' and m.created_at >= date_trunc('month', now())
      group by m.model`, [storeId]);
  return r.reduce((s, x) => s + costUsd(x.model, x) * THB_PER_USD(), 0);
}

/** Null when fine; a Thai sentence when the cap is reached (only enforced when a real model is in use). */
export async function capReached(db: Db, storeId: string): Promise<string | null> {
  if (aiMode() !== 'claude') return null;
  const cap = await aiCap(db, storeId);
  if (!cap) return null;
  const spent = await monthSpendThb(db, storeId);
  return spent >= cap ? `ถึงเพดาน AI รายเดือน ฿${cap.toLocaleString('th-TH')} แล้ว (ใช้ไป ฿${Math.round(spent).toLocaleString('th-TH')}) — AI หยุดจนขึ้นเดือนใหม่หรือเพิ่มเพดาน กล่องอัตโนมัติยังทำงาน` : null;
}

export async function usageReport(db: Db, storeId: string) {
  const [all, cap] = await Promise.all([rows(db, storeId, 30), aiCap(db, storeId)]);
  const thb = THB_PER_USD();
  const monthStart = new Date(); monthStart.setDate(1);
  const mkey = monthStart.toISOString().slice(0, 7);
  const cost = (r: Row) => costUsd(r.model, r) * thb;
  const month = all.filter((r) => r.day.startsWith(mkey));
  const sum = (list: Row[], k: keyof Row) => list.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const byBox = new Map<string, { slug: string; name: string; emoji: string | null; calls: number; tokens_in: number; tokens_out: number; cache_read: number; cost_thb: number }>();
  for (const r of month) {
    const b = byBox.get(r.slug) ?? { slug: r.slug, name: r.name, emoji: r.emoji, calls: 0, tokens_in: 0, tokens_out: 0, cache_read: 0, cost_thb: 0 };
    b.calls += r.calls; b.tokens_in += r.tokens_in; b.tokens_out += r.tokens_out; b.cache_read += r.cache_read; b.cost_thb += cost(r);
    byBox.set(r.slug, b);
  }
  const byDay = new Map<string, { day: string; calls: number; cost_thb: number }>();
  for (const r of all) { const d = byDay.get(r.day) ?? { day: r.day, calls: 0, cost_thb: 0 }; d.calls += r.calls; d.cost_thb += cost(r); byDay.set(r.day, d); }
  const tokensIn = sum(month, 'tokens_in'), cacheRead = sum(month, 'cache_read');
  const estimated = all.some((r) => (r.model ?? '').startsWith('demo'));
  return {
    mode: aiMode(), estimated, thb_per_usd: thb, cap_thb: cap,
    month: { key: mkey, calls: sum(month, 'calls'), tokens_in: tokensIn, tokens_out: sum(month, 'tokens_out'), cache_read: cacheRead,
      cost_thb: month.reduce((s, r) => s + cost(r), 0), cache_rate: tokensIn + cacheRead ? cacheRead / (tokensIn + cacheRead) : 0 },
    by_box: [...byBox.values()].sort((a, b) => b.cost_thb - a.cost_thb),
    by_day: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    prices: PRICES,
  };
}

export async function setAiCap(db: Db, storeId: string, cap: number | null) {
  await db.query(`update store set settings = coalesce(settings,'{}'::jsonb) || $2::jsonb where id=$1`, [storeId, JSON.stringify({ aiMonthlyCap: cap })]);
  return aiCap(db, storeId);
}
