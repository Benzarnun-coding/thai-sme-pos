// Worker entry: JSON API for the dashboard + cron triggers. Static files in dist/ are served by Cloudflare before this runs.

import { MetaClient } from '../../ads-engine/src/meta.ts';
import { applyDecisions } from '../../ads-engine/src/apply.ts';
import type { Entity, Level, Window } from '../../ads-engine/src/types.ts';
import { authenticate } from './auth.ts';
import { syncCosts } from './costs.ts';
import {
  audit, deleteSection, insertRun, listAudit, listRuns, loadCampaignSettings, loadCosts, loadSections, loadSettings,
  loadStages, loadState, saveCampaignSetting, saveCampaignSettings, auditMany, campaignHistory, saveSection, saveSettings, saveStage,
} from './db.ts';
import { ECONOMICS_WINDOW, sectionMap, sectionTotals } from './engine.ts';
import { MockMeta } from './mock.ts';
import { DEFAULT_SECTION_ID, economics, suggestProducts, type CampaignSetting, type CostRow, type Economics, type Section } from './model.ts';
import { capChanges, planRun, runAutomation, zeroMetrics, type MetaLike } from './run.ts';
import { buildIdeas } from './ideas.ts';
import { friendlyMetaError, loadMetaData, MetaCacheError, patchCachedEntity, type MetaData } from './metadata.ts';
import { BadRequest, validateCampaignSetting, validateSection, validateSettings, validateStage } from './validate.ts';

export interface Env {
  DB: D1Database;
  META_ACCESS_TOKEN?: string;
  META_AD_ACCOUNT_ID: string;
  META_API_VERSION?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_TO?: string;
  /** Local development only (.dev.vars) */
  DEV_MOCK_META?: string;
  DEV_BYPASS_AUTH?: string;
}

const RULES_CRON = '0 1,13 * * *';
const COSTS_CRON = '30 0 * * *';
const DASHBOARD_WINDOWS: Window[] = ['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d'];

function metaFor(env: Env): MetaLike {
  if (env.DEV_MOCK_META === 'true') return new MockMeta(env.DB);
  if (!env.META_ACCESS_TOKEN) throw new BadRequest('ยังไม่ได้ตั้ง META_ACCESS_TOKEN (npx wrangler secret put META_ACCESS_TOKEN)');
  return new MetaClient(env.META_ACCESS_TOKEN, env.META_AD_ACCOUNT_ID, env.META_API_VERSION);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });

    const user = await authenticate(req, env).catch(() => null);
    if (!user) return json({ error: 'ต้องล็อกอินผ่าน Cloudflare Access' }, 401);
    // Access cookies ride along on cross-site requests; only accept writes that come from this site.
    if (req.method !== 'GET') {
      const origin = req.headers.get('Origin');
      if (origin && origin !== url.origin) return json({ error: 'cross-origin request refused' }, 403);
    }

    try {
      return await route(req, env, url, user);
    } catch (err: any) {
      if (err instanceof BadRequest) return json({ error: err.message }, 400);
      console.error(err);
      return json({ error: err?.message ?? String(err) }, 500);
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === COSTS_CRON) {
      ctx.waitUntil(loadSettings(env.DB).then((s) => (s.sheet_id ? syncCosts(env.DB, s) : [])));
    } else if (event.cron === RULES_CRON) {
      let meta: MetaLike;
      try {
        meta = metaFor(env);
      } catch (err: any) {
        // Surface setup problems (e.g. missing token) in the dashboard's history instead of only in Cloudflare logs.
        const run_at = new Date().toISOString();
        ctx.waitUntil(insertRun(env.DB, { run_at, trigger: 'schedule', dry_run: true, summary: `ผิดพลาด: ${err.message}`, report: { run_at, dry_run: true, entities_evaluated: 0, decisions: [], totals: { daily_budget_before: 0, daily_budget_after: 0 }, errors: [err.message], notes: [] } }));
        return;
      }
      ctx.waitUntil(runAutomation(env, meta, { trigger: 'schedule' }));
    }
  },
} satisfies ExportedHandler<Env>;

