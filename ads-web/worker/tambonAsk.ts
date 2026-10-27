// A bill filled without ตำบล/แขวง (Benz 27 Oct: "ถามไปเลยแล้วแอดเข้าในระบบ"): the customer is asked in the chat,
// with the subdistricts their district + postcode can be, and their answer is written into the bill. A postcode
// alone almost never tells the ตำบล (dry run 27 Oct: the picker found 15 of 216, 3 of them wrong), so nobody guesses.
//
// Switch: meta_capi `tambon_ask` = "on" sends; anything else (default) is a dry run — the question is built and
// kept in `tambon_ask_dry` for Benz to read, nothing is sent. A question sent is remembered in
// `tambon_ask:<psid>` = {no, id, at, mid} (bill and time only, no address); the customer's next messages within
// 2 days are read in the webhook (raw text, not stored) for a number or a subdistrict name of that list. A match on a
// draft or unpaid bill → ตำบล written (the items go back unchanged, read back) and #ออเดอร์มีปัญหา told; a bill
// further on, or an answer the reader can't match → a person is told once.

import { addressLine } from './addressReader.ts';
import { orderLink, postOrderChannel, type AutoEnv } from './autoFill.ts';
import { audit } from './db.ts';
import { call, type P365Order } from './p365fill.ts';
import { bare, subdistrictsOf } from './thaiAddress.ts';
import { sendPageMessage, type WebhookEnv } from './webhook.ts';

const ASK_MS = 2 * 86_400_000;
const LIST_MAX = 12;
const EDIT = new Set(['draft', 'unpaid']);

export type AskEnv = AutoEnv & WebhookEnv;

/** Is this bill's address complete but for its ตำบล? */
export function missingTambon(o: Pick<P365Order, 'structural_address'>): boolean {
  const s = o.structural_address;
  return !!s && !!s.district && /^\d{5}$/.test(s.postal_code ?? '') && !(s.subdistrict ?? '').trim();
}

/** The question, as the shop writes: the district + postcode the customer gave and the subdistricts to pick from. */
export function askText(s: { district: string | null; province: string | null; postal_code: string | null }, cands: string[]): string {
  const bkk = /กรุงเทพ/.test(s.province ?? '');
  const [sub, dist] = bkk ? ['แขวง', 'เขต'] : ['ตำบล', 'อ.'];
  const where = [`${dist}${bare(s.district ?? '')}`, bkk ? 'กรุงเทพฯ' : s.province ? `จ.${bare(s.province)}` : '', s.postal_code ?? ''].filter(Boolean).join(' ');
  const head = `ขอบคุณที่สั่งซื้อนะคะ 🙏 รบกวนขอ${sub}สำหรับจัดส่งเพิ่มอีกนิดค่ะ (${where})`;
  if (!cands.length || cands.length > LIST_MAX) return `${head}\nพิมพ์ชื่อ${sub}มาได้เลยค่ะ`;
  return `${head}\n${cands.map((c, i) => `${i + 1}. ${c}`).join('\n')}\nตอบเป็นเลขหรือชื่อ${sub}ได้เลยค่ะ`;
}

/** The customer's answer → one subdistrict of the list, or null. "2", "ข้อ 2", "ต.หนองบัว", "หนองบัวค่ะ". */
export function matchReply(text: string, cands: string[]): string | null {
  const t = text.trim();
  const num = t.match(/^(?:ข้อ|เลข|ตัวเลือก)?\s*(\d{1,2})\s*(?:ค่ะ|คะ|ครับ|นะคะ|นะ|จ้า|จ้ะ)?\s*$/);
  if (num && cands.length <= LIST_MAX) return cands[Number(num[1]) - 1] ?? null;
  const flat = t.replace(/\s+/g, '');
  const hits = cands.filter((c) => c.length >= 2 && flat.includes(c));
  const longest = hits.filter((h) => !hits.some((o) => o !== h && o.includes(h)));
  return longest.length === 1 ? longest[0] : null;
}

