// Benz Command Center (/command): one read-only summary for Benz's phone and one endpoint that takes the job
// metadata snapshot from his machine. Spec: docs/command-center/spec.md (§0 holds Benz's 15 Nov decisions).
// It sits in its own Cloudflare Access app (own aud), so index.ts hands /api/command* here before authenticate().
// The summary never calls Meta (few API calls on the app's tier) and every tile says where its number comes from;
// a tile with no source returns data = null, never 0.

import { devBypass, verifyAccess, type AuthEnv } from './auth.ts';
import { bkkDate } from './conversionStore.ts';
import { loadSettings } from './db.ts';
import { DEFAULT_GOAL, ytdStatus } from './goal.ts';
import { ytdRevenue } from './p365.ts';
import { BadRequest, json } from './validate.ts';

export interface CommandEnv extends AuthEnv {
  DB: D1Database;
  /** Application Audience tag of the "PkJeans Command" Access app (var) */
  COMMAND_ACCESS_AUD?: string;
  /** Benz's email (secret; comma separated allowed). Never in the repo. */
  COMMAND_ALLOWED_EMAIL?: string;
  /** Client IDs of the snapshot service token (secret, comma separated) */
  COMMAND_SERVICE_CLIENT_IDS?: string;
  /** Discord server id for links to proposal messages (var, optional) */
  DISCORD_GUILD_ID?: string;
  DISCORD_CHANNEL_ID?: string;
}

export type CommandIdentity = { kind: 'user'; email: string } | { kind: 'service'; client_id: string } | { kind: 'dev' };

export type TileStatus = 'ok' | 'stale' | 'missing' | 'not_connected' | 'error';
export interface Tile<T> {
  id: string;
  label: string;
  status: TileStatus;
  source: string;
  as_of: string | null;
  data: T | null;
  link?: string;
  note?: string;
}

export interface JobMeta { job_id: string; project: string | null; title: string | null; status: string; created: string | null; updated: string; from: string | null }
export interface TeamJobs {
  generated_at: string;
  total: number;
  counts: Record<string, number>;
  groups: { done_today: number; needs_user: number; needs_user_old: number; stuck: number; working: number; send_failed: number; cancelled: number; other: number };
  rows: JobMeta[];
}
export interface TodoItem { kind: 'p365_missing' | 'proposal' | 'job_needs_user'; ref: string; title: string; since: string | null; link: string }

export const FOCUS_CLUB_OPEN = '2026-12-01T00:00:00+07:00';
const RSS_URL = 'https://benzarnun.com/feed/';
const MAX_BODY = 262_144;
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const STALE_JOBS = 25 * MIN;
const RECENT = 7 * DAY;
const TODO_MAX = 25;
/** D2: the missing-Page365 line joins Benz's list only from 10:00 Bangkok, when Discord reminds the uploader. */
const P365_TODO_HOUR = 10;

export interface CommandOpts { now?: number; fetch?: typeof fetch }

// ---------- auth ----------

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Who is calling: Benz (email in the secret allowlist), the snapshot script (service token client id), or dev on localhost. */
export async function commandIdentity(req: Request, env: CommandEnv): Promise<CommandIdentity | null> {
  if (devBypass(req, env)) return { kind: 'dev' };
  if (!env.ACCESS_TEAM_DOMAIN || !env.COMMAND_ACCESS_AUD) return null;
  const claims = await verifyAccess(req, env, env.COMMAND_ACCESS_AUD).catch((err) => { console.error('command auth', err?.message ?? err); return null; });
  if (!claims) return null;
  if (claims.email) {
    const email = claims.email.trim().toLowerCase();
    return list(env.COMMAND_ALLOWED_EMAIL).includes(email) ? { kind: 'user', email } : null;
  }
  // A service token's JWT has no email: Access puts the token's Client ID in common_name and an empty sub.
  if (claims.sub === '' && claims.common_name && (claims.type === undefined || claims.type === 'app')
    && list(env.COMMAND_SERVICE_CLIENT_IDS).includes(claims.common_name.toLowerCase())) return { kind: 'service', client_id: claims.common_name };
  return null;
}

