// One automation run: fetch → group by stage × product → evaluate → apply with guardrails → move stages → log → LINE.

import { applyDecisions, sumBudget, type Mutator } from '../../ads-engine/src/apply.ts';
import { formatReport, pushDiscord, pushLine } from '../../ads-engine/src/notify.ts';
import type { CampaignDayRow, DailyRow, HourlyConversion } from '../../ads-engine/src/meta.ts';
import type { Entity, Level, Metrics, RunReport, State, Window } from '../../ads-engine/src/types.ts';
import { applyMoves, codOf, insertRun, loadCampaignSettings, loadCosts, loadSections, loadSettings, loadStages, loadState, saveState } from './db.ts';
import { buildGroups, neededWindows, planDecisions, sectionMap, type MoveDecision, type Plan } from './engine.ts';
import { loadOrders, orderFees } from './p365.ts';
import { applyActual } from './actualMetrics.ts';
import { approvalsEnabled, expireOld, postProposal, recentlyAsked, saveProposals, type Proposal } from './discord.ts';

/** Keeps a run well inside the Workers free plan's 50 outbound requests, and limits damage from a bad rule. */
export const MAX_CHANGES_PER_RUN = 25;

export interface MetaLike extends Mutator {
  accountName(): Promise<string>;
  listEntities(): Promise<Entity[]>;
  insights(level: Level, window: Window): Promise<Map<string, Metrics>>;
  dailyInsights(campaignId: string, window: Window): Promise<DailyRow[]>;
  dailyCampaignInsights(window: Window): Promise<CampaignDayRow[]>;
  hourlyConversions(date: string): Promise<HourlyConversion[]>;
  adCount(campaignId: string): Promise<number>;
  copyCampaign(campaignId: string, suffix: string): Promise<{ id: string; children: string[] }>;
}

export interface RunEnv {
  DB: D1Database;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_APP_PUBLIC_KEY?: string;
  DISCORD_CHANNEL_ID?: string;
  DISCORD_DECIDER_IDS?: string;
  META_AD_ACCOUNT_ID: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_TO?: string;
  DISCORD_WEBHOOK_URL?: string;
}

export type WebRunReport = RunReport & {
  notes: string[];
  decisions: (RunReport['decisions'][number] & { group?: string })[];
  /** Stage changes; applied only when not a dry run */
  moves: (MoveDecision & { applied?: boolean })[];
};

