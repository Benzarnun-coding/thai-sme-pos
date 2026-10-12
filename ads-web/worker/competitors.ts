// Competitor watch: pages, their ads worth studying, and checks of how many ads they run. All typed in by
// the team from the public Ad Library (Meta's API does not serve Thai commercial ads); analysis happens in the UI.

import { BadRequest } from './validate.ts';

export interface Competitor { id: string; name: string; page_url: string; page_id: string; notes: string; created_at: string }
export interface CompetitorAd {
  id: string; competitor_id: string; library_url: string; started_at: string | null; last_seen: string | null;
  status: 'active' | 'stopped'; format: '' | 'video' | 'image' | 'carousel'; promo: string; hook: string; notes: string;
  section_id: string | null; created_at: string;
}
export interface CompetitorCheck { id: number; competitor_id: string; checked_at: string; active_ads: number; note: string }

const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function text(v: unknown, what: string, max: number, required = false): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new BadRequest(`${what}: ห้ามว่าง`);
  if (s.length > max) throw new BadRequest(`${what}: ยาวเกิน ${max} ตัวอักษร`);
  return s;
}

/** Links are rendered as <a href>, so only http(s) is accepted. */
function url(v: unknown, what: string): string {
  const s = text(v, what, 500);
  if (s && !/^https?:\/\//i.test(s)) throw new BadRequest(`${what}: ต้องขึ้นต้นด้วย https://`);
  return s;
}

function date(v: unknown, what: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new BadRequest(`${what}: วันที่ไม่ถูกต้อง`);
  return v;
}

/** Page id from a profile.php?id= link, or a bare number. */
function pageIdFrom(pageUrl: string, given: unknown): string {
  const g = text(given, 'Page ID', 40);
  if (g) {
    if (!/^\d{5,25}$/.test(g)) throw new BadRequest('Page ID ต้องเป็นตัวเลข');
    return g;
  }
  return pageUrl.match(/[?&]id=(\d{5,25})/)?.[1] ?? pageUrl.match(/view_all_page_id=(\d{5,25})/)?.[1] ?? '';
}

export async function listCompetitors(db: D1Database) {
  const [c, a, k] = await db.batch([
    db.prepare('SELECT * FROM competitors ORDER BY name'),
    db.prepare('SELECT * FROM competitor_ads ORDER BY created_at DESC'),
    db.prepare('SELECT * FROM competitor_checks ORDER BY checked_at DESC LIMIT 500'),
  ]);
  return { competitors: c.results as unknown as Competitor[], ads: a.results as unknown as CompetitorAd[], checks: k.results as unknown as CompetitorCheck[] };
}

export async function saveCompetitor(db: D1Database, input: any): Promise<Competitor> {
  const page_url = url(input?.page_url, 'ลิงก์เพจ');
  const c: Competitor = {
    id: typeof input?.id === 'string' && input.id ? input.id : newId('c'),
    name: text(input?.name, 'ชื่อเพจ', 120, true),
    page_url,
    page_id: pageIdFrom(page_url, input?.page_id),
    notes: text(input?.notes, 'หมายเหตุ', 1000),
    created_at: new Date().toISOString(),
  };
  await db.prepare(
    `INSERT INTO competitors (id, name, page_url, page_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, page_url = excluded.page_url, page_id = excluded.page_id, notes = excluded.notes`,
  ).bind(c.id, c.name, c.page_url, c.page_id, c.notes, c.created_at).run();
  return c;
}

export async function deleteCompetitor(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM competitor_ads WHERE competitor_id = ?').bind(id),
    db.prepare('DELETE FROM competitor_checks WHERE competitor_id = ?').bind(id),
    db.prepare('DELETE FROM competitors WHERE id = ?').bind(id),
  ]);
}

const FORMATS = ['', 'video', 'image', 'carousel'];

export async function saveCompetitorAd(db: D1Database, input: any): Promise<CompetitorAd> {
  const competitor_id = text(input?.competitor_id, 'คู่แข่ง', 60, true);
  if (!(await db.prepare('SELECT 1 FROM competitors WHERE id = ?').bind(competitor_id).first())) throw new BadRequest('ไม่พบคู่แข่ง');
  const format = typeof input?.format === 'string' && FORMATS.includes(input.format) ? input.format : '';
  const status = input?.status === 'stopped' ? 'stopped' : 'active';
  const a: CompetitorAd = {
    id: typeof input?.id === 'string' && input.id ? input.id : newId('a'),
    competitor_id,
    library_url: url(input?.library_url, 'ลิงก์แอด'),
    started_at: date(input?.started_at, 'วันที่เริ่มวิ่ง'),
    last_seen: date(input?.last_seen, 'เห็นล่าสุด') ?? new Date().toISOString().slice(0, 10),
    status, format,
    promo: text(input?.promo, 'โปร/ราคา', 200),
    hook: text(input?.hook, 'ประโยคเปิด', 500),
    notes: text(input?.notes, 'หมายเหตุ', 1000),
    section_id: typeof input?.section_id === 'string' && input.section_id ? input.section_id : null,
    created_at: new Date().toISOString(),
  };
  if (!a.promo && !a.hook && !a.library_url) throw new BadRequest('ใส่อย่างน้อย ลิงก์แอด โปร หรือประโยคเปิด');
  await db.prepare(
    `INSERT INTO competitor_ads (id, competitor_id, library_url, started_at, last_seen, status, format, promo, hook, notes, section_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET competitor_id = excluded.competitor_id, library_url = excluded.library_url, started_at = excluded.started_at,
       last_seen = excluded.last_seen, status = excluded.status, format = excluded.format, promo = excluded.promo, hook = excluded.hook,
       notes = excluded.notes, section_id = excluded.section_id`,
  ).bind(a.id, a.competitor_id, a.library_url, a.started_at, a.last_seen, a.status, a.format, a.promo, a.hook, a.notes, a.section_id, a.created_at).run();
  return a;
}

export async function deleteCompetitorAd(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM competitor_ads WHERE id = ?').bind(id).run();
}

export async function addCompetitorCheck(db: D1Database, competitorId: string, input: any): Promise<void> {
  const n = Number(input?.active_ads);
  if (!Number.isInteger(n) || n < 0 || n > 10000) throw new BadRequest('จำนวนแอดต้องเป็นจำนวนเต็ม 0 ขึ้นไป');
  if (!(await db.prepare('SELECT 1 FROM competitors WHERE id = ?').bind(competitorId).first())) throw new BadRequest('ไม่พบคู่แข่ง');
  await db.prepare('INSERT INTO competitor_checks (competitor_id, checked_at, active_ads, note) VALUES (?, ?, ?, ?)')
    .bind(competitorId, new Date().toISOString(), n, text(input?.note, 'หมายเหตุ', 300)).run();
}
