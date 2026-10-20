// Website feature requests from Discord (Benz 2026-10-20). Anyone types /ไอเดีย → a form → the bot opens a post in
// the forum channel DISCORD_REQUEST_CHANNEL_ID with buttons. Each request walks:
//   new ──ให้ทำ──▶ doing ──ทำเสร็จแล้ว──▶ review ──ผ่าน──▶ passed
//    └──ไม่ทำ──▶ dropped                      └──ไม่ผ่าน (reason)──▶ doing
// Benz (DISCORD_REQUEST_DECIDER_IDS) decides ให้ทำ / ไม่ทำ; whoever builds it (DISCORD_APPROVER_IDS or a decider) presses
// ทำเสร็จแล้ว; the person who asked checks it (ผ่าน / ไม่ผ่าน, Benz 2026-10-20), and a decider may check for them.
// Every press is a row in feature_request_log; the post's title carries the status emoji. Page: /requests.
// Off until DISCORD_REQUEST_CHANNEL_ID is set (the command answers that it's not switched on).

import { idList } from './discord.ts';

export interface RequestEnv {
  DB: D1Database;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_APP_ID?: string;
  DISCORD_APPROVER_IDS?: string;
  /** Forum channel for the posts; empty = /ไอเดีย is off */
  DISCORD_REQUEST_CHANNEL_ID?: string;
  /** The only channel where /ไอเดีย may be typed (#เสนอพัฒนาระบบ, Benz 2026-10-20); empty = anywhere */
  DISCORD_REQUEST_COMMAND_CHANNEL_ID?: string;
  /** Claude Code routine that builds an approved request (var: trig_… id; secret: its API trigger token). Both set = on. */
  IDEA_ROUTINE_ID?: string;
  IDEA_ROUTINE_TOKEN?: string;
  /** owner/name on GitHub, where the routine opens its PR (public repo: read without a token) */
  GITHUB_REPO?: string;
  /** Who may press ให้ทำ / ไม่ทำ / ผ่าน / ไม่ผ่าน (Benz); empty = DISCORD_APPROVER_IDS */
  DISCORD_REQUEST_DECIDER_IDS?: string;
}

export type Status = 'new' | 'doing' | 'review' | 'passed' | 'dropped';
export type Verb = 'go' | 'no' | 'done' | 'pass' | 'fail';

export interface FeatureRequest {
  id: number; created_at: string; author: string; author_id: string | null; area: string; title: string;
  detail: string | null; status: Status; thread_id: string | null; updated_at: string;
  run_url?: string | null; run_at?: string | null; runs?: number; pr_url?: string | null; pr_at?: string | null;
}
export interface LogRow { id: number; request_id: number; at: string; by: string; from_status: string | null; to_status: string; note: string | null }

export const COMMAND_NAME = 'ไอเดีย';
export const AREAS: Record<string, string> = { ads: 'แอด', backoffice: 'หลังบ้าน', gosell: 'GoSell', orders: 'ออเดอร์/บิล', bug: 'บั๊ก', other: 'อื่นๆ' };
export const STATUS: Record<Status, { emoji: string; th: string }> = {
  new: { emoji: '💡', th: 'ไอเดียใหม่' },
  doing: { emoji: '🔨', th: 'กำลังทำ' },
  review: { emoji: '🧪', th: 'รอตรวจ' },
  passed: { emoji: '✅', th: 'ผ่านแล้ว' },
  dropped: { emoji: '❌', th: 'ไม่ทำ' },
};
/** Which press moves which status; anything else is refused. */
const MOVES: Record<Verb, { from: Status; to: Status }> = {
  go: { from: 'new', to: 'doing' },
  no: { from: 'new', to: 'dropped' },
  done: { from: 'doing', to: 'review' },
  pass: { from: 'review', to: 'passed' },
  fail: { from: 'review', to: 'doing' },
};
export const nextStatus = (from: Status, verb: Verb): Status | null => (MOVES[verb]?.from === from ? MOVES[verb].to : null);

export const deciderIds = (env: RequestEnv) => idList(env.DISCORD_REQUEST_DECIDER_IDS).length ? idList(env.DISCORD_REQUEST_DECIDER_IDS) : idList(env.DISCORD_APPROVER_IDS);
/**
 * Deciders press every button; "ทำเสร็จแล้ว" may also be pressed by the approvers (the people who build); "ผ่าน /
 * ไม่ผ่าน" by the person who asked, since they know what they wanted. Empty decider list = anyone.
 */
