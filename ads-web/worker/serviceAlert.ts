// Customer-service alerts (Benz 2026-10-20, after answer-bank fix #13: the bot answered a "wrong item, refund"
// complaint with its own refund policy and the customer got angrier). The moment a customer's message reads as a
// complaint, a refund, a wrong / not-as-pictured item, asks a leg length the bot doesn't know (fix #14) or a waist that may not be made (fix #15), the bot posts it to Discord "service ลูกค้า" with the
// customer's Facebook name (so Fear can search the inbox) and tags Fear; whoever answered presses "จัดการจบแล้ว".
// One open case per customer. The name goes to Discord only; D1 keeps the redacted text like chat_messages.
// Nothing here replies to the customer. Switched on by the secret DISCORD_SERVICE_WEBHOOK_URL.

import type { ChatRow } from './chatLog.ts';
import { idList } from './discord.ts';
import { pageOf, type WebhookEnv } from './webhook.ts';

export interface ServiceEnv extends WebhookEnv {
  DISCORD_BOT_TOKEN?: string;
  /** "service ลูกค้า" channel webhook (secret): the switch, and where the bot finds the channel */
  DISCORD_SERVICE_WEBHOOK_URL?: string;
  /** Who answers the customers (Fear); tagged and may press "จัดการจบแล้ว" with the approvers */
  DISCORD_SERVICE_IDS?: string;
  DISCORD_APPROVER_IDS?: string;
}

// "…ไหม/มั้ย" after it = a question before buying ("จะไม่ตรงปกไหม"), not a complaint.
const NOT_Q = String.raw`(?!\s*(?:ไหม|มั้ย|มัย|รึเปล่า|หรือเปล่า|ป่าว|หรือไม่))`;
const REASONS: [string, RegExp][] = [
  ['ขอคืนเงิน', /คืนเงิน|เงินคืน|โอนคืน|refund/i],
  ['สินค้าไม่ตรงปก', new RegExp(`(?:ไม่ตรงปก|ไม่ตรงกับ(?:รูป|ภาพ|ที่สั่ง)|ไม่เหมือน(?:ใน)?(?:รูป|ภาพ))${NOT_Q}`)],
  ['ส่งผิด', new RegExp(`(?:ส่ง(?:มา)?ผิด|ได้(?:ของ|สินค้า|รับ(?:ของ)?)?ผิด|ผิด(?:แบบ|รุ่น|สี|ไซส์|ไซซ์)|สั่ง[^\\n]{0,30}แต่ได้)${NOT_Q}`)],
  ['ขอคืน/เปลี่ยนสินค้า', /(?:คืน|เปลี่ยน)(?:สินค้า|ของ)|ส่ง(?:ของ|สินค้า)?คืน|เคลม/],
  ['ร้องเรียน', /ร้องเรียน|ไม่พอใจ|ผิดหวัง|โกง|หลอกลวง|แย่มาก|ชำรุด|ของเสีย|(?:เก็บ|ตัด)เงินซ้ำ|เก็บเงิน\s?2\s?(?:ครั้ง|รอบ)/],
  // Answer-bank fix #14 (Benz 2026-10-20): the bot made up "ขากว้าง 10 นิ้ว / ยาว 16 นิ้วทุกไซส์". A question about a
  // length or width needs a number ("…กี่นิ้ว", "…เท่าไหร่"), so "อยากได้ขากว้าง" (the wide-leg cut) is not one.
  ['ถามความยาว/ปลายขา', /(?:ยาว|ปลายขา|ขากว้าง|กว้าง|ขา)[^\n]{0,15}(?:กี่|เท่าไ)/],
  // Fix #15: the bot took orders for waists not made (31 / 33 / 35, 27, 43). Odd waists 27–43 and 44+ are passed to
  // a person, who checks the model's real sizes; the even ones the shop makes are left to the bot.
  ['ขอไซส์ที่อาจไม่มี', /(?:เอว|ไซส์|ไซซ์|ไซต์|ไซ้|size|sz)\s*(?:2[79]|3[13579]|4[13]|4[4-9]|[5-9]\d)(?!\d)/i],
];

