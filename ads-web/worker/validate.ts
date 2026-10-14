// Input validation for everything the dashboard can write. Throws BadRequest with a Thai message the UI shows as-is.

import type { Guardrails } from '../../ads-engine/src/types.ts';
import { WEB_TAB, type CampaignSetting, type Product, type Section, type Stage, type WebRule } from './model.ts';
import type { Settings } from './db.ts';

export class BadRequest extends Error {}

const LEVELS = ['campaign', 'adset'];
const WINDOWS = ['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d'];
const METRICS = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'frequency', 'purchases', 'cpa', 'roas', 'messages', 'cost_per_message'];
const OPS = ['>', '>=', '<', '<='];
const ACTIONS = ['pause', 'enable', 'budget_pct', 'notify', 'move'];
const MODES = ['stage', 'custom', 'off'];

function fail(msg: string): never {
  throw new BadRequest(msg);
}
function num(v: unknown, what: string, min = -Infinity, max = Infinity): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${what}: ต้องเป็นตัวเลข`);
  if (v < min || v > max) fail(`${what}: ต้องอยู่ระหว่าง ${min} ถึง ${max}`);
  return v;
}
function str(v: unknown, what: string, max = 200): string {
  if (typeof v !== 'string' || !v.trim()) fail(`${what}: ห้ามว่าง`);
  if (v.length > max) fail(`${what}: ยาวเกิน ${max} ตัวอักษร`);
  return v.trim();
}
function oneOf<T extends string>(v: unknown, list: string[], what: string): T {
  if (typeof v !== 'string' || !list.includes(v)) fail(`${what}: ค่าไม่ถูกต้อง (${String(v)})`);
  return v as T;
}

/** stageIds: valid targets for move rules */
export function validateRules(input: unknown, stageIds: string[]): WebRule[] {
  if (!Array.isArray(input)) fail('rules ต้องเป็นรายการ');
  if (input.length > 30) fail('กฎได้ไม่เกิน 30 ข้อต่อชุด');
  const ids = new Set<string>();
  return input.map((r: any, i) => {
    const where = `กฎข้อ ${i + 1}`;
    const id = str(r?.id, `${where} id`, 60);
    if (!/^[\w-]+$/.test(id)) fail(`${where}: id ใช้ได้แค่ a-z 0-9 - _`);
    if (ids.has(id)) fail(`${where}: id "${id}" ซ้ำ`);
    ids.add(id);
    const type = oneOf<WebRule['action']['type']>(r?.action?.type, ACTIONS, `${where} action`);
    let action: WebRule['action'];
    if (type === 'move') action = { type, to: oneOf(r.action.to, stageIds, `${where} ย้ายไปกลุ่ม`) };
    else if (type === 'budget_pct') action = { type, pct: num(r.action.pct, `${where} % งบ`, -90, 100) };
    else action = { type };
    const rule: WebRule = {
      id,
      description: typeof r.description === 'string' ? r.description.slice(0, 300) : undefined,
      level: oneOf(r.level, LEVELS, `${where} level`),
      window: oneOf(r.window, WINDOWS, `${where} window`),
      metric: oneOf(r.metric, METRICS, `${where} metric`),
      op: oneOf(r.op, OPS, `${where} op`),
      value: num(r.value, `${where} value`),
      value_mode: r.value_mode === 'x_breakeven' ? 'x_breakeven' : 'abs',
      action,
      enabled: r.enabled !== false,
    };
    if (rule.value_mode === 'x_breakeven' && rule.metric !== 'roas') fail(`${where}: "เท่าของจุดคุ้มทุน" ใช้ได้กับ ROAS เท่านั้น`);
    if (action.type === 'move' && rule.level !== 'campaign') fail(`${where}: ย้ายกลุ่มได้เฉพาะระดับแคมเปญ`);
    if (r.min_purchases !== undefined && r.min_purchases !== null) rule.min_purchases = num(r.min_purchases, `${where} ยอดซื้อขั้นต่ำ`, 0);
    if (action.type === 'move') rule.min_days_in_stage = num(r.min_days_in_stage ?? 0, `${where} อยู่ในกลุ่มขั้นต่ำ (วัน)`, 0, 90);
    if (r.min_spend !== undefined && r.min_spend !== null) rule.min_spend = num(r.min_spend, `${where} ใช้เงินขั้นต่ำ`, 0);
    if (r.cooldown_hours !== undefined && r.cooldown_hours !== null) rule.cooldown_hours = num(r.cooldown_hours, `${where} cooldown`, 1, 24 * 30);
    return rule;
  });
}

function validateProducts(input: unknown): Product[] {
  if (!Array.isArray(input)) fail('products ต้องเป็นรายการ');
  return input.slice(0, 50).map((p: any) => ({ tab: str(p?.tab, 'แท็บ', 20), code: str(p?.code, 'รหัสสินค้า', 60) }));
}

export function validateSection(id: string, input: any, existingSort: number): Section {
  const keywords = Array.isArray(input?.keywords) ? input.keywords.map((k: unknown) => String(k).trim()).filter(Boolean).slice(0, 20) : [];
  return {
    id,
    name: str(input?.name, 'ชื่อ section', 80),
    keywords,
    products: validateProducts(input?.products ?? []),
    tiers: validateTiers(input?.tiers ?? []),
    units_per_order: num(input?.units_per_order ?? 1, 'จำนวนตัวต่อออเดอร์', 0.1, 50),
    extra_cost_per_order: num(input?.extra_cost_per_order ?? 0, 'ค่าใช้จ่ายอื่นต่อออเดอร์', 0, 10000),
    price_per_order: input?.price_per_order === null || input?.price_per_order === undefined || input?.price_per_order === ''
      ? null
      : num(input.price_per_order, 'ราคาขายต่อออเดอร์', 1, 100000),
    sort: typeof input?.sort === 'number' ? input.sort : existingSort,
  };
}

function validateTiers(input: unknown): Section['tiers'] {
  if (!Array.isArray(input)) fail('โปรต้องเป็นรายการ');
  if (input.length > 10) fail('โปรได้ไม่เกิน 10 แบบ');
  const tiers = input.map((t: any) => ({ units: num(t?.units, 'จำนวนตัวในโปร', 1, 100), price: num(t?.price, 'ราคาโปร', 1, 100000) }));
  return tiers.sort((a, b) => a.units - b.units);
}

/** A cost typed into the dashboard: all-in cost per piece, optional full price per piece (0 = unknown). */
export function validateWebCost(input: any): { code: string; name: string; cost: number; price: number } {
  const code = str(input?.code, 'รหัสสินค้า', 60);
  return {
    code,
    name: input?.name ? str(input.name, 'ชื่อสินค้า', 120) : code,
    cost: num(input?.cost, 'ต้นทุนรวมต่อตัว', 0.01, 100000),
    price: input?.price === undefined || input?.price === null || input?.price === '' ? 0 : num(input.price, 'ราคาขายต่อตัว', 0, 100000),
  };
}

export function validateStage(existing: Stage, input: any, stageIds: string[]): Stage {
  const rules = validateRules(input?.rules ?? [], stageIds);
  if (rules.some((r) => r.action.type === 'move' && r.action.to === existing.id)) fail('กฎย้ายกลุ่มต้องย้ายไปกลุ่มอื่น');
  return {
    ...existing,
    name: str(input?.name, 'ชื่อกลุ่ม', 60),
    description: typeof input?.description === 'string' ? input.description.slice(0, 200) : existing.description,
    rules,
    automation: input?.automation !== false,
  };
}

/** stage_since is kept when the stage is unchanged, reset to now when it changes. */
export function validateCampaignSetting(campaignId: string, input: any, stageIds: string[], previous: CampaignSetting | undefined): CampaignSetting {
  const mode = oneOf<CampaignSetting['mode']>(input?.mode ?? 'stage', MODES, 'mode');
  const stage_id = input?.stage_id ? oneOf<string>(input.stage_id, stageIds, 'กลุ่ม') : null;
  const changed = stage_id !== (previous?.stage_id ?? null);
  return {
    campaign_id: campaignId,
    section_id: input?.section_id ? str(input.section_id, 'สินค้า', 60) : null,
    stage_id,
    stage_since: stage_id === null ? null : changed ? new Date().toISOString() : (previous?.stage_since ?? new Date().toISOString()),
    mode,
    rules: mode === 'custom' ? validateRules(input?.rules ?? [], stageIds) : null,
  };
}

function emails(list: unknown[]): string[] {
  const out = [...new Set(list.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  if (out.length > 50) fail('อีเมลได้ไม่เกิน 50 รายการ');
  for (const e of out) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail(`อีเมลไม่ถูกต้อง: ${e}`);
  return out;
}

/** Accepts a sheet id or a pasted Google Sheets link. */
function sheetId(v: string): string {
  const s = v.trim();
  if (!s) return '';
  const id = s.match(/\/spreadsheets\/d\/([\w-]{20,})/)?.[1] ?? s;
  if (!/^[\w-]{20,100}$/.test(id)) fail('Google Sheet ID ไม่ถูกต้อง');
  return id;
}

export function validateSettings(input: any, current: Settings): Settings {
  const g = input?.guardrails ?? current.guardrails;
  const guardrails: Guardrails = {
    max_change_pct_per_run: num(g.max_change_pct_per_run, 'เปลี่ยนงบสูงสุดต่อรอบ (%)', 1, 100),
    min_daily_budget: num(g.min_daily_budget, 'งบต่ำสุด/วัน', 1),
    max_daily_budget: num(g.max_daily_budget, 'งบสูงสุด/วัน', 1),
    max_total_daily_budget: num(g.max_total_daily_budget, 'งบรวมสูงสุด/วัน', 1),
  };
  if (guardrails.min_daily_budget > guardrails.max_daily_budget) fail('งบต่ำสุด/วัน ต้องไม่มากกว่างบสูงสุด/วัน');
  const tabs = Array.isArray(input?.sheet_tabs) ? input.sheet_tabs.map((t: unknown) => String(t).trim()).filter(Boolean) : current.sheet_tabs;
  if (tabs.length > 30) fail('แท็บได้ไม่เกิน 30 แท็บ');
  if (tabs.includes(WEB_TAB)) fail(`ชื่อแท็บ ${WEB_TAB} สงวนไว้สำหรับต้นทุนที่กรอกในเว็บ`);
  return {
    dry_run: typeof input?.dry_run === 'boolean' ? input.dry_run : current.dry_run,
    kill_switch: typeof input?.kill_switch === 'boolean' ? input.kill_switch : current.kill_switch,
    guardrails,
    sheet_id: input?.sheet_id ? str(input.sheet_id, 'Google Sheet ID', 100) : current.sheet_id,
    sheet_tabs: tabs,
    cod_share_pct: input?.cod_share_pct === undefined ? current.cod_share_pct : num(input.cod_share_pct, 'สัดส่วนเก็บปลายทาง (%)', 0, 100),
    cod_fee: input?.cod_fee === undefined ? current.cod_fee : num(input.cod_fee, 'ค่าเก็บปลายทางที่บวกเพิ่ม', 0, 1000),
    order_fees: input?.order_fees === undefined ? current.order_fees : {
      cod_pct: num(input.order_fees.cod_pct, 'ค่าธรรมเนียม COD (%)', 0, 100),
      loss_pct: num(input.order_fees.loss_pct, 'ของเสีย/สูญหาย (%)', 0, 100),
      ship: num(input.order_fees.ship, 'ค่าส่งต่อออเดอร์', 0, 1000),
      vat_pct: num(input.order_fees.vat_pct, 'VAT (%)', 0, 100),
      vat_base: input.order_fees.vat_base === 'goods' ? 'goods' : input.order_fees.vat_base === 'after_ship' ? 'after_ship' : 'total',
      bag: num(input.order_fees.bag, 'ค่าซองต่อออเดอร์', 0, 1000),
    },
    goal: input?.goal === undefined ? current.goal : {
      monthly_net: num(input.goal.monthly_net, 'เป้ากำไรสุทธิต่อเดือน', 0, 100_000_000),
      scale_mer: num(input.goal.scale_mer, 'MER ขั้นต่ำก่อนขยายเพดานงบ', 1, 50),
      scale_pct: num(input.goal.scale_pct, 'ขยายเพดานงบครั้งละ (%)', 1, 100),
    },
    ads_cost_sheet_id: typeof input?.ads_cost_sheet_id === 'string' ? sheetId(input.ads_cost_sheet_id) : current.ads_cost_sheet_id,
    // Tab names may end with a space (this one does), so it is kept as typed.
    ads_cost_tab: typeof input?.ads_cost_tab === 'string' && input.ads_cost_tab.trim() ? input.ads_cost_tab.slice(0, 100) : current.ads_cost_tab,
    cost_editors: Array.isArray(input?.cost_editors) ? emails(input.cost_editors) : current.cost_editors,
  };
}
