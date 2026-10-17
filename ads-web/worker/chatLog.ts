// Chat log for learning what sells (agreed 2026-10-15): the webhook already sees every Messenger message as a
// standby event (Page365 owns the threads), so the text is kept — after removing phone numbers, e-mails, long
// numbers (tracking, bank, ID) and anything that looks like an address — for 30 days, without names. It is joined
// to ads through ad_referrals.psid and to orders through the admins' order notes. Nothing here replies to anyone.

export interface ChatEvent {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: { is_echo?: boolean; mid?: string; text?: string; attachments?: { type?: string }[]; app_id?: number | string; metadata?: string };
}

export interface ChatRow { mid: string; psid: string; at: string; from_page: number; text: string | null; attachments: string | null; sender_app: string | null }

export const CHAT_KEEP_DAYS = 30;
const MAX_TEXT = 1000;

/** Capitalised words that are products, brands or English chat, not customers' names. */
const LATIN_KEEP = new Set(['Cotton', 'Jeans', 'Climax', 'Facebook', 'Meta', 'Messenger', 'Options', 'What', 'Hello', 'Hi', 'Thank', 'Thanks', 'Please', 'Sorry', 'Yes', 'The', 'Levi', 'Levis', 'Kerry', 'Flash', 'Shopee', 'Lazada', 'Line', 'Size', 'Sports', 'Ni', 'Rev', 'Free']);

// Thai address words: ตำบล/อำเภอ/จังหวัด (and their short forms), แขวง/เขต, หมู่/ม., ซอย/ซ., ถนน/ถ., บ้านเลขที่.
const ADDRESS_WORD = /(ตำบล|ต\.|อำเภอ|อ\.|จังหวัด|จ\.|แขวง|เขต|หมู่บ้าน|หมู่|ม\.\s?\d|ซอย|ซ\.|ถนน|ถ\.|บ้านเลขที่|รหัสไปรษณีย์)/;

/**
 * What may be stored of one message. An address (address words + a 5-digit postcode, or two address words with a
 * house number) replaces the whole message; phone numbers, e-mails and any run of 7+ digits become placeholders.
 */
