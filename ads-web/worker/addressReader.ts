// Reads the customer's shipping address out of their Page365 chat — typed, or sent as a photo (a screenshot of an
// address, a parcel label, a handwritten note) — so the admin doesn't retype it. Claude reads the chat text and the
// customer's photos (by URL; Page365's attachment links are public). Nothing is stored: the result goes into the
// Page365 draft and is shown once on screen. Only used when a person asks for a plan or presses "fill".

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

export const AddressSchema = z.object({
  found: z.boolean().describe('true only if the chat contains a full shipping address for this order'),
  name: z.string().describe("recipient's name as written for the parcel (not the Facebook name), '' if none"),
  phone: z.string().describe('recipient phone, digits only, \'\' if none'),
  street: z.string().describe('house number, village/moo, soi, road, building — everything before ตำบล/แขวง'),
  subdistrict: z.string().describe('ตำบล or แขวง, without the prefix'),
  district: z.string().describe('อำเภอ or เขต, without the prefix'),
  province: z.string().describe('จังหวัด, full name, without the prefix'),
  postal_code: z.string().describe('5-digit postcode, \'\' if none'),
  from_image: z.boolean().describe('true if the address was read from a photo'),
  doubt: z.string().describe('anything unclear or conflicting (two addresses, unreadable digits), in Thai; \'\' if none'),
});
export type ReadAddress = z.infer<typeof AddressSchema>;

export interface ChatMessage { own?: boolean; auto?: boolean; message?: string | null; created_at?: string; attachments?: { url?: string; content_type?: string }[] }

const SYSTEM = `You read a Thai online shop's Messenger chat and pull out the shipping address the customer gave for their order.
The customer may type it or send a photo of it. The first photo in a chat is usually the ad they clicked — ignore photos of clothes.
If the customer gave more than one address, use the latest one and say so in "doubt". Copy names and place names exactly as written;
fix only obvious typing errors in place names. Never invent a postcode or phone number — leave it empty if it isn't there.`;

/** The chat as Claude sees it: the last 40 messages as text, plus the customer's last 3 photos after the first message. */
export function chatInput(messages: ChatMessage[]): Anthropic.ContentBlockParam[] {
  const recent = messages.slice(-40);
  const lines = recent
    .filter((m) => m.message?.trim())
    .map((m) => `${m.own ? 'ร้าน' : 'ลูกค้า'}: ${m.message!.replace(/\s+/g, ' ').trim()}`);
  const photos = messages.slice(1).filter((m) => !m.own).flatMap((m) => (m.attachments ?? []).filter((a) => a.url && /^image\//.test(a.content_type ?? '')).map((a) => a.url!)).slice(-3);
  return [
    { type: 'text', text: `แชท (เก่า → ใหม่):\n${lines.join('\n')}\n\nรูปที่ลูกค้าส่ง: ${photos.length} รูป (แนบด้านล่าง ถ้ามี)` },
    ...photos.map((url): Anthropic.ContentBlockParam => ({ type: 'image', source: { type: 'url', url } })),
  ];
}

/** Shapes the result for Page365 and rejects what can't be right (bad postcode/phone → treated as doubtful). */
export function cleanAddress(a: ReadAddress): ReadAddress & { problems: string[] } {
  const phone = a.phone.replace(/\D/g, '').replace(/^66(?=\d{9}$)/, '0');
  const postal = a.postal_code.replace(/\D/g, '');
  const problems: string[] = [];
  if (!a.found) problems.push('ไม่เจอที่อยู่ในแชท');
  else {
    if (!/^\d{5}$/.test(postal)) problems.push('ไม่มีรหัสไปรษณีย์ 5 หลัก');
    if (!/^0\d{8,9}$/.test(phone)) problems.push('ไม่มีเบอร์โทร');
    if (!a.province.trim() || !a.district.trim()) problems.push('ที่อยู่ไม่ครบ (ไม่มีอำเภอ/จังหวัด)');
    if (a.doubt.trim()) problems.push(`ที่อยู่ไม่แน่ใจ: ${a.doubt.trim()}`);
  }
  return { ...a, phone, postal_code: postal, problems };
}

/** One line the way the team writes it: "99/9 ม.9 ต.พรุดินนา อ.คลองท่อม จ.กระบี่ 81120" (แขวง/เขต for Bangkok). */
export function addressLine(a: Pick<ReadAddress, 'street' | 'subdistrict' | 'district' | 'province' | 'postal_code'>): string {
  const bkk = /กรุงเทพ/.test(a.province);
  return [a.street, a.subdistrict && `${bkk ? 'แขวง' : 'ต.'}${a.subdistrict}`, a.district && `${bkk ? 'เขต' : 'อ.'}${a.district}`, bkk ? 'กรุงเทพมหานคร' : a.province && `จ.${a.province}`, a.postal_code]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export async function readAddress(apiKey: string, messages: ChatMessage[], model = 'claude-opus-5-5', workspaceId?: string): Promise<ReturnType<typeof cleanAddress>> {
  // The shop's key is an org key: it must name the workspace (var ANTHROPIC_WORKSPACE_ID, shared with chatInsights.ts).
  const client = new Anthropic({ apiKey, defaultHeaders: workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined });
  const res = await client.messages.parse({
    model,
    max_tokens: 4000,
    output_config: { effort: 'low', format: zodOutputFormat(AddressSchema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: chatInput(messages) }],
  });
  if (res.stop_reason === 'refusal' || !res.parsed_output) {
    return cleanAddress({ found: false, name: '', phone: '', street: '', subdistrict: '', district: '', province: '', postal_code: '', from_image: false, doubt: 'อ่านที่อยู่ไม่สำเร็จ' });
  }
  return cleanAddress(res.parsed_output);
}