/** Why a customer's message needs a person, or null. */
export function serviceReason(text: string | null): string | null {
  if (!text) return null;
  for (const [label, re] of REASONS) if (re.test(text)) return label;
  return null;
}

const bkk = (iso: string) => new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().replace(/^\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d).*/, '$2/$1 $3');

const HINT: Record<string, string> = {
  'ถามความยาว/ปลายขา': 'บอทไม่มีข้อมูลความยาวขา/ปลายขา ห้ามเดาตัวเลข',
  'ขอไซส์ที่อาจไม่มี': 'เช็กว่ารุ่นที่ลูกค้าสนใจมีไซส์นี้จริง บอทห้ามรับออเดอร์ไซส์ที่ไม่มี',
};

export function serviceMessage(c: { id: number; at: string; reason: string; text: string | null }, name: string | null, mention: string, withButton: boolean): { content: string; components?: unknown[] } {
  const lines = [
    `🆘 **service ลูกค้า #${c.id} · ${c.reason}** ${mention ? `คุณ ${mention} ` : ''}ช่วยเข้าไปตอบลูกค้าหน่อยค่ะ 🙏`,
    `👤 **ชื่อในเฟซ:** ${name ?? '(Meta ไม่ให้ชื่อ — ค้นจากเวลาใน inbox)'}`,
    `🕑 **ทักเมื่อ:** ${bkk(c.at)} น.`,
    `💬 **ลูกค้าพิมพ์:** ${(c.text ?? '').replace(/\s+/g, ' ').slice(0, 600)}`,
    (HINT[c.reason] ?? 'เรื่องคืนเงิน/ส่งผิด/ไม่ตรงปก บอทห้ามตอบนโยบายเอง') + ' — ตอบลูกค้าใน Page365 แล้ว' + (withButton ? 'กด **✅ จัดการจบแล้ว** ค่ะ' : 'ตอบใต้ข้อความนี้ว่าจัดการแล้วค่ะ (ปุ่มยังไม่ขึ้น: ต้องเพิ่มบอทเข้าห้องนี้)'),
  ];
  return {
    content: lines.join('\n').slice(0, 1950),
    ...(withButton ? { components: [{ type: 1, components: [{ type: 2, style: 3, label: '✅ จัดการจบแล้ว', custom_id: `svcdone:${c.id}` }] }] } : {}),
  };
}

/** Called for every webhook delivery: opens a case and posts it for each complaining customer without an open one. */
export async function serviceAlerts(env: ServiceEnv & { DB: D1Database }, rows: ChatRow[], nameOf = (psid: string) => customerName(env, psid)): Promise<number> {
  if (!env.DISCORD_SERVICE_WEBHOOK_URL) return 0;
  const hits = new Map<string, { row: ChatRow; reason: string }>();
  for (const r of rows) {
    const reason = r.from_page ? null : serviceReason(r.text);
    if (reason && !hits.has(r.psid)) hits.set(r.psid, { row: r, reason });
  }
  let posted = 0;
  for (const { row, reason } of [...hits.values()].slice(0, 3)) {
    // Meta may deliver the same message twice; only the insert that wins posts.
    const c = await env.DB.prepare(`INSERT INTO service_cases (psid, opened_at, reason, text, status)
      SELECT ?1, ?2, ?3, ?4, 'open' WHERE NOT EXISTS (SELECT 1 FROM service_cases WHERE psid = ?1 AND status = 'open') RETURNING id`)
      .bind(row.psid, row.at, reason, row.text).first<{ id: number }>();
    if (!c) continue;
    const name = await nameOf(row.psid).catch(() => null);
    const ids = idList(env.DISCORD_SERVICE_IDS);
    const mention = ids.map((id) => `<@${id}>`).join(' ');
    const sent = await postCase(env, { id: c.id, at: row.at, reason, text: row.text }, name, mention, ids);
    if (sent) {
      await env.DB.prepare('UPDATE service_cases SET channel_id = ?, message_id = ? WHERE id = ?').bind(sent.channel_id, sent.message_id, c.id).run();
      posted++;
    }
  }
  return posted;
}

