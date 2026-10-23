// A corrected order summary changes the bill already made for it, instead of leaving it for a person or opening a
// second bill (Benz 23 Oct: the bot tells customers a size can be changed until the parcel is sent, and the bills are
// filled by the system, so the system must apply the change too). The admin's corrected note stays the trigger.
// Off until Benz switches it on (meta_capi key note_correction); the preview replays recent real notes.
//
// What a second note of the same customer does (the first one already filled bill B):
// - within 2 h, B still a draft or sent but unpaid ("รอชำระ") → B's items, shipping and discount are rewritten in
//   place (PUT orders/{id}.json as Page365's own save, read back); a sent bill is told to #ออเดอร์มีปัญหา;
// - within 2 h, B further on (transferred / paid / shipped / voided / expired) → never touched, told at once;
// - after 2 h, B not shipped yet (≤ 3 days old) with the same model(s) in another size/colour → no second bill:
//   held, and a person is asked whether it is a correction or a new order;
// - the note says what B already holds → nothing to do.
// Page365 stages read from its web app (23 Oct): draft → unpaid → transferred → paid → shipped, plus voided / expired.
// Its own screen edits items directly only in draft and unpaid; transferred and paid need "unlock items" (the money
// is in, the parcel may be packed), shipped / voided / expired can't be edited. The Meta sale stays as sent: Meta
// can't edit or delete a purchase.

import { postOrderChannel, orderLink, type AutoEnv } from './autoFill.ts';
import { audit } from './db.ts';
import { diff, expected } from './fillAudit.ts';
import { parseOrderNote, type StoredNote } from './orderNotes.ts';
import { billName, call, checkBack, P365Error, planFill, type FillEnv, type FillPlan, type P365Order } from './p365fill.ts';

/**
 * Switched on = "on:<when>" (Benz 23 Oct: from now on) — only notes typed after that moment correct a bill, so the
 * sweep re-reading older notes never rewrites a bill on their account. A bare "on" (older value) applies to all.
 */
export async function correctionOn(db: D1Database, noteAt?: string): Promise<boolean> {
  const r = await db.prepare("SELECT value FROM meta_capi WHERE key = 'note_correction'").first<{ value: string }>().catch(() => null);
  return correctionApplies(r?.value, noteAt);
}

export function correctionApplies(value: string | undefined, noteAt?: string): boolean {
  if (value === 'on') return true;
  if (!value?.startsWith('on:')) return false;
  return !noteAt || Date.parse(noteAt) >= Date.parse(value.slice(3));
}

export async function setCorrection(db: D1Database, on: boolean): Promise<void> {
  await db.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('note_correction', ?)").bind(on ? `on:${new Date().toISOString()}` : 'off').run();
}

/** Two notes of one customer this close together are one order (as for drafts and Meta sales). */
export const SAME_ORDER_MS = 2 * 3_600_000;
/** A note later than that asks about an open bill at most this old. */
const OPEN_BILL_MS = 3 * 86_400_000;
/** Stages the system rewrites (Page365's own screen edits items there without unlocking). */
export const EDIT_STAGES = new Set(['draft', 'unpaid']);
const CLOSED = new Set(['shipped', 'voided', 'expired']);
export const STAGE_TH: Record<string, string> = { draft: 'ร่าง', unpaid: 'รอชำระ', transferred: 'แจ้งโอนแล้ว', paid: 'ชำระแล้ว', shipped: 'ส่งแล้ว', voided: 'ยกเลิก', expired: 'หมดอายุ' };
export const stageTh = (s: string) => STAGE_TH[s] ?? s;

export type Decision = 'same' | 'rewrite' | 'locked' | 'ask' | 'new' | 'unclear';

/** "501/1" → 501, "NI9-1" → NI9, "E200" → 200: the model without its colour. */
export const modelOf = (code: string) => code.toUpperCase().replace(/^[A-Z](?=\d+(?:[/-]\d+)*$)/, '').split(/[/-]/)[0];
const firstWord = (s: string) => s.trim().split(/\s+/)[0] ?? '';
const sizeOf = (sku: string | null | undefined) => (sku ?? '').split('-').pop()?.toUpperCase() ?? '';