const ROUTES: Record<string, { method: string; who: CommandIdentity['kind'][] }> = {
  '/api/command/summary': { method: 'GET', who: ['user', 'dev'] },
  '/api/command/jobs': { method: 'POST', who: ['service', 'dev'] },
};

/** Everything under /api/command. Order: identity (401) → exact path (404) → method (405) → Origin (403) → who (403). */
export async function commandRoute(req: Request, env: CommandEnv, ctx: Pick<ExecutionContext, 'waitUntil'>, opts: CommandOpts = {}): Promise<Response> {
  const url = new URL(req.url);
  try {
    const who = await commandIdentity(req, env);
    if (!who) return json({ error: 'ต้องล็อกอินผ่าน Cloudflare Access (Command)' }, 401);
    const r = ROUTES[url.pathname];
    if (!r) return json({ error: 'not found' }, 404);
    if (req.method !== r.method) return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Allow: r.method } });
    if (req.method !== 'GET') {
      const origin = req.headers.get('Origin');
      if (origin && origin !== url.origin) return json({ error: 'cross-origin request refused' }, 403);
    }
    if (!r.who.includes(who.kind)) return json({ error: 'ตัวตนนี้ใช้ endpoint นี้ไม่ได้' }, 403);
    if (url.pathname === '/api/command/jobs') return await receiveJobs(req, env, opts.now ?? Date.now());
    return json(await buildSummary(env, ctx, who, opts));
  } catch (err: any) {
    if (err instanceof BadRequest) return json({ error: err.message }, 400);
    console.error('command', err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
}

// ---------- snapshot (POST /api/command/jobs) ----------

const TOP_KEYS = ['schema', 'source', 'generated_at', 'jobs'];
const JOB_KEYS = ['job_id', 'project', 'title', 'status', 'created', 'updated', 'from'];
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const POOL_MAX = 200;

/** "2026-11-15T09:04:00+0700" → ISO UTC, or null when it doesn't parse. */
export function toUtc(s: string): string | null {
  if (!TIME_RE.test(s)) return null;
  const t = Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Reads at most `max` bytes of the body; null when it is longer. */
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

export interface Snapshot { generated_at: string; jobs: JobMeta[] }

/** Checks a snapshot against the contract (spec §7.2): one wrong field = the whole thing refused, nothing written. */
export function validateSnapshot(body: unknown, now: number): { ok: true; snapshot: Snapshot } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const err = (m: string) => { if (errors.length < 20) errors.push(m); };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: ['body: ต้องเป็น object'] };
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!TOP_KEYS.includes(k)) err(`${k}: key ที่ไม่รู้จัก`);
  for (const k of TOP_KEYS) if (!(k in b)) err(`${k}: ต้องมี`);
  if (b.schema !== 1) err('schema: ต้องเป็น 1');
  if (b.source !== 'orca-pilot') err('source: ต้องเป็น orca-pilot');
  const gen = typeof b.generated_at === 'string' ? toUtc(b.generated_at) : null;
  if (!gen) err('generated_at: ต้องเป็นเวลา ISO ที่มี offset');
  else if (Date.parse(gen) > now + 10 * MIN) err('generated_at: ล้ำอนาคตเกิน 10 นาที');
  if (!Array.isArray(b.jobs)) err('jobs: ต้องเป็น array');
  else if (b.jobs.length > 1000) err('jobs: ได้ไม่เกิน 1000 รายการ');
  const jobs: JobMeta[] = [];
  if (Array.isArray(b.jobs) && b.jobs.length <= 1000) {
    const seen = new Set<string>();
    b.jobs.forEach((raw, i) => {
      const at = `jobs[${i}]`;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { err(`${at}: ต้องเป็น object`); return; }
      const j = raw as Record<string, unknown>;
      for (const k of Object.keys(j)) if (!JOB_KEYS.includes(k)) err(`${at}.${k}: key ที่ไม่อนุญาต (ส่งได้แค่ metadata)`);
      const id = j.job_id;
      if (typeof id !== 'string' || !/^job-\d{8}-\d{6}$/.test(id)) err(`${at}.job_id: ต้องเป็นรูป job-YYYYMMDD-HHMMSS`);
      else if (seen.has(id)) err(`${at}.job_id: ซ้ำ`);
      else seen.add(id);
      const project = j.project ?? null;
      if (project !== null && (typeof project !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(project))) err(`${at}.project: ตัวพิมพ์เล็ก a-z 0-9 . _ - ไม่เกิน 64`);
      let title = j.title ?? null;
      if (title !== null) {
        if (typeof title !== 'string') err(`${at}.title: ต้องเป็นข้อความหรือ null`);
        else {
          title = title.trim();
          if (!title || (title as string).length > 120) err(`${at}.title: ยาว 1–120 ตัวอักษร`);
          else if (CONTROL_RE.test(title as string)) err(`${at}.title: ห้ามมีอักขระควบคุมหรือขึ้นบรรทัดใหม่`);
        }
      }
      const status = j.status;
      if (typeof status !== 'string' || !/^[a-z][a-z-]{0,23}$/.test(status)) err(`${at}.status: ตัวพิมพ์เล็กและ - ไม่เกิน 24`);
      const updated = typeof j.updated === 'string' ? toUtc(j.updated) : null;
      if (!updated) err(`${at}.updated: ต้องเป็นเวลา ISO ที่มี offset`);
      const createdRaw = j.created ?? null;
      const created = createdRaw === null ? null : typeof createdRaw === 'string' ? toUtc(createdRaw) : null;
      if (createdRaw !== null && !created) err(`${at}.created: ต้องเป็นเวลา ISO ที่มี offset หรือ null`);
      const from = j.from ?? null;
      if (from !== null && (typeof from !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(from))) err(`${at}.from: a-z 0-9 _ - ไม่เกิน 32`);
      if (!errors.length) jobs.push({ job_id: id as string, project: project as string | null, title: title as string | null, status: status as string, created, updated: updated as string, from: from as string | null });
    });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, snapshot: { generated_at: gen as string, jobs } };
}

