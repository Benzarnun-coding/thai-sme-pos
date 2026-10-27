// Worker entry: JSON API for the dashboard + cron triggers. Static files in dist/ are served by Cloudflare before this runs.

import { MetaClient } from '../../ads-engine/src/meta.ts';
import { applyDecisions, sumBudget } from '../../ads-engine/src/apply.ts';
import type { Entity, Level, Window } from '../../ads-engine/src/types.ts';
import { authenticate } from './auth.ts';
import { canWrite, roleOf, type Role } from './roles.ts';
import { deleteUser, loadUsers, normaliseEmail, ownerEmails, parseRole, roleMap, saveUser } from './users.ts';
import { accessStatus, syncAccess } from './access.ts';
import { syncCampaignCosts, syncCosts } from './costs.ts';
import { CampaignCostIndex, tierEconomics, type CampaignCost, type CostTier } from './campaignCosts.ts';
import {
  applyMoves, audit, codOf, deleteSection, loadCampaignCosts, deleteWebCost, saveWebCost, insertRun, lastRun, listAudit, listRuns, loadCampaignSettings, loadCostRows, loadCosts, loadSections, loadSettings,
  loadStages, loadState, saveCampaignSetting, saveCampaignSettings, auditMany, campaignHistory, saveSection, saveSettings, saveStage,
} from './db.ts';
import { ECONOMICS_WINDOW, sectionMap, sectionTotals } from './engine.ts';
import { MockMeta } from './mock.ts';
import { DEFAULT_SECTION_ID, WEB_TAB, campaignEconomics, economics, profitRange, suggestProducts, type CampaignSetting, type Cod, type CostRow, type Economics, type Section } from './model.ts';
import { capChanges, DUP_RAMP_TO, DUP_START_BUDGET, FREE_INCREASE_BELOW, INCREASE_GAP_HOURS, MAX_COPY_OBJECTS, planRun, provenWinners, runAutomation, shopBreakeven, spaceIncreases, WINNER_MAX_BUDGET, zeroMetrics, type MetaLike } from './run.ts';
import type { BreakevenSource } from './breakevens.ts';
import { buildIdeas } from './ideas.ts';
import { explainActual, explainDay, explainOrders } from './salesReport.ts';
import { campaignDay } from './transactions.ts';
import { makeTierResolver } from './costing.ts';
import { loadUnitCosts, searchCatalogCodes } from './unitCosts.ts';
import { bkkDate, loadConversionHours, lockedHourDays, saveConversionDay, syncConversionHours, txCosting, windowDates } from './conversionStore.ts';
import { addCompetitorCheck, deleteCompetitor, deleteCompetitorAd, listCompetitors, saveCompetitor, saveCompetitorAd } from './competitors.ts';
import { friendlyD1Error, friendlyMetaError, insertBudgetChanges, loadMetaData, MetaCacheError, patchCachedEntity, recentBudgetChanges, type MetaData } from './metadata.ts';
import { PRIVACY_HTML } from './privacy.ts';
import { parseRange, salesData } from './sales.ts';
import { listImportMaps, profitData, saveImportMap, saveMpOrders, validateMpOrders } from './mpOrders.ts';
import { opsFacts, opsText } from './opsDigest.ts';
import { deleteMove, gosellCut, saveMoves, stockData, syncRoundStock, validateMoves } from './stock.ts';
import { deletePurchase, findOrders, ledger, listPurchases, orderTerms, purchaseExtra, purchaseLines, savePayments, savePurchase, setMissing, validateMissing, validatePayments, validatePurchase } from './purchase.ts';
import { applySync, catalogMeta, catalogRows, catalogSheetId, createWebSkus, deleteImage, deleteWebSku, discoverTabs, imageKey, imageResponse, parseSheetId, proxyImage, saveCatalogSheetId, saveAlias, saveImageLink, saveLabels, savePrices, saveSuppliers, saveUploadedImage, sheetCsv, updateWebSku, validateSync } from './catalog.ts';
import { DISCORD_PERSONA, pushDiscord } from '../../ads-engine/src/notify.ts';
import { chatDay, chatDayText, chatSummary, purgeChats, reRedactChats } from './chatLog.ts';
import * as studio from './studio.ts';
import { aiEnabled, askAI, botErrors, botRateText, citeKey, INSIGHT_SYSTEM, insightPrompt, transcript, type Conversation } from './chatInsights.ts';
import { editKb, fixedBefore, kbMessage, kbModal, rewriteKb, kbPasteText, listKb, markApplied, postBot, proposeItems, repeatsText, setKbStatus, speaker, type KbItem } from './botKb.ts';
import { checkDoc, docIdFrom, docLive, docText, loadDocSettings, saveDocSettings, serviceEmail, writeDoc } from './botKbDoc.ts';
import { closeCase, customerName, serviceAlerts, servicePreview } from './serviceAlert.ts';
import { familyStats, postIdeas, postIdeasText, spendForUploadedDays } from './postIdeas.ts';
import { dayNet, goalStatus, monthDates, nextCap, type DayNet, type GoalStatus } from './goal.ts';
import { approvalsEnabled, blockedByKillSwitch, editMessage, expireOld, idList, postToDeciders, recentlyAsked, postProposal, postUploadReminder, saveProposals, uploadReminderMessage, verifyDiscord, type Proposal } from './discord.ts';
import { hourCheck, hourCheckText } from './hourCheck.ts';
import { syncP365Costs } from './p365Costs.ts';
import { applyCardCorrections, CARD_REASON, cardCorrectionOn, cardCorrections } from './billCards.ts';
import { actualByCampaign, loadOrders, loadUploads, normaliseOrders, orderFees, recreditDates, saveOrders, type UploadedOrder } from './p365.ts';
import { catalogFor, checkNotes, loadNote, loadNotes, markFill, noteDays, withCatalog } from './orderNotes.ts';
import { applyFill, findDraft, planFill, sessionStatus, P365Error } from './p365fill.ts';
import { cleanupDrafts, cleanupOn, setCleanup } from './draftCleanup.ts';
import { correctionOn, previewCorrections, setCorrection } from './noteCorrection.ts';
import { accuracy, auditStep } from './fillAudit.ts';
import { autoFillNote, autoFillOn, cronSweep, customerFor, loadMisses, setAutoFill, sweepNotes, tell, tellMiss } from './autoFill.ts';
import { loadCapi, recentPurchases, saveCapi, sendOne, syncPurchases } from './metaPurchases.ts';
import { captureSource, planNotePurchases } from './notePurchases.ts';
import { dayOrders, reconcile } from './orderDay.ts';
import { adjustmentDays, seedFromSent } from './metaAdjust.ts';
import { buildEnabled, checkBuilds, listRequests, modalValues, postPicker, registerCommand, requestInteraction, syncTitles } from './featureRequests.ts';
import { pageOf, receiveWebhook, referralSummary, setupWebhook, verifyChallenge, webhookStatus } from './webhook.ts';
import { BadRequest, validateWebCost, validateCampaignSetting, validateSection, validateSettings, validateStage } from './validate.ts';

export interface Env {
  DB: D1Database;
  /** The built dashboard (dist); /webhook/uni.jpg serves the bot's picture from it */
  ASSETS?: Fetcher;
  META_ACCESS_TOKEN?: string;
  META_AD_ACCOUNT_ID: string;
  META_API_VERSION?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_TO?: string;
  DISCORD_WEBHOOK_URL?: string;
  /** Discord bot (buttons): token is a secret, the other two are vars */
  DISCORD_BOT_TOKEN?: string;
  DISCORD_APP_PUBLIC_KEY?: string;
  DISCORD_CHANNEL_ID?: string;
  DISCORD_DECIDER_IDS?: string;
  /** #meta-chat channel webhook: the daily chat report */
  DISCORD_CHAT_WEBHOOK_URL?: string;
  /** #report channel: the morning back-office report (falls back to DISCORD_WEBHOOK_URL) */
  DISCORD_REPORT_WEBHOOK_URL?: string;
  /** AI read of the chats (chatInsights.ts); company Anthropic account */
  ANTHROPIC_API_KEY?: string;
  /** Messenger echo app ids: admins (Meta inbox, Page365) vs Meta's Business AI — labels in the chat reads */
  CHAT_HUMAN_APP_IDS?: string;
  CHAT_BOT_APP_IDS?: string;
  /** Who pastes the approved answers into Business AI each Monday (Fear); tagged and may press "ใส่บอทแล้ว" */
  DISCORD_KB_UPDATER_IDS?: string;
  /** Google service account JSON key that writes the answer bank into the Doc Business AI reads (botKbDoc.ts). */
  GOOGLE_SA_KEY?: string;
  /** #meta-chat: the bot posts everything about chats and the answer bank here (needs View + Send there) */
  DISCORD_CHAT_CHANNEL_ID?: string;
  /** Discord "service ลูกค้า" (secret webhook URL, the switch) and who answers there (Fear) — worker/serviceAlert.ts */
  DISCORD_SERVICE_WEBHOOK_URL?: string;
  DISCORD_SERVICE_IDS?: string;
  CHAT_AI_MODEL?: string;
  /** ห้องฝึก caption agent model (worker/studio.ts); default claude-opus-5-5 */
  STUDIO_AI_MODEL?: string;
  /** Discord user IDs allowed to press the buttons (comma separated); empty = anyone in the channel */
  DISCORD_APPROVER_IDS?: string;
  /** Discord user IDs who upload Page365 (เคน from 2026-10-16, was มอส); tagged at 10:00 if the file is missing, may press the upload buttons */
  DISCORD_UPLOADER_IDS?: string;
  /** Feature requests (/ไอเดีย, worker/featureRequests.ts): forum channel (empty = off) and who decides (Benz) */
  DISCORD_APP_ID?: string;
  DISCORD_REQUEST_CHANNEL_ID?: string;
  DISCORD_REQUEST_DECIDER_IDS?: string;
  DISCORD_REQUEST_COMMAND_CHANNEL_ID?: string;
  IDEA_ROUTINE_ID?: string;
  IDEA_ROUTINE_TOKEN?: string;
  GITHUB_REPO?: string;
  GITHUB_TOKEN?: string;
  /** Page365 login the Worker uses to fill drafts (secret; see worker/p365fill.ts) and the shop's page id */
  P365_COOKIE?: string;
  P365_PAGE_ID?: string;
  DISCORD_ORDER_WEBHOOK_URL?: string;
  /** model that reads shipping addresses out of the chat (worker/addressReader.ts; key: ANTHROPIC_API_KEY below) */
  ADDRESS_MODEL?: string;
  ADDRESS_MODEL_HARD?: string;
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
/** 10:00 Bangkok: remind the uploaders if yesterday's Page365 file is still missing. */
const REMIND_CRON = '0 3 * * *';
// Order-note sweep + webhook check every 3 hours (autoFill.ts cronSweep, Benz 15 Oct).
const SWEEP_CRON = '15 */3 * * *';
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
    // น้องอูนิ's picture: Discord fetches it for every webhook post, so it sits on the path Access lets through.
    if (url.pathname === '/webhook/uni.jpg' && env.ASSETS) return env.ASSETS.fetch(new Request(new URL('/uni.jpg', url)));
    if (url.pathname === '/webhook/privacy') return new Response(PRIVACY_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (url.pathname === '/webhook/discord' && req.method === 'POST') return discordInteraction(req, env, ctx);
    // The idea routine pings this when it's done (no auth: it only re-reads GitHub, same as the 3-hourly sweep).
    if (url.pathname === '/webhook/idea-check' && req.method === 'POST') return json({ found: await checkBuilds(env).catch(() => 0) });
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
    if (user.startsWith('service:') && req.method !== 'GET') return json({ error: 'service token: read only' }, 403);
    if (!canWrite(role, req.method, url.pathname)) {
      return json({ error: role === 'viewer' ? 'บัญชีนี้ดูได้อย่างเดียว — ให้เจ้าของเพิ่มสิทธิ์ในหน้า ผู้ใช้' : role === 'costs' ? 'บัญชีนี้แก้ได้เฉพาะต้นทุน — ให้เจ้าของเพิ่มสิทธิ์ในหน้า ผู้ใช้' : 'เฉพาะเจ้าของเท่านั้นที่จัดการผู้ใช้ได้' }, 403);
    }

    try {
      return await route(req, env, url, user, role, ctx);
    } catch (err: any) {
      if (err instanceof BadRequest) return json({ error: err.message }, 400);
      console.error(err);
      return json({ error: friendlyD1Error(err) }, 500);
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === COSTS_CRON) {
      ctx.waitUntil(purgeChats(env.DB).then(() => sendChatReport(env, 'yesterday')).then(() => (aiEnabled(env) ? sendChatInsights(env, 'yesterday') : null)).catch((err) => console.error('chat report', err)));
      ctx.waitUntil(loadSettings(env.DB).then((s) => Promise.all([
        s.sheet_id ? syncCosts(env.DB, s) : [],
        s.ads_cost_sheet_id ? syncCampaignCosts(env.DB, s) : null,
        // Hourly purchases: refresh the last 3 days (late tags) and fill a few missing older days.
        Promise.resolve().then(() => syncConversionHours(env.DB, metaFor(env))).catch(() => null),
      ])
        // Page365 bill cards Meta counted as sales (billCards.ts; only when switched on), before orders are re-credited.
        .then(() => applyCardCorrections(env.DB, [bkkDate(1), bkkDate(2), bkkDate(3)], 'auto').catch((err) => console.error('card correction', err)))
        .then(() => recreditDates(env.DB, [bkkDate(1), bkkDate(2), bkkDate(3)]).catch(() => null))
        .then(() => dailyDigest(env).catch((err) => console.error('digest', err)))));
    } else if (event.cron === SWEEP_CRON) {
      ctx.waitUntil(cronSweep(env).catch((err) => console.error('cron sweep', err)));
      ctx.waitUntil(syncTitles(env).catch((err) => console.error('request titles', err)));
      ctx.waitUntil(checkBuilds(env).catch((err) => console.error('request builds', err)));
    } else if (event.cron === REMIND_CRON) {
      ctx.waitUntil(uploadReminder(env).catch((err) => console.error('reminder', err)));
      ctx.waitUntil(kbReminder(env).catch((err) => console.error('kb reminder', err)));
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
      // Monday 08:00 Bangkok: after the run, ask whether the shop-wide daily cap may grow (goal.ts).
      // Monday and Thursday 08:00: อูนิ's new-post ideas for Max (postIdeas.ts).
      const day = new Date(Date.now() + 7 * 3_600_000).getUTCDay(), morning = new Date().getUTCHours() < 6;
      ctx.waitUntil(runAutomation(env, meta, { trigger: 'schedule' })
        .then(() => (morning && day === 1 ? scaleCheck(env).catch((err) => console.error('scale', err)) : null))
        .then(() => (morning && (day === 1 || day === 4) ? sendPostIdeas(env).catch((err) => console.error('ideas', err)) : null))
        // Monday and Thursday: อูนิ's fixes for Meta's Business AI, each with approve / reject buttons (botKb.ts).
        .then(() => (morning && (day === 1 || day === 4) && aiEnabled(env) ? kbRound(env, 'fix').catch((err) => console.error('kb', err)) : null))
        // 20:00: how today is doing against the goal's daily pace.
        .then(() => (!morning ? eveningPace(env).catch((err) => console.error('pace', err)) : null)));
    }
  },
} satisfies ExportedHandler<Env>;

