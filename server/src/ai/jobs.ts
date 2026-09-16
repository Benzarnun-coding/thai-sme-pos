/**
 * Running a box.
 *
 * Every box can be run by hand from the Studio or by the scheduler on its cron.
 * AI boxes are asked their `runPrompt` through the same chat path the owner
 * uses, so what runs unattended is exactly what was taught. Automation boxes
 * execute their job. Human boxes report what is waiting. Every run leaves one
 * row in agent_run with a one-line Thai summary the card shows.
 */
import type { Db } from '../db/client.js';
import { AGENT_BY_SLUG } from './catalog.js';
import { chat, getAgent, recordRun, type RunRow } from './agents.js';
import { buildProductSignals, storeSummary } from '../signals/build.js';
import { loadAds } from './context.js';

export type Trigger = 'schedule' | 'manual' | 'event';

export async function runAgent(db: Db, o: { storeId: string; slug: string; trigger: Trigger; by?: string }): Promise<RunRow | null> {
  const agent = await getAgent(db, o.storeId, o.slug);
  if (!agent) return null;
  const startedAt = new Date();
  const base = { storeId: o.storeId, slug: o.slug, trigger: o.trigger, by: o.by, startedAt };

  if (!agent.enabled) {
    return recordRun(db, { ...base, status: 'skipped', summary: 'ปิดใช้อยู่ ไม่ได้รัน' });
  }

  try {
    if (agent.kind === 'ai') {
      const prompt = agent.runPrompt ?? AGENT_BY_SLUG[o.slug].starters[0];
      const r = await chat(db, { storeId: o.storeId, slug: o.slug, message: prompt, by: o.by ?? 'scheduler' });
      if (!r) return recordRun(db, { ...base, status: 'error', summary: 'ไม่พบกล่องนี้' });
      if ('error' in r) return recordRun(db, { ...base, status: 'error', summary: r.error });
      // The card shows one line: the first line that says something (skip "แบบ 1"-style headings).
      const lines = r.reply.split('\n').map((l) => l.trim()).filter(Boolean);
      const first = lines.find((l) => l.length >= 20) ?? lines.find((l) => l.length > 8) ?? lines[0] ?? r.reply;
      return recordRun(db, { ...base, status: 'ok', summary: first.slice(0, 140), output: { thread_id: r.thread_id, message_id: r.message_id, text: r.reply, mode: r.mode } });
    }

    const job = JOBS[o.slug];
    if (!job) return recordRun(db, { ...base, status: 'skipped', summary: 'ยังไม่มีงานสำหรับกล่องนี้' });
    const out = await job(db, o.storeId);
    return recordRun(db, { ...base, status: out.status ?? 'ok', summary: out.summary, output: out.output });
  } catch (e) {
    return recordRun(db, { ...base, status: 'error', summary: `ผิดพลาด: ${(e as Error).message}`.slice(0, 200) });
  }
}

type JobResult = { summary: string; output?: Record<string, unknown>; status?: RunRow['status'] };
type Job = (db: Db, storeId: string) => Promise<JobResult>;