export function mayPress(env: RequestEnv, verb: Verb, userId: string, authorId: string | null): boolean {
  const deciders = deciderIds(env);
  const allowed = verb === 'done' ? [...deciders, ...idList(env.DISCORD_APPROVER_IDS)]
    : verb === 'pass' || verb === 'fail' ? [...deciders, ...(authorId ? [authorId] : [])]
    : deciders;
  return !deciders.length || allowed.includes(userId);
}

/** The forum post's title: status emoji + #id + title (Discord caps thread names at 100). */
export const threadName = (r: Pick<FeatureRequest, 'id' | 'title' | 'status'>) => `${STATUS[r.status].emoji} #${r.id} ${r.title}`.slice(0, 100);

const when = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });

/** The post's first message: the request, its history, and the buttons that fit its status. */
export function requestMessage(r: FeatureRequest, log: LogRow[]): { content: string; components: unknown[] } {
  const s = STATUS[r.status];
  const lines = [
    `**${s.emoji} ${s.th}** · ${AREAS[r.area] ?? r.area} · เสนอโดย ${r.author}`,
    '',
    (r.detail || '-').slice(0, 1500),
    '',
    ...(r.run_url ? [`🤖 Claude ทำรอบที่ ${r.runs ?? 1}: ${r.run_url}${r.pr_url ? ` · PR: ${r.pr_url}` : ''}`, ''] : []),
    ...log.map((l) => `\`${when(l.at)}\` ${STATUS[l.to_status as Status]?.emoji ?? ''} ${l.by}${l.from_status ? ` → ${STATUS[l.to_status as Status]?.th ?? l.to_status}` : ' เสนอไอเดีย'}${l.note ? ` — ${l.note}` : ''}`),
  ];
  const b = (style: number, label: string, verb: Verb) => ({ type: 2, style, label, custom_id: `fr:${verb}:${r.id}` });
  const buttons = r.status === 'new' ? [b(3, '🔨 ให้ทำ', 'go'), b(2, '❌ ไม่ทำ', 'no')]
    : r.status === 'doing' ? [b(1, '🧪 ทำเสร็จแล้ว ส่งตรวจ', 'done')]
    : r.status === 'review' ? [b(3, '✅ ผ่าน', 'pass'), b(4, '↩️ ไม่ผ่าน', 'fail')]
    : [];
  return { content: lines.join('\n').slice(0, 2000), components: buttons.length ? [{ type: 1, components: buttons }] : [] };
}

/** The slash command as registered with Discord: one required "หมวด" choice, the rest comes in a form. */
export const COMMAND = {
  name: COMMAND_NAME,
  type: 1,
  description: 'เสนอไอเดียพัฒนาเว็บ (เปิดโพสต์ในห้องไอเดีย)',
  options: [{ type: 3, name: 'หมวด', description: 'เรื่องของหน้าไหน', required: true, choices: Object.entries(AREAS).map(([value, name]) => ({ name, value })) }],
};

/** The form opened by /ไอเดีย; the area rides in its custom_id. */
export function requestModal(area: string) {
  const input = (custom_id: string, label: string, style: number, max: number, placeholder: string) =>
    ({ type: 1, components: [{ type: 4, custom_id, label, style, max_length: max, required: true, placeholder }] });
  return {
    custom_id: `frnew:${area in AREAS ? area : 'other'}`,
    title: 'เสนอไอเดียพัฒนาเว็บ',
    components: [
      input('title', 'ชื่อเรื่อง (สั้นๆ)', 1, 80, 'เช่น หน้ากำไรกรองตามสินค้าได้'),
      input('detail', 'อยากได้อะไร ใช้ทำอะไร', 2, 1500, 'เล่าเหมือนเล่าให้เพื่อนฟัง: ตอนนี้ทำยังไง ติดตรงไหน อยากให้เป็นยังไง'),
    ],
  };
}

/**
 * The pinned message in #เสนอพัฒนาระบบ: one button per หมวด opens the same form as /ไอเดีย. Buttons need nothing from
 * Discord's command settings, so everyone can use them (typing /ไอเดีย didn't reach some of the team, 2026-10-20).
 */
