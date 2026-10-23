// ห้องฝึก (docs/creative.md): materials the staff give the agents, caption generation with Claude, A/B judging.
// Nothing here touches Meta, Page365 or customers; the only outside call is the Anthropic API.

import { BadRequest } from './validate.ts';
import { allowedImageUrl, imageType } from './catalog.ts';
import type { ActiveAdPost } from '../../ads-engine/src/meta.ts';
import { nameHasFamily } from './postIdeas.ts';

export interface StudioEnv {
  DB: D1Database;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_WORKSPACE_ID?: string;
  /** model for the caption agent; default claude-opus-5-5 */
  STUDIO_AI_MODEL?: string;
}

/** The hooks a caption may lead with; the agent tags each caption with one so win rates can be counted per hook. */
export const HOOKS: Record<string, string> = {
  price: 'ราคา', promo_math: 'คุ้มกว่าเมื่อซื้อหลายตัว', durability: 'ความทน/ผ้า', sizes: 'ไซส์ใหญ่/ไซส์ครบ',
  real: 'โพสต์จริงที่ยิงอยู่', review: 'รีวิว/คนซื้อซ้ำ', scarcity: 'ของมีจำกัด/โปรหมดเร็ว', lifestyle: 'ใส่ไปไหน/ลุค', problem: 'ปัญหาที่ยีนส์เดิมมี',
};

/** One-tap reasons a judge picks; the weekly playbook proposal reads them. */
export const REASONS: Record<string, string> = {
  wrong_fact: 'ข้อมูลผิด', boring: 'น่าเบื่อ/ทั่วไป', too_long: 'ยาวไป', not_our_voice: 'ไม่ใช่เสียงเรา', claim: 'อวดอ้างเกิน',
  product_wrong: 'สินค้าเพี้ยน', unreadable: 'อ่านป้ายไม่ออก', style_off: 'สไตล์ไม่ใช่', fake: 'ดูปลอม', better: 'อีกอันดีกว่าเฉยๆ',
};

const DEFAULT_PLAYBOOK = `เสียงของร้าน: พูดกับลูกค้าเหมือนเพื่อนที่ขายยีนส์มานาน ตรงไปตรงมา ไม่โอเวอร์ ภาษาไทยทั่วไป มีอีโมจิได้นิดหน่อย
ห้าม: อ้างเรื่องรูปร่าง/สุขภาพ (ผอมลง ขาเรียว), ตัวเลขที่ไม่ได้ให้มา, คำว่า "ดีที่สุด" "อันดับ 1"
ต้องมี: ราคาและโปรตามที่ให้มา, วิธีสั่ง (ทักแชท), ไซส์ที่มี
ความยาว: 3–6 บรรทัด บรรทัดแรกต้องหยุดนิ้วได้`;

const cleanText = (v: unknown, max: number) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);
const now = () => new Date().toISOString();

// ---- products (from the catalog) ----

export interface StudioProduct { code: string; name: string; price_min: number | null; price_max: number | null; skus: number; selling_points: string; promo: string; image_key: string | null; image_url: string | null }

/**
 * Product codes with a name, price range and the staff's notes; the picture is the catalog's uploaded one, else
 * column J. 22 Oct 2026: the first version ran a sub-query over the whole catalog (~17k rows) per product code —
 * millions of D1 row reads per page load, which used up the free plan's 5M/day. Now: one grouped scan, cached per
 * catalog version in the isolate; one product is read through the code index; the rest is matched in JS.
 */
let productCache: { version: string; rows: Omit<StudioProduct, 'selling_points' | 'promo' | 'image_key'>[] } | null = null;

async function productRows(db: D1Database): Promise<Omit<StudioProduct, 'selling_points' | 'promo' | 'image_key'>[]> {
  const version = (await db.prepare(`SELECT value FROM settings WHERE key = 'catalog_version'`).first<{ value: string }>())?.value ?? '';
  if (!productCache || productCache.version !== version) {
    const { results } = await db.prepare(
      `SELECT code, min(name) AS name, min(price) AS price_min, max(price) AS price_max, count(*) AS skus, max(image) AS image_url
       FROM catalog WHERE code != '' GROUP BY code ORDER BY code`,
    ).all<Omit<StudioProduct, 'selling_points' | 'promo' | 'image_key'>>();
    productCache = { version, rows: results };
  }
  return productCache.rows;
}

/** Search order for a product box: code starts with the text first, then shorter codes, then name matches. */
export function rankProducts<T extends { code: string; name: string }>(rows: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows
    .filter((r) => r.code.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle))
    .map((r) => ({ r, rank: r.code.toLowerCase() === needle ? 0 : r.code.toLowerCase().startsWith(needle) ? 1 : r.code.toLowerCase().includes(needle) ? 2 : 3 }))
    .sort((a, b) => a.rank - b.rank || a.r.code.length - b.r.code.length || a.r.code.localeCompare(b.r.code))
    .map((x) => x.r);
}

export interface RecommendedProduct extends StudioProduct { spend: number; posts: number }

/** Products running as ads now (posts on /studio/posts with a product code), most 14-day spend first. */
export async function recommendedProducts(db: D1Database, limit = 12): Promise<RecommendedProduct[]> {
  const { results: running } = await db.prepare(
    `SELECT code, sum(spend) AS spend, count(*) AS posts FROM meta_posts WHERE active = 1 AND code != '' GROUP BY code ORDER BY spend DESC LIMIT ?1`,
  ).bind(limit).all<{ code: string; spend: number; posts: number }>();
  if (!running.length) return [];
  const byCode = new Map((await productRows(db)).map((r) => [r.code.toLowerCase(), r]));
  const rows = running.map((r) => byCode.get(r.code.toLowerCase())).filter((r): r is NonNullable<typeof r> => !!r);
  const products = await withNotes(db, rows);
  return products.map((p) => { const r = running.find((x) => x.code.toLowerCase() === p.code.toLowerCase())!; return { ...p, spend: Math.round(r.spend), posts: r.posts }; });
}

export async function listProducts(db: D1Database, q = '', exact = false, limit = 300): Promise<StudioProduct[]> {
  let rows: Omit<StudioProduct, 'selling_points' | 'promo' | 'image_key'>[];
  if (exact) {
    rows = (await db.prepare(
      `SELECT code, min(name) AS name, min(price) AS price_min, max(price) AS price_max, count(*) AS skus, max(image) AS image_url
       FROM catalog WHERE code = ?1 COLLATE NOCASE GROUP BY code`,
    ).bind(q).all<typeof rows[number]>()).results;
  } else {
    rows = rankProducts(await productRows(db), q).slice(0, limit);
  }
  return withNotes(db, rows);
}

async function withNotes(db: D1Database, rows: Omit<StudioProduct, 'selling_points' | 'promo' | 'image_key'>[]): Promise<StudioProduct[]> {
  if (!rows.length) return [];
  const [{ results: notes }, { results: images }] = await Promise.all([
    db.prepare('SELECT code, selling_points, promo FROM product_notes WHERE code IN (SELECT value FROM json_each(?))').bind(JSON.stringify(rows.map((r) => r.code))).all<{ code: string; selling_points: string; promo: string }>(),
    db.prepare('SELECT key, spu FROM catalog_images').all<{ key: string; spu: string }>(),
  ]);
  const note = new Map(notes.map((n) => [n.code, n]));
  return rows.map((r) => ({
    ...r, image_url: r.image_url || null,
    selling_points: note.get(r.code)?.selling_points ?? '', promo: note.get(r.code)?.promo ?? '',
    image_key: images.find((i) => i.spu === r.code || i.spu.startsWith(`${r.code}-`))?.key ?? null,
  }));
}