async function route(req: Request, env: Env, url: URL, user: string, role: Role, ctx: ExecutionContext): Promise<Response> {
  const path = url.pathname.replace(/\/$/, '');
  const method = req.method;
  const body = async () => (await req.json().catch(() => { throw new BadRequest('ข้อมูลไม่ใช่ JSON'); })) as any;
  let m: RegExpMatchArray | null;

  if (method === 'GET' && path === '/api/me') return json({ email: user, role, mock: env.DEV_MOCK_META === 'true' });
  // Read-only SQL for looking into production (the Access service token, or an owner): one SELECT, ≤ 500 rows.
  if (method === 'GET' && path === '/api/debug/sql') {
    if (!user.startsWith('service:') && role !== 'owner') return json({ error: 'owner or service token only' }, 403);
    return json(await readOnlyQuery(env.DB, url.searchParams.get('q') ?? ''));
  }

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
    // Our ทุน follows Page365 wherever it differs (p365Costs.ts, Benz 27 Oct).
    const costs = await syncP365Costs(env.DB, user, { apply: true }).catch((err) => { console.error('p365 costs', err); return null; });
    ctx.waitUntil(Promise.all(dates.map((d) => salesDigest(env, d).catch((err) => console.error('digest', err)))));
    return json({ dates, orders: orders.length, errors, skipped, credits, costs: costs && { changed: costs.changes.length, missing: costs.missing.map((m) => m.key) } });
  }
  // What our ทุน would change to from Page365's costs (p365Costs.ts); POST applies it now (the upload also does).
  if (path === '/api/p365/costs' && (method === 'GET' || method === 'POST')) {
    return json(await syncP365Costs(env.DB, user, { apply: method === 'POST' }));
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
  // Admins' order notes in the chat vs what Page365 holds (phase 0 of filling Page365 orders automatically).
  // Phase 1: put a note's items into the customer's Page365 draft (a person presses the button; the draft stays a draft).
  if (path === '/api/p365/session' && method === 'GET') return json(await sessionStatus(env));
  if (path === '/api/order-notes/plan' && method === 'GET') {
    const note = await loadNote(env.DB, url.searchParams.get('mid') ?? '');
    if (!note) throw new BadRequest('ไม่พบบรรทัดสรุปนี้');
    try { return json(await planFill(env, note)); } catch (err) { if (err instanceof P365Error) throw new BadRequest(err.message); throw err; }
  }
  if (path === '/api/order-notes/fill' && method === 'POST') {
    const input = await body();
    const note = await loadNote(env.DB, String(input?.mid ?? ''));
    if (!note) throw new BadRequest('ไม่พบบรรทัดสรุปนี้');
    if (note.filled_at) throw new BadRequest(`ใส่ไปแล้วโดย ${note.filled_by} (#${note.fill_order_no})`);
    try {
      // One bill pressed by a person may go ahead with warnings it was shown; "fill all" may not.
      const r = await applyFill(env, note, { address: input?.address, allowWarnings: input?.allow_warnings === true });
      await markFill(env.DB, note.mid, { by: user, order_no: r.order.no, error: null });
      await audit(env.DB, user, 'p365.fill', String(r.order.no), { mid: note.mid, lines: r.plan.lines.map((l) => `${l.sku}×${l.qty}`), total: r.order.total });
      return json({ ok: true, order_no: r.order.no, total: r.order.total });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await markFill(env.DB, note.mid, { by: user, order_no: null, error: msg });
      await audit(env.DB, user, 'p365.fill_failed', note.mid, { error: msg });
      throw new BadRequest(msg);
    }
  }
  // Phase 3: open + fill drafts by themselves when a note arrives (autoFill.ts). Switch, a read-only check, a manual run.
  if (path === '/api/order-notes/auto' && method === 'GET') return json({ on: await autoFillOn(env.DB) });
  if (path === '/api/order-notes/auto' && method === 'PUT') {
    if (role !== 'owner') throw new BadRequest('เฉพาะเจ้าของเท่านั้น');
    const on = (await body())?.on === true;
    await setAutoFill(env.DB, on);
    await audit(env.DB, user, 'p365.auto_fill', on ? 'on' : 'off', {});
    return json({ on });
  }
  // Accuracy of the order-note flow (fillAudit.ts): per day + recent edited bills; a step by hand for backfilling.
  if (path === '/api/order-notes/accuracy' && method === 'GET') return json(await accuracy(env.DB, Math.min(Number(url.searchParams.get('days') ?? 7) || 7, 30)));
  if (path === '/api/order-notes/audit-run' && method === 'POST') return json({ written: await auditStep(env, { force: true, limit: 15 }) });
  // Deleting drafts nobody will send (draftCleanup.ts): GET = switch + what it would do now (nothing deleted).
  if (path === '/api/order-notes/cleanup' && method === 'GET') return json({ on: await cleanupOn(env.DB), preview: await cleanupDrafts(env, { apply: false, limit: 20 }) });
  if (path === '/api/order-notes/cleanup' && method === 'PUT') {
    if (role !== 'owner') throw new BadRequest('เฉพาะเจ้าของเท่านั้น');
    const on = (await body())?.on === true;
    await setCleanup(env.DB, on);
    await audit(env.DB, user, 'p365.draft_cleanup', on ? 'on' : 'off', {});
    return json({ on });
  }
  // A corrected summary changes the bill already made (noteCorrection.ts): GET = switch + what it would have done
  // with recent real notes (Page365 read only); PUT = the switch, owner only.
  if (path === '/api/order-notes/correction' && method === 'GET') {
    const n = (k: string, d: number, max: number) => { const v = Number(url.searchParams.get(k) ?? d); return Math.min(Math.max(Number.isFinite(v) ? v : d, 0), max); };
    return json({ on: await correctionOn(env.DB), preview: await previewCorrections(env, { days: n('days', 10, 30), limit: n('limit', 10, 12), offset: n('offset', 0, 500) }) });
  }
  if (path === '/api/order-notes/correction' && method === 'PUT') {
    if (role !== 'owner') throw new BadRequest('เฉพาะเจ้าของเท่านั้น');
    const on = (await body())?.on === true;
    await setCorrection(env.DB, on);
    await audit(env.DB, user, 'p365.note_correction', on ? 'on' : 'off', {});
    return json({ on });
  }
  // A sample "needs a person" message into the order-problems channel, so the team sees what it looks like.
  if (path === '/api/order-notes/test-discord' && method === 'POST') {
    if (role !== 'owner') throw new BadRequest('เฉพาะเจ้าของเท่านั้น');
    if (url.searchParams.get('kind') === 'miss') await tellMiss(env, { mid: 'test', psid: '', at: new Date().toISOString(), text: 'โอน349 ธนชาต\n301/1 เอวสามสี่ สองตัว', name_hash: null }, 'ข้อความทดสอบ (ไม่ใช่ลูกค้าจริง)');
    else await tell(env, { mid: 'test', psid: '', at: new Date().toISOString(), text: '501/1 31\ncod 249', name_hash: null }, null, 'ข้อความทดสอบ (ไม่ใช่ลูกค้าจริง)', ['ตัวอย่าง: 501/1 ไม่มีไซส์ 31 — รุ่นนี้มี 28, 29, 30, 32, 34, 36 · ต้องถามลูกค้าใหม่']);
    await audit(env.DB, user, 'p365.test_discord', 'order-problems', {});
    return json({ ok: true, channel: env.DISCORD_ORDER_WEBHOOK_URL ? 'ห้องออเดอร์มีปัญหา' : 'ห้องรายงานแอด (ยังไม่ได้ตั้งห้องใหม่)' });
  }
  if (path === '/api/order-notes/draft-check' && method === 'GET') {
    const note = await loadNote(env.DB, url.searchParams.get('mid') ?? '');
    if (!note) throw new BadRequest('ไม่พบบรรทัดสรุปนี้');
    const draft = await findDraft(env, note.psid, note.at);
    const who = draft ? null : await customerFor(env, note.psid);
    return json({ draft: draft ? { no: draft.no, items: draft.items.length } : null, customer: who ? { conversation_id: who.conversation_id, customer_id: who.customer_id, has_name: !!who.name } : null });
  }
  // Notes the parser couldn't read (problem channel told; resolved once the format is learnt).
  if (path === '/api/order-notes/misses' && method === 'GET') return json({ misses: await loadMisses(env.DB) });
  // The sweep by hand (owner/admin): picks up missed notes and runs the oldest waiting one.
  if (path === '/api/order-notes/sweep' && method === 'POST') return json({ result: await sweepNotes(env, { force: true }) });
  if (path === '/api/order-notes/auto-run' && method === 'POST') {
    const note = await loadNote(env.DB, String((await body())?.mid ?? ''));
    if (!note) throw new BadRequest('ไม่พบบรรทัดสรุปนี้');
    if (note.filled_at) throw new BadRequest('ใส่ไปแล้ว');
    const r = await autoFillNote(env, note, { force: true });
    await audit(env.DB, user, 'p365.auto_run', note.mid, r);
    return json(r);
  }
  // Which Claude models the shop's key/workspace accepts (tiny request each) — for the address reader's model choice.
  if (path === '/api/ai-check' && method === 'GET') {
    const models = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
    const out: Record<string, string> = {};
    for (const model of models) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json', ...((env as any).ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': (env as any).ANTHROPIC_WORKSPACE_ID } : {}) },
        body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: 'ok' }] }),
      });
      out[model] = `${r.status} ${(await r.text()).slice(0, 160)}`;
    }
    return json({ colo: (req as any).cf?.colo ?? null, out });
  }
  // The day's sales for Max (Log tab): customer, bill and stage live from Page365, totals.
  if (path === '/api/order-notes/sales' && method === 'GET') {
    const date = url.searchParams.get('date') ?? bkkDate(0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequest('วันที่ไม่ถูกต้อง');
    const notes = await loadNotes(env.DB, date);
    const day = await dayOrders(env, notes);
    // Once the day's file is uploaded: which notes became bills, which didn't, which bills have no note.
    const uploads = await loadUploads(env.DB, [date]);
    let recon = null;
    if (uploads.has(date)) {
      const around = [-1, 0, 1].map((d) => new Date(Date.parse(`${date}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10));
      const orders = await loadOrders(env.DB, around);
      const links = new Map(checkNotes(notes, orders).filter((c) => c.order_no).map((c) => [c.mid, String(c.order_no)]));
      for (const n of notes) if (n.fill_order_no) links.set(n.mid, String(n.fill_order_no)); // the bill the system filled wins
      recon = reconcile(day.rows, links, orders.filter((o) => o.date === date).map((o) => ({ order_no: o.order_no, total: o.total, created_at: o.created_at })));
    }
    return json({ date, ...day, recon });
  }
  if (path === '/api/order-notes/days' && method === 'GET') return json({ days: await noteDays(env.DB, 14) });
  if (path === '/api/order-notes' && method === 'GET') {
    const date = url.searchParams.get('date') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequest('วันที่ไม่ถูกต้อง');
    const around = [-1, 0, 1].map((d) => new Date(Date.parse(`${date}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10));
    const [notes, orders, uploads] = await Promise.all([loadNotes(env.DB, date), loadOrders(env.DB, around), loadUploads(env.DB, [date])]);
    const checks = checkNotes(notes, orders);
    const cat = await catalogFor(env.DB, checks.flatMap((c) => c.items.map((i) => i.code)));
    const linked = new Set(checks.map((c) => c.order_no).filter(Boolean));
    return json({ date, uploaded: uploads.has(date), orders: orders.filter((o) => o.date === date).length,
      orders_without_note: orders.filter((o) => o.date === date && !linked.has(o.order_no)).length, notes: withCatalog(checks, cat) });
  }
  if (path === '/api/p365/recredit' && method === 'POST') {
    const input = await body();
    const date = String(input?.date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequest('วันที่ไม่ถูกต้อง');
    const credits = await recreditDates(env.DB, [date]);
    await audit(env.DB, user, 'p365.recredit', date, credits);
    return json({ date, credits: credits[date] ?? null });
  }

  // ---- Discord bot: a test question with buttons ----
  if (path === '/api/goal' && method === 'GET') return json(await loadGoal(env));
  // A note from the owners to the deciders, posted by the bot (e.g. the plan summary for Max).
  if (path === '/api/discord/announce' && method === 'POST') {
    if (role !== 'owner') throw new BadRequest('เฉพาะเจ้าของเท่านั้น');
    const text = String((await body())?.text ?? '').trim();
    if (!text || text.length > 2000) throw new BadRequest('ข้อความต้องมี 1–2000 ตัวอักษร');
    if (!(await postToDeciders(env, (mention) => text.replaceAll('{mention}', mention || 'ทีม')))) throw new BadRequest('ส่งเข้า Discord ไม่สำเร็จ');
    await audit(env.DB, user, 'discord.announce', 'discord', { chars: text.length });
    return json({ ok: true });
  }
  if (path === '/api/post-ideas' && method === 'GET') return json(await buildPostIdeas(env));
  if (path === '/api/post-ideas/send' && method === 'POST') {
    const r = await sendPostIdeas(env);
    if (!r.sent) throw new BadRequest('ส่งเข้า Discord ไม่สำเร็จ — เช็กการตั้งค่าบอท');
    return json(r);
  }
  if (path === '/api/goal/scale-check' && method === 'POST') {
    const r = await scaleCheck(env);
    await audit(env.DB, user, 'goal.scale_check', 'shop', r);
    return json(r);
  }

  // The bot account itself (questions with buttons): picture via its own profile, name via its nickname in the server.
  if (path === '/api/discord/persona' && method === 'POST') {
    if (role !== 'owner') throw new BadRequest('เฉพาะเจ้าของเท่านั้น');
    if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_CHANNEL_ID || !env.ASSETS) throw new BadRequest('ยังตั้งค่าบอท Discord ไม่ครบ');
    const r = await setBotPersona(env);
    await audit(env.DB, user, 'discord.persona', 'discord', r);
    if (!r.avatar && !r.nick) throw new BadRequest(`Discord ไม่ยอม: ${r.error ?? '?'}`);
    return json(r);
  }
  if (path === '/api/discord/test' && method === 'POST') {
    if (!approvalsEnabled(env)) throw new BadRequest('ยังตั้งค่าบอท Discord ไม่ครบ (DISCORD_BOT_TOKEN / DISCORD_APP_PUBLIC_KEY / DISCORD_CHANNEL_ID)');
    if (url.searchParams.get('kind') === 'upload') {
      // The 10:00 reminder, sent now for yesterday whether or not the file is in (pressing "uploaded" still checks).
      if (!(await postUploadReminder(env, bkkDate(1), thaiDay(bkkDate(1))))) throw new BadRequest('ส่งเข้า Discord ไม่สำเร็จ');
      await audit(env.DB, user, 'p365.reminder_test', bkkDate(1), {});
      return json({ ok: true });
    }
    const p = { id: crypto.randomUUID(), created_at: new Date().toISOString(), kind: 'test', entity_id: 'test', entity_name: 'ข้อความทดสอบ (ไม่แตะแอดจริง)', rule_id: 'test',
      plan: `ทดสอบปุ่มโดย ${user}`, detail: '{}', status: 'pending', decided_by: null, decided_at: null, message_id: null } as unknown as Proposal;
    await saveProposals(env.DB, [p]);
    const id = await postProposal(env, p);
    if (!id) throw new BadRequest('ส่งเข้า Discord ไม่สำเร็จ — เช็กว่าบอทมีสิทธิ์ View Channel + Send Messages ในห้องนั้น และ token ถูกต้อง');
    await env.DB.prepare('UPDATE proposals SET message_id = ? WHERE id = ?').bind(id, p.id).run();
    return json({ ok: true });
  }

  // ---- Messenger webhook: who came from which ad ----
  if (path === '/api/webhook' && method === 'GET') return json(await webhookStatus(env, `${url.origin}/webhook/meta`));
  // Purchases to Meta from Page365 orders (worker/metaPurchases.ts): settings, what was sent, a manual / dry run.
  if (path === '/api/meta/purchases' && method === 'GET') {
    const [config, rows] = await Promise.all([loadCapi(env.DB), recentPurchases(env.DB)]);
    return json({ config, rows });
  }
  if (path === '/api/meta/purchases/config' && method === 'PUT') {
    if (role !== 'owner') throw new BadRequest('เฉพาะเจ้าของเท่านั้น');
    const cfg = await saveCapi(env.DB, await body()).catch((err) => { throw new BadRequest(err.message); });
    await audit(env.DB, user, 'meta.capi.config', cfg.mode, { dataset_id: cfg.dataset_id, live_from: cfg.live_from });
    return json(cfg);
  }
  // Per-day corrections to Meta's purchases (metaAdjust.ts): list, add from purchases we sent by mistake, remove a day.
  if (path === '/api/meta/adjustments' && method === 'GET') return json({ days: await adjustmentDays(env.DB) });
  if (path === '/api/meta/adjustments/from-sent' && method === 'POST') {
    if (role !== 'owner') throw new BadRequest('เฉพาะเจ้าของเท่านั้น');
    const input = await body();
    const from = String(input?.from ?? ''), to = String(input?.to ?? '');
    if (!Date.parse(from) || !Date.parse(to)) throw new BadRequest('ต้องมีช่วงเวลาที่ส่ง (from, to)');
    const r = await seedFromSent(env.DB, from, to, String(input?.reason ?? 'ส่งซ้ำโดยระบบ').slice(0, 100), user);
    const dates = (await adjustmentDays(env.DB)).map((d) => d.date);
    const credits = await recreditDates(env.DB, [...new Set(dates)]);
    await audit(env.DB, user, 'meta.adjust.seed', `${from}..${to}`, { ...r, credits });
    return json({ ...r, recredited: Object.keys(credits) });
  }
  // Lock / unlock a day's stored hourly purchases against re-fetching (when they were stored before Meta's numbers went wrong).
  if (path === '/api/meta/lock-hours' && method === 'GET') return json({ days: [...await lockedHourDays(env.DB)].sort() });
  if (path === '/api/meta/lock-hours' && method === 'PUT') {
    if (role !== 'owner') throw new BadRequest('เฉพาะเจ้าของเท่านั้น');
    const input = await body();
    const date = String(input?.date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequest('วันที่ไม่ถูกต้อง');
    if (input?.locked === false) await env.DB.prepare('DELETE FROM meta_capi WHERE key = ?').bind(`lock_hours:${date}`).run();
    else await env.DB.prepare('INSERT OR REPLACE INTO meta_capi (key, value) VALUES (?, ?)').bind(`lock_hours:${date}`, String(input?.reason ?? '').slice(0, 100) || user).run();
    await audit(env.DB, user, 'meta.lock_hours', date, { locked: input?.locked !== false });
    return json({ days: [...await lockedHourDays(env.DB)].sort() });
  }
  if (path === '/api/meta/adjustments' && method === 'DELETE') {
    if (role !== 'owner') throw new BadRequest('เฉพาะเจ้าของเท่านั้น');
    const date = url.searchParams.get('date') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequest('วันที่ไม่ถูกต้อง');
    await env.DB.prepare('DELETE FROM meta_adjustments WHERE date = ?').bind(date).run();
    const credits = await recreditDates(env.DB, [date]);
    await audit(env.DB, user, 'meta.adjust.delete', date, credits);
    return json({ ok: true });
  }
  // One bill, sent for real now (a person asked for it, e.g. the first bill of the new flow); refuses bills not sold yet or already sent.
  if (path === '/api/meta/purchases/send-one' && method === 'POST') {
    if (role !== 'owner') throw new BadRequest('เฉพาะเจ้าของเท่านั้น');
    const no = Number((await body())?.order_no);
    if (!Number.isInteger(no)) throw new BadRequest('เลขบิลไม่ถูกต้อง');
    const r = await sendOne(env, no).catch((err) => { throw new BadRequest(err.message); });
    await audit(env.DB, user, 'meta.capi.send_one', String(no), r);
    return json(r);
  }
  // Does a Purchase we send reach the ads? Meta's hourly purchases for a day now vs what we stored earlier (read-only).
  if (path === '/api/meta/compare-day' && method === 'GET') {
    const date = url.searchParams.get('date') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequest('วันที่ไม่ถูกต้อง');
    const now = await metaFor(env).hourlyConversions(date);
    const { results: stored } = await env.DB.prepare('SELECT campaign_id, SUM(purchases) purchases, SUM(value) value FROM conversion_hours WHERE date = ? GROUP BY campaign_id').bind(date).all<{ campaign_id: string; purchases: number; value: number }>();
    const fetched = await env.DB.prepare('SELECT fetched_at FROM conversion_days WHERE date = ?').bind(date).first<{ fetched_at: string }>();
    const sum = (xs: { purchases: number }[]) => xs.reduce((t, x) => t + Number(x.purchases), 0);
    const val = (xs: { value?: number; purchase_value?: number }[]) => xs.reduce((t, x) => t + Number(x.value ?? x.purchase_value ?? 0), 0);
    return json({ date, stored_at: fetched?.fetched_at ?? null, stored: { purchases: sum(stored), value: val(stored) }, meta_now: { purchases: sum(now), value: val(now as any) } });
  }
  // When a sale is sent: at the admin's note (default) or when the bill is sent. Preview = today's notes, nothing sent.
  if (path === '/api/meta/purchases/source' && method === 'GET') return json({ source: await captureSource(env.DB) });
  if (path === '/api/meta/purchases/source' && method === 'PUT') {
    if (role !== 'owner') throw new BadRequest('เฉพาะเจ้าของเท่านั้น');
    const source = (await body())?.source === 'bill' ? 'bill' : 'note';
    // Switching to "bill" starts its own clock: bills opened before it were already sent at the note.
    const prev = await captureSource(env.DB);
    const stmts = [env.DB.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('source', ?)").bind(source)];
    if (source !== prev) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('source_at', ?)").bind(new Date().toISOString()));
    await env.DB.batch(stmts);
    await audit(env.DB, user, 'meta.capi.source', source, {});
    return json({ source });
  }
  // Meta's purchases hour by hour vs the sales we sent (hourCheck.ts): a dry run — the Discord text is returned, never posted.
  // Page365 bill cards Meta counted as purchases (billCards.ts): GET = what would be subtracted (writes nothing);
  // PUT {on} (owner) switches the correction on/off — on writes the last 14 days at once, then 07:30 keeps it current.
  if (path === '/api/meta/card-correction' && method === 'GET') {
    const to = url.searchParams.get('to') ?? bkkDate(1), from = url.searchParams.get('from') ?? to;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new BadRequest('วันที่ไม่ถูกต้อง');
    const dates = windowDates(`range:${from}:${to}` as Window).slice(0, 14);
    const plans = [];
    for (const d of dates) plans.push(await cardCorrections(env.DB, d));
    return json({ on: await cardCorrectionOn(env.DB), plans });
  }
  if (path === '/api/meta/card-correction' && method === 'PUT') {
    if (role !== 'owner') throw new BadRequest('เฉพาะเจ้าของเท่านั้น');
    const on = Boolean((await body())?.on);
    await env.DB.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('card_correction', ?)").bind(on ? 'on' : 'off').run();
    let plans: Awaited<ReturnType<typeof applyCardCorrections>> = [];
    if (on) plans = await applyCardCorrections(env.DB, windowDates('last_14d'), user);
    else await env.DB.prepare("DELETE FROM meta_adjustments WHERE reason = ?").bind(CARD_REASON).run();
    await audit(env.DB, user, 'meta.card_correction', on ? 'on' : 'off', { purchases: plans.reduce((t, p) => t + p.purchases, 0) });
    return json({ on, plans });
  }
  if (path === '/api/meta/hour-check' && method === 'GET') {
    const to = url.searchParams.get('to') ?? bkkDate(1), from = url.searchParams.get('from') ?? to;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new BadRequest('วันที่ไม่ถูกต้อง');
    const dates = windowDates(`range:${from}:${to}` as Window).slice(0, 14);
    const days = await hourCheck(env.DB, metaFor(env), dates);
    return json({ posted: false, days: days.map((d) => ({ ...d, text: hourCheckText(d) })) });
  }
  if (path === '/api/meta/purchases/note-preview' && method === 'GET') {
    const date = url.searchParams.get('date') ?? bkkDate(0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequest('วันที่ไม่ถูกต้อง');
    const notes = await loadNotes(env.DB, date);
    const plan = await planNotePurchases(env.DB, notes);
    const sent = await env.DB.prepare("SELECT mid, status, detail FROM note_purchases WHERE at >= ? AND at < ?").bind(new Date(`${date}T00:00:00+07:00`).toISOString(), new Date(Date.parse(`${date}T00:00:00+07:00`) + 86_400_000).toISOString()).all<{ mid: string; status: string; detail: string | null }>();
    const st = new Map(sent.results.map((r) => [r.mid, r]));
    const text = new Map(notes.map((n) => [n.mid, n.text.replace(/\s+/g, ' ')]));
    return json({ date, source: await captureSource(env.DB), rows: plan.map((p) => ({ ...p, text: text.get(p.mid), status: st.get(p.mid)?.status ?? null, detail: st.get(p.mid)?.detail ?? null })) });
  }
  if (path === '/api/meta/purchases/sync' && method === 'POST') {
    const dry = url.searchParams.get('dry') === '1';
    if (!dry && role !== 'owner') throw new BadRequest('เฉพาะเจ้าของเท่านั้น');
    const r = await syncPurchases(env, { dry }).catch((err) => { throw new BadRequest(err.message); });
    if (!dry) await audit(env.DB, user, 'meta.capi.sync', r.mode, { sent: r.sent.length, error: r.error });
    return json(r);
  }
  // Datasets (pixels) the Meta token can see — the one linked to the Page receives purchases from chat orders.
  if (path === '/api/meta/datasets' && method === 'GET') {
    if (!env.META_ACCESS_TOKEN) throw new BadRequest('ยังไม่ได้ตั้ง META_ACCESS_TOKEN');
    const v = env.META_API_VERSION ?? 'v21.0';
    const get = async (p: string) => {
      const r = await fetch(`https://graph.facebook.com/${v}/${p}${p.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(env.META_ACCESS_TOKEN!)}`);
      const b: any = await r.json().catch(() => ({}));
      return b.error ? { error: b.error.message } : b;
    };
    const fields = 'id,name,last_fired_time,is_unavailable,owner_business{id,name}';
    const accounts = ['act_2149666808519411', 'act_822911542923398', 'act_3743524862582232', 'act_752083272582459'];
    const byAccount = await Promise.all(accounts.map(async (a) => ({ account: a, ...(await get(`${a}/adspixels?fields=${fields}`)) })));
    const businesses = await get('me/businesses?fields=id,name');
    const owned = await Promise.all(((businesses.data ?? []) as { id: string; name: string }[]).slice(0, 5).map(async (b) => ({ business: b.name, ...(await get(`${b.id}/owned_pixels?fields=${fields}`)) })));
    // The dataset Meta links to the Page for business messaging (GET /{page}/dataset with the page token).
    const pg = await pageOf(env).catch(() => null);
    const page = pg ? { page: pg.name, page_id: pg.id, ...(await fetch(`https://graph.facebook.com/${v}/${pg.id}/dataset?access_token=${encodeURIComponent(pg.token)}`).then((r) => r.json() as Promise<Record<string, unknown>>).catch((e) => ({ error: String(e) }))) } : null;
    return json({ page, byAccount, owned, businesses });
  }
  // ---- ห้องฝึก (docs/creative.md) ----
  if (path === '/api/studio/products/recommended' && method === 'GET') return json({ products: await studio.recommendedProducts(env.DB) });
  if (path === '/api/studio/products' && method === 'GET') return json({ products: await studio.listProducts(env.DB, url.searchParams.get('q') ?? '', false, Math.min(5000, Number(url.searchParams.get('limit')) || 300)) });
  if (path === '/api/studio/product-note' && method === 'PUT') { const b = await body(); await studio.saveProductNote(env.DB, b, user); await audit(env.DB, user, 'studio.note', String(b?.code ?? ''), {}); return json({ ok: true }); }
  if (path === '/api/studio/materials' && method === 'GET') {
    const [styles, examples, playbook] = await Promise.all([studio.listStyleCards(env.DB), studio.listExamples(env.DB), studio.currentPlaybook(env.DB)]);
    return json({ styles, examples, playbook, hooks: studio.HOOKS, reasons: studio.REASONS, ai: !!env.ANTHROPIC_API_KEY });
  }
  if (path === '/api/studio/style' && method === 'POST') { const id = await studio.saveStyleCard(env.DB, await body(), user); await audit(env.DB, user, 'studio.style', String(id), {}); return json({ id }); }
  if ((m = /^\/api\/studio\/style\/(\d+)$/.exec(path)) && method === 'DELETE') { await studio.deleteStyleCard(env.DB, Number(m[1])); await audit(env.DB, user, 'studio.style.delete', m[1], {}); return json({ ok: true }); }
  if (path === '/api/studio/style-ref' && method === 'POST') { const id = await studio.addStyleRef(env.DB, await req.formData().catch(() => { throw new BadRequest('อ่านไฟล์ไม่ได้'); }), user); return json({ id }); }
  if ((m = /^\/api\/studio\/style-ref\/(\d+)$/.exec(path)) && method === 'DELETE') { await env.DB.prepare('DELETE FROM style_refs WHERE id = ?').bind(Number(m[1])).run(); return json({ ok: true }); }
  if ((m = /^\/api\/studio\/picture\/(ref|cand)\/(\d+)$/.exec(path)) && method === 'GET') return studio.pictureResponse(env.DB, m[1] === 'ref' ? 'style_refs' : 'creative_candidates', Number(m[2]), url.searchParams.get('size') === 'full' ? 'full' : 'thumb');
  if (path === '/api/studio/example' && method === 'POST') { const id = await studio.addExample(env.DB, await body(), user); return json({ id }); }
  if ((m = /^\/api\/studio\/example\/(\d+)$/.exec(path)) && method === 'DELETE') { await env.DB.prepare('DELETE FROM caption_examples WHERE id = ?').bind(Number(m[1])).run(); return json({ ok: true }); }
  if (path === '/api/studio/playbook' && method === 'PUT') { const id = await studio.savePlaybook(env.DB, await body(), user); await audit(env.DB, user, 'studio.playbook', String(id), {}); return json({ id }); }
  if (path === '/api/studio/generate' && method === 'POST') {
    const b = await body();
    const r = await studio.generateCaptions(env, String(b?.code ?? ''), Number(b?.n ?? 6), user);
    await audit(env.DB, user, 'studio.generate', String(b?.code ?? ''), { batch: r.batch, n: r.candidates.length, ...r.tokens });
    return json(r);
  }
  if (path === '/api/studio/image-prompt' && method === 'GET') return json(await studio.learnedImagePrompt(env, url.searchParams.get('code') ?? '', Number(url.searchParams.get('style_id'))));
  if (path === '/api/studio/image' && method === 'POST') {
    const id = await studio.addImageCandidate(env.DB, await req.formData().catch(() => { throw new BadRequest('อ่านไฟล์ไม่ได้'); }), user);
    await audit(env.DB, user, 'studio.image', String(id), {});
    // The AI's look comes back with the upload; a failed check never loses the image.
    const check = env.ANTHROPIC_API_KEY ? await studio.checkImage(env, id).catch((err) => ({ error: String(err?.message ?? err) })) : null;
    return json({ id, check });
  }
  if ((m = /^\/api\/studio\/check-image\/(\d+)$/.exec(path)) && method === 'POST') return json({ check: await studio.checkImage(env, Number(m[1])) });
  if ((m = /^\/api\/studio\/candidate\/(\d+)$/.exec(path)) && method === 'DELETE') { await studio.rejectCandidate(env.DB, Number(m[1])); await audit(env.DB, user, 'studio.reject', m[1], {}); return json({ ok: true }); }
  if (path === '/api/studio/pair' && method === 'GET') return json({ pair: await studio.nextPair(env.DB, url.searchParams.get('kind') === 'image' ? 'image' : 'caption', user, url.searchParams.get('code') ?? undefined) });
  if (path === '/api/studio/judge' && method === 'POST') { await studio.judge(env.DB, await body(), user); return json({ ok: true }); }
  if (path === '/api/studio/stats' && method === 'GET') return json(await studio.stats(env.DB));
  if (path === '/api/studio/meta-posts' && method === 'GET') return json({ posts: await studio.listMetaPosts(env.DB) });
  if (path === '/api/studio/meta-posts/import' && method === 'POST') {
    const got = await metaFor(env).activeAdPosts();
    const r = { ...(await studio.importMetaPosts(env.DB, got.ads)), post_error: got.post_error };
    await studio.seedRealCaptions(env.DB).catch(() => 0);
    await studio.seedRealImages(env.DB).catch(() => 0);
    await audit(env.DB, user, 'studio.meta_import', 'meta_posts', r);
    return json(r);
  }
  if (path === '/api/studio/meta-posts/image' && method === 'POST') { await studio.saveMetaPostImage(env.DB, await req.formData().catch(() => { throw new BadRequest('อ่านไฟล์ไม่ได้'); })); return json({ ok: true }); }
  if (path === '/api/studio/meta-posts/code' && method === 'PUT') { await studio.setMetaPostCode(env.DB, await body()); return json({ ok: true }); }
  if (path === '/api/studio/meta-posts/picture' && method === 'GET') return studio.metaPostPicture(env.DB, url.searchParams.get('key') ?? '', url.searchParams.get('size') === 'full' ? 'full' : 'thumb');
  if (path === '/api/studio/analyze-posts' && method === 'POST') {
    const r = await studio.analyzePosts(env, user);
    await audit(env.DB, user, 'studio.analyze', String(r.playbook_id), { posts: r.posts, ...r.tokens });
    return json(r);
  }
  if (path === '/api/studio/playbook/pending' && method === 'GET') return json({ pending: await studio.pendingPlaybook(env.DB) });
  if ((m = /^\/api\/studio\/playbook\/(\d+)\/approve$/.exec(path)) && method === 'POST') { const b = await body(); await studio.approvePlaybook(env.DB, Number(m[1]), b?.text, user); await audit(env.DB, user, 'studio.playbook.approve', m[1], {}); return json({ ok: true }); }
  if (path === '/api/studio/seed-real' && method === 'POST') return json({ added: await studio.seedRealCaptions(env.DB) });
  if (path === '/api/studio/sets' && method === 'GET') return json({ sets: await studio.listSets(env.DB), ready: await studio.readyProducts(env.DB) });
  if (path === '/api/studio/passed' && method === 'GET') return json(await studio.passedFor(env.DB, url.searchParams.get('code') ?? ''));
  if (path === '/api/studio/sets' && method === 'POST') { const set = await studio.createSet(env, await body(), user); await audit(env.DB, user, 'studio.set', String(set.id), {}); return json({ set }); }
  if ((m = /^\/api\/studio\/sets\/(\d+)$/.exec(path)) && method === 'PUT') { const b = await body(); await studio.decideSet(env.DB, Number(m[1]), b?.status, user); await audit(env.DB, user, 'studio.set.decide', m[1], { status: b?.status }); return json({ ok: true }); }
  if (path === '/api/studio/image-tags' && method === 'GET') return json({ tags: await studio.imageTagStats(env.DB), dims: studio.IMAGE_TAGS });
  if (path === '/api/studio/meta-posts/tag' && method === 'POST') {
    const r = await studio.tagMetaPosts(env, url.searchParams.get('force') === '1');
    if (!r.left) {
      await studio.seedRealImages(env.DB).catch(() => 0);
      // Real pictures already in the room get the tags their post just got.
      await env.DB.prepare(`UPDATE creative_candidates SET tags = (SELECT p.tags FROM meta_posts p WHERE 'metaimg:' || p.key = creative_candidates.batch) WHERE kind = 'image' AND hook = 'real'`).run();
    }
    return json(r);
  }
  if ((m = /^\/api\/studio\/candidate\/(\d+)\/release$/.exec(path)) && method === 'POST') { await studio.releaseCandidate(env.DB, Number(m[1])); await audit(env.DB, user, 'studio.release', m[1], {}); return json({ ok: true }); }
  if (path === '/api/studio/candidates' && method === 'GET') return json({ candidates: await studio.listCandidates(env.DB, url.searchParams.get('code') ?? '', url.searchParams.get('kind') ?? undefined) });

  // ---- website feature requests from Discord (/ไอเดีย) ----
  if (path === '/api/requests' && method === 'GET') {
    // Opening the page also looks for Claude's PRs, so Benz hears about one without waiting for the 3-hourly sweep.
    await checkBuilds(env).catch((err) => console.error('request builds', err));
    return json({ items: await listRequests(env.DB), on: !!(env.DISCORD_REQUEST_CHANNEL_ID && env.DISCORD_BOT_TOKEN), build: buildEnabled(env) });
  }
  if (path === '/api/requests/picker' && method === 'POST') {
    if (role !== 'owner') throw new BadRequest('เฉพาะเจ้าของเท่านั้น');
    const r = await postPicker(env);
    await audit(env.DB, user, 'requests.picker', 'discord', r);
    return json(r);
  }
  if (path === '/api/requests/register' && method === 'POST') {
    if (role !== 'owner') throw new BadRequest('เฉพาะเจ้าของเท่านั้น');
    const r = await registerCommand(env);
    await audit(env.DB, user, 'requests.register', 'discord', r);
    return json(r);
  }
  // ---- answer bank for Meta's Business AI ----
  if (path === '/api/botkb' && method === 'GET') {
    const items = await listKb(env.DB);
    const rep = await env.DB.prepare(`SELECT target id, count(*) n, max(at) last FROM audit WHERE action = 'botkb.repeat' GROUP BY target`).all<{ id: string; n: number; last: string }>();
    return json({ items, repeats: Object.fromEntries(rep.results.map((r) => [r.id, { n: r.n, last: r.last }])), paste: kbPasteText(items.filter((x) => x.status === 'approved')), doc_live: await docLive(env) });
  }
  // The Google Doc Business AI reads (botKbDoc.ts). GET = switch + exactly what would be written (nothing sent).
  if (path === '/api/botkb/doc' && method === 'GET') {
    const s = await loadDocSettings(env.DB);
    return json({ ...s, has_key: !!env.GOOGLE_SA_KEY, sa_email: serviceEmail(env.GOOGLE_SA_KEY), live_now: await docLive(env), text: docText(await kbInBank(env.DB), thDate()) });
  }
  if (path === '/api/botkb/doc' && method === 'PUT') {
    if (role !== 'owner') throw new BadRequest('เฉพาะเจ้าของเท่านั้น');
    const b = (await body()) ?? {};
    const cur = await loadDocSettings(env.DB);
    const next = { doc_id: b.doc_id === undefined ? cur.doc_id : docIdFrom(String(b.doc_id)), live: b.live === undefined ? cur.live : b.live === true };
    if (b.doc_id !== undefined && String(b.doc_id).trim() && !next.doc_id) throw new BadRequest('ลิงก์ Google Doc ไม่ถูกต้อง');
    await saveDocSettings(env.DB, next);
    await audit(env.DB, user, 'botkb.doc_settings', 'settings', { before: cur, after: next });
    // Switching on writes the bank once, so the Doc matches it from the start.
    const sync = next.live && !cur.live ? await syncKbDoc(env, user) : null;
    return json({ ...next, sync });
  }
  if (path === '/api/botkb/doc/check' && method === 'POST') {
    try { return json(await checkDoc(env)); } catch (e) { throw new BadRequest((e as Error).message); }
  }
  if (path === '/api/botkb/doc/sync' && method === 'POST') {
    if (!(await docLive(env))) throw new BadRequest('ยังไม่ได้เปิดเขียน Google Doc');
    return json(await syncKbDoc(env, user));
  }
  if (path === '/api/botkb/remind-test' && method === 'POST') return json({ discord: await kbReminder(env, true) });
  if (path === '/api/botkb/applied' && method === 'POST') { const n = await markApplied(env.DB); await audit(env.DB, user, 'botkb.applied', 'bot_kb', { n }); return json({ applied: n }); }
  if (path === '/api/botkb/generate' && method === 'POST') return json(await kbRound(env, url.searchParams.get('mode') === 'faq' ? 'faq' : 'fix'));
  const kbe = /^\/api\/botkb\/(\d+)\/text$/.exec(path);
  if (kbe && method === 'PUT') {
    const b = (await body()) ?? {};
    const before = await env.DB.prepare('SELECT question, answer, rule FROM bot_kb WHERE id = ?').bind(Number(kbe[1])).first();
    const it = await editKb(env.DB, Number(kbe[1]), { question: String(b.question ?? ''), answer: String(b.answer ?? ''), rule: b.rule == null ? null : String(b.rule) }, user);
    if (!it) throw new BadRequest('ต้องมีทั้งคำถามและคำตอบ');
    await audit(env.DB, user, 'botkb.edit', String(it.id), { before, after: { question: it.question, answer: it.answer, rule: it.rule } });
    const live = await docLive(env);
    return json({ ...it, sync: live && (it.status === 'applied' || it.status === 'approved') ? await syncKbDoc(env, user) : null });
  }
  const kbm = /^\/api\/botkb\/(\d+)$/.exec(path);
  if (kbm && method === 'POST') {
    const st = String((await body())?.status ?? '');
    if (!['approved', 'rejected', 'proposed'].includes(st)) throw new BadRequest('status ต้องเป็น approved / rejected / proposed');
    const live = await docLive(env);
    const it = await setKbStatus(env.DB, Number(kbm[1]), st as 'approved', user, live);
    return json({ ...it, sync: live && it ? await syncKbDoc(env, user) : null });
  }
  if (path === '/api/chats/reredact' && method === 'POST') {
    if (role !== 'owner') throw new BadRequest('เฉพาะเจ้าของเท่านั้น');
    return json({ changed: await reRedactChats(env.DB) });
  }
  if (path === '/api/chats/insights' && method === 'POST') return json(await sendChatInsights(env, url.searchParams.get('scope') === 'today' ? 'today' : 'yesterday'));
  if (path === '/api/chats/report' && method === 'POST') return json(await sendChatReport(env, url.searchParams.get('scope') === 'yesterday' ? 'yesterday' : 'today'));
  // One test case through the real path (bot post + "จัดการจบแล้ว" button); its psid starts with TEST so it never blocks a customer.
  if (path === '/api/service/test' && method === 'POST') {
    if (!env.DISCORD_SERVICE_WEBHOOK_URL) throw new BadRequest('ยังไม่ได้ตั้ง DISCORD_SERVICE_WEBHOOK_URL');
    const at = new Date().toISOString();
    // The name is looked up for the latest real customer, so the test shows a name the way a real case would.
    const last = await env.DB.prepare('SELECT psid FROM chat_messages WHERE from_page = 0 ORDER BY at DESC LIMIT 1').first<{ psid: string }>();
    const posted = await serviceAlerts(env as any, [{ mid: `TEST-${at}`, psid: `TEST-${at}`, at, from_page: 0, text: '[ทดสอบระบบ] ส่งของผิดสีค่ะ', attachments: null, sender_app: null }],
      async () => (last ? customerName(env as any, last.psid) : null));
    return json({ posted });
  }
  if (path === '/api/service/preview' && method === 'GET') return json({ on: !!env.DISCORD_SERVICE_WEBHOOK_URL, cases: await servicePreview(env.DB, Math.min(30, Math.max(1, Number(url.searchParams.get('days') ?? 7)))) });
  if (path === '/api/chats/summary' && method === 'GET') return json(await chatSummary(env.DB, Math.min(30, Math.max(1, Number(url.searchParams.get('days') ?? 7)))));
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
  if (method === 'GET' && path === '/api/preview') {
    const be = url.searchParams.get('breakeven');
    return json(await preview(env, be === 'orders' || be === 'catalog' ? be : undefined));
  }
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

  // ---- product catalog (/catalog) ----
  // The page syncs tab by tab: list tabs → fetch each CSV through here → send back only the changed rows.
  if (method === 'GET' && path === '/api/catalog') return json(await catalogMeta(env.DB, (await loadSettings(env.DB)).sheet_id));
  if (method === 'PUT' && path === '/api/catalog/sheet') {
    const id = parseSheetId((await body())?.sheet);
    await saveCatalogSheetId(env.DB, id);
    await audit(env.DB, user, 'catalog.sheet', id.slice(0, 6) + '…', {});
    return json({ ok: true });
  }
  if (method === 'GET' && path === '/api/catalog/rows') {
    const tab = url.searchParams.get('tab') ?? '';
    if (!tab) throw new BadRequest('ไม่มีชื่อแท็บ');
    const page = await catalogRows(env.DB, tab, url.searchParams.get('after') ?? '', Number(url.searchParams.get('limit') ?? 0) || undefined);
    // `v` = catalog_version: the browser keeps the page until the next sync changes the version.
    const cache = url.searchParams.get('v') ? 'private, max-age=604800, immutable' : 'no-store';
    return new Response(JSON.stringify(page), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache } });
  }
  if (method === 'GET' && path === '/api/catalog/sheet') {
    const settings = await loadSettings(env.DB);
    const sheet = await catalogSheetId(env.DB, settings.sheet_id);
    if (!sheet) throw new BadRequest('ยังไม่ได้ใส่ลิงก์ Google Sheet SKU+Price ของแคตตาล็อก');
    return json({ tabs: await discoverTabs(sheet, settings.sheet_tabs) });
  }
  if (method === 'GET' && path === '/api/catalog/sheet/csv') {
    const sheet = await catalogSheetId(env.DB, (await loadSettings(env.DB)).sheet_id);
    if (!sheet) throw new BadRequest('ยังไม่ได้ใส่ลิงก์ Google Sheet SKU+Price ของแคตตาล็อก');
    return sheetCsv(sheet, url.searchParams.get('gid') ?? '');
  }
  if (method === 'POST' && path === '/api/catalog/sync') {
    const s = validateSync(await body());
    const result = await applySync(env.DB, s, user);
    if (s.done) await audit(env.DB, user, 'catalog.sync', s.tab, { skus: s.done.skus });
    return json(result);
  }
  // Product pictures: multipart upload (thumb + full, resized in the browser) or a link; key = tab|spu.
  if (method === 'GET' && path === '/api/catalog/image') {
    return imageResponse(env.DB, url.searchParams.get('key') ?? '', url.searchParams.get('size') === 'full' ? 'full' : 'thumb');
  }
  if (method === 'GET' && path === '/api/catalog/image-proxy') return proxyImage(url.searchParams.get('url') ?? '');
  if (method === 'POST' && path === '/api/catalog/image') {
    const isForm = (req.headers.get('Content-Type') ?? '').includes('multipart/form-data');
    const image = isForm
      ? await saveUploadedImage(env.DB, await req.formData().catch(() => { throw new BadRequest('อ่านไฟล์ไม่ได้'); }), user)
      : await saveImageLink(env.DB, await body(), user);
    await audit(env.DB, user, 'catalog.image', image.key, { uploaded: image.uploaded, bytes: image.bytes, url: image.url });
    return json({ image });
  }
  if (method === 'DELETE' && path === '/api/catalog/image') {
    const { key } = imageKey(url.searchParams.get('tab'), url.searchParams.get('spu'));
    if (!(await deleteImage(env.DB, key))) return json({ error: 'ไม่พบรูปที่เพิ่มไว้' }, 404);
    await audit(env.DB, user, 'catalog.image.delete', key, {});
    return json({ ok: true });
  }
  if (method === 'PUT' && path === '/api/catalog/alias') {
    const input = await body();
    const saved = await saveAlias(env.DB, input, user);
    await audit(env.DB, user, saved ? 'catalog.alias' : 'catalog.alias.delete', String(input?.alias ?? ''), saved ?? {});
    return json({ alias: saved });
  }
  if (method === 'PUT' && path === '/api/catalog/label') {
    const saved = await saveLabels(env.DB, await body(), user);
    await audit(env.DB, user, 'catalog.label', saved.map((s) => `${s.key}=${s.label}`).join(',') || 'clear', {});
    return json({ labels: saved });
  }
  if (method === 'PUT' && path === '/api/catalog/sell-price') {
    const saved = await savePrices(env.DB, await body(), user, 'catalog_sell_prices');
    await audit(env.DB, user, 'catalog.sell_price', saved.map((s) => `${s.key}=${s.price}`).join(',') || 'clear', {});
    return json({ prices: saved });
  }
  if (method === 'PUT' && path === '/api/catalog/price') {
    const saved = await savePrices(env.DB, await body(), user);
    await audit(env.DB, user, 'catalog.price', saved.map((s) => `${s.key}=${s.price}`).join(',') || 'clear', {});
    return json({ prices: saved });
  }
  if (method === 'PUT' && path === '/api/catalog/supplier') {
    const saved = await saveSuppliers(env.DB, await body(), user);
    await audit(env.DB, user, 'catalog.supplier', saved.map((s) => s.key).join(',') || 'clear', { shops: [...new Set(saved.map((s) => s.shop))] });
    return json({ suppliers: saved });
  }

  // ---- units sold per day (/catalog/sales) ----
  if (method === 'GET' && path === '/api/sales') {
    const { from, to } = parseRange(url.searchParams.get('from'), url.searchParams.get('to'));
    return json(await salesData(env.DB, from, to));
  }

  // ---- profit (/catalog/profit): marketplace money files + Page365 + Meta spend ----
  if (method === 'GET' && path === '/api/profit') {
    const { from, to } = parseRange(url.searchParams.get('from'), url.searchParams.get('to'));
    const settings = await loadSettings(env.DB);
    return json(await profitData(env.DB, from, to, settings.order_fees, () => dailySpend(env, from, to)));
  }
  if (path === '/api/ops-digest' && (method === 'GET' || method === 'POST')) {
    const d = url.searchParams.get('date');
    const date = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : bkkDate(1);
    // POST (owners/admins) posts it to #report now; GET only previews.
    if (method === 'POST') return json({ sent: await opsReport(env, date), date });
    const facts = await opsFacts(env.DB, date);
    return json({ text: opsText(facts), facts });
  }
  if (method === 'GET' && path === '/api/mp-import-maps') return json({ maps: await listImportMaps(env.DB) });
  if (method === 'PUT' && path === '/api/mp-import-map') {
    await saveImportMap(env.DB, await body(), user);
    return json({ ok: true });
  }
  if (method === 'PUT' && path === '/api/mp-orders') {
    const { file, orders } = validateMpOrders(await body());
    const saved = await saveMpOrders(env.DB, file, orders, user);
    await audit(env.DB, user, 'mp_orders.upload', file, { orders: saved, platforms: [...new Set(orders.map((o) => o.platform))] });
    return json({ saved });
  }

  // ---- order sheets (/catalog/orders) ----
  // ---- stock (/catalog/stock): พี่เปีย (cut by the order sheets) and GoSell (cut after a GoSell file) ----
  if (method === 'GET' && path === '/api/stock') return json(await stockData(env.DB));
  if (method === 'POST' && path === '/api/stock/moves') {
    const m = validateMoves(await body());
    if (m.kind === 'open' && role !== 'owner' && role !== 'admin') throw new BadRequest('ตั้งยอดเริ่มได้เฉพาะเจ้าของและผู้ดูแล');
    const saved = await saveMoves(env.DB, m, user);
    await audit(env.DB, user, `stock.${m.kind}`, m.loc, { date: m.date, note: m.note, items: m.items });
    return json({ saved });
  }
  if (method === 'DELETE' && path === '/api/stock/moves') {
    const id = Number(url.searchParams.get('id'));
    if (!(await deleteMove(env.DB, id))) return json({ error: 'ลบได้เฉพาะของเข้า ปรับยอด และยอดเริ่ม' }, 404);
    await audit(env.DB, user, 'stock.delete', String(id), {});
    return json({ ok: true });
  }
  if (method === 'POST' && path === '/api/stock/gosell') {
    const input = await body();
    const r = await gosellCut(env.DB, input, user);
    if (!input?.dry) await audit(env.DB, user, 'stock.gosell', String(input?.file ?? ''), r);
    return json(r);
  }

  if (method === 'GET' && path === '/api/purchase') return json({ uploads: await listPurchases(env.DB) });
  if (method === 'GET' && path === '/api/purchase/lines') {
    const id = url.searchParams.get('id') ?? '';
    const [lines, extra] = await Promise.all([purchaseLines(env.DB, id), purchaseExtra(env.DB, id)]);
    return json({ lines, extra });
  }
  if (method === 'PUT' && path === '/api/purchase') {
    const upload = await savePurchase(env.DB, validatePurchase(await body()), user);
    await syncRoundStock(env.DB, upload.id, user);
    await audit(env.DB, user, 'purchase.save', upload.id, { pieces: upload.pieces, review: upload.review, file: upload.file });
    return json({ upload });
  }
  if (method === 'PUT' && path === '/api/purchase/missing') {
    const m = validateMissing(await body());
    const result = await setMissing(env.DB, m);
    await syncRoundStock(env.DB, m.id, user);
    await audit(env.DB, user, 'purchase.missing', m.id, { items: m.items.slice(0, 50), total: result.missing });
    return json(result);
  }
  if (method === 'GET' && path === '/api/purchase/find') {
    const terms = orderTerms(url.searchParams.get('q') ?? '');
    return json({ terms, rows: await findOrders(env.DB, terms) });
  }
  if (method === 'GET' && path === '/api/purchase/ledger') {
    const id = url.searchParams.get('id') ?? undefined;
    const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 60) || 60, 1), 366);
    const since = new Date(Date.now() + 7 * 3600_000 - days * 86400_000).toISOString().slice(0, 10);
    return json({ since, rows: await ledger(env.DB, since, id) });
  }
  if (method === 'PUT' && path === '/api/purchase/payments') {
    const p = validatePayments(await body());
    await savePayments(env.DB, p, user);
    await audit(env.DB, user, 'purchase.payment', p.id, { items: p.items });
    return json({ ok: true });
  }
  if (method === 'DELETE' && path === '/api/purchase') {
    const id = url.searchParams.get('id') ?? '';
    if (!(await deletePurchase(env.DB, id))) return json({ error: 'ไม่พบใบสั่งนี้' }, 404);
    await syncRoundStock(env.DB, id, user);
    await audit(env.DB, user, 'purchase.delete', id, {});
    return json({ ok: true });
  }
  if (method === 'POST' && path === '/api/catalog/web') {
    const rows = await createWebSkus(env.DB, await body(), user);
    await audit(env.DB, user, 'catalog.web.create', rows.map((r) => r.sku).join(','), { tab: rows[0]?.tab, count: rows.length });
    return json({ rows });
  }
  if ((method === 'PUT' || method === 'DELETE') && path === '/api/catalog/web') {
    // SKU in the query: they may contain "/".
    const sku = url.searchParams.get('sku') ?? '';
    if (method === 'DELETE') {
      if (!(await deleteWebSku(env.DB, sku))) return json({ error: 'ไม่พบ SKU นี้' }, 404);
      await audit(env.DB, user, 'catalog.web.delete', sku, {});
      return json({ ok: true });
    }
    const row = await updateWebSku(env.DB, sku, await body());
    await audit(env.DB, user, 'catalog.web.update', sku, row);
    return json({ row });
  }

  // ---- costs ----
  // Costs typed into the dashboard (tab WEB). The code goes in the body/query: codes like "801/1" contain slashes.
  if (method === 'POST' && path === '/api/costs') {
    const c = validateWebCost(await body());
    const before = (await loadCostRows(env.DB)).find((x) => x.tab === WEB_TAB && x.code === c.code) ?? null;
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
    const costs = await loadCostRows(env.DB);
    const tab = url.searchParams.get('tab');
    if (tab) return json({ total: costs.length, results: await withCatalogCost(env.DB, costs.filter((c) => c.tab === tab).sort((a, b) => a.code.localeCompare(b.code))) });
    const suggest = url.searchParams.get('suggest');
    const hits = suggest
      ? suggestProducts(suggest, costs, 12)
      : costs.filter((c) => !q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)).slice(0, 40);
    // Typed costs first, then catalog codes (PK · 200 …) so a product line can link the catalog directly.
    const catalog = q && !suggest ? await searchCatalogCodes(env.DB, url.searchParams.get('q') ?? '') : [];
    return json({ total: costs.length, results: [...await withCatalogCost(env.DB, hits), ...catalog] });
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
    metaData(env, fresh), loadSections(env.DB), loadStages(env.DB), loadCampaignSettings(env.DB), loadCosts(env.DB), loadSettings(env.DB), lastRun(env.DB),
  ]);
  const windows = [...new Set<Window>([window, ECONOMICS_WINDOW])];
  // Meta insights, stored hourly purchases and the real Page365 orders don't depend on each other: fetch together.
  const actualDates = window === 'today' ? [] : windowDates(window);
  const [ccRaw, entities, tx, uploads, actualOrders] = await Promise.all([
    loadCampaignCosts(env.DB).then((r) => r.costs),
    withMetrics(data, [...windows.map((w) => ['campaign', w] as const), ['adset', window] as const]),
    // Order-by-order costing from stored hourly purchases (today's come live).
    txContext(env, data, window),
    loadUploads(env.DB, actualDates),
    loadOrders(env.DB, actualDates),
  ]);
  const campaignCosts = new CampaignCostIndex(ccRaw);
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
    // A campaign listed in the team's sheet sells its promos there, costed with the product's catalog ทุน + fees.
    const found = campaignCosts.find(c.name);
    const priced = tiersOf(c.id, c.name);
    const sheet = found && priced.source === 'sheet' && priced.tiers.length ? { name: found.cost.name, tiers: priced.tiers } : null;
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
      /** meta = estimated from Meta's tagged purchases; page365 = the real orders credited to this campaign */
      profit_source: 'meta' as 'meta' | 'page365',
      actual_orders: null as number | null,
      actual_revenue: null as number | null,
      adsets: adsetsOf(c.id).map(view),
    };
  });

  // Real orders (Page365 uploads) for the days in this window: the KPI card prefers these over the Meta estimate.
  let actual: null | { dates: number; covered: number; revenue: number; orders: number; units: number; cost: number; fees: number; gross: number; ads: number; net: number; organic_revenue: number; organic_orders: number } = null;
  if (actualDates.length) {
    const covered = actualDates.filter((d) => uploads.has(d));
    if (covered.length) {
      const os = actualOrders.filter((o) => covered.includes(o.date));
      const sum = (f: (o: typeof os[number]) => number) => os.reduce((n, o) => n + f(o), 0);
      const revenue = sum((o) => o.total), cost = sum((o) => o.cost ?? 0), fees = sum((o) => orderFees(o, settings.order_fees));
      // Every day uploaded: the window's campaign spend is the ad cost (no extra Meta call). Otherwise only the uploaded days' spend.
      let ads: number | null;
      if (covered.length === actualDates.length) {
        ads = entities.filter((e) => e.level === 'campaign').reduce((n, e) => n + (e.metrics[window]?.spend ?? 0), 0);
      } else {
        // Daily spend only for the span of uploaded days, not the whole window (a long window is many Meta pages).
        const span = `range:${covered[0]}:${covered[covered.length - 1]}` as Window;
        const daily = await data.dailyAll(span).catch(() => [] as Awaited<ReturnType<typeof data.dailyAll>>);
        ads = daily.length ? daily.filter((d) => covered.includes(d.date)).reduce((n, d) => n + d.spend, 0) : null;
      }
      const gross = revenue - cost - fees;
      actual = {
        dates: actualDates.length, covered: covered.length, revenue, orders: os.length, units: sum((o) => o.units), cost, fees, gross,
        ads: ads ?? 0, net: gross - (ads ?? 0),
        organic_revenue: sum((o) => (o.match === 'none' ? o.total : 0)), organic_orders: os.filter((o) => o.match === 'none').length,
      };
      if (ads === null) actual = null; // no daily spend to set against: keep the estimate rather than a half number
    }
  }

  // Every day of the window uploaded: each campaign's profit is the Page365 orders credited to it − their Page365 cost and
  // fees − the campaign's spend, not Meta's tags (Benz 2026-10-27: on 26 Oct Meta tagged 257 orders, Page365 had 109).
  // Orders no campaign fits ("ไม่ทราบแอด") stay out of the campaign rows; they are in the real KPI card.
  if (actual && actual.covered === actual.dates) {
    const real = actualByCampaign(actualOrders.filter((o) => uploads.has(o.date)), settings.order_fees);
    for (const c of campaigns) {
      const r = real.get(c.id) ?? { orders: 0, revenue: 0, cost: 0, fees: 0, units: 0 };
      const p = r.revenue - r.cost - r.fees - (c.metrics?.spend ?? 0);
      Object.assign(c, { profit: p, profit_high: p, units_low: r.units, units_high: r.units, profit_source: 'page365', actual_orders: r.orders, actual_revenue: r.revenue });
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
    settings: { dry_run: settings.dry_run, kill_switch: settings.kill_switch, guardrails: settings.guardrails, cod_share_pct: settings.cod_share_pct, cod_fee: settings.cod_fee, cod: codOf(settings) },
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

/** Stored cost rows (typed cost kept as is, for editing) plus the catalog ทุน the ads pages use instead, when found. */
async function withCatalogCost(db: D1Database, rows: CostRow[]) {
  const unit = await loadUnitCosts(db, rows);
  return rows.map((r, i) => ({ ...r, catalog_cost: unit[i].cost_from === 'catalog' ? unit[i].avg_cost : null, catalog_codes: unit[i].catalog_codes ?? [] }));
}

/** Product break-even per campaign, from 7-day numbers (same as the engine). */
function breakevens(entities: Entity[], sections: Section[], settings: Map<string, CampaignSetting>, costs: CostRow[], cod: Cod, campaignCosts: Map<string, CampaignCost>): Map<string, number | null> {
  const tiersOf = makeTierResolver({ entities, sections, campaignSettings: settings, costs, cod, campaignCosts });
  const sectionOf = sectionMap(entities, sections, settings);
  const totals = sectionTotals(entities, sectionOf, ECONOMICS_WINDOW);
  const zero = { spend: 0, purchases: 0, purchase_value: 0 };
  const out = new Map<string, number | null>();
  for (const c of entities) {
    if (c.level !== 'campaign') continue;
    const section = sections.find((s) => s.id === (sectionOf.get(c.id) ?? DEFAULT_SECTION_ID));
    const t = tiersOf(c.id, c.name);
    const r = t.source === 'sheet' && t.tiers.length ? tierEconomics(t.tiers, undefined).breakeven_roas : section ? campaignEconomics(section, costs, totals.get(section.id) ?? zero, cod, c.name).breakeven_roas : null;
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
  const windows = [...new Set<Window>([...STAT_WINDOWS, ECONOMICS_WINDOW])];
  const entities = await withMetrics(data, windows.map((w) => ['campaign', w] as const));
  const c = entities.find((e) => e.level === 'campaign' && e.id === id);
  if (!c) throw new BadRequest('ไม่พบแคมเปญ');
  const cod = codOf(settings);
  const sectionOf = sectionMap(entities, sections, campaignSettings);
  const section = sections.find((s) => s.id === (sectionOf.get(id) ?? DEFAULT_SECTION_ID));
  const totals7 = sectionTotals(entities, sectionOf, ECONOMICS_WINDOW);
  const econ = section ? campaignEconomics(section, costs, totals7.get(section.id) ?? { spend: 0, purchases: 0, purchase_value: 0 }, cod, c.name) : null;
  const priced = makeTierResolver({ entities, sections, campaignSettings, costs, cod, campaignCosts: (await loadCampaignCosts(env.DB)).costs })(c.id, c.name);
  const tiers = priced.tiers;
  const sheet = priced.source === 'sheet' && tiers.length ? { tiers } : null;
  const be = sheet ? tierEconomics(sheet.tiers, undefined).breakeven_roas : econ?.breakeven_roas;
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
  const cod = codOf(settings);
  const sectionOf = sectionMap(entities, sections, campaignSettings);
  const totals7 = sectionTotals(entities, sectionOf, ECONOMICS_WINDOW);
  const zero = { spend: 0, purchases: 0, purchase_value: 0 };
  const byId = new Map(entities.filter((e) => e.level === 'campaign').map((e) => [e.id, e]));
  const tiersOf = makeTierResolver({ entities, sections, campaignSettings, costs, cod, campaignCosts: cc.costs });
  const sourceCache = new Map<string, Parameters<typeof explainDay>[2]>();
  const sourceOf = (id: string, name: string): Parameters<typeof explainDay>[2] => {
    if (sourceCache.has(id)) return sourceCache.get(id)!;
    let src: Parameters<typeof explainDay>[2];
    const priced = tiersOf(id, name);
    if (priced.source === 'sheet' && priced.tiers.length) src = { kind: 'sheet', sheet_name: priced.label, tiers: priced.tiers };
    else {
      const section = sections.find((s) => s.id === (sectionOf.get(id) ?? DEFAULT_SECTION_ID));
      if (!section || section.id === DEFAULT_SECTION_ID && !section.products.length) src = { kind: 'none', reason: 'ไม่มีในชีตต้นทุน และยังไม่ผูกสินค้า' };
      else src = { kind: 'product', product: section.name, econ: campaignEconomics(section, costs, totals7.get(section.id) ?? zero, cod, name), extra: section.extra_cost_per_order, cod };
    }
    sourceCache.set(id, src);
    return src;
  };
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
  const be = breakevens(entities, sections, campaignSettings, costs, codOf(await loadSettings(env.DB)), (await loadCampaignCosts(env.DB)).costs);
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
async function preview(env: Env, breakevenSource?: BreakevenSource) {
  const [{ data }, settings, state] = await Promise.all([metaData(env), loadSettings(env.DB), loadState(env.DB)]);
  const entities: Entity[] = data.entities.map((e) => ({ ...e, metrics: {} }));
  const now = new Date();
  const { plan, breakevens } = await planRun(env.DB, entities, (level, w) => data.insights(level, w), state, now, (w) => data.dailyAll(w), breakevenSource);
  const [cs, be] = await Promise.all([loadCampaignSettings(env.DB), shopBreakeven(env.DB, settings, now)]);
  spaceIncreases(plan.decisions, entities, state, now, settings.guardrails.increase_gap_hours ?? INCREASE_GAP_HOURS, settings.guardrails.free_increase_below ?? FREE_INCREASE_BELOW);
  const winners = provenWinners(entities, cs, be, settings.guardrails.winner_max_daily_budget ?? WINNER_MAX_BUDGET);
  capChanges(plan);
  const noop = { setStatus: async () => {}, setDailyBudget: async () => {} };
  await applyDecisions(plan.decisions, entities, noop, settings.guardrails, { last_action: { ...state.last_action } }, { dryRun: true, now, maxBudgetFor: (id) => winners.get(id) });
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
    breakevens: breakevens ? [...breakevens].map(([campaign_id, b]) => ({ campaign_id, name: entities.find((e) => e.id === campaign_id)?.name ?? '', ...b })) : null,
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

/** 07:30 Discord note: yesterday's real numbers (Page365) when the file is in; the reminder waits until 10:00. */
/** Gives the Discord bot น้องอูนิ's picture (its profile) and name (nickname in the server of DISCORD_CHANNEL_ID). */
async function setBotPersona(env: Env): Promise<{ avatar: boolean; nick: boolean; error?: string }> {
  const api = (path: string, init?: RequestInit) => fetch(`https://discord.com/api/v10${path}`, { ...init, headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' } });
  const img = new Uint8Array(await (await env.ASSETS!.fetch(new Request('https://assets.local/uni.jpg'))).arrayBuffer());
  let bin = '';
  for (const b of img) bin += String.fromCharCode(b);
  const errors: string[] = [];
  const a = await api('/users/@me', { method: 'PATCH', body: JSON.stringify({ avatar: `data:image/jpeg;base64,${btoa(bin)}` }) });
  if (!a.ok) errors.push(`รูป ${a.status} ${(await a.text()).slice(0, 200)}`);
  const ch: any = await api(`/channels/${env.DISCORD_CHANNEL_ID}`).then((r) => r.json()).catch(() => ({}));
  let nick = false;
  if (ch.guild_id) {
    const n = await api(`/guilds/${ch.guild_id}/members/@me`, { method: 'PATCH', body: JSON.stringify({ nick: DISCORD_PERSONA.username }) });
    nick = n.ok;
    if (!n.ok) errors.push(`ชื่อ ${n.status} ${(await n.text()).slice(0, 200)}`);
  } else errors.push('หาเซิร์ฟเวอร์ของห้องไม่เจอ');
  return { avatar: a.ok, nick, ...(errors.length ? { error: errors.join(' · ') } : {}) };
}

/** อูนิ's chat report to #meta-chat: yesterday (07:30) or today so far (button). */
async function sendChatReport(env: Env, scope: 'yesterday' | 'today'): Promise<{ sent: boolean; threads: number }> {
  if (!env.DISCORD_CHAT_WEBHOOK_URL) throw new BadRequest('ยังไม่ได้ตั้ง DISCORD_CHAT_WEBHOOK_URL');
  const day = scope === 'yesterday' ? bkkDate(1) : bkkDate(0);
  const from = new Date(`${day}T00:00:00+07:00`).toISOString();
  const to = scope === 'yesterday' ? new Date(`${bkkDate(0)}T00:00:00+07:00`).toISOString() : new Date().toISOString();
  const d = await chatDay(env.DB, from, to);
  const names = new Map<string, string>();
  try { for (const e of (await metaData(env)).data.entities) if (e.level === 'campaign') names.set(e.id, e.name); } catch { /* names are a nicety */ }
  const thai = new Date(`${day}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });
  const title = scope === 'yesterday' ? `แชท ${thai}` : `แชทวันนี้ ${thai} ถึง ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })}`;
  const sent = await pushDiscord(chatDayText(d, title, (id) => (id ? names.get(id) ?? `แคมเปญ ${id}` : 'ไม่ระบุแอด')), env.DISCORD_CHAT_WEBHOOK_URL).catch(() => false);
  return { sent: !!sent, threads: d.threads };
}

/** Conversations in a window, customers who wrote first and longest first, each line labelled by who wrote it. */
async function loadConversations(env: Env, from: string, to: string): Promise<Conversation[]> {
  const [msgs, refs, notes] = await Promise.all([
    env.DB.prepare('SELECT psid, at, from_page, text, attachments, sender_app FROM chat_messages WHERE at >= ? AND at < ? ORDER BY at').bind(from, to).all<{ psid: string; at: string; from_page: number; text: string | null; attachments: string | null; sender_app: string | null }>(),
    env.DB.prepare('SELECT psid, campaign_id FROM ad_referrals WHERE at >= ? AND at < ? GROUP BY psid').bind(new Date(Date.parse(from) - 7 * 86_400_000).toISOString(), to).all<{ psid: string; campaign_id: string | null }>(),
    env.DB.prepare('SELECT DISTINCT psid FROM order_notes WHERE at >= ? AND at < ?').bind(from, to).all<{ psid: string }>().catch(() => ({ results: [] as { psid: string }[] })),
  ]);
  const names = new Map<string, string>();
  try { for (const e of (await metaData(env)).data.entities) if (e.level === 'campaign') names.set(e.id, e.name); } catch { /* names are a nicety */ }
  const campOf = new Map(refs.results.map((r) => [r.psid, r.campaign_id]));
  const ordered = new Set(notes.results.map((n) => n.psid));
  const convs = new Map<string, Conversation>();
  for (const m of msgs.results) {
    const c = convs.get(m.psid) ?? { psid: m.psid, campaign: (() => { const id = campOf.get(m.psid); return id ? names.get(id) ?? 'แอดอื่น' : null; })(), ordered: ordered.has(m.psid), messages: [] };
    c.messages.push({ ...m, who: speaker(m.from_page, m.sender_app, env) }); convs.set(m.psid, c);
  }
  return [...convs.values()].filter((c) => c.messages.some((m) => !m.from_page)).sort((a, b) => b.messages.length - a.messages.length);
}

/**
 * One round of the answer bank: 'fix' reads the chats since the last round (Mon/Thu) and posts each proposed fix to
 * Discord with buttons; 'faq' builds the first bank from every stored chat and asks for a review on /botkb.
 */
async function kbRound(env: Env, mode: 'fix' | 'faq'): Promise<{ proposed: number; repeats?: number; customers: number; input_tokens: number; output_tokens: number }> {
  if (!aiEnabled(env)) throw new BadRequest('ยังไม่ได้ตั้ง ANTHROPIC_API_KEY');
  const last = await env.DB.prepare(`SELECT max(at) at FROM audit WHERE action = 'botkb.round'`).first<{ at: string | null }>();
  const from = mode === 'faq' || !last?.at ? new Date(Date.now() - 30 * 86_400_000).toISOString() : last.at;
  const list = await loadConversations(env, from, new Date().toISOString());
  if (!list.length) return { proposed: 0, customers: 0, input_tokens: 0, output_tokens: 0 };
  const t = transcript(list);
  // Answers already in the bot before these chats: the AI reports the ones the bot still gets wrong.
  const fixed = mode === 'fix' ? await fixedBefore(env.DB, from) : [];
  const r = await proposeItems(env, mode, t.text, list.length, fixed);
  await audit(env.DB, 'ai', 'botkb.round', mode, { proposed: r.items.length, repeats: r.repeats.map((x) => x.ref), checked: fixed.length, customers: list.length, read: t.used, input_tokens: r.input_tokens, output_tokens: r.output_tokens });
  for (const x of r.repeats) await audit(env.DB, 'ai', 'botkb.repeat', String(x.ref), x);
  if (approvalsEnabled(env)) {
    const mention = idList(env.DISCORD_DECIDER_IDS).map((id) => `<@${id}>`).join(' ');
    if (mode === 'faq') {
      await postBot(env, { content: `📚 อูนิทำ **คลังคำตอบบอทชุดแรก ${r.items.length} ข้อ** จากแชทจริงแล้วค่ะ ${mention ? `คุณ ${mention} ` : ''}รบกวนตรวจและกดอนุมัติที่หน้า https://pkjeans-ads.ads-web.workers.dev/botkb นะคะ 🙏` }, true);
    } else if (r.items.length) {
      await postBot(env, { content: `🛠 อูนิตรวจคำตอบบอท Meta AI (${list.length} แชทตั้งแต่รอบก่อน) เจอ **${r.items.length} เรื่องที่ควรแก้** ค่ะ ${mention ? `คุณ ${mention} ` : ''}กดทีละข้อได้เลยนะคะ 🙏` }, true);
      for (const it of r.items) {
        const id = await postBot(env, kbMessage(it, ''));
        if (id) await env.DB.prepare('UPDATE bot_kb SET message_id = ? WHERE id = ?').bind(id, it.id).run();
      }
    }
    if (r.repeats.length) await postBot(env, { content: repeatsText(r.repeats, fixed) });
  }
  return { proposed: r.items.length, repeats: r.repeats.length, customers: list.length, input_tokens: r.input_tokens, output_tokens: r.output_tokens };
}

/** Monday 10:00 (and Tuesday again if still waiting): approved answers to paste into Business AI → tag the updater. */
async function kbReminder(env: Env, test = false): Promise<string | void> {
  const day = test ? 1 : new Date(Date.now() + 7 * 3_600_000).getUTCDay();
  if (day !== 1 && day !== 2) return;
  const n = (await env.DB.prepare(`SELECT count(*) n FROM bot_kb WHERE status = 'approved'`).first<{ n: number }>())?.n ?? 0;
  if ((!n && !test) || !approvalsEnabled(env)) return;
  if (await docLive(env)) return; // approvals go into the Google Doc by themselves; nobody pastes
  const ids = idList(env.DISCORD_KB_UPDATER_IDS).length ? idList(env.DISCORD_KB_UPDATER_IDS) : idList(env.DISCORD_DECIDER_IDS);
  const mention = ids.map((id) => `<@${id}>`).join(' ');
  return fetch(`https://discord.com/api/v10/channels/${env.DISCORD_CHAT_CHANNEL_ID || env.DISCORD_CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: `${test ? '🧪 **ข้อความทดสอบ** (หน้าตาการเตือนทุกวันจันทร์ 10:00)\n' : ''}📌 ${day === 2 ? 'อูนิเตือนอีกรอบค่ะ' : 'ถึงรอบอัปเดตบอทแล้วค่ะ'} คุณ ${mention || 'ทีม'} 🙏 มี **คำตอบที่แม็กซ์อนุมัติแล้ว ${n} ข้อ** รอใส่ในบอท Business AI\n1) เปิด https://pkjeans-ads.ads-web.workers.dev/botkb แล้วกด "คัดลอกทั้งหมด"\n2) Meta Business Suite → Business AI → วางในส่วนคำถาม-คำตอบ / คำแนะนำ\n3) กดปุ่ม **ใส่บอทแล้ว** ด้านล่าง น้องจะจดวันที่ไว้วัดผลค่ะ`,
      components: [{ type: 1, components: [{ type: 2, style: 3, label: '✅ ใส่บอทแล้ว', custom_id: 'kbapplied:all' }] }],
      allowed_mentions: { users: ids },
    }),
  }).then(async (res) => { if (res.ok) return 'ok'; const t = await res.text(); console.error('kb reminder', res.status, t); return `${res.status} ${t.slice(0, 200)}`; });
}

