// Phase 3 (Benz 2026-10-15): as soon as an admin types the order note in the chat, the Worker opens the
// customer's Page365 draft itself (if the admin hasn't), plans it, and fills it when every check passes —
// items, sizes, promo discount, bill name, address. Anything else goes to Discord with the customer's Facebook
// name, the bill number and the reasons, for a person. The bill stays a draft: an admin still opens it in
// Page365 and presses "ส่งบิล". Switch: meta_capi key auto_fill (on/off), on the settings page.

import { postToDeciders, type DiscordEnv } from './discord.ts';
import { looksLikeNote, markFill, parseOrderNote, saveNotes, type StoredNote } from './orderNotes.ts';
import { sendNotePurchase } from './notePurchases.ts';
import { applyFill, call, findDraft, P365Error, planFill, type FillEnv, type P365Order } from './p365fill.ts';

export interface AutoEnv extends FillEnv, DiscordEnv { DB: D1Database; /** #ออเดอร์มีปัญหา (Benz 15 Oct); falls back to the ads channel via the bot */ DISCORD_ORDER_WEBHOOK_URL?: string; /** who answers for problem bills (เนย, Benz 15 Oct); empty = the deciders */ DISCORD_ORDER_OWNER_IDS?: string }

const PAGE = (env: FillEnv) => env.P365_PAGE_ID ?? '115748303500549';
const orderLink = (env: FillEnv, id: number) => `https://app.page365.net/${PAGE(env)}/orders/${id}`;

export async function autoFillOn(db: D1Database): Promise<boolean> {
  const r = await db.prepare("SELECT value FROM meta_capi WHERE key = 'auto_fill'").first<{ value: string }>().catch(() => null);
  return r?.value === 'on';
}

export async function setAutoFill(db: D1Database, on: boolean): Promise<void> {
  await db.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('auto_fill', ?)").bind(on ? 'on' : 'off').run();
}

/** The customer behind a PSID in Page365 (conversation list, most recently active first: { id, customer: { id, fbid, name, last_order_id } }). */
export async function customerFor(env: FillEnv, psid: string, pages = 4): Promise<{ conversation_id: number; customer_id: number; name: string; last_order_id: number | null } | null> {
  for (let page = 1; page <= pages; page++) {
    const list = await call<{ conversations?: { id: number; customer?: { id: number; fbid?: string; name?: string; last_order_id?: number | null } }[] }>(env, `conversations.json?page=${page}`);
    const convs = list.conversations ?? [];
    const hit = convs.find((c) => c.customer?.fbid === psid);
    if (hit?.customer?.id) return { conversation_id: hit.id, customer_id: hit.customer.id, name: hit.customer.name ?? '', last_order_id: hit.customer.last_order_id ?? null };
    if (convs.length < 50) break;
  }
  return null;
}

/** Opens a draft for the customer the way the chat screen's "เปิดบิล" does. */
export async function openDraft(env: FillEnv, customerId: number): Promise<P365Order | null> {
  const r = await call<any>(env, `customers/${customerId}/orders.json`, { method: 'POST', body: {} });
  const id = r?.id ?? r?.order?.id;
  return id ? call<P365Order>(env, `orders/${id}.json`) : null;
}

/** Two notes for one customer this close together are one order (a correction), as for purchases to Meta. */
const SAME_ORDER_MS = 2 * 3_600_000;

/** Another note of this customer already put into this bill, if any. */
async function otherNoteOn(db: D1Database, orderNo: number, mid: string): Promise<{ mid: string; at: string } | null> {
  return db.prepare('SELECT mid, at FROM order_notes WHERE fill_order_no = ? AND mid != ? AND filled_at IS NOT NULL ORDER BY at DESC LIMIT 1').bind(orderNo, mid).first<{ mid: string; at: string }>();
}

const bkk = (iso: string) => new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(11, 16);

/**
 * The bill a note belongs to (Benz 15 Oct: whenever an admin types a summary there is a draft in Page365, whatever
 * else is missing; details follow). Order of looking: the customer's latest Page365 order if it is a draft, a
 * draft of theirs near the note, else a new draft. Never a second bill for one order: a bill made and sent already
 * (the morning round, an admin) is taken as this note's, and a second note within 2 hours of one already filled
 * is a correction, left for a person.
 */