export async function saveProductNote(db: D1Database, input: any, user: string): Promise<void> {
  const code = cleanText(input?.code, 80);
  if (!code) throw new BadRequest('ไม่รู้รหัสสินค้า');
  await db.prepare(
    `INSERT INTO product_notes (code, selling_points, promo, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (code) DO UPDATE SET selling_points = excluded.selling_points, promo = excluded.promo, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(code, cleanText(input?.selling_points, 2000), cleanText(input?.promo, 500), user, now()).run();
}

// ---- style cards + reference pictures ----

export interface StyleCard { id: number; name: string; note: string; created_by: string; created_at: string; refs: { id: number; note: string }[] }

export async function listStyleCards(db: D1Database): Promise<StyleCard[]> {
  const [{ results: cards }, { results: refs }] = await Promise.all([
    db.prepare('SELECT id, name, note, created_by, created_at FROM style_cards ORDER BY id').all<Omit<StyleCard, 'refs'>>(),
    db.prepare('SELECT id, card_id, note FROM style_refs ORDER BY id').all<{ id: number; card_id: number; note: string }>(),
  ]);
  return cards.map((c) => ({ ...c, refs: refs.filter((r) => r.card_id === c.id).map((r) => ({ id: r.id, note: r.note })) }));
}

export async function saveStyleCard(db: D1Database, input: any, user: string): Promise<number> {
  const name = cleanText(input?.name, 80), note = cleanText(input?.note, 1000);
  if (!name) throw new BadRequest('ตั้งชื่อสไตล์ก่อน');
  if (input?.id) {
    await db.prepare('UPDATE style_cards SET name = ?2, note = ?3 WHERE id = ?1').bind(Number(input.id), name, note).run();
    return Number(input.id);
  }
  const r = await db.prepare('INSERT INTO style_cards (name, note, created_by, created_at) VALUES (?1, ?2, ?3, ?4)').bind(name, note, user, now()).run();
  return Number(r.meta.last_row_id);
}

export async function deleteStyleCard(db: D1Database, id: number): Promise<void> {
  await db.batch([db.prepare('DELETE FROM style_refs WHERE card_id = ?').bind(id), db.prepare('DELETE FROM style_cards WHERE id = ?').bind(id)]);
}

const MAX_THUMB = 80_000, MAX_FULL = 1_500_000, MAX_REFS = 6;

async function readPicture(form: FormData): Promise<{ thumb: Uint8Array; full: Uint8Array; mime: string }> {
  const read = async (name: string, max: number) => {
    const f = form.get(name);
    if (!f || typeof f === 'string') throw new BadRequest('ไม่มีไฟล์รูป');
    if (f.size > max) throw new BadRequest(`รูปใหญ่เกิน ${Math.round(max / 1000)} KB`);
    return new Uint8Array(await f.arrayBuffer());
  };
  const thumb = await read('thumb', MAX_THUMB), full = await read('full', MAX_FULL);
  const mime = imageType(full);
  if (!mime || imageType(thumb) !== mime) throw new BadRequest('ไฟล์ไม่ใช่รูป JPEG/PNG/WebP');
  return { thumb, full, mime };
}

export async function addStyleRef(db: D1Database, form: FormData, user: string): Promise<number> {
  const cardId = Number(form.get('card_id'));
  if (!cardId) throw new BadRequest('ไม่รู้ว่าเป็นรูปของสไตล์ไหน');
  const n = await db.prepare('SELECT count(*) AS n FROM style_refs WHERE card_id = ?').bind(cardId).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_REFS) throw new BadRequest(`สไตล์หนึ่งเก็บรูปตัวอย่างได้ ${MAX_REFS} รูป`);
  const p = await readPicture(form);
  const r = await db.prepare('INSERT INTO style_refs (card_id, thumb, full, mime, note, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(cardId, p.thumb, p.full, p.mime, cleanText(form.get('note'), 300), user, now()).run();
  return Number(r.meta.last_row_id);
}

/** D1 hands BLOBs back as an ArrayBuffer or, on the deployed runtime, an array of numbers (catalog.ts imageResponse). */
function blobResponse(row: { data: ArrayBuffer | number[] | null; mime: string | null } | null): Response {
  if (!row?.data || !row.mime) return new Response('not found', { status: 404 });
  const bytes = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : Uint8Array.from(row.data);
  return new Response(bytes, { headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
}

export async function pictureResponse(db: D1Database, table: 'style_refs' | 'creative_candidates', id: number, size: 'thumb' | 'full'): Promise<Response> {
  const row = await db.prepare(`SELECT ${size} AS data, mime FROM ${table} WHERE id = ?`).bind(id).first<{ data: ArrayBuffer | number[] | null; mime: string | null }>();
  return blobResponse(row);
}

// ---- caption examples + playbook ----

export interface CaptionExample { id: number; text: string; liked: number; reason: string; created_by: string; created_at: string }

export async function listExamples(db: D1Database): Promise<CaptionExample[]> {
  return (await db.prepare('SELECT * FROM caption_examples ORDER BY id DESC').all<CaptionExample>()).results;
}

export async function addExample(db: D1Database, input: any, user: string): Promise<number> {
  const text = cleanText(input?.text, 2000), reason = cleanText(input?.reason, 300);
  if (!text) throw new BadRequest('ใส่ข้อความตัวอย่างก่อน');
  if (!reason) throw new BadRequest('บอกเหตุผล 1 บรรทัดด้วยว่าชอบ/ไม่ชอบตรงไหน — ตัวอย่างเปล่าๆ สอนระบบไม่ได้');
  const r = await db.prepare('INSERT INTO caption_examples (text, liked, reason, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(text, input?.liked ? 1 : 0, reason, user, now()).run();
  return Number(r.meta.last_row_id);
}

export interface Playbook { id: number | null; text: string; proposed_by: string; approved_by: string | null; created_at: string; note?: string | null }

/** Latest approved playbook; the built-in default before anyone writes one. */
export async function currentPlaybook(db: D1Database): Promise<Playbook> {
  const row = await db.prepare('SELECT * FROM playbook_versions WHERE approved_by IS NOT NULL ORDER BY id DESC LIMIT 1').first<Playbook>();
  return row ?? { id: null, text: DEFAULT_PLAYBOOK, proposed_by: 'default', approved_by: 'default', created_at: '' };
}

export async function savePlaybook(db: D1Database, input: any, user: string): Promise<number> {
  const text = cleanText(input?.text, 6000);
  if (!text) throw new BadRequest('คู่มือว่างเปล่า');
  const r = await db.prepare('INSERT INTO playbook_versions (text, proposed_by, approved_by, created_at) VALUES (?1, ?2, ?2, ?3)').bind(text, user, now()).run();
  return Number(r.meta.last_row_id);
}

// ---- caption generation ----

export interface Candidate {
  id: number; kind: 'caption' | 'image'; code: string; product_name: string; promo: string; hook: string; style_id: number | null;
  text: string | null; prompt: string; playbook_id: number | null; batch: string; created_by: string; created_at: string; status: string;
  ai_check?: string | null;
}

/** Approved or judge-edited captions: the examples the agent learns from first. */
async function goldCaptions(db: D1Database, limit = 12): Promise<{ text: string; hook: string }[]> {
  const { results } = await db.prepare(
    `SELECT coalesce(j.edited_text, c.text) AS text, c.hook FROM creative_judgements j JOIN creative_candidates c ON c.id = j.winner_id
     WHERE j.kind = 'caption' AND j.winner_id IS NOT NULL ORDER BY (j.edited_text IS NOT NULL) DESC, j.id DESC LIMIT ?`,
  ).bind(limit).all<{ text: string; hook: string }>();
  return results;
}

/** Everything the caption agent is told, so a judge can see why a caption came out the way it did. */
export async function captionPrompt(db: D1Database, product: StudioProduct, n: number): Promise<{ system: string; user: string; playbook_id: number | null }> {
  const [playbook, examples, gold, proven] = await Promise.all([currentPlaybook(db), listExamples(db), goldCaptions(db), provenPosts(db).catch(() => [])]);
  const liked = examples.filter((e) => e.liked).slice(0, 10), disliked = examples.filter((e) => !e.liked).slice(0, 10);
  const system = [
    'คุณเขียนแคปชันโพสต์ขายยีนส์ให้ร้าน PK Jeans (ขายผ่านแชท Facebook ลูกค้าไทย) ตามคู่มือและตัวอย่างด้านล่างอย่างเคร่งครัด',
    '## คู่มือ', playbook.text,
    proven.length ? `## แคปชันที่ยิงแอดจริงอยู่ตอนนี้และขายได้ดี (ROAS จากยอดแท็ก Meta 14 วัน)\n${proven.map((p) => `- [ROAS ${p.roas.toFixed(1)}] ${p.message.replace(/\n/g, ' / ').slice(0, 600)}`).join('\n')}` : '',
    gold.length ? `## แคปชันที่ทีมอนุมัติแล้ว (เลียนแบบน้ำเสียงนี้)\n${gold.map((g) => `- [${g.hook}] ${g.text.replace(/\n/g, ' / ')}`).join('\n')}` : '',
    liked.length ? `## ตัวอย่างที่ทีมชอบ\n${liked.map((e) => `- "${e.text.replace(/\n/g, ' / ')}" — ชอบเพราะ: ${e.reason}`).join('\n')}` : '',
    disliked.length ? `## ตัวอย่างที่ทีมไม่ชอบ (อย่าทำแบบนี้)\n${disliked.map((e) => `- "${e.text.replace(/\n/g, ' / ')}" — เพราะ: ${e.reason}`).join('\n')}` : '',
    `## รูปแบบคำตอบ\nตอบเป็น JSON array เท่านั้น ไม่มีข้อความอื่น: [{"hook": "<หนึ่งใน ${Object.keys(HOOKS).filter((h) => h !== 'real').join('|')}>", "text": "<แคปชัน>"}] แต่ละแคปชันใช้ hook ต่างกัน ห้ามใช้ตัวเลขราคา/ไซส์ที่ไม่ได้ให้มา ห้ามลอกประโยคจากตัวอย่าง ใช้เป็นแนวทางเท่านั้น (แคปชันของคุณจะถูกเทียบแบบปิดตากับโพสต์จริง)`,
  ].filter(Boolean).join('\n\n');
  const price = product.price_min === null ? 'ไม่ทราบ' : product.price_min === product.price_max ? `${product.price_min}` : `${product.price_min}–${product.price_max}`;
  const user = [
    `เขียนแคปชัน ${n} แบบสำหรับสินค้า:`,
    `รหัส ${product.code} · ${product.name} · ราคาขายต่อตัว ${price} บาท · ${product.skus} SKU`,
    product.promo ? `โปร: ${product.promo}` : 'โปร: ไม่มี (ขายราคาเต็ม)',
    product.selling_points ? `จุดขายจากทีม: ${product.selling_points}` : 'จุดขาย: ทีมยังไม่ได้ให้ — ใช้เฉพาะชื่อสินค้าและราคา ห้ามแต่งคุณสมบัติเอง',
  ].join('\n');
  return { system, user, playbook_id: playbook.id };
}

/** The agent's JSON, tolerant of text around it; unknown hooks become 'lifestyle'. */
export function parseCaptions(text: string): { hook: string; text: string }[] {
  const m = /\[[\s\S]*\]/.exec(text);
  if (!m) throw new Error('AI ไม่ได้ตอบเป็น JSON array');
  let arr: any;
  try { arr = JSON.parse(m[0]); } catch { throw new Error('AI ตอบ JSON ที่อ่านไม่ได้'); }
  if (!Array.isArray(arr)) throw new Error('AI ไม่ได้ตอบเป็น array');
  return arr.map((x: any) => ({ hook: HOOKS[String(x?.hook)] && x.hook !== 'real' ? String(x.hook) : 'lifestyle', text: cleanText(x?.text, 2000) })).filter((x) => x.text);
}