/**
 * The "✏️ แก้/อธิบายเพิ่ม" form. Edited text alone = approved as typed (into the Doc when live). With an explanation,
 * อูนิ rewrites the answer (an AI call, longer than Discord's 3 s, so the message is updated afterwards) and the
 * question is asked again with the new wording — one more ✅ puts it in the bot.
 */
async function kbFormSubmit(i: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const who = i.member?.user?.global_name || i.member?.user?.username || i.user?.username || 'ไม่ทราบชื่อ';
  const userId = String(i.member?.user?.id ?? i.user?.id ?? '');
  const approvers = idList(env.DISCORD_APPROVER_IDS);
  if (approvers.length && !approvers.includes(userId)) return json({ type: 4, data: { content: 'ปุ่มนี้ให้กดได้เฉพาะคุณเบ้นกับคุณแม็กซ์นะคะ 🙏', flags: 64 } });
  const id = Number(String(i.data.custom_id).slice(7));
  const it = await env.DB.prepare('SELECT * FROM bot_kb WHERE id = ?').bind(id).first<KbItem>();
  if (!it || it.status === 'applied' || it.status === 'rejected') return json({ type: 4, data: { content: 'ข้อนี้ตัดสินไปแล้วค่ะ', flags: 64 } });
  const v = modalValues(i.data);
  const draft = { answer: v.answer || it.answer, rule: v.rule || null };
  const extra = (v.extra ?? '').trim();
  if (!extra) {
    const saved = await editKb(env.DB, id, { question: it.question, ...draft }, `discord:${who}`);
    await audit(env.DB, `discord:${who}`, 'botkb.edit', String(id), { before: { answer: it.answer, rule: it.rule }, after: draft, via: 'discord' });
    const ok = await setKbStatus(env.DB, id, 'approved', `discord:${who}`);
    const live = await docLive(env);
    if (live) ctx.waitUntil(syncKbDoc(env, `discord:${who}`).catch(async (err) => {
      await postBot(env, { content: `⚠️ อูนิเขียนคำตอบ #${id} ลง Google Doc ไม่สำเร็จค่ะ: ${(err as Error).message}`.slice(0, 1900) });
    }));
    const m = kbMessage(ok ?? saved ?? it, '');
    return json({ type: 7, data: { content: `${m.content}\n✏️ **${who} แก้คำตอบแล้ว** ${live ? '✅ เข้าคลังและใส่บอทให้แล้วค่ะ (Google Doc)' : '✅ เข้าคลังคำตอบแล้วค่ะ'}`.slice(0, 2000), components: [] } });
  }
  // With an explanation (Benz 23 Oct: a press in Discord goes into the Doc, no second press): answer now (deferred),
  // rewrite, approve, write the Doc, then show the wording that went in with a button to take it back out.
  const token = String(i.token ?? '');
  ctx.waitUntil((async () => {
    const next = await rewriteKb(env, it, draft, extra);
    const saved = await editKb(env.DB, id, { question: it.question, ...next }, `discord:${who}`);
    await audit(env.DB, `discord:${who}`, 'botkb.explain', String(id), { extra, before: { answer: it.answer, rule: it.rule }, after: next });
    const ok = await setKbStatus(env.DB, id, 'approved', `discord:${who}`);
    const live = await docLive(env);
    if (live) await syncKbDoc(env, `discord:${who}`);
    const m = kbMessage(ok ?? saved ?? it, '');
    await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APP_ID}/${token}/messages/@original`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `${m.content}\n📝 **${who} อธิบายเพิ่ม:** ${extra}\n✅ อูนิเขียนคำตอบใหม่ตามนี้ ${live ? 'และใส่บอทให้แล้วค่ะ (Google Doc)' : 'และเข้าคลังแล้วค่ะ'}`.slice(0, 2000),
        components: [{ type: 1, components: [{ type: 2, style: 4, label: '↩️ เอาออกจากบอท', custom_id: `kbout:${id}` }] }],
      }),
    });
  })().catch(async (err) => {
    console.error('kb rewrite', err);
    await postBot(env, { content: `⚠️ อูนิเขียนคำตอบ #${id} ใหม่ไม่สำเร็จค่ะ: ${(err as Error).message} — แก้เองได้ที่ /botkb`.slice(0, 1900) });
  }));
  return json({ type: 6 });
}