async function mode(db: D1Database): Promise<'on' | 'dry'> {
  const r = await db.prepare("SELECT value FROM meta_capi WHERE key = 'tambon_ask'").first<{ value: string }>().catch(() => null);
  return r?.value === 'on' ? 'on' : 'dry';
}

/** After a fill: ask when the bill went in without ตำบล. Returns what was done. */
export async function askTambon(env: AskEnv, order: P365Order, psid: string): Promise<'sent' | 'dry' | 'skip'> {
  if (!missingTambon(order) || !psid) return 'skip';
  const s = order.structural_address!;
  const key = `tambon_ask:${psid}`;
  const had = await env.DB.prepare('SELECT value FROM meta_capi WHERE key = ?').bind(key).first<{ value: string }>().catch(() => null);
  if (had && JSON.parse(had.value).no === order.no) return 'skip';
  const cands = subdistrictsOf(s.district ?? '', s.province ?? '', s.postal_code ?? '');
  const text = askText(s, cands);
  if ((await mode(env.DB)) !== 'on') {
    const r = await env.DB.prepare("SELECT value FROM meta_capi WHERE key = 'tambon_ask_dry'").first<{ value: string }>().catch(() => null);
    const rows: { no: number; at: string; text: string }[] = r ? JSON.parse(r.value) : [];
    if (!rows.some((x) => x.no === order.no)) rows.push({ no: order.no, at: new Date().toISOString(), text });
    await env.DB.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('tambon_ask_dry', ?)").bind(JSON.stringify(rows.slice(-50))).run();
    await audit(env.DB, 'auto', 'tambon.ask', String(order.no), { dry: true, candidates: cands.length }).catch(() => null);
    return 'dry';
  }
  const mid = await sendPageMessage(env, psid, text);
  await env.DB.prepare('INSERT OR REPLACE INTO meta_capi (key, value) VALUES (?, ?)').bind(key, JSON.stringify({ no: order.no, id: order.id, at: new Date().toISOString(), mid })).run();
  await audit(env.DB, 'auto', 'tambon.ask', String(order.no), { sent: true, candidates: cands.length }).catch(() => null);
  return 'sent';
}

/** Customers' own messages in a webhook delivery (raw text, read here only). */
export function customerTexts(entries: { messaging?: any[]; standby?: any[] }[]): { psid: string; text: string }[] {
  const out: { psid: string; text: string }[] = [];
  for (const e of entries) for (const ev of [...(e.messaging ?? []), ...(e.standby ?? [])]) {
    if (ev.message?.is_echo || !ev.message?.text || !ev.sender?.id) continue;
    out.push({ psid: ev.sender.id, text: ev.message.text });
  }
  return out;
}