/** One Claude call (Messages API); content may hold images. Returns the text and token counts. */
async function askClaude(env: StudioEnv, system: string, content: unknown, maxTokens: number, effort: 'low' | 'medium' | 'high'): Promise<{ text: string; input: number; output: number }> {
  if (!env.ANTHROPIC_API_KEY) throw new BadRequest('ยังไม่ได้ตั้ง ANTHROPIC_API_KEY');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', ...(env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': env.ANTHROPIC_WORKSPACE_ID } : {}) },
    body: JSON.stringify({ model: env.STUDIO_AI_MODEL || 'claude-opus-5-5', max_tokens: maxTokens, output_config: { effort }, system, messages: [{ role: 'user', content }] }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`AI ${res.status}: ${body?.error?.message ?? res.statusText}`);
  if (body.stop_reason === 'refusal') throw new Error('AI ปฏิเสธคำขอนี้');
  const text = (body.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
  if (!text.trim()) throw new Error(`AI ไม่ได้ตอบข้อความ (stop: ${body.stop_reason ?? '?'})`);
  return { text, input: body.usage?.input_tokens ?? 0, output: body.usage?.output_tokens ?? 0 };
}

export async function generateCaptions(env: StudioEnv, code: string, n: number, user: string): Promise<{ batch: string; candidates: Candidate[]; tokens: { input: number; output: number } }> {
  if (!env.ANTHROPIC_API_KEY) throw new BadRequest('ยังไม่ได้ตั้ง ANTHROPIC_API_KEY');
  const product = (await listProducts(env.DB, code, true))[0];
  if (!product) throw new BadRequest('ไม่พบรหัสสินค้านี้ในแคตตาล็อก');
  const count = Math.min(10, Math.max(2, n || 6));
  const p = await captionPrompt(env.DB, product, count);
  await seedRealCaptions(env.DB).catch(() => 0);
  const { text, input, output } = await askClaude(env, p.system, p.user, 16000, 'medium');
  const captions = parseCaptions(text);
  if (!captions.length) throw new Error('AI ไม่ได้ให้แคปชันเลย');
  const batch = crypto.randomUUID();
  const at = now();
  const ins = env.DB.prepare(
    `INSERT INTO creative_candidates (kind, code, product_name, promo, hook, text, prompt, playbook_id, batch, created_by, created_at)
     VALUES ('caption', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'ai', ?9)`,
  );
  await env.DB.batch(captions.map((c) => ins.bind(code, product.name, product.promo, c.hook, c.text, `${p.system}\n\n---\n${p.user}`, p.playbook_id, batch, at)));
  const { results } = await env.DB.prepare('SELECT * FROM creative_candidates WHERE batch = ? ORDER BY id').bind(batch).all<Candidate>();
  return { batch, candidates: results, tokens: { input, output } };
}