export async function ensureDraft(env: AutoEnv, note: StoredNote): Promise<{ draft: P365Order | null; billed?: P365Order; why?: string }> {
  const t = Date.parse(note.at);
  const who = await customerFor(env, note.psid);
  let draft: P365Order | null = null;
  if (who?.last_order_id) {
    const last = await call<P365Order>(env, `orders/${who.last_order_id}.json`).catch(() => null);
    if (last && last.customer_fbid === note.psid) {
      if (last.stage === 'draft') draft = last;
      // Already made and moved on: that bill is this order if it was opened around/after the note, or if another
      // note of the customer within 2 hours went into it (a repeated summary — #29364 / 16:53, 15 Oct).
      else {
        const other = await otherNoteOn(env.DB, last.no, note.mid);
        const recent = Date.parse(last.created_at) >= t - 3_600_000;
        if (other ? Math.abs(Date.parse(other.at) - t) <= SAME_ORDER_MS : recent) return { draft: null, billed: last };
      }
    }
  }
  if (!draft) draft = await findDraft(env, note.psid, note.at);
  if (draft?.items.length) {
    const other = await otherNoteOn(env.DB, draft.no, note.mid);
    if (other && Math.abs(Date.parse(other.at) - t) <= SAME_ORDER_MS) {
      return { draft, why: `สรุปซ้ำ: ร่าง #${draft.no} ใส่ไปแล้วจากสรุปตอน ${bkk(other.at)} น. — ถ้าเป็นการแก้ ให้แก้ในร่างเอง` };
    }
    // Filled from an older order note: this is a new order and gets its own draft. Items a person put in: theirs.
    if (other) draft = null;
  }
  if (!draft) {
    if (!who) return { draft: null, why: 'หาลูกค้าคนนี้ใน Page365 ไม่เจอ (แชทไม่อยู่ใน 200 แชทล่าสุด) — เปิดร่างเองในแชท' };
    draft = await openDraft(env, who.customer_id);
    if (!draft) return { draft: null, why: 'สั่งเปิดร่างใน Page365 แล้วแต่ไม่ได้บิลกลับมา — เปิดร่างเองในแชท' };
  }
  return { draft };
}

export interface AutoResult { status: 'filled' | 'needs_person' | 'skipped' | 'waiting'; order_no: number | null; reasons: string[] }

/** Note state while its draft is open but not filled yet: the sweep finishes it (counted, gives up after 3 tries). */
export const OPENED = 'เปิดร่างแล้ว · รอใส่รายละเอียด';
/** Note state while Page365 can't be reached (no or expired login): the sweep opens the draft once it can. */
export const WAITING = 'รอเปิดร่าง';

/**
 * A note fresh from the webhook is taken by one invocation only: Meta re-sends a delivery it didn't get a 200 for,
 * and the re-sent note (already filled, or being filled) must not be planned again — that read a filled draft as
 * "ร่างมีสินค้าอยู่แล้ว" and asked a person, or added the items twice. Marked WAITING, so the sweep retries it if
 * this invocation dies before the draft is recorded.
 */
export async function claimNote(db: D1Database, mid: string): Promise<boolean> {
  const r = await db.prepare('UPDATE order_notes SET fill_error = ? WHERE mid = ? AND filled_at IS NULL AND fill_error IS NULL').bind(WAITING, mid).run();
  return r.meta.changes > 0;
}