/** An answer to a ตำบล question: written into the bill, or a person told. */
export async function tambonReply(env: AskEnv, psid: string, text: string): Promise<string | null> {
  const key = `tambon_ask:${psid}`;
  const r = await env.DB.prepare('SELECT value FROM meta_capi WHERE key = ?').bind(key).first<{ value: string }>().catch(() => null);
  if (!r) return null;
  const ask = JSON.parse(r.value) as { no: number; id: number; at: string; told?: boolean };
  if (Date.now() - Date.parse(ask.at) > ASK_MS) { await env.DB.prepare('DELETE FROM meta_capi WHERE key = ?').bind(key).run(); return 'expired'; }
  const order = await call<P365Order>(env, `orders/${ask.id}.json`);
  const bill = `[#${order.no}](<${orderLink(env, order.id)}>)`;
  const done = async (outcome: string) => { await env.DB.prepare('DELETE FROM meta_capi WHERE key = ?').bind(key).run(); await audit(env.DB, 'auto', 'tambon.reply', String(order.no), { outcome }).catch(() => null); return outcome; };
  if (!missingTambon(order)) return done('already filled');
  const s = order.structural_address!;
  const sub = matchReply(text, subdistrictsOf(s.district ?? '', s.province ?? '', s.postal_code ?? ''));
  if (!sub) {
    // Not every message is the answer ("ได้ค่ะ", a sticker): a person is told once, the question stays open.
    if (!ask.told) {
      await env.DB.prepare('INSERT OR REPLACE INTO meta_capi (key, value) VALUES (?, ?)').bind(key, JSON.stringify({ ...ask, told: true })).run();
      await postOrderChannel(env, (m) => `📍 ถามตำบลลูกค้าแล้ว แต่ระบบอ่านคำตอบไม่ออก — ช่วยดูแชทแล้วกรอกเอง ${m}\nบิล ${bill}`.trim());
    }
    return 'unmatched';
  }
  if (!EDIT.has(order.stage)) {
    await postOrderChannel(env, (m) => `📍 ลูกค้าตอบตำบลแล้ว: **${sub}** แต่บิลเลยขั้นที่ระบบแก้ได้ — กรอกเองด้วย ${m}\nบิล ${bill}`.trim());
    return done(`told: ${order.stage}`);
  }
  const structural_address = { ...s, subdistrict: sub };
  const items = order.items.map((i) => ({ id: i.id, name: i.name, note: i.note, price: i.price, quantity: i.quantity, product_id: i.variant?.id ?? null }));
  await call(env, `orders/${order.id}.json`, { method: 'PUT', body: { order: { stage: order.stage, customer_address: addressLine({ street: s.street ?? '', subdistrict: sub, district: s.district ?? '', province: s.province ?? '', postal_code: s.postal_code ?? '' }), structural_address }, order_items: items } });
  const back = await call<P365Order>(env, `orders/${order.id}.json`);
  const key2 = (o: P365Order) => o.items.map((i) => `${i.variant?.code}×${i.quantity}@${i.price}`).sort().join(',');
  const ok = (back.structural_address?.subdistrict ?? '') === sub && key2(back) === key2(order) && Number(back.total) === Number(order.total);
  await postOrderChannel(env, (m) => (ok ? `📍 ลูกค้าตอบตำบลแล้ว เติมให้: ต.${sub} · บิล ${bill}` : `⚠️ เติมตำบลแล้ว แต่ร่างดูไม่ตรง — เปิดดูด่วน ${m}\nบิล ${bill}`).trim());
  return done(ok ? 'filled' : 'filled, check');
}

/** Bills filled before this existed: meta_capi `tambon_ask_queue` = {"nos":[…]}, one a minute on webhook deliveries. */
export async function askQueueStep(env: AskEnv): Promise<number | null> {
  const r = await env.DB.prepare("SELECT value FROM meta_capi WHERE key = 'tambon_ask_queue'").first<{ value: string }>().catch(() => null);
  let nos: number[] = [];
  try { nos = r ? (JSON.parse(r.value) as { nos: number[] }).nos ?? [] : []; } catch { /* none */ }
  if (!nos.length) return null;
  const last = await env.DB.prepare("SELECT value FROM meta_capi WHERE key = 'tambon_ask_queue_at'").first<{ value: string }>().catch(() => null);
  if (last && Date.now() - Date.parse(last.value) < 60_000) return null;
  await env.DB.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('tambon_ask_queue_at', ?)").bind(new Date().toISOString()).run();
  const no = nos.shift()!;
  await env.DB.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('tambon_ask_queue', ?)").bind(JSON.stringify({ nos })).run();
  const list = await call<{ orders: { id: number; no: number }[] }>(env, `orders.json?page=1&search=${no}`).catch(() => null);
  const hit = list?.orders.find((o) => o.no === no);
  if (!hit) return no;
  const order = await call<P365Order>(env, `orders/${hit.id}.json`);
  // Paid but not shipped is asked too: the answer then goes to a person to type in.
  if (['draft', 'unpaid', 'transferred', 'paid'].includes(order.stage) && order.customer_fbid) await askTambon(env, order, order.customer_fbid).catch((err) => console.error('tambon ask', err));
  return no;
}
