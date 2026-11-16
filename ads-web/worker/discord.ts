// Discord bot with buttons: heavy rule decisions (pause a campaign, move it down to retest) are posted as a
// question and wait for someone in the channel to press a button. Discord calls /webhook/discord for every
// press (signed with the app's Ed25519 key); budget ±20% still applies on its own.

export interface DiscordEnv {
  DB: D1Database;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_APP_PUBLIC_KEY?: string;
  DISCORD_CHANNEL_ID?: string;
  /** Discord user IDs (comma separated) who decide; mentioned in every question */
  DISCORD_DECIDER_IDS?: string;
  /** Discord user IDs (comma separated) who upload the Page365 file; tagged by the 10:00 reminder */
  DISCORD_UPLOADER_IDS?: string;
}

export const idList = (v: string | undefined) => (v ?? '').split(/[\s,]+/).filter((x) => /^\d{5,25}$/.test(x));
const deciders = (env: DiscordEnv) => idList(env.DISCORD_DECIDER_IDS);

export const approvalsEnabled = (env: DiscordEnv) => !!(env.DISCORD_BOT_TOKEN && env.DISCORD_CHANNEL_ID && env.DISCORD_APP_PUBLIC_KEY);

export interface Proposal {
  id: string; created_at: string; kind: 'pause' | 'move' | 'cap' | 'dup'; entity_id: string; entity_name: string; rule_id: string;
  plan: string; detail: string; status: string; decided_by: string | null; decided_at: string | null; message_id: string | null;
}

