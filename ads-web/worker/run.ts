// One automation run: fetch → group by stage × product → evaluate → apply with guardrails → move stages → log → LINE.

import { applyDecisions, sumBudget, type Mutator } from '../../ads-engine/src/apply.ts';
import { formatReport, pushDiscord, pushLine } from '../../ads-engine/src/notify.ts';
import type { CampaignDayRow, DailyRow, HourlyConversion } from '../../ads-engine/src/meta.ts';
import type { Decision, Entity, Level, Metrics, RunReport, State, Window } from '../../ads-engine/src/types.ts';
import { applyMoves, codOf, insertRun, loadCampaignSettings, loadCosts, loadSections, loadSettings, loadStages, loadState, saveState } from './db.ts';
import { buildGroups, neededWindows, planDecisions, sectionMap, type MoveDecision, type Plan } from './engine.ts';
import { loadOrders, orderFees } from './p365.ts';
import { applyActual } from './actualMetrics.ts';
import { campaignBreakevens, type BreakevenSource, type CampaignBreakeven } from './breakevens.ts';
import { approvalsEnabled, expireOld, postProposal, recentlyAsked, saveProposals, type Proposal } from './discord.ts';

/** The break-even a campaign is judged by: its own (breakevens.ts, when switched on) or the shop's. */
export type BeOf = (campaignId: string) => number | null;
const beFn = (be: number | null | BeOf): BeOf => (typeof be === 'function' ? be : () => be);

/** Keeps a run well inside the Workers free plan's 50 outbound requests, and limits damage from a bad rule. */
export const MAX_CHANGES_PER_RUN = 25;

/** A copy made from a `dup` proposal starts here unless Settings has guardrails.start_daily_budget (Benz 2026-10-22: start at 50, then climb)... */
export const DUP_START_BUDGET = 50;
/** ...and climbs +20% per run (11 h apart) up to this, then only the testing stage's rules move it. */
export const DUP_RAMP_TO = 1000;
/** Spend under about one order's cost (CPA ~150) proves nothing yet, so the copy keeps climbing. */
const DUP_RAMP_FREE_SPEND = 150;
const DUP_RAMP_DAYS = 14;
/** Ad sets + ads a copy may hold: each is copied, then switched on, one Meta call each, inside the free plan's 50 per request. */
export const MAX_COPY_OBJECTS = 15;

/** Per-campaign ceiling for proven winners when Settings leaves guardrails.winner_max_daily_budget unset (Benz 2026-10-22). */
export const WINNER_MAX_BUDGET = 5000;
/**
 * Hours between two increases on one campaign/ad set when Settings leaves guardrails.increase_gap_hours unset
 * (Benz 2026-10-22). Rules judge 3-day ROAS: raised every 11 h, two thirds of that window was still the old budget.
 */
export const INCREASE_GAP_HOURS = 48;
/** Under this daily budget the gap doesn't apply: small budgets may rise every run (Benz 2026-10-22). */
export const FREE_INCREASE_BELOW = 500;
/** Yesterday's spend a campaign needs before one bad day pulls it back (Benz 2026-10-22). */
const BRAKE_MIN_SPEND = 2000;
/** Rules that raised budgets before the `up:` state key existed, so the first run after the change still sees them. */
const RAISE_RULES = ['win-boost', 'test-boost', 'win-up', 'test-up', 'win-small'];