export async function runAutomation(env: RunEnv, meta: MetaLike, opts: { trigger: string; dryRun?: boolean }): Promise<WebRunReport> {
  const settings = await loadSettings(env.DB);
  const now = new Date();
  const dryRun = opts.dryRun ?? settings.dry_run;
  const report: WebRunReport = {
    run_at: now.toISOString(),
    account_id: env.META_AD_ACCOUNT_ID,
    dry_run: dryRun,
    entities_evaluated: 0,
    decisions: [],
    totals: { daily_budget_before: 0, daily_budget_after: 0 },
    errors: [],
    notes: [],
    moves: [],
  };

  if (settings.kill_switch) {
    report.notes.push('KILL SWITCH เปิดอยู่ → ไม่ทำอะไรเลย');
    await insertRun(env.DB, { run_at: report.run_at, trigger: opts.trigger, dry_run: dryRun, summary: 'หยุด (kill switch)', report });
    return report;
  }

  try {
    const [entities, state] = await Promise.all([meta.listEntities(), loadState(env.DB)]);
    const { plan, evaluated } = await planRun(env.DB, entities, (level, window) => meta.insights(level, window), state, now, (w) => meta.dailyCampaignInsights(w));
    report.entities_evaluated = evaluated;
    report.totals.daily_budget_before = sumBudget(entities);
    report.notes.push(...plan.notes);
    report.moves = plan.moves;
    capChanges(plan);
    report.decisions = plan.decisions;

    // With the Discord bot set up, pausing a campaign or moving it down to retest waits for a button press.
    const proposals: Proposal[] = [];
    if (!dryRun && approvalsEnabled(env)) {
      await expireOld(env, report.run_at).catch(() => null);
      const asked = await recentlyAsked(env.DB, new Date(now.getTime() - 3 * 86_400_000).toISOString()).catch(() => new Set<string>());
      const hold = (kind: Proposal['kind'], id: string, name: string, rule: string, planText: string, detail: object) => {
        const key = `${rule}:${id}`;
        if (asked.has(key)) return 'ถามใน Discord แล้ว รอคำตอบ / ตอบไม่ไว้ภายใน 3 วัน';
        asked.add(key);
        proposals.push({ id: crypto.randomUUID(), created_at: report.run_at, kind, entity_id: id, entity_name: name, rule_id: rule, plan: planText, detail: JSON.stringify(detail), status: 'pending', decided_by: null, decided_at: null, message_id: null });
        return 'รออนุมัติใน Discord';
      };
      const actual = plan.notes.some((n) => n.startsWith('ตัดสินจากยอดขายจริง'));
      for (const d of plan.decisions) {
        if (d.skipped_reason || d.action.type !== 'pause') continue;
        d.skipped_reason = hold('pause', d.entity.id, d.entity.name, d.rule_id, d.plan, { level: d.entity.level, window: d.window, metric: d.metric, observed: d.observed, threshold: d.threshold, actual });
      }
      for (const m of report.moves) {
        if (m.skipped_reason || m.move_to !== 'retest') continue;
        m.skipped_reason = hold('move', m.entity.id, m.entity.name, m.rule_id, m.plan, { level: 'campaign', move_from: m.move_from, move_to: m.move_to, window: m.window, metric: m.metric, observed: m.observed, threshold: m.threshold, actual });
      }
      // A winner sitting at the per-campaign cap and still well above break-even: offer a copy (new campaign at a
      // small budget) so it can grow without pushing the original past the cap. Once approved, not asked again for 7 days.
      const be = await shopBreakeven(env.DB, settings, now);
      if (be) {
        const [cs, done] = await Promise.all([
          loadCampaignSettings(env.DB),
          env.DB.prepare(`SELECT entity_id FROM proposals WHERE kind = 'dup' AND status = 'approved' AND decided_at >= ?`).bind(new Date(now.getTime() - 7 * 86_400_000).toISOString()).all<{ entity_id: string }>().then((r) => new Set(r.results.map((x) => x.entity_id))).catch(() => new Set<string>()),
        ]);
        for (const c of entities) {
          const m = c.metrics.last_3d;
          if (c.level !== 'campaign' || c.status !== 'ACTIVE' || !m || c.daily_budget === null || done.has(c.id)) continue;
          if (cs.get(c.id)?.stage_id !== 'winning' || c.daily_budget < settings.guardrails.max_daily_budget * 0.9) continue;
          if (m.roas < be * 1.5 || m.purchases < 10) continue;
          hold('dup', c.id, c.name, 'dup-winner', `ROAS 3 วัน ${m.roas.toFixed(2)} ≥ 1.5× คุ้มทุน ${be.toFixed(2)} และงบชนเพดาน ${c.daily_budget}`,
            { level: 'campaign', budget: c.daily_budget, new_budget: Math.min(1000, settings.guardrails.max_daily_budget), roas: m.roas, breakeven: be, purchases: m.purchases, actual });
        }
      }
      await saveProposals(env.DB, proposals);
    }

    const applied = await applyDecisions(plan.decisions, entities, meta, settings.guardrails, state, { dryRun, now });
    report.errors.push(...applied.errors);
    report.totals.daily_budget_after = applied.totalAfter;
    if (!dryRun) {
      await saveState(env.DB, state);
      const moving = report.moves.filter((m) => !m.skipped_reason);
      await applyMoves(env.DB, moving.map((m) => ({ campaign_id: m.entity.id, name: m.entity.name, from: m.move_from, to: m.move_to })), report.run_at);
      for (const m of moving) m.applied = true;
    }
  } catch (err: any) {
    report.errors.push(err?.message ?? String(err));
  }

  const acted = report.decisions.filter((d) => !d.skipped_reason).length;
  const moved = report.moves.filter((m) => !m.skipped_reason).length;
  const summary = report.errors.length && !report.decisions.length
    ? `ผิดพลาด: ${report.errors[0].slice(0, 120)}`
    : `${acted} รายการ · ย้ายกลุ่ม ${moved}${dryRun ? ' (ทดลอง)' : ''} · ข้าม ${report.decisions.length - acted}`;
  await insertRun(env.DB, { run_at: report.run_at, trigger: opts.trigger, dry_run: dryRun, summary, report });

  const text = [
    formatReport(report),
    ...report.moves.filter((m) => !m.skipped_reason).map((m) => `↪ ${m.plan}`),
    ...report.notes.map((n) => `ℹ️ ${n}`),
  ].join('\n');
  await pushLine(text, env.LINE_CHANNEL_ACCESS_TOKEN, env.LINE_TO).catch(() => false);
  await pushDiscord(discordRunText(report, dryRun, opts.trigger), env.DISCORD_WEBHOOK_URL).catch(() => false);
  // Questions go out after the summary, each with its own buttons.
  if (!dryRun && approvalsEnabled(env)) {
    const { results } = await env.DB.prepare(`SELECT * FROM proposals WHERE status = 'pending' AND created_at = ? AND message_id IS NULL`).bind(report.run_at).all<Proposal>().catch(() => ({ results: [] as Proposal[] }));
    for (const p of results) {
      const id = await postProposal(env, p).catch(() => null);
      if (id) await env.DB.prepare('UPDATE proposals SET message_id = ? WHERE id = ?').bind(id, p.id).run();
    }
  }
  return report;
}

