// อูนิ's nightly read of the chats (agreed 2026-10-15): yesterday's conversations (already redacted, no names)
// go to an AI model once, which writes a short Thai summary for #meta-chat — what customers ask, why they don't
// buy, whether the admins offer the 3-piece set, ideas for posts and for Meta Business AI. Not part of the ads
// rules: nothing here changes budgets or replies to customers.
//
// The model call is the only provider-specific part (askAI). Anthropic by default; switching provider or paying
// account later = a new key (wrangler secret put ANTHROPIC_API_KEY) or a new branch in askAI.

export interface AIEnv {
  ANTHROPIC_API_KEY?: string;
  /** Only for keys not scoped to a workspace: the workspace to bill (Console → Workspaces) */
  ANTHROPIC_WORKSPACE_ID?: string;
  /** Model id; default claude-haiku-5-5 (cheapest that reads Thai well) */
  CHAT_AI_MODEL?: string;
}

export const aiEnabled = (env: AIEnv) => !!env.ANTHROPIC_API_KEY;

export interface AIResult { text: string; input_tokens: number; output_tokens: number; model: string }

export async function askAI(env: AIEnv, system: string, user: string, maxTokens = 3000): Promise<AIResult> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ยังไม่ได้ตั้ง ANTHROPIC_API_KEY');
  const model = env.CHAT_AI_MODEL || 'claude-haiku-5-5';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', ...(env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': env.ANTHROPIC_WORKSPACE_ID } : {}) },
    // No thinking: the summary is short and thinking tokens would use up max_tokens before any text is written.
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }], thinking: { type: 'disabled' } }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`AI ${res.status}: ${body?.error?.message ?? res.statusText}`);
  const text = (body.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
  if (!text) throw new Error(`AI ตอบกลับไม่มีข้อความ (stop: ${body.stop_reason ?? '?'}, ชนิด: ${(body.content ?? []).map((c: any) => c.type).join(',') || '-'})`);
  return { text, input_tokens: body.usage?.input_tokens ?? 0, output_tokens: body.usage?.output_tokens ?? 0, model };
}

export interface Conversation { psid: string; campaign: string | null; ordered: boolean; messages: { from_page: number; text: string | null; attachments: string | null; at?: string; who?: string }[] }

/** "14:05" Bangkok time of an ISO timestamp — lets the team find a chat in the inbox. */
const bkkTime = (iso?: string) => (iso ? new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(11, 16) : '');

const MAX_CHARS = 150_000, MAX_MSGS = 30, MAX_MSG_CHARS = 200;

/** Conversations as compact text: one block per customer, numbered (no ids), newest-first cut at MAX_CHARS. */
export function transcript(convs: Conversation[]): { text: string; used: number } {
  const blocks: string[] = [];
  let total = 0, used = 0;
  for (const [i, c] of convs.entries()) {
    const first = c.messages.find((m) => !m.from_page) ?? c.messages[0];
    const lines = [`### ลูกค้า ${i + 1} · ทักครั้งแรก ${bkkTime(first?.at)} น. · แอด: ${c.campaign ?? 'ไม่ระบุ'} · มีโน้ตออเดอร์: ${c.ordered ? 'ใช่' : 'ไม่'}`];
    for (const m of c.messages.slice(0, MAX_MSGS)) {
      const t = m.text ? m.text.replace(/\s+/g, ' ').slice(0, MAX_MSG_CHARS) : `[ส่ง${m.attachments === 'image' || m.attachments?.startsWith('image') ? 'รูป' : 'ไฟล์'}]`;
      lines.push(`${m.who ?? (m.from_page ? 'เพจ' : 'ลูกค้า')}: ${t}`);
    }
    const block = lines.join('\n');
    if (total + block.length > MAX_CHARS) break;
    blocks.push(block); total += block.length; used++;
  }
  return { text: blocks.join('\n\n'), used };
}