const thDate = () => new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });

async function kbInBank(db: D1Database): Promise<KbItem[]> {
  return (await db.prepare(`SELECT * FROM bot_kb WHERE status IN ('approved','applied') ORDER BY id`).all<KbItem>()).results;
}

/** Rewrites the Google Doc from the bank and marks what it wrote as applied. Only when live (botKbDoc.ts). */
async function syncKbDoc(env: Env, who: string): Promise<{ written: boolean; items: number; applied: number }> {
  if (!(await docLive(env))) return { written: false, items: 0, applied: 0 };
  const items = await kbInBank(env.DB);
  await writeDoc(env, docText(items, thDate()));
  const applied = await markApplied(env.DB, items.filter((i) => i.status === 'approved').map((i) => i.id));
  await audit(env.DB, who, 'botkb.doc_write', 'bot_kb', { items: items.length, applied });
  return { written: true, items: items.length, applied };
}

/** อูนิ's AI read of a day's chats → #meta-chat. One model call per day; tokens are logged in audit. */
async function sendChatInsights(env: Env, scope: 'yesterday' | 'today'): Promise<{ sent: boolean; customers: number; read: number; input_tokens: number; output_tokens: number }> {
  if (!aiEnabled(env)) throw new BadRequest('ยังไม่ได้ตั้ง ANTHROPIC_API_KEY');
  if (!env.DISCORD_CHAT_WEBHOOK_URL) throw new BadRequest('ยังไม่ได้ตั้ง DISCORD_CHAT_WEBHOOK_URL');
  const day = scope === 'yesterday' ? bkkDate(1) : bkkDate(0);
  const from = new Date(`${day}T00:00:00+07:00`).toISOString();
  const to = scope === 'yesterday' ? new Date(`${bkkDate(0)}T00:00:00+07:00`).toISOString() : new Date().toISOString();
  const list = await loadConversations(env, from, to);
  const thai = new Date(`${day}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });
  if (!list.length) return { sent: false, customers: 0, read: 0, input_tokens: 0, output_tokens: 0 };
  const t = transcript(list);
  const ai = await askAI(env, INSIGHT_SYSTEM, insightPrompt(thai, t, list.length));
  // "บอทพลาด: N" is for counting, not for the team; stored with the read so the 7-day rate can be worked out.
  const be = botErrors(ai.text);
  const head = `🧠 **อูนิอ่านแชท ${scope === 'yesterday' ? thai : `วันนี้ ${thai} (ถึงตอนนี้)`}** · ${list.length} คน${t.used < list.length ? ` (อ่าน ${t.used})` : ''}\n`;
  await audit(env.DB, 'ai', 'chat.insights', day, { model: ai.model, input_tokens: ai.input_tokens, output_tokens: ai.output_tokens, customers: list.length, read: t.used, bot_errors: be.n, text: be.text.slice(0, 4000) }).catch(() => null);
  const rate = scope === 'yesterday' ? `\n${botRateText(await botErrorDays(env.DB, day), day)}` : '';
  const sent = await pushDiscord(head + be.text + citeKey(be.text, list.slice(0, t.used)) + rate, env.DISCORD_CHAT_WEBHOOK_URL).catch(() => false);
  return { sent: !!sent, customers: list.length, read: t.used, input_tokens: ai.input_tokens, output_tokens: ai.output_tokens };
}

/**
 * Bot mistakes per day for the last 14 days, from the AI reads (the latest read of each day). The count is over the
 * customers the AI actually read, so a day cut short by length doesn't look better than it was.
 */
async function botErrorDays(db: D1Database, today: string): Promise<{ day: string; errors: number; customers: number }[]> {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
  const { results } = await db.prepare(`SELECT target day, json_extract(detail, '$.bot_errors') errors, json_extract(detail, '$.read') customers FROM audit a
    WHERE action = 'chat.insights' AND target > ?1 AND target <= ?2 AND json_extract(detail, '$.bot_errors') IS NOT NULL
      AND at = (SELECT max(at) FROM audit b WHERE b.action = 'chat.insights' AND b.target = a.target)`).bind(from, today).all<{ day: string; errors: number; customers: number }>();
  return results;
}

async function dailyDigest(env: Env): Promise<void> {
  await salesDigest(env, bkkDate(1));
  if (env.DISCORD_WEBHOOK_URL) {
    const g = await loadGoal(env).catch(() => null);
    if (g) await pushDiscord(goalText(g), env.DISCORD_WEBHOOK_URL);
  }
  await opsReport(env, bkkDate(1)).catch((err) => console.error('ops report', err));
}

/** Back office (order sheets, units sold, marketplace money, owed to suppliers, unknown SKUs) → #report. */
async function opsReport(env: Env, date: string): Promise<boolean> {
  const hook = env.DISCORD_REPORT_WEBHOOK_URL || env.DISCORD_WEBHOOK_URL;
  if (!hook) return false;
  return !!(await pushDiscord(opsText(await opsFacts(env.DB, date)), hook));
}

/** Meta spend per day (all campaigns) for a range; Meta takes at most 31 days per call, so longer ranges are split. */
async function dailySpend(env: Env, from: string, to: string): Promise<{ date: string; spend: number }[]> {
  const { data } = await metaData(env);
  const spend = new Map<string, number>();
  for (let start = from; start <= to;) {
    const end = new Date(Math.min(Date.parse(to), Date.parse(start) + 30 * 86400_000)).toISOString().slice(0, 10);
    for (const r of await data.dailyAll(`range:${start}:${end}` as Window)) spend.set(r.date, (spend.get(r.date) ?? 0) + r.spend);
    start = new Date(Date.parse(end) + 86400_000).toISOString().slice(0, 10);
  }
  return [...spend].map(([date, s]) => ({ date, spend: Math.round(s * 100) / 100 })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Month-to-date real net vs the monthly goal, the MER the goal needs, and the last 7 days' real MER. */
async function loadGoal(env: Env): Promise<GoalStatus> {
  const yesterday = bkkDate(1);
  const { month, daysInMonth, dates } = monthDates(yesterday);
  const last7 = Array.from({ length: 7 }, (_, i) => bkkDate(i + 1));
  const all = [...new Set([...dates, ...last7])].sort();
  const [settings, uploads, orders] = await Promise.all([loadSettings(env.DB), loadUploads(env.DB, all), loadOrders(env.DB, all)]);
  // Spend per day from one Meta call over the whole span (cached; at most 31 days).
  const rows = uploads.size ? await (await metaData(env)).data.dailyAll(`range:${all[0]}:${yesterday}` as Window) : [];
  const spend = new Map<string, number>();
  for (const r of rows) spend.set(r.date, (spend.get(r.date) ?? 0) + r.spend);
  const byDate = new Map<string, typeof orders>();
  for (const o of orders) byDate.set(o.date, [...(byDate.get(o.date) ?? []), o]);
  const net = (d: string): DayNet => dayNet(d, byDate.get(d) ?? [], settings.order_fees, spend.get(d) ?? 0);
  return goalStatus(month, daysInMonth, dates, dates.filter((d) => uploads.has(d)).map(net), last7.filter((d) => uploads.has(d)).map(net), settings.goal);
}

function goalText(g: GoalStatus): string {
  const b = (x: number) => Math.round(x).toLocaleString('th-TH');
  const pct = g.goal.monthly_net ? Math.round((g.net / g.goal.monthly_net) * 100) : 0;
  const monthTh = new Date(`${g.month}-01T00:00:00+07:00`).toLocaleDateString('th-TH', { month: 'long', timeZone: 'Asia/Bangkok' });
  return [
    `🎯 **เป้ากำไร${monthTh} ${b(g.goal.monthly_net)}** · ได้แล้ว **${b(g.net)}** (${pct}%) จาก ${g.days.length} วันที่มีไฟล์${g.missing.length ? ` · ขาดไฟล์ ${g.missing.length} วัน` : ''}`,
    g.avg_net === null ? '' : `เฉลี่ยวันละ ${b(g.avg_net)} → คาดสิ้นเดือน **${b(g.projected ?? 0)}** · ต้องได้วันละ **${b(g.needed_per_day)}** ถึงจะทัน`,
    `MER จริง 7 วัน ${g.mer_7d === null ? '– (ไฟล์ไม่ครบ)' : `**${g.mer_7d.toFixed(2)}**`} (เป้า ≥ ${g.goal.scale_mer})${g.target_revenue_per_day ? ` · ต้องขายวันละ ~${b(g.target_revenue_per_day)} ที่ MER นี้` : ''}`,
  ].filter(Boolean).join('\n');
}

/** Product families from the last 14 days of real orders, with last-7-day spend and real revenue per campaign. */
async function buildPostIdeas(env: Env) {
  const days14 = Array.from({ length: 14 }, (_, i) => bkkDate(i + 1)), days7 = days14.slice(0, 7);
  const [settings, orders, { data }] = await Promise.all([loadSettings(env.DB), loadOrders(env.DB, days14), metaData(env)]);
  const ins = await data.insights('campaign', 'last_7d');
  const campaigns = data.entities.filter((e) => e.level === 'campaign').map((e) => ({ id: e.id, name: e.name, spend: ins.get(e.id)?.spend ?? 0 })).filter((c) => c.spend > 0);
  const uploaded = new Set(orders.map((o) => o.date)).size;
  const revenue = orders.reduce((t, o) => t + o.total, 0);
  const gross = orders.reduce((t, o) => t + o.total - (o.cost ?? 0) - orderFees(o, settings.order_fees), 0);
  const breakeven = revenue > 0 && gross > 0 ? revenue / gross : 2.8;
  const week = spendForUploadedDays(campaigns, days7, new Set(orders.map((o) => o.date)));
  const stats = familyStats(orders, settings.order_fees, week.campaigns, week.week);
  return { days: uploaded, breakeven, ideas: postIdeas(stats, breakeven, uploaded), families: stats.slice(0, 20) };
}

async function sendPostIdeas(env: Env): Promise<{ sent: boolean; ideas: number }> {
  const r = await buildPostIdeas(env);
  if (!r.days) return { sent: false, ideas: 0 };
  const sent = await postToDeciders(env, (mention) => postIdeasText(r.ideas, mention, r.days));
  return { sent, ideas: r.ideas.length };
}

/**
 * Today so far against the goal's daily pace. Today has no Page365 file yet, so revenue is Meta's tagged value
 * scaled by how real revenue compared to it over the last 7 uploaded days; net uses the month's gross margin.
 */
async function eveningPace(env: Env): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return;
  const g = await loadGoal(env);
  if (g.gross_margin === null) return;
  const { data } = await metaData(env);
  const [today, rows] = await Promise.all([data.insights('campaign', 'today'), data.dailyAll(`range:${bkkDate(7)}:${bkkDate(1)}` as Window)]);
  const spend = [...today.values()].reduce((t, m) => t + m.spend, 0);
  const tagged = [...today.values()].reduce((t, m) => t + m.purchase_value, 0);
  const real7 = g.days.filter((d) => d.date >= bkkDate(7));
  const metaOn = new Set(real7.map((d) => d.date));
  const meta7 = rows.filter((r) => metaOn.has(r.date)).reduce((t, r) => t + r.purchase_value, 0);
  const ratio = meta7 > 0 ? real7.reduce((t, d) => t + d.revenue, 0) / meta7 : 1;
  const revenue = tagged * ratio, net = revenue * g.gross_margin - spend;
  const need = g.needed_per_day, needRevenue = (need + spend) / g.gross_margin;
  const b = (x: number) => Math.round(x).toLocaleString('th-TH');
  await pushDiscord([
    `🎯 **วันนี้ถึง 20:00 เทียบเป้า** (ประมาณจากยอดแท็ก Meta × ${ratio.toFixed(2)} ตามของจริง 7 วัน)`,
    `ยอดขาย ~${b(revenue)} · ค่าแอด ${b(spend)} · กำไรสุทธิ ~**${b(net)}** · เป้าวันนี้ **${b(need)}** → ${net >= need ? `✅ เกินเป้า ${b(net - need)}` : `⚠️ ยังขาด ${b(need - net)} — ต้องขายรวมทั้งวัน ~${b(needRevenue)} (ชวนลูกค้าเพิ่มเป็นโปร 3 ตัวช่วยได้มากที่สุดค่ะ)`}`,
  ].join('\n'), env.DISCORD_WEBHOOK_URL);
}

/**
 * Weekly: real 7-day MER ≥ the goal's MER → ask in Discord to raise the shop-wide daily cap by goal.scale_pct;
 * below it → a note only. Nothing changes until someone presses the button.
 */
async function scaleCheck(env: Env): Promise<{ asked: boolean; reason: string }> {
  const [g, settings] = await Promise.all([loadGoal(env), loadSettings(env.DB)]);
  const cap = settings.guardrails.max_total_daily_budget;
  const say = async (reason: string, asked = false) => {
    if (!asked && env.DISCORD_WEBHOOK_URL) await pushDiscord(`📈 **เช็กขยายเพดานงบประจำสัปดาห์** — ${reason}`, env.DISCORD_WEBHOOK_URL).catch(() => false);
    return { asked, reason };
  };
  if (g.mer_7d === null) return say(`ไฟล์ Page365 7 วันล่าสุดมีแค่ ${g.mer_7d_days} วัน (ต้อง ≥ 6) — ยังไม่ขยาย เพดานคง ${cap.toLocaleString('th-TH')}`);
  if (g.mer_7d < g.goal.scale_mer) return say(`MER จริง 7 วัน ${g.mer_7d.toFixed(2)} ต่ำกว่าเกณฑ์ ${g.goal.scale_mer} — ยังไม่ขยาย เพดานคง ${cap.toLocaleString('th-TH')} · ให้กฎคุมความคุ้มก่อน`);
  if (!approvalsEnabled(env)) return say(`MER จริง 7 วัน ${g.mer_7d.toFixed(2)} ผ่านเกณฑ์ แต่ยังไม่ได้ตั้งบอท Discord — ขยายเองในหน้าตั้งค่า`);
  const now = new Date().toISOString();
  await expireOld(env, now, { capOnly: true }).catch(() => null);
  if ((await recentlyAsked(env.DB, new Date(Date.now() - 3 * 86_400_000).toISOString())).has('cap-up:shop')) return { asked: false, reason: 'ถามไปแล้ว รอคำตอบ' };
  const net7 = g.days.filter((d) => d.date >= bkkDate(7)).reduce((t, d) => t + d.net, 0);
  const p = { id: crypto.randomUUID(), created_at: now, kind: 'cap', entity_id: 'shop', entity_name: 'เพดานงบรวมต่อวัน', rule_id: 'cap-up',
    plan: `MER 7 วัน ${g.mer_7d.toFixed(2)} ≥ ${g.goal.scale_mer}`, detail: JSON.stringify({ from: cap, to: nextCap(cap, g.goal.scale_pct), pct: g.goal.scale_pct, mer: g.mer_7d, need: g.goal.scale_mer, net7 }),
    status: 'pending', decided_by: null, decided_at: null, message_id: null } as Proposal;
  await saveProposals(env.DB, [p]);
  const id = await postProposal(env, p);
  if (id) await env.DB.prepare('UPDATE proposals SET message_id = ? WHERE id = ?').bind(id, p.id).run();
  return { asked: !!id, reason: `MER จริง 7 วัน ${g.mer_7d.toFixed(2)} ผ่านเกณฑ์ — ถามใน Discord แล้ว (${cap} → ${nextCap(cap, g.goal.scale_pct)})` };
}

const thaiDay = (date: string) => new Date(`${date}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });

