// Bills filled while the AI was out of credit (23 Oct: the $20/month workspace cap) went in with items and price but
// no address ("อ่านที่อยู่ไม่สำเร็จ: 400 … usage limits" in #ออเดอร์มีปัญหา). Benz asked to fill those addresses in
// once the cap was raised. Queued in meta_capi `address_refill` = {"nos":[bill nos]}; one bill per webhook delivery,
// once a minute. Only a bill that is still a draft and still has no complete address is touched — never one an
// admin already sent or addressed — and only its address: the items go back unchanged and are checked on read-back.

import { addressLine, readAddress, type ChatMessage } from './addressReader.ts';
import { orderLink, postOrderChannel, type AutoEnv } from './autoFill.ts';
import { audit } from './db.ts';
import { call, cleanStreet, draftAddress, validAddress, type P365Order } from './p365fill.ts';

const KEY = 'address_refill';

export async function refillStep(env: AutoEnv): Promise<number | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  const r = await env.DB.prepare('SELECT value FROM meta_capi WHERE key = ?').bind(KEY).first<{ value: string }>().catch(() => null);
  let nos: number[] = [];
  try { nos = r ? (JSON.parse(r.value) as { nos: number[] }).nos ?? [] : []; } catch { /* no job */ }
  if (!nos.length) return null;
  const last = await env.DB.prepare("SELECT value FROM meta_capi WHERE key = 'address_refill_at'").first<{ value: string }>().catch(() => null);
  if (last && Date.now() - Date.parse(last.value) < 60_000) return null;
  await env.DB.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('address_refill_at', ?)").bind(new Date().toISOString()).run();
  // Bills that need nothing (sent, or addressed by an admin) cost two requests each: up to 8 are passed over per
  // step, and the first one that needs its address read ends the step (that read + write is ~9 requests).
  for (let checked = 0; nos.length && checked < 8; checked++) {
    const no = nos.shift()!;
    await env.DB.prepare('INSERT OR REPLACE INTO meta_capi (key, value) VALUES (?, ?)').bind(KEY, JSON.stringify({ nos })).run();
    const r = await refillOne(env, no);
    if (r === 'worked') return no;
  }
  return null;
}

async function refillOne(env: AutoEnv & { ANTHROPIC_API_KEY?: string }, no: number): Promise<'skipped' | 'worked'> {
  const done = (outcome: string, extra: object = {}) => audit(env.DB, 'ai', 'address.refill', String(no), { outcome, ...extra }).then(() => 'skipped' as const);
  const list = await call<{ orders: { id: number; no: number }[] }>(env, `orders.json?page=1&search=${no}`).catch(() => null);
  const hit = list?.orders.find((o) => o.no === no);
  if (!hit) return done('not found');
  const order = await call<P365Order>(env, `orders/${hit.id}.json`);
  if (order.stage !== 'draft') return done(`already ${order.stage}`);
  if (draftAddress(order)) return done('has address');
  if (!order.conversation_id) return done('no chat');
  const chat = (await call<{ messages: ChatMessage[] }>(env, `conversations/${order.conversation_id}.json`).catch(() => null))?.messages ?? [];
  const note = await env.DB.prepare('SELECT text FROM order_notes WHERE fill_order_no = ? ORDER BY at DESC LIMIT 1').bind(no).first<{ text: string }>();
  const read = await readAddress(env.ANTHROPIC_API_KEY!, chat, env.ADDRESS_MODEL, env.ANTHROPIC_WORKSPACE_ID, note?.text ?? '');
  await audit(env.DB, 'ai', 'address.read', String(no), read.usage).catch(() => null);
  const name = (order.customer_name ?? '').replace(/^[A-Z]{1,3}-\d{4}\s+/, '');
  const a = validAddress({ ...read, name: read.name || name, source: 'chat' });
  const bill = `[#${order.no}](<${orderLink(env, order.id)}>)`;
  if (!a) {
    await postOrderChannel(env, (m) => [`📍 ลองอ่านที่อยู่ใหม่แล้ว ยังไม่ครบ ${m}`.trim(), `ลูกค้า: **${name || 'ไม่ทราบชื่อ'}** · บิล ${bill}`, ...read.problems.slice(0, 4).map((p) => `• ${p}`), '• กรอกที่อยู่เองในร่าง'].join('\n').slice(0, 2000));
    await done('unreadable', { problems: read.problems.length });
    return 'worked';
  }
  const street = cleanStreet(a.street, [a.name, order.customer_name ?? ''], a.phone);
  const items = order.items.map((i) => ({ id: i.id, name: i.name, note: i.note, price: i.price, quantity: i.quantity, product_id: i.variant?.id ?? null }));
  await call(env, `orders/${order.id}.json`, { method: 'PUT', body: {
    order: { stage: 'draft', customer_phone: a.phone, customer_address: addressLine({ ...a, street }), structural_address: { street, subdistrict: a.subdistrict, district: a.district, province: a.province, postal_code: a.postal_code } },
    order_items: items,
  } });
  const back = await call<P365Order>(env, `orders/${order.id}.json`);
  const key = (o: P365Order) => o.items.map((i) => `${i.variant?.code}×${i.quantity}@${i.price}`).sort().join(',');
  const same = key(back) === key(order) && Number(back.total) === Number(order.total);
  await postOrderChannel(env, (m) => [
    (same ? `📍 เติมที่อยู่ให้แล้ว (บิลรอบที่ AI หมดโควต้า) ช่วยเช็กก่อนส่งบิล ${m}` : `⚠️ เติมที่อยู่แล้ว แต่สินค้า/ยอดในร่างเปลี่ยน — เปิดดูด่วน ${m}`).trim(),
    `ลูกค้า: **${name || 'ไม่ทราบชื่อ'}** · บิล ${bill}`,
    ...read.problems.slice(0, 4).map((p) => `• ${p}`),
  ].join('\n').slice(0, 2000));
  await done(same ? 'filled' : 'filled, items changed');
  return 'worked';
}
