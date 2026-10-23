// Reads the customer's shipping address out of their Page365 chat — typed, or sent as a photo (a screenshot of an
// address, a parcel label, a handwritten note) — so the admin doesn't retype it. Claude reads the chat text and the
// customer's photos (by URL; Page365's attachment links are public). Nothing is stored: the result goes into the
// Page365 draft and is shown once on screen. Only used when a person asks for a plan or presses "fill".

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { completeAddress } from './thaiAddress.ts';

export const AddressSchema = z.object({
  found: z.boolean().describe('true only if the chat contains a full shipping address for this order'),
  name: z.string().describe("recipient's name as written for the parcel (not the Facebook name), '' if none"),
  phone: z.string().describe('recipient phone, digits only, \'\' if none'),
  street: z.string().describe('house number, village/moo, soi, road, building — everything before ตำบล/แขวง; never the recipient name or phone number'),
  subdistrict: z.string().describe('ตำบล or แขวง, without the prefix'),
  district: z.string().describe('อำเภอ or เขต, without the prefix'),
  province: z.string().describe('จังหวัด, full name, without the prefix'),
  postal_code: z.string().describe('5-digit postcode, \'\' if none'),
  from_image: z.boolean().describe('true if the address was read from a photo'),
  doubt: z.string().describe('anything unclear or conflicting (two addresses, unreadable digits), in Thai; \'\' if none'),
  cancelled: z.boolean().describe('true only if the customer cancelled this order in the chat after agreeing to it and did not order again afterwards'),
  size_mismatch: z.string().describe("if the shop's order note has a size different from the one the customer last asked for, say which (in Thai, e.g. 'โน้ต 30 แต่ลูกค้าขอ 32'); '' if they match or the customer never said"),
});
export type ReadAddress = z.infer<typeof AddressSchema>;

export interface ChatMessage { own?: boolean; auto?: boolean; message?: string | null; created_at?: string; attachments?: { url?: string; content_type?: string }[] }

const SYSTEM = `You read a Thai online shop's Messenger chat and pull out the shipping address the customer gave for their order.
The customer may type it or send a photo of it. The first photo in a chat is usually the ad they clicked — ignore photos of clothes.
If the customer gave more than one address, use the latest one and say so in "doubt". Copy names and place names exactly as written;
fix only obvious typing errors in place names. Never invent a postcode or phone number — leave it empty if it isn't there.
A missing postcode is fine (it is looked up from the subdistrict afterwards): don't mention it in "doubt".
If the customer later corrected part of it (a name, a house number), use the correction — that is settled, not a doubt.
If the customer never typed a recipient name, leave "name" empty (the Facebook name is used) — that is normal, not a doubt.
You are also given the shop's order note (codes, waist size, payment and total). Only check two things against the chat:
whether the customer cancelled after agreeing (and didn't reorder), and whether the note's size is the one the customer asked for last.`;

/** The chat as Claude sees it: the last 40 messages as text, plus the customer's last 3 photos after the first message. */
export function chatInput(messages: ChatMessage[], orderNote = ''): Anthropic.ContentBlockParam[] {
  const recent = messages.slice(-40);
  const lines = recent
    .filter((m) => m.message?.trim())
    .map((m) => `${m.own ? 'ร้าน' : 'ลูกค้า'}: ${m.message!.replace(/\s+/g, ' ').trim()}`);
  const photos = messages.slice(1).filter((m) => !m.own).flatMap((m) => (m.attachments ?? []).filter((a) => a.url && /^image\//.test(a.content_type ?? '')).map((a) => a.url!)).slice(-3);
  return [
    { type: 'text', text: `แชท (เก่า → ใหม่):\n${lines.join('\n')}\n\n${orderNote ? `โน้ตสรุปออเดอร์ของร้าน: ${orderNote.replace(/\s+/g, ' ')}\n\n` : ''}รูปที่ลูกค้าส่ง: ${photos.length} รูป (แนบด้านล่าง ถ้ามี)` },
    ...photos.map((url): Anthropic.ContentBlockParam => ({ type: 'image', source: { type: 'url', url } })),
  ];
}

/**
 * The same, with the photos downloaded here and sent inline: the shop's key refuses image URLs (403 "Request not
 * allowed", 15 Oct). Photos that fail or are over ~4 MB are left out (the text is still read).
 */
export async function chatInputInline(messages: ChatMessage[], orderNote = ''): Promise<Anthropic.ContentBlockParam[]> {
  const blocks = chatInput(messages, orderNote);
  const out: Anthropic.ContentBlockParam[] = [];
  for (const b of blocks) {
    if (b.type !== 'image' || b.source.type !== 'url') { out.push(b); continue; }
    try {
      const r = await fetch(b.source.url);
      const type = (r.headers.get('content-type') ?? '').split(';')[0];
      if (!r.ok || !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type)) continue;
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length > 4_000_000) continue;
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      out.push({ type: 'image', source: { type: 'base64', media_type: type as 'image/jpeg', data: btoa(bin) } });
    } catch { /* leave the photo out */ }
  }
  return out;
}

