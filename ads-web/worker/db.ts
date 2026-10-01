// D1 access. JSON columns are parsed here so the rest of the worker only sees typed objects.

import type { Guardrails, State } from '../../ads-engine/src/types.ts';
import type { CampaignMode, CampaignSetting, Cod, CostRow, Section, Stage, WebRule } from './model.ts';

export interface Settings {
  dry_run: boolean;
  kill_switch: boolean;
  guardrails: Guardrails;
  sheet_id: string;
  sheet_tabs: string[];
  /** COD surcharge admins include in the value they tag in Meta */
  cod_share_pct: number;
  cod_fee: number;
}

export function codOf(s: Pick<Settings, 'cod_share_pct' | 'cod_fee'>): Cod {
  return { share: s.cod_share_pct / 100, fee: s.cod_fee };
}

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const kv = new Map(results.map((r) => [r.key, r.value]));
  return {
    dry_run: kv.get('dry_run') !== 'false',
    kill_switch: kv.get('kill_switch') === 'true',
    guardrails: JSON.parse(kv.get('guardrails') ?? '{}'),
    sheet_id: kv.get('sheet_id') ?? '',
    sheet_tabs: JSON.parse(kv.get('sheet_tabs') ?? '[]'),
    cod_share_pct: Number(kv.get('cod_share_pct') ?? 0),
    cod_fee: Number(kv.get('cod_fee') ?? 50),
  };
}

export async function saveSettings(db: D1Database, s: Settings): Promise<void> {
  const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  await db.batch([
    put.bind('dry_run', String(s.dry_run)),
    put.bind('kill_switch', String(s.kill_switch)),
    put.bind('guardrails', JSON.stringify(s.guardrails)),
    put.bind('sheet_id', s.sheet_id),
    put.bind('sheet_tabs', JSON.stringify(s.sheet_tabs)),
    put.bind('cod_share_pct', String(s.cod_share_pct)),
    put.bind('cod_fee', String(s.cod_fee)),
  ]);
}

interface SectionRow {
  id: string; name: string; keywords: string; products: string; tiers: string; units_per_order: number;
  extra_cost_per_order: number; price_per_order: number | null; sort: number;
}

export async function loadSections(db: D1Database): Promise<Section[]> {
  const { results } = await db.prepare('SELECT * FROM sections ORDER BY sort, name').all<SectionRow>();
  return results.map((r) => ({ ...r, keywords: JSON.parse(r.keywords), products: JSON.parse(r.products), tiers: JSON.parse(r.tiers ?? '[]') }));
}

export async function saveSection(db: D1Database, s: Section): Promise<void> {
  await db.prepare(
    `INSERT INTO sections (id, name, keywords, products, tiers, units_per_order, extra_cost_per_order, price_per_order, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, keywords = excluded.keywords, products = excluded.products, tiers = excluded.tiers,
       units_per_order = excluded.units_per_order, extra_cost_per_order = excluded.extra_cost_per_order,
       price_per_order = excluded.price_per_order, sort = excluded.sort`,
  ).bind(
    s.id, s.name, JSON.stringify(s.keywords), JSON.stringify(s.products), JSON.stringify(s.tiers), s.units_per_order, s.extra_cost_per_order,
    s.price_per_order, s.sort,
  ).run();
}

export async function loadStages(db: D1Database): Promise<Stage[]> {
  const { results } = await db.prepare('SELECT * FROM stages ORDER BY sort')
    .all<{ id: string; name: string; description: string; rules: string; automation: number; sort: number }>();
  return results.map((r) => ({ ...r, rules: JSON.parse(r.rules), automation: r.automation === 1 }));
}

/** Stages are a fixed set (seeded in the migration); only name, description, rules and automation change. */
export async function saveStage(db: D1Database, s: Stage): Promise<void> {
  await db.prepare('UPDATE stages SET name = ?, description = ?, rules = ?, automation = ? WHERE id = ?')
    .bind(s.name, s.description, JSON.stringify(s.rules), s.automation ? 1 : 0, s.id).run();
}

