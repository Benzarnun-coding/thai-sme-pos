// Plans one automation run: group campaigns by the rules that apply to them (stage × product break-even),
// run the ads-engine evaluator per group, and work out which campaigns move to another stage.

import { evaluate, onCooldown } from '../../ads-engine/src/rules.ts';
import type { Decision, Entity, Level, Metrics, Rule, Scope, State, Window } from '../../ads-engine/src/types.ts';
import {
  DEFAULT_SECTION_ID, NO_COD, daysInStage, economics, materializeRules, resolveSectionId, storedRulesFor, sumMetrics,
  type CampaignSetting, type Cod, type CostRow, type Section, type Stage, type WebRule,
} from './model.ts';

const NO_SCOPE: Scope = { campaign_name_prefixes: [], campaign_ids: [] };
/** Break-even is always computed from 7-day campaign numbers, so this window is always fetched. */
export const ECONOMICS_WINDOW: Window = 'last_7d';

export interface Group {
  key: string;
  label: string;
  /** Product line, for break-even */
  section: Section;
  campaignIds: Set<string>;
  stored: WebRule[];
}

/** campaign id → product section id for every campaign entity */
export function sectionMap(entities: Entity[], sections: Section[], settings: Map<string, CampaignSetting>): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of entities) if (c.level === 'campaign') out.set(c.id, resolveSectionId(c, sections, settings));
  return out;
}

/**
 * One group per (stage, product) — same rules, same break-even — plus one per campaign with its own rules.
 * Campaigns with no stage, automation off, or no rules are left out entirely.
 */
export function buildGroups(
  entities: Entity[], sections: Section[], stages: Stage[], settings: Map<string, CampaignSetting>, sectionOf: Map<string, string>,
): Group[] {
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const groups = new Map<string, Group>();
  for (const c of entities.filter((e) => e.level === 'campaign')) {
    const setting = settings.get(c.id);
    const stage = setting?.stage_id ? stageById.get(setting.stage_id) : undefined;
    const stored = storedRulesFor(stage, setting);
    if (!stored || stored.length === 0) continue;
    const section = sectionById.get(sectionOf.get(c.id) ?? DEFAULT_SECTION_ID) ?? sectionById.get(DEFAULT_SECTION_ID)!;
    const custom = setting?.mode === 'custom';
    const key = custom ? `campaign:${c.id}` : `stage:${stage!.id}|section:${section.id}`;
    const g = groups.get(key) ?? {
      key,
      label: custom ? `กฎเฉพาะ › ${c.name}` : `${stage!.name} · ${section.name}`,
      section,
      campaignIds: new Set<string>(),
      stored,
    };
    g.campaignIds.add(c.id);
    groups.set(key, g);
  }
  return [...groups.values()];
}

export function neededWindows(groups: Group[]): Map<Level, Set<Window>> {
  const out = new Map<Level, Set<Window>>([['campaign', new Set([ECONOMICS_WINDOW])]]);
  for (const g of groups) {
    for (const r of g.stored) {
      if (r.enabled === false) continue;
      if (!out.has(r.level)) out.set(r.level, new Set());
      out.get(r.level)!.add(r.window);
    }
  }
  return out;
}

/** Sum of campaign metrics per product section for one window. */
export function sectionTotals(entities: Entity[], sectionOf: Map<string, string>, window: Window) {
  const lists = new Map<string, Metrics[]>();
  for (const c of entities) {
    const m = c.metrics[window];
    if (c.level !== 'campaign' || !m) continue;
    const sid = sectionOf.get(c.id) ?? DEFAULT_SECTION_ID;
    lists.set(sid, [...(lists.get(sid) ?? []), m]);
  }
  return new Map([...lists].map(([sid, ms]) => [sid, sumMetrics(ms)]));
}

export type MoveDecision = Decision & { group: string; move_from: string | null; move_to: string };

export interface Plan {
  decisions: (Decision & { group: string })[];
  moves: MoveDecision[];
  notes: string[];
}

