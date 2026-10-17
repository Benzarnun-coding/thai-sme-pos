// Pure rule evaluation. No I/O here so it can be unit-tested.

import type { Decision, Entity, Guardrails, Op, Rule, Scope, State, Window } from './types.ts';

export function inScope(e: Entity, scope: Scope): boolean {
  if (scope.campaign_ids.length && !scope.campaign_ids.includes(e.campaign_id)) return false;
  if (scope.campaign_name_prefixes.length && !scope.campaign_name_prefixes.some((p) => e.campaign_name.startsWith(p))) return false;
  return true;
}

function compare(observed: number, op: Op, threshold: number): boolean {
  switch (op) {
    case '>': return observed > threshold;
    case '>=': return observed >= threshold;
    case '<': return observed < threshold;
    case '<=': return observed <= threshold;
  }
}

export function onCooldown(rule: Rule, entityId: string, state: State, now: Date): boolean {
  const hours = rule.cooldown_hours ?? 24;
  const last = state.last_action[`${rule.id}:${entityId}`];
  if (!last) return false;
  return now.getTime() - new Date(last).getTime() < hours * 3600_000;
}

/** Which windows the rules need, so the runner fetches only those. */
export function windowsNeeded(rules: Rule[]): Window[] {
  return [...new Set(rules.filter((r) => r.enabled !== false).map((r) => r.window))];
}

export function evaluate(entities: Entity[], rules: Rule[], scope: Scope, state: State, now = new Date()): Decision[] {
  const decisions: Decision[] = [];
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    for (const e of entities) {
      if (e.level !== rule.level || !inScope(e, scope)) continue;
      const m = e.metrics[rule.window];
      if (!m) continue;
      if (rule.min_spend !== undefined && m.spend < rule.min_spend) continue;
      if (rule.min_purchases !== undefined && m.purchases < rule.min_purchases) continue;
      const observed = m[rule.metric];
      if (!compare(observed, rule.op, rule.value)) continue;

      const d: Decision = {
        rule_id: rule.id,
        entity: { level: e.level, id: e.id, name: e.name, campaign_name: e.campaign_name },
        window: rule.window,
        metric: rule.metric,
        observed: round(observed),
        threshold: rule.value,
        action: rule.action,
        plan: '',
        before: { status: e.status, daily_budget: e.daily_budget },
      };

      if (onCooldown(rule, e.id, state, now)) {
        d.skipped_reason = 'cooldown';
      } else if (rule.action.type === 'pause' && e.status === 'PAUSED') {
        d.skipped_reason = 'already paused';
      } else if (rule.action.type === 'enable' && e.status === 'ACTIVE') {
        d.skipped_reason = 'already active';
      } else if (rule.action.type === 'budget_pct' && e.daily_budget === null) {
        d.skipped_reason = 'no daily budget on this entity (CBO campaign or lifetime budget)';
      }

      d.plan = describe(d, e);
      decisions.push(d);
    }
  }
  // One action per entity per run: first matching rule wins (rules are ordered by priority in the file).
  const seen = new Set<string>();
  return decisions.filter((d) => {
    if (d.skipped_reason) return true;
    const key = d.entity.id;
    if (seen.has(key)) { d.skipped_reason = 'another rule already acted on this entity'; return true; }
    seen.add(key);
    return true;
  });
}

/** Clamp a proposed budget to guardrails. Returns null when the move is not allowed. */
export function clampBudget(current: number, pct: number, g: Guardrails): { next: number; note?: string } | null {
  const capped = Math.max(-g.max_change_pct_per_run, Math.min(g.max_change_pct_per_run, pct));
  let next = current * (1 + capped / 100);
  let note = capped !== pct ? `pct capped ${pct}→${capped}` : undefined;
  if (next < g.min_daily_budget) { next = g.min_daily_budget; note = 'hit min_daily_budget'; }
  if (next > g.max_daily_budget) { next = g.max_daily_budget; note = 'hit max_daily_budget'; }
  next = Math.round(next);
  if (next === Math.round(current)) return null;
  // The min/max must never turn a move around: a +20% on a budget set above the max (e.g. 5,000 in Ads Manager)
  // is not a cut to the max, and a cut on a budget under the min is not a raise to the min.
  if ((capped > 0 && next < current) || (capped < 0 && next > current)) return null;
  return { next, note };
}

function describe(d: Decision, e: Entity): string {
  const where = `${e.level} "${e.name}" [${d.window} ${d.metric}=${fmt(d.observed)} ${'vs'} ${d.threshold}]`;
  switch (d.action.type) {
    case 'pause': return `PAUSE ${where}`;
    case 'enable': return `ENABLE ${where}`;
    case 'budget_pct': return `BUDGET ${d.action.pct! > 0 ? '+' : ''}${d.action.pct}% on ${where} (now ${e.daily_budget})`;
    case 'notify': return `NOTIFY ${where}`;
  }
}

function fmt(n: number): string {
  return Number.isFinite(n) ? String(round(n)) : '∞';
}
function round(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : n;
}