/**
 * Everything a run decides, without touching Meta or saving anything. Shared by real runs and the dashboard's
 * "next run" preview (which passes cached insights). Fills entity metrics for the windows the rules need.
 */
export async function planRun(
  db: D1Database, entities: Entity[], insights: (level: Level, window: Window) => Promise<Map<string, Metrics>>, state: State, now: Date,
  daily?: (window: Window) => Promise<CampaignDayRow[]>,
): Promise<{ plan: Plan; evaluated: number }> {
  const [sections, stages, campaignSettings, costs, settings] = await Promise.all([loadSections(db), loadStages(db), loadCampaignSettings(db), loadCosts(db), loadSettings(db)]);
  const sectionOf = sectionMap(entities, sections, campaignSettings);
  const groups = buildGroups(entities, sections, stages, campaignSettings, sectionOf);
  const calls = [...neededWindows(groups)].flatMap(([level, windows]) => [...windows].map((w) => [level, w] as const));
  const results = await Promise.all(calls.map(([level, w]) => insights(level, w)));
  calls.forEach(([level, w], i) => {
    for (const e of entities) if (e.level === level) e.metrics[w] = results[i].get(e.id) ?? zeroMetrics();
  });
  // Uploaded Page365 days replace Meta's admin-tagged purchases (campaign level).
  const actualNotes = daily ? await applyActual(db, entities, [...(neededWindowsOf(calls, 'campaign'))], daily, now) : [];
  const evaluated = entities.filter((e) => groups.some((g) => g.campaignIds.has(e.campaign_id))).length;
  const plan = planDecisions(groups, entities, sectionOf, costs, campaignSettings, stages, state, now, codOf(settings), await shopBreakeven(db, settings, now), settings.guardrails.max_daily_budget);
  plan.notes.unshift(...actualNotes);
  return { plan, evaluated };
}

const neededWindowsOf = (calls: (readonly [Level, Window])[], level: Level) => new Set(calls.filter(([l]) => l === level).map(([, w]) => w));

