// Product catalog (/catalog page). The browser does the heavy work to stay inside the free plan's 10 ms CPU:
// it pulls each tab's CSV through `sheetCsv` (a pass-through, no parsing here), parses it, compares it with what is
// stored and sends only the changed rows to `applySync`. Rows go back out in pages of arrays that the browser
// caches by `catalog_version`, so opening the page again reads nothing from D1 until the next sync.
// Row cleaning is shared with the page (web/src/catalog.ts) so both sides agree on what a SKU is.

import { cleanSku, cleanText, normaliseRow, parseNumber, rowFromArray, ROW_FIELDS, skuKey, type CatalogRow, type WebSku } from '../web/src/catalog.ts';
import { BadRequest } from './validate.ts';

export interface SheetTab { tab: string; gid: string }
export interface CatalogTab { tab: string; gid: string; sort: number; skus: number; synced_at: string; synced_by: string }

const FETCH_TIMEOUT_MS = 25_000;
/** Tabs in the sheet that look like warehouses but are not. */
const NOT_WAREHOUSES = new Set(['AI', 'EX1', 'DB_ALL']);
export const PAGE_LIMIT = 2500;
const MAX_SYNC_ROWS = 2000;
const STATEMENT_ROWS = 500;
const MAX_WEB_CREATE = 60;

// ---- Google Sheet ----