/** Shapes the result for Page365 and rejects what can't be right (bad postcode/phone → treated as doubtful). */
export function cleanAddress(a: ReadAddress): ReadAddress & { problems: string[] } {
  const phone = a.phone.replace(/\D/g, '').replace(/^66(?=\d{9}$)/, '0');
  const problems: string[] = [];
  // Postcode/district/province filled or checked from the subdistrict (customers often leave the postcode out).
  const { parts, doubt } = a.found ? completeAddress(a) : { parts: a, doubt: null };
  a = { ...a, ...parts };
  const postal = a.postal_code.replace(/\D/g, '');
  if (!a.found) problems.push('ไม่เจอที่อยู่ในแชท');
  else {
    if (doubt) problems.push(doubt);
    // The model sometimes still notes a missing postcode; once the address book filled it, that's settled.
    if (postal.length === 5) a = { ...a, doubt: a.doubt.split(/[,;·\n]/).filter((x) => !/รหัสไปรษณีย์|postcode|zip/i.test(x)).join(', ').trim() };
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

/** US$ per million tokens (input, output) — what the Console bills (Oct 2026). Thinking counts as output. */
export const ADDRESS_PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};
export const DEFAULT_ADDRESS_MODEL = 'claude-opus-5-5';

/** One read's size and price, logged to `audit` (action address.read) so the month's AI bill can be split by job. */
export interface AddressUsage { model: string; input_tokens: number; output_tokens: number; images: number; usd: number | null }

export function addressUsage(model: string, usage: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | undefined, images: number): AddressUsage {
  const input_tokens = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0);
  const output_tokens = usage?.output_tokens ?? 0;
  const p = ADDRESS_PRICES[model];
  return { model, input_tokens, output_tokens, images, usd: p ? Math.round((input_tokens * p[0] + output_tokens * p[1]) / 1e6 * 1e5) / 1e5 : null };
}

/**
 * Reads one chat. `content` lets a caller that already built the chat input (the model backtest, which asks several
 * models the same question) reuse it instead of downloading the photos again.
 */
export async function readAddress(apiKey: string, messages: ChatMessage[], model = DEFAULT_ADDRESS_MODEL, workspaceId?: string, orderNote = '', content?: Anthropic.ContentBlockParam[]): Promise<ReturnType<typeof cleanAddress> & { usage: AddressUsage }> {
  // The shop's key is an org key: it must name the workspace (var ANTHROPIC_WORKSPACE_ID, shared with chatInsights.ts).
  const client = new Anthropic({ apiKey, defaultHeaders: workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined });
  const input = content ?? await chatInputInline(messages, orderNote);
  // A 403 "Request not allowed" came and went within minutes on 15 Oct (same key, same request): one retry.
  const ask = () => client.messages.parse({
    model,
    max_tokens: 4000,
    output_config: { effort: 'low', format: zodOutputFormat(AddressSchema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: input }],
  });
  const res = await ask().catch(async (err) => {
    if (err?.status !== 403) throw err;
    await new Promise((r) => setTimeout(r, 1500));
    return ask();
  });
  const usage = addressUsage(model, res.usage, input.filter((b) => b.type === 'image').length);
  if (res.stop_reason === 'refusal' || !res.parsed_output) {
    return { ...cleanAddress({ found: false, name: '', phone: '', street: '', subdistrict: '', district: '', province: '', postal_code: '', from_image: false, doubt: 'อ่านที่อยู่ไม่สำเร็จ', cancelled: false, size_mismatch: '' }), usage };
  }
  return { ...cleanAddress(res.parsed_output), usage };
}

/**
 * The reader as used on bills (Benz 23 Oct, after the backtest: 40 shipped bills, Haiku 5.5 as right as Opus 5.5 on
 * typed addresses at 1/40 of the price). The cheap model reads every chat; the strong one reads it again only when
 * the address was in a photo or wasn't found — the cases the backtest couldn't measure (2 photo bills of 40). Every
 * read's usage is returned so both can be logged.
 */
export async function readAddressTiered(apiKey: string, messages: ChatMessage[], opts: { cheap?: string; strong?: string; workspaceId?: string; orderNote?: string } = {}): Promise<ReturnType<typeof cleanAddress> & { usage: AddressUsage; usages: AddressUsage[]; escalated: boolean }> {
  const cheap = opts.cheap || 'claude-haiku-5-5';
  const strong = opts.strong || DEFAULT_ADDRESS_MODEL;
  const content = await chatInputInline(messages, opts.orderNote ?? '');
  const first = await readAddress(apiKey, messages, cheap, opts.workspaceId, opts.orderNote, content).catch(() => null);
  if (first && first.found && !first.from_image) return { ...first, usages: [first.usage], escalated: false };
  if (cheap === strong && first) return { ...first, usages: [first.usage], escalated: false };
  const second = await readAddress(apiKey, messages, strong, opts.workspaceId, opts.orderNote, content);
  return { ...second, usages: first ? [first.usage, second.usage] : [second.usage], escalated: true };
}