export interface MetaLike extends Mutator {
  accountName(): Promise<string>;
  listEntities(): Promise<Entity[]>;
  insights(level: Level, window: Window): Promise<Map<string, Metrics>>;
  dailyInsights(campaignId: string, window: Window): Promise<DailyRow[]>;
  dailyCampaignInsights(window: Window): Promise<CampaignDayRow[]>;
  hourlyConversions(date: string): Promise<HourlyConversion[]>;
  activeAdPosts(): Promise<{ ads: import('../../ads-engine/src/meta.ts').ActiveAdPost[]; post_error: string | null }>;
  copyObjects(campaignId: string): Promise<{ adsets: string[]; ads: { id: string; adset_id: string }[] }>;
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
    const { plan, evaluated, breakevens } = await planRun(env.DB, entities, (level, window) => meta.insights(level, window), state, now, (w) => meta.dailyCampaignInsights(w));
    report.entities_evaluated = evaluated;
    report.totals.daily_budget_before = sumBudget(entities);
    report.notes.push(...plan.notes);
    report.moves = plan.moves;
    const [copies, cs, shop] = await Promise.all([recentCopies(env.DB, now), loadCampaignSettings(env.DB), shopBreakeven(env.DB, settings, now)]);
    const be: BeOf = (id) => breakevens?.get(id)?.be ?? shop;
    plan.decisions.push(...rampCopies(entities, copies, cs, plan.decisions, be, state, now));
    spaceIncreases(plan.decisions, entities, state, now, settings.guardrails.increase_gap_hours ?? INCREASE_GAP_HOURS, settings.guardrails.free_increase_below ?? FREE_INCREASE_BELOW);
    const winners = provenWinners(entities, cs, be, settings.guardrails.winner_max_daily_budget ?? WINNER_MAX_BUDGET);
    // Above the normal ceiling, one bad day is pulled straight back down instead of waiting for the 3-day average.
    const brakeMode = settings.guardrails.brake_yesterday ?? 'dry';
    const max = settings.guardrails.max_daily_budget;
    let brakes: Decision[] = [];
    if (brakeMode !== 'off' && entities.some((e) => e.level === 'campaign' && e.status === 'ACTIVE' && (e.daily_budget ?? 0) > max)) {
      const y = await meta.insights('campaign', 'yesterday');
      for (const e of entities) if (e.level === 'campaign') e.metrics.yesterday = y.get(e.id) ?? zeroMetrics();
      const src = await applyActual(env.DB, entities, ['yesterday'], (w) => meta.dailyCampaignInsights(w), now);
      brakes = yesterdayBrakes(entities, max, be);
      for (const b of brakes) {
        for (const d of plan.decisions) if (d.entity.id === b.entity.id && !d.skipped_reason) d.skipped_reason = 'เบรกเมื่อวานพัง';
        if (brakeMode === 'dry') report.notes.push(`🧪 เบรกเมื่อวานพัง (ทดลอง ยังไม่ลดจริง): ${b.plan}${src.length ? ` · ${src.join(' · ')}` : ''}`);
      }
      if (brakeMode === 'dry') brakes = [];
    }
    if (winners.size) report.notes.push(`ตัวชนะ 7 วัน ${winners.size} แคมเปญ ใช้เพดานต่อแคมเปญ ${[...winners.values()][0].toLocaleString('th-TH')} แทน ${settings.guardrails.max_daily_budget.toLocaleString('th-TH')}`);
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
      {
        const done = await env.DB.prepare(`SELECT entity_id FROM proposals WHERE kind = 'dup' AND status = 'approved' AND decided_at >= ?`).bind(new Date(now.getTime() - 7 * 86_400_000).toISOString()).all<{ entity_id: string }>().then((r) => new Set(r.results.map((x) => x.entity_id))).catch(() => new Set<string>());
        for (const c of entities) {
          const m = c.metrics.last_3d;
          if (c.level !== 'campaign' || c.status !== 'ACTIVE' || !m || c.daily_budget === null || done.has(c.id)) continue;
          if (cs.get(c.id)?.stage_id !== 'winning' || c.daily_budget < (winners.get(c.id) ?? settings.guardrails.max_daily_budget) * 0.9) continue;
          const cbe = be(c.id);
          if (cbe === null || m.roas < cbe * 1.5 || m.purchases < 10) continue;
          hold('dup', c.id, c.name, 'dup-winner', `ROAS 3 วัน ${m.roas.toFixed(2)} ≥ 1.5× คุ้มทุน ${cbe.toFixed(2)} และงบชนเพดาน ${c.daily_budget}`,
            { level: 'campaign', budget: c.daily_budget, new_budget: Math.max(settings.guardrails.start_daily_budget ?? DUP_START_BUDGET, settings.guardrails.min_daily_budget), roas: m.roas, breakeven: cbe, purchases: m.purchases, actual });
        }
      }
      await saveProposals(env.DB, proposals);
    }

    const applied = await applyDecisions(plan.decisions, entities, meta, settings.guardrails, state, { dryRun, now, maxBudgetFor: (id) => winners.get(id) });
    if (!dryRun) markIncreases(plan.decisions, state, now);
    // Brakes go straight to the normal ceiling (more than the 20%/run a rule may move); cuts are never held by caps.
    for (const b of brakes) {
      const e = entities.find((x) => x.id === b.entity.id)!;
      b.before = { status: e.status, daily_budget: e.daily_budget };
      try {
        if (!dryRun) await meta.setDailyBudget(e.id, max);
        b.after = { status: e.status, daily_budget: max };
        b.applied = !dryRun;
        if (!dryRun) state.last_action[`brake:${e.id}`] = now.toISOString();
        applied.totalAfter = Math.round(applied.totalAfter - (e.daily_budget! - max));
      } catch (err: any) {
        b.error = err?.message ?? String(err);
        applied.errors.push(`${b.rule_id}/${e.name}: ${b.error}`);
      }
      plan.decisions.push({ ...b, group: 'เบรกเมื่อวานพัง' });
    }
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
  /** Overrides Settings' guardrails.breakeven_source (the preview tries 'orders' before Benz switches it on) */
  breakevenSource?: BreakevenSource,
): Promise<{ plan: Plan; evaluated: number; breakevens: Map<string, CampaignBreakeven> | null }> {
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
  const shop = await shopBreakeven(db, settings, now);
  const breakevens = (breakevenSource ?? settings.guardrails.breakeven_source ?? 'catalog') === 'orders'
    ? campaignBreakevens(entities.filter((e) => e.level === 'campaign'), sections, sectionOf, await loadOrders(db, breakevenDates(now)).catch(() => []), costs, codOf(settings), settings.order_fees, shop)
    : null;
  const plan = planDecisions(groups, entities, sectionOf, costs, campaignSettings, stages, state, now, codOf(settings), shop, settings.guardrails.max_daily_budget, breakevens ?? undefined);
  plan.notes.unshift(...actualNotes);
  if (breakevens) plan.notes.push(breakevenNote(breakevens, groups));
  return { plan, evaluated, breakevens };
}

