// Apply evaluated decisions with guardrails. Shared by the CLI (run.ts) and ads-web (Cloudflare Worker).

import { clampBudget } from './rules.ts';
import type { Decision, Entity, Guardrails, State } from './types.ts';

export interface Mutator {
  setStatus(id: string, status: 'ACTIVE' | 'PAUSED'): Promise<void>;
  setDailyBudget(id: string, amount: number): Promise<void>;
}

export interface ApplyOptions {
  dryRun: boolean;
  now: Date;
  /** Per-entity budget ceiling instead of guardrails.max_daily_budget (ads-web: proven winners get a higher one) */
  maxBudgetFor?: (entityId: string) => number | undefined;
}

/**
 * Mutates each decision (after/applied/skipped_reason/error) and state.last_action.
 * Returns the projected sum of daily budgets after the run and any errors.
 */
export async function applyDecisions(
  decisions: Decision[],
  entities: Entity[],
  meta: Mutator,
  guardrails: Guardrails,
  state: State,
  { dryRun, now, maxBudgetFor }: ApplyOptions,
): Promise<{ totalAfter: number; errors: string[] }> {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const errors: string[] = [];
  let projectedTotal = sumBudget(entities);
  for (const d of decisions) {
    if (d.skipped_reason) continue;
    const e = byId.get(d.entity.id)!;
    try {
      if (d.action.type === 'notify') { d.applied = true; continue; }

      if (d.action.type === 'pause' || d.action.type === 'enable') {
        const status = d.action.type === 'pause' ? 'PAUSED' : 'ACTIVE';
        if (!dryRun) await meta.setStatus(e.id, status);
        d.after = { status, daily_budget: e.daily_budget };
        d.applied = !dryRun;
      }

      if (d.action.type === 'budget_pct') {
        const max = maxBudgetFor?.(e.id);
        const c = clampBudget(e.daily_budget!, d.action.pct ?? 0, max === undefined ? guardrails : { ...guardrails, max_daily_budget: max });
        if (!c) { d.skipped_reason = 'budget change rounds to zero or blocked by guardrails'; continue; }
        const delta = c.next - e.daily_budget!;
        // The total cap only stops increases: a cut must go through even when the total is already over the cap.
        if (delta > 0 && projectedTotal + delta > guardrails.max_total_daily_budget) {
          d.skipped_reason = `would exceed max_total_daily_budget (${guardrails.max_total_daily_budget})`;
          continue;
        }
        if (!dryRun) await meta.setDailyBudget(e.id, c.next);
        projectedTotal += delta;
        d.after = { status: e.status, daily_budget: c.next };
        if (c.note) d.plan += ` (${c.note})`;
        d.applied = !dryRun;
      }

      if (!dryRun) state.last_action[`${d.rule_id}:${e.id}`] = now.toISOString();
    } catch (err: any) {
      d.error = err?.message ?? String(err);
      errors.push(`${d.rule_id}/${e.name}: ${d.error}`);
    }
  }
  return { totalAfter: Math.round(projectedTotal), errors };
}

/** Daily budget actually being spent: active campaigns, plus active ad sets of active campaigns (paused ones don't count). */
export function sumBudget(entities: Entity[]): number {
  const activeCampaigns = new Set(entities.filter((e) => e.level === 'campaign' && e.status === 'ACTIVE').map((e) => e.id));
  return Math.round(entities.reduce((s, e) => {
    if (e.status !== 'ACTIVE') return s;
    if (e.level === 'adset' && !activeCampaigns.has(e.campaign_id)) return s;
    return s + (e.daily_budget ?? 0);
  }, 0));
}
