// Which model should read addresses (Benz 23 Oct: the $20/month AI cap ran out on Opus; try cheaper ones). Real
// bills that have left the draft stage are read again by each model, from the same chat and photos, and the result is
// compared field by field with the address the bill finally shipped with (what the admins checked). Only match flags,
// tokens and price are kept (audit action address.backtest) — never the address itself.
// Started by writing the job into meta_capi (docs/orders.md); one bill per webhook delivery at most once a minute,
// like the fill audit (free plan: ~9 outbound requests per bill — the bill, its chat, ≤3 photos, one call per model).

import { addressUsage, chatInputInline, readAddress, type AddressUsage, type ChatMessage } from './addressReader.ts';
import { audit } from './db.ts';
import { call, type FillEnv, type P365Order } from './p365fill.ts';

export interface BacktestJob { models: string[]; nos: number[]; started_at: string }
const KEY = 'address_backtest';

export interface Truth { phone: string; street: string; subdistrict: string; district: string; province: string; postal_code: string }
export type Fields = 'phone' | 'street' | 'subdistrict' | 'district' | 'province' | 'postal_code';
export const FIELDS: Fields[] = ['phone', 'postal_code', 'province', 'district', 'subdistrict', 'street'];

const digits = (s: string) => s.replace(/\D/g, '');
/** Place names without prefixes, spaces or dots: "อ.เมืองเชียงใหม่" = "เมืองเชียงใหม่", "แขวง บางรัก" = "บางรัก". */
export const place = (s: string) => s.replace(/^\s*(จังหวัด|จ\.|อำเภอ|อ\.|เขต|ตำบล|ต\.|แขวง)\s*/, '').replace(/[\s.]/g, '');
/** Street compared on letters and digits only, and on the order of its numbers (house no., moo, soi). */
export const streetKey = (s: string) => s.replace(/(หมู่ที่|หมู่|ม\.)\s*/g, 'ม').replace(/[^\p{L}\p{N}]/gu, '');
const numbers = (s: string) => (s.match(/\d+(?:\/\d+)?/g) ?? []).join(' ');

/** Per field: did the model give what the bill shipped with? The street counts if its numbers match (wording differs). */
export function compare(read: Partial<Truth>, truth: Truth): Record<Fields, boolean> {
  return {
    phone: digits(read.phone ?? '') === digits(truth.phone),
    postal_code: digits(read.postal_code ?? '') === digits(truth.postal_code),
    province: place(read.province ?? '') === place(truth.province),
    district: place(read.district ?? '') === place(truth.district),
    subdistrict: place(read.subdistrict ?? '') === place(truth.subdistrict),
    street: streetKey(read.street ?? '') === streetKey(truth.street) || (numbers(truth.street) !== '' && numbers(read.street ?? '') === numbers(truth.street)),
  };
}

/** The shipped address, or null when the bill has no complete one to compare with. */
export function truthOf(o: P365Order): Truth | null {
  const a = o.structural_address;
  if (!a?.province || !a.district || !a.postal_code || !o.customer_phone) return null;
  return { phone: o.customer_phone, street: a.street ?? '', subdistrict: a.subdistrict ?? '', district: a.district, province: a.province, postal_code: a.postal_code };
}

export async function loadJob(db: D1Database): Promise<BacktestJob | null> {
  const r = await db.prepare('SELECT value FROM meta_capi WHERE key = ?').bind(KEY).first<{ value: string }>().catch(() => null);
  try { return r ? JSON.parse(r.value) as BacktestJob : null; } catch { return null; }
}

/** One bill, every model. Returns the bill number done, or null when there's nothing to do (or it's too soon). */
export async function backtestStep(env: FillEnv & { DB: D1Database }): Promise<number | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  const job = await loadJob(env.DB);
  if (!job?.nos.length) return null;
  const last = await env.DB.prepare("SELECT value FROM meta_capi WHERE key = 'address_backtest_at'").first<{ value: string }>().catch(() => null);
  if (last && Date.now() - Date.parse(last.value) < 60_000) return null;
  const [no, ...rest] = job.nos;
  // Taken off the list before the work: a bill that fails isn't retried forever.
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('address_backtest_at', ?)").bind(new Date().toISOString()),
    env.DB.prepare('INSERT OR REPLACE INTO meta_capi (key, value) VALUES (?, ?)').bind(KEY, JSON.stringify({ ...job, nos: rest })),
  ]);
  const skip = (why: string) => audit(env.DB, 'ai', 'address.backtest', String(no), { skipped: why }).then(() => no);
  const list = await call<{ orders: { id: number; no: number }[] }>(env, `orders.json?page=1&search=${no}`).catch(() => null);
  const hit = list?.orders.find((o) => o.no === no);
  if (!hit) return skip('bill not found');
  const order = await call<P365Order>(env, `orders/${hit.id}.json`);
  const truth = truthOf(order);
  if (!truth) return skip('bill has no complete address');
  if (!order.conversation_id) return skip('no chat');
  const chat = (await call<{ messages: ChatMessage[] }>(env, `conversations/${order.conversation_id}.json`).catch(() => null))?.messages ?? [];
  // The chat as it was when the note was written: later messages (after the bill was sent) aren't what the reader saw.
  const note = await env.DB.prepare('SELECT at, text FROM order_notes WHERE fill_order_no = ? ORDER BY at LIMIT 1').bind(no).first<{ at: string; text: string }>();
  const before = note ? chat.filter((m) => !m.created_at || Date.parse(m.created_at) <= Date.parse(note.at) + 60_000) : chat;
  const content = await chatInputInline(before, note?.text ?? '');
  for (const model of job.models) {
    const r = await readAddress(env.ANTHROPIC_API_KEY, before, model, env.ANTHROPIC_WORKSPACE_ID, note?.text ?? '', content)
      .catch((err) => ({ error: String(err?.message ?? err).slice(0, 200), usage: addressUsage(model, undefined, 0) as AddressUsage }));
    const detail = 'error' in r
      ? { model, error: r.error }
      : { found: r.found, from_image: r.from_image, match: compare(r, truth), problems: r.problems.length, ...r.usage };
    await audit(env.DB, 'ai', 'address.backtest', String(no), detail);
  }
  return no;
}
