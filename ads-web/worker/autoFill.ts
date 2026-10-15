// Phase 3 (Benz 2026-10-15): as soon as an admin types the order note in the chat, the Worker opens the
// customer's Page365 draft itself (if the admin hasn't), plans it, and fills it when every check passes —
// items, sizes, promo discount, bill name, address. Anything else goes to Discord with the customer's Facebook
// name, the bill number and the reasons, for a person. The bill stays a draft: an admin still opens it in
// Page365 and presses "ส่งบิล". Switch: meta_capi key auto_fill (on/off), on the settings page.

import { postToDeciders, type DiscordEnv } from './discord.ts';
import { markFill, type StoredNote } from './orderNotes.ts';
import { applyFill, call, findDraft, planFill, type FillEnv, type P365Order } from './p365fill.ts';

export interface AutoEnv extends FillEnv, DiscordEnv { DB: D1Database; /** #ออเดอร์มีปัญหา (Benz 15 Oct); falls back to the ads channel via the bot */ DISCORD_ORDER_WEBHOOK_URL?: string }

const PAGE = (env: FillEnv) => env.P365_PAGE_ID ?? '115748303500549';
const orderLink = (env: FillEnv, id: number) => `https://app.page365.net/${PAGE(env)}/orders/${id}`;

export async function autoFillOn(db: D1Database): Promise<boolean> {
  const r = await db.prepare("SELECT value FROM meta_capi WHERE key = 'auto_fill'").first<{ value: string }>().catch(() => null);
  return r?.value === 'on';
}

export async function setAutoFill(db: D1Database, on: boolean): Promise<void> {
  await db.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('auto_fill', ?)").bind(on ? 'on' : 'off').run();
}

/** The customer behind a PSID in Page365 (conversation list, most recently active first: { id, customer: { id, fbid, name } }). */
export async function customerFor(env: FillEnv, psid: string, pages = 4): Promise<{ conversation_id: number; customer_id: number; name: string } | null> {
  for (let page = 1; page <= pages; page++) {
    const list = await call<{ conversations?: { id: number; customer?: { id: number; fbid?: string; name?: string } }[] }>(env, `conversations.json?page=${page}`);
    const convs = list.conversations ?? [];
    const hit = convs.find((c) => c.customer?.fbid === psid);
    if (hit?.customer?.id) return { conversation_id: hit.id, customer_id: hit.customer.id, name: hit.customer.name ?? '' };
    if (convs.length < 50) break;
  }
  return null;
}

/** Opens a draft for the customer the way the chat screen's "เปิดบิล" does. */
export async function openDraft(env: FillEnv, psid: string): Promise<P365Order | null> {
  const who = await customerFor(env, psid);
  if (!who) return null;
  const r = await call<any>(env, `customers/${who.customer_id}/orders.json`, { method: 'POST', body: {} });
  const id = r?.id ?? r?.order?.id;
  return id ? call<P365Order>(env, `orders/${id}.json`) : null;
}

export interface AutoResult { status: 'filled' | 'needs_person' | 'skipped'; order_no: number | null; reasons: string[] }

/** One note, start to finish. Never throws: failures become a Discord message. */
export async function autoFillNote(env: AutoEnv, note: StoredNote, opts: { force?: boolean } = {}): Promise<AutoResult> {
  if (!opts.force && !(await autoFillOn(env.DB))) return { status: 'skipped', order_no: null, reasons: ['ปิดอยู่'] };
  if (!env.P365_COOKIE) return { status: 'skipped', order_no: null, reasons: ['ไม่มี P365_COOKIE'] };
  let draft: P365Order | null = null;
  let name = '';
  try {
    draft = await findDraft(env, note.psid, note.at);
    if (!draft) draft = await openDraft(env, note.psid);
    name = draft?.customer_name ?? '';
    const plan = await planFill(env, note, { draft });
    const reasons = [...plan.problems, ...plan.warnings];
    if (!reasons.length && plan.order) {
      const r = await applyFill(env, note, { plan, address: plan.address });
      await markFill(env.DB, note.mid, { by: 'auto', order_no: r.order.no, error: null });
      return { status: 'filled', order_no: r.order.no, reasons: [] };
    }
    const why = reasons.length ? reasons : ['ไม่เจอร่างบิล และเปิดร่างให้ไม่ได้'];
    // Shown on the note's row in the Log tab too, not only in Discord.
    await markFill(env.DB, note.mid, { by: 'auto', order_no: draft?.no ?? null, error: `ต้องให้คนดู: ${why.join(' · ')}` }).catch(() => null);
    await tell(env, note, draft, name, why);
    return { status: 'needs_person', order_no: draft?.no ?? null, reasons: why };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await markFill(env.DB, note.mid, { by: 'auto', order_no: null, error: msg }).catch(() => null);
    await tell(env, note, draft, name, [msg]).catch(() => null);
    return { status: 'needs_person', order_no: draft?.no ?? null, reasons: [msg] };
  }
}

async function tell(env: AutoEnv, note: StoredNote, draft: P365Order | null, name: string, reasons: string[]): Promise<void> {
  const bill = draft ? `[#${draft.no}](<${orderLink(env, draft.id)}>)` : '(ยังไม่มีร่าง)';
  const body = (mention: string) => [
    `🧾 บิลนี้ต้องให้คนดู ${mention}`.trim(),
    `ลูกค้า: **${name || 'ไม่ทราบชื่อ'}** · บิล ${bill}`,
    `แอดมินสรุป: \`${note.text.replace(/\s+/g, ' ')}\``,
    ...reasons.slice(0, 6).map((r) => `• ${r}`),
  ].join('\n').slice(0, 2000);
  if (env.DISCORD_ORDER_WEBHOOK_URL) {
    const ids = (env.DISCORD_DECIDER_IDS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const r = await fetch(env.DISCORD_ORDER_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'น้องจิบิ', content: body(ids.map((id) => `<@${id}>`).join(' ')), allowed_mentions: { users: ids } }),
    });
    if (r.ok) return;
    console.error('order webhook', r.status);
  }
  await postToDeciders(env, body);
}