/**
 * The customer's Facebook name. Meta refuses the profile lookup ("missing permissions") for most customers
 * (checked 2026-10-20 on a real one), but the page's conversation with them lists the name — so that is asked next.
 */
export async function customerName(env: ServiceEnv, psid: string): Promise<string | null> {
  const pg = await pageOf(env);
  if (!pg) return null;
  const graph = `https://graph.facebook.com/${env.META_API_VERSION ?? 'v21.0'}`;
  const token = encodeURIComponent(pg.token);
  const res = await fetch(`${graph}/${psid}?fields=name&access_token=${token}`);
  const body: any = await res.json().catch(() => ({}));
  if (typeof body.name === 'string' && body.name.trim()) return body.name.trim();
  const conv: any = await fetch(`${graph}/${pg.id}/conversations?platform=messenger&user_id=${encodeURIComponent(psid)}&fields=participants&access_token=${token}`).then((r) => r.json()).catch(() => ({}));
  const who = (conv.data?.[0]?.participants?.data ?? []).find((x: any) => x?.id === psid);
  return typeof who?.name === 'string' && who.name.trim() ? who.name.trim() : null;
}

/** The bot posts (so the button works) in the webhook's channel; if it can't, the webhook posts without a button. */
async function postCase(env: ServiceEnv, c: Parameters<typeof serviceMessage>[0], name: string | null, mention: string, ids: string[]): Promise<{ channel_id: string; message_id: string } | null> {
  const hook = env.DISCORD_SERVICE_WEBHOOK_URL!;
  const info: any = await fetch(hook).then((r) => r.json()).catch(() => ({}));
  const channel = typeof info.channel_id === 'string' ? info.channel_id : '';
  const allowed_mentions = { users: ids };
  if (env.DISCORD_BOT_TOKEN && channel) {
    const res = await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...serviceMessage(c, name, mention, true), allowed_mentions }),
    });
    if (res.ok) return { channel_id: channel, message_id: ((await res.json()) as { id: string }).id };
    console.error('discord service post', res.status, await res.text());
  }
  const res = await fetch(`${hook}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...serviceMessage(c, name, mention, false), allowed_mentions }),
  });
  if (!res.ok) { console.error('discord service webhook', res.status, await res.text()); return null; }
  return { channel_id: channel, message_id: ((await res.json()) as { id: string }).id };
}

/** "จัดการจบแล้ว": closes the case; the message keeps its text and says who closed it. Null = no such open case. */
export async function closeCase(db: D1Database, id: number, who: string): Promise<{ id: number } | null> {
  return db.prepare(`UPDATE service_cases SET status = 'done', closed_by = ?, closed_at = ? WHERE id = ? AND status = 'open' RETURNING id`)
    .bind(who, new Date().toISOString(), id).first<{ id: number }>();
}

/** Dry run over the stored chats: what would have been posted in the last `days` days (one per customer). */
export async function servicePreview(db: D1Database, days = 7, now = new Date()): Promise<{ at: string; reason: string; text: string | null }[]> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const { results } = await db.prepare('SELECT psid, at, text FROM chat_messages WHERE from_page = 0 AND at >= ? AND text IS NOT NULL ORDER BY at').bind(since).all<{ psid: string; at: string; text: string }>();
  const seen = new Set<string>();
  const out: { at: string; reason: string; text: string | null }[] = [];
  for (const r of results) {
    const reason = serviceReason(r.text);
    if (!reason || seen.has(r.psid)) continue;
    seen.add(r.psid);
    out.push({ at: bkk(r.at), reason, text: r.text });
  }
  return out;
}
