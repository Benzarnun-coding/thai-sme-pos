// Answer bank for Meta's Business AI (agreed 2026-10-15). Twice a week (Mon/Thu 08:00) the AI reads the chats since
// the last round and proposes fixes — where the bot was wrong, promised too much or should have handed over — each
// posted to Discord with approve / reject buttons. Approved items wait on /botkb; every Monday 10:00 Max is reminded
// to paste them into Business Suite (Meta has no API for the bot's settings) and press "ใส่บอทแล้ว".

import { askAI, type AIEnv } from './chatInsights.ts';
import { idList, type DiscordEnv } from './discord.ts';

export interface KbItem {
  id: number; created_at: string; kind: 'fix' | 'faq'; question: string; answer: string; rule: string | null;
  why: string | null; evidence: string | null; status: 'proposed' | 'approved' | 'rejected' | 'applied';
  decided_by: string | null; decided_at: string | null; applied_at: string | null; message_id: string | null;
}

/** Who wrote a chat line: the customer, an admin (Meta inbox / Page365), Meta's bot, or the page (unknown app). */
export function speaker(fromPage: number, senderApp: string | null, env: { CHAT_HUMAN_APP_IDS?: string; CHAT_BOT_APP_IDS?: string }): string {
  if (!fromPage) return 'ลูกค้า';
  if (senderApp && idList(env.CHAT_BOT_APP_IDS).includes(senderApp)) return 'บอท';
  if (senderApp && idList(env.CHAT_HUMAN_APP_IDS).includes(senderApp)) return 'แอดมิน';
  return 'เพจ';
}

const FIX_SYSTEM = `คุณคือ "น้องจิบิ" ผู้ช่วยของร้าน PkJeans (ขายกางเกงยีนส์ผ่าน Messenger) หน้าที่: ตรวจคำตอบของบอท Business AI ของ Meta จากแชทจริง แล้วเสนอสิ่งที่ควรแก้ในการตั้งค่าบอท
ในแชท: "ลูกค้า" = ลูกค้า, "แอดมิน" = คนของร้าน, "บอท" = Business AI, "เพจ" = ไม่รู้ว่าคนหรือบอท (ข้อความที่สุภาพยาว ตอบทันที หรือบอกว่า "ฉันไม่สามารถช่วยได้" มักเป็นบอท)
ตอบเป็น JSON array เท่านั้น (ไม่มีข้อความอื่น) ไม่เกิน 8 ข้อ เรียงจากสำคัญสุด แต่ละข้อ:
{"kind":"fix","question":"สิ่งที่ลูกค้าถาม/สถานการณ์ (สั้น)","answer":"สิ่งที่บอทควรตอบ","rule":"กฎสั้นๆ ที่ควรใส่ให้บอท หรือ null","why":"บอทพลาดอะไร","evidence":"ลูกค้า N (HH:MM น.)"}
กติกา:
- answer ใช้ข้อมูลที่แอดมินพิมพ์จริงในแชทเท่านั้น ห้ามแต่งราคา ไซส์ เนื้อผ้า นโยบายเอง ถ้าไม่มีให้ answer = "ส่งต่อแอดมิน" และบอกใน why ว่า (ทีมต้องยืนยัน)
- เรื่องร้องเรียน/คืนเงิน/ส่งผิด/พัสดุ/เก็บเงินซ้ำ ให้ rule = ส่งต่อแอดมินทันที
- ห้ามมีชื่อ เบอร์ ที่อยู่ลูกค้า
- ข้ามเรื่องที่อยู่ในรายการ "มีในคลังแล้ว"
- ถ้าไม่มีอะไรควรแก้ ตอบ []`;

const FAQ_SYSTEM = `คุณคือ "น้องจิบิ" ผู้ช่วยของร้าน PkJeans (ขายกางเกงยีนส์ผ่าน Messenger) หน้าที่: ทำ "คลังคำตอบ" ชุดแรกสำหรับบอท Business AI ของ Meta จากแชทจริง
ในแชท: "ลูกค้า", "แอดมิน" = คนของร้าน, "บอท" = Business AI, "เพจ" = ไม่รู้ว่าคนหรือบอท
ตอบเป็น JSON array เท่านั้น (ไม่มีข้อความอื่น) ไม่เกิน 20 ข้อ เรียงตามที่ลูกค้าถามบ่อยสุด แต่ละข้อ:
{"kind":"faq","question":"คำถามลูกค้า (แบบที่ลูกค้าพิมพ์)","answer":"คำตอบที่แอดมินใช้จริง","rule":null,"why":"ถามกี่คน","evidence":"ลูกค้า N (HH:MM น.)"}
กติกา: answer ต้องมาจากที่แอดมินพิมพ์จริงเท่านั้น (ไม่ใช่บอท ไม่แต่งเอง) ถ้ายังไม่เห็นคำตอบจากแอดมินให้ answer = "(ทีมต้องยืนยัน)" ห้ามมีชื่อ เบอร์ ที่อยู่ลูกค้า ข้ามเรื่องที่ "มีในคลังแล้ว"`;