/** Staff-made image (from ChatGPT) for a product and style, stored as a candidate like the agent's would be. */
export async function addImageCandidate(db: D1Database, form: FormData, user: string): Promise<number> {
  const code = cleanText(form.get('code'), 80);
  if (!code) throw new BadRequest('ไม่รู้รหัสสินค้า');
  const p = await readPicture(form);
  const styleId = Number(form.get('style_id')) || null;
  const r = await db.prepare(
    `INSERT INTO creative_candidates (kind, code, product_name, promo, style_id, thumb, full, mime, prompt, batch, created_by, created_at)
     VALUES ('image', ?1, ?2, '', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  ).bind(code, cleanText(form.get('product_name'), 200), styleId, p.thumb, p.full, p.mime, cleanText(form.get('prompt'), 4000), crypto.randomUUID(), user, now()).run();
  return Number(r.meta.last_row_id);
}

/** The prompt staff paste into ChatGPT for an image of this product in this style. */
export async function imagePrompt(db: D1Database, code: string, styleId: number): Promise<string> {
  const [product, card] = await Promise.all([listProducts(db, code, true).then((l) => l[0]), db.prepare('SELECT * FROM style_cards WHERE id = ?').bind(styleId).first<StyleCard>()]);
  if (!product) throw new BadRequest('ไม่พบรหัสสินค้านี้');
  if (!card) throw new BadRequest('ไม่พบสไตล์นี้');
  return [
    `ทำภาพโฆษณา Facebook (สี่เหลี่ยมจัตุรัส 1080×1080) ของกางเกงยีนส์ในรูปที่แนบมา (${product.code} ${product.name})`,
    `ห้ามเปลี่ยนตัวสินค้า: สีผ้า ทรง ตะเข็บ ป้าย ต้องเหมือนรูปที่แนบทุกประการ เปลี่ยนได้เฉพาะฉาก แสง มุม และองค์ประกอบรอบตัวสินค้า`,
    `สไตล์: ${card.name} — ${card.note || 'ตามรูปตัวอย่างที่แนบ'}`,
    product.promo ? `ใส่ป้ายข้อความ (ภาษาไทย อ่านง่าย ตัวใหญ่): "${product.promo}"` : 'ไม่ต้องใส่ข้อความราคา',
    'ไม่มีลายน้ำ ไม่มีโลโก้แบรนด์อื่น ไม่มีคน (ยกเว้นสไตล์ระบุว่ามีนางแบบ)',
  ].join('\n');
}

// ---- judging ----

export interface Pair { a: Candidate; b: Candidate; same_product: boolean }

/**
 * Next pair for this judge: two open candidates of one product that this judge hasn't compared yet, the least-judged
 * first so every candidate gets seen. Captions and images never mix.
 */
export async function nextPair(db: D1Database, kind: 'caption' | 'image', judge: string, code?: string): Promise<Pair | null> {
  const { results } = await db.prepare(
    `SELECT c.id, c.kind, c.code, c.product_name, c.promo, c.hook, c.style_id, c.text, '' AS prompt, c.playbook_id, c.batch, c.created_by, c.created_at, c.status, c.ai_check,
            (SELECT count(*) FROM creative_judgements j WHERE j.a_id = c.id OR j.b_id = c.id) AS seen
     FROM creative_candidates c WHERE c.kind = ?1 AND c.status = 'open' AND (?2 = '' OR c.code = ?2) ORDER BY seen, c.id DESC LIMIT 60`,
  ).bind(kind, code ?? '').all<Candidate & { seen: number }>();
  const byCode = new Map<string, (Candidate & { seen: number })[]>();
  for (const c of results) byCode.set(c.code, [...(byCode.get(c.code) ?? []), c]);
  const { results: done } = await db.prepare('SELECT a_id, b_id FROM creative_judgements WHERE kind = ?1 AND judge = ?2').bind(kind, judge).all<{ a_id: number; b_id: number }>();
  const seenPair = new Set(done.map((d) => `${Math.min(d.a_id, d.b_id)}:${Math.max(d.a_id, d.b_id)}`));
  // An AI caption against a real post first (the readiness number), then any unseen pair; the order of A and B is
  // random so judges can't learn where the real one sits.
  let fallback: Pair | null = null;
  for (const list of byCode.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (seenPair.has(`${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`)) continue;
      const pair = Math.random() < 0.5 ? { a, b, same_product: true } : { a: b, b: a, same_product: true };
      if ((a.hook === 'real') !== (b.hook === 'real')) return pair;
      fallback ??= pair;
    }
  }
  return fallback;
}

export async function judge(db: D1Database, input: any, user: string): Promise<void> {
  const a = Number(input?.a_id), b = Number(input?.b_id);
  const winner = input?.winner_id === null || input?.winner_id === undefined ? null : Number(input.winner_id);
  if (!a || !b || a === b) throw new BadRequest('คู่ไม่ถูกต้อง');
  if (winner !== null && winner !== a && winner !== b) throw new BadRequest('ผู้ชนะต้องเป็นหนึ่งในคู่');
  const kind = (await db.prepare('SELECT kind FROM creative_candidates WHERE id = ?').bind(a).first<{ kind: string }>())?.kind;
  if (!kind) throw new BadRequest('ไม่พบชิ้นงาน');
  const reason = REASONS[String(input?.reason)] ? String(input.reason) : '';
  const edited = kind === 'caption' && input?.edited_text ? cleanText(input.edited_text, 2000) : null;
  await db.prepare('INSERT INTO creative_judgements (kind, a_id, b_id, winner_id, reason, edited_text, judge, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
    .bind(kind, a, b, winner, reason, edited, user, now()).run();
}

export interface Stats {
  judged: number; today: number; open: { caption: number; image: number };
  hooks: { hook: string; wins: number; losses: number }[];
  reasons: { reason: string; n: number }[];
  agreement: { pairs: number; agreed: number };
  /** blind pairs of an AI caption against a real post: how often the AI's won */
  vs_real: { pairs: number; ai_wins: number };
  /** image pairs where both images had an AI check: how often the AI's better-scored image was the judges' pick */
  ai_eye: { pairs: number; agreed: number };
  /** new images against pictures of posts running as ads, blind */
  vs_real_img: { pairs: number; ai_wins: number };
  /** images the gate held back (product clearly not ours) */
  held: number;
  judges: { judge: string; n: number }[];
}

/** What the room has learned so far: win rate per hook, the reasons given, and how often two judges agree. */
export async function stats(db: D1Database): Promise<Stats> {
  // Today in Bangkok, as the UTC instant it started.
  const dayStart = new Date(`${new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)}T00:00:00+07:00`).toISOString();
  const [j, open, hooks, reasons, judges, pairs, vsReal, vsRealImg, eye] = await Promise.all([
    db.prepare(`SELECT count(*) AS n, coalesce(sum(created_at >= ?), 0) AS today FROM creative_judgements`).bind(dayStart).first<{ n: number; today: number }>(),
    db.prepare(`SELECT kind, count(*) AS n FROM creative_candidates WHERE status = 'open' GROUP BY kind`).all<{ kind: string; n: number }>(),
    db.prepare(
      `SELECT c.hook, sum(j.winner_id = c.id) AS wins, sum(j.winner_id IS NOT NULL AND j.winner_id != c.id) AS losses
       FROM creative_judgements j JOIN creative_candidates c ON c.id IN (j.a_id, j.b_id) WHERE j.kind = 'caption' GROUP BY c.hook ORDER BY wins DESC`,
    ).all<{ hook: string; wins: number; losses: number }>(),
    db.prepare(`SELECT reason, count(*) AS n FROM creative_judgements WHERE reason != '' GROUP BY reason ORDER BY n DESC`).all<{ reason: string; n: number }>(),
    db.prepare(`SELECT judge, count(*) AS n FROM creative_judgements GROUP BY judge ORDER BY n DESC`).all<{ judge: string; n: number }>(),
    db.prepare(
      `SELECT x.winner_id = y.winner_id AS same FROM creative_judgements x JOIN creative_judgements y
       ON min(x.a_id, x.b_id) = min(y.a_id, y.b_id) AND max(x.a_id, x.b_id) = max(y.a_id, y.b_id) AND x.judge < y.judge`,
    ).all<{ same: number }>(),
    db.prepare(
      `SELECT count(*) AS pairs, coalesce(sum(w.hook != 'real'), 0) AS ai_wins FROM creative_judgements j
       JOIN creative_candidates a ON a.id = j.a_id JOIN creative_candidates b ON b.id = j.b_id
       LEFT JOIN creative_candidates w ON w.id = j.winner_id
       WHERE j.kind = 'caption' AND (a.hook = 'real') != (b.hook = 'real') AND j.winner_id IS NOT NULL`,
    ).first<{ pairs: number; ai_wins: number }>(),
    db.prepare(
      `SELECT count(*) AS pairs, coalesce(sum(w.hook != 'real'), 0) AS ai_wins FROM creative_judgements j
       JOIN creative_candidates a ON a.id = j.a_id JOIN creative_candidates b ON b.id = j.b_id
       LEFT JOIN creative_candidates w ON w.id = j.winner_id
       WHERE j.kind = 'image' AND (a.hook = 'real') != (b.hook = 'real') AND j.winner_id IS NOT NULL`,
    ).first<{ pairs: number; ai_wins: number }>(),
    db.prepare(
      `SELECT j.winner_id, a.id AS a_id, a.ai_check AS a_check, b.ai_check AS b_check FROM creative_judgements j
       JOIN creative_candidates a ON a.id = j.a_id JOIN creative_candidates b ON b.id = j.b_id
       WHERE j.kind = 'image' AND j.winner_id IS NOT NULL AND a.ai_check IS NOT NULL AND b.ai_check IS NOT NULL`,
    ).all<{ winner_id: number; a_id: number; a_check: string; b_check: string }>(),
  ]);
  return {
    judged: j?.n ?? 0, today: j?.today ?? 0,
    open: { caption: open.results.find((r) => r.kind === 'caption')?.n ?? 0, image: open.results.find((r) => r.kind === 'image')?.n ?? 0 },
    hooks: hooks.results, reasons: reasons.results, judges: judges.results,
    agreement: { pairs: pairs.results.length, agreed: pairs.results.filter((p) => p.same).length },
    vs_real: { pairs: vsReal?.pairs ?? 0, ai_wins: vsReal?.ai_wins ?? 0 },
    vs_real_img: { pairs: vsRealImg?.pairs ?? 0, ai_wins: vsRealImg?.ai_wins ?? 0 },
    held: (await db.prepare(`SELECT count(*) AS n FROM creative_candidates WHERE status = 'held'`).first<{ n: number }>())?.n ?? 0,
    ai_eye: (() => {
      const score = (t: string) => { const c = JSON.parse(t) as ImageCheck; return c.product_match * 2 + (c.style_match ?? 5) - c.looks_fake - (c.text_readable === false ? 5 : 0); };
      const rows = eye.results.map((r) => ({ ...r, sa: score(r.a_check), sb: score(r.b_check) })).filter((r) => r.sa !== r.sb);
      return { pairs: rows.length, agreed: rows.filter((r) => (r.sa > r.sb) === (r.winner_id === r.a_id)).length };
    })(),
  };
}

/** Candidates of one product (for the materials page's "what was tried" list). */
export async function listCandidates(db: D1Database, code: string, kind?: string): Promise<(Candidate & { wins: number; losses: number })[]> {
  const { results } = await db.prepare(
    `SELECT c.id, c.kind, c.code, c.product_name, c.promo, c.hook, c.style_id, c.text, c.batch, c.created_by, c.created_at, c.status, c.playbook_id, '' AS prompt,
            (SELECT count(*) FROM creative_judgements j WHERE j.winner_id = c.id) AS wins,
            (SELECT count(*) FROM creative_judgements j WHERE j.winner_id IS NOT NULL AND j.winner_id != c.id AND c.id IN (j.a_id, j.b_id)) AS losses
     FROM creative_candidates c WHERE c.code = ?1 AND (?2 = '' OR c.kind = ?2) ORDER BY c.id DESC LIMIT 200`,
  ).bind(code, kind ?? '').all<Candidate & { wins: number; losses: number }>();
  return results;
}

// ---- foundation: the posts running as ads now (read from Meta) ----

export interface MetaPost {
  key: string; story_id: string | null; message: string; image_url: string | null; permalink: string | null; post_read: number;
  ads: { ad_id: string; ad_name: string; campaign_id: string; campaign_name: string }[];
  spend: number; impressions: number; purchases: number; purchase_value: number; messages: number;
  code: string; active: number; has_image: number; first_seen: string; fetched_at: string; tags?: string | null;
}

/** Ads → one row per post: numbers summed over the post's ads, product code from the first campaign name that names one. */
export function groupPosts(ads: ActiveAdPost[], codes: string[]): Omit<MetaPost, 'has_image' | 'first_seen' | 'fetched_at' | 'active'>[] {
  const by = new Map<string, ReturnType<typeof groupPosts>[number]>();
  for (const a of ads) {
    const key = a.story_id ?? (a.creative_id ? `creative:${a.creative_id}` : `ad:${a.ad_id}`);
    const p = by.get(key) ?? { key, story_id: a.story_id, message: a.message, image_url: a.image_url, permalink: a.permalink, post_read: a.post_read ? 1 : 0, ads: [], spend: 0, impressions: 0, purchases: 0, purchase_value: 0, messages: 0, code: '' };
    p.ads.push({ ad_id: a.ad_id, ad_name: a.ad_name, campaign_id: a.campaign_id, campaign_name: a.campaign_name });
    p.spend += a.stats.spend; p.impressions += a.stats.impressions; p.purchases += a.stats.purchases; p.purchase_value += a.stats.purchase_value; p.messages += a.stats.messages;
    if (!p.message && a.message) p.message = a.message;
    if (!p.image_url && a.image_url) p.image_url = a.image_url;
    by.set(key, p);
  }
  // Catalog codes are sub-models ("801/1", "Ni9-1", "SH-004"); campaign names say the model ("801", "Ni9", "SH004").
  // An exact code wins; else the model, mapped to its first sub-model in `codes` (callers pass most-SKUs first).
  // Longest first so "5011" isn't read as "501". A hyphen between letters and digits is ignored on both sides.
  const norm = (s: string) => s.replace(/([A-Za-z])-(?=\d)/g, '$1');
  const exact = [...codes].sort((x, y) => y.length - x.length);
  const models = new Map<string, string>();
  for (const c of codes) { const m = modelOf(c); if (m !== c && !models.has(m)) models.set(m, c); }
  const byModel = [...models.keys()].sort((x, y) => y.length - x.length);
  const named = (p: { ads: { campaign_name: string }[] }, c: string) => p.ads.some((a) => nameHasFamily(norm(a.campaign_name), norm(c)));
  for (const p of by.values()) {
    const hit = exact.find((c) => named(p, c));
    const model = hit ? undefined : byModel.find((m) => named(p, m));
    p.code = hit ?? (model ? models.get(model)! : '');
  }
  return [...by.values()];
}

/** "801/1" → "801", "Ni9-1" → "Ni9"; "SH-004" stays (the part before the hyphen has no digit, so it's not a sub-model). */
export function modelOf(code: string): string {
  const base = code.split('/')[0];
  const m = /^(.*\d.*)-\d+$/.exec(base);
  return m ? m[1] : base;
}

/** Read every active ad's post from Meta and upsert; posts no longer running are kept but marked inactive. */
export async function importMetaPosts(db: D1Database, ads: ActiveAdPost[]): Promise<{ posts: number; ads: number; unread: number; new_posts: number }> {
  // Most SKUs first: when a campaign names only the model, its biggest sub-model is taken.
  const { results: codeRows } = await db.prepare(`SELECT code FROM catalog WHERE code != '' AND length(code) >= 2 GROUP BY code ORDER BY count(*) DESC`).all<{ code: string }>();
  const posts = groupPosts(ads, codeRows.map((r) => r.code));
  const at = now();
  const before = new Set((await db.prepare('SELECT key FROM meta_posts').all<{ key: string }>()).results.map((r) => r.key));
  // Pictures stored before 2026-10-22 evening were Meta's 64 px thumbnails: drop the tiny ones so they're fetched again.
  await db.prepare('UPDATE meta_posts SET active = 0, thumb = CASE WHEN length(full) < 20000 THEN NULL ELSE thumb END, full = CASE WHEN length(full) < 20000 THEN NULL ELSE full END').run();
  if (posts.length) {
    await db.prepare(
      `INSERT INTO meta_posts (key, story_id, message, image_url, permalink, post_read, ads, spend, impressions, purchases, purchase_value, messages, code, active, first_seen, fetched_at)
       SELECT value ->> '$.key', value ->> '$.story_id', value ->> '$.message', value ->> '$.image_url', value ->> '$.permalink', value ->> '$.post_read', value ->> '$.ads',
              value ->> '$.spend', value ->> '$.impressions', value ->> '$.purchases', value ->> '$.purchase_value', value ->> '$.messages', value ->> '$.code', 1, ?1, ?1
       FROM json_each(?2) WHERE true
       ON CONFLICT (key) DO UPDATE SET message = excluded.message, image_url = coalesce(excluded.image_url, meta_posts.image_url), permalink = excluded.permalink,
         post_read = excluded.post_read, ads = excluded.ads, spend = excluded.spend, impressions = excluded.impressions, purchases = excluded.purchases,
         purchase_value = excluded.purchase_value, messages = excluded.messages, active = 1, fetched_at = excluded.fetched_at,
         code = CASE WHEN meta_posts.code = '' THEN excluded.code ELSE meta_posts.code END`,
    ).bind(at, JSON.stringify(posts.map((p) => ({ ...p, ads: JSON.stringify(p.ads) })))).run();
  }
  return { posts: posts.length, ads: ads.length, unread: posts.filter((p) => !p.post_read).length, new_posts: posts.filter((p) => !before.has(p.key)).length };
}

export async function listMetaPosts(db: D1Database): Promise<MetaPost[]> {
  const { results } = await db.prepare(
    `SELECT key, story_id, message, image_url, permalink, post_read, ads, spend, impressions, purchases, purchase_value, messages, code, active, tags,
            coalesce(length(full), 0) AS has_image, first_seen, fetched_at FROM meta_posts ORDER BY active DESC, spend DESC`,
  ).all<Omit<MetaPost, 'ads'> & { ads: string }>();
  return results.map((r) => ({ ...r, ads: JSON.parse(r.ads || '[]') }));
}

export async function saveMetaPostImage(db: D1Database, form: FormData): Promise<void> {
  const key = cleanText(form.get('key'), 200);
  if (!key) throw new BadRequest('ไม่รู้ว่าเป็นรูปของโพสต์ไหน');
  const p = await readPicture(form);
  await db.prepare('UPDATE meta_posts SET thumb = ?2, full = ?3, mime = ?4 WHERE key = ?1').bind(key, p.thumb, p.full, p.mime).run();
}

export async function setMetaPostCode(db: D1Database, input: any): Promise<void> {
  await db.prepare('UPDATE meta_posts SET code = ?2 WHERE key = ?1').bind(cleanText(input?.key, 200), cleanText(input?.code, 80)).run();
}

export async function metaPostPicture(db: D1Database, key: string, size: 'thumb' | 'full'): Promise<Response> {
  const row = await db.prepare(`SELECT ${size} AS data, mime FROM meta_posts WHERE key = ?`).bind(key).first<{ data: ArrayBuffer | number[] | null; mime: string | null }>();
  return blobResponse(row);
}

/** Posts that sold best on real spend (Meta-tagged ROAS, ≥ 1,000 spend in 14 days): the caption agent's first examples. */
export async function provenPosts(db: D1Database, limit = 6): Promise<{ message: string; roas: number; spend: number }[]> {
  const { results } = await db.prepare(
    `SELECT message, purchase_value / spend AS roas, spend FROM meta_posts WHERE spend >= 1000 AND message != '' ORDER BY purchase_value / spend DESC LIMIT ?`,
  ).bind(limit).all<{ message: string; roas: number; spend: number }>();
  return results;
}

// ---- real posts in the blind A/B, and the AI's read of them ----

/**
 * Posts running as ads (≥ 500 spend in 14 days, a caption and a product code) become caption candidates tagged
 * 'real', once each (batch = 'meta:<post key>'), so judges compare them blind against the agent's. How often the
 * agent beats them is the room's readiness number.
 */
export async function seedRealCaptions(db: D1Database): Promise<number> {
  const r = await db.prepare(
    `INSERT INTO creative_candidates (kind, code, product_name, promo, hook, text, prompt, batch, created_by, created_at)
     SELECT 'caption', p.code, '', '', 'real', p.message, 'โพสต์จริง ROAS ' || round(p.purchase_value / p.spend, 2) || ' ค่าแอด 14 วัน ' || round(p.spend), 'meta:' || p.key, 'meta', ?1
     FROM meta_posts p WHERE p.code != '' AND p.message != '' AND p.spend >= 500
       AND NOT EXISTS (SELECT 1 FROM creative_candidates c WHERE c.batch = 'meta:' || p.key)`,
  ).bind(now()).run();
  return r.meta.changes ?? 0;
}

export interface Analysis { playbook_id: number; playbook: string; findings: { point: string; evidence: string }[]; posts: number; tokens: { input: number; output: number } }

/**
 * Claude reads the posts running as ads — caption, numbers and (for the best and worst) the picture — and writes what
 * the sellers have in common, then a playbook built on it. Saved as a proposal; it is used only after someone
 * presses "ใช้คู่มือนี้".
 */
export async function analyzePosts(env: StudioEnv, user: string): Promise<Analysis> {
  const { results } = await env.DB.prepare(
    `SELECT key, message, spend, purchases, purchase_value, messages, impressions, code, thumb, mime FROM meta_posts
     WHERE active = 1 AND message != '' AND spend >= 300 ORDER BY purchase_value / spend DESC`,
  ).all<{ key: string; message: string; spend: number; purchases: number; purchase_value: number; messages: number; impressions: number; code: string; thumb: ArrayBuffer | number[] | null; mime: string | null }>();
  if (results.length < 5) throw new BadRequest('มีโพสต์ที่ใช้เงิน ≥ 300 ไม่ถึง 5 โพสต์ — กด "ดึงโพสต์จากเพจ" ก่อน');
  const withPic = new Set([...results.slice(0, 8), ...results.slice(-6)].map((r) => r.key));
  const content: unknown[] = [{ type: 'text', text: `โพสต์ที่ยิงแอดอยู่ ${results.length} โพสต์ เรียงจาก ROAS สูงไปต่ำ (ยอดแท็ก Meta 14 วัน ยอดจริงต่ำกว่าราว 11–14%; คุ้มทุนของร้านประมาณ ROAS 2.9):` }];
  results.forEach((r, i) => {
    const roas = r.spend ? r.purchase_value / r.spend : 0;
    content.push({ type: 'text', text: `\n### โพสต์ ${i + 1} · ROAS ${roas.toFixed(2)} · ค่าแอด ${Math.round(r.spend)} · ${Math.round(r.purchases)} ออเดอร์ · ${r.messages} แชท · ต้นทุนต่อแชท ${r.messages ? Math.round(r.spend / r.messages) : '-'} · รหัส ${r.code || '-'}\n${r.message.slice(0, 1500)}` });
    if (withPic.has(r.key) && r.thumb && r.mime) {
      content.push(imageBlock(r.thumb, r.mime));
    }
  });
  content.push({ type: 'text', text: `\nเปรียบเทียบโพสต์ที่ ROAS ดีกับไม่ดี แล้วตอบเป็น JSON เท่านั้น:
{"findings": [{"point": "<สิ่งที่โพสต์ขายดีทำต่างจากโพสต์ขายไม่ดี 1 ข้อ>", "evidence": "<อ้างโพสต์ที่เท่าไหร่ ROAS เท่าไหร่>"}],
 "playbook": "<คู่มือเขียนแคปชันสำหรับ AI ภาษาไทย ไม่เกิน 25 บรรทัด: เสียงของร้าน, โครงแคปชันที่ได้ผล (บรรทัดแรก, การวางราคา/โปร, อีโมจิ, ความยาว, วิธีสั่ง), สิ่งที่ต้องมี, สิ่งที่ห้าม>"}
findings 5–8 ข้อ ทุกข้อต้องมีหลักฐานจากตัวเลข ถ้าข้อมูลไม่พอสรุปข้อไหน ให้บอกตรงๆ ว่าไม่แน่ใจ อย่าแต่ง` });
  const out = await askClaude(env, 'คุณเป็นนักวิเคราะห์โฆษณา Facebook ของร้านยีนส์ไทยที่ขายผ่านแชท ตอบตามข้อมูลที่ให้เท่านั้น', content, 16000, 'high');
  const m = /\{[\s\S]*\}/.exec(out.text);
  let parsed: any;
  try { parsed = JSON.parse(m?.[0] ?? ''); } catch { throw new Error('AI ตอบ JSON ที่อ่านไม่ได้'); }
  const playbook = cleanText(parsed?.playbook, 6000);
  const findings = (Array.isArray(parsed?.findings) ? parsed.findings : []).map((f: any) => ({ point: cleanText(f?.point, 500), evidence: cleanText(f?.evidence, 500) })).filter((f: { point: string }) => f.point);
  if (!playbook) throw new Error('AI ไม่ได้เขียนคู่มือ');
  const r = await env.DB.prepare('INSERT INTO playbook_versions (text, proposed_by, approved_by, created_at, note) VALUES (?1, ?2, NULL, ?3, ?4)')
    .bind(playbook, `ai (กดโดย ${user})`, now(), JSON.stringify({ findings, posts: results.length })).run();
  return { playbook_id: Number(r.meta.last_row_id), playbook, findings, posts: results.length, tokens: { input: out.input, output: out.output } };
}