export function redactChat(text: string): string {
  let t = text.replace(/\r/g, '').trim();
  if (!t) return t;
  const words = t.match(new RegExp(ADDRESS_WORD.source, 'g')) ?? [];
  if ((words.length >= 1 && /(^|\D)\d{5}(\D|$)/.test(t)) || (words.length >= 2 && /\d+\/\d+|\d{2,}/.test(t))) return '[ที่อยู่]';
  // A postcode with place names around it ("บ้านกร่าง ศรีประจันต์ สุพรรณบุรี72140", "ต หงส์เจริญ อ ท่าแซะ") or on its own.
  const postcode = /(^|\D)[1-9]\d{4}(\D|$)/.test(t);
  if (postcode && ((t.match(/[\u0E01-\u0E4E]{2,}/g) ?? []).length >= 2 || t.replace(/\D/g, '').length === t.replace(/\s/g, '').length)) return '[ที่อยู่]';
  // An address quoted inside a longer message ("…ส่งไปที่ 123 หมู่ 4 วังทองชุก บ้านกร่าง ตามที่แจ้งไว้…"): cut that part only.
  t = t.replace(/\d+(?:\/\d+)?\s*(?:หมู่|ม\.)\s*\d+[^\n]{0,60}?(?=ตามที่|นะคะ|ไหมคะ|ค่ะ|ครับ|\n|$)/g, '[ที่อยู่]');
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[อีเมล]');
  // Names the page (or its reply bot) uses for the customer: "คุณกนิการ", "คุณ Uthumporn", "พี่ Uthumporn".
  t = t.replace(/(?<!ขอบ)คุณ\s?(?!ค่ะ|ครับ|คะ|นะ|ลูกค้า|ภาพ|สมบัติ)[A-Za-z\u0E01-\u0E2E\u0E30-\u0E4E]{2,24}/g, 'คุณ[ชื่อ]');
  t = t.replace(/(พี่|น้อง|ลูกค้า)\s?[A-Za-z][A-Za-z.'-]{1,24}/g, '$1[ชื่อ]');
  t = t.replace(/(สวัสดี(?:ค่ะ|ครับ|คะ)?)\s?[A-Za-z][A-Za-z.'-]{1,24}/g, '$1 [ชื่อ]');
  // Meta's follow-up template: "สวัสดี คมกริช! เราต้องการติดตามผล…" — any word between the greeting and "!".
  t = t.replace(/สวัสดี\s+(?!ค่ะ|ครับ|คะ)[^\s!]{2,24}!/g, 'สวัสดี [ชื่อ]!');
  // Meta's bot calls customers by their Latin profile name: "รับทราบค่ะ Adul", "Ajax คะ", "คุณ **Bancha**", "Hello Max!".
  t = t.replace(/(Hello|Hi|สวัสดี|นะคะ|ค่ะ|คะ|ครับ|คุณ|^)(\s*\**\s*)([A-Z][a-z]{2,20})(?=\**(?:\s|$|[!.,?🙏]|คะ|ค่ะ|ครับ))/gm,
    (m, a, sp, w) => (LATIN_KEEP.has(w) ? m : `${a}${sp}[ชื่อ]`));
  // A customer giving a name: "ชื่อคือ(ร.ต.ชาญ เพ็งกระจ่าง" / "ชื่อ: …".
  t = t.replace(/(ชื่อ(?:คือ|\s*[:：]))\s*\(?\s*[^\s,)]{2,}(?:\s+[^\s,)]{2,})?/g, '$1 [ชื่อ]');
  // Tracking / order codes with letters ("PAGE02576305CE") go before the phone pattern, which would eat their digits.
  t = t.replace(/(?<![A-Za-z0-9])[A-Za-z]{0,6}\d[A-Za-z0-9]{6,}(?![A-Za-z0-9])/g, (m) => (m.replace(/\D/g, '').length >= 7 ? '[ตัวเลข]' : m));
  t = t.replace(/(?<![A-Za-z0-9])(\+?66|0)[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{3,4}(?!\d)/g, '[เบอร์]');
  t = t.replace(/\d[\d\s-]{6,}\d/g, (m) => (m.replace(/\D/g, '').length >= 7 ? '[ตัวเลข]' : m));
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}…` : t;
}

/** Every message (customer's or the page's echo) in a webhook delivery, redacted. Reactions, reads etc. are skipped. */
export function extractChats(entries: { messaging?: ChatEvent[]; standby?: ChatEvent[] }[]): ChatRow[] {
  const out: ChatRow[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    for (const ev of [...(e.messaging ?? []), ...(e.standby ?? [])]) {
      const m = ev.message;
      if (!m?.mid || seen.has(m.mid)) continue;
      const fromPage = !!m.is_echo;
      const psid = fromPage ? ev.recipient?.id : ev.sender?.id;
      if (!psid) continue;
      const types = (m.attachments ?? []).map((a) => a.type ?? 'file');
      const text = m.text ? redactChat(m.text) : null;
      if (!text && !types.length) continue;
      seen.add(m.mid);
      const ts = ev.timestamp;
      out.push({ mid: m.mid, psid, at: new Date(!ts ? Date.now() : ts < 1e11 ? ts * 1000 : ts).toISOString(), from_page: fromPage ? 1 : 0, text: text || null, attachments: types.length ? types.join(',') : null, sender_app: fromPage && m.app_id ? String(m.app_id) : null });
    }
  }
  return out;
}

export async function saveChats(db: D1Database, rows: ChatRow[]): Promise<void> {
  if (!rows.length) return;
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO chat_messages (mid, psid, at, from_page, text, attachments, sender_app)
      SELECT value->>'mid', value->>'psid', value->>'at', value->>'from_page', value->>'text', value->>'attachments', value->>'sender_app' FROM json_each(?)`).bind(JSON.stringify(rows)),
    db.prepare(`INSERT INTO webhook_status (key, value) VALUES ('chats_total', ?1) ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + ?1 AS TEXT)`).bind(String(rows.length)),
    db.prepare(`INSERT OR REPLACE INTO webhook_status (key, value) VALUES ('last_chat_at', ?)`).bind(new Date().toISOString()),
  ]);
}