export interface JobsDigest { total: number; counts: Record<string, number>; pool: JobMeta[] }

/** What the summary needs from a snapshot (M7): raw counts, plus only the jobs that can ever show (spec §0 table B2). */
export function digestJobs(jobs: JobMeta[], receivedAt: number): JobsDigest {
  const counts: Record<string, number> = {};
  for (const j of jobs) counts[j.status] = (counts[j.status] ?? 0) + 1;
  const byNew = (a: JobMeta, b: JobMeta) => b.updated.localeCompare(a.updated);
  const needs = jobs.filter((j) => j.status === 'needs-user').sort(byNew).slice(0, POOL_MAX);
  const since = new Date(receivedAt - 8 * DAY).toISOString();
  const others = jobs.filter((j) => ['failed', 'sent', 'done'].includes(j.status) && j.updated >= since).sort(byNew).slice(0, POOL_MAX);
  return { total: jobs.length, counts, pool: [...needs, ...others] };
}

async function receiveJobs(req: Request, env: CommandEnv, now: number): Promise<Response> {
  const len = Number(req.headers.get('Content-Length'));
  if (Number.isFinite(len) && len > MAX_BODY) return json({ error: 'body ใหญ่เกิน 256 KB' }, 413);
  const text = await readCapped(req, MAX_BODY);
  if (text === null) return json({ error: 'body ใหญ่เกิน 256 KB' }, 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json({ error: 'JSON ไม่ถูกต้อง', errors: [] }, 400); }
  const v = validateSnapshot(body, now);
  if (!v.ok) return json({ error: 'snapshot ไม่ผ่านการตรวจ ไม่ได้บันทึก', errors: v.errors }, 400);
  const receivedAt = new Date(now).toISOString();
  // One atomic upsert (M2): refused only when it is more than 15 minutes older than what is stored, so a machine clock
  // that jumped back after sleep heals by itself while a real replay of an old snapshot still bounces.
  const r = await env.DB.prepare(
    `INSERT INTO command_sources (source, updated_at, generated_at, data, error) VALUES ('jobs', ?1, ?2, ?3, NULL)
     ON CONFLICT(source) DO UPDATE SET updated_at = excluded.updated_at, generated_at = excluded.generated_at, data = excluded.data, error = NULL
     WHERE command_sources.generated_at IS NULL OR excluded.generated_at >= strftime('%Y-%m-%dT%H:%M:%fZ', command_sources.generated_at, '-15 minutes')`,
  ).bind(receivedAt, v.snapshot.generated_at, JSON.stringify(digestJobs(v.snapshot.jobs, now))).run();
  if (!r.meta.changes) return json({ error: 'snapshot นี้เก่ากว่าที่เก็บไว้เกิน 15 นาที ไม่ได้บันทึก' }, 409);
  return json({ ok: true, stored: v.snapshot.jobs.length, received_at: receivedAt });
}

