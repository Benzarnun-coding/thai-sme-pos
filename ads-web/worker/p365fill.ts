// Phase 1 of filling Page365 orders automatically: for one admin order note ("501/1/2 32 / cod 449"), find the
// customer's draft in Page365, look up each line's product + size there, and — only when a person presses the
// button and every check passes — put the items into the draft. The draft stays a draft: an admin still opens it
// in Page365 and presses "save and send" (that sends the bill to the customer), so nothing reaches a customer
// without a person.
//
// Page365 has no public API. This talks to the JSON endpoints its own web app uses, with a logged-in session
// cookie kept as the Worker secret P365_COOKIE (set by Benz from a low-rights admin account). Endpoints and
// request shapes were read from the app's code on 15 Oct 2026; if Page365 changes them, every call here fails
// safely (nothing half-written is left as "done", and the draft is untouched or only has items added).

import { addressLine, readAddress, type ChatMessage } from './addressReader.ts';
import { completeAddress } from './thaiAddress.ts';
import { parseOrderNote, type NoteItem } from './orderNotes.ts';

export interface P365Env { P365_COOKIE?: string; P365_PAGE_ID?: string }

const BASE = 'https://page365.net';
const PAGE = (env: P365Env) => env.P365_PAGE_ID ?? '115748303500549';
const COD_FEE = 50;

export class P365Error extends Error {
  kind: 'session' | 'api' | 'check';
  constructor(message: string, kind: 'session' | 'api' | 'check' = 'api') { super(message); this.kind = kind; }
}

export async function call<T>(env: P365Env, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!env.P365_COOKIE) throw new P365Error('ยังไม่ได้ตั้ง P365_COOKIE (ล็อกอิน Page365 ของบัญชีที่ให้ระบบใช้)', 'session');
  const res = await fetch(`${BASE}/${PAGE(env)}/${path}`, {
    method: init.method ?? 'GET',
    headers: { Cookie: env.P365_COOKIE, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    redirect: 'manual',
  });
  if (res.status === 401 || res.status === 302) throw new P365Error('ล็อกอิน Page365 หมดอายุ — ต้องตั้ง P365_COOKIE ใหม่', 'session');
  const text = await res.text();
  if (!res.ok) throw new P365Error(`Page365 ${init.method ?? 'GET'} ${path.split('?')[0]}: ${res.status} ${text.slice(0, 200)}`);
  try { return JSON.parse(text) as T; } catch { throw new P365Error(`Page365 ${path.split('?')[0]}: ตอบกลับไม่ใช่ JSON`); }
}