/** 10:00: yesterday's file still missing → tag the uploaders with buttons (bot), else a plain webhook note. */
async function uploadReminder(env: Env): Promise<void> {
  const date = bkkDate(1);
  if ((await loadUploads(env.DB, [date])).has(date)) return;
  if (approvalsEnabled(env) && await postUploadReminder(env, date, thaiDay(date))) return;
  if (env.DISCORD_WEBHOOK_URL) await pushDiscord(`📂 **${thaiDay(date)}** ยังไม่มีไฟล์ Page365 — รบกวน export ของเมื่อวานแล้วอัปโหลดที่หน้ายอดขายรายวันด้วยค่ะ`, env.DISCORD_WEBHOOK_URL);
}

/** One day's real numbers (Page365) to Discord; also sent the moment a file is uploaded. */
async function salesDigest(env: Env, date: string, remindIfMissing = false): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return;
  const thai = new Date(`${date}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });
  const [uploads, orders, settings] = await Promise.all([loadUploads(env.DB, [date]), loadOrders(env.DB, [date]), loadSettings(env.DB)]);
  if (!uploads.has(date)) {
    if (remindIfMissing) await pushDiscord(`📂 **${thai}** ยังไม่มีไฟล์ Page365 — เคน export ของเมื่อวานแล้วอัปโหลดที่หน้ายอดขายรายวันด้วยครับ`, env.DISCORD_WEBHOOK_URL);
    return;
  }
  const n = (f: (o: typeof orders[number]) => number) => orders.reduce((t, o) => t + f(o), 0);
  const revenue = n((o) => o.total), cost = n((o) => o.cost ?? 0), fees = n((o) => orderFees(o, settings.order_fees));
  const organic = orders.filter((o) => o.match === 'none');
  // Spend for that day. Meta (development tier) sometimes refuses a call; the message used to drop the ad cost
  // silently then, so the net looked missing. Now: yesterday direct, else the cached 30-day series, else say so.
  let ads: number | null = null;
  let adsError = '';
  const spendOf = (rows: { date: string; spend: number }[]) => { const day = rows.filter((d) => d.date === date); return day.length ? day.reduce((t, d) => t + d.spend, 0) : null; };
  if (date === bkkDate(1)) ads = await metaFor(env).dailyCampaignInsights('yesterday').then(spendOf).catch((err) => { adsError = String(err?.message ?? err); return null; });
  if (ads === null) ads = await metaData(env).then((m) => m.data.dailyAll('last_30d')).then(spendOf).catch((err) => { adsError = String(err?.message ?? err); return null; });
  const b = (x: number) => Math.round(x).toLocaleString('th-TH');
  const gross = revenue - cost - fees;
  const lines = [
    `📊 **ของจริง ${thai}** (Page365 ${orders.length} ออเดอร์)`,
    `ยอดขาย ${b(revenue)} · ทุนสินค้า ${b(cost)} (${revenue ? Math.round((cost / revenue) * 100) : 0}%) · ค่าใช้จ่ายต่อออเดอร์ ${b(fees)}`,
    `กำไรขั้นต้น **${b(gross)}**${ads === null ? '' : ` · ค่าแอด ${b(ads)} (${revenue ? Math.round((ads / revenue) * 100) : 0}% ของยอด) · กำไรสุทธิ **${b(gross - ads)}** · MER ${ads ? (revenue / ads).toFixed(2) : '–'}`}`,
    ...(ads === null ? [`⚠️ ยังไม่หักค่าแอด — ดึงค่าแอดของวันนี้จาก Meta ไม่ได้${adsError ? ` (${adsError.slice(0, 120)})` : ' (Meta ยังไม่มีตัวเลขวันนั้น)'} · ดูกำไรสุทธิที่หน้ายอดขายรายวันแทนค่ะ`] : []),
    `ไม่ใช่แอด ${organic.length} ออเดอร์ ${b(n((o) => (o.match === 'none' ? o.total : 0)))} (${orders.length ? Math.round((organic.length / orders.length) * 100) : 0}%) · จับคู่แอดได้ ${orders.length - organic.length}/${orders.length}`,
  ];
  await pushDiscord(lines.join('\n'), env.DISCORD_WEBHOOK_URL);
}

/**
 * A preset window, or a custom range "range:YYYY-MM-DD:YYYY-MM-DD" (Bangkok dates, like Ads Manager's picker):
 * at most 31 days (longer ones made the free-plan Worker time out), not in the future. Anything else falls back to 7 days.
 */
function parseView(w: string | null): Window {
  if (w && DASHBOARD_WINDOWS.includes(w as Window)) return w as Window;
  const m = w ? /^range:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(w) : null;
  if (m) {
    const [since, until] = m[1] <= m[2] ? [m[1], m[2]] : [m[2], m[1]];
    const days = (Date.parse(until) - Date.parse(since)) / 86_400_000;
    if (Number.isFinite(days) && days <= 30 && until <= bkkDate(0)) return `range:${since}:${until}` as Window;
  }
  return 'last_7d';
}

/**
 * Copies a winning campaign: checks the shop-wide cap and the ad count first, copies everything paused, sets the
 * copy's budget, then switches it on and puts it in the "testing" stage. Reports back by editing the question.
 */
async function copyWinner(env: Env, p: Proposal, who: string): Promise<void> {
  // A failed copy keeps a "try again" button (approvers only), e.g. after Meta refused it or the cap was full.
  const retry = [{ type: 1, components: [{ type: 2, style: 1, label: '🔁 ลองคัดลอกใหม่', custom_id: `dupretry:${p.id}` }] }];
  const done = async (status: string, content: string) => {
    await env.DB.prepare('UPDATE proposals SET status = ? WHERE id = ?').bind(status, p.id).run();
    if (p.message_id) await editMessage(env, p.message_id, content, status === 'failed' ? retry : []);
  };
  try {
    const meta = metaFor(env);
    const [settings, entities, objs] = await Promise.all([loadSettings(env.DB), meta.listEntities(), meta.copyObjects(p.entity_id)]);
    // The start budget is read now (Settings), not from the question, so a retry uses today's setting.
    const budget = Math.max(settings.guardrails.start_daily_budget ?? DUP_START_BUDGET, settings.guardrails.min_daily_budget);
    const total = sumBudget(entities), cap = settings.guardrails.max_total_daily_budget;
    if (total + budget > cap) return done('failed', `❌ คัดลอก "${p.entity_name}" ไม่ได้ค่ะ — งบรวมตอนนี้ ${total.toLocaleString('th-TH')} + ${budget} จะเกินเพดาน ${cap.toLocaleString('th-TH')} (ขยายเพดานก่อน หรือรอกฎลดตัวอื่น)`);
    const n = objs.adsets.length + objs.ads.length;
    // Each object is its own Meta call (twice: copy, then switch on); the free plan allows 50 per press.
    if (!objs.ads.length || n > MAX_COPY_OBJECTS) return done('failed', `❌ คัดลอก "${p.entity_name}" อัตโนมัติไม่ได้ค่ะ — ${objs.ads.length ? `มีชุดโฆษณา ${objs.adsets.length} + โฆษณา ${objs.ads.length} ที่เปิดอยู่ (เกิน ${MAX_COPY_OBJECTS})` : 'ไม่มีโฆษณาที่เปิดอยู่'} รบกวนคัดลอกใน Ads Manager แล้วตั้งงบ ${budget} นะคะ`);
    const copy = await meta.copyCampaign(p.entity_id, ' (คัดลอก)');
    await meta.setDailyBudget(copy.id, budget);
    await meta.setStatus(copy.id, 'ACTIVE');
    for (const id of copy.children) await meta.setStatus(id, 'ACTIVE');
    const at = new Date().toISOString();
    await applyMoves(env.DB, [{ campaign_id: copy.id, name: `${p.entity_name} (คัดลอก)`, from: null, to: 'testing' }], at);
    await audit(env.DB, `discord:${who}`, 'campaign.copy', p.entity_id, { copy: copy.id, budget, children: copy.children.length });
    await done('approved', `🧬 **คัดลอกแล้วค่ะ** "${p.entity_name}" → แคมเปญใหม่ "${p.entity_name} (คัดลอก)" (ชุดโฆษณา ${objs.adsets.length} · โฆษณา ${objs.ads.length}) งบเริ่ม **${budget}/วัน** เปิดแล้ว อยู่กลุ่มทดสอบ จะไต่ +20% ทุกรอบถ้ายังคุ้มทุน จนถึง ${DUP_RAMP_TO.toLocaleString('th-TH')} — ${who} อนุมัติ ขอบคุณค่ะ 🙏`);
  } catch (err: any) {
    await done('failed', `❌ คัดลอก "${p.entity_name}" ไม่สำเร็จค่ะ: ${err?.message ?? err} — ถ้ามีแคมเปญ "(คัดลอก)" ค้างอยู่ใน Ads Manager (หยุดอยู่) ลบก่อนแล้วกดลองใหม่ได้ค่ะ`);
  }
}

/** The reminder's buttons: "uploaded" is checked against the uploads table; "not yet" keeps the buttons. */
async function uploadButton(env: Env, verb: string, date: string, who: string): Promise<Response> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ type: 4, data: { content: 'ไม่รู้จักวันที่นี้ค่ะ', flags: 64 } });
  const thai = thaiDay(date);
  const up = await loadUploads(env.DB, [date]);
  await audit(env.DB, `discord:${who}`, `p365.${verb === 'p365later' ? 'later' : 'done'}`, date, { uploaded: up.has(date) }).catch(() => null);
  if (verb === 'p365later') {
    const ids = idList(env.DISCORD_UPLOADER_IDS);
    return json({ type: 7, data: uploadReminderMessage(date, thai, ids.map((id) => `<@${id}>`).join(' '), `⏳ ${who} รับทราบแล้ว จะอัปโหลดให้เร็วที่สุดค่ะ (${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })})`) });
  }
  if (!up.has(date)) return json({ type: 4, data: { content: `น้องยังไม่เจอไฟล์ของ **${thai}** ในระบบเลยค่ะ 🙏 อัปโหลดที่หน้ายอดขายรายวัน (กดยืนยันให้เสร็จ) แล้วค่อยกดใหม่นะคะ`, flags: 64 } });
  const n = (await loadOrders(env.DB, [date])).length;
  return json({ type: 7, data: { content: `✅ **ไฟล์ Page365 ของ ${thai} เข้าระบบแล้วค่ะ** (${n} ออเดอร์) — ${who} ยืนยัน ขอบคุณมากค่ะ 🙏 สรุปยอดของจริงอยู่ในข้อความถัดไปนะคะ`, components: [] } });
}

/**
 * A button pressed in Discord. Ping → pong (Discord checks the URL with it); a button → do what it says, reply
 * by editing the question so everyone sees who decided what. Signed with the app's Ed25519 key.
 */
async function discordInteraction(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await req.text();
  if (!env.DISCORD_APP_PUBLIC_KEY || !(await verifyDiscord(req, body, env.DISCORD_APP_PUBLIC_KEY))) return new Response('bad signature', { status: 401 });
  const i = JSON.parse(body);
  if (i.type === 1) return json({ type: 1 });
  const fr = await requestInteraction(i, env, ctx);
  if (fr) return fr;
  // "✏️ แก้/อธิบายเพิ่ม" form sent back (botKb.ts kbModal).
  if (i.type === 5 && String(i.data?.custom_id ?? '').startsWith('kbform:')) return kbFormSubmit(i, env, ctx);
  if (i.type !== 3) return json({ type: 4, data: { content: 'ยังไม่รองรับคำสั่งนี้', flags: 64 } });
  // The bot works in one channel only: a press from anywhere else is refused (only the presser sees the reply).
  const svc = String(i.data?.custom_id ?? '').startsWith('svcdone:');
  if (env.DISCORD_CHANNEL_ID && !svc && i.channel_id !== env.DISCORD_CHANNEL_ID && i.channel_id !== env.DISCORD_CHAT_CHANNEL_ID) return json({ type: 4, data: { content: 'บอทนี้ใช้ได้เฉพาะห้องรายงานแอด', flags: 64 } });
  const who = i.member?.user?.global_name || i.member?.user?.username || i.user?.username || 'ไม่ทราบชื่อ';
  // Only the listed people may decide (empty list = anyone in the channel); the refusal shows the presser their ID.
  const userId = String(i.member?.user?.id ?? i.user?.id ?? '');
  const approvers = idList(env.DISCORD_APPROVER_IDS);
  const [verb0, arg0] = String(i.data?.custom_id ?? '').split(':');
  if (verb0 === 'kbapplied') {
    const allowed = [...approvers, ...idList(env.DISCORD_KB_UPDATER_IDS)];
    if (allowed.length && !allowed.includes(userId)) return json({ type: 4, data: { content: `ปุ่มนี้สำหรับคนอัปเดตบอทค่ะ 🙏 (Discord ID ของคุณ: ${userId})`, flags: 64 } });
    const n = await markApplied(env.DB);
    await audit(env.DB, `discord:${who}`, 'botkb.applied', 'bot_kb', { n });
    return json({ type: 7, data: { content: `✅ **ใส่บอทแล้วค่ะ** ${n} ข้อ — ${who} อัปเดต ${new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' })} ขอบคุณค่ะ 🙏 น้องจะเทียบให้ว่าหลังแก้บอทตอบผิดน้อยลงไหมนะคะ`, components: [] } });
  }
  if (verb0 === 'svcdone') {
    // service ลูกค้า: Fear (or Benz/Max) closes the case; it must be a case posted in this channel.
    const allowed = [...approvers, ...idList(env.DISCORD_SERVICE_IDS)];
    if (allowed.length && !allowed.includes(userId)) return json({ type: 4, data: { content: `ปุ่มนี้สำหรับคนตอบลูกค้าค่ะ 🙏 (Discord ID ของคุณ: ${userId})`, flags: 64 } });
    const row = await env.DB.prepare('SELECT channel_id FROM service_cases WHERE id = ?').bind(Number(arg0)).first<{ channel_id: string | null }>();
    if (!row || row.channel_id !== i.channel_id) return json({ type: 4, data: { content: 'ไม่พบเคสนี้ในห้องนี้ค่ะ', flags: 64 } });
    const done = await closeCase(env.DB, Number(arg0), `discord:${who}`);
    const when = new Date().toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
    const before = String(i.message?.content ?? '').split('\n').filter((l: string) => !l.includes('จัดการจบแล้ว')).join('\n');
    return json({ type: 7, data: { content: `${before}\n${done ? `✅ **จัดการจบแล้ว** — ${who} · ${when}` : '✅ เคสนี้ปิดไปแล้วค่ะ'}`.slice(0, 2000), components: [] } });
  }
  if (verb0 === 'kbout') {
    // Takes an answer back out (after อูนิ's rewrite went in): rejected, and the Doc is rewritten without it.
    if (approvers.length && !approvers.includes(userId)) return json({ type: 4, data: { content: `ขอโทษค่ะ ปุ่มนี้ให้กดได้เฉพาะคุณเบ้นกับคุณแม็กซ์นะคะ 🙏 (Discord ID ของคุณ: ${userId})`, flags: 64 } });
    const it = await setKbStatus(env.DB, Number(arg0), 'rejected', `discord:${who}`, true);
    if (!it) return json({ type: 4, data: { content: 'ไม่พบข้อนี้แล้วค่ะ', flags: 64 } });
    if (await docLive(env)) ctx.waitUntil(syncKbDoc(env, `discord:${who}`).catch(async (err) => {
      await postBot(env, { content: `⚠️ อูนิเอา #${it.id} ออกจาก Google Doc ไม่สำเร็จค่ะ: ${(err as Error).message}`.slice(0, 1900) });
    }));
    const before = String(i.message?.content ?? '').split('\n').filter((l: string) => !l.startsWith('✅ อูนิเขียน')).join('\n');
    return json({ type: 7, data: { content: `${before}\n↩️ **เอาออกจากบอทแล้ว** — ${who} (แก้ใหม่ได้ที่ https://pkjeans-ads.ads-web.workers.dev/botkb)`.slice(0, 2000), components: [] } });
  }
  if (verb0 === 'kbedit') {
    if (approvers.length && !approvers.includes(userId)) return json({ type: 4, data: { content: `ขอโทษค่ะ ปุ่มนี้ให้กดได้เฉพาะคุณเบ้นกับคุณแม็กซ์นะคะ 🙏 (Discord ID ของคุณ: ${userId})`, flags: 64 } });
    const it = await env.DB.prepare('SELECT * FROM bot_kb WHERE id = ?').bind(Number(arg0)).first<KbItem>();
    if (!it || it.status === 'applied' || it.status === 'rejected') return json({ type: 4, data: { content: 'ข้อนี้ตัดสินไปแล้วค่ะ — แก้ต่อได้ที่ https://pkjeans-ads.ads-web.workers.dev/botkb', flags: 64 } });
    return json({ type: 9, data: kbModal(it) });
  }
  if (verb0 === 'kbok' || verb0 === 'kbno') {
    if (approvers.length && !approvers.includes(userId)) return json({ type: 4, data: { content: `ขอโทษค่ะ ปุ่มนี้ให้กดได้เฉพาะคุณเบ้นกับคุณแม็กซ์นะคะ 🙏 (Discord ID ของคุณ: ${userId})`, flags: 64 } });
    const it = await setKbStatus(env.DB, Number(arg0), verb0 === 'kbok' ? 'approved' : 'rejected', `discord:${who}`);
    if (!it) return json({ type: 7, data: { content: 'ข้อนี้ใส่บอทไปแล้ว หรือไม่พบแล้วค่ะ', components: [] } });
    const m = kbMessage(it, '');
    // Live Doc: write it now (after the reply — Discord wants an answer within 3 s); a failure is posted, not swallowed.
    const live = verb0 === 'kbok' && await docLive(env);
    if (live) ctx.waitUntil(syncKbDoc(env, `discord:${who}`).catch(async (err) => {
      console.error('botkb doc', err);
      await postBot(env, { content: `⚠️ อูนิเขียนคำตอบ #${it.id} ลง Google Doc ไม่สำเร็จค่ะ: ${(err as Error).message}`.slice(0, 1900) });
    }));
    return json({ type: 7, data: { content: `${m.content}\n${verb0 === 'kbok' ? (live ? '✅ **เข้าคลังและใส่บอทให้แล้วค่ะ** (Google Doc)' : '✅ **เข้าคลังคำตอบแล้วค่ะ**') : '❌ **ไม่ใช้ข้อนี้**'} — ${who}`, components: [] } });
  }
  if (verb0 === 'p365done' || verb0 === 'p365later') {
    const allowed = [...approvers, ...idList(env.DISCORD_UPLOADER_IDS)];
    if (allowed.length && !allowed.includes(userId)) return json({ type: 4, data: { content: `ปุ่มนี้สำหรับคนอัปโหลดไฟล์ Page365 ค่ะ 🙏 (Discord ID ของคุณ: ${userId})`, flags: 64 } });
    return uploadButton(env, verb0, arg0 ?? '', who);
  }
  if (approvers.length && !approvers.includes(userId)) return json({ type: 4, data: { content: `ขอโทษค่ะ ปุ่มนี้ให้กดได้เฉพาะคุณเบ้นกับคุณแม็กซ์นะคะ 🙏 (Discord ID ของคุณ: ${userId})`, flags: 64 } });
  const [verb, id] = String(i.data?.custom_id ?? '').split(':');
  const p = await env.DB.prepare('SELECT * FROM proposals WHERE id = ?').bind(id ?? '').first<Proposal>();
  const reply = (content: string) => json({ type: 7, data: { content, components: [] } });
  if (!p) return reply('ไม่พบคำถามนี้แล้ว');
  if (verb === 'dupretry' && p.kind === 'dup' && p.status === 'failed') {
    if ((await loadSettings(env.DB)).kill_switch) return json({ type: 4, data: { content: '⛔ ตอนนี้เปิด kill switch อยู่ (หน้าตั้งค่า) — น้องยังไม่ทำให้นะคะ', flags: 64 } });
    const at = new Date().toISOString();
    const claimed = await env.DB.prepare(`UPDATE proposals SET status = 'working', decided_by = ?, decided_at = ? WHERE id = ? AND status = 'failed'`).bind(who, at, p.id).run();
    if (!claimed.meta.changes) return reply('มีคนกดไปแล้วค่ะ');
    ctx.waitUntil(copyWinner(env, p, who).catch(() => null));
    return reply(`⏳ **น้องกำลังลองคัดลอกใหม่** "${p.entity_name}" ค่ะ — ${who} กด · เสร็จแล้วข้อความนี้จะเปลี่ยนนะคะ`);
  }
  if (p.status !== 'pending') return reply(`ตัดสินไปแล้ว (${p.status}) โดย ${p.decided_by ?? '-'}`);
  // Kill switch on: nothing that touches Meta or the spend cap; the question stays open for when it's switched off.
  if (blockedByKillSwitch(verb, p.kind) && (await loadSettings(env.DB)).kill_switch) {
    return json({ type: 4, data: { content: '⛔ ตอนนี้เปิด kill switch อยู่ (หน้าตั้งค่า) — น้องยังไม่ทำให้นะคะ ปิด kill switch แล้วกดใหม่ได้ค่ะ', flags: 64 } });
  }
  const at = new Date().toISOString();
  const d = JSON.parse(p.detail || '{}');
  const mark = (status: string) => env.DB.prepare('UPDATE proposals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = \'pending\'').bind(status, who, at, p.id).run();
  try {
    if (verb === 'approve' && p.kind === 'dup') {
      // Copying takes longer than Discord's 3-second reply window: claim it, answer now, finish in the background
      // and edit the question with the result.
      const claimed = await env.DB.prepare(`UPDATE proposals SET status = 'working', decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'`).bind(who, at, p.id).run();
      if (!claimed.meta.changes) return reply('มีคนกดไปแล้วค่ะ');
      ctx.waitUntil(copyWinner(env, p, who).catch(() => null));
      return reply(`⏳ **น้องกำลังคัดลอก** "${p.entity_name}" ค่ะ — ${who} อนุมัติ · เสร็จแล้วข้อความนี้จะเปลี่ยนนะคะ`);
    }
    if (verb === 'approve' && p.kind === 'cap') {
      const settings = await loadSettings(env.DB);
      if (settings.guardrails.max_total_daily_budget !== d.from) {
        await mark('expired');
        return reply(`เพดานงบเปลี่ยนไปแล้ว (ตอนนี้ ${settings.guardrails.max_total_daily_budget}) — คำถามนี้ไม่ใช้แล้วค่ะ`);
      }
      const next = { ...settings, guardrails: { ...settings.guardrails, max_total_daily_budget: d.to } };
      await saveSettings(env.DB, next);
      await mark('approved');
      await audit(env.DB, `discord:${who}`, 'settings.update', 'settings', { before: settings, after: next });
      return reply(`📈 **ขยายเพดานงบแล้วค่ะ** ${Number(d.from).toLocaleString('th-TH')} → **${Number(d.to).toLocaleString('th-TH')}** บาท/วัน — ${who} อนุมัติ ขอบคุณค่ะ 🙏 กฎจะค่อยๆ เพิ่มงบตัวที่ทำกำไรรอบละไม่เกิน 20% นะคะ`);
    }
    if ((p.kind as string) === 'test') {
      await mark(verb === 'approve' ? 'approved' : 'rejected');
      return reply(`✅ **อูนิได้รับแล้วค่ะ** — ${who} กด "${verb === 'approve' ? 'อนุมัติ' : verb === 'reject' ? 'ไม่' : 'ย้ายไปทดสอบ'}" · บอทพร้อมใช้งาน (ข้อความนี้เป็นการทดสอบ ไม่ได้แตะแอดจริง)`);
    }
    if (verb === 'approve' && p.kind === 'pause') {
      await metaFor(env).setStatus(p.entity_id, 'PAUSED');
      await patchCachedEntity(env.DB, p.entity_id, { status: 'PAUSED' }).catch(() => null);
      await mark('approved');
      await audit(env.DB, `discord:${who}`, 'entity.status', p.entity_id, { status: 'PAUSED', rule: p.rule_id, name: p.entity_name });
      return reply(`⏸ **หยุดแล้วค่ะ** "${p.entity_name}" — ${who} อนุมัติ ขอบคุณค่ะ 🙏\nเหตุผล: \`${p.rule_id}\` ${p.plan}`);
    }
    if (verb === 'approve' && p.kind === 'move') {
      await applyMoves(env.DB, [{ campaign_id: p.entity_id, name: p.entity_name, from: d.move_from ?? null, to: d.move_to }], at);
      await mark('approved');
      return reply(`↘ **ย้ายแล้วค่ะ** "${p.entity_name}" → ${d.move_to} — ${who} อนุมัติ ขอบคุณค่ะ 🙏`);
    }
    if (verb === 'totesting') {
      await applyMoves(env.DB, [{ campaign_id: p.entity_id, name: p.entity_name, from: d.move_from ?? null, to: 'testing' }], at);
      await mark('rejected');
      await audit(env.DB, `discord:${who}`, 'proposal.totesting', p.entity_id, { rule: p.rule_id });
      return reply(`🔵 **รับทราบค่ะ ไม่หยุด — ย้ายไปกลุ่มทดสอบแล้ว** "${p.entity_name}" — ${who} ตัดสิน · กฎกลุ่มทดสอบจะดูแลงบต่อนะคะ`);
    }
    if (verb === 'reject') {
      await mark('rejected');
      await audit(env.DB, `discord:${who}`, 'proposal.reject', p.entity_id, { rule: p.rule_id, kind: p.kind });
      if (p.kind === 'cap') return reply(`✋ **รับทราบค่ะ ยังไม่ขยายเพดานงบ** (คง ${Number(d.from).toLocaleString('th-TH')}) — ${who} ตัดสิน · สัปดาห์หน้าน้องจะเช็กใหม่นะคะ`);
      return reply(`✋ **รับทราบค่ะ ยังไม่${p.kind === 'pause' ? 'หยุด' : 'ย้าย'}** "${p.entity_name}" — ${who} ตัดสิน · น้องจะไม่ถามเรื่องนี้ซ้ำ 3 วันนะคะ`);
    }
  } catch (err: any) {
    await mark('failed');
    return reply(`❌ ทำไม่สำเร็จ: ${err?.message ?? err} — ลองทำเองใน Ads Manager`);
  }
  return reply('ไม่รู้จักปุ่มนี้');
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