/** 30-day retention; run daily. */
export async function purgeChats(db: D1Database, now = new Date()): Promise<void> {
  await db.prepare('DELETE FROM chat_messages WHERE at < ?').bind(new Date(now.getTime() - CHAT_KEEP_DAYS * 86_400_000).toISOString()).run();
}

export interface ChatSummary {
  since: string; messages: number; customer: number; page: number; threads: number;
  /** Per campaign: chats that came from its ads, how many the page answered, how many got an order note */
  campaigns: { campaign_id: string | null; chats: number; answered: number; ordered: number; median_reply_min: number | null }[];
}

/**
 * Chats per ad campaign over the last `days`: a chat is a customer (psid) whose referral came from that campaign;
 * "answered" = the page wrote back after the referral; "ordered" = an admin order note to that customer after it.
 */
export async function chatSummary(db: D1Database, days = 7, now = new Date()): Promise<ChatSummary> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const [totals, refs, msgs, notes] = await Promise.all([
    db.prepare(`SELECT count(*) n, sum(from_page) page, count(DISTINCT psid) threads FROM chat_messages WHERE at >= ?`).bind(since).first<{ n: number; page: number | null; threads: number }>(),
    db.prepare(`SELECT psid, min(at) at, campaign_id FROM ad_referrals WHERE at >= ? GROUP BY psid`).bind(since).all<{ psid: string; at: string; campaign_id: string | null }>(),
    db.prepare(`SELECT psid, at, from_page FROM chat_messages WHERE at >= ? ORDER BY at`).bind(since).all<{ psid: string; at: string; from_page: number }>(),
    db.prepare(`SELECT psid, min(at) at FROM order_notes WHERE at >= ? GROUP BY psid`).bind(since).all<{ psid: string; at: string }>().catch(() => ({ results: [] as { psid: string; at: string }[] })),
  ]);
  const byPsid = new Map<string, { at: string; from_page: number }[]>();
  for (const m of msgs.results) byPsid.set(m.psid, [...(byPsid.get(m.psid) ?? []), m]);
  const noteAt = new Map(notes.results.map((n) => [n.psid, n.at]));
  const camp = new Map<string | null, { chats: number; answered: number; ordered: number; waits: number[] }>();
  for (const r of refs.results) {
    const c = camp.get(r.campaign_id) ?? { chats: 0, answered: 0, ordered: 0, waits: [] };
    c.chats++;
    const list = byPsid.get(r.psid) ?? [];
    const firstCustomer = list.find((m) => !m.from_page && m.at >= r.at);
    const reply = firstCustomer && list.find((m) => m.from_page && m.at >= firstCustomer.at);
    if (list.some((m) => m.from_page && m.at >= r.at)) c.answered++;
    if (firstCustomer && reply) c.waits.push((Date.parse(reply.at) - Date.parse(firstCustomer.at)) / 60_000);
    if ((noteAt.get(r.psid) ?? '') >= r.at) c.ordered++;
    camp.set(r.campaign_id, c);
  }
  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  return {
    since, messages: totals?.n ?? 0, page: totals?.page ?? 0, customer: (totals?.n ?? 0) - (totals?.page ?? 0), threads: totals?.threads ?? 0,
    campaigns: [...camp].map(([campaign_id, c]) => ({ campaign_id, chats: c.chats, answered: c.answered, ordered: c.ordered, median_reply_min: median(c.waits) })).sort((a, b) => b.chats - a.chats),
  };
}