/** Is the stored session still logged in? */
export async function sessionStatus(env: P365Env): Promise<{ ok: boolean; error: string | null }> {
  try {
    await call(env, 'orders.json?page=1&stage=draft');
    return { ok: true, error: null };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

// ---- reading Page365 ----

interface ListOrder { id: number; no: number; created_at: string; stage: string }
interface Variant { id: number; name: string; code: string | null; price: number; available: number; stockable?: boolean }
export interface P365Order {
  id: number; no: number; stage: string; customer_fbid: string | null; conversation_id: number | null; created_at: string; cod: boolean;
  subtotal: number; total: number; shipping_cost: number | null; discount: number | null;
  customer_name: string | null; customer_phone: string | null; customer_address: string | null;
  structural_address: { street: string | null; subdistrict: string | null; district: string | null; province: string | null; postal_code: string | null } | null;
  items: { id: number; name: string; note: string | null; price: number; quantity: number; variant: { id: number; code: string | null; product_id: number } | null }[];
}

/** The customer's open draft: drafts created within 12 hours of the note, nearest first, checked one by one. */
export async function findDraft(env: P365Env, psid: string, at: string, maxChecks = 8): Promise<P365Order | null> {
  const list = await call<{ orders: ListOrder[] }>(env, 'orders.json?page=1&stage=draft');
  const t = Date.parse(at);
  const near = list.orders
    .filter((o) => o.stage === 'draft' && Math.abs(Date.parse(o.created_at) - t) <= 12 * 3_600_000)
    .sort((a, b) => Math.abs(Date.parse(a.created_at) - t) - Math.abs(Date.parse(b.created_at) - t))
    .slice(0, maxChecks);
  for (const o of near) {
    const full = await call<P365Order>(env, `orders/${o.id}.json`);
    if (full.customer_fbid === psid) return full;
  }
  return null;
}

/** Page365 product + size for one line: product whose name starts with the code, variant whose SKU ends with the size. */
async function findVariant(env: P365Env, it: NoteItem, cache: Map<string, { productId: number; variants: Variant[] } | null>): Promise<{ productId: number; variant: Variant | null; sizes: string[] } | null> {
  const key = it.code.toUpperCase();
  if (!cache.has(key)) {
    const found = await call<{ products: { id: number; name: string }[] }>(env, `products.json?for_browser=true&page=1&search=${encodeURIComponent(it.code)}`);
    const p = found.products.find((x) => x.name.trim().toUpperCase().split(/\s+/)[0] === key);
    if (!p) cache.set(key, null);
    else {
      const full = await call<{ id: number; variants: Variant[] }>(env, `products/${p.id}.json`);
      cache.set(key, { productId: p.id, variants: full.variants ?? [] });
    }
  }
  const prod = cache.get(key);
  if (!prod) return null;
  const v = prod.variants.find((x) => (x.code ?? '').toUpperCase().endsWith(`-${it.size}`) || x.name.replace(/\s+/g, '').toUpperCase() === `ไซส์${it.size}`);
  const sizes = prod.variants.map((x) => (x.code ?? '').split('-').pop() || x.name.replace(/\D/g, '')).filter(Boolean);
  return { productId: prod.productId, variant: v ?? null, sizes };
}

/** The customer's messages that mention a size ("เอว31ทุกตัว"), phone numbers and long numbers removed. */
export function sizeLines(messages: { own?: boolean; message?: string | null }[]): string[] {
  return messages
    .filter((m) => !m.own && m.message && /(เอว|ไซส์|ไซซ์|size|sz)\s*\d{2}|\b(2[4-9]|[34]\d)\b/i.test(m.message))
    .map((m) => m.message!.replace(/\+?\d[\d\s-]{7,}\d/g, '…').replace(/\s+/g, ' ').trim().slice(0, 120))
    .slice(-5);
}

/** The amount the chat agreed on: the last "ยอด/รวม … N" the shop wrote (Meta AI or an admin), not counting the order note. */
export function chatTotal(messages: ChatMessage[], until?: string): number | null {
  // Only this order's talk: after the shop's previous order note for this customer (a repeat customer's old
  // "ยอดรวม 398" is not today's price, 15 Oct), at most 2 days back, and up to 10 minutes after the note.
  let last: number | null = null;
  const end = until ? Date.parse(until) + 10 * 60_000 : Infinity;
  const start = until ? Date.parse(until) - 2 * 86_400_000 : -Infinity;
  const noteAt = until ? Date.parse(until) : Infinity;
  for (const m of messages) {
    const t = m.created_at ? Date.parse(m.created_at) : NaN;
    if (!Number.isNaN(t) && (t > end || t < start)) continue;
    if (m.own && m.message && parseOrderNote(m.message)) {
      if (Number.isNaN(t) || t < noteAt - 60_000) last = null; // an earlier order closed: start over
      continue;
    }
    if (!m.own || m.auto || !m.message) continue;
    for (const x of m.message.replace(/[*,]/g, '').matchAll(/(?:ยอดรวม|ยอดชำระ|ยอดโอน|รวมทั้งหมด|รวม|ยอด)[^\d\n]{0,25}(\d{3,5})(?!\d)/g)) {
      // Five-digit amounts are other things ("ยอดสั่งเกิน 15000", a postcode after รวม…), not a bill of jeans.
      if (Number(x[1]) < 10000) last = Number(x[1]);
    }
  }
  return last;
}

/** "PK-9349 สมชาย ใจดี": the warehouse of the first item, the order number's last 4 digits, the recipient (team convention). */
export function billName(no: number, firstSku: string | null, name: string): string {
  const wh = (firstSku ?? '').split('-')[1]?.toUpperCase() ?? '';
  const prefix = wh ? `${wh === 'CN' ? 'C' : wh}-${String(no).slice(-4)} ` : '';
  return `${prefix}${name.replace(/^[A-Z]{1,3}-\d{4}\s+/, '').trim()}`;
}

// ---- the plan ----

export interface PlanAddress { name: string; phone: string; street: string; subdistrict: string; district: string; province: string; postal_code: string; from_image: boolean; source: 'page365' | 'chat' }
export interface PlanLine { code: string; size: string; qty: number; product_id: number | null; variant_id: number | null; sku: string | null; price: number | null; available: number | null }
export interface FillPlan {
  order: { id: number; no: number; stage: string } | null;
  lines: PlanLine[];
  payment: 'cod' | 'transfer' | null;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number | null;
  /** the amount the chat agreed on, if the shop wrote one */
  chat_total: number | null;
  /** the bill's customer name as it will be ("PK-9349 …") */
  bill_name: string | null;
  /** the shipping address the bill will carry: Page365's own if complete, else read from the chat (text or photo) */
  address: PlanAddress | null;
  /** stop everything */
  problems: string[];
  /** how the note was read where it wasn't literal ("อ่าน E200 เป็น 200") */
  notes?: string[];
  /** fine for one bill after a look, but not for "fill all" */
  warnings: string[];
  /** the customer's own messages about size, when a line's size isn't made */
  said: string[];
}

export interface FillEnv extends P365Env { ANTHROPIC_API_KEY?: string; ANTHROPIC_WORKSPACE_ID?: string; ADDRESS_MODEL?: string }

/** Is the address Page365 already put on the draft complete and clean (it sometimes copies chat text into it)? */
function draftAddress(d: P365Order): PlanAddress | null {
  const s = d.structural_address;
  if (!s || !/^\d{5}$/.test(s.postal_code ?? '') || !s.province || !s.district || !/^0\d{8,9}$/.test((d.customer_phone ?? '').replace(/\D/g, ''))) return null;
  if (/ไซส์|เอว|ตัว|สี|ราคา|โปร|ปลายทาง|โอน|ค่ะ|ครับ|คับ/.test(s.street ?? '')) return null;
  // Page365 copies what the customer typed ("นม", "ปมุมธานี"); the address book corrects it, or sends it to the chat reader.
  const { parts, doubt } = completeAddress({ subdistrict: s.subdistrict ?? '', district: s.district ?? '', province: s.province ?? '', postal_code: s.postal_code ?? '' });
  if (doubt) return null;
  return { name: d.customer_name ?? '', phone: (d.customer_phone ?? '').replace(/\D/g, ''), street: s.street ?? '', ...parts, from_image: false, source: 'page365' };
}

/**
 * What would be put into the draft, and every reason not to. Prices are Page365's own variant prices; the gap to
 * the note's total goes into the bill's discount, the way the team writes promos (3 × 199 + 50 − 98 = 549). The
 * note's total must match what the chat agreed. The address comes from Page365 if complete, else from the chat.
 */
export async function planFill(env: FillEnv, note: { psid: string; at: string; text: string }, opts: { readAddress?: boolean; draft?: P365Order | null } = {}): Promise<FillPlan> {
  const parsed = parseOrderNote(note.text);
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!parsed) throw new P365Error('อ่านบรรทัดสรุปนี้ไม่ได้', 'check');
  if (parsed.unknown.length) problems.push(`อ่านไม่ออก: ${parsed.unknown.join(' / ')}`);
  const draft = opts.draft !== undefined ? opts.draft : await findDraft(env, note.psid, note.at);
  if (!draft) problems.push('ไม่เจอร่างบิลของลูกค้าคนนี้ใน Page365 (ยังไม่ได้เปิดร่าง หรือเปิดไปแล้ว)');
  else if (draft.items.length) problems.push(`ร่าง #${draft.no} มีสินค้าอยู่แล้ว ${draft.items.length} รายการ — ไม่ใส่ซ้ำ`);
  const chat = draft?.conversation_id ? (await call<{ messages: ChatMessage[] }>(env, `conversations/${draft.conversation_id}.json`).catch(() => null))?.messages ?? [] : [];

  const cache = new Map<string, { productId: number; variants: Variant[] } | null>();
  const lines: PlanLine[] = [];
  let missingSize = false;
  const notes: string[] = [];
  for (const it of parsed.items) {
    // "E200" when Page365's model is "200": a stray letter before a numeric code — tried without it, and said so.
    let found = await findVariant(env, it, cache);
    const bare = it.code.replace(/^[A-Z](?=\d+(?:[/-]\d+)*$)/i, '');
    if (!found && bare !== it.code) {
      found = await findVariant(env, { ...it, code: bare }, cache);
      if (found) notes.push(`อ่าน ${it.code} เป็น ${bare}`);
    }
    const hit = found?.variant ? { productId: found.productId, variant: found.variant } : null;
    if (!found) problems.push(`ไม่พบรุ่น ${it.code} ใน Page365`);
    else if (!hit) { problems.push(`${it.code} ไม่มีไซส์ ${it.size} — รุ่นนี้มี ${found.sizes.join(', ')} · ต้องถามลูกค้าใหม่`); missingSize = true; }
    else if (hit.variant.stockable !== false && hit.variant.available < it.qty) problems.push(`${hit.variant.code ?? it.code} เหลือ ${hit.variant.available} ตัว ไม่พอ ${it.qty}`);
    lines.push({ code: it.code, size: it.size, qty: it.qty, product_id: hit?.productId ?? null, variant_id: hit?.variant.id ?? null, sku: hit?.variant.code ?? null, price: hit?.variant.price ?? null, available: hit?.variant.available ?? null });
  }
  // A size that isn't made: show what the customer actually wrote about size, so the admin can ask them again.
  const said = missingSize ? sizeLines(chat) : [];
  const ids = lines.map((l) => l.product_id).filter((x) => x != null);
  if (new Set(ids).size !== ids.length) problems.push('มีรุ่นเดียวกันหลายไซส์ในใบเดียว — ตอนนี้ยังให้คนใส่เอง');

  const allFound = lines.every((l) => l.price != null);
  const subtotal = lines.reduce((t, l) => t + (l.price ?? 0) * l.qty, 0);
  const shipping = parsed.payment === 'cod' ? COD_FEE : 0;
  const total = parsed.total;
  const discount = total == null ? 0 : subtotal + shipping - total;
  if (total == null) problems.push('ไม่มียอดรวมในบรรทัดสรุป');
  else if (allFound && discount < 0) problems.push(`ยอด ${total} สูงกว่าราคาสินค้า + ค่าส่ง (${subtotal + shipping}) — ราคาไม่ตรงโปร`);
  // Promos at list price run to ~60% off (1 × 369 for 199 COD, 3 × 369 for 549); beyond 70% the total is likely mistyped.
  else if (allFound && discount > subtotal * 0.7) problems.push(`ส่วนลด ${discount} เกิน 70% ของราคาสินค้า — เช็กยอดอีกครั้ง`);
  else if (allFound && discount > 0 && discount < 20) warnings.push(`ส่วนลดแค่ ${discount} บาท — ยอดพิมพ์ผิดหรือเปล่า`);
  if (draft && draft.cod !== (parsed.payment === 'cod')) problems.push(`ร่างเป็น${draft.cod ? 'เก็บปลายทาง' : 'โอน'} แต่บรรทัดสรุปเป็น${parsed.payment === 'cod' ? 'ปลายทาง' : 'โอน'}`);

  // The price agreed in the chat wins: a note whose total differs (other than by the COD fee) is not filled.
  const chat_total = chatTotal(chat, note.at);
  if (total != null && chat_total != null && chat_total !== total && chat_total + shipping !== total) problems.push(`ในแชทตกลงยอด ${chat_total} แต่สรุปไว้ ${total} — เช็กกับลูกค้า/แอดมิน`);
  // No total written in the chat is fine: the admin's note is the trigger and its total is the price (Benz 15 Oct).

  // Address: Page365's own when complete, else read from the chat (typed or a photo).
  let address: PlanAddress | null = draft ? draftAddress(draft) : null;
  if (draft && !address) {
    if (opts.readAddress === false) warnings.push('ยังไม่ได้อ่านที่อยู่จากแชท');
    else if (!env.ANTHROPIC_API_KEY) warnings.push('ร่างยังไม่มีที่อยู่ครบ และยังไม่ได้ตั้ง ANTHROPIC_API_KEY ให้ระบบอ่านที่อยู่จากแชท — แอดมินกรอกเอง');
    else {
      const read = await readAddress(env.ANTHROPIC_API_KEY, chat, env.ADDRESS_MODEL, env.ANTHROPIC_WORKSPACE_ID).catch((err) => ({ problems: [`อ่านที่อยู่ไม่สำเร็จ: ${err?.message ?? err}`] } as { problems: string[] } & Partial<PlanAddress>));
      if (read.problems.length) warnings.push(...read.problems.map((p) => `ที่อยู่: ${p}`));
      // A doubt alone (a name, a house number) doesn't keep the address off the bill: whatever is complete
      // enough to ship goes in, and the doubt goes to a person to check (Benz 15 Oct, bill #29372).
      address = validAddress({ ...read, name: read.name || draft.customer_name || '', source: 'chat' });
    }
  }
  const bill_name = draft ? billName(draft.no, lines[0]?.sku ?? null, address?.name || draft.customer_name || '') : null;
  return { order: draft ? { id: draft.id, no: draft.no, stage: draft.stage } : null, lines, payment: parsed.payment, subtotal, shipping, discount: Math.max(0, discount), total, chat_total, bill_name, address, problems, warnings, said, notes };
}

/** A checked address from the screen (the admin may have corrected it), or null. */
export function validAddress(a: unknown): PlanAddress | null {
  if (!a || typeof a !== 'object') return null;
  const x = a as Record<string, unknown>;
  const str = (k: string) => (typeof x[k] === 'string' ? (x[k] as string).trim().slice(0, 200) : '');
  const out: PlanAddress = { name: str('name'), phone: str('phone').replace(/\D/g, ''), street: str('street'), subdistrict: str('subdistrict'), district: str('district'), province: str('province'), postal_code: str('postal_code'), from_image: x.from_image === true, source: x.source === 'page365' ? 'page365' : 'chat' };
  if (!/^\d{5}$/.test(out.postal_code) || !/^0\d{8,9}$/.test(out.phone) || !out.province || !out.district || !out.street) return null;
  return out;
}

/**
 * Puts the planned items, shipping, discount, name and address into the draft (still a draft afterwards), then
 * reads it back and checks the items and total. `address` is what the admin saw (and may have corrected) on screen;
 * without it the address is read again. Warnings don't stop a single fill — the person has seen them.
 */
export async function applyFill(env: FillEnv, note: { psid: string; at: string; text: string }, opts: { address?: unknown; allowWarnings?: boolean; plan?: FillPlan } = {}): Promise<{ plan: FillPlan; order: P365Order }> {
  const given = validAddress(opts.address);
  const plan = opts.plan ?? await planFill(env, note, { readAddress: !given });
  if (given) plan.address = given;
  if (plan.problems.length || !plan.order) throw new P365Error(plan.problems.join(' · ') || 'ไม่เจอร่างบิล', 'check');
  const warnings = plan.warnings.filter((w) => !(given && w.startsWith('ยังไม่ได้อ่านที่อยู่')));
  if (warnings.length && !opts.allowWarnings) throw new P365Error(warnings.join(' · '), 'check');
  const orderId = plan.order.id;

  // 1. Add one item per line (Page365 adds each product with its first size)…
  await call(env, 'order_items.json', { method: 'POST', body: { order_id: orderId, product_ids: plan.lines.map((l) => l.product_id) } });
  const added = await call<P365Order>(env, `orders/${orderId}.json`);
  if (added.items.length !== plan.lines.length) throw new P365Error(`ใส่สินค้าแล้วได้ ${added.items.length} รายการ แทนที่จะเป็น ${plan.lines.length} — เปิดร่าง #${plan.order.no} ใน Page365 เพื่อแก้เอง`);

  // 2. …then set each item's size, price and quantity, the shipping fee, the promo discount, the bill name and the
  // address, as the app's own "save" does (order fields not sent stay as they are).
  const pool = [...added.items];
  const items = plan.lines.map((l) => {
    const i = pool.findIndex((x) => x.variant?.product_id === l.product_id);
    const it = pool.splice(i >= 0 ? i : 0, 1)[0];
    return { id: it.id, name: it.name, note: it.note, price: l.price ?? 0, quantity: l.qty, product_id: l.variant_id };
  });
  const a = plan.address;
  const name = billName(plan.order.no, plan.lines[0]?.sku ?? null, a?.name || added.customer_name || '');
  const customer = a ? {
    customer_name: name,
    customer_phone: a.phone,
    customer_address: addressLine(a),
    structural_address: { street: a.street, subdistrict: a.subdistrict, district: a.district, province: a.province, postal_code: a.postal_code },
  } : { customer_name: name };
  await call(env, `orders/${orderId}.json`, { method: 'PUT', body: { order: { stage: 'draft', shipping_cost: plan.shipping, discount: plan.discount, ...customer }, order_items: items } });

  // 3. Read it back: the right SKUs and the total from the note, or report it.
  const done = await call<P365Order>(env, `orders/${orderId}.json`);
  const want = plan.lines.map((l) => `${(l.sku ?? '').toUpperCase()}×${l.qty}`).sort().join(',');
  const got = done.items.map((i) => `${(i.variant?.code ?? '').toUpperCase()}×${i.quantity}`).sort().join(',');
  if (want !== got || (plan.total != null && Number(done.total) !== plan.total)) {
    throw new P365Error(`ใส่แล้วแต่ไม่ตรง: ในร่าง ${got} ยอด ${done.total} (ต้องการ ${want} ยอด ${plan.total}) — เปิดร่าง #${plan.order.no} ใน Page365 เพื่อแก้เอง`);
  }
  return { plan, order: done };
}
