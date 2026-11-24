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

import { addressLine, readAddressTiered, type AddressUsage, type ChatMessage } from './addressReader.ts';
import { audit } from './db.ts';
import { completeAddress } from './thaiAddress.ts';
import { parseOrderNote, type NoteItem } from './orderNotes.ts';
import { loadSubstitutes, subKey } from './substitutes.ts';
import { piaHas } from './stock.ts';

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
  if (!text.trim()) return null as T; // DELETE answers with no body
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
  /** COD or transfer is the shipping option (Kerry Express (COD) / Kerry Express (แบบโอน)) */
  shipping_options?: { id: number; name: string; cod: boolean }[]; shipping_id?: number | null;
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

/**
 * The product a note's code means, by the first word of Page365's product name (20 Oct):
 * the same code ("501/1"); the same code written with other separators when it has a separator or letters
 * ("009/1" = 009-1, "SK004" = SK-004 — but "204" is not "20-4", a different product); or, for a code without a
 * colour, the model's only colour ("205" = 205/1, "204" = 204/1).
 */
export function pickProduct<T extends { name: string }>(products: T[], code: string): T | undefined {
  const key = code.toUpperCase();
  const first = (x: T) => x.name.trim().toUpperCase().split(/\s+/)[0];
  const bare = (c: string) => c.replace(/[/-]/g, '');
  const exact = products.find((x) => first(x) === key);
  if (exact) return exact;
  if (/[/-]|[A-Z]/.test(key)) {
    const same = products.filter((x) => bare(first(x)) === bare(key));
    if (same.length === 1) return same[0];
  }
  if (/^\d+$/.test(key)) {
    const family = products.filter((x) => new RegExp(`^${key}[/-][0-9A-Z]+$`).test(first(x)));
    if (family.length === 1) return family[0];
  }
  return undefined;
}

/** Page365 product + size for one line: product whose name starts with the code, variant whose SKU ends with the size. */
/**
 * The team's colour names that differ from Page365's product names (Benz 20 Oct: "980 ดำกรม" = 980-31, named
 * "น้ำเงิน" in Page365). Other colours are matched by the colour word in the product name.
 */
export const COLOUR_ALIASES: Record<string, Record<string, string>> = { '980': { 'ดำกรม': '31' } };

/** Among a model's colour products ("980-31 กางเกงผ้ายืด Sports น้ำเงิน"), the one a colour name means. */
export function pickColour<T extends { name: string }>(products: T[], code: string, colour: string): T | undefined {
  const key = code.toUpperCase();
  const first = (x: T) => x.name.trim().toUpperCase().split(/\s+/)[0];
  const family = products.filter((x) => new RegExp(`^${key.replace(/[/-]/g, '[/-]?')}[/-][0-9A-Z]+$`).test(first(x)));
  const alias = COLOUR_ALIASES[key]?.[colour];
  if (alias) return family.find((x) => first(x).replace(/^.*[/-]/, '') === alias);
  const c = colour.replace(/^สี/, '');
  const named = family.filter((x) => x.name.replace(/\s+/g, '').replace(/สี/g, '').includes(c));
  return named.length === 1 ? named[0] : undefined;
}