/** The newest proposal that nobody approved yet, with its findings. */
export async function pendingPlaybook(db: D1Database): Promise<(Playbook & { findings: { point: string; evidence: string }[] }) | null> {
  const current = await currentPlaybook(db);
  const row = await db.prepare('SELECT * FROM playbook_versions WHERE approved_by IS NULL AND id > ?1 ORDER BY id DESC LIMIT 1').bind(current.id ?? 0).first<Playbook>();
  if (!row) return null;
  return { ...row, findings: JSON.parse(row.note || '{}').findings ?? [] };
}

export async function approvePlaybook(db: D1Database, id: number, text: unknown, user: string): Promise<void> {
  const t = cleanText(text, 6000);
  const r = await db.prepare('UPDATE playbook_versions SET approved_by = ?2, text = CASE WHEN ?3 = \'\' THEN text ELSE ?3 END WHERE id = ?1 AND approved_by IS NULL').bind(id, user, t).run();
  if (!r.meta.changes) throw new BadRequest('ไม่พบข้อเสนอนี้ หรือมีคนกดไปแล้ว');
}

// ---- the AI looks at images ----

/** A D1 BLOB (ArrayBuffer or number array) as a Messages API image block. */
function imageBlock(data: ArrayBuffer | number[] | Uint8Array, mime: string): unknown {
  const bytes = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { type: 'image', source: { type: 'base64', media_type: mime, data: btoa(bin) } };
}