/** One note, start to finish. Never throws: failures become a Discord message. */
export async function autoFillNote(env: AutoEnv, note: StoredNote, opts: { force?: boolean; claim?: boolean } = {}): Promise<AutoResult> {
  if (!opts.force && !(await autoFillOn(env.DB))) return { status: 'skipped', order_no: null, reasons: ['ปิดอยู่'] };
  if (opts.claim && !(await claimNote(env.DB, note.mid))) return { status: 'skipped', order_no: null, reasons: ['ทำไปแล้วหรือกำลังทำ'] };
  let draft: P365Order | null = null;
  let name = '';
  try {
    // 1. The draft first, recorded at once: whatever happens next, the bill exists and is linked to the note.
    const got = await ensureDraft(env, note);
    draft = got.draft;
    if (got.billed) {
      await markFill(env.DB, note.mid, { by: 'auto', order_no: got.billed.no, error: null });
      return { status: 'filled', order_no: got.billed.no, reasons: [`บิล #${got.billed.no} เปิดไปแล้ว (${got.billed.stage})`] };
    }
    if (!draft) {
      const why = [got.why ?? 'เปิดร่างไม่ได้'];
      await markFill(env.DB, note.mid, { by: 'auto', order_no: null, error: `ต้องให้คนดู: ${why.join(' · ')}` }).catch(() => null);
      await tell(env, note, null, '', why);
      return { status: 'needs_person', order_no: null, reasons: why };
    }
    name = draft.customer_name ?? '';
    if (got.why) {
      await markFill(env.DB, note.mid, { by: 'auto', order_no: draft.no, error: `ต้องให้คนดู: ${got.why}` }).catch(() => null);
      await tell(env, note, draft, name, [got.why]);
      return { status: 'needs_person', order_no: draft.no, reasons: [got.why] };
    }
    const tries = triesOf(note.fill_error) + 1;
    await markFill(env.DB, note.mid, { by: 'auto', order_no: draft.no, error: `${OPENED} (${tries})` });

    // 2. Details: items, price, address — filled when nothing stops it, else a person is asked.
    const plan = await planFill(env, note, { draft });
    // Warnings only (an address doubt, a small discount): fill anyway — items, price and whatever address could
    // be read — and ask a person to check (Benz 15 Oct: a bill left empty for a doubt about the name is worse).
    if (!plan.problems.length && plan.order) {
      const r = await applyFill(env, note, { plan, address: plan.address, allowWarnings: true });
      await markFill(env.DB, note.mid, { by: 'auto', order_no: r.order.no, error: null });
      if (plan.warnings.length) await tell(env, note, r.order, name, plan.warnings, true);
      return { status: 'filled', order_no: r.order.no, reasons: plan.warnings };
    }
    const why = plan.problems.length ? plan.problems : ['ไม่เจอร่างบิล'];
    // Shown on the note's row in the Log tab too, not only in Discord.
    await markFill(env.DB, note.mid, { by: 'auto', order_no: draft.no, error: `ต้องให้คนดู: ${why.join(' · ')}` }).catch(() => null);
    await tell(env, note, draft, name, why);
    return { status: 'needs_person', order_no: draft.no, reasons: why };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    // Page365 not reachable with our login: keep the note waiting (the sweep retries) and say so once an hour.
    if (err instanceof P365Error && err.kind === 'session') {
      await markFill(env.DB, note.mid, { by: 'auto', order_no: draft?.no ?? null, error: `${WAITING}: ${msg}` }).catch(() => null);
      await sessionAlarm(env, msg).catch(() => null);
      return { status: 'waiting', order_no: draft?.no ?? null, reasons: [msg] };
    }
    const why = draft ? [`ร่าง #${draft.no} เปิดแล้ว แต่ใส่รายละเอียดไม่สำเร็จ: ${msg}`] : [msg];
    await markFill(env.DB, note.mid, { by: 'auto', order_no: draft?.no ?? null, error: `ต้องให้คนดู: ${why.join(' · ')}` }).catch(() => null);
    await tell(env, note, draft, name, why).catch(() => null);
    return { status: 'needs_person', order_no: draft?.no ?? null, reasons: why };
  }
}

const triesOf = (error: string | null | undefined) => Number(/^เปิดร่างแล้ว.*\((\d+)\)$/.exec(error ?? '')?.[1] ?? 0);