async function route(req: Request, env: Env, url: URL, user: string): Promise<Response> {
  const path = url.pathname.replace(/\/$/, '');
  const method = req.method;
  const body = async () => (await req.json().catch(() => { throw new BadRequest('ข้อมูลไม่ใช่ JSON'); })) as any;
  let m: RegExpMatchArray | null;

  if (method === 'GET' && path === '/api/me') return json({ email: user, mock: env.DEV_MOCK_META === 'true' });

  if (method === 'GET' && path === '/api/overview') {
    const w = url.searchParams.get('window') as Window;
    return json(await overview(env, DASHBOARD_WINDOWS.includes(w) ? w : 'last_7d', url.searchParams.get('fresh') === '1'));
  }

  // ---- sections ----
  if (method === 'POST' && path === '/api/sections') {
    const input = await body();
    const sections = await loadSections(env.DB);
    const id = `s${Date.now().toString(36)}`;
    const s = validateSection(id, input, Math.max(0, ...sections.filter((x) => x.id !== DEFAULT_SECTION_ID).map((x) => x.sort + 1)));
    await saveSection(env.DB, s);
    await audit(env.DB, user, 'section.create', id, s);
    return json(s);
  }
  if ((m = path.match(/^\/api\/sections\/([\w-]+)$/))) {
    const id = m[1];
    const existing = (await loadSections(env.DB)).find((s) => s.id === id);
    if (!existing) return json({ error: 'ไม่พบ section' }, 404);
    if (method === 'PUT') {
      const s = validateSection(id, await body(), existing.sort);
      await saveSection(env.DB, s);
      await audit(env.DB, user, 'section.update', id, { before: existing, after: s });
      return json(s);
    }
    if (method === 'DELETE') {
      if (id === DEFAULT_SECTION_ID) throw new BadRequest('ลบกลุ่มหลักไม่ได้');
      await deleteSection(env.DB, id);
      await audit(env.DB, user, 'section.delete', id, existing);
      return json({ ok: true });
    }
  }

  // ---- stages (fixed four; rules and names editable) ----
  if (method === 'PUT' && (m = path.match(/^\/api\/stages\/([\w-]+)$/))) {
    const stages = await loadStages(env.DB);
    const existing = stages.find((s) => s.id === m![1]);
    if (!existing) return json({ error: 'ไม่พบกลุ่ม' }, 404);
    const s = validateStage(existing, await body(), stages.map((x) => x.id));
    await saveStage(env.DB, s);
    await audit(env.DB, user, 'stage.update', s.id, { before: existing, after: s });
    return json(s);
  }

  // ---- per-campaign settings: stage, product line, rule mode ----
  if (method === 'PUT' && (m = path.match(/^\/api\/campaigns\/(\d+)$/))) {
    const input = await body();
    const [stages, previous] = await Promise.all([loadStages(env.DB), loadCampaignSettings(env.DB).then((all) => all.get(m![1]))]);
    const c = validateCampaignSetting(m[1], input, stages.map((s) => s.id), previous);
    if (c.section_id && !(await loadSections(env.DB)).some((s) => s.id === c.section_id)) throw new BadRequest('ไม่พบกลุ่มสินค้า');
    await saveCampaignSetting(env.DB, c);
    const stageChanged = (previous?.stage_id ?? null) !== c.stage_id;
    await audit(env.DB, user, stageChanged ? 'campaign.stage' : 'campaign.settings', c.campaign_id, stageChanged
      ? { name: input?.name, from: previous?.stage_id ?? null, to: c.stage_id }
      : { name: input?.name, before: previous ?? null, after: c });
    return json(c);
  }

  // ---- manual controls on Meta (real changes, even when automation is in dry-run) ----
  if (method === 'POST' && (m = path.match(/^\/api\/entities\/(\d+)\/(status|budget)$/))) {
    const [, id, what] = m;
    const input = await body();
    const meta = metaFor(env);
    if (what === 'status') {
      if (input?.status !== 'ACTIVE' && input?.status !== 'PAUSED') throw new BadRequest('status ต้องเป็น ACTIVE หรือ PAUSED');
      await meta.setStatus(id, input.status);
      await patchCachedEntity(env.DB, id, { status: input.status });
      await audit(env.DB, user, 'meta.status', id, { status: input.status, name: input.name });
      return json({ ok: true });
    }
    const { guardrails } = await loadSettings(env.DB);
    const amount = Number(input?.amount);
    if (!Number.isFinite(amount) || amount < guardrails.min_daily_budget || amount > guardrails.max_daily_budget) {
      throw new BadRequest(`งบต่อวันต้องอยู่ระหว่าง ${guardrails.min_daily_budget}–${guardrails.max_daily_budget} บาท (ปรับได้ที่หน้าตั้งค่า)`);
    }
    await meta.setDailyBudget(id, Math.round(amount));
    await patchCachedEntity(env.DB, id, { daily_budget: Math.round(amount) });
    await audit(env.DB, user, 'meta.budget', id, { from: input.from ?? null, to: Math.round(amount), name: input.name });
    return json({ ok: true });
  }

  // ---- bulk (several campaigns at once) ----
  if (method === 'POST' && path === '/api/bulk/stage') {
    const input = await body();
    const items = bulkItems(input?.items);
    const [stages, all] = await Promise.all([loadStages(env.DB), loadCampaignSettings(env.DB)]);
    const next = items.map(({ id }) => {
      const prev = all.get(id);
      // Keep product pin and rule mode; only the stage changes.
      return validateCampaignSetting(id, { ...prev, stage_id: input?.stage_id ?? null }, stages.map((s) => s.id), prev);
    });
    await saveCampaignSettings(env.DB, next);
    const changed = items.filter(({ id }) => (all.get(id)?.stage_id ?? null) !== (input?.stage_id ?? null));
    await auditMany(env.DB, user, 'campaign.stage', changed.map(({ id, name }) => ({ target: id, detail: { name, from: all.get(id)?.stage_id ?? null, to: input?.stage_id ?? null } })));
    return json({ ok: true, changed: changed.length });
  }
  if (method === 'POST' && path === '/api/bulk/budget') {
    // One Meta call per campaign, in order; stops at the first Meta error so a problem isn't repeated 25 times.
    const input = await body();
    const items = bulkItems(input?.items);
    const pct = Number(input?.pct);
    if (!Number.isFinite(pct) || pct === 0 || Math.abs(pct) > 100) throw new BadRequest('เปอร์เซ็นต์ต้องอยู่ระหว่าง −100 ถึง 100 และไม่เป็น 0');
    const [{ meta, data }, { guardrails }] = await Promise.all([metaData(env), loadSettings(env.DB)]);
    const byId = new Map(data.entities.map((e) => [e.id, e]));
    const results: { id: string; name: string; from: number | null; to?: number; ok: boolean; message?: string }[] = [];
    let stopped = false;
    for (const { id, name } of items) {
      const e = byId.get(id);
      const from = e?.daily_budget ?? null;
      if (stopped) { results.push({ id, name, from, ok: false, message: 'ไม่ได้ทำ (หยุดหลังข้อผิดพลาดก่อนหน้า)' }); continue; }
      if (from === null) { results.push({ id, name, from, ok: false, message: 'งบอยู่ที่ชุดโฆษณา (ABO) — ปรับในหน้ารายละเอียด' }); continue; }
      const to = Math.round(Math.min(guardrails.max_daily_budget, Math.max(guardrails.min_daily_budget, from * (1 + pct / 100))));
      if (to === from) { results.push({ id, name, from, to, ok: false, message: 'ติดขอบเขตงบต่ำสุด/สูงสุด' }); continue; }
      try {
        await meta.setDailyBudget(id, to);
        await patchCachedEntity(env.DB, id, { daily_budget: to });
        results.push({ id, name, from, to, ok: true });
      } catch (err: any) {
        stopped = true;
        results.push({ id, name, from, to, ok: false, message: friendlyMetaError(err) });
      }
    }
    await auditMany(env.DB, user, 'meta.budget', results.filter((r) => r.ok).map((r) => ({ target: r.id, detail: { name: r.name, from: r.from, to: r.to, bulk_pct: pct } })));
    return json({ results });
  }

  // ---- read-only helpers for the dashboard ----
  if (method === 'GET' && path === '/api/ideas') return json(await ideas(env));
  if (method === 'GET' && path === '/api/preview') return json(await preview(env));
  if (method === 'GET' && (m = path.match(/^\/api\/campaigns\/(\d+)\/daily$/))) {
    const w = url.searchParams.get('window') as Window;
    const { data } = await metaData(env);
    if (!data.entities.some((e) => e.level === 'campaign' && e.id === m![1])) return json({ error: 'ไม่พบแคมเปญ' }, 404);
    const days = await data.daily(m[1], (['last_7d', 'last_14d', 'last_30d'] as Window[]).includes(w) ? w : 'last_14d').catch((err) => {
      throw new BadRequest(err instanceof MetaCacheError ? err.message : friendlyMetaError(err));
    });
    return json({ days });
  }
  if (method === 'GET' && (m = path.match(/^\/api\/campaigns\/(\d+)\/history$/))) {
    const adsets = await metaData(env).then(({ data }) => data.entities.filter((e) => e.level === 'adset' && e.campaign_id === m![1]).map((e) => e.id)).catch(() => []);
    return json(await campaignHistory(env.DB, m[1], adsets));
  }

  // ---- costs ----
  if (method === 'GET' && path === '/api/costs') {
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const costs = await loadCosts(env.DB);
    const suggest = url.searchParams.get('suggest');
    const hits = suggest
      ? suggestProducts(suggest, costs, 12)
      : costs.filter((c) => !q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)).slice(0, 40);
    return json({ total: costs.length, results: hits });
  }
  if (method === 'POST' && path === '/api/costs/sync') {
    // One tab per request from the dashboard: Google is slow on this workbook, and short requests show progress.
    const settings = await loadSettings(env.DB);
    if (!settings.sheet_id) throw new BadRequest('ใส่ Google Sheet ID ในหน้าตั้งค่าก่อน');
    const tab = url.searchParams.get('tab');
    if (tab && !settings.sheet_tabs.includes(tab)) throw new BadRequest(`แท็บ ${tab} ไม่อยู่ในรายการที่ตั้งไว้`);
    const result = await syncCosts(env.DB, settings, tab ? [tab] : settings.sheet_tabs);
    await audit(env.DB, user, 'costs.sync', tab ?? 'all', result);
    return json(result);
  }

  // ---- automation ----
  if (method === 'POST' && path === '/api/run') {
    const input = await body();
    const report = await runAutomation(env, metaFor(env), { trigger: `manual:${user}`, dryRun: input?.dry_run !== false });
    return json(report);
  }
  if (method === 'GET' && path === '/api/runs') return json(await listRuns(env.DB));
  if (method === 'GET' && path === '/api/audit') return json(await listAudit(env.DB));

  if (path === '/api/settings') {
    const current = await loadSettings(env.DB);
    if (method === 'GET') return json(current);
    if (method === 'PUT') {
      const next = validateSettings(await body(), current);
      await saveSettings(env.DB, next);
      await audit(env.DB, user, 'settings.update', 'settings', { before: current, after: next });
      return json(next);
    }
  }

  return json({ error: 'ไม่พบ endpoint' }, 404);
}

