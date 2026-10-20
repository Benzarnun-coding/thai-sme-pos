// Deleting Page365 drafts the order-note flow made and nobody will send (Benz 20 Oct). Off until Benz switches it
// on (meta_capi key draft_cleanup); the preview lists what it would delete. Only ever drafts linked to an order
// note, never a bill that has moved on:
// - a draft the customer cancelled (the chat reader said so), a day after the person was told (#29645, Benz);
// - a draft still without phone or postcode, or still empty, 7 days after the note (told once at day 5);
// - the earlier draft when the admin types a corrected summary within 2 hours (autoFill.ts ensureDraft) — the
//   corrected one replaces it.

import { tell, type AutoEnv } from './autoFill.ts';
import { call, type P365Order } from './p365fill.ts';

export async function cleanupOn(db: D1Database): Promise<boolean> {
  const r = await db.prepare("SELECT value FROM meta_capi WHERE key = 'draft_cleanup'").first<{ value: string }>().catch(() => null);
  return r?.value === 'on';
}

export async function setCleanup(db: D1Database, on: boolean): Promise<void> {
  await db.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('draft_cleanup', ?)").bind(on ? 'on' : 'off').run();
}

/** Deletes a draft (Page365's own DELETE, as its order screen does). Refuses anything that isn't a draft. */
export async function deleteDraft(env: AutoEnv, order: P365Order): Promise<void> {
  const now = await call<P365Order>(env, `orders/${order.id}.json`);
  if (now.stage !== 'draft') throw new Error(`#${order.no} ไม่ใช่ร่างแล้ว (${now.stage}) — ไม่ลบ`);
  await call(env, `orders/${order.id}.json`, { method: 'DELETE' });
}

export interface CleanupItem { no: number; reason: string; action: 'delete' | 'warn' | 'keep'; note_at: string }

const DAY = 86_400_000;
const phoneOk = (o: P365Order) => /^0\d{8,9}$/.test((o.customer_phone ?? '').replace(/\D/g, ''));
const zipOk = (o: P365Order) => /^\d{5}$/.test(o.structural_address?.postal_code ?? '');

/**
 * What would happen to the drafts behind the last 30 days of notes (at most `limit` bills checked per run, oldest
 * first). With `apply`, deletes and tells the problem channel; without, only lists.
 */
export async function cleanupDrafts(env: AutoEnv, opts: { apply: boolean; limit?: number }): Promise<CleanupItem[]> {
  const now = Date.now();
  // Page365's open drafts (newest first, 50 a page), those at least a day old…
  const drafts: { id: number; no: number; created_at: string }[] = [];
  for (let page = 1; page <= 4; page++) {
    const list = await call<{ orders: { id: number; no: number; stage: string; created_at: string }[] }>(env, `orders.json?page=${page}&stage=draft`);
    drafts.push(...list.orders.filter((o) => o.stage === 'draft' && now - Date.parse(o.created_at) >= DAY));
    if (list.orders.length < 50) break;
  }
  if (!drafts.length) return [];
  // …that an order note of the last 30 days points at.
  const { results } = await env.DB.prepare(
    `SELECT fill_order_no AS no, MIN(at) AS at, MAX(CASE WHEN instr(fill_error, 'ลูกค้าขอยกเลิก') > 0 THEN 1 ELSE 0 END) AS cancelled
       FROM order_notes WHERE at >= ? AND fill_order_no IN (SELECT value FROM json_each(?)) GROUP BY fill_order_no ORDER BY MIN(at) LIMIT ?`,
  ).bind(new Date(now - 30 * DAY).toISOString(), JSON.stringify(drafts.map((d) => d.no)), opts.limit ?? 12).all<{ no: number; at: string; cancelled: number }>();
  const out: CleanupItem[] = [];
  for (const r of results) {
    const hit = drafts.find((d) => d.no === r.no)!;
    const o = await call<P365Order>(env, `orders/${hit.id}.json`);
    const age = now - Date.parse(r.at);
    let reason = '';
    if (r.cancelled) reason = 'ลูกค้ายกเลิกในแชท';
    else if (!o.items.length || !phoneOk(o) || !zipOk(o)) reason = !o.items.length ? 'ร่างยังว่าง' : !phoneOk(o) ? 'ยังไม่มีเบอร์โทร' : 'ยังไม่มีรหัสไปรษณีย์';
    if (!reason) continue;
    const due = r.cancelled ? DAY : 7 * DAY;
    const action: CleanupItem['action'] = age >= due ? 'delete' : age >= due - 2 * DAY ? 'warn' : 'keep';
    out.push({ no: r.no, reason, action, note_at: r.at });
    if (!opts.apply || action === 'keep') continue;
    const blank = { mid: '', psid: '', at: r.at, text: '-', name_hash: null };
    if (action === 'warn') {
      const key = `stale_warned:${r.no}`;
      if (await env.DB.prepare('SELECT 1 FROM meta_capi WHERE key = ?').bind(key).first()) continue;
      await env.DB.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES (?, ?)").bind(key, new Date().toISOString()).run();
      await tell(env, blank, o, o.customer_name ?? '', [`${reason} — อีก 2 วันระบบจะลบร่างนี้ ถ้ายังไม่ได้ส่งบิล`]);
      continue;
    }
    await deleteDraft(env, o);
    await env.DB.prepare(`UPDATE order_notes SET fill_error = ? WHERE fill_order_no = ? AND filled_at IS NULL`).bind(`ต้องให้คนดู: ลบร่างแล้ว (${reason})`, r.no).run();
    await tell(env, blank, null, o.customer_name ?? '', [`ลบร่าง #${r.no} แล้ว: ${reason}`]);
  }
  return out;
}