/** Images whose product scores this or lower are held back from the judges (staff can release them). */
export const HOLD_BELOW = 4;

export interface ImageCheck {
  product_match: number; product_issues: string;
  text_readable: boolean | null; text_issues: string;
  style_match: number | null; looks_fake: number;
  verdict: 'pass' | 'check' | 'fail'; summary: string;
}

/** The product's real photo: the catalog upload, else column J's link (allowed hosts only). */
async function productPhoto(db: D1Database, code: string): Promise<{ data: Uint8Array; mime: string } | null> {
  const p = (await listProducts(db, code, true))[0];
  if (!p) return null;
  if (p.image_key) {
    const row = await db.prepare('SELECT full, mime FROM catalog_images WHERE key = ?').bind(p.image_key).first<{ full: ArrayBuffer | number[] | null; mime: string | null }>();
    if (row?.full && row.mime) return { data: row.full instanceof ArrayBuffer ? new Uint8Array(row.full) : Uint8Array.from(row.full), mime: row.mime };
  }
  const u = p.image_url ? allowedImageUrl(p.image_url) : null;
  if (!u) return null;
  const res = await fetch(u.toString(), { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) return null;
  const data = new Uint8Array(await res.arrayBuffer());
  const mime = imageType(data);
  return mime && data.length < 4_000_000 ? { data, mime } : null;
}

/** Claude's verdict, kept to the shape the page expects; numbers clamped to 0–10. */
export function parseImageCheck(text: string): ImageCheck {
  const m = /\{[\s\S]*\}/.exec(text);
  let x: any;
  try { x = JSON.parse(m?.[0] ?? ''); } catch { throw new Error('AI ตอบ JSON ที่อ่านไม่ได้'); }
  const n = (v: unknown) => Math.max(0, Math.min(10, Math.round(Number(v) || 0)));
  return {
    product_match: n(x?.product_match), product_issues: cleanText(x?.product_issues, 400),
    text_readable: typeof x?.text_readable === 'boolean' ? x.text_readable : null, text_issues: cleanText(x?.text_issues, 400),
    style_match: x?.style_match === null || x?.style_match === undefined ? null : n(x.style_match), looks_fake: n(x?.looks_fake),
    verdict: ['pass', 'check', 'fail'].includes(x?.verdict) ? x.verdict : 'check', summary: cleanText(x?.summary, 300),
  };
}

/**
 * Claude compares one image with the real product photo (is it the same jeans: colour, wash, cut, stitching, labels?),
 * reads any text on it, compares it with the style card's references and says whether it looks fake. Stored on the
 * candidate. A product that doesn't match is the one thing that must never reach customers (wrong item → returns).
 */
export async function checkImage(env: StudioEnv, id: number): Promise<ImageCheck> {
  const c = await env.DB.prepare(`SELECT id, code, product_name, promo, style_id, full, mime FROM creative_candidates WHERE id = ? AND kind = 'image'`).bind(id)
    .first<{ id: number; code: string; product_name: string; promo: string; style_id: number | null; full: ArrayBuffer | number[] | null; mime: string | null }>();
  if (!c?.full || !c.mime) throw new BadRequest('ไม่พบภาพนี้');
  const [photo, card, refs, product] = await Promise.all([
    productPhoto(env.DB, c.code),
    c.style_id ? env.DB.prepare('SELECT name, note FROM style_cards WHERE id = ?').bind(c.style_id).first<{ name: string; note: string }>() : null,
    c.style_id ? env.DB.prepare('SELECT thumb, mime FROM style_refs WHERE card_id = ? ORDER BY id LIMIT 3').bind(c.style_id).all<{ thumb: ArrayBuffer | number[]; mime: string }>().then((r) => r.results) : [],
    listProducts(env.DB, c.code, true).then((l) => l[0]),
  ]);
  const content: unknown[] = [];
  if (photo) content.push({ type: 'text', text: `รูปสินค้าจริง (${c.code} ${product?.name ?? c.product_name}):` }, imageBlock(photo.data, photo.mime));
  else content.push({ type: 'text', text: `ไม่มีรูปสินค้าจริงของ ${c.code} ให้เทียบ — ให้ product_match ตามที่ดูสมเหตุสมผลกับชื่อสินค้า "${product?.name ?? c.product_name}" และบอกใน product_issues ว่าไม่มีรูปเทียบ` });
  if (card) {
    content.push({ type: 'text', text: `สไตล์ที่ต้องการ: ${card.name} — ${card.note || '(ไม่มีคำอธิบาย)'}${refs.length ? ' · รูปตัวอย่างสไตล์:' : ''}` });
    for (const r of refs) content.push(imageBlock(r.thumb, r.mime));
  }
  content.push({ type: 'text', text: `ภาพโฆษณาที่ต้องตรวจ:` }, imageBlock(c.full, c.mime));
  const promo = product?.promo || c.promo;
  content.push({ type: 'text', text: `ตรวจภาพโฆษณาแล้วตอบเป็น JSON เท่านั้น:
{"product_match": <0-10 สินค้าในภาพโฆษณาเป็นตัวเดียวกับรูปสินค้าจริงแค่ไหน: สีผ้า/ระดับการฟอก ทรง ตะเข็บ กระเป๋า ป้าย>,
 "product_issues": "<สิ่งที่ต่างจากของจริง ระบุให้ชัด หรือ '' ถ้าไม่มี>",
 "text_readable": <true/false ข้อความภาษาไทยบนภาพอ่านออกและสะกดถูกไหม, null ถ้าไม่มีข้อความ>,
 "text_issues": "<ข้อความที่ผิด/อ่านไม่ออก${promo ? ` หรือไม่ตรงกับโปรจริง "${promo}"` : ''}>",
 "style_match": <0-10 ตรงกับสไตล์ที่ต้องการแค่ไหน, null ถ้าไม่ได้ระบุสไตล์>,
 "looks_fake": <0-10 ดูเป็นภาพ AI/ปลอมจนลูกค้าไม่เชื่อแค่ไหน 10 = ปลอมชัด>,
 "verdict": "<pass ถ้าใช้ได้ | check ถ้าต้องให้คนดู | fail ถ้าสินค้าไม่ตรงของจริงหรือข้อความผิด>",
 "summary": "<สรุป 1 ประโยค>",
 "tags": {
 ${TAGS_SPEC}
 }}
เข้มงวดเรื่องสินค้า: ลูกค้าที่ได้ของไม่ตรงรูปจะขอคืน ถ้าไม่แน่ใจให้ verdict เป็น check` });
  const lessons = await checkerLessons(env.DB).catch(() => []);
  if (lessons.length) content.push({ type: 'text', text: `บทเรียนจากกรรมการ (ที่ผ่านมาคุณปล่อยผ่านแต่คนตีตก — เข้มขึ้นในจุดนี้):\n${lessons.map((l) => `- ${l}`).join('\n')}` });
  const out = await askClaude(env, 'คุณตรวจภาพโฆษณาของร้านยีนส์ไทยก่อนลงโฆษณา ตอบตามสิ่งที่เห็นในภาพเท่านั้น', content, 8000, 'medium');
  const check = parseImageCheck(out.text);
  const tags = cleanTags(/\{[\s\S]*\}/.exec(out.text) ? JSON.parse(/\{[\s\S]*\}/.exec(out.text)![0])?.tags : null);
  // The gate: a product that clearly isn't ours never reaches the judges (staff can send it on anyway).
  const hold = check.product_match <= HOLD_BELOW;
  await env.DB.prepare(`UPDATE creative_candidates SET ai_check = ?2, tags = ?3, status = CASE WHEN ?4 AND status = 'open' THEN 'held' WHEN NOT ?4 AND status = 'held' THEN 'open' ELSE status END WHERE id = ?1`)
    .bind(id, JSON.stringify(check), JSON.stringify(tags), hold ? 1 : 0).run();
  return check;
}

/** Remove an image or caption from the room (kept for history, never paired again). */
export async function rejectCandidate(db: D1Database, id: number): Promise<void> {
  await db.prepare(`UPDATE creative_candidates SET status = 'rejected' WHERE id = ?`).bind(id).run();
}

// ---- ห้องจับคู่: passed caption × passed image of one product → a post ----

export interface Passed { id: number; code: string; text: string | null; hook: string; style_id: number | null; wins: number; losses: number; edited: boolean; ai_check: string | null }

/**
 * What the judges passed for one product: captions (not real posts) that won more than they lost or that a judge
 * edited, and images that won at least once, lost no more than they won and weren't failed by the AI's check.
 * A caption's text is the latest judge edit when there is one.
 */
export async function passedFor(db: D1Database, code: string): Promise<{ captions: Passed[]; images: Passed[] }> {
  const { results } = await db.prepare(
    `SELECT c.id, c.kind, c.code, c.text, c.hook, c.style_id, c.ai_check,
            (SELECT count(*) FROM creative_judgements j WHERE j.winner_id = c.id) AS wins,
            (SELECT count(*) FROM creative_judgements j WHERE j.winner_id IS NOT NULL AND j.winner_id != c.id AND c.id IN (j.a_id, j.b_id)) AS losses,
            (SELECT j.edited_text FROM creative_judgements j WHERE j.winner_id = c.id AND j.edited_text IS NOT NULL ORDER BY j.id DESC LIMIT 1) AS edited_text
     FROM creative_candidates c WHERE c.code = ?1 AND c.status = 'open' AND c.hook != 'real'`,
  ).bind(code).all<Passed & { kind: string; edited_text: string | null }>();
  const captions = results.filter((c) => c.kind === 'caption' && (c.edited_text || c.wins > c.losses))
    .map((c) => ({ ...c, text: c.edited_text ?? c.text, edited: !!c.edited_text }))
    .sort((a, b) => Number(b.edited) - Number(a.edited) || b.wins - b.losses - (a.wins - a.losses));
  const images = results.filter((c) => c.kind === 'image' && c.wins >= 1 && c.wins >= c.losses && (!c.ai_check || JSON.parse(c.ai_check).verdict !== 'fail'))
    .map((c) => ({ ...c, edited: false })).sort((a, b) => b.wins - b.losses - (a.wins - a.losses));
  return { captions, images };
}

/** Products that have at least one passed caption and one passed image (for the room's product list). */
export async function readyProducts(db: D1Database): Promise<{ code: string; captions: number; images: number }[]> {
  const { results } = await db.prepare(`SELECT DISTINCT c.code FROM creative_judgements j JOIN creative_candidates c ON c.id = j.winner_id WHERE c.hook != 'real'`).all<{ code: string }>();
  const out: { code: string; captions: number; images: number }[] = [];
  for (const { code } of results) {
    const p = await passedFor(db, code);
    if (p.captions.length || p.images.length) out.push({ code, captions: p.captions.length, images: p.images.length });
  }
  return out.sort((a, b) => Number(b.captions > 0 && b.images > 0) - Number(a.captions > 0 && a.images > 0) || a.code.localeCompare(b.code));
}

export interface PairCheck { match: boolean; issues: string; summary: string }

/** Claude checks that the caption and the picture tell the same story: same product, same price/promo, no clash. */
async function checkSet(env: StudioEnv, caption: string, imageId: number): Promise<PairCheck | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  const img = await env.DB.prepare('SELECT full, mime FROM creative_candidates WHERE id = ?').bind(imageId).first<{ full: ArrayBuffer | number[] | null; mime: string | null }>();
  if (!img?.full || !img.mime) return null;
  const out = await askClaude(env, 'คุณตรวจโพสต์โฆษณาของร้านยีนส์ไทยก่อนลง ตอบตามสิ่งที่เห็นเท่านั้น', [
    imageBlock(img.full, img.mime),
    { type: 'text', text: `แคปชันที่จะโพสต์คู่กับภาพนี้:\n${caption}\n\nภาพกับแคปชันไปด้วยกันไหม: สินค้าเดียวกัน ราคา/โปรบนภาพตรงกับในแคปชัน ไม่ขัดกัน ตอบ JSON เท่านั้น: {"match": true/false, "issues": "<สิ่งที่ขัดกัน หรือ ''>", "summary": "<1 ประโยค>"}` },
  ], 4000, 'low');
  const m = /\{[\s\S]*\}/.exec(out.text);
  try { const x = JSON.parse(m?.[0] ?? ''); return { match: !!x.match, issues: cleanText(x.issues, 400), summary: cleanText(x.summary, 300) }; } catch { return null; }
}

