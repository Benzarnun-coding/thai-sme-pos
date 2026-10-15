// Chat log for learning what sells (agreed 2026-10-15): the webhook already sees every Messenger message as a
// standby event (Page365 owns the threads), so the text is kept — after removing phone numbers, e-mails, long
// numbers (tracking, bank, ID) and anything that looks like an address — for 30 days, without names. It is joined
// to ads through ad_referrals.psid and to orders through the admins' order notes. Nothing here replies to anyone.

export interface ChatEvent {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: { is_echo?: boolean; mid?: string; text?: string; attachments?: { type?: string }[] };
}

export interface ChatRow { mid: string; psid: string; at: string; from_page: number; text: string | null; attachments: string | null }

export const CHAT_KEEP_DAYS = 30;
const MAX_TEXT = 1000;

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
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[อีเมล]');
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
      out.push({ mid: m.mid, psid, at: new Date(!ts ? Date.now() : ts < 1e11 ? ts * 1000 : ts).toISOString(), from_page: fromPage ? 1 : 0, text: text || null, attachments: types.length ? types.join(',') : null });
    }
  }
  return out;
}

export async function saveChats(db: D1Database, rows: ChatRow[]): Promise<void> {
  if (!rows.length) return;
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO chat_messages (mid, psid, at, from_page, text, attachments)
      SELECT value->>'mid', value->>'psid', value->>'at', value->>'from_page', value->>'text', value->>'attachments' FROM json_each(?)`).bind(JSON.stringify(rows)),
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
