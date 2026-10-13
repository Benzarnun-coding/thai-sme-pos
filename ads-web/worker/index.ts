// Worker entry: JSON API for the dashboard + cron triggers. Static files in dist/ are served by Cloudflare before this runs.

import { MetaClient } from '../../ads-engine/src/meta.ts';
import { applyDecisions } from '../../ads-engine/src/apply.ts';
import type { Entity, Level, Window } from '../../ads-engine/src/types.ts';
import { authenticate } from './auth.ts';
import { canWrite, roleOf, type Role } from './roles.ts';
import { deleteUser, loadUsers, normaliseEmail, ownerEmails, parseRole, roleMap, saveUser } from './users.ts';
import { accessStatus, syncAccess } from './access.ts';
import { syncCampaignCosts, syncCosts } from './costs.ts';
import { CampaignCostIndex, tierEconomics, type CostTier } from './campaignCosts.ts';
import {
  audit, codOf, deleteSection, loadCampaignCosts, deleteWebCost, saveWebCost, insertRun, listAudit, listRuns, loadCampaignSettings, loadCosts, loadSections, loadSettings,
  loadStages, loadState, saveCampaignSetting, saveCampaignSettings, auditMany, campaignHistory, saveSection, saveSettings, saveStage,
} from './db.ts';
import { ECONOMICS_WINDOW, sectionMap, sectionTotals } from './engine.ts';
import { MockMeta } from './mock.ts';
import { DEFAULT_SECTION_ID, WEB_TAB, campaignEconomics, economics, profitRange, suggestProducts, type CampaignSetting, type Cod, type CostRow, type Economics, type Section } from './model.ts';
import { capChanges, planRun, runAutomation, zeroMetrics, type MetaLike } from './run.ts';
import { buildIdeas } from './ideas.ts';
import { explainActual, explainDay, explainOrders } from './salesReport.ts';
import { campaignDay } from './transactions.ts';
import { makeTierResolver } from './costing.ts';
import { bkkDate, loadConversionHours, saveConversionDay, syncConversionHours, txCosting, windowDates } from './conversionStore.ts';
import { addCompetitorCheck, deleteCompetitor, deleteCompetitorAd, listCompetitors, saveCompetitor, saveCompetitorAd } from './competitors.ts';
import { friendlyMetaError, insertBudgetChanges, loadMetaData, MetaCacheError, patchCachedEntity, recentBudgetChanges, type MetaData } from './metadata.ts';
import { PRIVACY_HTML } from './privacy.ts';
import { pushDiscord } from '../../ads-engine/src/notify.ts';
import { actualByCampaign, loadOrders, loadUploads, normaliseOrders, orderFees, recreditDates, saveOrders, type UploadedOrder } from './p365.ts';
import { receiveWebhook, referralSummary, setupWebhook, verifyChallenge, webhookStatus } from './webhook.ts';
import { BadRequest, validateWebCost, validateCampaignSetting, validateSection, validateSettings, validateStage } from './validate.ts';