/** Tab names and gids from the sheet's public HTML view (the CSV export needs the gid). */
export async function discoverTabs(sheetId: string, extra: string[] = []): Promise<SheetTab[]> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/htmlview`, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new BadRequest(`อ่านรายชื่อแท็บไม่ได้ (HTTP ${res.status}) — ชีตต้องแชร์แบบ "ทุกคนที่มีลิงก์ดูได้"`);
  return parseHtmlviewTabs(await res.text(), extra);
}

export function parseHtmlviewTabs(html: string, extra: string[] = []): SheetTab[] {
  const out: SheetTab[] = [];
  for (const m of html.matchAll(/\{name: "((?:[^"\\]|\\.)*)", pageUrl: "[^"]*?gid=(\d+)/g)) {
    let name = m[1];
    try { name = JSON.parse(`"${m[1]}"`); } catch { /* keep as is */ }
    const warehouse = /^[A-Z][A-Z0-9_]{1,5}$/.test(name) && !NOT_WAREHOUSES.has(name);
    if ((warehouse || extra.includes(name)) && !out.some((t) => t.tab === name)) out.push({ tab: name, gid: m[2] });
  }
  return out;
}

/** One tab as CSV, streamed straight through (raw cell values, unlike gviz which blanks cells of a "minority" type). */
export async function sheetCsv(sheetId: string, gid: string): Promise<Response> {
  if (!/^\d{1,12}$/.test(gid)) throw new BadRequest('gid ไม่ถูกต้อง');
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${gid}`, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('csv')) {
    throw new BadRequest(`อ่านแท็บไม่ได้ (HTTP ${res.status}) — ชีตต้องแชร์แบบ "ทุกคนที่มีลิงก์ดูได้"`);
  }
  return new Response(res.body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// ---- which sheet ----
// The catalog has its own sheet setting so it can be switched on without `sheet_id`, which also feeds the 07:30
// cost sync and with it the live budget rules. Falls back to `sheet_id` when that is set.

export async function catalogSheetId(db: D1Database, fallback = ''): Promise<string> {
  return (await db.prepare("SELECT value FROM settings WHERE key = 'catalog_sheet_id'").first<string>('value')) || fallback;
}

/** A pasted Google Sheets link or a bare id → the id. */
export function parseSheetId(input: unknown): string {
  const t = String(input ?? '').trim();
  const id = t.match(/\/spreadsheets\/d\/([\w-]{20,})/)?.[1] ?? (/^[\w-]{20,}$/.test(t) ? t : '');
  if (!id) throw new BadRequest('วางลิงก์ Google Sheet (docs.google.com/spreadsheets/d/…) หรือ Sheet ID');
  return id;
}

export async function saveCatalogSheetId(db: D1Database, id: string): Promise<void> {
  await db.prepare("INSERT INTO settings (key, value) VALUES ('catalog_sheet_id', ?1) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(id).run();
}

// ---- reading ----

export async function catalogVersion(db: D1Database): Promise<string> {
  return (await db.prepare("SELECT value FROM settings WHERE key = 'catalog_version'").first<string>('value')) ?? '';
}

export async function catalogMeta(db: D1Database, fallbackSheet = ''): Promise<{ version: string; tabs: CatalogTab[]; web: WebSku[]; images: CatalogImage[]; suppliers: CatalogSupplier[]; prices: CatalogPrice[]; sheet_configured: boolean }> {
  const [version, tabs, web, sheet, images, suppliers, prices] = await Promise.all([
    catalogVersion(db),
    db.prepare('SELECT tab, gid, sort, skus, synced_at, synced_by FROM catalog_tabs ORDER BY sort, tab').all<CatalogTab>(),
    db.prepare('SELECT * FROM catalog_web ORDER BY created_at DESC').all<WebSku>(),
    catalogSheetId(db, fallbackSheet),
    listImages(db),
    listSuppliers(db),
    listPrices(db),
  ]);
  return { version, tabs: tabs.results, web: web.results, images, suppliers, prices, sheet_configured: !!sheet };
}

/** A page of one tab's rows as arrays in ROW_FIELDS order; `next` is the SKU to continue after. */
export async function catalogRows(db: D1Database, tab: string, after: string, limit = PAGE_LIMIT): Promise<{ rows: unknown[][]; next: string | null }> {
  const n = Math.min(Math.max(1, Math.trunc(limit)), PAGE_LIMIT);
  const rows = await db.prepare(`SELECT ${ROW_FIELDS.join(', ')} FROM catalog WHERE tab = ?1 AND sku > ?2 ORDER BY sku LIMIT ?3`).bind(tab, after, n).raw();
  return { rows, next: rows.length === n ? String(rows[rows.length - 1][1]) : null };
}

// ---- writing a sync ----

export interface SyncInput { tab: string; gid: string; sort: number; rows: CatalogRow[]; remove: string[]; done: { skus: number } | null }

export function validateSync(input: any): SyncInput {
  const tab = cleanText(input?.tab, 40);
  if (!tab) throw new BadRequest('ไม่มีชื่อแท็บ');
  const gid = String(input?.gid ?? '');
  if (!/^\d{1,12}$/.test(gid)) throw new BadRequest('gid ไม่ถูกต้อง');
  const rawRows: unknown[] = Array.isArray(input?.rows) ? input.rows : [];
  const remove: unknown[] = Array.isArray(input?.remove) ? input.remove : [];
  if (rawRows.length > MAX_SYNC_ROWS) throw new BadRequest(`ส่งได้ครั้งละไม่เกิน ${MAX_SYNC_ROWS} แถว`);
  if (remove.length > 50_000) throw new BadRequest('รายการลบมากเกินไป');
  const rows = rawRows.map((a) => {
    if (!Array.isArray(a)) throw new BadRequest('รูปแบบแถวไม่ถูกต้อง');
    let r: CatalogRow;
    try { r = normaliseRow(rowFromArray(a) as unknown as Record<string, unknown>); } catch (e: any) { throw new BadRequest(e.message); }
    if (r.tab !== tab) throw new BadRequest(`แถว ${r.sku} ไม่ได้อยู่แท็บ ${tab}`);
    return r;
  });
  const done = input?.done ? { skus: Math.max(0, Math.trunc(parseNumber(input.done.skus) ?? 0)) } : null;
  return { tab, gid, sort: Math.trunc(parseNumber(input?.sort) ?? 0), rows, remove: remove.map(cleanSku).filter(Boolean), done };
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const UPSERT = `INSERT INTO catalog (${ROW_FIELDS.join(', ')})
  SELECT ${ROW_FIELDS.map((f) => `value ->> '$.${f}'`).join(', ')} FROM json_each(?1) WHERE true
  ON CONFLICT (tab, sku) DO UPDATE SET ${ROW_FIELDS.filter((f) => f !== 'tab' && f !== 'sku').map((f) => `${f} = excluded.${f}`).join(', ')}`;

/** Changed rows in, vanished SKUs out, in one transaction; the final call records the tab and bumps the version. */
export async function applySync(db: D1Database, s: SyncInput, user: string): Promise<{ written: number; removed: number }> {
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    ...chunks(s.rows, STATEMENT_ROWS).map((part) => db.prepare(UPSERT).bind(JSON.stringify(part))),
    ...chunks(s.remove, 1000).map((part) => db.prepare('DELETE FROM catalog WHERE tab = ?1 AND sku IN (SELECT value FROM json_each(?2))').bind(s.tab, JSON.stringify(part))),
  ];
  if (s.done) {
    statements.push(db.prepare(
      `INSERT INTO catalog_tabs (tab, gid, sort, skus, synced_at, synced_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (tab) DO UPDATE SET gid = excluded.gid, sort = excluded.sort, skus = excluded.skus, synced_at = excluded.synced_at, synced_by = excluded.synced_by`,
    ).bind(s.tab, s.gid, s.sort, s.done.skus, now, user));
  }
  // Changed rows invalidate the pages browsers have cached; a sync that changed nothing keeps them.
  if (s.rows.length || s.remove.length) {
    statements.push(db.prepare("INSERT INTO settings (key, value) VALUES ('catalog_version', ?1) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(now));
  }
  if (statements.length) await db.batch(statements);
  return { written: s.rows.length, removed: s.remove.length };
}

// ---- SKUs added on the website ----

const SKU_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._/]*(-[A-Za-z0-9._/]+){2,}$/;

export function validateWebSku(input: any, tabs: string[]): Omit<WebSku, 'created_by' | 'created_at' | 'updated_at'> {
  const sku = cleanSku(input?.sku).toUpperCase();
  if (!SKU_SHAPE.test(sku) || sku.length > 64) throw new BadRequest(`SKU "${sku || '(ว่าง)'}" ไม่ตรงรูปแบบ [รหัส]-[โกดัง]-[สี]-[ขนาด]`);
  const tab = cleanText(input?.tab, 40);
  if (!tabs.includes(tab)) throw new BadRequest(`ไม่รู้จักโกดัง "${tab}" — ดึงชีตก่อน หรือเลือกจากรายการ`);
  const image = String(input?.image ?? '').trim();
  if (image && (!/^https:\/\/[^\s"'<>]+$/i.test(image) || image.length > 2000)) throw new BadRequest('ลิงก์รูปต้องขึ้นต้นด้วย https://');
  const cost = parseNumber(input?.cost), price = parseNumber(input?.price);
  if ((cost !== null && cost < 0) || (price !== null && price < 0)) throw new BadRequest('ทุน/ราคาต้องไม่ติดลบ');
  return {
    sku, tab, image, cost, price,
    code: cleanText(input?.code, 80),
    name: cleanText(input?.name),
    color: cleanText(input?.color, 40).toUpperCase(),
    size: cleanText(input?.size, 40).toUpperCase(),
    shop: cleanText(input?.shop, 80),
    alias: cleanText(input?.alias, 120),
    note: cleanText(input?.note),
  };
}

async function tabNames(db: D1Database): Promise<string[]> {
  return (await db.prepare('SELECT tab FROM catalog_tabs').all<{ tab: string }>()).results.map((r) => r.tab);
}

/** Several sizes at once. Refuses SKUs already in the sheet copy (same tab) or already added here. */
export async function createWebSkus(db: D1Database, input: any, user: string): Promise<WebSku[]> {
  const list: unknown[] = Array.isArray(input?.items) ? input.items : [];
  if (!list.length) throw new BadRequest('ไม่มี SKU ที่จะเพิ่ม');
  if (list.length > MAX_WEB_CREATE) throw new BadRequest(`เพิ่มได้ครั้งละไม่เกิน ${MAX_WEB_CREATE} SKU`);
  const tabs = await tabNames(db);
  const items = list.map((x) => validateWebSku(x, tabs));
  const keys = items.map((i) => skuKey(i.sku));
  if (new Set(keys).size !== keys.length) throw new BadRequest('มี SKU ซ้ำกันในรายการ');
  const [web, sheet] = await Promise.all([
    db.prepare('SELECT sku FROM catalog_web WHERE upper(sku) IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(keys)).all<{ sku: string }>(),
    db.prepare("SELECT c.sku FROM catalog c JOIN json_each(?1) j ON c.tab = j.value ->> '$.tab' AND c.sku = j.value ->> '$.sku'")
      .bind(JSON.stringify(items.map((i) => ({ tab: i.tab, sku: i.sku })))).all<{ sku: string }>(),
  ]);
  const taken = [...web.results, ...sheet.results].map((r) => r.sku);
  if (taken.length) throw new BadRequest(`มี SKU นี้อยู่แล้ว: ${taken.slice(0, 5).join(', ')}${taken.length > 5 ? ' …' : ''}`);
  const now = new Date().toISOString();
  const rows: WebSku[] = items.map((i) => ({ ...i, created_by: user, created_at: now, updated_at: now }));
  const cols = ['sku', 'tab', 'code', 'name', 'color', 'size', 'cost', 'price', 'image', 'shop', 'alias', 'note', 'created_by', 'created_at', 'updated_at'];
  await db.prepare(`INSERT INTO catalog_web (${cols.join(', ')}) SELECT ${cols.map((c) => `value ->> '$.${c}'`).join(', ')} FROM json_each(?1)`).bind(JSON.stringify(rows)).run();
  return rows;
}

export async function updateWebSku(db: D1Database, sku: string, input: any): Promise<WebSku> {
  const existing = await db.prepare('SELECT * FROM catalog_web WHERE sku = ?1').bind(sku).first<WebSku>();
  if (!existing) throw new BadRequest('ไม่พบ SKU นี้ในรายการที่เพิ่มจากเว็บ');
  const v = validateWebSku({ ...existing, ...input, sku: existing.sku }, await tabNames(db));
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE catalog_web SET tab = ?2, code = ?3, name = ?4, color = ?5, size = ?6, cost = ?7, price = ?8, image = ?9, shop = ?10, alias = ?11, note = ?12, updated_at = ?13 WHERE sku = ?1`,
  ).bind(existing.sku, v.tab, v.code, v.name, v.color, v.size, v.cost, v.price, v.image, v.shop, v.alias, v.note, now).run();
  return { ...existing, ...v, updated_at: now };
}

export async function deleteWebSku(db: D1Database, sku: string): Promise<boolean> {
  const r = await db.prepare('DELETE FROM catalog_web WHERE sku = ?1').bind(sku).run();
  return (r.meta.changes ?? 0) > 0;
}

// ---- pictures added on the page ----

export interface CatalogImage { key: string; tab: string; spu: string; url: string | null; uploaded: boolean; bytes: number; updated_by: string; updated_at: string }

const MAX_THUMB = 200_000;
const MAX_FULL = 1_500_000;

/** Which picture each product uses, without the bytes. */
export async function listImages(db: D1Database): Promise<CatalogImage[]> {
  const { results } = await db.prepare('SELECT key, tab, spu, url, full IS NOT NULL AS uploaded, bytes, updated_by, updated_at FROM catalog_images').all<Omit<CatalogImage, 'uploaded'> & { uploaded: number }>();
  return results.map((r) => ({ ...r, uploaded: !!r.uploaded }));
}

export function imageKey(tabIn: unknown, spuIn: unknown): { key: string; tab: string; spu: string } {
  const tab = cleanText(tabIn, 40);
  const spu = cleanSku(spuIn);
  if (!tab || !spu || spu.length > 80) throw new BadRequest('ไม่รู้ว่าเป็นรูปของสินค้าไหน');
  return { key: `${tab}|${spu}`, tab, spu };
}

/** JPEG, PNG or WebP by their first bytes, not by what the browser claims. */
export function imageType(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export async function saveUploadedImage(db: D1Database, form: FormData, user: string): Promise<CatalogImage> {
  const { key, tab, spu } = imageKey(form.get('tab'), form.get('spu'));
  const read = async (name: string, max: number) => {
    const f = form.get(name);
    if (!f || typeof f === 'string') throw new BadRequest('ไม่มีไฟล์รูป');
    if (f.size > max) throw new BadRequest(`รูปใหญ่เกิน ${Math.round(max / 1000)} KB`);
    return new Uint8Array(await f.arrayBuffer());
  };
  const thumb = await read('thumb', MAX_THUMB);
  const full = await read('full', MAX_FULL);
  const mime = imageType(full);
  if (!mime || imageType(thumb) !== mime) throw new BadRequest('ไฟล์ไม่ใช่รูป JPEG/PNG/WebP');
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO catalog_images (key, tab, spu, url, thumb, full, mime, bytes, updated_by, updated_at) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT (key) DO UPDATE SET url = NULL, thumb = excluded.thumb, full = excluded.full, mime = excluded.mime, bytes = excluded.bytes, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(key, tab, spu, thumb, full, mime, thumb.length + full.length, user, now).run();
  return { key, tab, spu, url: null, uploaded: true, bytes: thumb.length + full.length, updated_by: user, updated_at: now };
}

export async function saveImageLink(db: D1Database, input: any, user: string): Promise<CatalogImage> {
  const { key, tab, spu } = imageKey(input?.tab, input?.spu);
  const url = String(input?.url ?? '').trim();
  if (!/^https:\/\/[^\s"'<>]+$/i.test(url) || url.length > 2000) throw new BadRequest('ลิงก์รูปต้องขึ้นต้นด้วย https://');
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO catalog_images (key, tab, spu, url, thumb, full, mime, bytes, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, 0, ?5, ?6)
     ON CONFLICT (key) DO UPDATE SET url = excluded.url, thumb = NULL, full = NULL, mime = NULL, bytes = 0, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(key, tab, spu, url, user, now).run();
  return { key, tab, spu, url, uploaded: false, bytes: 0, updated_by: user, updated_at: now };
}

export async function deleteImage(db: D1Database, key: string): Promise<boolean> {
  const r = await db.prepare('DELETE FROM catalog_images WHERE key = ?1').bind(key).run();
  return (r.meta.changes ?? 0) > 0;
}

/** The uploaded bytes. The URL carries updated_at, so browsers may keep it for good. */
export async function imageResponse(db: D1Database, key: string, size: 'thumb' | 'full'): Promise<Response> {
  const row = await db.prepare(`SELECT ${size === 'thumb' ? 'thumb' : 'full'} AS data, mime FROM catalog_images WHERE key = ?1`).bind(key).first<{ data: ArrayBuffer | number[] | null; mime: string | null }>();
  if (!row?.data || !row.mime) return new Response('not found', { status: 404 });
  // D1 hands BLOBs back as an ArrayBuffer or, on some runtimes, an array of numbers.
  const bytes = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : Uint8Array.from(row.data);
  return new Response(bytes, { headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
}

// ---- supplier set on the page (wins over the sheet's ร้านค้า; e.g. PK 501/1 → J.BIG) ----

export interface CatalogSupplier { key: string; tab: string; spu: string; shop: string; updated_by: string; updated_at: string }

export async function listSuppliers(db: D1Database): Promise<CatalogSupplier[]> {
  return (await db.prepare('SELECT key, tab, spu, shop, updated_by, updated_at FROM catalog_suppliers').all<CatalogSupplier>()).results;
}

/** Several products at once (a supplier picked for a whole group on the order page). Empty shop = back to the sheet. */
export async function saveSuppliers(db: D1Database, input: any, user: string): Promise<CatalogSupplier[]> {
  const list: unknown[] = Array.isArray(input?.items) ? input.items : [input];
  if (!list.length || list.length > 200) throw new BadRequest('ส่งได้ครั้งละ 1–200 สินค้า');
  const now = new Date().toISOString();
  const items = list.map((x: any) => ({ ...imageKey(x?.tab, x?.spu), shop: cleanText(x?.shop, 80) }));
  const set = items.filter((i) => i.shop).map((i) => ({ ...i, updated_by: user, updated_at: now }));
  const clear = items.filter((i) => !i.shop).map((i) => i.key);
  const statements: D1PreparedStatement[] = [];
  if (set.length) {
    statements.push(db.prepare(
      `INSERT INTO catalog_suppliers (key, tab, spu, shop, updated_by, updated_at)
       SELECT value ->> '$.key', value ->> '$.tab', value ->> '$.spu', value ->> '$.shop', value ->> '$.updated_by', value ->> '$.updated_at' FROM json_each(?1) WHERE true
       ON CONFLICT (key) DO UPDATE SET shop = excluded.shop, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(JSON.stringify(set)));
  }
  if (clear.length) statements.push(db.prepare('DELETE FROM catalog_suppliers WHERE key IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(clear)));
  await db.batch(statements);
  return set;
}

// ---- product pictures from other sites, for drawing picture sheets in the browser ----
// A canvas cannot export pictures from Shopee/TikTok (no CORS), so the page fetches them through here. Only the image
// hosts that appear in the sheet are allowed, so this cannot be used to reach anything else.

const IMAGE_HOSTS = [/\.shopee\.co\.th$/, /\.susercontent\.com$/, /\.ibyteimg\.com$/, /\.tiktokcdn\.com$/, /(^|\.)page365\.net$/, /\.fbcdn\.net$/, /^drive\.google\.com$/, /\.googleusercontent\.com$/];
const MAX_PROXY_BYTES = 6_000_000;

export function allowedImageUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  return u.protocol === 'https:' && !u.username && !u.password && !u.port && IMAGE_HOSTS.some((re) => re.test(u.hostname)) ? u : null;
}

export async function proxyImage(raw: string): Promise<Response> {
  const u = allowedImageUrl(raw);
  if (!u) return new Response('host not allowed', { status: 400 });
  const res = await fetch(u.toString(), { redirect: 'follow', signal: AbortSignal.timeout(15_000) }).catch(() => null);
  // Drive thumbnails redirect to googleusercontent; the final address must be allowed too.
  if (!res || !res.ok || !allowedImageUrl(res.url || u.toString())) return new Response('not found', { status: 404 });
  const type = res.headers.get('content-type') ?? '';
  if (!/^image\/(jpeg|png|webp|gif)/.test(type)) return new Response('not an image', { status: 415 });
  if (Number(res.headers.get('content-length') ?? 0) > MAX_PROXY_BYTES) return new Response('too large', { status: 413 });
  return new Response(res.body, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
}

// ---- cost per piece typed on the order page (fills or corrects ทุน, column H, which is what we pay) ----

export interface CatalogPrice { key: string; tab: string; spu: string; price: number; updated_by: string; updated_at: string }

export async function listPrices(db: D1Database): Promise<CatalogPrice[]> {
  return (await db.prepare('SELECT key, tab, spu, price, updated_by, updated_at FROM catalog_prices').all<CatalogPrice>()).results;
}

/** Several products at once; an empty price removes it (back to the sheet). */
export async function savePrices(db: D1Database, input: any, user: string): Promise<CatalogPrice[]> {
  const list: unknown[] = Array.isArray(input?.items) ? input.items : [input];
  if (!list.length || list.length > 200) throw new BadRequest('ส่งได้ครั้งละ 1–200 สินค้า');
  const now = new Date().toISOString();
  const items = list.map((x: any) => {
    const empty = x?.price === null || x?.price === undefined || String(x.price).trim() === '';
    const price = empty ? null : parseNumber(x.price);
    if (!empty && (price === null || price < 0 || price > 100_000)) throw new BadRequest('ราคาต้องเป็นตัวเลข 0–100,000');
    return { ...imageKey(x?.tab, x?.spu), price };
  });
  const set = items.filter((i) => i.price !== null).map((i) => ({ ...i, updated_by: user, updated_at: now }));
  const clear = items.filter((i) => i.price === null).map((i) => i.key);
  const statements: D1PreparedStatement[] = [];
  if (set.length) {
    statements.push(db.prepare(
      `INSERT INTO catalog_prices (key, tab, spu, price, updated_by, updated_at)
       SELECT value ->> '$.key', value ->> '$.tab', value ->> '$.spu', value ->> '$.price', value ->> '$.updated_by', value ->> '$.updated_at' FROM json_each(?1) WHERE true
       ON CONFLICT (key) DO UPDATE SET price = excluded.price, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(JSON.stringify(set)));
  }
  if (clear.length) statements.push(db.prepare('DELETE FROM catalog_prices WHERE key IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(clear)));
  await db.batch(statements);
  return set as CatalogPrice[];
}