/** Ed25519 check of Discord's signature over timestamp + body. */
export async function verifyDiscord(req: Request, body: string, publicKeyHex: string): Promise<boolean> {
  const sig = req.headers.get('X-Signature-Ed25519');
  const ts = req.headers.get('X-Signature-Timestamp');
  if (!sig || !ts) return false;
  const hex = (h: string) => new Uint8Array((h.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
  try {
    const key = await crypto.subtle.importKey('raw', hex(publicKeyHex), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, hex(sig), new TextEncoder().encode(ts + body));
  } catch {
    return false;
  }
}

const STAGE_TH: Record<string, string> = { experiment: 'ทดลอง', testing: 'ทดสอบ', winning: 'ทำเงิน', retest: 'ดับ → ทดสอบใหม่' };

/**
 * The question as Discord shows it: อูนิ (the bot's persona) asks the deciders, lays out what the rule saw,
 * the choices and which one she'd pick, with a button for each choice.
 */
export function proposalMessage(p: Proposal, mention = ''): { content: string; components: unknown[] } {
  const d = JSON.parse(p.detail || '{}');
  const who = mention ? `คุณ ${mention}` : 'ทีม';
  const x = typeof d.observed === 'number' && typeof d.threshold === 'number' && d.threshold > 0 ? d.observed / d.threshold : null;
  const seen = typeof d.observed === 'number' ? `ROAS ${d.window === 'last_3d' ? '3' : '7'} วัน${d.actual ? ' (ยอดขายจริง Page365)' : ''} **${d.observed.toFixed(2)}** เทียบเกณฑ์ ${d.threshold.toFixed(2)}${x !== null ? ` (${Math.round(x * 100)}% ของเกณฑ์)` : ''}` : p.plan;
  let body: string[];
  if ((p.kind as string) === 'test') {
    body = [`อูนิขอทดสอบปุ่มกับ${who}ค่ะ 🙏 กดปุ่มไหนก็ได้ ข้อความนี้ไม่แตะแอดจริงนะคะ`];
  } else if (p.kind === 'cap') {
    body = [
      `อูนิขอถาม${who}ค่ะ 🙏 ขยายเพดานงบรวมต่อวันไหมคะ`,
      `📊 MER จริง 7 วัน (ยอดขาย Page365 ÷ ค่าแอด) **${Number(d.mer).toFixed(2)}** ผ่านเกณฑ์ ${Number(d.need).toFixed(2)} แล้วค่ะ · กำไรสุทธิ 7 วัน ${Math.round(d.net7 ?? 0).toLocaleString('th-TH')} บาท`,
      `เพดานงบรวม **${Number(d.from).toLocaleString('th-TH')} → ${Number(d.to).toLocaleString('th-TH')}** บาท/วัน (+${d.pct}%) — กฎจะค่อยๆ เพิ่มงบตัวที่ทำกำไรได้ถึงเพดานใหม่ ครั้งละไม่เกิน 20%`,
      '',
      '1️⃣ **ขยายเลย**  2️⃣ **ยังไม่ขยาย**',
      '',
      '💡 น้องแนะนำข้อ 1 ค่ะ ตัวเลขจริงคุ้มพอสำหรับเป้ากำไรเดือนนี้',
    ];
  } else if (p.kind === 'dup') {
    body = [
      `อูนิขอถาม${who}ค่ะ 🙏 แคมเปญ **"${p.entity_name}"** ขายดีจนงบชนเพดานแล้ว คัดลอกเพิ่มไหมคะ`,
      `📊 ROAS 3 วัน${d.actual ? ' (ยอดขายจริง Page365)' : ''} **${Number(d.roas).toFixed(2)}** = ${(Number(d.roas) / Number(d.breakeven)).toFixed(1)}× คุ้มทุน (${Number(d.breakeven).toFixed(2)}) · ${d.purchases} ออเดอร์ · งบตอนนี้ ${Number(d.budget).toLocaleString('th-TH')}/วัน (เพดาน)`,
      `ถ้าคัดลอก: ได้แคมเปญใหม่หน้าตาเดียวกัน (ชุดโฆษณา + โฆษณาเดิม) งบ **${Number(d.new_budget).toLocaleString('th-TH')}/วัน** เปิดทันที อยู่กลุ่ม "ทดสอบ" ให้กฎดูแลต่อ — ตัวเดิมไม่ถูกแตะ จะได้ไม่เริ่มเรียนรู้ใหม่`,
      '',
      '1️⃣ **คัดลอกเลย**  2️⃣ **ยังไม่ รอ 3 วัน**',
      '',
      '💡 น้องแนะนำข้อ 1 ค่ะ ตัวนี้คุ้มกว่าคุ้มทุนมาก ถ้าไม่ขยายจะเสียโอกาสขายค่ะ',
    ];
  } else if (p.kind === 'pause') {
    const advise = x !== null && x < 0.8 ? 'ข้อ 1 หยุดเลยค่ะ เพราะต่ำกว่าเกณฑ์มาก ปล่อยไว้จะเสียเงินต่อ'
      : 'ข้อ 3 ย้ายไปกลุ่มทดสอบค่ะ เพราะต่ำกว่าเกณฑ์ไม่มาก ยังขายได้อยู่ ให้กฎกลุ่มทดสอบค่อยๆ ลดงบแทนการหยุดทันที';
    body = [
      `อูนิขอถาม${who}ค่ะ 🙏 แคมเปญ **"${p.entity_name}"** ควรทำยังไงดีคะ`,
      `📊 ${seen}`,
      `กฎ \`${p.rule_id}\` บอกให้ **หยุดแคมเปญ** ค่ะ`,
      '',
      'ทางเลือกที่น้องเสนอค่ะ',
      '1️⃣ **หยุดเลย** — ประหยัดค่าแอดทันที แต่ยอดขายจากแอดตัวนี้หายไปด้วย',
      '2️⃣ **ยังไม่หยุด รอดู 3 วัน** — น้องจะไม่ถามเรื่องนี้ซ้ำ 3 วัน',
      '3️⃣ **ย้ายไปกลุ่มทดสอบ** — ไม่หยุด แต่กฎกลุ่มทดสอบจะลดงบ 20% ถ้ายังต่ำกว่าเกณฑ์',
      '',
      `💡 น้องแนะนำ${advise}`,
    ];
  } else {
    body = [
      `อูนิขอถาม${who}ค่ะ 🙏 แคมเปญ **"${p.entity_name}"** ควรย้ายกลุ่มไหมคะ`,
      `📊 ${seen}`,
      `กฎ \`${p.rule_id}\` บอกให้ย้าย **${STAGE_TH[d.move_from] ?? d.move_from ?? 'ไม่มีกลุ่ม'} → ${STAGE_TH[d.move_to] ?? d.move_to}** ค่ะ (กลุ่มดับจะลดงบ 20% ทุก 48 ชม. และหยุดถ้า 7 วันยังไม่ฟื้น)`,
      '',
      '1️⃣ **ย้ายเลย**  2️⃣ **ยังไม่ย้าย รอดู 3 วัน**',
      '',
      '💡 น้องแนะนำข้อ 1 ค่ะ ผลต่ำกว่าคุ้มทุนมาครบ 7 วันแล้ว',
    ];
  }
  body.push('', '_ถ้ายังไม่มีใครกด รอบถัดไปน้องจะถามใหม่นะคะ_');
  return {
    content: body.join('\n'),
    components: [{ type: 1, components: (p.kind as string) === 'test'
      ? [{ type: 2, style: 3, label: 'ทดสอบ: ตกลง', custom_id: `approve:${p.id}` }, { type: 2, style: 2, label: 'ทดสอบ: ไม่', custom_id: `reject:${p.id}` }]
      : [
        { type: 2, style: p.kind === 'cap' || p.kind === 'dup' ? 3 : 4, label: { pause: '1️⃣ หยุดเลย', cap: '1️⃣ ขยายเลย', dup: '1️⃣ คัดลอกเลย', move: '1️⃣ ย้ายเลย' }[p.kind], custom_id: `approve:${p.id}` },
        { type: 2, style: 2, label: { pause: '2️⃣ ยังไม่หยุด รอ 3 วัน', cap: '2️⃣ ยังไม่ขยาย', dup: '2️⃣ ยังไม่ รอ 3 วัน', move: '2️⃣ ยังไม่ย้าย รอ 3 วัน' }[p.kind], custom_id: `reject:${p.id}` },
        ...(p.kind === 'pause' ? [{ type: 2, style: 1, label: '3️⃣ ย้ายไปทดสอบ', custom_id: `totesting:${p.id}` }] : []),
      ] }],
  };
}

export async function postProposal(env: DiscordEnv, p: Proposal): Promise<string | null> {
  const ids = deciders(env);
  const res = await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    // Only the deciders are pinged, whatever else the text contains.
    body: JSON.stringify({ ...proposalMessage(p, ids.map((id) => `<@${id}>`).join(' ')), allowed_mentions: { users: ids } }),
  });
  if (!res.ok) { console.error('discord post', res.status, await res.text()); return null; }
  return ((await res.json()) as { id: string }).id;
}