export function pickerMessage(): { content: string; components: unknown[] } {
  const b = (area: string, emoji: string) => ({ type: 2, style: area === 'bug' ? 4 : 1, label: `${emoji} ${AREAS[area]}`, custom_id: `frpick:${area}` });
  return {
    content: [
      '💡 **เสนอไอเดียพัฒนาเว็บ** — กดปุ่มหมวดด้านล่าง แล้วกรอกฟอร์มได้เลยค่ะ',
      'น้องจิบิเปิดโพสต์ให้ → คุณเบ้นกด "ให้ทำ / ไม่ทำ" → ทำเสร็จแล้ว**คนเสนอ**ลองใช้ แล้วกด "ผ่าน / ไม่ผ่าน"',
      '',
      '📣 **แอด** — หน้าแรกของเว็บ (แดชบอร์ดแอด) คุมแอด Meta',
      '• ภาพรวม ROAS กำไรต่อแคมเปญ เป้ากำไร · ยอดขายรายวัน (Page365 เทียบ Meta) · ไอเดียโพสต์ · คู่แข่ง',
      '• กฎปรับงบ + กลุ่มทดลอง/ทดสอบ/ทำเงิน/ดับ · สินค้า/ต้นทุน · ประวัติ ตั้งค่า ผู้ใช้',
      '• บอทห้องแอด: รายงาน 08:00/20:00 ปุ่มอนุมัติหยุด/ย้าย/คัดลอก เช็กเพดานงบวันจันทร์',
      '📦 **หลังบ้าน** — ของ สต็อก เงิน',
      '• แคตตาล็อก (SKU รูป ราคา ร้าน) · สั่งของ (ใบสั่งต่อร้าน/โกดัง ยอดค้างจ่าย) · ยอดขาย (ชิ้น)',
      '• กำไร (Page365 + ไฟล์เงินแพลตฟอร์ม) · สต็อกที่พี่เปีย · งานค้าง · รายงาน 07:30 ใน #report',
      '🔄 **GoSell** — หน้าแปลงไฟล์ Bigseller → ไฟล์ Import GoSell (ขนส่ง ราคา ส่วนลด COD)',
      '🧾 **ออเดอร์/บิล** — จากแชทลูกค้าไปเป็นบิล',
      '• Log ออเดอร์แชท: โน้ตในแชท → บิล Page365 (สินค้า ไซส์ ที่อยู่ รหัสไปรษณีย์)',
      '• ไฟล์ Page365 + เตือน 10:00 · service-ลูกค้า (ร้องเรียน คืนเงิน ส่งผิด)',
      '🐞 **บั๊ก** — ของที่เคยใช้ได้แล้วพัง: หน้าไม่ขึ้น ปุ่มกดไม่ได้ ตัวเลขผิด บอทตอบผิด (บอกหน้า + เวลา)',
      '💬 **อื่นๆ** — คลังคำตอบบอท Business AI · ระบบไอเดียนี้ · หน้าใหม่ที่ยังไม่มีในเว็บ',
      '',
      '**จำง่ายๆ** เงินแอด → แอด · ของ/สต็อก → หลังบ้าน · แชท/บิล → ออเดอร์/บิล · ของพัง → บั๊ก',
      'เขียนให้ทำได้เร็ว: ตอนนี้ทำยังไง → ติดตรงไหน → อยากให้เป็นยังไง',
    ].join('\n'),
    components: [
      { type: 1, components: [b('ads', '📣'), b('backoffice', '📦'), b('gosell', '🔄')] },
      { type: 1, components: [b('orders', '🧾'), b('bug', '🐞'), b('other', '💬')] },
    ],
  };
}

export const failModal = (id: number) => ({
  custom_id: `frfail:${id}`,
  title: 'ไม่ผ่าน — ต้องแก้อะไร',
  components: [{ type: 1, components: [{ type: 4, custom_id: 'note', label: 'สิ่งที่ต้องแก้', style: 2, max_length: 500, required: true }] }],
});

/** Text inputs of a submitted modal by custom_id. */
export function modalValues(data: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of data?.components ?? []) for (const c of row?.components ?? [row?.component].filter(Boolean)) if (c?.custom_id) out[c.custom_id] = String(c.value ?? '').trim();
  return out;
}