/**
 * What a note means for a bill an earlier note of the same customer filled. `gapMs` = time since that earlier note,
 * `billAgeMs` = time since the bill was opened.
 */
export function decide(x: { gapMs: number; billAgeMs: number; stage: string; noteText: string; bill: Pick<P365Order, 'items' | 'total' | 'cod'> }): Decision {
  const parsed = parseOrderNote(x.noteText);
  const near = x.gapMs <= SAME_ORDER_MS;
  if (!parsed || !parsed.items.length) return near ? 'unclear' : 'new';
  const want = expected(x.noteText);
  const d = want ? diff(want, x.bill) : null;
  if (near) {
    if (d && !d.length) return 'same';
    return EDIT_STAGES.has(x.stage) ? 'rewrite' : 'locked';
  }
  if (CLOSED.has(x.stage) || x.billAgeMs > OPEN_BILL_MS || !d) return 'new';
  const noteModels = [...new Set(parsed.items.map((i) => modelOf(i.code)))].sort().join(',');
  const billModels = [...new Set(x.bill.items.map((i) => modelOf(firstWord(i.name))))].sort().join(',');
  return noteModels === billModels && (d.includes('size') || d.includes('items')) ? 'ask' : 'new';
}

/** "501/1 32", "501/1 32 ×2": what a bill holds. */
export const billItems = (o: Pick<P365Order, 'items'>) => o.items.map((i) => `${firstWord(i.name)} ${sizeOf(i.variant?.code)}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`.trim());
/** The same for what a note says. */
export const noteItems = (text: string) => (parseOrderNote(text)?.items ?? []).map((i) => `${i.code}${i.colour ? ` ${i.colour}` : ''} ${i.size || '-'}${i.qty > 1 ? ` ×${i.qty}` : ''}`);
const planItems = (p: FillPlan) => p.lines.map((l) => `${l.code} ${l.size}${l.qty > 1 ? ` ×${l.qty}` : ''}`);
const pay = (cod: boolean | null | undefined) => (cod ? 'ปลายทาง' : 'โอน');

/** "501/1 32 → 501/1 34" (only when the items differ). */
export function change(before: string[], after: string[]): string | null {
  const a = [...before].sort().join(', ');
  const b = [...after].sort().join(', ');
  return a === b ? null : `${before.join(', ')} → ${after.join(', ')}`;
}

/**
 * Rewrites a draft's or an unpaid bill's items, shipping and discount to what the corrected note says, the way
 * Page365's own save does (items left out of the list are removed; new models are added first, as the fill does),
 * then reads it back. The address and name stay (only the name's warehouse prefix follows the items).
 */
export async function rewriteBill(env: FillEnv, note: { psid: string; at: string; text: string }, bill: P365Order): Promise<{ plan: FillPlan; order: P365Order }> {
  const plan = await planFill(env, note, { readAddress: false, draft: { ...bill, items: [] } });
  plan.warnings = plan.warnings.filter((w) => !w.startsWith('ยังไม่ได้อ่านที่อยู่'));
  if (plan.problems.length || !plan.order) throw new P365Error(plan.problems.join(' · ') || 'ไม่เจอบิล', 'check');
  // The stage again right before writing: an admin may have moved it on meanwhile.
  let now = await call<P365Order>(env, `orders/${bill.id}.json`);
  if (!EDIT_STAGES.has(now.stage)) throw new P365Error(`บิล #${bill.no} ไปขั้น "${stageTh(now.stage)}" แล้ว — ระบบไม่แก้`, 'check');
  const pool = [...now.items];
  const keep = plan.lines.map((l) => { const i = pool.findIndex((x) => x.variant?.product_id === l.product_id); return i >= 0 ? pool.splice(i, 1)[0] : null; });
  const missing = plan.lines.filter((_, k) => !keep[k]);
  if (missing.length) {
    await call(env, 'order_items.json', { method: 'POST', body: { order_id: bill.id, product_ids: missing.map((l) => l.product_id) } });
    const known = new Set(now.items.map((i) => i.id));
    now = await call<P365Order>(env, `orders/${bill.id}.json`);
    const fresh = now.items.filter((i) => !known.has(i.id));
    if (fresh.length !== missing.length) throw new P365Error(`เพิ่มสินค้าแล้วได้ ${fresh.length} รายการ แทนที่จะเป็น ${missing.length} — เปิดบิล #${bill.no} ใน Page365 แก้เองด่วน`);
    plan.lines.forEach((l, k) => { if (!keep[k]) { const j = fresh.findIndex((x) => x.variant?.product_id === l.product_id); keep[k] = fresh.splice(j >= 0 ? j : 0, 1)[0]; } });
  }
  const items = plan.lines.map((l, k) => ({ id: keep[k]!.id, name: keep[k]!.name, note: keep[k]!.note, price: l.price ?? 0, quantity: l.qty, product_id: l.variant_id }));
  const name = billName(bill.no, plan.lines[0]?.sku ?? null, now.customer_name ?? '', plan.lines.map((l) => l.code), plan.lines.map((l) => l.sku));
  await call(env, `orders/${bill.id}.json`, { method: 'PUT', body: { order: { stage: now.stage, ...(plan.shipping_id ? { shipping_id: plan.shipping_id, shipping_option: plan.shipping_option } : {}), shipping_cost: plan.shipping, discount: plan.discount, customer_name: name }, order_items: items } });
  return { plan, order: await checkBack(env, plan, bill.id) };
}