// ---------- summary (GET /api/command/summary) ----------

interface SourceRow { source: string; updated_at: string; generated_at: string | null; data: string; error: string | null }
interface YesterdayRow { date: string; uploaded_at: string; orders: number; revenue: number; units: number }

interface SummaryCtx {
  env: CommandEnv;
  now: number;
  generatedAt: string;
  today: string;
  yesterday: string;
  fetch: typeof fetch;
  waitUntil: (p: Promise<unknown>) => void;
  sources: Promise<Map<string, SourceRow>>;
  yesterdayRow: Promise<YesterdayRow | null>;
}

const thaiDate = (d: string) => new Date(`${d}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
const short = (e: unknown) => String((e as any)?.message ?? e).slice(0, 200);

function errorTile(id: string, label: string, source: string, e: unknown): Tile<never> {
  return { id, label, status: 'error', source, as_of: null, data: null, note: short(e) };
}
async function safe<T>(id: string, label: string, source: string, fn: () => Promise<Tile<T>>): Promise<Tile<T>> {
  try { return await fn(); } catch (e) { console.error('command tile', id, e); return errorTile(id, label, source, e); }
}

async function pkYesterday(c: SummaryCtx): Promise<Tile<{ date: string; revenue: number; orders: number; units: number; uploaded_at: string }>> {
  const base = { id: 'pk_sales_yesterday', label: 'PK ยอดขายเมื่อวาน', link: '/#sales' };
  const row = await c.yesterdayRow;
  if (!row) return { ...base, status: 'missing', source: `ยังไม่มีไฟล์ Page365 ของ ${thaiDate(c.yesterday)} (ไม่ใช้ยอด Meta แทน)`, as_of: c.generatedAt, data: null };
  return {
    ...base, status: 'ok', source: 'ไฟล์ Page365 ที่อัปโหลด (p365_orders) ไม่ใช้ยอด Meta', as_of: row.uploaded_at,
    data: { date: row.date, revenue: Number(row.revenue), orders: Number(row.orders), units: Number(row.units), uploaded_at: row.uploaded_at },
  };
}

export interface PkYtd {
  year: string; from: string; to: string; target: number; revenue: number; pct: number; pace: number; pace_uploaded: number; gap: number;
  uploaded_days: number; days_elapsed: number; days_in_year: number; projected: number | null; needed_per_day: number;
}

async function pkYtd(c: SummaryCtx): Promise<Tile<PkYtd>> {
  const base = { id: 'pk_ytd', label: 'PK สะสมปีเทียบเป้า', link: '/' };
  const to = c.yesterday, from = `${to.slice(0, 4)}-01-01`;
  const [settings, sources, sigRow] = await Promise.all([
    loadSettings(c.env.DB),
    c.sources,
    c.env.DB.prepare('SELECT COUNT(*) AS n, MAX(uploaded_at) AS last FROM p365_uploads WHERE date >= ?1 AND date <= ?2').bind(from, to).first<{ n: number; last: string | null }>(),
  ]);
  const target = settings.goal.yearly_sales ?? DEFAULT_GOAL.yearly_sales;
  const n = Number(sigRow?.n ?? 0), last = sigRow?.last ?? null;
  // Cached by "upload signature" so a reload doesn't join every order of the year again (D1 free-plan rows read).
  const sig = `${to}|${n}|${last}|${target}`;
  let ytd: PkYtd | null = null;
  const cached = sources.get('ytd');
  if (cached) {
    try { const d = JSON.parse(cached.data); if (d.sig === sig) ytd = d.ytd; } catch { /* rebuilt below */ }
  }
  if (!ytd) {
    const s = ytdStatus(target, to, await ytdRevenue(c.env.DB, to));
    ytd = { year: s.year, from: s.from, to: s.to, target: s.target, revenue: s.revenue, pct: s.pct, pace: s.pace, pace_uploaded: s.pace_uploaded, gap: s.gap,
      uploaded_days: s.uploaded_days, days_elapsed: s.days_elapsed, days_in_year: s.days_in_year, projected: s.projected, needed_per_day: s.needed_per_day };
    await c.env.DB.prepare(
      `INSERT INTO command_sources (source, updated_at, generated_at, data, error) VALUES ('ytd', ?1, NULL, ?2, NULL)
       ON CONFLICT(source) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data, error = NULL`,
    ).bind(c.generatedAt, JSON.stringify({ sig, ytd })).run().catch((e) => console.error('command ytd cache', e));
  }
  const label = `PK สะสมปี ${ytd.year} เทียบเป้า`;
  if (!ytd.uploaded_days) return { ...base, label, status: 'missing', source: `ยังไม่มีไฟล์ Page365 ปี ${ytd.year}`, as_of: c.generatedAt, data: null };
  return { ...base, label, status: 'ok', source: `Page365 1 ม.ค.–เมื่อวาน นับเฉพาะวันที่มีไฟล์ (${ytd.uploaded_days}/${ytd.days_elapsed} วัน)`, as_of: last, data: ytd };
}

export function countdown(now: number): { target_at: string; days_left: number; seconds_left: number; passed: boolean } {
  const today = bkkDate(0, now);
  const days_left = Math.max(0, Math.round((Date.parse('2026-12-01') - Date.parse(today)) / DAY));
  const seconds_left = Math.max(0, Math.floor((Date.parse(FOCUS_CLUB_OPEN) - now) / 1000));
  return { target_at: FOCUS_CLUB_OPEN, days_left, seconds_left, passed: seconds_left === 0 };
}

const notConnected = (id: string, label: string, source: string): Tile<never> => ({ id, label, status: 'not_connected', source, as_of: null, data: null });

// Future sources: replace one function, keep id and position (spec §6.7).
const BUSINESS_TILES: ((c: SummaryCtx) => Promise<Tile<unknown>>)[] = [
  (c) => safe('pk_sales_yesterday', 'PK ยอดขายเมื่อวาน', 'ไฟล์ Page365 ที่อัปโหลด', () => pkYesterday(c)),
  (c) => safe('pk_ytd', 'PK สะสมปีเทียบเป้า', 'Page365 1 ม.ค.–เมื่อวาน', () => pkYtd(c)),
  async () => notConnected('focus_club_members', 'Focus Club สมาชิก', 'ยังไม่เชื่อม: รอ Google Sheet จาก FOCUS CLUB BOT'),
  async (c) => ({ id: 'focus_club_countdown', label: 'Focus Club เปิด 1 ธ.ค.', status: 'ok', source: 'คำนวณจากวันเปิด 2026-12-01 00:00 เวลาไทย', as_of: c.generatedAt, data: countdown(c.now) }),
  async () => notConnected('classroom_students', 'ClassRoom นักเรียน', 'ยังไม่เชื่อม: ยังไม่มีแหล่งข้อมูลจริง (opb-classroom มีแค่ข้อมูลจำลอง)'),
  (c) => safe('blog_latest', 'benzarnun.com บทความล่าสุด', 'RSS benzarnun.com/feed/', () => blogTile(c)),
];

// ---------- RSS ----------

export interface Post { title: string; url: string; published_at: string }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos' || k === '#39') return "'";
    const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

function field(item: string, tag: string): string | null {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(item);
  if (!m) return null;
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(m[1]);
  return (cdata ? cdata[1] : decodeEntities(m[1])).trim();
}

/** Only https://benzarnun.com/… links (hostname compared after parsing, so benzarnun.com.evil or user@host don't pass). */
export function blogUrl(raw: string | null): string | null {
  if (!raw || !raw.startsWith('https://benzarnun.com/')) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname === 'benzarnun.com' && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}

export function parseRss(xml: string, max = 3): Post[] {
  const out: Post[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = field(m[1], 'title');
    const url = blogUrl(field(m[1], 'link'));
    const t = Date.parse(field(m[1], 'pubDate') ?? '');
    if (!title || !url || !Number.isFinite(t)) continue;
    out.push({ title: title.slice(0, 300), url, published_at: new Date(t).toISOString() });
    if (out.length >= max) break;
  }
  return out;
}

/** Fetches the feed but stops reading after the 3rd </item> or 256 KB (the full feed is ~170 KB of article bodies). */
export async function fetchFeed(fetcher: typeof fetch): Promise<Post[]> {
  const res = await fetcher(RSS_URL, { headers: { 'User-Agent': 'pkjeans-command/1', Accept: 'application/rss+xml, application/xml' }, signal: AbortSignal.timeout(4000) });
  if (!res.ok || !res.body) throw new Error(`RSS: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = '', bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    text += dec.decode(value, { stream: true });
    if ((text.match(/<\/item>/gi)?.length ?? 0) >= 3 || bytes > MAX_BODY) { await reader.cancel().catch(() => {}); break; }
  }
  if (!/<(rss|channel)\b/i.test(text)) throw new Error('RSS: คำตอบไม่ใช่ feed');
  return parseRss(text);
}