// ---- Meta data for the dashboard ----

async function metaData(env: Env, fresh = false): Promise<{ meta: MetaLike; data: MetaData }> {
  const meta = metaFor(env);
  try {
    return { meta, data: await loadMetaData(env.DB, meta, fresh) };
  } catch (err) {
    throw new BadRequest(err instanceof MetaCacheError ? err.message : friendlyMetaError(err));
  }
}

/** Fresh copies of the cached entities with metrics for the given windows attached. */
async function withMetrics(data: MetaData, calls: (readonly [Level, Window])[]): Promise<Entity[]> {
  const entities: Entity[] = data.entities.map((e) => ({ ...e, metrics: {} }));
  const results = await Promise.all(calls.map(([level, w]) => data.insights(level, w).catch((err) => {
    throw new BadRequest(err instanceof MetaCacheError ? err.message : friendlyMetaError(err));
  })));
  calls.forEach(([level, w], i) => {
    // A campaign with no row simply had no delivery (zero); an ad set without a row shows "–".
    for (const e of entities) if (e.level === level) e.metrics[w] = results[i].get(e.id) ?? (level === 'campaign' ? zeroMetrics() : undefined);
  });
  return entities;
}

async function overview(env: Env, window: Window, fresh: boolean) {
  const [{ meta, data }, sections, stages, campaignSettings, costs, settings, runs] = await Promise.all([
    metaData(env, fresh), loadSections(env.DB), loadStages(env.DB), loadCampaignSettings(env.DB), loadCosts(env.DB), loadSettings(env.DB), listRuns(env.DB, 1),
  ]);
  const windows = [...new Set<Window>([window, ECONOMICS_WINDOW])];
  const entities = await withMetrics(data, [...windows.map((w) => ['campaign', w] as const), ['adset', window] as const]);
  const snapshot = meta instanceof MockMeta ? await meta.snapshotInfo() : null;
  const sectionOf = sectionMap(entities, sections, campaignSettings);
  const totals = sectionTotals(entities, sectionOf, window);
  // Break-even the same way the engine computes it (7-day), profit over the window being viewed.
  const totals7 = sectionTotals(entities, sectionOf, ECONOMICS_WINDOW);
  const zero = { spend: 0, purchases: 0, purchase_value: 0, impressions: 0, clicks: 0 };
  const econ = new Map<string, { be: Economics; window: Economics }>(sections.map((s) => [s.id, {
    be: economics(s, costs, totals7.get(s.id) ?? zero),
    window: economics(s, costs, totals.get(s.id) ?? zero),
  }]));
  const adsetsOf = (id: string) => entities.filter((e) => e.level === 'adset' && e.campaign_id === id);
  const view = (e: Entity) => ({ id: e.id, name: e.name, status: e.status, daily_budget: e.daily_budget, metrics: finite(e.metrics[window]) });
  const beOf = (e: Economics) => (e.breakeven_roas !== null && Number.isFinite(e.breakeven_roas) ? e.breakeven_roas : null);

  // Meta returns every campaign ever made (hundreds of long-paused ones). Show those that matter now:
  // running, spent in the viewed or 7-day window, or placed in a stage by the user.
  const relevant = (c: Entity) =>
    c.status === 'ACTIVE' || windows.some((w) => (c.metrics[w]?.spend ?? 0) > 0) || Boolean(campaignSettings.get(c.id)?.stage_id);
  const campaigns = entities.filter((e) => e.level === 'campaign' && relevant(e)).map((c) => {
    const setting = campaignSettings.get(c.id);
    const sectionId = sectionOf.get(c.id) ?? DEFAULT_SECTION_ID;
    const e = econ.get(sectionId);
    const m = c.metrics[window];
    const perOrder = e?.be.cogs_per_order == null ? null : e.be.cogs_per_order + (sections.find((s) => s.id === sectionId)?.extra_cost_per_order ?? 0);
    return {
      ...view(c),
      section_id: sectionId,
      pinned: Boolean(setting?.section_id),
      stage_id: setting?.stage_id ?? null,
      stage_since: setting?.stage_since ?? null,
      mode: setting?.mode ?? 'stage',
      rules: setting?.rules ?? null,
      breakeven_roas: e ? beOf(e.be) : null,
      profit: m && perOrder !== null ? m.purchase_value - m.purchases * perOrder - m.spend : null,
      adsets: adsetsOf(c.id).map(view),
    };
  });

  return {
    account: data.account,
    window,
    /** Set when showing a Claude-pulled snapshot: read-only, limited windows. */
    snapshot,
    meta_fetched_at: data.fetchedAt(),
    meta_warning: data.warning(),
    settings: { dry_run: settings.dry_run, kill_switch: settings.kill_switch, guardrails: settings.guardrails },
    costs_loaded: costs.length,
    last_run: runs[0] ? { run_at: runs[0].run_at, summary: runs[0].summary, dry_run: runs[0].dry_run } : null,
    stages,
    sections: sections.map((s) => {
      const e = econ.get(s.id)!;
      return {
        ...s,
        totals: totals.get(s.id) ?? zero,
        economics: { ...e.window, breakeven_roas: beOf(e.be), never_profitable: e.be.breakeven_roas === Infinity },
        campaign_count: campaigns.filter((c) => c.section_id === s.id).length,
      };
    }),
    campaigns,
  };
}