/** Page365 product + size for one line: the product by code (and colour name), the variant by size. */
async function findVariant(env: P365Env, it: NoteItem, cache: Map<string, { productId: number; variants: Variant[] } | null>): Promise<{ productId: number; variant: Variant | null; sizes: string[] } | null> {
  const key = `${it.code.toUpperCase()}|${it.colour ?? ''}`;
  if (!cache.has(key)) {
    const found = await call<{ products: { id: number; name: string }[] }>(env, `products.json?for_browser=true&page=1&search=${encodeURIComponent(it.code)}`);
    const p = it.colour ? pickColour(found.products, it.code, it.colour) : pickProduct(found.products, it.code);
    if (!p) cache.set(key, null);
    else {
      const full = await call<{ id: number; variants: Variant[] }>(env, `products/${p.id}.json`);
      cache.set(key, { productId: p.id, variants: full.variants ?? [] });
    }
  }
  const prod = cache.get(key);
  if (!prod) return null;
  const sizeOf = (x: Variant) => (x.code ?? '').split('-').pop()?.toUpperCase() || x.name.replace(/\D/g, '');
  // No size written, or free size: the model's only size (free-size models have one variant, "…-FE").
  const v = !it.size || it.size === 'F'
    ? (prod.variants.length === 1 ? prod.variants[0] : prod.variants.find((x) => /^(FE|F|FREE)$/.test(sizeOf(x)) || /free/i.test(x.name)))
    : prod.variants.find((x) => (x.code ?? '').toUpperCase().endsWith(`-${it.size}`) || x.name.replace(/\s+/g, '').toUpperCase() === `ไซส์${it.size}`);
  const sizes = prod.variants.map(sizeOf).filter(Boolean);
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
/** GoSell is no longer used (Moss, idea #36, 2026-11-20): every bill, 501/1–3 too, gets the warehouse prefix ("PK-1234 …"). */
/** Only these models get the PP- bill name for now (Moss, idea #38 follow-up, 2026-11-24). */
export const PIA_BILL_CODES = new Set(['009/1', '009/2']);

/** `inPia`: the first item is in พี่เปีย's (BB) stock → "PP-1234" instead of "PK-1234" (Moss, idea #38); out of stock → the SKU's own prefix. */
export function billName(no: number, firstSku: string | null, name: string, inPia = false): string {
  const wh = inPia ? 'PP' : (firstSku ?? '').split('-')[1]?.toUpperCase() ?? '';
  const prefix = wh ? `${wh === 'CN' ? 'C' : wh}-${String(no).slice(-4)} ` : '';
  return `${prefix}${name.replace(/^[A-Z]{1,3}-\d{4}\s+/, '').trim()}`;
}

// ---- the plan ----

export interface PlanAddress { name: string; phone: string; street: string; subdistrict: string; district: string; province: string; postal_code: string; from_image: boolean; source: 'page365' | 'chat' }
/** `code` is what goes on the bill; `sold_as` the model the note wrote when a ตัวแทน replaced it (substitutes.ts). */
export interface PlanLine { code: string; sold_as?: string | null; size: string; qty: number; product_id: number | null; variant_id: number | null; sku: string | null; price: number | null; available: number | null }
export interface FillPlan {
  order: { id: number; no: number; stage: string } | null;
  lines: PlanLine[];
  payment: 'cod' | 'transfer' | null;
  /** the draft's shipping option to set (switches COD ↔ transfer) */
  shipping_id?: number | null;
  /** its name: Page365 keeps the old one on the bill unless it is sent too */
  shipping_option?: string | null;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number | null;
  /** the amount the chat agreed on, if the shop wrote one */
  chat_total: number | null;
  /** the bill's customer name as it will be ("PK-9349 …") */
  bill_name: string | null;
  /** the first item is in พี่เปีย's stock right now (bill name starts PP-) */
  pia?: boolean;
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

export interface FillEnv extends P365Env { ANTHROPIC_API_KEY?: string; ANTHROPIC_WORKSPACE_ID?: string; ADDRESS_MODEL?: string; /** the model for photos / not found (readAddressTiered) */ ADDRESS_MODEL_HARD?: string; /** set → each address read is logged to audit */ DB?: D1Database }

/** Is the address Page365 already put on the draft complete and clean (it sometimes copies chat text into it)? */
export function draftAddress(d: P365Order): PlanAddress | null {
  const s = d.structural_address;
  if (!s || !/^\d{5}$/.test(s.postal_code ?? '') || !s.province || !s.district || !/^0\d{8,9}$/.test((d.customer_phone ?? '').replace(/\D/g, ''))) return null;
  if (/ไซส์|เอว|ตัว|สี|ราคา|โปร|ปลายทาง|โอน|ค่ะ|ครับ|คับ/.test(s.street ?? '')) return null;
  // Page365 often leaves ตำบล/แขวง blank (Benz 26 Oct): not complete, so the address is read from the chat instead.
  if (!(s.subdistrict ?? '').trim()) return null;
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
export async function planFill(env: FillEnv, note: { psid: string; at: string; text: string }, opts: { readAddress?: boolean; draft?: P365Order | null; substitutes?: Map<string, string> } = {}): Promise<FillPlan> {
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
  const made = new Set<string>();
  // ตัวแทน set on the website: a sold-out model goes on the bill as another one (a missing table = none set).
  const subs = opts.substitutes ?? (env.DB ? await loadSubstitutes(env.DB).catch(() => new Map<string, string>()) : new Map<string, string>());
  for (const note0 of parsed.items) {
    let it = note0;
    // The model the customer bought sets the price; its ตัวแทน is what ships (SKU, stock, bill name) — Benz 19 Nov.
    let soldAs: string | null = null;
    let soldPrice: number | null = null;
    const sub = it.colour ? undefined : subs.get(subKey(it.code));
    if (sub) {
      const orig = await findVariant(env, it, cache).catch(() => null);
      soldPrice = orig?.variant?.price ?? null;
      soldAs = it.code;
      it = { ...it, code: sub, prefix: sub.replace(/[/-]/g, '') };
      notes.push(soldPrice != null ? `${soldAs} ใช้ตัวแทน ${sub} (ราคาตาม ${soldAs})` : `${soldAs} ใช้ตัวแทน ${sub} · ไม่พบราคา ${soldAs} ไซส์ ${note0.size || '-'} ใน Page365 ใช้ราคาของ ${sub}`);
    }
    // "E200" when Page365's model is "200": a stray letter before a numeric code — tried without it, and said so.
    let found = await findVariant(env, it, cache);
    const bare = it.code.replace(/^[A-Z](?=\d+(?:[/-]\d+)*$)/i, '');
    if (!found && bare !== it.code) {
      found = await findVariant(env, { ...it, code: bare }, cache);
      if (found) notes.push(`อ่าน ${it.code} เป็น ${bare}`);
    }
    const hit = found?.variant ? { productId: found.productId, variant: found.variant } : null;
    const what = `${it.code}${it.colour ? ` สี${it.colour}` : ''}${soldAs ? ` (ตัวแทนของ ${soldAs})` : ''}`;
    if (!found) problems.push(it.colour ? `ไม่พบ ${what} ใน Page365 (ชื่อสีไม่ตรงกับในร้าน — บอกเบนซ์ให้เพิ่มชื่อสีนี้)` : `ไม่พบรุ่น ${what} ใน Page365`);
    else if (!hit) { problems.push(it.size ? `${what} ไม่มีไซส์ ${it.size} — รุ่นนี้มี ${found.sizes.join(', ')} · ต้องถามลูกค้าใหม่` : `${what} ไม่ได้ระบุไซส์ — รุ่นนี้มี ${found.sizes.join(', ')}`); missingSize = true; }
    else if (hit.variant.stockable !== false && hit.variant.available < it.qty) problems.push(`${hit.variant.code ?? it.code} เหลือ ${hit.variant.available} ตัว ไม่พอ ${it.qty}`);
    if (found) for (const z of found.sizes) made.add(z);
    lines.push({ code: it.code, ...(soldAs ? { sold_as: soldAs } : {}), size: it.size, qty: it.qty, product_id: hit?.productId ?? null, variant_id: hit?.variant.id ?? null, sku: hit?.variant.code ?? null, price: hit ? soldPrice ?? hit.variant.price : null, available: hit?.variant.available ?? null });
  }
  // A size that isn't made: show what the customer actually wrote about size, so the admin can ask them again.
  const said = missingSize ? sizeLines(chat) : [];
  const ids = lines.map((l) => l.product_id).filter((x) => x != null);
  // The same model in several sizes is one Page365 item per size (20 Oct; the read-back below checks Page365 kept them).

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
  // COD or transfer follows the note: a new draft starts as COD, so a transfer note switches its shipping option
  // (Ou Aumaporn #29373, 15 Oct). Only a draft without a matching option is stopped.
  let shipping_id: number | null = null;
  let shipping_option: string | null = null;
  if (draft && draft.cod !== (parsed.payment === 'cod')) {
    const opt = (draft.shipping_options ?? []).find((o) => o.cod === (parsed.payment === 'cod'));
    if (opt) { shipping_id = opt.id; shipping_option = opt.name; }
    else problems.push(`ร่างเป็น${draft.cod ? 'เก็บปลายทาง' : 'โอน'} แต่บรรทัดสรุปเป็น${parsed.payment === 'cod' ? 'ปลายทาง' : 'โอน'} และไม่มีตัวเลือกขนส่งแบบนั้น`);
  }

  // The price agreed in the chat wins: a note whose total differs (other than by the COD fee) is not filled.
  const chat_total = chatTotal(chat, note.at);
  // The note's total is the price (a special price for a customer who haggled is fine, Benz 20 Oct): a different
  // total in the chat is filled anyway and sent to a person to check — 27 bills stopped on it 15–20 Oct, and every
  // one ended at the note's total.
  if (total != null && chat_total != null && chat_total !== total && chat_total + shipping !== total) warnings.push(`ในแชทตกลงยอด ${chat_total} แต่สรุปไว้ ${total} — ถ้าเป็นราคาพิเศษไม่ต้องทำอะไร`);
  // Sizes 38 and up cost 60 more a piece, except NI9 (Benz 20 Oct). When the chat didn't agree this very total, ask.
  const big = lines.filter((l) => Number(l.size) >= 38 && !/^NI9/i.test(l.code)).reduce((n, l) => n + l.qty, 0);
  if (big && total != null && chat_total !== total) warnings.push(`มี ${big} ตัวไซส์ 38 ขึ้นไป (บวกตัวละ 60 ยกเว้น NI9) — เช็กว่ายอด ${total} บวกแล้ว`);
  // No total written in the chat is fine: the admin's note is the trigger and its total is the price (Benz 15 Oct).

  // The chat is read whenever a key is set, also when Page365 already has the address: it is what catches a
  // customer who cancelled, or a size in the note that isn't the one they asked for (Benz 15 Oct, #29329, #29367).
  // Address: Page365's own when complete, else the one read from the chat (typed or a photo).
  let address: PlanAddress | null = draft ? draftAddress(draft) : null;
  if (draft && opts.readAddress !== false && env.ANTHROPIC_API_KEY) {
    const read = await readAddressTiered(env.ANTHROPIC_API_KEY, chat, { cheap: env.ADDRESS_MODEL, strong: env.ADDRESS_MODEL_HARD, workspaceId: env.ANTHROPIC_WORKSPACE_ID, orderNote: note.text }).catch((err) => ({ problems: [`อ่านที่อยู่ไม่สำเร็จ: ${err?.message ?? err}`] } as { problems: string[]; cancelled?: boolean; size_mismatch?: string; customer_sizes?: string[]; usages?: AddressUsage[] } & Partial<PlanAddress>));
    // Tokens and price of every read (the $20/month workspace cap ran out on 23 Oct with no record of where it went).
    if (env.DB) for (const u of read.usages ?? []) await audit(env.DB, 'ai', 'address.read', String(draft.no), u).catch(() => null);
    // A warning, not a stop (Benz 20 Oct): the reader called 5 orders cancelled 15–19 Oct and all 5 were sent.
    if (read.cancelled) warnings.push(CANCEL_HINT);
    // A size the customer asked for that isn't made (29/31/33…): the admin's nearest made size is right (Benz 20 Oct).
    // …and only a real difference stops it: the reader's own "ตรงกับที่ลูกค้าขอ" used to (33 bills, 2–16 Nov).
    if (sizeStop(read.size_mismatch ?? '', read.customer_sizes, lines.flatMap((l) => Array(l.qty).fill(l.size)), made)) problems.push(`ไซส์ไม่ตรงกับที่ลูกค้าขอ: ${(read.size_mismatch ?? '').trim()}`);
    if (!address) {
      if (read.problems.length) warnings.push(...read.problems.map((p) => `ที่อยู่: ${p}`));
      // A doubt alone (a name, a house number) doesn't keep the address off the bill: whatever is complete
      // enough to ship goes in, and the doubt goes to a person to check (Benz 15 Oct, bill #29372).
      address = validAddress({ ...read, name: read.name || draft.customer_name || '', source: 'chat' });
    }
  } else if (draft && !address) {
    warnings.push(opts.readAddress === false ? 'ยังไม่ได้อ่านที่อยู่จากแชท' : 'ร่างยังไม่มีที่อยู่ครบ และยังไม่ได้ตั้ง ANTHROPIC_API_KEY ให้ระบบอ่านที่อยู่จากแชท — แอดมินกรอกเอง');
  }
  // No recipient name in the chat: the customer's Facebook name (Page365's customer name) is used (Benz 15 Oct).
  const pia = !!(env.DB && lines[0]?.sku && PIA_BILL_CODES.has(lines[0].code.toUpperCase().replace(/-/g, '/')) && await piaHas(env.DB, lines[0].sku, lines[0].qty).catch(() => false));
  const bill_name = draft ? billName(draft.no, lines[0]?.sku ?? null, address?.name || draft.customer_name || '', pia) : null;
  return { order: draft ? { id: draft.id, no: draft.no, stage: draft.stage } : null, lines, pia, payment: parsed.payment, shipping_id, shipping_option, subtotal, shipping, discount: Math.max(0, discount), total, chat_total, bill_name, address, problems, warnings, said, notes };
}

/** A checked address from the screen (the admin may have corrected it), or null. */
/** [a, a, b, a] → [[a, b], [a], [a]]: no product twice in one request. */
export function addRounds<T>(ids: T[]): T[][] {
  const rounds: T[][] = [];
  const seen = new Map<T, number>();
  for (const id of ids) {
    const k = seen.get(id) ?? 0;
    seen.set(id, k + 1);
    (rounds[k] ??= []).push(id);
  }
  return rounds;
}

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
  // Page365 adds a product once per request even when it is listed twice (two sizes of one model, #30797 27 Oct:
  // no bill with a repeated model had ever filled), so a repeated product goes in a request of its own: round k
  // adds each product's k-th line.
  for (const round of addRounds(plan.lines.map((l) => l.product_id))) {
    await call(env, 'order_items.json', { method: 'POST', body: { order_id: orderId, product_ids: round } });
  }
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
  const a = plan.address ? { ...plan.address, street: cleanStreet(plan.address.street, [plan.address.name, added.customer_name ?? ''], plan.address.phone) } : null;
  const name = billName(plan.order.no, plan.lines[0]?.sku ?? null, a?.name || added.customer_name || '', plan.pia);
  const customer = a ? {
    customer_name: name,
    customer_phone: a.phone,
    customer_address: addressLine(a),
    structural_address: { street: a.street, subdistrict: a.subdistrict, district: a.district, province: a.province, postal_code: a.postal_code },
  } : { customer_name: name };
  await call(env, `orders/${orderId}.json`, { method: 'PUT', body: { order: { stage: 'draft', ...(plan.shipping_id ? { shipping_id: plan.shipping_id, shipping_option: plan.shipping_option } : {}), shipping_cost: plan.shipping, discount: plan.discount, ...customer }, order_items: items } });

  // 3. Read it back: the right SKUs and the total from the note, or report it.
  return { plan, order: await checkBack(env, plan, orderId) };
}

/** Reads a bill back after a write and checks it holds the plan's SKUs, total and payment (throws what differs). */
export async function checkBack(env: P365Env, plan: FillPlan, orderId: number): Promise<P365Order> {
  const done = await call<P365Order>(env, `orders/${orderId}.json`);
  const want = plan.lines.map((l) => `${(l.sku ?? '').toUpperCase()}×${l.qty}`).sort().join(',');
  const got = done.items.map((i) => `${(i.variant?.code ?? '').toUpperCase()}×${i.quantity}`).sort().join(',');
  if (plan.payment && done.cod !== (plan.payment === 'cod')) {
    throw new P365Error(`ใส่สินค้าแล้ว แต่ร่าง #${done.no} ยังเป็น${done.cod ? 'เก็บปลายทาง' : 'โอน'} — เปลี่ยนวิธีจ่ายใน Page365 เอง`);
  }
  if (want !== got || (plan.total != null && Number(done.total) !== plan.total)) {
    throw new P365Error(`ใส่แล้วแต่ไม่ตรง: ในร่าง ${got} ยอด ${done.total} (ต้องการ ${want} ยอด ${plan.total}) — เปิดร่าง #${done.no} ใน Page365 เพื่อแก้เอง`);
  }
  return done;
}

/**
 * The house-number line without the recipient's name or phone (20 Oct: 10 bills had the name, 3 the phone, in the
 * address — Page365 copies what the customer typed, the chat reader sometimes too). Name and phone have their own fields.
 */
export function cleanStreet(street: string, names: string[], phone: string): string {
  let s = ` ${street ?? ''} `;
  // Phone numbers in any spacing, and their labels.
  s = s.replace(/(?:เบอร์(?:โทร)?|โทร\.?|tel\.?|ติดต่อ)\s*:?\s*/gi, ' ');
  s = s.replace(/(?<!\d)0\d(?:[\s-]?\d){7,8}(?!\d)/g, ' ');
  if (phone) s = s.split(phone).join(' ');
  // The recipient's name (with or without คุณ/ชื่อ), word by word for full names.
  s = s.replace(/(?:ชื่อ(?:ผู้รับ)?|ผู้รับ|คุณ)\s*:?\s*/g, ' ');
  for (const n of names) {
    const words = n.replace(/^[A-Z]{1,3}-\d{4}\s+/, '').split(/\s+/).filter((w) => w.length >= 2 && !/\d/.test(w));
    for (const w of words) s = s.split(w).join(' ');
  }
  return s.replace(/\s*[,/]\s*(?=[,/]|$)/g, ' ').replace(/^[\s,/:-]+|[\s,/:-]+$/g, '').replace(/\s+/g, ' ').trim();
}

export const CANCEL_HINT = 'AI อ่านว่าลูกค้าอาจขอยกเลิกในแชท — เช็กก่อนส่งบิลว่ายังเอาไหม';

/**
 * A draft that already holds exactly what the note says — same models, sizes and quantities, same total (an admin
 * filled it by hand before the system got to it; 16 bills stopped as "มีสินค้าอยู่แล้ว" 2–16 Nov, none changed after).
 * Only notes that can be compared line by line: every line read, with a size, no colour names.
 */
export function draftHoldsNote(text: string, draft: Pick<P365Order, 'items' | 'total'>, subs: Map<string, string> = new Map()): boolean {
  const p = parseOrderNote(text);
  if (!p || p.unknown.length || !p.items.length || !draft.items.length || p.items.some((i) => i.colour || !i.size)) return false;
  if (p.total == null || Math.abs(Number(draft.total) - p.total) > 0.5) return false;
  const bare = (prefix: string) => prefix.toUpperCase().replace(/^[A-Z](?=\d)/, '');
  const want = new Map<string, number>();
  for (const i of p.items) { const sub = subs.get(subKey(i.code)); const k = `${bare(sub ? sub.replace(/[/-]/g, '') : i.prefix)}-${i.size === 'F' ? 'FE' : i.size}`; want.set(k, (want.get(k) ?? 0) + i.qty); }
  const got = new Map<string, number>();
  for (const i of draft.items) {
    const parts = (i.variant?.code ?? '').toUpperCase().split('-');
    if (parts.length < 3) return false;
    const k = `${bare(parts[0])}-${parts[parts.length - 1]}`;
    got.set(k, (got.get(k) ?? 0) + i.quantity);
  }
  return want.size === got.size && [...want].every(([k, n]) => got.get(k) === n);
}

/**
 * Whether the reader's size remark stops the bill. With the sizes the customer settled on (`customer_sizes`, one per
 * piece): only when they differ from the note's — sizes the model isn't made in (29/31/33…) left out, since the
 * admin's nearest made size is right; the same sizes in other numbers of pieces is a quantity, which the total
 * already settles. Without them (an older answer): the remark stops it unless it only says the sizes match.
 */
export function sizeStop(mismatch: string, customerSizes: string[] | undefined, noteSizes: string[], made: Set<string>): boolean {
  if (!mismatch.trim()) return false;
  const norm = (z: string) => z.toUpperCase().replace(/^(?:SZ|SIZE|W|เอว|ไซส์|ไซซ์|ไซร์)\.?\s*/i, '').replace(/^XXL$/, '2XL').trim();
  const note = new Set(noteSizes.map(norm).filter(Boolean));
  if (customerSizes?.length && note.size) {
    const asked = new Set(customerSizes.map(norm).filter((z) => z && (!made.size || made.has(z) || note.has(z))));
    if (!asked.size) return false;
    return [...asked].some((z) => !note.has(z)) || [...note].some((z) => !asked.has(z));
  }
  if (customerSizes && !customerSizes.length) return false;
  if (/ตรงกับ|ตรงกัน/.test(mismatch) && !/แต่|ไม่ตรง|ไม่ใช่|ควรเป็น|แทน|ส่วน/.test(mismatch)) return false;
  return !askedSizeNotMade(mismatch, noteSizes, made);
}

/** "โน้ต 34 แต่ลูกค้าขอ 33" where the model has no 33: the sizes the customer named that the note doesn't have, none made. */
export function askedSizeNotMade(mismatch: string, noteSizes: string[], made: Set<string>): boolean {
  const named = (mismatch.match(/\b(2[4-9]|[34]\d|50)\b/g) ?? []).filter((z) => !noteSizes.includes(z));
  return named.length > 0 && made.size > 0 && named.every((z) => !made.has(z));
}