// ---- daily chat report for #meta-chat (Discord webhook DISCORD_CHAT_WEBHOOK_URL) ----

export interface ChatDay {
  from: string; to: string;
  threads: number; customer: number; page: number;
  /** first reply of the page to each customer's first message in the window, minutes */
  replies: number[];
  /** customers whose last message got no page reply within 30 minutes (and none after) */
  unanswered: number;
  /** first-reply minutes by Bangkok time band of the customer's first message */
  bands: { band: string; replies: number[]; unanswered: number }[];
  campaigns: { campaign_id: string | null; chats: number; answered: number; ordered: number }[];
  addresses: number;
}

const BANDS: [string, number, number][] = [['00–08', 0, 8], ['08–12', 8, 12], ['12–18', 12, 18], ['18–24', 18, 24]];
const bkkHour = (iso: string) => (new Date(iso).getUTCHours() + 7) % 24;

/** One window (e.g. yesterday in Bangkok time) of chats: replies, unanswered customers, chats per ad campaign. */
export async function chatDay(db: D1Database, from: string, to: string, now = new Date()): Promise<ChatDay> {
  const [msgs, refs, notes] = await Promise.all([
    db.prepare(`SELECT psid, at, from_page, text FROM chat_messages WHERE at >= ? AND at < ? ORDER BY at`).bind(from, to).all<{ psid: string; at: string; from_page: number; text: string | null }>(),
    db.prepare(`SELECT psid, min(at) at, campaign_id FROM ad_referrals WHERE at >= ? AND at < ? GROUP BY psid`).bind(from, to).all<{ psid: string; at: string; campaign_id: string | null }>(),
    db.prepare(`SELECT psid, min(at) at FROM order_notes WHERE at >= ? GROUP BY psid`).bind(from).all<{ psid: string; at: string }>().catch(() => ({ results: [] as { psid: string; at: string }[] })),
  ]);
  const byPsid = new Map<string, { at: string; from_page: number }[]>();
  for (const m of msgs.results) byPsid.set(m.psid, [...(byPsid.get(m.psid) ?? []), m]);
  const replies: number[] = [];
  let unanswered = 0;
  const bands = BANDS.map(([band]) => ({ band, replies: [] as number[], unanswered: 0 }));
  const bandOf = (iso: string) => bands[BANDS.findIndex(([, a, b]) => bkkHour(iso) >= a && bkkHour(iso) < b)];
  for (const list of byPsid.values()) {
    const first = list.find((m) => !m.from_page);
    if (!first) continue;
    const reply = list.find((m) => m.from_page && m.at >= first.at);
    if (reply) { const w = (Date.parse(reply.at) - Date.parse(first.at)) / 60_000; replies.push(w); bandOf(first.at).replies.push(w); }
    const lastCustomer = [...list].reverse().find((m) => !m.from_page)!;
    const answeredAfter = list.some((m) => m.from_page && m.at >= lastCustomer.at);
    if (!answeredAfter && now.getTime() - Date.parse(lastCustomer.at) > 30 * 60_000) { unanswered++; bandOf(lastCustomer.at).unanswered++; }
  }
  const noteAt = new Map(notes.results.map((n) => [n.psid, n.at]));
  const camp = new Map<string | null, { chats: number; answered: number; ordered: number }>();
  for (const r of refs.results) {
    const c = camp.get(r.campaign_id) ?? { chats: 0, answered: 0, ordered: 0 };
    c.chats++;
    if ((byPsid.get(r.psid) ?? []).some((m) => m.from_page && m.at >= r.at)) c.answered++;
    if ((noteAt.get(r.psid) ?? '') >= r.at) c.ordered++;
    camp.set(r.campaign_id, c);
  }
  const page = msgs.results.filter((m) => m.from_page).length;
  return {
    from, to, threads: byPsid.size, customer: msgs.results.length - page, page, replies, unanswered, bands,
    campaigns: [...camp].map(([campaign_id, c]) => ({ campaign_id, ...c })).sort((a, b) => b.chats - a.chats),
    addresses: msgs.results.filter((m) => m.text === '[ที่อยู่]').length,
  };
}