/** Entities must already carry metrics for every window from neededWindows(). */
export function planDecisions(
  groups: Group[], entities: Entity[], sectionOf: Map<string, string>, costs: CostRow[],
  settings: Map<string, CampaignSetting>, stages: Stage[], state: State, now: Date, cod: Cod = NO_COD,
  /** Shop-wide break-even from real Page365 orders: used for product lines whose own can't be computed */
  fallbackBreakeven: number | null = null,
  /** guardrails.max_daily_budget: for ABO campaigns it caps the sum of the ad sets */
  maxCampaignBudget = Infinity,
  /** Break-even per campaign (breakevens.ts); when given it replaces the product line's for the campaigns it has */
  perCampaign?: Map<string, { be: number; source: string }>,
): Plan {
  const decisions: Plan['decisions'] = [];
  const moves: MoveDecision[] = [];
  const notes: string[] = [];
  const totals = sectionTotals(entities, sectionOf, ECONOMICS_WINDOW);
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const zero = { spend: 0, purchases: 0, purchase_value: 0 };

  for (const g of groups) {
    // Break-even comes from the product line's 7-day numbers across all its campaigns, whatever their stage.
    const econ = economics(g.section, costs, totals.get(g.section.id) ?? zero, cod);
    const groupBe = econ.breakeven_roas ?? fallbackBreakeven;
    // Paused campaigns (and their ad sets) aren't spending: nothing to decide for them.
    const pausedCampaigns = new Set(entities.filter((e) => e.level === 'campaign' && e.status !== 'ACTIVE').map((e) => e.id));
    const active = entities.filter((e) => g.campaignIds.has(e.campaign_id) && !pausedCampaigns.has(e.campaign_id));
    // Campaigns sharing a break-even are judged together; without per-campaign ones that is the whole group.
    const byBe = new Map<number | null, Entity[]>();
    for (const e of active) {
      const be = perCampaign?.get(e.campaign_id)?.be ?? groupBe;
      byBe.set(be, [...(byBe.get(be) ?? []), e]);
    }
    if (!perCampaign && econ.breakeven_roas === null && groupBe !== null) notes.push(`[${g.label}] ใช้ ROAS คุ้มทุนรวมร้าน ${groupBe.toFixed(2)} (จากออเดอร์จริง Page365) เพราะสินค้านี้ยังคิดคุ้มทุนเองไม่ได้`);
    for (const [be, members] of byBe) {
      const { actions, moves: moveRules, notes: ruleNotes } = materializeRules(g.stored, be);
      for (const n of ruleNotes) if (!notes.includes(`[${g.label}] ${n}`)) notes.push(`[${g.label}] ${n}`);
      for (const d of withAdsetBudgets(evaluate(members, actions, NO_SCOPE, state, now), entities, actions, state, now, maxCampaignBudget)) decisions.push({ ...d, group: g.label });

      // Moves: each rule separately (so a too-young campaign can't block a later rule), campaign level only.
      const campaigns = members.filter((e) => e.level === 'campaign');
      for (const rule of moveRules) {
        for (const d of evaluate(campaigns, [{ ...rule, level: 'campaign' }], NO_SCOPE, { last_action: {} }, now)) {
          const from = settings.get(d.entity.id)?.stage_id ?? null;
          const days = daysInStage(settings.get(d.entity.id), now);
          const move: MoveDecision = {
            ...d,
            group: g.label,
            move_from: from,
            move_to: rule.to,
            plan: `ย้าย "${d.entity.name}" ${stageName.get(from ?? '') ?? 'ไม่มีกลุ่ม'} → ${stageName.get(rule.to) ?? rule.to} [${d.window} ${d.metric}=${d.observed} เทียบ ${d.threshold}]`,
          };
          if (from === rule.to) move.skipped_reason = 'อยู่ในกลุ่มปลายทางอยู่แล้ว';
          else if (days < rule.min_days_in_stage) move.skipped_reason = `อยู่ในกลุ่มนี้ ${Math.floor(days)} วัน ยังไม่ครบ ${rule.min_days_in_stage} วัน`;
          else if (moves.some((m) => m.entity.id === d.entity.id && !m.skipped_reason)) move.skipped_reason = 'มีกฎย้ายข้ออื่นทำไปแล้วรอบนี้';
          moves.push(move);
        }
      }
    }
  }
  return { decisions, moves, notes };
}

/**
 * A campaign whose budget lives on its ad sets (ABO, e.g. "REV 801 - กระบอกยืด 3 ตัว 799") can't take a campaign
 * budget change. Its campaign-level budget decision is turned into the same change on each active ad set with a
 * daily budget, judged by the campaign's numbers; each ad set keeps its own cooldown. Like a CBO campaign, an ABO
 * campaign gets one budget change per run (the first matching rule), and the per-campaign cap
 * (`maxCampaignBudget`) applies to the sum of its ad sets: an increase is trimmed so the sum stays under it.
 */
export function withAdsetBudgets(decisions: Decision[], entities: Entity[], rules: Rule[], state: State, now: Date, maxCampaignBudget = Infinity): Decision[] {
  const out: Decision[] = [];
  const done = new Set<string>();
  for (const d of decisions) {
    out.push(d);
    if (d.action.type !== 'budget_pct' || d.entity.level !== 'campaign' || !d.skipped_reason?.startsWith('no daily budget')) continue;
    const adsets = entities.filter((e) => e.level === 'adset' && e.campaign_id === d.entity.id && e.status === 'ACTIVE' && e.daily_budget !== null);
    const rule = rules.find((r) => r.id === d.rule_id);
    if (!adsets.length || !rule) continue;
    if (done.has(d.entity.id)) { d.skipped_reason = 'another rule already acted on this entity'; continue; }
    // Like a CBO campaign, a rule still on cooldown (here: on every ad set) lets the next matching rule act.
    if (!adsets.every((a) => onCooldown(rule, a.id, state, now))) done.add(d.entity.id);
    let pct = d.action.pct ?? 0;
    const total = adsets.reduce((t, a) => t + a.daily_budget!, 0);
    if (pct > 0 && total * (1 + pct / 100) > maxCampaignBudget) {
      pct = Math.floor((maxCampaignBudget / total - 1) * 100);
      if (pct < 1) { d.skipped_reason = `งบรวมชุดโฆษณา (ABO) ${Math.round(total)} ถึงเพดานต่อแคมเปญ ${maxCampaignBudget} แล้ว`; continue; }
    }
    d.skipped_reason = `งบอยู่ที่ชุดโฆษณา (ABO) → ปรับ ${adsets.length} ชุดโฆษณาแทน${pct !== d.action.pct ? ` (${pct > 0 ? '+' : ''}${pct}% ไม่ให้เกินเพดานต่อแคมเปญ)` : ''}`;
    for (const a of adsets) {
      const ad: Decision = {
        ...d,
        action: { ...d.action, pct },
        entity: { level: 'adset', id: a.id, name: a.name, campaign_name: a.campaign_name },
        before: { status: a.status, daily_budget: a.daily_budget },
        plan: `BUDGET ${pct > 0 ? '+' : ''}${pct}% on adset "${a.name}" ของแคมเปญ "${d.entity.name}" [${d.window} ${d.metric}=${d.observed} vs ${d.threshold}] (now ${a.daily_budget})`,
        skipped_reason: onCooldown(rule, a.id, state, now) ? 'cooldown' : undefined,
      };
      out.push(ad);
    }
  }
  return out;
}