/** Campaigns pinned to the deleted section fall back to keyword matching. */
export async function deleteSection(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM sections WHERE id = ?').bind(id),
    db.prepare('UPDATE campaigns SET section_id = NULL WHERE section_id = ?').bind(id),
  ]);
}

export async function loadCampaignSettings(db: D1Database): Promise<Map<string, CampaignSetting>> {
  const { results } = await db.prepare('SELECT campaign_id, section_id, stage_id, stage_since, mode, rules FROM campaigns')
    .all<{ campaign_id: string; section_id: string | null; stage_id: string | null; stage_since: string | null; mode: CampaignMode; rules: string | null }>();
  return new Map(results.map((r) => [r.campaign_id, { ...r, rules: r.rules ? (JSON.parse(r.rules) as WebRule[]) : null }]));
}

export async function saveCampaignSetting(db: D1Database, c: CampaignSetting): Promise<void> {
  await db.prepare(
    `INSERT INTO campaigns (campaign_id, section_id, stage_id, stage_since, mode, rules, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id) DO UPDATE SET section_id = excluded.section_id, stage_id = excluded.stage_id,
       stage_since = excluded.stage_since, mode = excluded.mode, rules = excluded.rules, updated_at = excluded.updated_at`,
  ).bind(c.campaign_id, c.section_id, c.stage_id, c.stage_since, c.mode, c.rules ? JSON.stringify(c.rules) : null, new Date().toISOString()).run();
}

/** Automatic stage moves from one run: one statement for all campaigns, plus one audit statement. */
/** Several campaign settings in one statement (bulk stage change). */
export async function saveCampaignSettings(db: D1Database, list: CampaignSetting[]): Promise<void> {
  if (!list.length) return;
  await db.prepare(
    `INSERT INTO campaigns (campaign_id, section_id, stage_id, stage_since, mode, rules, updated_at)
     SELECT value ->> '$.campaign_id', value ->> '$.section_id', value ->> '$.stage_id', value ->> '$.stage_since', value ->> '$.mode', value ->> '$.rules', ?1
     FROM json_each(?2)
     WHERE true ON CONFLICT(campaign_id) DO UPDATE SET section_id = excluded.section_id, stage_id = excluded.stage_id,
       stage_since = excluded.stage_since, mode = excluded.mode, rules = excluded.rules, updated_at = excluded.updated_at`,
  ).bind(new Date().toISOString(), JSON.stringify(list.map((c) => ({ ...c, rules: c.rules ? JSON.stringify(c.rules) : null })))).run();
}

export async function applyMoves(db: D1Database, moves: { campaign_id: string; name: string; from: string | null; to: string }[], at: string): Promise<void> {
  if (!moves.length) return;
  const json = JSON.stringify(moves);
  await db.batch([
    db.prepare(
      `INSERT INTO campaigns (campaign_id, stage_id, stage_since, mode, updated_at)
       SELECT value ->> '$.campaign_id', value ->> '$.to', ?1, 'stage', ?1 FROM json_each(?2)
       WHERE true ON CONFLICT(campaign_id) DO UPDATE SET stage_id = excluded.stage_id, stage_since = excluded.stage_since, updated_at = excluded.updated_at`,
    ).bind(at, json),
    db.prepare(
      `INSERT INTO audit (at, actor, action, target, detail)
       SELECT ?1, 'อัตโนมัติ', 'campaign.stage', value ->> '$.campaign_id', json_object('name', value ->> '$.name', 'from', value ->> '$.from', 'to', value ->> '$.to')
       FROM json_each(?2)`,
    ).bind(at, json),
  ]);
}

export async function loadCosts(db: D1Database): Promise<CostRow[]> {
  const { results } = await db.prepare('SELECT * FROM costs').all<CostRow>();
  return results;
}

// Bulk writes go through json_each so a whole tab is 2 statements — the Workers free plan caps queries per invocation.

export async function replaceCosts(db: D1Database, tab: string, rows: CostRow[]): Promise<void> {
  // One batch = one transaction, so a tab is never left half-written.
  await db.batch([
    db.prepare('DELETE FROM costs WHERE tab = ?').bind(tab),
    db.prepare(
      `INSERT INTO costs (tab, code, name, sku_count, avg_cost, min_cost, max_cost, avg_price)
       SELECT ?1, value ->> '$.code', value ->> '$.name', value ->> '$.sku_count', value ->> '$.avg_cost',
              value ->> '$.min_cost', value ->> '$.max_cost', value ->> '$.avg_price'
       FROM json_each(?2)`,
    ).bind(tab, JSON.stringify(rows)),
  ]);
}

