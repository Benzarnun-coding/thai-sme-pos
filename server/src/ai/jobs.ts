/**
 * Running a box.
 *
 * Every box can be run by hand from the Studio, by the scheduler on its cron,
 * or by an event: the box before it in the loop handed it work. AI boxes are
 * asked their `runPrompt` — or one task per item in their inbox — through the
 * same chat path the owner uses, so what runs unattended is exactly what was
 * taught. Their replies become work items for the next box (handoff.js), and
 * the next box runs right away when it is not a human. Automation boxes
 * execute their job. Every run leaves one row in agent_run with a one-line
 * Thai summary the card shows.
 */
import type { Db } from '../db/client.js';
import { AGENT_BY_SLUG } from './catalog.js';
import { chat, getAgent, recordRun, type RunRow } from './agents.js';
import { buildProductSignals, storeSummary } from '../signals/build.js';
import { loadAds } from './context.js';
import { outcome, plan, publish, summarize, type WorkItem } from './handoff.js';
import { createWork, inboxOf, stampRun, updateWork } from './work.js';
import { capReached } from './usage.js';

export type Trigger = 'schedule' | 'manual' | 'event';
const CURRENT_PHASE = () => Number(process.env.LOOPDESK_PHASE ?? 1);
const MAX_CHAIN = 6;

export async function runAgent(db: Db, o: { storeId: string; slug: string; trigger: Trigger; by?: string; chain?: boolean; depth?: number }): Promise<RunRow | null> {
  const agent = await getAgent(db, o.storeId, o.slug);
  if (!agent) return null;
  const startedAt = new Date();
  const base = { storeId: o.storeId, slug: o.slug, trigger: o.trigger, by: o.by, startedAt };
  const depth = o.depth ?? 0;

  if (!agent.enabled) {
    return recordRun(db, { ...base, status: 'skipped', summary: 'ปิดใช้อยู่ ไม่ได้รัน' });
  }

  try {
    const inbox = await inboxOf(db, o.storeId, o.slug);
    const touched: number[] = [];
    const handedTo = new Set<string>();

    if (agent.kind === 'ai') {
      const capped = await capReached(db, o.storeId);
      if (capped) return recordRun(db, { ...base, status: 'skipped', summary: capped.slice(0, 140), output: { capped: true, inbox: inbox.length } });
      const prompt = agent.runPrompt ?? AGENT_BY_SLUG[o.slug].starters[0];
      const tasks = plan(o.slug, prompt, inbox);
      if (!tasks.length) return recordRun(db, { ...base, status: 'skipped', summary: 'ไม่มีงานส่งมาให้ตรวจ', output: { inbox: 0 } });
      const results: { reply: string; note?: string; thread_id: string; message_id: number; mode: string }[] = [];
      for (const task of tasks) {
        const r = await chat(db, { storeId: o.storeId, slug: o.slug, message: task.message, by: o.by ?? 'scheduler' });
        if (!r) return recordRun(db, { ...base, status: 'error', summary: 'ไม่พบกล่องนี้' });
        if ('error' in r) return recordRun(db, { ...base, status: 'error', summary: r.error });
        const out = outcome(o.slug, task, r.reply);
        for (const it of out.create) { const row = await createWork(db, o.storeId, it); touched.push(row.id); if (row.to_slug) handedTo.add(row.to_slug); }
        for (const u of out.update) { const row = await updateWork(db, o.storeId, u.id, u.patch); if (row) { touched.push(row.id); if (row.to_slug && row.status !== 'done') handedTo.add(row.to_slug); } }
        results.push({ reply: r.reply, note: out.note, thread_id: r.thread_id, message_id: r.message_id, mode: r.mode });
      }
      const summary = summarize(o.slug, results, inbox) ?? firstLine(results[0].reply);
      const first = results[0];
      const run = await recordRun(db, { ...base, status: 'ok', summary: summary.slice(0, 140),
        output: { thread_id: first.thread_id, message_id: first.message_id, text: results.map((r) => r.reply).join('\n\n———\n\n'), mode: first.mode, tasks: tasks.length, items: touched, inbox: inbox.length } });
      await stampRun(db, touched, run.id);
      await chainNext(db, o, handedTo, depth);
      return run;
    }

    if (o.slug === 'approval') {
      return recordRun(db, { ...base, status: inbox.length ? 'ok' : 'skipped', summary: summarize('approval', [], inbox)!, output: { pending: inbox.length, items: inbox.map((i) => i.id) } });
    }
    if (o.slug === 'publisher') {
      const live = CURRENT_PHASE() >= 3;
      const cap = await JOBS.publisher(db, o.storeId);
      if (!inbox.length) return recordRun(db, { ...base, status: 'skipped', summary: cap.summary, output: cap.output });
      for (const u of publish(inbox, live)) { const row = await updateWork(db, o.storeId, u.id, u.patch); if (row) touched.push(row.id); }
      const run = await recordRun(db, { ...base, status: 'ok', summary: `${summarize('publisher', [{ live }], inbox)} · ${cap.summary}`.slice(0, 140), output: { ...cap.output, published: touched, live } });
      await stampRun(db, touched, run.id);
      return run;
    }

    const job = JOBS[o.slug];
    if (!job) return recordRun(db, { ...base, status: 'skipped', summary: 'ยังไม่มีงานสำหรับกล่องนี้' });
    const out = await job(db, o.storeId);
    return recordRun(db, { ...base, status: out.status ?? 'ok', summary: out.summary, output: out.output });
  } catch (e) {
    return recordRun(db, { ...base, status: 'error', summary: `ผิดพลาด: ${(e as Error).message}`.slice(0, 200) });
  }
}

/** Run the boxes that just received work, in loop order — unless they are people, or chaining is off. */
async function chainNext(db: Db, o: { storeId: string; by?: string; chain?: boolean }, handedTo: Set<string>, depth: number) {
  if (o.chain === false || depth >= MAX_CHAIN) return;
  const next = [...handedTo].filter((s) => AGENT_BY_SLUG[s] && AGENT_BY_SLUG[s].kind !== 'human').sort((a, b) => AGENT_BY_SLUG[a].step - AGENT_BY_SLUG[b].step);
  for (const slug of next) await runAgent(db, { storeId: o.storeId, slug, trigger: 'event', by: o.by, chain: true, depth: depth + 1 });
}

/** The card shows one line: the first line that says something (skip "แบบ 1"-style headings). */
function firstLine(reply: string) {
  const lines = reply.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => l.length >= 20) ?? lines.find((l) => l.length > 8) ?? lines[0] ?? reply;
}

export type { WorkItem };

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

  /** The budget line the publisher reports alongside whatever it published. */
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
