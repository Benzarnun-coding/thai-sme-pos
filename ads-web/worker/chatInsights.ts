// น้องจิบิ's nightly read of the chats (agreed 2026-10-15): yesterday's conversations (already redacted, no names)
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

export async function askAI(env: AIEnv, system: string, user: string, maxTokens = 1500): Promise<AIResult> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ยังไม่ได้ตั้ง ANTHROPIC_API_KEY');
  const model = env.CHAT_AI_MODEL || 'claude-haiku-5-5';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', ...(env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': env.ANTHROPIC_WORKSPACE_ID } : {}) },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`AI ${res.status}: ${body?.error?.message ?? res.statusText}`);
  const text = (body.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
  return { text, input_tokens: body.usage?.input_tokens ?? 0, output_tokens: body.usage?.output_tokens ?? 0, model };
}

export interface Conversation { psid: string; campaign: string | null; ordered: boolean; messages: { from_page: number; text: string | null; attachments: string | null }[] }

const MAX_CHARS = 60_000, MAX_MSGS = 30, MAX_MSG_CHARS = 200;

/** Conversations as compact text: one block per customer, numbered (no ids), newest-first cut at MAX_CHARS. */
export function transcript(convs: Conversation[]): { text: string; used: number } {
  const blocks: string[] = [];
  let total = 0, used = 0;
  for (const [i, c] of convs.entries()) {
    const lines = [`### ลูกค้า ${i + 1} · แอด: ${c.campaign ?? 'ไม่ระบุ'} · มีโน้ตออเดอร์: ${c.ordered ? 'ใช่' : 'ไม่'}`];
    for (const m of c.messages.slice(0, MAX_MSGS)) {
      const t = m.text ? m.text.replace(/\s+/g, ' ').slice(0, MAX_MSG_CHARS) : `[ส่ง${m.attachments === 'image' || m.attachments?.startsWith('image') ? 'รูป' : 'ไฟล์'}]`;
      lines.push(`${m.from_page ? 'เพจ' : 'ลูกค้า'}: ${t}`);
    }
    const block = lines.join('\n');
    if (total + block.length > MAX_CHARS) break;
    blocks.push(block); total += block.length; used++;
  }
  return { text: blocks.join('\n\n'), used };
}

export const INSIGHT_SYSTEM = `คุณคือ "น้องจิบิ" ผู้ช่วยวิเคราะห์แชทของร้าน PkJeans (ขายกางเกงยีนส์ผ่าน Messenger, โปรเช่น 1 ตัว 189–249, 3 ตัว 499–599, เก็บเงินปลายทาง)
อ่านแชทของเมื่อวานแล้วสรุปเป็นภาษาไทย สุภาพ ลงท้าย "ค่ะ" สำหรับทีม (แม็กซ์ แอดมิน) อ่านใน Discord
กติกา:
- ตอบเป็นข้อความ Discord markdown ไม่เกิน 1,700 ตัวอักษร ห้ามมีชื่อ เบอร์ ที่อยู่ของลูกค้า
- ใช้ตัวเลขจากแชทจริง (เช่น "12 จาก 40 คน") อย่าเดา ถ้าข้อมูลน้อยให้บอกตรงๆ
- หัวข้อ (ใช้ตามนี้):
**❓ ลูกค้าถามบ่อย** 3–5 ข้อ พร้อมจำนวนคน
**🚫 ทำไมไม่ซื้อ** 3–5 สาเหตุที่เห็นในแชทที่ไม่มีโน้ตออเดอร์ พร้อมจำนวน
**🛍 ชวนเป็นเซ็ต** ในแชทที่ลูกค้าเอา 1 ตัว แอดมินเสนอเซ็ต/เพิ่มตัวกี่ครั้ง และได้ผลกี่ครั้ง
**📣 ไอเดียโพสต์/แอด** 2–3 ข้อ จากสิ่งที่ลูกค้าถามหรือติดใจ
**🤖 ข้อมูลที่ควรใส่ให้ Business AI** 2–3 ข้อ (คำถาม → คำตอบที่แอดมินใช้จริง)
**⚠️ ต้องดู** แชทที่ตอบผิด/ตอบช้า/ลูกค้าไม่พอใจ (อ้าง "ลูกค้า N")`;

export function insightPrompt(dayLabel: string, t: { text: string; used: number }, total: number): string {
  return `แชทวันที่ ${dayLabel}: ${total} คน${t.used < total ? ` (ส่งมาให้อ่าน ${t.used} คนแรก เพราะยาวเกิน)` : ''}\n\n${t.text}`;
}