export async function loadState(db: D1Database): Promise<State> {
  const { results } = await db.prepare('SELECT key, at FROM cooldowns').all<{ key: string; at: string }>();
  return { last_action: Object.fromEntries(results.map((r) => [r.key, r.at])) };
}

export async function saveState(db: D1Database, state: State): Promise<void> {
  const entries = Object.entries(state.last_action).map(([key, at]) => ({ key, at }));
  if (!entries.length) return;
  await db.prepare(
    `INSERT INTO cooldowns (key, at) SELECT value ->> '$.key', value ->> '$.at' FROM json_each(?)
     WHERE true ON CONFLICT(key) DO UPDATE SET at = excluded.at`,
  ).bind(JSON.stringify(entries)).run();
}

export async function insertRun(db: D1Database, run: { run_at: string; trigger: string; dry_run: boolean; summary: string; report: unknown }): Promise<void> {
  await db.prepare('INSERT INTO runs (run_at, trigger, dry_run, summary, report) VALUES (?, ?, ?, ?, ?)')
    .bind(run.run_at, run.trigger, run.dry_run ? 1 : 0, run.summary, JSON.stringify(run.report)).run();
}

export async function listRuns(db: D1Database, limit = 30) {
  const { results } = await db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ?').bind(limit)
    .all<{ id: number; run_at: string; trigger: string; dry_run: number; summary: string; report: string }>();
  return results.map((r) => ({ ...r, dry_run: r.dry_run === 1, report: JSON.parse(r.report) }));
}

export async function audit(db: D1Database, actor: string, action: string, target: string, detail: unknown): Promise<void> {
  await db.prepare('INSERT INTO audit (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(new Date().toISOString(), actor, action, target, JSON.stringify(detail)).run();
}

export async function auditMany(db: D1Database, actor: string, action: string, entries: { target: string; detail: unknown }[]): Promise<void> {
  if (!entries.length) return;
  await db.prepare(
    `INSERT INTO audit (at, actor, action, target, detail)
     SELECT ?1, ?2, ?3, value ->> '$.target', value ->> '$.detail' FROM json_each(?4)`,
  ).bind(new Date().toISOString(), actor, action, JSON.stringify(entries.map((e) => ({ target: e.target, detail: JSON.stringify(e.detail) })))).run();
}

/** Manual changes to one campaign (or its ad sets) plus what automated runs did to it. */
export async function campaignHistory(db: D1Database, campaignId: string, adsetIds: string[] = []) {
  const targets = [campaignId, ...adsetIds];
  const [audits, runs] = await Promise.all([
    db.prepare(`SELECT * FROM audit WHERE target IN (SELECT value FROM json_each(?)) ORDER BY id DESC LIMIT 50`).bind(JSON.stringify(targets)).all(),
    db.prepare(`SELECT id, run_at, trigger, dry_run, report FROM runs WHERE instr(report, ?) > 0 ORDER BY id DESC LIMIT 20`).bind(campaignId)
      .all<{ id: number; run_at: string; trigger: string; dry_run: number; report: string }>(),
  ]);
  const runItems = runs.results.flatMap((r) => {
    const rep = JSON.parse(r.report);
    const mine = (d: any) => targets.includes(d.entity?.id);
    return [...(rep.decisions ?? []), ...(rep.moves ?? [])].filter(mine).map((d: any) => ({
      run_id: r.id, run_at: r.run_at, trigger: r.trigger, dry_run: r.dry_run === 1,
      plan: d.plan as string, skipped_reason: d.skipped_reason ?? null, applied: Boolean(d.applied), error: d.error ?? null,
    }));
  });
  return { audit: audits.results, runs: runItems };
}

export async function listAudit(db: D1Database, limit = 100) {
  const { results } = await db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').bind(limit).all();
  return results;
}