const MAX_BULK = 25;

function bulkItems(input: unknown): { id: string; name: string }[] {
  if (!Array.isArray(input) || input.length === 0) throw new BadRequest('ยังไม่ได้เลือกแคมเปญ');
  if (input.length > MAX_BULK) throw new BadRequest(`เลือกได้ครั้งละไม่เกิน ${MAX_BULK} แคมเปญ`);
  return input.map((x: any) => {
    const id = String(x?.id ?? '');
    if (!/^\d+$/.test(id)) throw new BadRequest('รหัสแคมเปญไม่ถูกต้อง');
    return { id, name: String(x?.name ?? '').slice(0, 200) };
  });
}

/** Product break-even per campaign, from 7-day numbers (same as the engine). */
function breakevens(entities: Entity[], sections: Section[], settings: Map<string, CampaignSetting>, costs: CostRow[]): Map<string, number | null> {
  const sectionOf = sectionMap(entities, sections, settings);
  const totals = sectionTotals(entities, sectionOf, ECONOMICS_WINDOW);
  const zero = { spend: 0, purchases: 0, purchase_value: 0 };
  const be = new Map(sections.map((s) => {
    const r = economics(s, costs, totals.get(s.id) ?? zero).breakeven_roas;
    return [s.id, r !== null && Number.isFinite(r) ? r : null];
  }));
  return new Map([...sectionOf].map(([cid, sid]) => [cid, be.get(sid) ?? null]));
}