async function refreshRss(c: SummaryCtx): Promise<{ posts: Post[]; at: string }> {
  const at = new Date(c.now).toISOString();
  try {
    const posts = await fetchFeed(c.fetch);
    await c.env.DB.prepare(
      `INSERT INTO command_sources (source, updated_at, generated_at, data, error) VALUES ('rss', ?1, ?1, ?2, NULL)
       ON CONFLICT(source) DO UPDATE SET updated_at = excluded.updated_at, generated_at = excluded.generated_at, data = excluded.data, error = NULL`,
    ).bind(at, JSON.stringify({ posts })).run();
    return { posts, at };
  } catch (e) {
    // Keep the old posts; remember the failure and when we tried, so the next try waits an hour.
    await c.env.DB.prepare("UPDATE command_sources SET error = ?1, generated_at = ?2 WHERE source = 'rss'").bind(short(e), at).run().catch(() => {});
    throw e;
  }
}

async function blogTile(c: SummaryCtx): Promise<Tile<{ posts: Post[] }>> {
  const base = { id: 'blog_latest', label: 'benzarnun.com บทความล่าสุด', link: 'https://benzarnun.com/', source: 'RSS benzarnun.com/feed/ (cache 1 ชม.)' };
  const row = (await c.sources).get('rss');
  if (!row) {
    try {
      const r = await refreshRss(c);
      return { ...base, status: 'ok', as_of: r.at, data: { posts: r.posts } };
    } catch (e) {
      return { ...base, status: 'error', as_of: null, data: null, note: short(e) };
    }
  }
  const age = c.now - Date.parse(row.updated_at);
  const lastTry = Math.max(Date.parse(row.updated_at), Date.parse(row.generated_at ?? row.updated_at) || 0);
  if (c.now - lastTry > HOUR) c.waitUntil(refreshRss(c).catch((e) => console.error('command rss', short(e))));
  const data = JSON.parse(row.data) as { posts: Post[] };
  return { ...base, status: age <= DAY ? 'ok' : 'stale', as_of: row.updated_at, data: { posts: data.posts ?? [] }, ...(row.error ? { note: row.error } : {}) };
}