/** The 14 Bangkok days before today, as Page365 order dates. */
const breakevenDates = (now: Date) => Array.from({ length: 14 }, (_, i) => new Date(now.getTime() + 7 * 3_600_000 - (i + 1) * 86_400_000).toISOString().slice(0, 10));

/** One line for the run's notes: how many automated campaigns got their break-even from where. */
function breakevenNote(bes: Map<string, CampaignBreakeven>, groups: { campaignIds: Set<string> }[]): string {
  const ids = new Set(groups.flatMap((g) => [...g.campaignIds]));
  const count = new Map<string, number>();
  for (const [id, b] of bes) {
    if (!ids.has(id)) continue;
    const kind = b.source.startsWith('ออเดอร์จริงของแคมเปญ') ? 'ออเดอร์ของแคมเปญเอง' : b.source.startsWith('ออเดอร์จริงของสินค้า') ? 'ออเดอร์ของสินค้า' : b.source.startsWith('ราคาโปร') ? 'ราคาโปร' : b.source.startsWith('ราคาแคตตาล็อก') ? 'ราคาแคตตาล็อก' : 'คุ้มทุนรวมร้าน';
    count.set(kind, (count.get(kind) ?? 0) + 1);
  }
  return `คุ้มทุนรายแคมเปญจากออเดอร์จริง Page365 14 วัน: ${[...count].map(([k, n]) => `${k} ${n}`).join(' · ')}`;
}

const neededWindowsOf = (calls: (readonly [Level, Window])[], level: Level) => new Set(calls.filter(([l]) => l === level).map(([, w]) => w));