export interface Env {
  DB: D1Database;
  META_ACCESS_TOKEN?: string;
  META_AD_ACCOUNT_ID: string;
  META_API_VERSION?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_TO?: string;
  DISCORD_WEBHOOK_URL?: string;
  /** Messenger webhook (see worker/webhook.ts): app id is a var, the other two are secrets */
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;
  /** Owners (comma separated) — always allowed to manage users */
  OWNER_EMAILS?: string;
  /** Cloudflare Access sync (see worker/access.ts): token is a secret, the other two are vars */
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  CF_ACCESS_POLICY_ID?: string;
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
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    // Meta's webhook comes from outside Cloudflare Access (bypassed for /webhook/* there); it is signed instead.
    if (url.pathname === '/webhook/privacy') return new Response(PRIVACY_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (url.pathname === '/webhook/meta') {
      if (req.method === 'GET') return verifyChallenge(url, env);
      if (req.method === 'POST') return receiveWebhook(req, env, ctx);
      return new Response('method not allowed', { status: 405 });
    }
    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });

    const user = await authenticate(req, env).catch(() => null);
    if (!user) return json({ error: 'ต้องล็อกอินผ่าน Cloudflare Access' }, 401);
    // Access cookies ride along on cross-site requests; only accept writes that come from this site.
    if (req.method !== 'GET') {
      const origin = req.headers.get('Origin');
      if (origin && origin !== url.origin) return json({ error: 'cross-origin request refused' }, 403);
    }
    // What this person may change: owners from the var, then the users table, then the old cost-editor list.
    const [users, settings] = await Promise.all([roleMap(env.DB).catch(() => new Map()), loadSettings(env.DB).catch(() => ({ cost_editors: [] as string[] }))]);
    const role = roleOf(user, ownerEmails(env), users, settings.cost_editors);
    if (!canWrite(role, req.method, url.pathname)) {
      return json({ error: role === 'viewer' ? 'บัญชีนี้ดูได้อย่างเดียว — ให้เจ้าของเพิ่มสิทธิ์ในหน้า ผู้ใช้' : role === 'costs' ? 'บัญชีนี้แก้ได้เฉพาะต้นทุน — ให้เจ้าของเพิ่มสิทธิ์ในหน้า ผู้ใช้' : 'เฉพาะเจ้าของเท่านั้นที่จัดการผู้ใช้ได้' }, 403);
    }

    try {
      return await route(req, env, url, user, role, ctx);
    } catch (err: any) {
      if (err instanceof BadRequest) return json({ error: err.message }, 400);
      console.error(err);
      return json({ error: err?.message ?? String(err) }, 500);
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === COSTS_CRON) {
      ctx.waitUntil(loadSettings(env.DB).then((s) => Promise.all([
        s.sheet_id ? syncCosts(env.DB, s) : [],
        s.ads_cost_sheet_id ? syncCampaignCosts(env.DB, s) : null,
        // Hourly purchases: refresh the last 3 days (late tags) and fill a few missing older days.
        Promise.resolve().then(() => syncConversionHours(env.DB, metaFor(env))).catch(() => null),
      ]).then(() => recreditDates(env.DB, [bkkDate(1), bkkDate(2), bkkDate(3)]).catch(() => null))
        .then(() => dailyDigest(env).catch((err) => console.error('digest', err)))));
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

async function route(req: Request, env: Env, url: URL, user: string, role: Role, ctx: ExecutionContext): Promise<Response> {
  const path = url.pathname.replace(/\/$/, '');
  const method = req.method;
  const body = async () => (await req.json().catch(() => { throw new BadRequest('ข้อมูลไม่ใช่ JSON'); })) as any;
  let m: RegExpMatchArray | null;

  if (method === 'GET' && path === '/api/me') return json({ email: user, role, mock: env.DEV_MOCK_META === 'true' });

  // ---- users (owners only for writes; roles.ts enforces it) ----
  if (path === '/api/users' && method === 'GET') {
    const [users, settings] = await Promise.all([loadUsers(env.DB), loadSettings(env.DB)]);
    const owners = ownerEmails(env);
    const everyone = [...new Set([...owners, ...users.map((u) => u.email)])];
    const access = role === 'owner' ? await accessStatus(env, everyone) : null;
    return json({ users, owners, legacy_cost_editors: settings.cost_editors.filter((e) => !users.some((u) => u.email === e)), access, me: user });
  }
  if (path === '/api/users' && method === 'POST') {
    const input = await body();
    let email: string, r: Role;
    try { email = normaliseEmail(input?.email); r = parseRole(input?.role); } catch (e: any) { throw new BadRequest(e.message); }
    if (ownerEmails(env).includes(email)) throw new BadRequest('อีเมลนี้เป็นเจ้าของอยู่แล้ว (ตั้งไว้ใน OWNER_EMAILS)');
    await saveUser(env.DB, { email, role: r, note: String(input?.note ?? '') }, user);
    await audit(env.DB, user, 'user.save', email, { role: r });
    const sync = await syncIfConfigured(env, user);
    return json({ ok: true, sync });
  }
  if ((m = path.match(/^\/api\/users\/([^/]+)$/)) && (method === 'PUT' || method === 'DELETE')) {
    let email: string;
    try { email = normaliseEmail(decodeURIComponent(m[1])); } catch (e: any) { throw new BadRequest(e.message); }
    if (ownerEmails(env).includes(email)) throw new BadRequest('เจ้าของที่ตั้งไว้ใน OWNER_EMAILS แก้จากหน้านี้ไม่ได้');
    if (method === 'DELETE') {
      if (email === user) throw new BadRequest('ลบบัญชีตัวเองไม่ได้');
      if (!(await deleteUser(env.DB, email))) return json({ error: 'ไม่พบผู้ใช้' }, 404);
      await audit(env.DB, user, 'user.delete', email, {});
    } else {
      const input = await body();
      let r: Role;
      try { r = parseRole(input?.role); } catch (e: any) { throw new BadRequest(e.message); }
      if (email === user && r !== 'owner') throw new BadRequest('ลดสิทธิ์ตัวเองไม่ได้');
      const existing = (await loadUsers(env.DB)).find((u) => u.email === email);
      await saveUser(env.DB, { email, role: r, note: String(input?.note ?? existing?.note ?? '') }, user);
      await audit(env.DB, user, 'user.save', email, { role: r });
    }
    const sync = await syncIfConfigured(env, user);
    return json({ ok: true, sync });
  }
  if (path === '/api/users/access-sync' && method === 'POST') {
    const users = await loadUsers(env.DB);
    const r = await syncAccess(env, [...ownerEmails(env), ...users.map((u) => u.email)]).catch((e) => { throw new BadRequest(e.message); });
    await audit(env.DB, user, 'users.access-sync', 'cloudflare', r);
    return json(r);
  }

  if (method === 'GET' && path === '/api/overview') {
    const w = url.searchParams.get('window') as Window;
    return json(await overview(env, parseView(w), url.searchParams.get('fresh') === '1'));
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
    await insertBudgetChanges(env.DB, [{ entity_id: id, name: String(input.name ?? ''), from: input.from ?? null, to: Math.round(amount) }], 'dashboard');
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
        await insertBudgetChanges(env.DB, [{ entity_id: id, name, from, to }], 'dashboard');
        results.push({ id, name, from, to, ok: true });
      } catch (err: any) {
        stopped = true;
        results.push({ id, name, from, to, ok: false, message: friendlyMetaError(err) });
      }
    }
    await auditMany(env.DB, user, 'meta.budget', results.filter((r) => r.ok).map((r) => ({ target: r.id, detail: { name: r.name, from: r.from, to: r.to, bulk_pct: pct } })));
    return json({ results });
  }

  // ---- real daily totals from the order system (typed in) ----
  if (path === '/api/actual-sales' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM actual_sales ORDER BY date DESC LIMIT 120').all();
    return json(results);
  }
  if ((m = path.match(/^\/api\/actual-sales\/(\d{4}-\d{2}-\d{2})$/)) && method === 'PUT') {
    const date = m[1];
    if (Number.isNaN(Date.parse(date))) throw new BadRequest('วันที่ไม่ถูกต้อง');
    const input = await body();
    const n = (v: unknown, what: string, int: boolean) => {
      if (v === null || v === undefined || v === '') return null;
      const x = Number(v);
      if (!Number.isFinite(x) || x < 0 || (int && !Number.isInteger(x))) throw new BadRequest(`${what}ไม่ถูกต้อง`);
      return x;
    };
    const row = { orders: n(input?.orders, 'จำนวนออเดอร์', true), pieces: n(input?.pieces, 'จำนวนชิ้น', true), revenue: n(input?.revenue, 'ยอดเงิน', false) };
    if (row.orders === null && row.pieces === null && row.revenue === null) {
      await env.DB.prepare('DELETE FROM actual_sales WHERE date = ?').bind(date).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO actual_sales (date, orders, pieces, revenue, note, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET orders = excluded.orders, pieces = excluded.pieces, revenue = excluded.revenue,
           note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      ).bind(date, row.orders, row.pieces, row.revenue, String(input?.note ?? '').slice(0, 300), user, new Date().toISOString()).run();
    }
    await audit(env.DB, user, 'actual-sales.save', date, row);
    return json({ ok: true });
  }

  // ---- stored hourly purchases (order-by-order costing) ----
  if (path === '/api/conversion-hours' && method === 'GET') {
    const dates = Array.from({ length: 30 }, (_, i) => bkkDate(i + 1));
    const { results } = await env.DB.prepare('SELECT date FROM conversion_days WHERE date IN (SELECT value FROM json_each(?))').bind(JSON.stringify(dates)).all<{ date: string }>();
    return json({ stored: results.length, of: dates.length, dates: results.map((r) => r.date).sort() });
  }
  if (path === '/api/conversion-hours/sync' && method === 'POST') {
    const r = await syncConversionHours(env.DB, metaFor(env), { recent: 1, backfill: 6 });
    await audit(env.DB, user, 'conversion-hours.sync', 'meta', r);
    if (r.errors.length && !r.fetched.length) throw new BadRequest(friendlyMetaError({ message: r.errors[0] }));
    return json(r);
  }

  // ---- Page365 orders (daily export uploaded from the dashboard) ----
  if (path === '/api/p365/upload' && method === 'POST') {
    const input = await body();
    const list: UploadedOrder[] = Array.isArray(input?.orders) ? input.orders : [];
    if (!list.length) throw new BadRequest('ไม่พบออเดอร์ในไฟล์');
    if (list.length > 5000) throw new BadRequest('ไฟล์ใหญ่เกินไป (เกิน 5,000 ออเดอร์)');
    const { orders, errors, skipped } = await normaliseOrders(list, env.META_WEBHOOK_VERIFY_TOKEN ?? '');
    if (!orders.length) throw new BadRequest(errors[0] ?? 'อ่านออเดอร์ไม่ได้');
    await saveOrders(env.DB, orders, user);
    const dates = [...new Set(orders.map((o) => o.date))].sort();
    const credits = await recreditDates(env.DB, dates);
    // The day's real totals, so the actual-vs-Meta comparison fills itself in.
    const now = new Date().toISOString();
    await env.DB.batch(dates.map((d) => {
      const os = orders.filter((o) => o.date === d);
      return env.DB.prepare(`INSERT INTO actual_sales (date, orders, pieces, revenue, note, updated_by, updated_at) VALUES (?, ?, ?, ?, 'จากไฟล์ Page365', ?, ?)
        ON CONFLICT(date) DO UPDATE SET orders = excluded.orders, pieces = excluded.pieces, revenue = excluded.revenue, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .bind(d, os.length, os.reduce((n, o) => n + o.units, 0), os.reduce((n, o) => n + o.total, 0), user, now);
    }));
    await audit(env.DB, user, 'p365.upload', dates.join(','), { orders: orders.length, errors: errors.length, skipped, credits });
    ctx.waitUntil(Promise.all(dates.map((d) => salesDigest(env, d).catch((err) => console.error('digest', err)))));
    return json({ dates, orders: orders.length, errors, skipped, credits });
  }
  if (path === '/api/p365' && method === 'GET') {
    const w = url.searchParams.get('window') as Window;
    const dates = [...windowDates((['last_7d', 'last_14d', 'last_30d'] as Window[]).includes(w) ? w : 'last_14d'), bkkDate(0)];
    const [uploads, orders] = await Promise.all([loadUploads(env.DB, dates), loadOrders(env.DB, dates)]);
    return json({ uploads: [...uploads.entries()].map(([date, u]) => {
      const os = orders.filter((o) => o.date === date);
      const c = { customer: 0, exact: 0, approx: 0, none: 0 };
      for (const o of os) c[o.match]++;
      return { date, ...u, credits: c, revenue: os.reduce((n, o) => n + o.total, 0), units: os.reduce((n, o) => n + o.units, 0) };
    }).sort((a, b) => b.date.localeCompare(a.date)) });
  }
  if (path === '/api/p365/orders' && method === 'GET') {
    const date = url.searchParams.get('date') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequest('วันที่ไม่ถูกต้อง');
    const [orders, settings] = await Promise.all([loadOrders(env.DB, [date]), loadSettings(env.DB)]);
    return json({ date, fees: settings.order_fees, orders: orders.map(({ name_hash: _h, ...o }) => ({ ...o, fees: orderFees(o, settings.order_fees) })) });
  }
  if (path === '/api/p365/recredit' && method === 'POST') {
    const input = await body();
    const date = String(input?.date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequest('วันที่ไม่ถูกต้อง');
    const credits = await recreditDates(env.DB, [date]);
    await audit(env.DB, user, 'p365.recredit', date, credits);
    return json({ date, credits: credits[date] ?? null });
  }

  // ---- Messenger webhook: who came from which ad ----
  if (path === '/api/webhook' && method === 'GET') return json(await webhookStatus(env, `${url.origin}/webhook/meta`));
  if (path === '/api/webhook/setup' && method === 'POST') {
    const r = await setupWebhook(env, `${url.origin}/webhook/meta`).catch((err) => { throw new BadRequest(err.message); });
    await audit(env.DB, user, 'webhook.setup', 'meta', r);
    return json(r);
  }
  if (path === '/api/ad-referrals' && method === 'GET') {
    const w = url.searchParams.get('window') as Window;
    const date = url.searchParams.get('date');
    const dates = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? [date] : [...windowDates((['last_7d', 'last_14d', 'last_30d'] as Window[]).includes(w) ? w : 'last_7d'), bkkDate(0)];
    return json({ dates, rows: await referralSummary(env.DB, dates) });
  }

  // ---- per-campaign costs from the team's sheet ----
  if (path === '/api/campaign-costs' && method === 'GET') {
    const { costs: cc, synced_at } = await loadCampaignCosts(env.DB);
    return json({ synced_at, campaigns: [...cc.values()] });
  }
  if (path === '/api/campaign-costs/sync' && method === 'POST') {
    const result = await syncCampaignCosts(env.DB, await loadSettings(env.DB));
    await audit(env.DB, user, 'campaign-costs.sync', 'sheet', result);
    if (result.error && !result.campaigns) throw new BadRequest(result.error);
    return json(result);
  }

  // ---- competitor watch (typed in by the team) ----
  if (path === '/api/competitors' && method === 'GET') return json(await listCompetitors(env.DB));
  if (path === '/api/competitors' && method === 'POST') {
    const c = await saveCompetitor(env.DB, await body());
    await audit(env.DB, user, 'competitor.save', c.id, { name: c.name });
    return json(c);
  }
  if (path === '/api/competitors/ads' && method === 'POST') {
    const a = await saveCompetitorAd(env.DB, await body());
    await audit(env.DB, user, 'competitor.ad', a.id, { name: a.promo || a.hook.slice(0, 60) });
    return json(a);
  }
  if ((m = path.match(/^\/api\/competitors\/ads\/([\w-]+)$/)) && method === 'DELETE') {
    await deleteCompetitorAd(env.DB, m[1]);
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/competitors\/([\w-]+)\/checks$/)) && method === 'POST') {
    await addCompetitorCheck(env.DB, m[1], await body());
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/competitors\/([\w-]+)$/)) && method === 'DELETE') {
    await deleteCompetitor(env.DB, m[1]);
    await audit(env.DB, user, 'competitor.delete', m[1], {});
    return json({ ok: true });
  }

  // ---- read-only helpers for the dashboard ----
  if (method === 'GET' && path === '/api/ideas') return json(await ideas(env));
  if (method === 'GET' && path === '/api/conversions') {
    const date = url.searchParams.get('date') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new BadRequest('วันที่ไม่ถูกต้อง');
    const w = url.searchParams.get('window') as Window;
    return json(await conversions(env, date, (['last_7d', 'last_14d', 'last_30d'] as Window[]).includes(w) ? w : 'last_14d'));
  }
  if (method === 'GET' && path === '/api/sales-report') {
    const w = url.searchParams.get('window') as Window;
    return json(await salesReport(env, (['last_7d', 'last_14d', 'last_30d'] as Window[]).includes(w) ? w : 'last_14d'));
  }
  if (method === 'GET' && (m = path.match(/^\/api\/campaigns\/(\d+)\/stats$/))) return json(await campaignStats(env, m[1]));
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
  // Costs typed into the dashboard (tab WEB). The code goes in the body/query: codes like "801/1" contain slashes.
  if (method === 'POST' && path === '/api/costs') {
    const c = validateWebCost(await body());
    const before = (await loadCosts(env.DB)).find((x) => x.tab === WEB_TAB && x.code === c.code) ?? null;
    await saveWebCost(env.DB, c);
    await audit(env.DB, user, before ? 'cost.update' : 'cost.create', `${WEB_TAB}:${c.code}`, { name: c.name, before, after: c });
    return json({ ok: true });
  }
  if (method === 'DELETE' && path === '/api/costs') {
    const code = url.searchParams.get('code') ?? '';
    if (!(await deleteWebCost(env.DB, code))) return json({ error: 'ไม่พบต้นทุนนี้' }, 404);
    await audit(env.DB, user, 'cost.delete', `${WEB_TAB}:${code}`, { name: code });
    return json({ ok: true });
  }
  if (method === 'GET' && path === '/api/costs') {
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const costs = await loadCosts(env.DB);
    const tab = url.searchParams.get('tab');
    if (tab) return json({ total: costs.length, results: costs.filter((c) => c.tab === tab).sort((a, b) => a.code.localeCompare(b.code)) });
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
  const ccRaw = (await loadCampaignCosts(env.DB)).costs;
  const campaignCosts = new CampaignCostIndex(ccRaw);
  const windows = [...new Set<Window>([window, ECONOMICS_WINDOW])];
  const entities = await withMetrics(data, [...windows.map((w) => ['campaign', w] as const), ['adset', window] as const]);
  // Order-by-order costing from stored hourly purchases (today's come live).
  const tx = await txContext(env, data, window);
  const tiersOf = makeTierResolver({ entities, sections, campaignSettings, costs, cod: codOf(settings), campaignCosts: ccRaw });
  const snapshot = meta instanceof MockMeta ? await meta.snapshotInfo() : null;
  const sectionOf = sectionMap(entities, sections, campaignSettings);
  const totals = sectionTotals(entities, sectionOf, window);
  // Break-even the same way the engine computes it (7-day), profit over the window being viewed.
  const totals7 = sectionTotals(entities, sectionOf, ECONOMICS_WINDOW);
  const zero = { spend: 0, purchases: 0, purchase_value: 0, impressions: 0, clicks: 0 };
  const econ = new Map<string, { be: Economics; window: Economics }>(sections.map((s) => [s.id, {
    be: economics(s, costs, totals7.get(s.id) ?? zero, codOf(settings)),
    window: economics(s, costs, totals.get(s.id) ?? zero, codOf(settings)),
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
    const section = sections.find((s) => s.id === sectionId);
    // Priced with the promos in this campaign's own name (falls back to the product's prices).
    const ce = section ? campaignEconomics(section, costs, totals7.get(sectionId) ?? zero, codOf(settings), c.name) : null;
    const m = c.metrics[window];
    const range = ce && m ? profitRange(ce, section!.extra_cost_per_order, m, codOf(settings)) : null;
    // A campaign listed in the team's cost sheet uses its promo costs instead.
    const found = campaignCosts.find(c.name);
    const sheet = found?.cost;
    const te = sheet ? tierEconomics(sheet.tiers, m) : null;
    const t = m && m.purchase_value > 0 ? txCosting(tx.hours.get(c.id), tiersOf(c.id, c.name).tiers, codOf(settings).fee, tx.days) : null;
    const txProfit = t && m ? m.purchase_value * (1 - t.cost_ratio) - m.spend : null;
    return {
      ...view(c),
      section_id: sectionId,
      pinned: Boolean(setting?.section_id),
      stage_id: setting?.stage_id ?? null,
      stage_since: setting?.stage_since ?? null,
      mode: setting?.mode ?? 'stage',
      rules: setting?.rules ?? null,
      breakeven_roas: te ? finiteOrNull(te.breakeven_roas) : ce ? beOf(ce) : null,
      /** Where the cost comes from: the per-campaign sheet, the product line, or nowhere */
      cost_source: te ? 'sheet' : ce?.cost_per_unit != null ? 'product' : null,
      cost_tiers: sheet?.tiers ?? null,
      /** Which sheet block was used, and whether by exact name or the same name with another budget/version */
      cost_sheet_name: sheet?.name ?? null,
      cost_match: found?.match ?? null,
      cost_exact: te?.exact ?? false,
      /** Promo prices read from the campaign name */
      name_tiers: ce?.name_tiers ?? [],
      /** Selling price per piece used for this campaign, low–high */
      price_per_unit_min: te ? te.price_per_unit_min : (ce?.price_per_unit_min ?? null),
      price_per_unit_max: te ? te.price_per_unit_max : (ce?.price_per_unit_max ?? null),
      /** Conservative (most pieces at the cheapest promo price) and best case */
      profit: txProfit ?? (te ? te.profit_low : range ? range.low : null),
      profit_high: txProfit ?? (te ? te.profit_high : range ? range.high : null),
      units_low: t && m ? m.purchase_value * t.units_per_baht : te ? te.units_low : range ? range.units_low : null,
      units_high: t && m ? m.purchase_value * t.units_per_baht : te ? te.units_high : range ? range.units_high : null,
      /** orders = costed order by order from hourly purchases; estimate = from daily totals */
      cost_method: t ? 'orders' : 'estimate',
      tx: t ? { match_rate: t.match_rate, orders: t.orders, matched: t.matched, days: t.days, window_days: tx.windowDays } : null,
      adsets: adsetsOf(c.id).map(view),
    };
  });

  // Real orders (Page365 uploads) for the days in this window: the KPI card prefers these over the Meta estimate.
  const actualDates = window === 'today' ? [] : windowDates(window);
  let actual: null | { dates: number; covered: number; revenue: number; orders: number; units: number; cost: number; fees: number; gross: number; ads: number; net: number; organic_revenue: number; organic_orders: number } = null;
  if (actualDates.length) {
    const [uploads, orders] = await Promise.all([loadUploads(env.DB, actualDates), loadOrders(env.DB, actualDates)]);
    const covered = actualDates.filter((d) => uploads.has(d));
    if (covered.length) {
      const os = orders.filter((o) => covered.includes(o.date));
      const sum = (f: (o: typeof os[number]) => number) => os.reduce((n, o) => n + f(o), 0);
      const revenue = sum((o) => o.total), cost = sum((o) => o.cost ?? 0), fees = sum((o) => orderFees(o, settings.order_fees));
      const daily = await data.dailyAll(window).catch(() => [] as Awaited<ReturnType<typeof data.dailyAll>>);
      const ads = daily.length ? daily.filter((d) => covered.includes(d.date)).reduce((n, d) => n + d.spend, 0) : null;
      const gross = revenue - cost - fees;
      actual = {
        dates: actualDates.length, covered: covered.length, revenue, orders: os.length, units: sum((o) => o.units), cost, fees, gross,
        ads: ads ?? 0, net: gross - (ads ?? 0),
        organic_revenue: sum((o) => (o.match === 'none' ? o.total : 0)), organic_orders: os.filter((o) => o.match === 'none').length,
      };
      if (ads === null) actual = null; // no daily spend to set against: keep the estimate rather than a half number
    }
  }

  return {
    account: data.account,
    window,
    actual,
    /** Set when showing a Claude-pulled snapshot: read-only, limited windows. */
    snapshot,
    meta_fetched_at: data.fetchedAt(),
    meta_warning: data.warning(),
    settings: { dry_run: settings.dry_run, kill_switch: settings.kill_switch, guardrails: settings.guardrails, cod_share_pct: settings.cod_share_pct, cod_fee: settings.cod_fee },
    costs_loaded: costs.length,
    last_run: runs[0] ? { run_at: runs[0].run_at, summary: runs[0].summary, dry_run: runs[0].dry_run } : null,
    stages,
    sections: sections.map((s) => {
      const e = econ.get(s.id)!;
      return {
        ...s,
        totals: totals.get(s.id) ?? zero,
        economics: { ...e.window, breakeven_roas: beOf(e.be), breakeven_best: e.be.breakeven_best !== null && Number.isFinite(e.be.breakeven_best) ? e.be.breakeven_best : null, never_profitable: e.be.breakeven_roas === Infinity },
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
function breakevens(entities: Entity[], sections: Section[], settings: Map<string, CampaignSetting>, costs: CostRow[], cod: Cod, campaignCosts: CampaignCostIndex): Map<string, number | null> {
  const sectionOf = sectionMap(entities, sections, settings);
  const totals = sectionTotals(entities, sectionOf, ECONOMICS_WINDOW);
  const zero = { spend: 0, purchases: 0, purchase_value: 0 };
  const out = new Map<string, number | null>();
  for (const c of entities) {
    if (c.level !== 'campaign') continue;
    const section = sections.find((s) => s.id === (sectionOf.get(c.id) ?? DEFAULT_SECTION_ID));
    const sheet = campaignCosts.find(c.name)?.cost;
    const r = sheet ? tierEconomics(sheet.tiers, undefined).breakeven_roas : section ? campaignEconomics(section, costs, totals.get(section.id) ?? zero, cod, c.name).breakeven_roas : null;
    out.set(c.id, r !== null && Number.isFinite(r) ? r : null);
  }
  return out;
}

/** Side-by-side numbers for one campaign: yesterday, 3, 7 and 30 days, each with product cost and profit. */
const STAT_WINDOWS: Window[] = ['yesterday', 'last_3d', 'last_7d', 'last_30d'];

async function campaignStats(env: Env, id: string) {
  const [{ data }, sections, campaignSettings, costs, settings] = await Promise.all([
    metaData(env), loadSections(env.DB), loadCampaignSettings(env.DB), loadCosts(env.DB), loadSettings(env.DB),
  ]);
  const campaignCosts = new CampaignCostIndex((await loadCampaignCosts(env.DB)).costs);
  const windows = [...new Set<Window>([...STAT_WINDOWS, ECONOMICS_WINDOW])];
  const entities = await withMetrics(data, windows.map((w) => ['campaign', w] as const));
  const c = entities.find((e) => e.level === 'campaign' && e.id === id);
  if (!c) throw new BadRequest('ไม่พบแคมเปญ');
  const cod = codOf(settings);
  const sectionOf = sectionMap(entities, sections, campaignSettings);
  const section = sections.find((s) => s.id === (sectionOf.get(id) ?? DEFAULT_SECTION_ID));
  const totals7 = sectionTotals(entities, sectionOf, ECONOMICS_WINDOW);
  const econ = section ? campaignEconomics(section, costs, totals7.get(section.id) ?? { spend: 0, purchases: 0, purchase_value: 0 }, cod, c.name) : null;
  const sheet = campaignCosts.find(c.name)?.cost;
  const be = sheet ? tierEconomics(sheet.tiers, undefined).breakeven_roas : econ?.breakeven_roas;
  const tiers = makeTierResolver({ entities, sections, campaignSettings, costs, cod, campaignCosts: (await loadCampaignCosts(env.DB)).costs })(c.id, c.name).tiers;
  const txs = new Map(await Promise.all(STAT_WINDOWS.map(async (w) => [w, await txContext(env, data, w)] as const)));
  return {
    breakeven_roas: finiteOrNull(be),
    cost_source: sheet ? 'sheet' : econ?.cost_per_unit != null ? 'product' : null,
    windows: STAT_WINDOWS.map((w) => {
      const m = c.metrics[w];
      const ctx = txs.get(w)!;
      const t = m && m.purchase_value > 0 ? txCosting(ctx.hours.get(c.id), tiers, cod.fee, ctx.days) : null;
      if (t && m) {
        const p = m.purchase_value * (1 - t.cost_ratio) - m.spend, u = m.purchase_value * t.units_per_baht;
        return { window: w, metrics: finite(m), profit_low: p, profit_high: p, units_low: u, units_high: u, method: 'orders', match_rate: t.match_rate };
      }
      if (sheet) {
        const te = tierEconomics(sheet.tiers, m);
        return { window: w, metrics: finite(m), profit_low: te.profit_low, profit_high: te.profit_high, units_low: te.units_low, units_high: te.units_high, method: 'estimate' };
      }
      const r = econ && m ? profitRange(econ, section!.extra_cost_per_order, m, cod) : null;
      return {
        window: w,
        metrics: finite(m),
        profit_low: r?.low ?? null, profit_high: r?.high ?? null,
        units_low: r?.units_low ?? null, units_high: r?.units_high ?? null,
        method: 'estimate',
      };
    }),
    meta_fetched_at: data.fetchedAt(),
  };
}

/** Every campaign × day in the window, each with its product cost and profit worked out step by step. */
async function salesReport(env: Env, window: Window) {
  const [{ data }, sections, campaignSettings, costs, settings, cc] = await Promise.all([
    metaData(env), loadSections(env.DB), loadCampaignSettings(env.DB), loadCosts(env.DB), loadSettings(env.DB), loadCampaignCosts(env.DB),
  ]);
  const [entities, days] = await Promise.all([
    withMetrics(data, [['campaign', ECONOMICS_WINDOW]]),
    data.dailyAll(window).catch((err) => { throw new BadRequest(err instanceof MetaCacheError ? err.message : friendlyMetaError(err)); }),
  ]);
  const index = new CampaignCostIndex(cc.costs);
  const cod = codOf(settings);
  const sectionOf = sectionMap(entities, sections, campaignSettings);
  const totals7 = sectionTotals(entities, sectionOf, ECONOMICS_WINDOW);
  const zero = { spend: 0, purchases: 0, purchase_value: 0 };
  const byId = new Map(entities.filter((e) => e.level === 'campaign').map((e) => [e.id, e]));
  const sourceCache = new Map<string, Parameters<typeof explainDay>[2]>();
  const sourceOf = (id: string, name: string): Parameters<typeof explainDay>[2] => {
    if (sourceCache.has(id)) return sourceCache.get(id)!;
    let src: Parameters<typeof explainDay>[2];
    const found = index.find(name);
    if (found) src = { kind: 'sheet', sheet_name: found.cost.name, tiers: found.cost.tiers };
    else {
      const section = sections.find((s) => s.id === (sectionOf.get(id) ?? DEFAULT_SECTION_ID));
      if (!section || section.id === DEFAULT_SECTION_ID && !section.products.length) src = { kind: 'none', reason: 'ไม่มีในชีตต้นทุน และยังไม่ผูกสินค้า' };
      else src = { kind: 'product', product: section.name, econ: campaignEconomics(section, costs, totals7.get(section.id) ?? zero, cod, name), extra: section.extra_cost_per_order, cod };
    }
    sourceCache.set(id, src);
    return src;
  };
  const tiersOf = makeTierResolver({ entities, sections, campaignSettings, costs, cod, campaignCosts: cc.costs });
  const reportDates = [...windowDates(window), bkkDate(0)];
  const [{ byCampaign: hoursBy, stored }, uploads] = await Promise.all([loadConversionHours(env.DB, windowDates(window)), loadUploads(env.DB, reportDates)]);
  const uploadedDates = [...uploads.keys()];
  const actual = new Map<string, ReturnType<typeof actualByCampaign>>();
  if (uploadedDates.length) {
    const all = await loadOrders(env.DB, uploadedDates);
    for (const d of uploadedDates) actual.set(d, actualByCampaign(all.filter((o) => o.date === d), settings.order_fees));
  }
  const covered = new Set<string>();
  const rows = days
    .filter((d) => d.spend > 0 || d.purchases > 0 || d.purchase_value > 0)
    .map((d) => {
      const c = byId.get(d.campaign_id);
      const name = c?.name ?? d.campaign_id;
      const base = { date: d.date, campaign_id: d.campaign_id, name, stage_id: campaignSettings.get(d.campaign_id)?.stage_id ?? null };
      // Real orders from Page365 for that day, credited to this campaign.
      const a = actual.get(d.date)?.get(d.campaign_id);
      if (a) { covered.add(`${d.date}|${d.campaign_id}`); return explainActual(base, d, a); }
      if (actual.has(d.date)) {
        // Uploaded day but nothing credited here: no real order for this campaign, so its ad spend is a plain loss.
        return explainActual(base, d, { orders: 0, revenue: 0, goods: 0, shipping: 0, cost: 0, fees: 0, units: 0, customer: 0, exact: 0, approx: 0, cost_known: 1 });
      }
      // That day's tagged purchases, order by order, when they are stored.
      if (stored.has(d.date) && d.purchase_value > 0) {
        const t = tiersOf(d.campaign_id, name);
        const tx = txCosting(hoursBy.get(d.campaign_id)?.filter((h) => h.date === d.date), t.tiers, cod.fee, 1);
        if (tx) return explainOrders(base, d, tx, t.tiers, t.source === 'sheet' ? `ชีต "${t.label}"` : `สินค้า "${t.label}"`);
      }
      return explainDay(base, d, sourceOf(d.campaign_id, name));
    });
  // Uploaded days: campaigns with real orders but no Meta row, and orders no campaign could be found for.
  for (const [date, by] of actual) {
    for (const [cid, a] of by) {
      if (cid !== null && covered.has(`${date}|${cid}`)) continue;
      const id = cid ?? 'none';
      const name = cid ? byId.get(cid)?.name ?? cid : 'ไม่ทราบแอด (ไม่ได้ติ๊กเข้า Meta / organic)';
      rows.push(explainActual({ date, campaign_id: id, name, stage_id: cid ? campaignSettings.get(cid)?.stage_id ?? null : null }, { spend: 0, purchases: a.orders, purchase_value: a.revenue, clicks: 0 }, a));
    }
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.revenue - a.revenue);
  return { window, rows, uploaded: uploadedDates, fetched_at: data.fetchedAt(), warning: data.warning() };
}

/**
 * One day's revenue events per campaign, each order matched to the campaign's promos (from the cost sheet, or
 * the product line's cost with the promos in the campaign name) and costed, with that day's ad spend.
 */
async function conversions(env: Env, date: string, window: Window) {
  const [{ data }, sections, campaignSettings, costs, settings, cc] = await Promise.all([
    metaData(env), loadSections(env.DB), loadCampaignSettings(env.DB), loadCosts(env.DB), loadSettings(env.DB), loadCampaignCosts(env.DB),
  ]);
  const err = (e: unknown) => { throw new BadRequest(e instanceof MetaCacheError ? e.message : friendlyMetaError(e)); };
  const [hours, days, entities] = await Promise.all([data.hourly(date).catch(err), data.dailyAll(window).catch(() => []), withMetrics(data, [['campaign', ECONOMICS_WINDOW]])]);
  const cod = codOf(settings);
  const nameOf = new Map(entities.filter((e) => e.level === 'campaign').map((e) => [e.id, e.name]));
  const spendOf = new Map(days.filter((d) => d.date === date).map((d) => [d.campaign_id, d.spend]));
  const tiersOf = makeTierResolver({ entities, sections, campaignSettings, costs, cod, campaignCosts: cc.costs });
  // Keep the store fresh with what was just fetched (except today, still being tagged).
  if (date < bkkDate(0)) await saveConversionDay(env.DB, date, hours).catch(() => {});

  const byCampaign = new Map<string, typeof hours>();
  for (const h of hours) byCampaign.set(h.campaign_id, [...(byCampaign.get(h.campaign_id) ?? []), h]);
  const campaigns = [...byCampaign].map(([id, hs]) => {
    const name = nameOf.get(id) ?? id;
    const t = tiersOf(id, name);
    const day = campaignDay(hs.sort((a, b) => a.hour.localeCompare(b.hour)), t.tiers, cod.fee);
    const spend = spendOf.get(id) ?? null;
    const costed = t.tiers.length > 0;
    return {
      campaign_id: id, name, stage_id: campaignSettings.get(id)?.stage_id ?? null,
      tiers: t.tiers, cost_source: t.source, cost_label: t.label,
      count: day.count, value: day.value, matched: day.matched, match_rate: day.match_rate,
      cost: costed ? day.cost : null,
      spend,
      // COD surcharges are in the value (income) and not in the cost.
      profit: costed && spend !== null ? day.value - day.cost - spend : null,
      orders: day.orders,
    };
  }).sort((a, b) => b.value - a.value);
  return { date, cod_fee: cod.fee, campaigns, fetched_at: data.fetchedAt() };
}

async function ideas(env: Env) {
  const [{ data }, sections, campaignSettings, costs] = await Promise.all([
    metaData(env), loadSections(env.DB), loadCampaignSettings(env.DB), loadCosts(env.DB),
  ]);
  const entities = await withMetrics(data, [['campaign', 'last_7d'], ['campaign', 'last_30d']]);
  const be = breakevens(entities, sections, campaignSettings, costs, codOf(await loadSettings(env.DB)), new CampaignCostIndex((await loadCampaignCosts(env.DB)).costs));
  const changes = await recentBudgetChanges(env.DB, 3);
  const list = buildIdeas(entities.filter((e) => e.level === 'campaign').map((c) => ({
    campaign: c,
    recent_budget_change: changes.get(c.id) ?? null,
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

/** Stored hourly purchases for a window's dates (today live from Meta), and how many of its days are covered. */
async function txContext(env: Env, data: MetaData, window: Window) {
  const dates = windowDates(window);
  const { byCampaign, stored } = await loadConversionHours(env.DB, dates);
  let days = stored.size;
  const today = bkkDate(0);
  if (dates.includes(today)) {
    const live = await data.hourly(today).catch(() => null);
    if (live) {
      days += 1;
      for (const r of live) byCampaign.set(r.campaign_id, [...(byCampaign.get(r.campaign_id) ?? []), { date: today, hour: r.hour, purchases: r.purchases, purchase_value: r.purchase_value }]);
    }
  }
  return { hours: byCampaign, days, windowDays: dates.length };
}

const finiteOrNull = (v: number | null | undefined) => (v !== null && v !== undefined && Number.isFinite(v) ? v : null);

/** JSON has no Infinity; the UI shows null as "–". */
function finite<T extends object | undefined>(m: T): T {
  if (!m) return m;
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'number' && !Number.isFinite(v) ? null : v])) as T;
}

/** 07:30 Discord note: yesterday's real numbers (Page365) when the file is in, otherwise a reminder to upload. */
async function dailyDigest(env: Env): Promise<void> {
  return salesDigest(env, bkkDate(1), true);
}

/** One day's real numbers (Page365) to Discord; also sent the moment a file is uploaded. */
async function salesDigest(env: Env, date: string, remindIfMissing = false): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return;
  const thai = new Date(`${date}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });
  const [uploads, orders, settings] = await Promise.all([loadUploads(env.DB, [date]), loadOrders(env.DB, [date]), loadSettings(env.DB)]);
  if (!uploads.has(date)) {
    if (remindIfMissing) await pushDiscord(`📂 **${thai}** ยังไม่มีไฟล์ Page365 — มอส export ของเมื่อวานแล้วอัปโหลดที่หน้ายอดขายรายวันด้วยครับ`, env.DISCORD_WEBHOOK_URL);
    return;
  }
  const n = (f: (o: typeof orders[number]) => number) => orders.reduce((t, o) => t + f(o), 0);
  const revenue = n((o) => o.total), cost = n((o) => o.cost ?? 0), fees = n((o) => orderFees(o, settings.order_fees));
  const organic = orders.filter((o) => o.match === 'none');
  let ads: number | null = null;
  try {
    // Spend for that day: yesterday is cheap; older days come from the cached 30-day series.
    const rows = date === bkkDate(1) ? await metaFor(env).dailyCampaignInsights('yesterday') : await (await metaData(env)).data.dailyAll('last_30d');
    const day = rows.filter((d) => d.date === date);
    ads = day.length ? day.reduce((t, d) => t + d.spend, 0) : null;
  } catch { ads = null; }
  const b = (x: number) => Math.round(x).toLocaleString('th-TH');
  const gross = revenue - cost - fees;
  const lines = [
    `📊 **ของจริง ${thai}** (Page365 ${orders.length} ออเดอร์)`,
    `ยอดขาย ${b(revenue)} · ทุนสินค้า ${b(cost)} (${revenue ? Math.round((cost / revenue) * 100) : 0}%) · ค่าใช้จ่ายต่อออเดอร์ ${b(fees)}`,
    `กำไรขั้นต้น **${b(gross)}**${ads === null ? '' : ` · ค่าแอด ${b(ads)} (${revenue ? Math.round((ads / revenue) * 100) : 0}% ของยอด) · กำไรสุทธิ **${b(gross - ads)}** · MER ${ads ? (revenue / ads).toFixed(2) : '–'}`}`,
    `ไม่ใช่แอด ${organic.length} ออเดอร์ ${b(n((o) => (o.match === 'none' ? o.total : 0)))} (${orders.length ? Math.round((organic.length / orders.length) * 100) : 0}%) · จับคู่แอดได้ ${orders.length - organic.length}/${orders.length}`,
  ];
  await pushDiscord(lines.join('\n'), env.DISCORD_WEBHOOK_URL);
}

/**
 * A preset window, or a custom range "range:YYYY-MM-DD:YYYY-MM-DD" (Bangkok dates, like Ads Manager's picker):
 * at most 90 days, not in the future. Anything else falls back to 7 days.
 */
function parseView(w: string | null): Window {
  if (w && DASHBOARD_WINDOWS.includes(w as Window)) return w as Window;
  const m = w ? /^range:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(w) : null;
  if (m) {
    const [since, until] = m[1] <= m[2] ? [m[1], m[2]] : [m[2], m[1]];
    const days = (Date.parse(until) - Date.parse(since)) / 86_400_000;
    if (Number.isFinite(days) && days <= 90 && until <= bkkDate(0)) return `range:${since}:${until}` as Window;
  }
  return 'last_7d';
}

/** After a user change: push the email list to Cloudflare Access when the token is set; a failure is reported, not fatal. */
async function syncIfConfigured(env: Env, actor: string): Promise<{ ok: boolean; error?: string } | null> {
  if (!env.CF_API_TOKEN) return null;
  try {
    const users = await loadUsers(env.DB);
    const r = await syncAccess(env, [...ownerEmails(env), ...users.map((u) => u.email)]);
    await audit(env.DB, actor, 'users.access-sync', 'cloudflare', r);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
