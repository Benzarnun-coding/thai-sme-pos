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

import { parseOrderNote, type NoteItem } from './orderNotes.ts';

export interface P365Env { P365_COOKIE?: string; P365_PAGE_ID?: string }

const BASE = 'https://page365.net';
const PAGE = (env: P365Env) => env.P365_PAGE_ID ?? '115748303500549';
const COD_FEE = 50;

export class P365Error extends Error {
  kind: 'session' | 'api' | 'check';
  constructor(message: string, kind: 'session' | 'api' | 'check' = 'api') { super(message); this.kind = kind; }
}

async function call<T>(env: P365Env, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
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

async function customerSizeLines(env: P365Env, conversationId: number): Promise<string[]> {
  const c = await call<{ messages: { own?: boolean; message?: string | null }[] }>(env, `conversations/${conversationId}.json`);
  return sizeLines(c.messages ?? []);
}

// ---- the plan ----

export interface PlanLine { code: string; size: string; qty: number; product_id: number | null; variant_id: number | null; sku: string | null; price: number | null; available: number | null }
export interface FillPlan {
  order: { id: number; no: number; stage: string } | null;
  lines: PlanLine[];
  payment: 'cod' | 'transfer' | null;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number | null;
  problems: string[];
  /** the customer's own messages about size, when a line's size isn't made */
  said: string[];
}

/**
 * What would be put into the draft, and every reason not to. Prices are Page365's own variant prices; the gap to
 * the note's total goes into the bill's discount, the way the team writes promos (3 × 199 + 50 − 98 = 549).
 */
export async function planFill(env: P365Env, note: { psid: string; at: string; text: string }): Promise<FillPlan> {
  const parsed = parseOrderNote(note.text);
  const problems: string[] = [];
  if (!parsed) throw new P365Error('อ่านบรรทัดสรุปนี้ไม่ได้', 'check');
  if (parsed.unknown.length) problems.push(`อ่านไม่ออก: ${parsed.unknown.join(' / ')}`);
  const draft = await findDraft(env, note.psid, note.at);
  if (!draft) problems.push('ไม่เจอร่างบิลของลูกค้าคนนี้ใน Page365 (ยังไม่ได้เปิดร่าง หรือเปิดไปแล้ว)');
  else if (draft.items.length) problems.push(`ร่าง #${draft.no} มีสินค้าอยู่แล้ว ${draft.items.length} รายการ — ไม่ใส่ซ้ำ`);

  const cache = new Map<string, { productId: number; variants: Variant[] } | null>();
  const lines: PlanLine[] = [];
  let missingSize = false;
  for (const it of parsed.items) {
    const found = await findVariant(env, it, cache);
    const hit = found?.variant ? { productId: found.productId, variant: found.variant } : null;
    if (!found) problems.push(`ไม่พบรุ่น ${it.code} ใน Page365`);
    else if (!hit) { problems.push(`${it.code} ไม่มีไซส์ ${it.size} — รุ่นนี้มี ${found.sizes.join(', ')} · ต้องถามลูกค้าใหม่`); missingSize = true; }
    else if (hit.variant.stockable !== false && hit.variant.available < it.qty) problems.push(`${hit.variant.code ?? it.code} เหลือ ${hit.variant.available} ตัว ไม่พอ ${it.qty}`);
    lines.push({ code: it.code, size: it.size, qty: it.qty, product_id: hit?.productId ?? null, variant_id: hit?.variant.id ?? null, sku: hit?.variant.code ?? null, price: hit?.variant.price ?? null, available: hit?.variant.available ?? null });
  }
  // A size that isn't made: show what the customer actually wrote about size, so the admin can ask them again.
  const said = missingSize && draft?.conversation_id ? await customerSizeLines(env, draft.conversation_id).catch(() => []) : [];
  const ids = lines.map((l) => l.product_id).filter((x) => x != null);
  if (new Set(ids).size !== ids.length) problems.push('มีรุ่นเดียวกันหลายไซส์ในใบเดียว — ตอนนี้ยังให้คนใส่เอง');
  const subtotal = lines.reduce((t, l) => t + (l.price ?? 0) * l.qty, 0);
  const shipping = parsed.payment === 'cod' ? COD_FEE : 0;
  const total = parsed.total;
  const discount = total == null ? 0 : subtotal + shipping - total;
  if (total == null) problems.push('ไม่มียอดรวมในบรรทัดสรุป');
  else if (discount < 0) problems.push(`ยอด ${total} สูงกว่าราคาสินค้า + ค่าส่ง (${subtotal + shipping}) — ราคาไม่ตรงโปร`);
  // Promos at list price run to ~60% off (1 × 369 for 199 COD, 3 × 369 for 549); beyond 70% the total is likely mistyped.
  else if (discount > subtotal * 0.7) problems.push(`ส่วนลด ${discount} เกิน 70% ของราคาสินค้า — เช็กยอดอีกครั้ง`);
  if (draft && draft.cod !== (parsed.payment === 'cod')) problems.push(`ร่างเป็น${draft.cod ? 'เก็บปลายทาง' : 'โอน'} แต่บรรทัดสรุปเป็น${parsed.payment === 'cod' ? 'ปลายทาง' : 'โอน'}`);
  return { order: draft ? { id: draft.id, no: draft.no, stage: draft.stage } : null, lines, payment: parsed.payment, subtotal, shipping, discount: Math.max(0, discount), total, problems, said };
}

/** Puts the planned items into the draft (still a draft afterwards), then reads it back and checks the total. */
export async function applyFill(env: P365Env, note: { psid: string; at: string; text: string }): Promise<{ plan: FillPlan; order: P365Order }> {
  const plan = await planFill(env, note);
  if (plan.problems.length || !plan.order) throw new P365Error(plan.problems.join(' · ') || 'ไม่เจอร่างบิล', 'check');
  const orderId = plan.order.id;

  // 1. Add one item per line (Page365 adds each product with its first size)…
  await call(env, 'order_items.json', { method: 'POST', body: { order_id: orderId, product_ids: plan.lines.map((l) => l.product_id) } });
  const added = await call<P365Order>(env, `orders/${orderId}.json`);
  if (added.items.length !== plan.lines.length) throw new P365Error(`ใส่สินค้าแล้วได้ ${added.items.length} รายการ แทนที่จะเป็น ${plan.lines.length} — เปิดร่าง #${plan.order.no} ใน Page365 เพื่อแก้เอง`);

  // 2. …then set each item's size, price and quantity, plus the shipping fee and the promo discount, as the
  // app's own "save" does (order fields not sent stay as they are).
  const pool = [...added.items];
  const items = plan.lines.map((l) => {
    const i = pool.findIndex((x) => x.variant?.product_id === l.product_id);
    const it = pool.splice(i >= 0 ? i : 0, 1)[0];
    return { id: it.id, name: it.name, note: it.note, price: l.price ?? 0, quantity: l.qty, product_id: l.variant_id };
  });
  await call(env, `orders/${orderId}.json`, { method: 'PUT', body: { order: { stage: 'draft', shipping_cost: plan.shipping, discount: plan.discount }, order_items: items } });

  // 3. Read it back: the right SKUs and the total from the note, or report it.
  const done = await call<P365Order>(env, `orders/${orderId}.json`);
  const want = plan.lines.map((l) => `${(l.sku ?? '').toUpperCase()}×${l.qty}`).sort().join(',');
  const got = done.items.map((i) => `${(i.variant?.code ?? '').toUpperCase()}×${i.quantity}`).sort().join(',');
  if (want !== got || (plan.total != null && Number(done.total) !== plan.total)) {
    throw new P365Error(`ใส่แล้วแต่ไม่ตรง: ในร่าง ${got} ยอด ${done.total} (ต้องการ ${want} ยอด ${plan.total}) — เปิดร่าง #${plan.order.no} ใน Page365 เพื่อแก้เอง`);
  }
  return { plan, order: done };
}