const JOBS: Record<string, Job> = {
  /** Pull everything into one place. With no live token this reports what the store already holds. */
  async sense(db, storeId) {
    const [sales, posts, ads, conn] = await Promise.all([
      db.query<{ n: number; last: string | null }>('select count(*)::int as n, max(date)::text as last from fact_sales_daily where store_id=$1', [storeId]),
      db.query<{ n: number }>('select count(distinct external_post_id)::int as n from fact_post_insight_daily where store_id=$1', [storeId]),
      db.query<{ n: number }>('select count(distinct external_ad_id)::int as n from fact_ad_insight_daily where store_id=$1', [storeId]),
      db.query<{ n: number }>(`select count(*)::int as n from connection where store_id=$1 and status='connected' and token_source <> 'demo'`, [storeId]),
    ]);
    const live = conn[0].n > 0;
    await db.query(`update connection set last_sync_at=now() where store_id=$1 and status='connected'`, [storeId]);
    return {
      summary: `${live ? 'ดึงข้อมูลล่าสุด' : 'ยังไม่มี token จริง — ใช้ข้อมูลที่มี'}: ยอดขาย ${sales[0].n} วัน (ถึง ${sales[0].last ?? '—'}) · โพสต์ ${posts[0].n} · แอด ${ads[0].n}`,
      output: { sales_days: sales[0].n, posts: posts[0].n, ads: ads[0].n, live },
    };
  },

  /** The core-size guard: recompute promotability and name what is blocked. */
  async stock_guard(db, storeId) {
    const signals = await buildProductSignals(db, storeId);
    const blocked = signals.filter((s) => !s.promotable);
    const over = signals.filter((s) => s.overstock);
    const ads = await loadAds(db, storeId);
    const hit = ads.filter((a) => blocked.some((b) => b.name.split(' ').some((w) => w.length >= 4 && (a.ad_name + a.campaign_name).includes(w))));
    return {
      summary: blocked.length
        ? `ห้ามโฆษณา ${blocked.length} ตัว: ${blocked.map((b) => `${b.name} (${b.note})`).join(', ')}${hit.length ? ` · แจ้งหยุดแอด ${hit.length} ตัว` : ''}`
        : `ทุกสินค้าพร้อมไซส์ (${signals.length} ตัว)${over.length ? ` · เหลือเยอะ ${over.length} ตัว` : ''}`,
      output: { checked: signals.length, blocked: blocked.map((b) => ({ name: b.name, note: b.note, missing: b.missing_core_sizes })), overstock: over.map((o) => o.name), ads_to_pause: hit.map((a) => a.ad_name) },
      status: 'ok',
    };
  },

  /** The approval queue is a human box; until phase 2 nothing is routed into it. */
  async approval() {
    return { summary: 'ไม่มีงานรออนุมัติ (คิวจะเริ่มมีงานในเฟส 2 เมื่อกล่องส่งงานต่อกัน)', output: { pending: 0 }, status: 'skipped' };
  },

  /** Publish approved work within the budget cap. Nothing approved yet, so it only reports the cap. */
  async publisher(db, storeId) {
    const store = await db.query<{ settings: { dailyCap?: number; monthlyCap?: number } | null }>('select settings from store where id=$1', [storeId]);
    const cap = store[0]?.settings ?? {};
    const ads = await loadAds(db, storeId);
    const today = new Date().toISOString().slice(0, 10);
    const spentToday = ads.filter((a) => a.last_date === today).reduce((s, a) => s + Number(a.spend), 0);
    return {
      summary: `ไม่มีงานรอโพสต์/ตั้งแอด · เพดานวันนี้ ฿${(cap.dailyCap ?? 0).toLocaleString('th-TH')} ใช้ไป ฿${Math.round(spentToday).toLocaleString('th-TH')}`,
      output: { queued: 0, daily_cap: cap.dailyCap ?? null, monthly_cap: cap.monthlyCap ?? null, spent_today: spentToday },
      status: 'skipped',
    };
  },

  /** Match ads to POS sales: the number the analyst reasons from. */
  async measure(db, storeId) {
    const s = await storeSummary(db, storeId);
    const ads = await loadAds(db, storeId);
    const lift = s.sales_prev_7d > 0 ? Math.round(((s.sales_7d - s.sales_prev_7d) / s.sales_prev_7d) * 100) : null;
    return {
      summary: `ยอดขาย 7 วัน ฿${Math.round(s.sales_7d).toLocaleString('th-TH')} (${lift === null ? '—' : (lift >= 0 ? '+' : '') + lift + '%'} เทียบสัปดาห์ก่อน) · ค่าแอด ฿${Math.round(s.ad_spend_7d).toLocaleString('th-TH')} · ROAS ${s.roas_7d ?? '—'}x · วัดผล ${ads.length} แอด`,
      output: { sales_7d: s.sales_7d, sales_prev_7d: s.sales_prev_7d, lift_pct: lift, ad_spend_7d: s.ad_spend_7d, roas_7d: s.roas_7d, ads: ads.length },
    };
  },
};