const bkk = (iso: string) => new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(11, 16);

/**
 * Case 1/2: the bill is rewritten; a bill already sent to the customer is told to #ออเดอร์มีปัญหา with what
 * changed. Throws (P365Error) when it can't — the caller asks a person.
 */
export async function applyCorrection(env: AutoEnv, note: StoredNote, bill: P365Order, earlierAt: string): Promise<{ order: P365Order; change: string | null }> {
  const before = billItems(bill);
  const totalBefore = Number(bill.total);
  const r = await rewriteBill(env, note, bill);
  const what = change(before, planItems(r.plan));
  const totalAfter = Number(r.order.total);
  await audit(env.DB, 'อัตโนมัติ', 'p365.correct', String(bill.no), { stage: bill.stage, mid: note.mid, before, after: planItems(r.plan), total: [totalBefore, totalAfter], cod: [bill.cod, r.order.cod] }).catch(() => null);
  if (bill.stage !== 'draft') {
    const lines = [
      `✏️ แก้บิล [#${bill.no}](<${orderLink(env, bill.id)}>) ตามสรุปใหม่แล้ว — ลูกค้า **${(bill.customer_name ?? '').replace(/^[A-Z]{1,3}-\d{4}\s+/, '') || 'ไม่ทราบชื่อ'}** · บิลส่งให้ลูกค้าแล้ว (${stageTh(bill.stage)})`,
      `แอดมินสรุปใหม่ตอน ${bkk(note.at)} น. (สรุปเดิม ${bkk(earlierAt)} น.) · ระบบแก้ตอน ${bkk(new Date().toISOString())} น.: \`${note.text.replace(/\s+/g, ' ')}\``,
      ...(what ? [`• ${what}`] : []),
      ...(bill.cod !== r.order.cod ? [`• ${pay(bill.cod)} → ${pay(r.order.cod)}`] : []),
      ...(totalBefore !== totalAfter ? [`• ยอด ${totalBefore} → ${totalAfter} — ยอดขายที่ส่งให้ Meta ไปแล้ว (${totalBefore}) แก้/ลบไม่ได้ ไม่ต้องทำอะไร`] : []),
    ];
    await postOrderChannel(env, () => lines.join('\n').slice(0, 2000)).catch(() => null);
  }
  return { order: r.order, change: what };
}

// ---- preview: what it would have done with recent real notes ----