// ---- storage ----

export async function loadRequest(db: D1Database, id: number): Promise<{ r: FeatureRequest; log: LogRow[] } | null> {
  const r = await db.prepare('SELECT * FROM feature_requests WHERE id = ?').bind(id).first<FeatureRequest>();
  if (!r) return null;
  const { results } = await db.prepare('SELECT * FROM feature_request_log WHERE request_id = ? ORDER BY id').bind(id).all<LogRow>();
  return { r, log: results };
}

export async function listRequests(db: D1Database): Promise<(FeatureRequest & { log: LogRow[] })[]> {
  const [{ results: rows }, { results: log }] = await Promise.all([
    db.prepare('SELECT * FROM feature_requests ORDER BY id DESC LIMIT 500').all<FeatureRequest>(),
    db.prepare('SELECT * FROM feature_request_log WHERE request_id IN (SELECT id FROM feature_requests ORDER BY id DESC LIMIT 500) ORDER BY id').all<LogRow>(),
  ]);
  return rows.map((r) => ({ ...r, log: log.filter((l) => l.request_id === r.id) }));
}

export async function createRequest(db: D1Database, v: { author: string; author_id: string; area: string; title: string; detail: string }, at = new Date().toISOString()): Promise<FeatureRequest> {
  const r = await db.prepare(`INSERT INTO feature_requests (created_at, author, author_id, area, title, detail, status, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'new', ?1) RETURNING *`)
    .bind(at, v.author, v.author_id, v.area in AREAS ? v.area : 'other', v.title.slice(0, 80), v.detail.slice(0, 1500)).first<FeatureRequest>();
  await db.prepare('INSERT INTO feature_request_log (request_id, at, by, from_status, to_status) VALUES (?, ?, ?, NULL, ?)').bind(r!.id, at, v.author, 'new').run();
  return r!;
}

/** Applies a press if the request is still in the status the button was made for; null = someone got there first. */
export async function moveRequest(db: D1Database, id: number, verb: Verb, by: string, note: string | null, at = new Date().toISOString()): Promise<{ r: FeatureRequest; log: LogRow[] } | null> {
  const m = MOVES[verb];
  if (!m) return null;
  const done = await db.prepare('UPDATE feature_requests SET status = ?, updated_at = ? WHERE id = ? AND status = ?').bind(m.to, at, id, m.from).run();
  if (!done.meta.changes) return null;
  await db.prepare('INSERT INTO feature_request_log (request_id, at, by, from_status, to_status, note) VALUES (?, ?, ?, ?, ?, ?)').bind(id, at, by, m.from, m.to, note).run();
  return loadRequest(db, id);
}

// ---- Discord ----

