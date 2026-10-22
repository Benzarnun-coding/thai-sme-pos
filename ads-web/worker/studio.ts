// ห้องฝึก (docs/creative.md): materials the staff give the agents, caption generation with Claude, A/B judging.
// Nothing here touches Meta, Page365 or customers; the only outside call is the Anthropic API.

import { BadRequest } from './validate.ts';
import { imageType } from './catalog.ts';

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
  review: 'รีวิว/คนซื้อซ้ำ', scarcity: 'ของมีจำกัด/โปรหมดเร็ว', lifestyle: 'ใส่ไปไหน/ลุค', problem: 'ปัญหาที่ยีนส์เดิมมี',
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

/** Product codes with a name, price range and the staff's notes; the picture is the catalog's first uploaded/linked one. */
export async function listProducts(db: D1Database, q = ''): Promise<StudioProduct[]> {
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const { results } = await db.prepare(
    `SELECT c.code, min(c.name) AS name, min(c.price) AS price_min, max(c.price) AS price_max, count(*) AS skus,
            coalesce(n.selling_points, '') AS selling_points, coalesce(n.promo, '') AS promo,
            (SELECT key FROM catalog_images i WHERE i.spu = c.code OR i.spu LIKE c.code || '-%' LIMIT 1) AS image_key,
            (SELECT image FROM catalog ci WHERE ci.code = c.code AND ci.image != '' LIMIT 1) AS image_url
     FROM catalog c LEFT JOIN product_notes n ON n.code = c.code
     WHERE c.code != '' AND (?1 = '' OR c.code LIKE ?2 OR c.name LIKE ?2)
     GROUP BY c.code ORDER BY c.code LIMIT 300`,
  ).bind(q, like).all<StudioProduct>();
  return results;
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

export async function pictureResponse(db: D1Database, table: 'style_refs' | 'creative_candidates', id: number, size: 'thumb' | 'full'): Promise<Response> {
  const row = await db.prepare(`SELECT ${size} AS data, mime FROM ${table} WHERE id = ?`).bind(id).first<{ data: ArrayBuffer | null; mime: string | null }>();
  if (!row?.data || !row.mime) return new Response('not found', { status: 404 });
  return new Response(row.data, { headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=86400' } });
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

export interface Playbook { id: number | null; text: string; proposed_by: string; approved_by: string | null; created_at: string }

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
  const [playbook, examples, gold] = await Promise.all([currentPlaybook(db), listExamples(db), goldCaptions(db)]);
  const liked = examples.filter((e) => e.liked).slice(0, 10), disliked = examples.filter((e) => !e.liked).slice(0, 10);
  const system = [
    'คุณเขียนแคปชันโพสต์ขายยีนส์ให้ร้าน PK Jeans (ขายผ่านแชท Facebook ลูกค้าไทย) ตามคู่มือและตัวอย่างด้านล่างอย่างเคร่งครัด',
    '## คู่มือ', playbook.text,
    gold.length ? `## แคปชันที่ทีมอนุมัติแล้ว (เลียนแบบน้ำเสียงนี้)\n${gold.map((g) => `- [${g.hook}] ${g.text.replace(/\n/g, ' / ')}`).join('\n')}` : '',
    liked.length ? `## ตัวอย่างที่ทีมชอบ\n${liked.map((e) => `- "${e.text.replace(/\n/g, ' / ')}" — ชอบเพราะ: ${e.reason}`).join('\n')}` : '',
    disliked.length ? `## ตัวอย่างที่ทีมไม่ชอบ (อย่าทำแบบนี้)\n${disliked.map((e) => `- "${e.text.replace(/\n/g, ' / ')}" — เพราะ: ${e.reason}`).join('\n')}` : '',
    `## รูปแบบคำตอบ\nตอบเป็น JSON array เท่านั้น ไม่มีข้อความอื่น: [{"hook": "<หนึ่งใน ${Object.keys(HOOKS).join('|')}>", "text": "<แคปชัน>"}] แต่ละแคปชันใช้ hook ต่างกัน ห้ามใช้ตัวเลขราคา/ไซส์ที่ไม่ได้ให้มา`,
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
  return arr.map((x: any) => ({ hook: HOOKS[String(x?.hook)] ? String(x.hook) : 'lifestyle', text: cleanText(x?.text, 2000) })).filter((x) => x.text);
}

export async function generateCaptions(env: StudioEnv, code: string, n: number, user: string): Promise<{ batch: string; candidates: Candidate[]; tokens: { input: number; output: number } }> {
  if (!env.ANTHROPIC_API_KEY) throw new BadRequest('ยังไม่ได้ตั้ง ANTHROPIC_API_KEY');
  const product = (await listProducts(env.DB, code)).find((p) => p.code === code);
  if (!product) throw new BadRequest('ไม่พบรหัสสินค้านี้ในแคตตาล็อก');
  const count = Math.min(10, Math.max(2, n || 6));
  const p = await captionPrompt(env.DB, product, count);
  const model = env.STUDIO_AI_MODEL || 'claude-opus-5-5';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', ...(env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': env.ANTHROPIC_WORKSPACE_ID } : {}) },
    body: JSON.stringify({ model, max_tokens: 4000, output_config: { effort: 'medium' }, system: p.system, messages: [{ role: 'user', content: p.user }] }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`AI ${res.status}: ${body?.error?.message ?? res.statusText}`);
  const text = (body.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
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
  return { batch, candidates: results, tokens: { input: body.usage?.input_tokens ?? 0, output: body.usage?.output_tokens ?? 0 } };
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
  const [product, card] = await Promise.all([listProducts(db, code).then((l) => l.find((p) => p.code === code)), db.prepare('SELECT * FROM style_cards WHERE id = ?').bind(styleId).first<StyleCard>()]);
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
    `SELECT c.*, (SELECT count(*) FROM creative_judgements j WHERE j.a_id = c.id OR j.b_id = c.id) AS seen
     FROM creative_candidates c WHERE c.kind = ?1 AND c.status = 'open' AND (?2 = '' OR c.code = ?2) ORDER BY seen, c.id DESC LIMIT 60`,
  ).bind(kind, code ?? '').all<Candidate & { seen: number }>();
  const byCode = new Map<string, (Candidate & { seen: number })[]>();
  for (const c of results) byCode.set(c.code, [...(byCode.get(c.code) ?? []), c]);
  const { results: done } = await db.prepare('SELECT a_id, b_id FROM creative_judgements WHERE kind = ?1 AND judge = ?2').bind(kind, judge).all<{ a_id: number; b_id: number }>();
  const seenPair = new Set(done.map((d) => `${Math.min(d.a_id, d.b_id)}:${Math.max(d.a_id, d.b_id)}`));
  for (const list of byCode.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (!seenPair.has(`${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`)) return { a, b, same_product: true };
    }
  }
  return null;
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
  judges: { judge: string; n: number }[];
}

/** What the room has learned so far: win rate per hook, the reasons given, and how often two judges agree. */
export async function stats(db: D1Database): Promise<Stats> {
  // Today in Bangkok, as the UTC instant it started.
  const dayStart = new Date(`${new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)}T00:00:00+07:00`).toISOString();
  const [j, open, hooks, reasons, judges, pairs] = await Promise.all([
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
  ]);
  return {
    judged: j?.n ?? 0, today: j?.today ?? 0,
    open: { caption: open.results.find((r) => r.kind === 'caption')?.n ?? 0, image: open.results.find((r) => r.kind === 'image')?.n ?? 0 },
    hooks: hooks.results, reasons: reasons.results, judges: judges.results,
    agreement: { pairs: pairs.results.length, agreed: pairs.results.filter((p) => p.same).length },
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