export interface CorrectionPreview {
  note: { mid: string; at: string; text: string; result: string | null; order_no: number | null };
  earlier: { mid: string; at: string; text: string };
  bill: number;
  gap_min: number;
  /** the stage the decision used: "draft" when the note was stopped as a repeat on a draft, else the bill's stage now */
  stage: string;
  decision: Decision;
  /** what the correction would change, from the earlier note to this one */
  change: string | null;
  total: [number | null, number | null];
  payment: [string | null, string | null];
  /** how the bill ended in Page365 (what the admins made of it) */
  final: { stage: string; items: string[]; total: number } | null;
  /** the bill ended where the correction would have put it */
  matches: boolean | null;
}

/**
 * The last `days` days' notes that came after another note of the same customer whose bill was made (≤ 3 days
 * before), and what this would have done — with how the bill really ended. Reads Page365 only (2 calls a bill).
 */
export async function previewCorrections(env: AutoEnv, opts: { days?: number; limit?: number; offset?: number } = {}): Promise<CorrectionPreview[]> {
  const from = new Date(Date.now() - (opts.days ?? 10) * 86_400_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT b.mid, b.at, b.text, b.fill_error, b.fill_order_no, a.mid AS a_mid, a.at AS a_at, a.text AS a_text, a.fill_order_no AS no
       FROM order_notes b JOIN order_notes a ON a.psid = b.psid AND a.at < b.at AND a.fill_order_no IS NOT NULL AND a.filled_at IS NOT NULL
        AND julianday(b.at) - julianday(a.at) <= 3
      WHERE b.at >= ? AND a.mid = (SELECT x.mid FROM order_notes x WHERE x.psid = b.psid AND x.at < b.at AND x.fill_order_no IS NOT NULL AND x.filled_at IS NOT NULL ORDER BY x.at DESC LIMIT 1)
      ORDER BY b.at DESC LIMIT ? OFFSET ?`,
  ).bind(from, opts.limit ?? 10, opts.offset ?? 0).all<{ mid: string; at: string; text: string; fill_error: string | null; fill_order_no: number | null; a_mid: string; a_at: string; a_text: string; no: number }>();
  const out: CorrectionPreview[] = [];
  for (const r of results) {
    const list = await call<{ orders: { id: number; no: number }[] }>(env, `orders.json?page=1&search=${r.no}`).catch(() => null);
    const hit = list?.orders.find((o) => o.no === r.no);
    const bill = hit ? await call<P365Order>(env, `orders/${hit.id}.json`).catch(() => null) : null;
    const gapMs = Date.parse(r.at) - Date.parse(r.a_at);
    const stage = (r.fill_error ?? '').includes('สรุปซ้ำ: ร่าง') ? 'draft' : bill?.stage ?? 'voided';
    // Decided against the bill as the earlier note made it (the earlier note's items), not as the admins left it.
    const was = expected(r.a_text);
    const asNoted = { items: billLike(r.a_text), total: was?.total ?? 0, cod: was?.cod ?? true };
    const decision = decide({ gapMs, billAgeMs: bill ? Date.parse(r.at) - Date.parse(bill.created_at) : 0, stage, noteText: r.text, bill: asNoted });
    const p = parseOrderNote(r.text);
    const q = parseOrderNote(r.a_text);
    const want = expected(r.text);
    out.push({
      note: { mid: r.mid, at: r.at, text: r.text, result: r.fill_error, order_no: r.fill_order_no },
      earlier: { mid: r.a_mid, at: r.a_at, text: r.a_text },
      bill: r.no, gap_min: Math.round(gapMs / 60_000), stage, decision,
      change: change(noteItems(r.a_text), noteItems(r.text)),
      total: [q?.total ?? null, p?.total ?? null], payment: [q?.payment ?? null, p?.payment ?? null],
      final: bill ? { stage: bill.stage, items: billItems(bill), total: Number(bill.total) } : null,
      matches: bill && want ? diff(want, bill).length === 0 : null,
    });
  }
  return out;
}

/** A note's items in the shape of a bill's (for deciding against the bill as that note filled it). */
function billLike(text: string): P365Order['items'] {
  return (parseOrderNote(text)?.items ?? []).map((i, k) => ({ id: k, name: i.code, note: null, price: 0, quantity: i.qty, variant: { id: k, code: `${i.code.replace(/[/-]/g, '')}-X-X-${i.size === 'F' ? 'FE' : i.size}`, product_id: k } }));
}