/** "Page365 login expired" to the problem channel, at most once an hour. */
async function sessionAlarm(env: AutoEnv, msg: string): Promise<void> {
  const last = await env.DB.prepare("SELECT value FROM meta_capi WHERE key = 'p365_alarm_at'").first<{ value: string }>().catch(() => null);
  if (last && Date.now() - Date.parse(last.value) < 3_600_000) return;
  await env.DB.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('p365_alarm_at', ?)").bind(new Date().toISOString()).run();
  await tell(env, { mid: '', psid: '', at: new Date().toISOString(), text: '-', name_hash: null }, null, 'ทุกบิล', [`ระบบเปิดร่างใน Page365 ไม่ได้: ${msg}`, 'ออเดอร์ที่สรุประหว่างนี้รอไว้ เปิดให้เองเมื่อล็อกอินใหม่แล้ว — หรือแอดมินเปิดร่างเองไปก่อน']);
}

/** Only notes from when the sweep started: older ones were done by hand or by the 15 Oct backfill. */
const SWEEP_FROM = '2026-10-15T09:00:00Z'; // 16:00 Bangkok

/**
 * The safety net, on webhook deliveries without notes (at most every 5 minutes): one note from the last 24 hours
 * that never got its draft, or whose fill was cut short, or that waited for Page365, is run again.
 */
export async function sweepNotes(env: AutoEnv, opts: { force?: boolean } = {}): Promise<AutoResult | null> {
  if (!(await autoFillOn(env.DB))) return null;
  const last = await env.DB.prepare("SELECT value FROM meta_capi WHERE key = 'fill_sweep_at'").first<{ value: string }>().catch(() => null);
  if (!opts.force && last && Date.now() - Date.parse(last.value) < 5 * 60_000) return null;
  await env.DB.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('fill_sweep_at', ?)").bind(new Date().toISOString()).run();
  const from = new Date(Math.max(Date.now() - 86_400_000, Date.parse(SWEEP_FROM))).toISOString();
  const to = new Date(Date.now() - 3 * 60_000).toISOString();
  // Notes the parser missed when they came in ("โอน349kb … 2ตัว", 15 Oct) are read again from the stored chat
  // (redacted shop messages, chatLog.ts) after a parser fix; their sale goes to Meta at the note's own time.
  const { results: shopLines } = await env.DB.prepare(
    `SELECT c.mid, c.psid, c.at, c.text FROM chat_messages c LEFT JOIN order_notes o ON o.mid = c.mid
      WHERE c.from_page = 1 AND c.at >= ? AND c.text IS NOT NULL AND o.mid IS NULL`,
  ).bind(from).all<{ mid: string; psid: string; at: string; text: string }>();
  const rescued: StoredNote[] = shopLines.filter((m) => parseOrderNote(m.text)).map((m) => ({ mid: m.mid, psid: m.psid, at: m.at, text: m.text.trim(), name_hash: null }));
  // The same lines that still aren't read but look like notes: kept and told (once), so the format gets learnt.
  await recordMisses(env, shopLines.filter((m) => looksLikeNote(m.text)).map((m) => ({ mid: m.mid, psid: m.psid, at: m.at, text: m.text.trim(), name_hash: null })));
  if (rescued.length) {
    // A miss the parser reads now (after a fix) is marked learnt.
    await env.DB.prepare(`UPDATE note_misses SET resolved_at = ? WHERE resolved_at IS NULL AND mid IN (SELECT value FROM json_each(?))`).bind(new Date().toISOString(), JSON.stringify(rescued.map((n) => n.mid))).run().catch(() => null);
    await saveNotes(env.DB, rescued);
    for (const n of rescued) await sendNoteSale(env, n).catch((err) => console.error('note purchase', err));
  }
  // instr, not LIKE: D1 refuses LIKE patterns this long in Thai ("pattern too complex").
  const note = await env.DB.prepare(
    `SELECT * FROM order_notes WHERE at >= ? AND at <= ? AND filled_at IS NULL
       AND (fill_error IS NULL OR instr(fill_error, ?) = 1 OR instr(fill_error, ?) = 1) ORDER BY at LIMIT 1`,
  ).bind(from, to, OPENED, WAITING).first<StoredNote>();
  if (!note) return null;
  if (triesOf(note.fill_error) >= 3) {
    const why = ['เปิดร่างแล้วแต่ใส่รายละเอียดไม่สำเร็จ 3 ครั้ง — ใส่เองในร่าง'];
    await markFill(env.DB, note.mid, { by: 'auto', order_no: note.fill_order_no ?? null, error: `ต้องให้คนดู: ${why[0]}` });
    await tell(env, note, null, '', why);
    return { status: 'needs_person', order_no: note.fill_order_no ?? null, reasons: why };
  }
  return autoFillNote(env, note);
}