export const INSIGHT_SYSTEM = `คุณคือ "อูนิ" ผู้ช่วยวิเคราะห์แชทของร้าน PkJeans (ขายกางเกงยีนส์ผ่าน Messenger, โปรเช่น 1 ตัว 189–249, 3 ตัว 499–599, เก็บเงินปลายทาง)
อ่านแชทของเมื่อวานแล้วสรุปเป็นภาษาไทย สุภาพ ลงท้าย "ค่ะ" สำหรับทีม (แม็กซ์ แอดมิน) อ่านใน Discord
กติกา:
- ตอบเป็นข้อความ Discord markdown ไม่เกิน 1,700 ตัวอักษร ห้ามมีชื่อ เบอร์ ที่อยู่ของลูกค้า
- ใช้ตัวเลขจากแชทจริง (เช่น "12 จาก 40 คน") อย่าเดา ถ้าข้อมูลน้อยให้บอกตรงๆ
- ห้ามแต่งข้อมูลสินค้า (ไซส์ที่มี เนื้อผ้า สีตก ราคา) เอง ใช้เฉพาะที่แอดมินตอบในแชทจริง ถ้าไม่มีในแชทให้เขียน "(ทีมต้องยืนยัน)"
- อ้างแชทเป็น "ลูกค้า N (HH:MM น., แอด …)" ตามหัวข้อของแชทนั้น เพื่อให้ทีมค้นเจอใน inbox
- หัวข้อ (ใช้ตามนี้):
**❓ ลูกค้าถามบ่อย** 3–5 ข้อ พร้อมจำนวนคน
**🚫 ทำไมไม่ซื้อ** 3–5 สาเหตุที่เห็นในแชทที่ไม่มีโน้ตออเดอร์ พร้อมจำนวน
**🛍 ชวนเป็นเซ็ต** ในแชทที่ลูกค้าเอา 1 ตัว แอดมินเสนอเซ็ต/เพิ่มตัวกี่ครั้ง และได้ผลกี่ครั้ง
**📣 ไอเดียโพสต์/แอด** 2–3 ข้อ จากสิ่งที่ลูกค้าถามหรือติดใจ
**🤖 ข้อมูลที่ควรใส่ให้ Business AI** 2–3 ข้อ (คำถาม → คำตอบที่แอดมินพิมพ์จริงในแชท ไม่ใช่คำตอบที่คิดเอง)
**🤖 บอท Meta AI วันนี้** ("บอท" ในแชท; "เพจ" = ไม่รู้ว่าคนหรือบอท) ตอบผิด/สัญญาเกิน (ราคา ส่วนลด ข้อมูลสินค้า) กี่ครั้ง · ตอบปัด/ไม่ส่งต่อคนกี่ครั้ง · ยกตัวอย่าง 1–2 ข้อ
**⚠️ ต้องดู** แชทที่ตอบผิด/ตอบช้า/ลูกค้าไม่พอใจ (อ้าง "ลูกค้า N")
บรรทัดสุดท้ายของคำตอบต้องเป็น "บอทพลาด: N" (N = จำนวนลูกค้าที่บอทตอบผิด สัญญาเกิน หรือไม่ส่งต่อคนเมื่อควรส่ง นับคนละครั้ง ไม่มีให้ใส่ 0) บรรทัดนี้ระบบใช้นับ ไม่แสดงในรายงาน`;

export function insightPrompt(dayLabel: string, t: { text: string; used: number }, total: number): string {
  return `แชทวันที่ ${dayLabel}: ${total} คน${t.used < total ? ` (ส่งมาให้อ่าน ${t.used} คนแรก เพราะยาวเกิน)` : ''}\n\n${t.text}`;
}

/**
 * The AI cites chats as "ลูกค้า N"; the team needs the time and ad to find them in the inbox. Lists every customer
 * number cited from the "⚠️ ต้องดู" section on, with the first message time and the ad.
 */
export function citeKey(text: string, convs: Conversation[]): string {
  const from = text.indexOf('⚠️');
  const part = from >= 0 ? text.slice(from) : '';
  const nums = [...new Set([...part.matchAll(/ลูกค้า\s*(\d{1,3})/g)].map((m) => Number(m[1])))].filter((n) => n >= 1 && n <= convs.length).sort((a, b) => a - b);
  if (!nums.length) return '';
  const lines = nums.map((n) => {
    const c = convs[n - 1];
    const first = c.messages.find((m) => !m.from_page) ?? c.messages[0];
    return `ลูกค้า ${n} = ทัก ${bkkTime(first?.at)} น. · ${c.campaign ?? 'ไม่ระบุแอด'}`;
  });
  return `\n🔎 **ค้นใน inbox:** ${lines.join(' · ')}`;
}

/** The AI's last line "บอทพลาด: N" → the number (null when missing), and the text without that line. */
export function botErrors(text: string): { n: number | null; text: string } {
  const m = /\n?\s*\**บอทพลาด\**\s*[:：]\s*\**\s*(\d+)[^\n]*\s*$/.exec(text);
  return m ? { n: Number(m[1]), text: text.slice(0, m.index).trimEnd() } : { n: null, text };
}

/**
 * One line for the 07:30 post: customers the bot got wrong per 100 chats, the last 7 days vs the 7 before.
 * `days` = one row per day the AI read (latest read of that day), `today` = the report's day (yesterday's date).
 */
export function botRateText(days: { day: string; errors: number; customers: number }[], today: string): string {
  const back = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  const span = (from: number, to: number) => days.filter((d) => d.day <= back(from) && d.day > back(to));
  const rate = (ds: typeof days) => {
    const c = ds.reduce((a, d) => a + d.customers, 0);
    return c ? (ds.reduce((a, d) => a + d.errors, 0) / c) * 100 : null;
  };
  const cur = span(0, 7), prev = span(7, 14);
  const r = rate(cur), p = rate(prev);
  if (r === null || cur.length < 3) return `📉 **บอทพลาดต่อ 100 แชท:** กำลังเก็บข้อมูล (${cur.length}/7 วัน)`;
  const f = (x: number) => x.toFixed(1);
  const vs = p === null || prev.length < 3 ? 'ยังไม่มีสัปดาห์ก่อนให้เทียบ' : `สัปดาห์ก่อน ${f(p)} ${r < p ? '✅ ดีขึ้น' : r > p ? '⚠️ แย่ลง' : 'เท่าเดิม'}`;
  return `📉 **บอทพลาดต่อ 100 แชท (7 วัน):** ${f(r)} · ${vs}${cur.length < 7 ? ` (มีข้อมูล ${cur.length} วัน)` : ''}`;
}