// ---------- team + todo ----------

/** Groups and rows of the team box from a stored digest (spec §0 table B2). */
export function teamFromDigest(d: JobsDigest, generatedAt: string, now: number): TeamJobs {
  const today = bkkDate(0, now);
  const recent = (j: JobMeta) => now - Date.parse(j.updated) <= RECENT;
  const needs = d.pool.filter((j) => j.status === 'needs-user');
  const needsRecent = needs.filter(recent);
  const known = ['needs-user', 'failed', 'sent', 'done', 'send-failed', 'cancelled'];
  const other = Object.entries(d.counts).filter(([k]) => !known.includes(k)).reduce((t, [, v]) => t + v, 0);
  const rest = d.pool.filter((j) => j.status !== 'needs-user' && recent(j)).slice(0, 5);
  return {
    generated_at: generatedAt,
    total: d.total,
    counts: d.counts,
    groups: {
      done_today: d.pool.filter((j) => j.status === 'done' && bkkDate(0, Date.parse(j.updated)) === today).length,
      needs_user: needsRecent.length,
      needs_user_old: (d.counts['needs-user'] ?? 0) - needsRecent.length,
      stuck: d.pool.filter((j) => j.status === 'failed' && recent(j)).length,
      working: d.counts.sent ?? 0,
      send_failed: d.counts['send-failed'] ?? 0,
      cancelled: d.counts.cancelled ?? 0,
      other,
    },
    rows: [...needsRecent.slice(0, 20), ...rest],
  };
}

