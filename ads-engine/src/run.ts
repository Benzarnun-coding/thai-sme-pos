// Single entry point. One run = fetch → evaluate → (apply) → log → notify.
//
//   node --env-file=.env src/run.ts            dry run (default)
//   DRY_RUN=false node --env-file=.env src/run.ts   apply for real

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MetaClient } from './meta.ts';
import { evaluate, inScope, windowsNeeded } from './rules.ts';
import { applyDecisions, sumBudget } from './apply.ts';
import { formatReport, pushLine } from './notify.ts';
import type { Decision, RulesFile, RunReport, State } from './types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RULES_PATH = process.env.RULES_FILE ?? join(ROOT, 'rules.json');
const STATE_PATH = join(ROOT, 'state.json');
const LOG_DIR = join(ROOT, 'logs');

async function main() {
  const token = required('META_ACCESS_TOKEN');
  const accountId = required('META_AD_ACCOUNT_ID');
  const dryRun = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
  if (process.env.KILL_SWITCH === 'true') {
    console.log('KILL_SWITCH=true → ไม่ทำอะไร');
    return;
  }

  const rulesFile: RulesFile = JSON.parse(readFileSync(RULES_PATH, 'utf8'));
  const state: State = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : { last_action: {} };
  const meta = new MetaClient(token, accountId, process.env.META_API_VERSION);
  const now = new Date();
  const report: RunReport = {
    run_at: now.toISOString(),
    account_id: accountId,
    dry_run: dryRun,
    entities_evaluated: 0,
    decisions: [],
    totals: { daily_budget_before: 0, daily_budget_after: 0 },
    errors: [],
  };

  console.log(`account: ${await meta.accountName()}  mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);

  // 1. Fetch entities and only the insight windows the rules need.
  const all = await meta.listEntities();
  const entities = all.filter((e) => inScope(e, rulesFile.scope));
  report.entities_evaluated = entities.length;
  const levels = [...new Set(rulesFile.rules.map((r) => r.level))];
  for (const level of levels) {
    for (const window of windowsNeeded(rulesFile.rules.filter((r) => r.level === level))) {
      const m = await meta.insights(level, window);
      for (const e of entities) if (e.level === level) e.metrics[window] = m.get(e.id) ?? zeroMetrics();
    }
  }
  report.totals.daily_budget_before = sumBudget(entities);

  // 2. Evaluate.
  const decisions = evaluate(entities, rulesFile.rules, rulesFile.scope, state, now);
  report.decisions = decisions;

  // 3. Apply with guardrails.
  const applied = await applyDecisions(decisions, entities, meta, rulesFile.guardrails, state, { dryRun, now });
  report.errors.push(...applied.errors);
  report.totals.daily_budget_after = applied.totalAfter;

  // 4. Persist log + state.
  mkdirSync(LOG_DIR, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(LOG_DIR, `${stamp}.json`), JSON.stringify(report, null, 2));
  if (!dryRun) writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

  // 5. Print + optional LINE.
  const text = formatReport(report);
  console.log('\n' + text);
  const pushed = await pushLine(text, process.env.LINE_CHANNEL_ACCESS_TOKEN, process.env.LINE_TO);
  if (pushed) console.log('\n(sent to LINE)');
  if (report.errors.length) process.exitCode = 1;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`missing env ${name} (ดู .env.example)`); process.exit(2); }
  return v;
}
function zeroMetrics() {
  return { spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, purchases: 0, purchase_value: 0, cpa: Infinity, roas: 0, frequency: 0, messages: 0, cost_per_message: Infinity };
}

main().catch((err) => { console.error(err); process.exit(1); });
export type { Decision };