/**
 * Break-even ROAS of the whole shop from the last 14 days of real orders: revenue ÷ (revenue − product cost −
 * per-order fees), i.e. 1 ÷ gross margin. Null when fewer than 7 days are uploaded or the margin isn't positive.
 */
async function shopBreakeven(db: D1Database, settings: Awaited<ReturnType<typeof loadSettings>>, now: Date): Promise<number | null> {
  const dates = Array.from({ length: 14 }, (_, i) => new Date(now.getTime() + 7 * 3_600_000 - (i + 1) * 86_400_000).toISOString().slice(0, 10));
  const orders = await loadOrders(db, dates).catch(() => []);
  if (new Set(orders.map((o) => o.date)).size < 7) return null;
  const revenue = orders.reduce((t, o) => t + o.total, 0);
  const gross = orders.reduce((t, o) => t + o.total - (o.cost ?? 0) - orderFees(o, settings.order_fees), 0);
  return revenue > 0 && gross > 0 ? revenue / gross : null;
}

/** Marks everything past MAX_CHANGES_PER_RUN as skipped. */
export function capChanges(plan: Plan): void {
  let actionable = 0;
  for (const d of plan.decisions) {
    if (d.skipped_reason || d.action.type === 'notify') continue;
    if (++actionable > MAX_CHANGES_PER_RUN) d.skipped_reason = `เกิน ${MAX_CHANGES_PER_RUN} การเปลี่ยนต่อรอบ — รอรอบถัดไป`;
  }
}

export function zeroMetrics(): Metrics {
  return { spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, purchases: 0, purchase_value: 0, cpa: Infinity, roas: 0, frequency: 0, messages: 0, cost_per_message: Infinity };
}

/** The run, in words the team reads on Discord: what each rule did (or would do, in dry-run) and why. */
function discordRunText(report: WebRunReport, dryRun: boolean, trigger = ''): string {
  const when = new Date(report.run_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' });
  const acted = report.decisions.filter((d) => !d.skipped_reason);
  const moves = report.moves.filter((m) => !m.skipped_reason);
  const lines = [`**${dryRun ? '🧪 โหมดทดลอง (ยังไม่แตะ Meta)' : '✅ ปรับจริงแล้ว'} · รันกฎ ${when}${trigger.startsWith('test:') ? ` · ${trigger.slice(5)}` : ''}**`];
  lines.push(`ประเมิน ${report.entities_evaluated} รายการ · งบรวม/วัน ${report.totals.daily_budget_before} → ${report.totals.daily_budget_after}`);
  if (!acted.length && !moves.length) lines.push('ไม่มีกฎไหนตรงเงื่อนไข — ไม่มีการปรับ');
  for (const d of acted) {
    const tail = d.error ? ` ❌ ${d.error}` : d.after?.daily_budget !== undefined && d.after.daily_budget !== d.before?.daily_budget ? ` → ${d.after.daily_budget}/วัน` : '';
    lines.push(`${d.action.type === 'pause' ? (dryRun ? '⏸ **จะหยุด**' : '⏸ **หยุดแล้ว**') : '•'} \`${d.rule_id}\` ${d.plan}${tail}`);
  }
  const waiting = report.decisions.filter((d) => d.skipped_reason === 'รออนุมัติใน Discord').length + report.moves.filter((m) => m.skipped_reason === 'รออนุมัติใน Discord').length;
  if (waiting) lines.push(`❓ รออนุมัติ ${waiting} รายการ — ดูข้อความถัดไปแล้วกดปุ่ม`);
  for (const m of moves) lines.push(`↪ ${m.plan}`);
  const skipped = report.decisions.filter((d) => d.skipped_reason);
  if (skipped.length) lines.push(`ข้าม ${skipped.length} รายการ (${[...new Set(skipped.map((d) => d.skipped_reason))].join(', ')})`);
  for (const n of report.notes) lines.push(`ℹ️ ${n}`);
  if (report.errors.length) lines.push(`⚠️ ${report.errors.slice(0, 3).join(' | ')}`);
  return lines.join('\n');
}