export async function tell(env: AutoEnv, note: StoredNote, draft: P365Order | null, name: string, reasons: string[], filled = false): Promise<void> {
  const bill = draft ? `[#${draft.no}](<${orderLink(env, draft.id)}>)` : '(ยังไม่มีร่าง)';
  const body = (mention: string) => [
    (filled ? `✅ ใส่บิลให้แล้ว แต่ช่วยเช็กก่อนส่งบิล ${mention}` : `🧾 บิลนี้ต้องให้คนดู ${mention}`).trim(),
    `ลูกค้า: **${name || 'ไม่ทราบชื่อ'}** · บิล ${bill}`,
    `แอดมินสรุป: \`${note.text.replace(/\s+/g, ' ')}\``,
    ...reasons.slice(0, 6).map((r) => `• ${r}`),
  ].join('\n').slice(0, 2000);
  await postOrderChannel(env, body);
}

/** The problem channel (#ออเดอร์มีปัญหา), tagging the person in charge; the ads channel via the bot if not set. */
async function postOrderChannel(env: AutoEnv, body: (mention: string) => string): Promise<void> {
  if (env.DISCORD_ORDER_WEBHOOK_URL) {
    const ids = (env.DISCORD_ORDER_OWNER_IDS || env.DISCORD_DECIDER_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);
    const r = await fetch(env.DISCORD_ORDER_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'น้องจิบิ', content: body(ids.map((id) => `<@${id}>`).join(' ')), allowed_mentions: { users: ids } }),
    });
    if (r.ok) return;
    console.error('order webhook', r.status);
  }
  await postToDeciders(env, body);
}

/**
 * Every 3 hours (Benz 15 Oct), not waiting for chat traffic: the sweep runs once, and if no webhook delivery came
 * in for 3 hours in the shop's day (10:00–23:00 Bangkok) the problem channel is told — notes typed then are not
 * seen at all until deliveries come back.
 */
export async function cronSweep(env: AutoEnv): Promise<void> {
  if (!(await autoFillOn(env.DB))) return;
  await sweepNotes(env, { force: true }).catch((err) => console.error('sweep', err));
  const hour = (new Date().getUTCHours() + 7) % 24;
  const last = await env.DB.prepare('SELECT max(at) AS at FROM chat_messages').first<{ at: string | null }>().catch(() => null);
  if (hour >= 10 && hour < 23 && last?.at && Date.now() - Date.parse(last.at) > 3 * 3_600_000) {
    await tell(env, { mid: '', psid: '', at: new Date().toISOString(), text: '-', name_hash: null }, null, 'ทุกบิล', [`ไม่มีแชทเข้ามาที่ระบบเลยตั้งแต่ ${bkk(last.at)} น. — webhook ของ Meta อาจหลุด สรุปที่พิมพ์ช่วงนี้ระบบยังไม่เห็น เปิดร่างเองไปก่อน แล้วแจ้งเบนซ์`]);
  }
}

/**
 * Shop messages that look like an order note but can't be read (Benz 15 Oct): stored in `note_misses` and told
 * to the problem channel once each, so a person opens the bill by hand and the format is added to the parser.
 */