const api = (env: RequestEnv, path: string, method: string, body?: unknown) => fetch(`https://discord.com/api/v10${path}`, {
  method,
  headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** Opens the forum post (title, first message with buttons, the area's forum tag if one has that name) and pings the deciders in it. */
export async function postRequest(env: RequestEnv, r: FeatureRequest, log: LogRow[]): Promise<string | null> {
  const ch = await api(env, `/channels/${env.DISCORD_REQUEST_CHANNEL_ID}`, 'GET').then((x) => (x.ok ? x.json() as Promise<{ available_tags?: { id: string; name: string }[] }> : null)).catch(() => null);
  const tag = ch?.available_tags?.find((t) => t.name.replace(/^\W+/u, '').trim() === AREAS[r.area]);
  const res = await api(env, `/channels/${env.DISCORD_REQUEST_CHANNEL_ID}/threads`, 'POST', {
    name: threadName(r),
    applied_tags: tag ? [tag.id] : [],
    message: { ...requestMessage(r, log), allowed_mentions: { parse: [] } },
  });
  if (!res.ok) { console.error('discord request post', res.status, await res.text()); return null; }
  const thread = ((await res.json()) as { id: string }).id;
  await env.DB.prepare('UPDATE feature_requests SET thread_id = ? WHERE id = ?').bind(thread, r.id).run();
  await say(env, thread, deciderIds(env), (m) => `${m} มีไอเดียใหม่ค่ะ 🙏 กด **ให้ทำ** หรือ **ไม่ทำ** ที่ข้อความแรกของโพสต์นี้ได้เลยนะคะ`);
  return thread;
}

/**
 * After a press: the people who act next are pinged in the post, then the post's title follows the status. Pings go
 * first: Discord lets a post be renamed only twice per 10 minutes, so quick presses leave the title behind (the
 * 3-hourly sweep catches it up via syncTitles) and must not hold back the pings.
 */
export async function afterMove(env: RequestEnv, r: FeatureRequest, by: string, note: string | null): Promise<void> {
  if (!r.thread_id) return;
  if (r.status === 'doing') await startBuild(env, r, note);
  if (r.status === 'review') await say(env, r.thread_id, r.author_id ? [r.author_id] : deciderIds(env), (m) => `${m} ${by} ทำเสร็จแล้วค่ะ 🧪 รบกวนลองใช้บนเว็บว่าตรงกับที่อยากได้ไหม แล้วกด **ผ่าน** หรือ **ไม่ผ่าน** (บอกว่าต้องแก้อะไร) ที่ข้อความแรกของโพสต์นี้นะคะ`);
  if (r.status === 'doing' && note) await say(env, r.thread_id, [], () => `↩️ ยังไม่ผ่านค่ะ — ${note}`);
  if (r.status === 'passed') await say(env, r.thread_id, [], () => `✅ ${by} ตรวจผ่านแล้วค่ะ ไอเดียนี้ใช้งานบนเว็บได้แล้ว ขอบคุณที่เสนอนะคะ 🙏`);
  await rename(env, r);
}

/** Renames the post unless Discord's rename limit is hit; a short timeout so a held request can't eat the Worker's time. */
async function rename(env: RequestEnv, r: FeatureRequest): Promise<boolean> {
  const res = await Promise.race([
    api(env, `/channels/${r.thread_id}`, 'PATCH', { name: threadName(r) }).catch(() => null),
    new Promise<null>((ok) => setTimeout(() => ok(null), 5000)),
  ]);
  if (res && !res.ok) console.error('discord request rename', r.id, res.status, (await res.text()).slice(0, 200));
  return !!res?.ok;
}

/** 3-hourly: titles of posts changed in the last day are set again, so a rename Discord refused catches up. */
export async function syncTitles(env: RequestEnv): Promise<number> {
  if (!env.DISCORD_REQUEST_CHANNEL_ID || !env.DISCORD_BOT_TOKEN) return 0;
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { results } = await env.DB.prepare('SELECT * FROM feature_requests WHERE thread_id IS NOT NULL AND updated_at >= ? ORDER BY id LIMIT 20').bind(since).all<FeatureRequest>();
  const cur = await Promise.all(results.map((r) => api(env, `/channels/${r.thread_id}`, 'GET').then((x) => (x.ok ? x.json() as Promise<{ name?: string }> : null)).catch(() => null)));
  let n = 0;
  for (const [k, r] of results.entries()) if (cur[k] && cur[k]!.name !== threadName(r) && (await rename(env, r))) n++;
  return n;
}

async function say(env: RequestEnv, channel: string, ids: string[], text: (mention: string) => string): Promise<void> {
  const res = await api(env, `/channels/${channel}/messages`, 'POST', { content: text(ids.map((id) => `<@${id}>`).join(' ')).slice(0, 2000), allowed_mentions: { users: ids } }).catch(() => null);
  if (res && !res.ok) console.error('discord request say', res.status, await res.text());
}

/**
 * Posts the picker (pickerMessage) in the command channel and pins it, or, when the bot already pinned one there,
 * edits that message in place (new wording, same buttons). Pinning needs Pin/Manage Messages there.
 */
export async function postPicker(env: RequestEnv): Promise<{ ok: boolean; pinned: boolean; updated?: boolean; error?: string }> {
  const ch = env.DISCORD_REQUEST_COMMAND_CHANNEL_ID;
  if (!ch || !env.DISCORD_BOT_TOKEN) return { ok: false, pinned: false, error: 'ยังไม่ได้ตั้ง DISCORD_REQUEST_COMMAND_CHANNEL_ID / DISCORD_BOT_TOKEN' };
  const pins = await api(env, `/channels/${ch}/pins`, 'GET').then((x) => (x.ok ? x.json() as Promise<{ id: string; components?: any[] }[]> : [])).catch(() => []);
  const old = pins.find((m) => JSON.stringify(m.components ?? []).includes('frpick:'));
  if (old) {
    const res = await api(env, `/channels/${ch}/messages/${old.id}`, 'PATCH', pickerMessage());
    if (res.ok) return { ok: true, pinned: true, updated: true };
  }
  const res = await api(env, `/channels/${ch}/messages`, 'POST', { ...pickerMessage(), allowed_mentions: { parse: [] } });
  if (!res.ok) return { ok: false, pinned: false, error: `Discord ${res.status}: ${(await res.text()).slice(0, 300)}` };
  const id = ((await res.json()) as { id: string }).id;
  const pin = await api(env, `/channels/${ch}/pins/${id}`, 'PUT').catch(() => null);
  return { ok: true, pinned: !!pin?.ok };
}

// ---- Claude builds it ----

export const buildEnabled = (env: RequestEnv) => !!(env.IDEA_ROUTINE_ID && env.IDEA_ROUTINE_TOKEN);
export const branchFor = (id: number) => `claude/idea-${id}`;
/** Pushed by the run after a successful deploy; one per run, so a "ไม่ผ่าน" rerun needs its own. */
export const deployTag = (r: Pick<FeatureRequest, 'id' | 'runs'>) => `deployed/idea-${r.id}-r${r.runs ?? 1}`;

/** What the routine receives (it arrives as untrusted data; the routine's saved prompt says what to do with it). */
export function buildPayload(r: FeatureRequest, log: LogRow[]): string {
  const fails = log.filter((l) => l.from_status === 'review' && l.to_status === 'doing' && l.note).map((l) => `- ${l.note}`);
  return [
    `ไอเดีย #${r.id}: ${r.title}`,
    `หมวด: ${AREAS[r.area] ?? r.area}`,
    `เสนอโดย: ${r.author}`,
    `branch (ถ้าต้องรอรีวิว): ${branchFor(r.id)}`,
    `tag หลัง deploy สำเร็จ: ${deployTag({ id: r.id, runs: (r.runs ?? 0) + 1 })}`,
    `รอบที่: ${(r.runs ?? 0) + 1}`,
    '',
    'รายละเอียดจากคนเสนอ:',
    r.detail || '-',
    ...(fails.length ? ['', 'ตรวจแล้วไม่ผ่าน ต้องแก้ (ล่าสุดอยู่ล่างสุด):', ...fails] : []),
  ].join('\n');
}

/** Fires the routine for a request that just became กำลังทำ; says in the post where to watch it. Off = nothing. */
export async function startBuild(env: RequestEnv, r: FeatureRequest, note: string | null): Promise<void> {
  if (!buildEnabled(env) || !r.thread_id) return;
  const got = await loadRequest(env.DB, r.id);
  const res = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${env.IDEA_ROUTINE_ID}/fire`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.IDEA_ROUTINE_TOKEN}`, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: buildPayload(got?.r ?? r, got?.log ?? []) }),
  }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }) as Response);
  if (!res.ok) {
    const why = `${res.status} ${(await res.text()).slice(0, 200)}`;
    console.error('idea routine', r.id, why);
    await say(env, r.thread_id, deciderIds(env), (m) => `${m} สั่ง Claude เริ่มทำไม่สำเร็จค่ะ (${why}) — รบกวนเปิด session ทำเองนะคะ`);
    return;
  }
  const url = ((await res.json()) as { claude_code_session_url?: string }).claude_code_session_url ?? null;
  const at = new Date().toISOString();
  await env.DB.prepare('UPDATE feature_requests SET run_url = ?, run_at = ?, runs = runs + 1 WHERE id = ?').bind(url, at, r.id).run();
  await say(env, r.thread_id, [], () => `🤖 Claude เริ่ม${note ? 'แก้ตามที่ไม่ผ่าน' : 'ทำ'}แล้วค่ะ ดูความคืบหน้าได้ที่ ${url ?? '(ไม่มีลิงก์)'}\nทำเสร็จแล้วจะขึ้นเว็บให้เอง แล้วน้องจะแท็กคนเสนอให้มาลองใช้ค่ะ (ถ้าเรื่องนี้แตะส่วนที่ต้องให้คุณเบ้นดูก่อน จะเปิด PR รอรีวิวแทน)`);
}