/** The 10:00 reminder when yesterday's Page365 file is missing: tags the uploaders, who answer with a button. */
export function uploadReminderMessage(date: string, thai: string, mention: string, note = ''): { content: string; components: unknown[] } {
  return {
    content: [
      `📂 อูนิเตือนค่ะ ${mention ? `คุณ ${mention}` : 'ทีม'} 🙏 ยังไม่มีไฟล์ Page365 ของ **${thai}** เลยค่ะ`,
      'รบกวน export ออเดอร์ของเมื่อวาน (ตัวกรองเดียวกับชีต "รวม") แล้วอัปโหลดที่หน้า **ยอดขายรายวัน** นะคะ',
      'อัปโหลดเสร็จแล้วกด **"อัปโหลดแล้ว"** ได้เลยค่ะ น้องจะเช็กให้',
      ...(note ? ['', note] : []),
    ].join('\n'),
    components: [{ type: 1, components: [
      { type: 2, style: 3, label: '✅ อัปโหลดแล้ว', custom_id: `p365done:${date}` },
      { type: 2, style: 2, label: '⏳ ยังไม่ได้ เดี๋ยวทำ', custom_id: `p365later:${date}` },
    ] }],
  };
}

export async function postUploadReminder(env: DiscordEnv, date: string, thai: string): Promise<boolean> {
  const ids = idList(env.DISCORD_UPLOADER_IDS);
  const res = await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...uploadReminderMessage(date, thai, ids.map((id) => `<@${id}>`).join(' ')), allowed_mentions: { users: ids } }),
  });
  if (!res.ok) console.error('discord reminder', res.status, await res.text());
  return res.ok;
}