export async function recordMisses(env: AutoEnv, misses: StoredNote[]): Promise<number> {
  if (!misses.length) return 0;
  const { results: known } = await env.DB.prepare('SELECT mid FROM note_misses WHERE mid IN (SELECT value FROM json_each(?))').bind(JSON.stringify(misses.map((m) => m.mid))).all<{ mid: string }>();
  const seen = new Set(known.map((k) => k.mid));
  const fresh = misses.filter((m) => !seen.has(m.mid));
  if (!fresh.length) return 0;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT OR IGNORE INTO note_misses (mid, psid, at, text, alerted_at)
    SELECT value->>'mid', value->>'psid', value->>'at', value->>'text', ? FROM json_each(?)`).bind(now, JSON.stringify(fresh)).run();
  for (const m of fresh.slice(0, 3)) {
    const who = await customerFor(env, m.psid, 2).catch(() => null);
    await tellMiss(env, m, who?.name ?? '').catch((err) => console.error('miss post', err));
  }
  return fresh.length;
}

export async function tellMiss(env: AutoEnv, m: StoredNote, name: string): Promise<void> {
  await postOrderChannel(env, (mention) => [
      `❓ ข้อความนี้เหมือนสรุปออเดอร์ แต่ระบบอ่านไม่ออก ${mention}`.trim(),
      `ลูกค้า: **${name || 'ไม่ทราบชื่อ'}** · พิมพ์ตอน ${bkk(m.at)} น.`,
      `ข้อความ: \`${m.text.replace(/\s+/g, ' ').slice(0, 200)}\``,
      '• ระบบยังไม่เปิดร่าง/ไม่ส่งยอดให้ Meta — เปิดบิลเองไปก่อน',
      '• ส่งรูปแบบนี้ให้เบนซ์/Claude เพิ่มเข้าระบบ (ดูได้ที่แท็บ Log ออเดอร์แชท → "สรุปที่อ่านไม่ออก")',
    ].join('\n').slice(0, 2000));
}

/**
 * The sale to Meta for a note, and the problem channel told when Meta refuses it (Benz 15 Oct): admins no longer
 * press Create order, so a refused sale would otherwise be missing from the ads without anyone knowing. Nothing
 * retries it; the message asks an admin to press Create order in the inbox for that customer. At most one message
 * per 15 minutes (a token or dataset problem fails every note).
 */
export async function sendNoteSale(env: AutoEnv, note: StoredNote): Promise<{ status: string; detail: string | null }> {
  const r = await sendNotePurchase(env as any, note);
  if (r.status === 'error') await tellPurchaseError(env, note, r.detail ?? '').catch((err) => console.error('purchase error post', err));
  return r;
}

const PURCHASE_ALERT_MS = 15 * 60_000;

async function tellPurchaseError(env: AutoEnv, note: StoredNote, error: string): Promise<void> {
  const last = await env.DB.prepare("SELECT value FROM meta_capi WHERE key = 'purchase_error_alert_at'").first<{ value: string }>().catch(() => null);
  if (last && Date.now() - Date.parse(last.value) < PURCHASE_ALERT_MS) return;
  await env.DB.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('purchase_error_alert_at', ?)").bind(new Date().toISOString()).run();
  const who = await customerFor(env, note.psid, 1).catch(() => null);
  await postOrderChannel(env, (mention) => [
    `⚠️ ส่งยอดขายให้ Meta ไม่สำเร็จ ${mention}`.trim(),
    `ลูกค้า: **${who?.name || 'ไม่ทราบชื่อ'}** · สรุปตอน ${bkk(note.at)} น.`,
    `แอดมินสรุป: \`${note.text.replace(/\s+/g, ' ').slice(0, 200)}\``,
    `• Meta ตอบ: ${error.slice(0, 300) || 'ไม่ทราบสาเหตุ'}`,
    '• ยอดนี้ยังไม่เข้าแอด — ให้แอดมินกด Create order ในกล่องแชทของลูกค้าคนนี้แทน (ระบบไม่ส่งซ้ำเอง)',
    '• ถ้าเด้งหลายรายการติดกัน (token/dataset มีปัญหา) แจ้งเบนซ์ · ดูทุกรายการได้ที่ Settings → ส่งยอดขายให้ Meta',
  ].join('\n').slice(0, 2000));
}

export interface NoteMiss { mid: string; at: string; text: string; alerted_at: string | null; resolved_at: string | null }

/** The last `days` days of misses, newest first (Log tab). */
export async function loadMisses(db: D1Database, days = 14): Promise<NoteMiss[]> {
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const { results } = await db.prepare('SELECT mid, at, text, alerted_at, resolved_at FROM note_misses WHERE at >= ? ORDER BY at DESC LIMIT 100').bind(from).all<NoteMiss>();
  return results;
}