/**
 * Looks on GitHub for the PR of every request Claude is working on; a PR updated after the latest run → tell Benz in
 * the post once per run. Public repo, so no token; at most 10 requests a call.
 */
export async function checkBuilds(env: RequestEnv): Promise<number> {
  if (!buildEnabled(env) || !env.GITHUB_REPO) return 0;
  const { results } = await env.DB.prepare(`SELECT * FROM feature_requests WHERE status = 'doing' AND run_at IS NOT NULL AND (pr_at IS NULL OR pr_at < run_at) ORDER BY id LIMIT 10`).all<FeatureRequest>();
  const owner = env.GITHUB_REPO.split('/')[0];
  let n = 0;
  const gh = (path: string) => fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, { headers: { 'User-Agent': 'pkjeans-ads', Accept: 'application/vnd.github+json' } })
    .then((x) => (x.ok ? x.json() as Promise<any> : null)).catch(() => null);
  for (const r of results) {
    const branch = branchFor(r.id);
    // Deployed: the run pushes tag deployed/idea-<id>-r<run> after its deploy → รอตรวจ, the asker is pinged to try it.
    if (await gh(`/git/ref/tags/${encodeURIComponent(deployTag(r))}`)) {
      await env.DB.prepare('UPDATE feature_requests SET pr_at = ? WHERE id = ?').bind(new Date().toISOString(), r.id).run();
      const moved = await moveRequest(env.DB, r.id, 'done', 'Claude 🤖', null);
      if (moved?.r.thread_id) {
        await api(env, `/channels/${moved.r.thread_id}/messages/${moved.r.thread_id}`, 'PATCH', requestMessage(moved.r, moved.log)).catch(() => null);
        await afterMove(env, moved.r, 'Claude 🤖', null);
      }
      n++;
      continue;
    }
    // The PR if the run opened one; else the pushed branch, with GitHub's one-click "open a PR" page.
    const pr = ((await gh(`/pulls?state=all&head=${owner}:${encodeURIComponent(branch)}`)) as { html_url: string; updated_at: string }[] | null)?.[0];
    let link: string | null = pr && pr.updated_at >= r.run_at! ? pr.html_url : null;
    if (!link && !pr) {
      const b = await gh(`/branches/${encodeURIComponent(branch)}`) as { commit?: { commit?: { committer?: { date?: string } } } } | null;
      const at = b?.commit?.commit?.committer?.date;
      if (at && new Date(at).toISOString() >= r.run_at!) link = `https://github.com/${env.GITHUB_REPO}/compare/ads-web...${branch}?expand=1`;
    }
    if (!link) continue;
    await env.DB.prepare('UPDATE feature_requests SET pr_url = ?, pr_at = ? WHERE id = ?').bind(link, new Date().toISOString(), r.id).run();
    if (r.thread_id) await say(env, r.thread_id, deciderIds(env), (m) => `${m} Claude ทำเสร็จแล้ว แต่เรื่องนี้ต้องให้คุณเบ้นดูก่อนขึ้นเว็บค่ะ 🔍 ${link}\nรีวิว → merge เข้า ads-web → deploy แล้วกด **ทำเสร็จแล้ว ส่งตรวจ** ที่ข้อความแรกได้เลยค่ะ`);
    n++;
  }
  return n;
}

