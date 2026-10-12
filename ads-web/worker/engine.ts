// Plans one automation run: group campaigns by the rules that apply to them (stage × product break-even),
// run the ads-engine evaluator per group, and work out which campaigns move to another stage.

import { evaluate } from '../../ads-engine/src/rules.ts';
import type { Decision, Entity, Level, Metrics, Scope, State, Window } from '../../ads-engine/src/types.ts';
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
    const { actions, moves: moveRules, notes: ruleNotes } = materializeRules(g.stored, econ.breakeven_roas);
    notes.push(...ruleNotes.map((n) => `[${g.label}] ${n}`));
    const members = entities.filter((e) => g.campaignIds.has(e.campaign_id));
    for (const d of evaluate(members, actions, NO_SCOPE, state, now)) decisions.push({ ...d, group: g.label });

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
  return { decisions, moves, notes };
}