/**
 * Break-even ROAS of the whole shop from the last 14 days of real orders: revenue ÷ (revenue − product cost −
 * per-order fees), i.e. 1 ÷ gross margin. Null when fewer than 7 days are uploaded or the margin isn't positive.
 */
export async function shopBreakeven(db: D1Database, settings: Awaited<ReturnType<typeof loadSettings>>, now: Date): Promise<number | null> {
  const orders = await loadOrders(db, breakevenDates(now)).catch(() => []);
  if (new Set(orders.map((o) => o.date)).size < 7) return null;
  const revenue = orders.reduce((t, o) => t + o.total, 0);
  const gross = orders.reduce((t, o) => t + o.total - (o.cost ?? 0) - orderFees(o, settings.order_fees), 0);
  return revenue > 0 && gross > 0 ? revenue / gross : null;
}

/** Campaigns made by an approved copy in the last DUP_RAMP_DAYS (ids from the audit log). */
async function recentCopies(db: D1Database, now: Date): Promise<Set<string>> {
  const since = new Date(now.getTime() - DUP_RAMP_DAYS * 86_400_000).toISOString();
  const { results } = await db.prepare(`SELECT detail ->> '$.copy' AS id FROM audit WHERE action = 'campaign.copy' AND at >= ?`).bind(since)
    .all<{ id: string | null }>().catch(() => ({ results: [] as { id: string | null }[] }));
  return new Set(results.map((r) => r.id).filter((id): id is string => !!id));
}

/**
 * Copies climb from DUP_START_BUDGET by +20% a run while they pay: real 3-day ROAS ≥ the shop's break-even, or
 * spend still under one order's cost. Only while the copy is active, still in "testing" (moved elsewhere = a person
 * took over), under DUP_RAMP_TO, and no stage rule acted on it this run. Guardrails and the total cap still apply.
 */
export function rampCopies(entities: Entity[], copies: Set<string>, cs: Map<string, { stage_id: string | null }>, decisions: Decision[], beOf: number | null | BeOf, state: State, now: Date): (Decision & { group: string })[] {
  const out: (Decision & { group: string })[] = [];
  for (const c of entities) {
    if (c.level !== 'campaign' || !copies.has(c.id) || c.status !== 'ACTIVE' || c.daily_budget === null || c.daily_budget >= DUP_RAMP_TO) continue;
    if (cs.get(c.id)?.stage_id !== 'testing' || decisions.some((d) => d.entity.id === c.id && !d.skipped_reason)) continue;
    const last = state.last_action[`dup-ramp:${c.id}`];
    if (last && now.getTime() - Date.parse(last) < 11 * 3_600_000) continue;
    const m = c.metrics.last_3d ?? zeroMetrics();
    const be = beFn(beOf)(c.id);
    const early = m.spend < DUP_RAMP_FREE_SPEND;
    if (!early && (be === null || m.roas < be)) continue;
    const pct = Math.round(Math.min(20, (DUP_RAMP_TO / c.daily_budget - 1) * 100));
    out.push({
      rule_id: 'dup-ramp', group: 'ตัวคัดลอก', entity: { level: 'campaign', id: c.id, name: c.name, campaign_name: c.campaign_name }, window: 'last_3d', metric: 'roas',
      observed: m.roas, threshold: be ?? 0, action: { type: 'budget_pct', pct },
      plan: `ตัวคัดลอกไต่งบ +${pct}% (${c.daily_budget} → ~${Math.round(c.daily_budget * (1 + pct / 100))}, เป้า ${DUP_RAMP_TO}) — ${early ? `ใช้เงิน 3 วัน ${Math.round(m.spend)} ยังไม่ถึง ${DUP_RAMP_FREE_SPEND}` : `ROAS 3 วัน ${m.roas.toFixed(2)} ≥ คุ้มทุน ${be!.toFixed(2)}`}: ${c.name}`,
    });
  }
  return out;
}