/** The AI's JSON array, tolerant of a ```json fence or text around it. */
export function parseItems(text: string): Pick<KbItem, 'kind' | 'question' | 'answer' | 'rule' | 'why' | 'evidence'>[] {
  const start = text.indexOf('['), end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let raw: unknown;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const s = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
  return raw.map((r: any) => ({
    kind: r?.kind === 'faq' ? 'faq' as const : 'fix' as const,
    question: s(r?.question, 300) ?? '', answer: s(r?.answer, 800) ?? '', rule: s(r?.rule, 300), why: s(r?.why, 300), evidence: s(r?.evidence, 120),
  })).filter((r) => r.question && r.answer);
}

export async function existingQuestions(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare(`SELECT question FROM bot_kb WHERE status IN ('proposed','approved','applied') ORDER BY id DESC LIMIT 80`).all<{ question: string }>();
  return results.map((r) => r.question);
}

export async function saveItems(db: D1Database, items: ReturnType<typeof parseItems>, status: 'proposed' = 'proposed'): Promise<KbItem[]> {
  const at = new Date().toISOString();
  const out: KbItem[] = [];
  for (const it of items) {
    const row = await db.prepare(`INSERT INTO bot_kb (created_at, kind, question, answer, rule, why, evidence, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`)
      .bind(at, it.kind, it.question, it.answer, it.rule, it.why, it.evidence, status).first<KbItem>();
    if (row) out.push(row);
  }
  return out;
}

/** One AI read: fixes for the bot (Mon/Thu) or the first answer bank (faq). */
export async function proposeItems(env: AIEnv & { DB: D1Database }, mode: 'fix' | 'faq', transcriptText: string, customers: number): Promise<{ items: KbItem[]; input_tokens: number; output_tokens: number }> {
  const have = await existingQuestions(env.DB);
  const user = `${have.length ? `มีในคลังแล้ว:\n${have.map((q) => `- ${q}`).join('\n')}\n\n` : ''}แชท ${customers} คน:\n\n${transcriptText}`;
  const ai = await askAI(env, mode === 'faq' ? FAQ_SYSTEM : FIX_SYSTEM, user, 4000);
  return { items: await saveItems(env.DB, parseItems(ai.text)), input_tokens: ai.input_tokens, output_tokens: ai.output_tokens };
}

/** Discord message for one proposed fix, with its buttons. */
export function kbMessage(it: KbItem, mention: string): { content: string; components: unknown[] } {
  const lines = [
    `🛠 **แก้บอท #${it.id}** ${mention ? `คุณ ${mention} ` : ''}ช่วยดูหน่อยค่ะ`,
    `❓ **ลูกค้า:** ${it.question}`,
    ...(it.why ? [`❌ **บอทพลาด:** ${it.why}${it.evidence ? ` · ${it.evidence}` : ''}`] : []),
    `✅ **บอทควรตอบ:** ${it.answer}`,
    ...(it.rule ? [`📏 **กฎให้บอท:** ${it.rule}`] : []),
  ];
  return {
    content: lines.join('\n').slice(0, 1950),
    components: [{ type: 1, components: [
      { type: 2, style: 3, label: '✅ ใส่คลังคำตอบ', custom_id: `kbok:${it.id}` },
      { type: 2, style: 2, label: '❌ ไม่ใช้', custom_id: `kbno:${it.id}` },
    ] }],
  };
}

export async function postBot(env: DiscordEnv, body: { content: string; components?: unknown[] }, mentionDeciders = false): Promise<string | null> {
  const ids = mentionDeciders ? idList(env.DISCORD_DECIDER_IDS) : [];
  const res = await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, allowed_mentions: { users: ids } }),
  });
  if (!res.ok) { console.error('discord kb post', res.status, await res.text()); return null; }
  return ((await res.json()) as { id: string }).id;
}

export async function listKb(db: D1Database): Promise<KbItem[]> {
  const { results } = await db.prepare(`SELECT * FROM bot_kb ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'proposed' THEN 1 WHEN 'applied' THEN 2 ELSE 3 END, id DESC LIMIT 300`).all<KbItem>();
  return results;
}

export async function setKbStatus(db: D1Database, id: number, status: 'approved' | 'rejected' | 'proposed', who: string): Promise<KbItem | null> {
  return db.prepare(`UPDATE bot_kb SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status != 'applied' RETURNING *`).bind(status, who, new Date().toISOString(), id).first<KbItem>();
}

/** Everything approved is now in the bot. */
export async function markApplied(db: D1Database): Promise<number> {
  const r = await db.prepare(`UPDATE bot_kb SET status = 'applied', applied_at = ? WHERE status = 'approved'`).bind(new Date().toISOString()).run();
  return r.meta.changes ?? 0;
}

/** Text Max pastes into Business Suite: rules first, then question → answer. */
export function kbPasteText(items: KbItem[]): string {
  const rules = items.filter((i) => i.rule).map((i) => `- ${i.rule}`);
  const qa = items.map((i) => `ถาม: ${i.question}\nตอบ: ${i.answer}`).join('\n\n');
  return rules.length ? `กฎ:\n${rules.join('\n')}\n\n${qa}` : qa;
}