async function teamTile(c: SummaryCtx): Promise<Tile<TeamJobs>> {
  const base = { id: 'team_jobs', label: 'งานทีม', link: '/command#team' };
  const row = (await c.sources).get('jobs');
  if (!row) return { ...base, status: 'not_connected', source: 'ยังไม่เชื่อม: รอสคริปต์ส่ง snapshot จากเครื่องเบ๊น', as_of: null, data: null };
  const data = teamFromDigest(JSON.parse(row.data) as JobsDigest, row.generated_at ?? row.updated_at, c.now);
  const stale = c.now - Date.parse(row.updated_at) > STALE_JOBS;
  return { ...base, status: stale ? 'stale' : 'ok', source: 'snapshot metadata จากเครื่องเบ๊น (orca-pilot jobs) ส่งทุก 10 นาที', as_of: row.updated_at, data };
}

const PROPOSAL_KIND: Record<string, string> = { pause: 'หยุดแคมเปญ', move: 'ย้ายสเตจ', cap: 'ขยายเพดานงบ', dup: 'คัดลอกแคมเปญ' };
export const jobTitle = (j: Pick<JobMeta, 'title' | 'project'>) => j.title ?? `งาน ${j.project ?? 'ไม่ระบุโปรเจกต์'}`;

async function todoBox(c: SummaryCtx, team: Tile<TeamJobs>) {
  const items: TodoItem[] = [];
  let p365: 'ok' | 'error' = 'ok', proposals: 'ok' | 'error' = 'ok';
  const hour = Number(new Date(c.now + 7 * HOUR).toISOString().slice(11, 13));
  try {
    if (!(await c.yesterdayRow) && hour >= P365_TODO_HOUR) {
      items.push({ kind: 'p365_missing', ref: c.yesterday, title: `ยังไม่มีไฟล์ Page365 ของ ${thaiDate(c.yesterday)}`, since: `${c.yesterday}T17:00:00.000Z`, link: '/#sales' });
    }
  } catch (e) { console.error('command todo p365', e); p365 = 'error'; }
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT id, created_at, kind, entity_name, message_id FROM proposals WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100",
    ).all<{ id: string; created_at: string; kind: string; entity_name: string; message_id: string | null }>();
    const guild = c.env.DISCORD_GUILD_ID?.trim(), channel = c.env.DISCORD_CHANNEL_ID?.trim();
    for (const p of results) {
      items.push({
        kind: 'proposal', ref: p.id, title: `${PROPOSAL_KIND[p.kind] ?? 'ข้อเสนอ'}: ${p.entity_name}`, since: p.created_at,
        link: guild && channel && p.message_id ? `https://discord.com/channels/${guild}/${channel}/${p.message_id}` : '/#history',
      });
    }
  } catch (e) { console.error('command todo proposals', e); proposals = 'error'; }
  if (team.data) {
    for (const j of team.data.rows.filter((r) => r.status === 'needs-user')) {
      items.push({ kind: 'job_needs_user', ref: j.job_id, title: `ตัดสิน: ${jobTitle(j)}`, since: j.updated, link: `/command#job-${j.job_id}` });
    }
  }
  return {
    source: 'job needs-user ≤ 7 วันจาก snapshot · ข้อเสนอที่ยังเปิดใน D1 proposals · ไฟล์ Page365 เมื่อวาน (ขึ้นหลัง 10:00)',
    as_of: c.generatedAt,
    parts: { jobs: team.status, proposals, p365 },
    items: items.slice(0, TODO_MAX),
    more: Math.max(0, items.length - TODO_MAX),
    older_needs_user: team.data ? team.data.groups.needs_user_old : null,
  };
}