/** Registers (or updates) /ไอเดีย for the app; Discord upserts a global command by name. */
export async function registerCommand(env: RequestEnv): Promise<{ ok: boolean; status: number; body: string }> {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_APP_ID) return { ok: false, status: 0, body: 'ยังไม่ได้ตั้ง DISCORD_BOT_TOKEN / DISCORD_APP_ID' };
  const res = await api(env, `/applications/${env.DISCORD_APP_ID}/commands`, 'POST', COMMAND);
  return { ok: res.ok, status: res.status, body: (await res.text()).slice(0, 500) };
}

const reply = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const only = (content: string) => reply({ type: 4, data: { content, flags: 64 } });

/**
 * Everything Discord sends about requests: the /ไอเดีย command (→ form), the form (→ row + forum post), the buttons
 * on a post, and the "ไม่ผ่าน" reason form. null = not ours. Works from any channel: a button is checked against
 * the post it belongs to instead.
 */
export async function requestInteraction(i: any, env: RequestEnv, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response | null> {
  const who = i.member?.user?.global_name || i.member?.user?.username || i.user?.global_name || i.user?.username || 'ไม่ทราบชื่อ';
  const userId = String(i.member?.user?.id ?? i.user?.id ?? '');
  const cid = String(i.data?.custom_id ?? '');
  if (i.type === 2 && i.data?.name === COMMAND_NAME) {
    if (!env.DISCORD_REQUEST_CHANNEL_ID) return only('ห้องไอเดียยังไม่เปิดใช้ค่ะ 🙏 (ยังไม่ได้ตั้ง DISCORD_REQUEST_CHANNEL_ID)');
    const here = env.DISCORD_REQUEST_COMMAND_CHANNEL_ID;
    if (here && i.channel_id !== here) return only(`พิมพ์ /ไอเดีย ได้ในห้อง <#${here}> เท่านั้นนะคะ 🙏`);
    const area = String(i.data?.options?.find((o: any) => o.name === 'หมวด')?.value ?? 'other');
    return reply({ type: 9, data: requestModal(area) });
  }
  if (i.type === 3 && cid.startsWith('frpick:')) {
    if (!env.DISCORD_REQUEST_CHANNEL_ID) return only('ห้องไอเดียยังไม่เปิดใช้ค่ะ');
    return reply({ type: 9, data: requestModal(cid.slice(7)) });
  }
  if (i.type === 5 && cid.startsWith('frnew:')) {
    if (!env.DISCORD_REQUEST_CHANNEL_ID) return only('ห้องไอเดียยังไม่เปิดใช้ค่ะ');
    const v = modalValues(i.data);
    if (!v.title) return only('ต้องมีชื่อเรื่องค่ะ');
    const r = await createRequest(env.DB, { author: who, author_id: userId, area: cid.slice(6), title: v.title, detail: v.detail ?? '' });
    const got = await loadRequest(env.DB, r.id);
    ctx.waitUntil(postRequest(env, r, got?.log ?? []).catch((e) => console.error('request post', e)));
    return only(`💡 รับไอเดีย **#${r.id} ${r.title}** แล้วค่ะ ขอบคุณนะคะ 🙏 น้องเปิดโพสต์ในห้องไอเดียให้แล้ว คุณเบ้นจะมากดให้ทำ/ไม่ทำค่ะ`);
  }
  const fr = /^fr:(go|no|done|pass|fail):(\d+)$/.exec(cid);
  const ff = /^frfail:(\d+)$/.exec(cid);
  if (!(i.type === 3 && fr) && !(i.type === 5 && ff)) return null;
  const verb = (fr ? fr[1] : 'fail') as Verb;
  const id = Number(fr ? fr[2] : ff![1]);
  const cur = await loadRequest(env.DB, id);
  if (!cur || cur.r.thread_id !== i.channel_id) return only('ไม่พบไอเดียนี้ในโพสต์นี้ค่ะ');
  if (!mayPress(env, verb, userId, cur.r.author_id)) return only(`ปุ่มนี้${verb === 'done' ? 'สำหรับคนทำ' : verb === 'pass' || verb === 'fail' ? `ให้คุณ${cur.r.author} (คนเสนอ) เป็นคนตรวจ` : 'ให้คุณเบ้นกด'}นะคะ 🙏 (Discord ID ของคุณ: ${userId})`);
  if (nextStatus(cur.r.status, verb) === null) return reply({ type: 7, data: requestMessage(cur.r, cur.log) });
  // "ไม่ผ่าน" asks what to fix first; the reason goes into the log and the post.
  if (verb === 'fail' && fr) return reply({ type: 9, data: failModal(id) });
  const note = ff ? modalValues(i.data).note || null : null;
  const moved = await moveRequest(env.DB, id, verb, who, note);
  if (!moved) { const now = await loadRequest(env.DB, id); return reply({ type: 7, data: requestMessage(now!.r, now!.log) }); }
  ctx.waitUntil(afterMove(env, moved.r, who, note).catch((e) => console.error('request after', e)));
  return reply({ type: 7, data: requestMessage(moved.r, moved.log) });
}