export interface CreativeSet { id: number; code: string; caption_id: number; image_id: number; caption_text: string; ai_note: string | null; status: string; created_by: string; created_at: string; decided_by: string | null; decided_at: string | null }

export async function createSet(env: StudioEnv, input: any, user: string): Promise<CreativeSet> {
  const captionId = Number(input?.caption_id), imageId = Number(input?.image_id);
  const [cap, img] = await Promise.all([
    env.DB.prepare(`SELECT id, code, text FROM creative_candidates WHERE id = ? AND kind = 'caption'`).bind(captionId).first<{ id: number; code: string; text: string }>(),
    env.DB.prepare(`SELECT id, code FROM creative_candidates WHERE id = ? AND kind = 'image'`).bind(imageId).first<{ id: number; code: string }>(),
  ]);
  if (!cap || !img) throw new BadRequest('เลือกแคปชันและภาพก่อน');
  if (cap.code !== img.code) throw new BadRequest('แคปชันกับภาพต้องเป็นสินค้าเดียวกัน');
  const text = cleanText(input?.caption_text, 3000) || cap.text;
  const check = await checkSet(env, text, imageId).catch(() => null);
  const r = await env.DB.prepare(
    `INSERT INTO creative_sets (code, caption_id, image_id, caption_text, ai_note, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (caption_id, image_id) DO UPDATE SET caption_text = excluded.caption_text, ai_note = excluded.ai_note, status = 'draft', decided_by = NULL, decided_at = NULL
     RETURNING *`,
  ).bind(cap.code, captionId, imageId, text, check ? JSON.stringify(check) : null, user, now()).first<CreativeSet>();
  return r!;
}

export async function listSets(db: D1Database): Promise<CreativeSet[]> {
  return (await db.prepare(`SELECT * FROM creative_sets WHERE status != 'rejected' ORDER BY status = 'approved', id DESC LIMIT 200`).all<CreativeSet>()).results;
}

export async function decideSet(db: D1Database, id: number, status: unknown, user: string): Promise<void> {
  if (status !== 'approved' && status !== 'rejected' && status !== 'draft') throw new BadRequest('สถานะไม่ถูกต้อง');
  await db.prepare('UPDATE creative_sets SET status = ?2, decided_by = ?3, decided_at = ?4 WHERE id = ?1').bind(id, status, user, now()).run();
}

// ---- what a picture shows: fixed tags, so wins and ROAS can be counted per kind of picture ----

/** Each dimension has a closed list; Claude must pick one value per dimension. Labels are what the pages show. */
export const IMAGE_TAGS: Record<string, { label: string; values: Record<string, string> }> = {
  subject: { label: 'ตัวสินค้า', values: { worn: 'มีคนใส่', flat_lay: 'วางพื้น', hanging: 'แขวน', multi: 'หลายตัวเรียงกัน', detail: 'ซูมรายละเอียดผ้า', collage: 'ภาพตัดต่อหลายช่อง' } },
  text: { label: 'ข้อความบนภาพ', values: { price_big: 'ราคาตัวใหญ่', promo: 'โปร/หลายตัวคุ้ม', small: 'ข้อความเล็กน้อย', none: 'ไม่มีข้อความ' } },
  background: { label: 'พื้นหลัง', values: { plain_light: 'พื้นเรียบสว่าง', plain_dark: 'พื้นเรียบมืด', real_scene: 'ฉากจริง/นอกสถานที่', store: 'หน้าร้าน/สต็อก' } },
  face: { label: 'หน้าคน', values: { yes: 'เห็นหน้า', no: 'ไม่เห็นหน้า' } },
  colors: { label: 'จำนวนสีที่โชว์', values: { one: 'สีเดียว', several: 'หลายสี' } },
  look: { label: 'ความรู้สึก', values: { real_photo: 'ภาพถ่ายจริง', edited: 'แต่งภาพ/กราฟิก', ai_like: 'ดูเป็นภาพ AI' } },
};

export const TAGS_SPEC = Object.entries(IMAGE_TAGS).map(([k, d]) => `"${k}": "<${Object.keys(d.values).join('|')}>" (${d.label}: ${Object.entries(d.values).map(([v, l]) => `${v}=${l}`).join(', ')})`).join(',\n ');

/** Keep only known dimensions and values. */
export function cleanTags(x: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, d] of Object.entries(IMAGE_TAGS)) if (x && typeof x[k] === 'string' && d.values[x[k]]) out[k] = x[k];
  return out;
}

/**
 * Tags for the posts running as ads, a few pictures per call (one Claude request reads up to 6). Called repeatedly by
 * the page until nothing is left; `force` re-tags everything.
 */
export async function tagMetaPosts(env: StudioEnv, force = false, batch = 6): Promise<{ tagged: number; left: number }> {
  if (force) await env.DB.prepare('UPDATE meta_posts SET tags = NULL').run();
  const { results } = await env.DB.prepare(`SELECT key, thumb, mime FROM meta_posts WHERE tags IS NULL AND thumb IS NOT NULL ORDER BY spend DESC LIMIT ?`).bind(batch)
    .all<{ key: string; thumb: ArrayBuffer | number[]; mime: string }>();
  if (results.length) {
    const content: unknown[] = [];
    results.forEach((r, i) => content.push({ type: 'text', text: `ภาพ ${i + 1}:` }, imageBlock(r.thumb, r.mime)));
    content.push({ type: 'text', text: `ติดป้ายแต่ละภาพโฆษณายีนส์ข้างบน ตอบเป็น JSON array ตามลำดับภาพเท่านั้น ${results.length} ช่อง: [{\n ${TAGS_SPEC}\n}]` });
    const out = await askClaude(env, 'คุณติดป้ายภาพโฆษณาตามสิ่งที่เห็น เลือกค่าจากรายการที่ให้เท่านั้น', content, 6000, 'low');
    const m = /\[[\s\S]*\]/.exec(out.text);
    let arr: any[] = [];
    try { arr = JSON.parse(m?.[0] ?? '[]'); } catch { throw new Error('AI ตอบ JSON ที่อ่านไม่ได้'); }
    await env.DB.batch(results.map((r, i) => env.DB.prepare('UPDATE meta_posts SET tags = ?2 WHERE key = ?1').bind(r.key, JSON.stringify(cleanTags(arr[i])))));
  }
  const left = await env.DB.prepare('SELECT count(*) AS n FROM meta_posts WHERE tags IS NULL AND thumb IS NOT NULL').first<{ n: number }>();
  return { tagged: results.length, left: left?.n ?? 0 };
}