/** One read-only statement: SELECT/WITH only, no word that writes (outside quotes), no second statement; ≤ 500 rows. */
export function readOnlySql(q: string): string {
  const sql = q.trim().replace(/;\s*$/, '');
  if (!sql) throw new BadRequest('ไม่มีคำสั่ง');
  if (sql.includes(';')) throw new BadRequest('ได้คำสั่งเดียว');
  if (!/^(select|with)\b/i.test(sql)) throw new BadRequest('SELECT / WITH เท่านั้น');
  if (/\b(insert|update|delete|replace|drop|alter|create|attach|detach|pragma|vacuum|reindex)\b/i.test(sql.replace(/'(?:[^']|'')*'/g, "''"))) {
    throw new BadRequest('คำสั่งนี้เขียนข้อมูลได้ — ไม่อนุญาต');
  }
  return `SELECT * FROM (${sql}) LIMIT 500`;
}

async function readOnlyQuery(db: D1Database, q: string): Promise<{ rows: unknown[]; rows_read: number }> {
  const r = await db.prepare(readOnlySql(q)).all();
  // BLOBs come back as long number arrays: show their size instead.
  const rows = r.results.map((row: any) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Array.isArray(v) ? `<blob ${v.length} bytes>` : v instanceof ArrayBuffer ? `<blob ${v.byteLength} bytes>` : v])));
  return { rows, rows_read: (r.meta as any)?.rows_read ?? 0 };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