async function ideas(env: Env) {
  const [{ data }, sections, campaignSettings, costs] = await Promise.all([
    metaData(env), loadSections(env.DB), loadCampaignSettings(env.DB), loadCosts(env.DB),
  ]);
  const entities = await withMetrics(data, [['campaign', 'last_7d'], ['campaign', 'last_30d']]);
  const be = breakevens(entities, sections, campaignSettings, costs);
  const list = buildIdeas(entities.filter((e) => e.level === 'campaign').map((c) => ({
    campaign: c,
    m7: c.metrics.last_7d,
    m30: c.metrics.last_30d,
    stage_id: campaignSettings.get(c.id)?.stage_id ?? null,
    breakeven: be.get(c.id) ?? null,
  })));
  return { ideas: list, costs_loaded: costs.length > 0, meta_fetched_at: data.fetchedAt(), meta_warning: data.warning() };
}

/** What the next scheduled run would do, computed from cached data. Changes nothing on Meta or in D1. */
async function preview(env: Env) {
  const [{ data }, settings, state] = await Promise.all([metaData(env), loadSettings(env.DB), loadState(env.DB)]);
  const entities: Entity[] = data.entities.map((e) => ({ ...e, metrics: {} }));
  const now = new Date();
  const { plan } = await planRun(env.DB, entities, (level, w) => data.insights(level, w), state, now);
  capChanges(plan);
  const noop = { setStatus: async () => {}, setDailyBudget: async () => {} };
  await applyDecisions(plan.decisions, entities, noop, settings.guardrails, { last_action: { ...state.last_action } }, { dryRun: true, now });
  const campaignOf = new Map(entities.map((e) => [e.id, e.campaign_id]));
  const pick = (d: { entity: { id: string; level: string; name: string }; plan: string; skipped_reason?: string; action: { type: string } }) => ({
    campaign_id: campaignOf.get(d.entity.id) ?? d.entity.id, entity_id: d.entity.id, level: d.entity.level, name: d.entity.name,
    action: d.action.type, plan: d.plan, skipped_reason: d.skipped_reason ?? null,
  });
  return {
    dry_run: settings.dry_run,
    kill_switch: settings.kill_switch,
    items: [...plan.decisions.map((d) => ({ ...pick(d), after: (d as any).after ?? null })), ...plan.moves.map((m) => ({ ...pick(m), action: 'move', move_to: m.move_to, after: null }))],
    notes: plan.notes,
  };
}

/** JSON has no Infinity; the UI shows null as "–". */
function finite<T extends object | undefined>(m: T): T {
  if (!m) return m;
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'number' && !Number.isFinite(v) ? null : v])) as T;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