/** The #meta-chat message (≤ 2,000 characters). Campaign names come from the caller. */
export function chatDayText(d: ChatDay, title: string, nameOf: (id: string | null) => string): string {
  const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  const p90 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.9)] : null);
  const mins = (x: number | null) => (x === null ? '–' : x < 1 ? '<1 นาที' : x < 60 ? `${Math.round(x)} นาที` : `${(x / 60).toFixed(1)} ชม.`);
  const lines = [
    `💬 **${title}** — น้องจิบิสรุปแชทค่ะ`,
    `ลูกค้า ${d.threads} คน · ข้อความลูกค้า ${d.customer} · เพจตอบ ${d.page} · ส่งที่อยู่ ${d.addresses} ครั้ง (ประมาณคนที่ตกลงซื้อ)`,
    `⏱ ตอบครั้งแรกเฉลี่ย (มัธยฐาน) **${mins(med(d.replies))}** · ช้าสุด 10% ${mins(p90(d.replies))} · ${d.unanswered ? `⚠️ ยังไม่มีคนตอบ **${d.unanswered} คน**` : '✅ ตอบครบทุกคน'}`,
    `ตามช่วงเวลา: ${d.bands.filter((b) => b.replies.length || b.unanswered).map((b) => `${b.band} น. ${mins(med(b.replies))}${b.unanswered ? ` (ไม่ได้ตอบ ${b.unanswered})` : ''}`).join(' · ') || '–'}`,
  ];
  const camps = d.campaigns.filter((c) => c.campaign_id).slice(0, 8);
  if (camps.length) {
    lines.push('', '**แชทจากแอด** (คนทัก → เพจตอบ → มีโน้ตออเดอร์)');
    for (const c of camps) lines.push(`• ${nameOf(c.campaign_id).slice(0, 48)}: ${c.chats} → ${c.answered} → ${c.ordered}${c.chats >= 5 && c.ordered === 0 ? ' ⚠️' : ''}`);
    const other = d.campaigns.filter((c) => !c.campaign_id).reduce((t, c) => t + c.chats, 0);
    if (other) lines.push(`• ไม่ระบุแอด (ลิงก์ m.me / โพสต์): ${other} คน`);
  }
  lines.push('', '_โน้ตออเดอร์ = แอดมินพิมพ์ "รหัส ไซส์ cod ยอด" ในแชท · ข้อมูลแชทเริ่มเก็บ 15 ต.ค. 12:31 · เบอร์/ที่อยู่ถูกลบก่อนบันทึก_');
  const text = lines.join('\n');
  return text.length > 1990 ? `${text.slice(0, 1987)}…` : text;
}

/** Re-applies redactChat to stored rows (after the rules change); returns how many rows changed. */
export async function reRedactChats(db: D1Database): Promise<number> {
  const { results } = await db.prepare('SELECT mid, text FROM chat_messages WHERE text IS NOT NULL').all<{ mid: string; text: string }>();
  const changed = results.map((r) => ({ mid: r.mid, text: redactChat(r.text) })).filter((r, i) => r.text !== results[i].text);
  for (let i = 0; i < changed.length; i += 200) {
    await db.prepare(`UPDATE chat_messages SET text = (SELECT value->>'text' FROM json_each(?1) WHERE value->>'mid' = chat_messages.mid)
      WHERE mid IN (SELECT value->>'mid' FROM json_each(?1))`).bind(JSON.stringify(changed.slice(i, i + 200))).run();
  }
  return changed.length;
}