export interface TagRow { dim: string; value: string; label: string; posts: number; spend: number; roas: number | null; wins: number; losses: number }

/**
 * Per tag value: on the posts running as ads, how many, their spend and their combined ROAS (Meta-tagged, all
 * spend-weighted); in the room, how often images with it won and lost.
 */
export async function imageTagStats(db: D1Database): Promise<TagRow[]> {
  const [{ results: posts }, { results: judged }] = await Promise.all([
    db.prepare(`SELECT tags, spend, purchase_value FROM meta_posts WHERE tags IS NOT NULL AND active = 1`).all<{ tags: string; spend: number; purchase_value: number }>(),
    db.prepare(
      `SELECT a.tags AS a_tags, b.tags AS b_tags, j.winner_id = a.id AS a_won FROM creative_judgements j
       JOIN creative_candidates a ON a.id = j.a_id JOIN creative_candidates b ON b.id = j.b_id
       WHERE j.kind = 'image' AND j.winner_id IS NOT NULL`,
    ).all<{ a_tags: string | null; b_tags: string | null; a_won: number }>(),
  ]);
  const rows = new Map<string, TagRow & { value_sum: number }>();
  const row = (dim: string, value: string) => {
    const k = `${dim}:${value}`;
    if (!rows.has(k)) rows.set(k, { dim, value, label: IMAGE_TAGS[dim]?.values[value] ?? value, posts: 0, spend: 0, roas: null, wins: 0, losses: 0, value_sum: 0 });
    return rows.get(k)!;
  };
  for (const p of posts) for (const [d, v] of Object.entries(JSON.parse(p.tags) as Record<string, string>)) { const r = row(d, v); r.posts++; r.spend += p.spend; r.value_sum += p.purchase_value; }
  for (const j of judged) {
    const [ta, tb] = [j.a_tags, j.b_tags].map((t) => (t ? (JSON.parse(t) as Record<string, string>) : {}));
    for (const [d, v] of Object.entries(ta)) if (tb[d] !== v) { const r = row(d, v); if (j.a_won) r.wins++; else r.losses++; }
    for (const [d, v] of Object.entries(tb)) if (ta[d] !== v) { const r = row(d, v); if (j.a_won) r.losses++; else r.wins++; }
  }
  return [...rows.values()].map(({ value_sum, ...r }) => ({ ...r, roas: r.spend > 0 ? value_sum / r.spend : null }))
    .sort((a, b) => a.dim.localeCompare(b.dim) || (b.roas ?? 0) - (a.roas ?? 0));
}

/**
 * Pictures of the posts running as ads (≥ 500 spend, a product code, a stored picture) join the image A/B blind,
 * tagged 'real', once each — the image room's readiness number is how often the team's new pictures beat them.
 */
export async function seedRealImages(db: D1Database): Promise<number> {
  const r = await db.prepare(
    `INSERT INTO creative_candidates (kind, code, product_name, promo, hook, thumb, full, mime, tags, prompt, batch, created_by, created_at)
     SELECT 'image', p.code, '', '', 'real', p.thumb, p.full, p.mime, p.tags, 'โพสต์จริง ROAS ' || round(p.purchase_value / p.spend, 2) || ' ค่าแอด 14 วัน ' || round(p.spend), 'metaimg:' || p.key, 'meta', ?1
     FROM meta_posts p WHERE p.code != '' AND p.full IS NOT NULL AND p.spend >= 500
       AND NOT EXISTS (SELECT 1 FROM creative_candidates c WHERE c.batch = 'metaimg:' || p.key)`,
  ).bind(now()).run();
  return r.meta.changes ?? 0;
}

/** Send an image the gate held back to the judges anyway. */
export async function releaseCandidate(db: D1Database, id: number): Promise<void> {
  await db.prepare(`UPDATE creative_candidates SET status = 'open' WHERE id = ? AND status = 'held'`).bind(id).run();
}

/**
 * The ChatGPT prompt, written by Claude from what the room has learned: tags that sell on the posts running as ads,
 * tags that win in the room, the prompts behind images that won, the reasons images lost. It also picks what to try
 * this time (asking for one tag value that has little data yet), so the room keeps learning. Without an API key, or
 * if the call fails, the fixed template.
 */
export async function learnedImagePrompt(env: StudioEnv, code: string, styleId: number): Promise<{ prompt: string; learned: boolean; trying: string }> {
  const base = await imagePrompt(env.DB, code, styleId);
  if (!env.ANTHROPIC_API_KEY) return { prompt: base, learned: false, trying: '' };
  const [tags, winners, reasons] = await Promise.all([
    imageTagStats(env.DB),
    env.DB.prepare(
      `SELECT c.prompt, c.tags FROM creative_judgements j JOIN creative_candidates c ON c.id = j.winner_id
       WHERE j.kind = 'image' AND c.hook != 'real' AND c.prompt != '' GROUP BY c.id ORDER BY count(*) DESC LIMIT 3`,
    ).all<{ prompt: string; tags: string | null }>().then((r) => r.results),
    env.DB.prepare(`SELECT reason, count(*) AS n FROM creative_judgements WHERE kind = 'image' AND reason NOT IN ('', 'better') GROUP BY reason ORDER BY n DESC`).all<{ reason: string; n: number }>().then((r) => r.results),
  ]);
  const tagLines = tags.map((t) => `- ${IMAGE_TAGS[t.dim]?.label ?? t.dim}: ${t.label} — โพสต์จริง ${t.posts} โพสต์${t.roas !== null ? ` ROAS ${t.roas.toFixed(2)} ค่าแอด ${Math.round(t.spend)}` : ''} · ในห้อง ชนะ ${t.wins} แพ้ ${t.losses}`).join('\n');
  const out = await askClaude(env, 'คุณเขียน prompt ให้ ChatGPT ทำภาพโฆษณายีนส์ของร้านไทย จากสิ่งที่ร้านเรียนรู้มา', [
    { type: 'text', text: `prompt ตั้งต้น (ต้องคงกฎเรื่องห้ามเปลี่ยนสินค้าไว้เสมอ):\n${base}\n
## ภาพแบบไหนขายได้ (ป้ายภาพ × ROAS ของโพสต์ที่ยิงอยู่ ยอดแท็ก Meta 14 วัน; คุ้มทุน ~2.9) และชนะในห้องฝึก
${tagLines || '(ยังไม่มีข้อมูล)'}
## prompt ของภาพที่ชนะในห้องฝึก
${winners.map((w, i) => `${i + 1}. ${w.prompt.slice(0, 800)}`).join('\n') || '(ยังไม่มี)'}
## เหตุผลที่ภาพแพ้บ่อย
${reasons.map((r) => `- ${REASONS[r.reason] ?? r.reason}: ${r.n} ครั้ง`).join('\n') || '(ยังไม่มี)'}

เขียน prompt ใหม่ 1 อัน: ใช้สิ่งที่ขายได้/ชนะเป็นหลัก เลี่ยงสาเหตุที่แพ้ และเลือก "ลองของใหม่" 1 อย่างจากป้ายที่ข้อมูลยังน้อย (โพสต์จริง + ชนะ/แพ้รวมกันน้อยกว่า 5) เพื่อให้ร้านได้เรียนรู้ ห้ามตัดกฎห้ามเปลี่ยนสินค้า ภาษาไทย ไม่เกิน 12 บรรทัด
ตอบ JSON เท่านั้น: {"prompt": "<prompt>", "trying": "<สิ่งที่ลองใหม่รอบนี้ 1 บรรทัด>"}` },
  ], 6000, 'low').catch(() => null);
  const m = out ? /\{[\s\S]*\}/.exec(out.text) : null;
  try {
    const x = JSON.parse(m?.[0] ?? '');
    const prompt = cleanText(x.prompt, 4000);
    if (prompt.includes('ห้ามเปลี่ยน')) return { prompt, learned: true, trying: cleanText(x.trying, 300) };
  } catch { /* fall through to the template */ }
  return { prompt: base, learned: false, trying: '' };
}

/**
 * What the judges taught the checker: images the AI passed that judges then turned down for a product or text
 * problem, as notes for the next check (most recent 6).
 */
export async function checkerLessons(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare(
    `SELECT j.reason, l.ai_check FROM creative_judgements j
     JOIN creative_candidates l ON l.id = CASE WHEN j.winner_id = j.a_id THEN j.b_id ELSE j.a_id END
     WHERE j.kind = 'image' AND j.winner_id IS NOT NULL AND j.reason IN ('product_wrong', 'unreadable', 'fake', 'style_off') AND l.ai_check IS NOT NULL
     ORDER BY j.id DESC LIMIT 30`,
  ).all<{ reason: string; ai_check: string }>();
  return results.map((r) => ({ r, c: JSON.parse(r.ai_check) as ImageCheck }))
    .filter(({ c }) => c.verdict === 'pass').slice(0, 6)
    .map(({ r, c }) => `เคยให้ผ่าน (สินค้าตรง ${c.product_match}/10, ดูปลอม ${c.looks_fake}/10: "${c.summary}") แต่กรรมการตีตกเพราะ ${REASONS[r.reason] ?? r.reason}`);
}
