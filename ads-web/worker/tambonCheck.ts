// Dry run (Benz 26 Oct): bills the order-note flow filled before the ตำบล fix (0e21e63) may have gone in with
// Page365's own address and ตำบล/แขวง blank. For each bill: is ตำบล blank, what stage is it in, and what would be
// filled — from the address book when the district + postcode allow only one, else read from the chat (only for
// bills not yet shipped; a shipped parcel can't be changed). Nothing is written to Page365. Queued in meta_capi
// `tambon_check` = {"nos":[…]}; results in `tambon_check_result` (bill no, stage, outcome, proposed ต./อ. only —
// no street, name or phone), deleted once Benz has seen them. One step per webhook delivery a minute.

import { readAddressTiered, type ChatMessage } from './addressReader.ts';
import { audit } from './db.ts';
import { call, type FillEnv, type P365Order } from './p365fill.ts';
import { completeAddress, subdistrictsOf } from './thaiAddress.ts';

const KEY = 'tambon_check';
const OUT = 'tambon_check_result';
const OPEN = new Set(['draft', 'unpaid', 'transferred', 'paid']);

export interface TambonRow { no: number; stage: string; outcome: 'has' | 'not found' | 'no address' | 'book' | 'chat' | 'chat none' | 'chat doubt' | 'shipped blank' | 'error'; sub?: string; dist?: string; why?: string }

/** Without the AI: has ตำบล / can only be one / needs the chat / shipped (left as it is). */
export function classify(o: Pick<P365Order, 'no' | 'stage' | 'structural_address'>): TambonRow | null {
  const s = o.structural_address;
  if (!s || !s.district || !/^\d{5}$/.test(s.postal_code ?? '')) return { no: o.no, stage: o.stage, outcome: 'no address' };
  if ((s.subdistrict ?? '').trim()) return { no: o.no, stage: o.stage, outcome: 'has' };
  const subs = subdistrictsOf(s.district, s.province ?? '', s.postal_code ?? '');
  if (subs.length === 1) return { no: o.no, stage: o.stage, outcome: 'book', sub: subs[0], dist: s.district };
  if (!OPEN.has(o.stage)) return { no: o.no, stage: o.stage, outcome: 'shipped blank', dist: s.district };
  return null; // open bill, needs the chat
}

async function push(db: D1Database, row: TambonRow): Promise<void> {
  const r = await db.prepare('SELECT value FROM meta_capi WHERE key = ?').bind(OUT).first<{ value: string }>().catch(() => null);
  const rows: TambonRow[] = r ? JSON.parse(r.value) : [];
  rows.push(row);
  await db.prepare('INSERT OR REPLACE INTO meta_capi (key, value) VALUES (?, ?)').bind(OUT, JSON.stringify(rows)).run();
}

export async function tambonStep(env: FillEnv & { DB: D1Database }): Promise<number | null> {
  const r = await env.DB.prepare('SELECT value FROM meta_capi WHERE key = ?').bind(KEY).first<{ value: string }>().catch(() => null);
  let nos: number[] = [];
  try { nos = r ? (JSON.parse(r.value) as { nos: number[] }).nos ?? [] : []; } catch { /* no job */ }
  if (!nos.length) return null;
  const last = await env.DB.prepare("SELECT value FROM meta_capi WHERE key = 'tambon_check_at'").first<{ value: string }>().catch(() => null);
  if (last && Date.now() - Date.parse(last.value) < 60_000) return null;
  await env.DB.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('tambon_check_at', ?)").bind(new Date().toISOString()).run();
  // Two requests a bill without the AI: up to 8 per step; a chat read (~6 requests) ends the step.
  for (let checked = 0; nos.length && checked < 8; checked++) {
    const no = nos.shift()!;
    await env.DB.prepare('INSERT OR REPLACE INTO meta_capi (key, value) VALUES (?, ?)').bind(KEY, JSON.stringify({ nos })).run();
    const read = await checkOne(env, no).catch((err) => { void push(env.DB, { no, stage: '?', outcome: 'error', why: String(err?.message ?? err).slice(0, 120) }); return false; });
    if (read) return no;
  }
  return -1;
}

/** true when the chat was read (the step ends there). */
async function checkOne(env: FillEnv & { DB: D1Database }, no: number): Promise<boolean> {
  const list = await call<{ orders: { id: number; no: number }[] }>(env, `orders.json?page=1&search=${no}`).catch(() => null);
  const hit = list?.orders.find((o) => o.no === no);
  if (!hit) { await push(env.DB, { no, stage: '?', outcome: 'not found' }); return false; }
  const order = await call<P365Order>(env, `orders/${hit.id}.json`);
  const row = classify(order);
  if (row) { await push(env.DB, row); return false; }
  const s = order.structural_address!;
  const chat = order.conversation_id ? (await call<{ messages: ChatMessage[] }>(env, `conversations/${order.conversation_id}.json`).catch(() => null))?.messages ?? [] : [];
  const note = await env.DB.prepare('SELECT text FROM order_notes WHERE fill_order_no = ? AND (? IS NULL OR psid = ?) ORDER BY at DESC LIMIT 1').bind(no, order.customer_fbid, order.customer_fbid).first<{ text: string }>();
  const a = await readAddressTiered(env.ANTHROPIC_API_KEY!, chat, { cheap: env.ADDRESS_MODEL, strong: env.ADDRESS_MODEL_HARD, workspaceId: env.ANTHROPIC_WORKSPACE_ID, orderNote: note?.text ?? '' });
  for (const u of a.usages) await audit(env.DB, 'ai', 'address.read', String(no), u).catch(() => null);
  if (!a.subdistrict.trim()) { await push(env.DB, { no, stage: order.stage, outcome: 'chat none', dist: s.district ?? '' }); return true; }
  // The ตำบล from the chat must sit in the bill's own district + postcode (the bill's address is what was checked).
  const { doubt } = completeAddress({ subdistrict: a.subdistrict, district: s.district ?? '', province: s.province ?? '', postal_code: s.postal_code ?? '' });
  await push(env.DB, { no, stage: order.stage, outcome: doubt ? 'chat doubt' : 'chat', sub: a.subdistrict, dist: s.district ?? '', ...(doubt ? { why: doubt } : {}) });
  return true;
}