export async function buildSummary(env: CommandEnv, ctx: Pick<ExecutionContext, 'waitUntil'>, who: CommandIdentity, opts: CommandOpts = {}) {
  const now = opts.now ?? Date.now();
  const generatedAt = new Date(now).toISOString();
  const yesterday = bkkDate(1, now);
  const sources = env.DB.prepare("SELECT source, updated_at, generated_at, data, error FROM command_sources WHERE source IN ('jobs', 'rss', 'ytd')")
    .all<SourceRow>().then(({ results }) => new Map(results.map((r) => [r.source, r])));
  const yesterdayRow = env.DB.prepare(
    `SELECT u.date AS date, u.uploaded_at AS uploaded_at, COUNT(o.order_no) AS orders, COALESCE(SUM(o.total), 0) AS revenue, COALESCE(SUM(o.units), 0) AS units
     FROM p365_uploads u LEFT JOIN p365_orders o ON o.date = u.date WHERE u.date = ?1 GROUP BY u.date`,
  ).bind(yesterday).first<YesterdayRow>();
  // Unhandled rejections are read through the tiles; keep Node/workerd from flagging them early.
  sources.catch(() => {}); yesterdayRow.catch(() => {});
  const c: SummaryCtx = { env, now, generatedAt, today: bkkDate(0, now), yesterday, fetch: opts.fetch ?? fetch, waitUntil: (p) => ctx.waitUntil(p), sources, yesterdayRow };
  const [tiles, team] = await Promise.all([
    Promise.all(BUSINESS_TILES.map((t) => t(c))),
    safe('team_jobs', 'งานทีม', 'snapshot งานทีมจากเครื่องเบ๊น', () => teamTile(c)),
  ]);
  return {
    version: 1 as const,
    generated_at: generatedAt,
    timezone: 'Asia/Bangkok' as const,
    today: c.today,
    business: { source: 'แต่ละช่องบอกแหล่งของตัวเอง', as_of: generatedAt, tiles },
    team,
    todo: await todoBox(c, team),
    ...(who.kind === 'dev' ? { local_dev: true as const } : {}),
  };
}