/**
 * Campaigns that earned a higher per-campaign ceiling: winning stage, real 7-day ROAS ≥ 1.5× its break-even (its own
 * when breakevens.ts is on, else the shop's) and ≥ 10 orders. Losing that (ROAS drops, moved out of winning) puts them back under the normal ceiling: no cut, just
 * no more raises above it.
 */
export function provenWinners(entities: Entity[], cs: Map<string, { stage_id: string | null }>, beOf: number | null | BeOf, cap: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of entities) {
    const m = c.metrics.last_7d;
    if (c.level !== 'campaign' || c.status !== 'ACTIVE' || !m || cs.get(c.id)?.stage_id !== 'winning') continue;
    const be = beFn(beOf)(c.id);
    if (be !== null && m.roas >= be * 1.5 && m.purchases >= 10) out.set(c.id, cap);
  }
  return out;
}

/**
 * One budget increase per campaign/ad set every `gapHours`, whichever stage rule asks. Budgets under `freeBelow`
 * (and copies ramping) rise as often as their rules allow: little money at stake, and they need data fast.
 */
export function spaceIncreases(decisions: Decision[], entities: Entity[], state: State, now: Date, gapHours: number, freeBelow: number): void {
  const budget = new Map(entities.map((e) => [e.id, e.daily_budget]));
  for (const d of decisions) {
    if (d.skipped_reason || d.action.type !== 'budget_pct' || (d.action.pct ?? 0) <= 0 || d.rule_id === 'dup-ramp') continue;
    if ((budget.get(d.entity.id) ?? Infinity) < freeBelow) continue;
    const last = Math.max(...['up', 'brake', ...RAISE_RULES].map((r) => Date.parse(state.last_action[`${r}:${d.entity.id}`] ?? '') || 0));
    const hours = (now.getTime() - last) / 3_600_000;
    if (hours < gapHours) d.skipped_reason = `เพิ่มงบไปแล้ว ${Math.floor(hours)} ชม.ก่อน — งบตั้งแต่ ${freeBelow} ขึ้นไปเว้น ${gapHours} ชม. ให้ ROAS สะท้อนงบใหม่ก่อน`;
  }
}

/**
 * Campaigns above the normal per-campaign ceiling whose yesterday went badly: ROAS < 0.8× its break-even (own or shop's) on
 * ≥ 2,000 spend → back to the normal ceiling now. Yesterday is real Page365 sales once that day's file is uploaded
 * (so usually from the 20:00 run), Meta's tagged sales before that.
 */
export function yesterdayBrakes(entities: Entity[], max: number, beOf: number | null | BeOf): Decision[] {
  const out: Decision[] = [];
  for (const e of entities) {
    const m = e.metrics.yesterday;
    if (e.level !== 'campaign' || e.status !== 'ACTIVE' || e.daily_budget === null || e.daily_budget <= max || !m) continue;
    const be = beFn(beOf)(e.id);
    if (be === null || m.spend < BRAKE_MIN_SPEND || m.roas >= be * 0.8) continue;
    out.push({
      rule_id: 'brake-yesterday', entity: { level: 'campaign', id: e.id, name: e.name, campaign_name: e.campaign_name }, window: 'yesterday', metric: 'roas',
      observed: m.roas, threshold: be * 0.8, action: { type: 'budget_pct', pct: -Math.round((1 - max / e.daily_budget) * 100) },
      plan: `เมื่อวาน ROAS ${m.roas.toFixed(2)} < 0.8× คุ้มทุน ${(be * 0.8).toFixed(2)} (ใช้ไป ${Math.round(m.spend).toLocaleString('th-TH')}) → ลดงบ ${e.daily_budget.toLocaleString('th-TH')} กลับเป็น ${max.toLocaleString('th-TH')}: ${e.name}`,
    });
  }
  return out;
}

/** Remembers when each campaign/ad set last got more budget (for spaceIncreases). */
function markIncreases(decisions: Decision[], state: State, now: Date): void {
  for (const d of decisions) {
    if (d.applied && d.action.type === 'budget_pct' && (d.action.pct ?? 0) > 0) state.last_action[`up:${d.entity.id}`] = now.toISOString();
  }
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