/** A plain message from the bot that pings the deciders (Max); false when the bot isn't set up or Discord refused. */
export async function postToDeciders(env: DiscordEnv, content: (mention: string) => string): Promise<boolean> {
  if (!approvalsEnabled(env)) return false;
  const ids = deciders(env);
  const res = await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: content(ids.map((id) => `<@${id}>`).join(' ')).slice(0, 2000), allowed_mentions: { users: ids } }),
  });
  if (!res.ok) console.error('discord post', res.status, await res.text());
  return res.ok;
}

/** Edit an earlier question (e.g. mark it expired) so its buttons go away. */
export async function editMessage(env: DiscordEnv, messageId: string, content: string): Promise<void> {
  await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_CHANNEL_ID}/messages/${messageId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, components: [] }),
  }).catch(() => null);
}

export async function saveProposals(db: D1Database, list: Proposal[]): Promise<void> {
  if (!list.length) return;
  await db.prepare(`INSERT INTO proposals (id, created_at, kind, entity_id, entity_name, rule_id, plan, detail, status, message_id)
    SELECT value->>'id', value->>'created_at', value->>'kind', value->>'entity_id', value->>'entity_name', value->>'rule_id', value->>'plan', value->>'detail', 'pending', NULL
    FROM json_each(?)`).bind(JSON.stringify(list)).run();
}

/** Same rule on the same campaign was answered "no" in the last 3 days, or is still waiting: don't ask again. */
export async function recentlyAsked(db: D1Database, since: string): Promise<Set<string>> {
  const { results } = await db.prepare(`SELECT entity_id, rule_id, status FROM proposals WHERE (status = 'rejected' AND decided_at >= ?) OR status = 'pending'`)
    .bind(since).all<{ entity_id: string; rule_id: string; status: string }>();
  return new Set(results.map((r) => `${r.rule_id}:${r.entity_id}`));
}

/**
 * Pending questions older than the new run are closed: the new run asks again if the rule still holds.
 * `capOnly` (the weekly cap check, which runs right after the Monday 08:00 run) closes only stale cap questions,
 * so the pause/move/dup questions that run just posted stay open.
 */
export async function expireOld(env: DiscordEnv, before: string, opts: { capOnly?: boolean } = {}): Promise<void> {
  // The weekly cap question stays open for 6 days; the rest are asked again by the next run.
  const capBefore = new Date(Date.parse(before) - 6 * 86_400_000).toISOString();
  const where = opts.capOnly
    ? `status = 'pending' AND kind = 'cap' AND created_at < ?2`
    : `status = 'pending' AND ((kind != 'cap' AND created_at < ?1) OR (kind = 'cap' AND created_at < ?2))`;
  const { results } = await env.DB.prepare(`SELECT * FROM proposals WHERE ${where}`).bind(before, capBefore).all<Proposal>();
  if (!results.length) return;
  await env.DB.prepare(`UPDATE proposals SET status = 'expired', decided_at = ?3 WHERE ${where}`).bind(before, capBefore, new Date().toISOString()).run();
  for (const p of results) if (p.message_id) await editMessage(env, p.message_id, `⌛ หมดเวลา (ไม่มีคนกด) — ${{ pause: 'หยุด', cap: 'ขยายเพดานงบ', dup: 'คัดลอก', move: 'ย้าย' }[p.kind] ?? 'ย้าย'} "${p.entity_name}" · รอบนี้ถามใหม่ถ้ายังเข้าเงื่อนไข`);
}

/** With the kill switch on, a button press must not change Meta or raise the spend cap; moving a stage (D1 only) or saying no is fine. */
export function blockedByKillSwitch(verb: string, kind: string): boolean {
  return verb === 'approve' && (kind === 'pause' || kind === 'dup' || kind === 'cap');
}
