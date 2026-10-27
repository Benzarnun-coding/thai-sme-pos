// Bills left half-filled by the repeated-product bug (#30797, fixed 033f3ab 27 Oct): two lines of one model went
// in as one item at its first size, and the fill stopped before the price, shipping and address. Benz 27 Oct:
// "แก้ให้หมดเลย". Queued in meta_capi `bill_repair` = {"nos":[…]}; one bill a minute (cron). A bill still in draft
// or unpaid gets its items, shipping and discount rewritten to the admin's note (rewriteBill, read back) unless an
// admin already put the right items in; a draft without a complete address then joins the address refill queue
// (addressRefill.ts: chat read, address only). Bills an admin moved on are left alone. Each bill is told to
// #ออเดอร์มีปัญหา and logged in `audit` (action bill.repair).

import { orderLink, postOrderChannel, type AutoEnv } from './autoFill.ts';
import { audit } from './db.ts';
import { diff, expected } from './fillAudit.ts';
import { EDIT_STAGES, rewriteBill, stageTh } from './noteCorrection.ts';
import { call, draftAddress, type P365Order } from './p365fill.ts';

const KEY = 'bill_repair';

export async function repairStep(env: AutoEnv): Promise<number | null> {
  const r = await env.DB.prepare('SELECT value FROM meta_capi WHERE key = ?').bind(KEY).first<{ value: string }>().catch(() => null);
  let nos: number[] = [];
  try { nos = r ? (JSON.parse(r.value) as { nos: number[] }).nos ?? [] : []; } catch { /* no job */ }
  if (!nos.length) return null;
  const no = nos.shift()!;
  // Off the list before the work: a bill that fails isn't retried every minute.
  await env.DB.prepare('INSERT OR REPLACE INTO meta_capi (key, value) VALUES (?, ?)').bind(KEY, JSON.stringify({ nos })).run();
  const outcome = await repairOne(env, no).catch((err) => `error: ${String(err?.message ?? err).slice(0, 200)}`);
  await audit(env.DB, 'auto', 'bill.repair', String(no), { outcome }).catch(() => null);
  return no;
}

async function repairOne(env: AutoEnv, no: number): Promise<string> {
  const list = await call<{ orders: { id: number; no: number }[] }>(env, `orders.json?page=1&search=${no}`).catch(() => null);
  const hit = list?.orders.find((o) => o.no === no);
  if (!hit) return 'not found';
  const order = await call<P365Order>(env, `orders/${hit.id}.json`);
  if (!EDIT_STAGES.has(order.stage)) return `left: ${order.stage}`;
  // This customer's note only (bill numbers get reused after a deleted draft).
  const note = await env.DB.prepare('SELECT mid, psid, at, text FROM order_notes WHERE fill_order_no = ? AND (? IS NULL OR psid = ?) ORDER BY at DESC LIMIT 1')
    .bind(no, order.customer_fbid, order.customer_fbid).first<{ mid: string; psid: string; at: string; text: string }>();
  if (!note) return 'no note';
  const want = expected(note.text);
  const bill = `[#${order.no}](<${orderLink(env, order.id)}>)`;
  let did = 'items already right';
  let now = order;
  if (!want || diff(want, order).length) {
    now = (await rewriteBill(env, note, order)).order;
    did = 'items rewritten';
  }
  const needsAddress = order.stage === 'draft' && !draftAddress(now);
  if (needsAddress) {
    const q = await env.DB.prepare("SELECT value FROM meta_capi WHERE key = 'address_refill'").first<{ value: string }>().catch(() => null);
    let refill: number[] = [];
    try { refill = q ? (JSON.parse(q.value) as { nos: number[] }).nos ?? [] : []; } catch { /* none */ }
    if (!refill.includes(no)) refill.push(no);
    await env.DB.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('address_refill', ?)").bind(JSON.stringify({ nos: refill })).run();
  }
  await env.DB.prepare('UPDATE order_notes SET filled_at = ?, fill_error = NULL WHERE mid = ?').bind(new Date().toISOString(), note.mid).run();
  await postOrderChannel(env, (m) => [
    `🔧 ซ่อมบิลที่ใส่ไม่ครบ (สินค้ารุ่นเดียวกันหลายบรรทัด) ช่วยเช็กก่อนส่งบิล ${m}`.trim(),
    `บิล ${bill} · ${stageTh(order.stage)} · ${did === 'items rewritten' ? 'ใส่สินค้า/ไซส์/ราคาตามสรุปแล้ว' : 'สินค้าถูกอยู่แล้ว'}${needsAddress ? ' · ที่อยู่จะเติมจากแชทในอีกไม่กี่นาที' : ''}`,
  ].join('\n').slice(0, 2000));
  return did + (needsAddress ? ', address queued' : '');
}
