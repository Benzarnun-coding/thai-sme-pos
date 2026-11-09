// From training room to a real test ad, by itself (Benz 2026-11-09: "ทำภาพ เขียนแคปชั่น เปิดแอด แล้วทดลองเอง",
// ad names carry "(Grok)", 50 baht, 14 days). docs/creative.md "(Grok) test ads".
//   1. Images: Grok has ChatGPT (Max's account) make them from the room's prompt and adds them on /studio/train
//      (file or link). Each is checked by the AI on upload, as before.
//   2. aiJudgeImages: the AI judge decides image pairs of one product, blind, against the real product photo.
//   3. autoSets: a product with a passed caption and a passed image gets a post set; approved by itself when the
//      AI finds caption and picture agree (same product, same price/promo).
//   4. proposeStep: each approved set is proposed in #studio-training (picture, caption, Max tagged, ✅/❌).
//      Nothing reaches Meta until Max (or Benz) presses ✅ (Benz 2026-11-09: "ให้แมคกดอนุมัติ"). launchSet then builds
//      "<template campaign> (Grok)": a copy of the product's best running campaign (campaign only), a new ad set built
//      from that ad's ad set settings, one new ad (the set's picture + caption on the first running ad's creative
//      that has a spec), 100/day for 14 days; at most MAX_ACTIVE at once and never over the shop-wide cap.
//   5. stopExpired: after 14 days the campaign is paused and its 14-day numbers are reported.
// Never touches a campaign it didn't create; the rules engine leaves these alone (no stage).

import { AD_RULES, REASONS, askClaude, createSet, currentPlaybook, decideSet, imageBlock, listProducts, passedFor, productPhoto, readyProducts, judge, type StudioEnv } from './studio.ts';
import { AI_JUDGE } from './playbookTrial.ts';

export const MAX_ACTIVE = 9;

export interface StudioAds { budget: number; days: number; max_active: number }
const DEFAULTS: StudioAds = { budget: 50, days: 14, max_active: 9 };

export async function loadStudioAds(db: D1Database): Promise<StudioAds> {
  const v = await db.prepare(`SELECT value FROM settings WHERE key = 'studio_ads'`).first<{ value: string }>();
  return { ...DEFAULTS, ...(v ? JSON.parse(v.value) : {}) };
}

export async function saveStudioAds(db: D1Database, patch: Partial<StudioAds>): Promise<StudioAds> {
  const cur = await loadStudioAds(db);
  const next: StudioAds = {
    budget: Math.min(500, Math.max(50, Number(patch.budget ?? cur.budget) || 100)),
    days: Math.min(30, Math.max(3, Number(patch.days ?? cur.days) || 14)),
    max_active: Math.min(10, Math.max(1, Number(patch.max_active ?? cur.max_active) || MAX_ACTIVE)),
  };
  await db.prepare(`INSERT INTO settings (key, value) VALUES ('studio_ads', ?1) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(next)).run();
  return next;
}

// ---- 2. the AI judges image pairs ----

type Img = { id: number; code: string; full: ArrayBuffer | number[] | null; mime: string | null };

/** Image pairs of one product the AI judge hasn't decided; newest images first, at most n. */
export function imagePairs(imgs: { id: number; code: string }[], seen: Set<string>, n: number): [number, number][] {
  const byCode = new Map<string, number[]>();
  for (const i of [...imgs].sort((a, b) => b.id - a.id)) byCode.set(i.code, [...(byCode.get(i.code) ?? []), i.id]);
  const out: [number, number][] = [];
  for (const ids of byCode.values()) {
    for (let x = 0; x < ids.length && out.length < n; x++) for (let y = x + 1; y < ids.length && out.length < n; y++) {
      const key = `${Math.min(ids[x], ids[y])}:${Math.max(ids[x], ids[y])}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([ids[x], ids[y]]);
    }
  }
  return out;
}

export function parseImageVerdict(text: string): { winner: 'A' | 'B'; reason: string; why: string } | null {
  const m = /\{[\s\S]*\}/.exec(text);
  try {
    const x = JSON.parse(m?.[0] ?? '');
    const winner = String(x?.winner).trim().toUpperCase();
    if (winner !== 'A' && winner !== 'B') return null;
    const reason = ['product_wrong', 'unreadable', 'style_off', 'fake', 'better'].includes(String(x?.reason)) ? String(x.reason) : 'better';
    return { winner, reason, why: String(x?.why ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) };
  } catch { return null; }
}

/** Up to `calls` image pairs, one Claude call each (pictures are big): the real product photo, then A and B. */
export async function aiJudgeImages(env: StudioEnv, calls = 3): Promise<number> {
  const { results: imgs } = await env.DB.prepare(`SELECT id, code FROM creative_candidates WHERE kind = 'image' AND status = 'open'`).all<{ id: number; code: string }>();
  const { results: done } = await env.DB.prepare(`SELECT a_id, b_id FROM creative_judgements WHERE kind = 'image' AND judge = ?1`).bind(AI_JUDGE).all<{ a_id: number; b_id: number }>();
  const pairs = imagePairs(imgs, new Set(done.map((d) => `${Math.min(d.a_id, d.b_id)}:${Math.max(d.a_id, d.b_id)}`)), calls);
  let n = 0;
  for (const [x, y] of pairs) {
    const [a, b] = Math.random() < 0.5 ? [x, y] : [y, x];
    const rows = await env.DB.prepare('SELECT id, code, full, mime FROM creative_candidates WHERE id IN (?1, ?2)').bind(a, b).all<Img>();
    const A = rows.results.find((r) => r.id === a), B = rows.results.find((r) => r.id === b);
    if (!A?.full || !A.mime || !B?.full || !B.mime) continue;
    const photo = await productPhoto(env.DB, A.code).catch(() => null);
    const content: unknown[] = [];
    if (photo) content.push({ type: 'text', text: 'รูปสินค้าจริง (ใช้เทียบว่าภาพโฆษณาไม่เปลี่ยนสินค้า):' }, imageBlock(photo.data, photo.mime));
    content.push({ type: 'text', text: 'ภาพ A:' }, imageBlock(A.full, A.mime), { type: 'text', text: 'ภาพ B:' }, imageBlock(B.full, B.mime), {
      type: 'text',
      text: `ภาพโฆษณา Facebook ของร้านยีนส์ไทย (สินค้า ${A.code}) อันไหนน่าจะทำให้คนหยุดดูและทักแชทซื้อมากกว่า สินค้าในภาพต้องตรงกับของจริง (สี ทรง ตะเข็บ) ราคาบนภาพต้องอ่านออก ห้ามมีอีโมจิไฟ 🔥 ตอบ JSON เท่านั้น: {"winner": "A"|"B", "reason": "<เหตุที่อีกภาพแพ้: product_wrong|unreadable|style_off|fake|better>", "why": "<1 ประโยคภาษาไทย อันที่ชนะทำอะไรที่อีกอันไม่ทำ>"}`,
    });
    const out = await askClaude(env, 'คุณเป็นกรรมการตัดสินภาพโฆษณา ตอบตามสิ่งที่เห็นเท่านั้น', content, 2000, 'low');
    const v = parseImageVerdict(out.text);
    if (!v) continue;
    await judge(env.DB, { a_id: a, b_id: b, winner_id: v.winner === 'A' ? a : b, reason: REASONS[v.reason] ? v.reason : 'better', note: v.why || null }, AI_JUDGE);
    n++;
  }
  return n;
}

// ---- 3. post sets by themselves ----

/**
 * New images (made for the room, never a picture of a current ad) that are in no set yet and that the AI check did not
 * fail, best A/B record first. Benz 2026-11-09 (6 more posts): every such image becomes a post; the ad decides, not
 * the room's A/B, so an image needs no win first.
 */
export async function freshImages(db: D1Database): Promise<{ id: number; code: string; ai_check: string | null }[]> {
  const { results } = await db.prepare(
    `SELECT c.id, c.code, c.ai_check,
            (SELECT count(*) FROM creative_judgements j WHERE j.winner_id = c.id) - (SELECT count(*) FROM creative_judgements j WHERE j.winner_id IS NOT NULL AND j.winner_id != c.id AND c.id IN (j.a_id, j.b_id)) AS score
     FROM creative_candidates c
     WHERE c.kind = 'image' AND c.status = 'open' AND c.hook != 'real' AND c.full IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM creative_sets s WHERE s.image_id = c.id AND s.status != 'rejected')
     ORDER BY score DESC, c.id`,
  ).all<{ id: number; code: string; ai_check: string | null; score: number }>();
  return results.filter((r) => !r.ai_check || (JSON.parse(r.ai_check).verdict !== 'fail' && JSON.parse(r.ai_check).ad_gate?.pass !== false)).map((r) => ({ id: r.id, code: r.code, ai_check: r.ai_check }));
}

/**
 * One post set per fresh image: the product's best passed caption not used in another set yet (else its best one),
 * checked against the picture; on a clash the caption is rewritten once from the picture and checked again.
 * Approved by itself when picture and caption agree.
 */
export function parseGate(text: string): { pass: boolean; why: string } | null {
  const m = /\{[\s\S]*\}/.exec(text);
  try { const x = JSON.parse(m?.[0] ?? ''); return { pass: x.pass === true, why: String(x.why ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) }; } catch { return null; }
}

/**
 * Would this picture sell, by the shop's rules (AD_RULES: worn by a person, price readable, colours, bottom bar)?
 * Benz rejected a folded-jeans picture the product check had passed (2026-11-09). Stored in ai_check.ad_gate so a
 * picture is judged once; a failed one is never proposed.
 */
export async function adGate(env: StudioEnv, imageId: number, promo: string): Promise<{ pass: boolean; why: string } | null> {
  const img = await env.DB.prepare('SELECT full, mime, ai_check FROM creative_candidates WHERE id = ?1').bind(imageId).first<{ full: ArrayBuffer | number[] | null; mime: string | null; ai_check: string | null }>();
  if (!img?.full || !img.mime) return null;
  const out = await askClaude(env, 'คุณคัดภาพโฆษณา Facebook ของร้านยีนส์ไทยก่อนลงแอด เข้มงวด ตอบตามสิ่งที่เห็นเท่านั้น', [
    imageBlock(img.full, img.mime),
    { type: 'text', text: `ภาพนี้ผ่านเกณฑ์ภาพโฆษณาของร้านไหม (ต้องผ่านทุกข้อหลัก):\n${AD_RULES}\n- มีราคาบนภาพ อ่านออกชัด${promo ? ` และตรงกับโปร "${promo}"` : ''}\n- ไม่มีอีโมจิไฟ 🔥\nข้อหลักที่ห้ามพลาด: มีคนใส่กางเกง และมีราคาอ่านออก ตอบ JSON เท่านั้น: {"pass": true/false, "why": "<1 ประโยคภาษาไทย ถ้าไม่ผ่านบอกว่าขาดอะไร>"}` },
  ], 1500, 'low');
  const g = parseGate(out.text);
  if (!g) return null;
  const cur = img.ai_check ? JSON.parse(img.ai_check) : {};
  await env.DB.prepare('UPDATE creative_candidates SET ai_check = ?2 WHERE id = ?1').bind(imageId, JSON.stringify({ ...cur, ad_gate: g })).run();
  return g;
}

export async function autoSets(env: StudioEnv, _days: number, limit = 2): Promise<{ code: string; set_id: number; approved: boolean }[]> {
  const out: { code: string; set_id: number; approved: boolean }[] = [];
  for (const img of await freshImages(env.DB)) {
    if (out.length >= limit) break;
    if (!(img.ai_check && JSON.parse(img.ai_check).ad_gate?.pass)) {
      const product = (await listProducts(env.DB, img.code, true))[0];
      const g = await adGate(env, img.id, product?.promo ?? '').catch(() => null);
      if (!g?.pass) continue;
    }
    const p = await passedFor(env.DB, img.code);
    if (!p.captions.length) continue;
    const used = new Set((await env.DB.prepare(`SELECT caption_id FROM creative_sets WHERE code = ?1 AND status != 'rejected'`).bind(img.code).all<{ caption_id: number }>()).results.map((r) => r.caption_id));
    const caption = p.captions.find((c) => !used.has(c.id)) ?? p.captions[0];
    let set = await createSet(env, { caption_id: caption.id, image_id: img.id }, 'auto');
    let check = set.ai_note ? JSON.parse(set.ai_note) as { match: boolean; issues: string } : null;
    // One rewrite when the check found a clash (price/promo/model on the picture): the issues go back to the writer.
    if (check && !check.match) {
      const fixed = await captionForPicture(env, img.code, img.id, { text: set.caption_text, issues: check.issues }).catch(() => null);
      if (fixed) {
        await decideSet(env.DB, set.id, 'rejected', 'auto (แก้แคปชันแล้วตรวจใหม่)');
        set = await createSet(env, { caption_id: fixed, image_id: img.id }, 'auto');
        check = set.ai_note ? JSON.parse(set.ai_note) : null;
      }
    }
    if (check?.match) await decideSet(env.DB, set.id, 'approved', 'auto (AI ตรวจว่าภาพกับแคปชันตรงกัน)');
    else if (set.status !== 'rejected') await decideSet(env.DB, set.id, 'rejected', 'auto (ภาพกับแคปชันยังไม่ตรงกันหลังแก้ 1 รอบ)');
    out.push({ code: img.code, set_id: set.id, approved: !!check?.match });
  }
  return out;
}

/**
 * A caption written for one picture: Claude reads the picture (price, promo, colours, model printed on it) and writes
 * one caption in the live playbook's style that says the same. Stored as an AI caption candidate (hook 'price').
 */
export async function captionForPicture(env: StudioEnv, code: string, imageId: number, fix?: { text: string; issues: string }): Promise<number | null> {
  const [img, product, playbook] = await Promise.all([
    env.DB.prepare('SELECT full, mime FROM creative_candidates WHERE id = ?1').bind(imageId).first<{ full: ArrayBuffer | number[] | null; mime: string | null }>(),
    listProducts(env.DB, code, true).then((r) => r[0]),
    currentPlaybook(env.DB),
  ]);
  if (!img?.full || !img.mime || !product) return null;
  const out = await askClaude(env, `คุณเขียนแคปชันโพสต์ขายยีนส์ให้ร้าน PK Jeans ตามคู่มือนี้อย่างเคร่งครัด\n## คู่มือ\n${playbook.text}`, [
    imageBlock(img.full, img.mime),
    { type: 'text', text: `นี่คือภาพโฆษณาที่จะใช้ (สินค้า ${product.code} ${product.name}) เขียนแคปชัน 1 อันที่ตรงกับสิ่งที่เขียนบนภาพทุกอย่าง: รุ่น ผ้า สี ราคา โปร เงื่อนไข ใช้เฉพาะตัวเลขที่เห็นบนภาพ และเขียนเงื่อนไขโปรให้ตรงกับบนภาพคำต่อคำ (เช่น จำกัดกี่ตัว ราคาปกติ ส่งฟรีหรือไม่) ถ้าภาพไม่มีราคาให้ใช้: ${product.promo || 'ไม่ระบุราคา'} ห้ามใช้ 🔥${fix ? `\nแคปชันก่อนหน้าโดนตีกลับ:\n${fix.text}\nปัญหาที่ต้องแก้: ${fix.issues}` : ''} ตอบ JSON เท่านั้น: {"text": "<แคปชัน>"}` },
  ], 3000, 'medium');
  const m = /\{[\s\S]*\}/.exec(out.text);
  let text = '';
  try { text = String(JSON.parse(m?.[0] ?? '').text ?? '').trim().slice(0, 2000); } catch { return null; }
  if (!text) return null;
  const r = await env.DB.prepare(
    `INSERT INTO creative_candidates (kind, code, product_name, promo, hook, text, prompt, playbook_id, batch, created_by, created_at)
     VALUES ('caption', ?1, ?2, ?3, 'price', ?4, ?5, ?6, ?7, 'ai', ?8)`,
  ).bind(code, product.name, product.promo, text, `written for picture #${imageId}`, playbook.id, crypto.randomUUID(), new Date().toISOString()).run();
  return Number(r.meta.last_row_id);
}

// ---- 4. approved set → proposal in #studio-training → Max presses → "(Grok)" campaign ----

export interface GrokMeta {
  adTemplate(adId: string): Promise<{ name: string; adset_id: string; campaign_id: string; spec: any | null }>;
  copyCampaignOnly(campaignId: string, suffix: string): Promise<string>;
  campaignHasBudget(campaignId: string): Promise<boolean>;
  createAdsetFrom(templateAdsetId: string, campaignId: string, name: string, dailyBudget: number | null): Promise<string>;
  uploadImage(base64: string): Promise<string>;
  createCreative(name: string, spec: unknown): Promise<string>;
  createAd(adsetId: string, name: string, creativeId: string, status: 'ACTIVE' | 'PAUSED'): Promise<string>;
  rename(id: string, name: string): Promise<void>;
  setDailyBudget(id: string, amount: number): Promise<void>;
  setStatus(id: string, status: 'ACTIVE' | 'PAUSED'): Promise<void>;
}

/** The template ad's creative with the set's caption and picture; refuses a creative built from an existing post. */
export function buildSpec(template: any, message: string, imageHash: string): any {
  if (!template || typeof template !== 'object') throw new Error('แอดต้นแบบไม่มี object_story_spec (สร้างจากโพสต์เดิม) — ใช้เป็นต้นแบบไม่ได้');
  const spec = JSON.parse(JSON.stringify(template));
  if (spec.link_data) {
    const l = spec.link_data;
    delete l.picture; delete l.image_url; delete l.child_attachments; delete l.multi_share_optimized; delete l.multi_share_end_card;
    l.message = message; l.image_hash = imageHash;
  } else if (spec.photo_data) {
    const p = spec.photo_data;
    delete p.url; delete p.image_url;
    p.caption = message; p.image_hash = imageHash;
  } else {
    throw new Error('แอดต้นแบบไม่ใช่แอดภาพ (link_data / photo_data) — ใช้เป็นต้นแบบไม่ได้');
  }
  delete spec.video_data;
  return spec;
}

/**
 * Ads whose creative may serve as the template for the new ad's creative: this product's first, then any running
 * ad, most spend first. Ads made from an existing page post have no spec, so the first one with a spec is used
 * (Benz's 801/3 ad was post-based, 2026-11-09).
 */
async function creativeCandidates(db: D1Database, code: string, limit = 8): Promise<string[]> {
  const { results } = await db.prepare(`SELECT code, ads FROM meta_posts WHERE active = 1 ORDER BY (code = ?1) DESC, spend DESC LIMIT 20`).bind(code).all<{ code: string; ads: string }>();
  const ids: string[] = [];
  for (const r of results) for (const a of JSON.parse(r.ads) as { ad_id: string; campaign_name: string }[]) if (!/\(Grok\)/.test(a.campaign_name) && !ids.includes(a.ad_id)) ids.push(a.ad_id);
  return ids.slice(0, limit);
}

/** The product's running ad with the most spend (from /studio/posts), the template for a new "(Grok)" ad. */
export async function templateAd(db: D1Database, code: string): Promise<{ ad_id: string; campaign_name: string } | null> {
  const p = await db.prepare(`SELECT ads FROM meta_posts WHERE active = 1 AND code = ?1 ORDER BY spend DESC LIMIT 1`).bind(code).first<{ ads: string }>();
  const ads = p ? (JSON.parse(p.ads) as { ad_id: string; campaign_name: string }[]).filter((a) => !/\(Grok\)/.test(a.campaign_name)) : [];
  return ads[0] ? { ad_id: ads[0].ad_id, campaign_name: ads[0].campaign_name } : null;
}

const toBase64 = (data: ArrayBuffer | number[]) => {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export interface ProposeEnv extends StudioEnv { DISCORD_BOT_TOKEN?: string; DISCORD_STUDIO_CHANNEL_ID?: string; DISCORD_DECIDER_IDS?: string }

export function proposalText(s: { id: number; code: string; caption_text: string; real_image?: boolean }, t: { campaign_name: string } | null, cfg: StudioAds, mention: string): string {
  return [
    `📣 ${mention ? `${mention} ` : ''}**เสนอลงโพสต์ใหม่ + เทสแอด** สินค้า **${s.code}** (ชุด#${s.id} จากห้องฝึก ผ่าน AI กรรมการแล้ว)`,
    t ? `กดอนุมัติแล้วระบบจะ: คัดลอกชุดโฆษณาจากแคม "${t.campaign_name}" (แอดของ ${s.code} ที่ใช้เงินมากสุด) เป็นแคมใหม่ "${t.campaign_name} ชุด#${s.id} (Grok)" · แอดใหม่ "${s.code} ชุด#${s.id} (Grok)" · งบ **${cfg.budget} บาท/วัน** · **${cfg.days} วัน** แล้วหยุดเอง และสรุปผลในห้องนี้`
      : `⚠️ ยังไม่มีแอดที่ยิงอยู่ของ ${s.code} ให้ใช้เป็นต้นแบบ กดอนุมัติแล้วจะยังสร้างไม่ได้`,
    '🖼 ภาพใหม่ (ทำใน ChatGPT ผ่าน AI กรรมการ) + แคปชันใหม่จากห้องฝึก',
    '**แคปชัน:**', s.caption_text.slice(0, 1200),
  ].join('\n').slice(0, 1990);
}

export const proposalButtons = (setId: number) => [{ type: 1, components: [
  { type: 2, style: 3, label: '✅ อนุมัติ ลงเลย', custom_id: `grokad:${setId}:yes` },
  { type: 2, style: 4, label: '❌ ไม่ลง', custom_id: `grokad:${setId}:no` },
] }];

/** Approved sets nobody was asked about yet: one message each (picture attached, Max tagged, two buttons). */
export async function proposeStep(env: ProposeEnv, cfg: StudioAds, limit = 2): Promise<number> {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_STUDIO_CHANNEL_ID) return 0;
  const { results: sets } = await env.DB.prepare(
    `SELECT s.id, s.code, s.caption_text, s.image_id, c.hook = 'real' AS real_image FROM creative_sets s LEFT JOIN grok_ads g ON g.set_id = s.id
     JOIN creative_candidates c ON c.id = s.image_id
     WHERE s.status = 'approved' AND g.set_id IS NULL AND c.hook != 'real' ORDER BY s.id LIMIT ?1`,
  ).bind(limit).all<{ id: number; code: string; caption_text: string; image_id: number; real_image: number }>();
  const mention = (env.DISCORD_DECIDER_IDS ?? '').split(',').map((x) => x.trim()).filter(Boolean).map((id) => `<@${id}>`).join(' ');
  let n = 0;
  for (const s of sets) {
    const t = await templateAd(env.DB, s.code);
    const img = await env.DB.prepare('SELECT full, mime FROM creative_candidates WHERE id = ?1').bind(s.image_id).first<{ full: ArrayBuffer | number[] | null; mime: string | null }>();
    const form = new FormData();
    form.set('payload_json', JSON.stringify({ content: proposalText({ ...s, real_image: !!s.real_image }, t, cfg, mention), components: proposalButtons(s.id), allowed_mentions: { users: mention ? (env.DISCORD_DECIDER_IDS ?? '').split(',').map((x) => x.trim()).filter(Boolean) : [] } }));
    if (img?.full) form.set('files[0]', new Blob([img.full instanceof ArrayBuffer ? img.full : Uint8Array.from(img.full)], { type: img.mime || 'image/jpeg' }), `set-${s.id}.jpg`);
    const res = await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_STUDIO_CHANNEL_ID}/messages`, { method: 'POST', headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }, body: form });
    if (!res.ok) { console.error('grok proposal', res.status, await res.text()); break; }
    const msg = (await res.json()) as { id: string };
    await env.DB.prepare(`INSERT INTO grok_ads (set_id, code, status, template_ad_id, budget, message_id, announced_at) VALUES (?1, ?2, 'proposed', ?3, ?4, ?5, ?6) ON CONFLICT (set_id) DO NOTHING`)
      .bind(s.id, s.code, t?.ad_id ?? null, cfg.budget, msg.id, new Date().toISOString()).run();
    n++;
  }
  return n;
}

export interface LaunchResult { ok: boolean; text: string }

/** Builds the "(Grok)" campaign for one set after Max's approval (≈ 8 Meta calls). Half-made objects stay PAUSED. */
export async function launchSet(env: StudioEnv, meta: GrokMeta, cfg: StudioAds, setId: number, budgetRoom: number): Promise<LaunchResult> {
  const s = await env.DB.prepare(`SELECT id, code, caption_text, image_id FROM creative_sets WHERE id = ?1`).bind(setId).first<{ id: number; code: string; caption_text: string; image_id: number }>();
  if (!s) return { ok: false, text: 'ไม่พบชุดโพสต์นี้' };
  const fail = async (err: string): Promise<LaunchResult> => {
    await env.DB.prepare(`UPDATE grok_ads SET status = 'failed', error = ?2 WHERE set_id = ?1`).bind(setId, err.slice(0, 500)).run();
    return { ok: false, text: err };
  };
  const running = (await env.DB.prepare(`SELECT count(*) n FROM grok_ads WHERE status = 'running'`).first<{ n: number }>())?.n ?? 0;
  if (running >= cfg.max_active) return fail(`มีแคม (Grok) เปิดอยู่ครบ ${cfg.max_active} แล้ว รอตัวเก่าครบ ${cfg.days} วันก่อน`);
  if (budgetRoom < cfg.budget) return fail(`งบรวมจะเกินเพดานที่ตั้งไว้ (เหลือ ${Math.round(budgetRoom)} บาท) ขยายเพดานในหน้าตั้งค่าก่อน`);
  const t = await templateAd(env.DB, s.code);
  if (!t) return fail(`ยังไม่มีแอดที่ยิงอยู่ของ ${s.code} ให้ใช้เป็นต้นแบบ`);
  const name = `${s.code} ชุด#${s.id} (Grok)`;
  let campaign: string | null = null;
  try {
    const tpl = await meta.adTemplate(t.ad_id); // the product's ad set (audience, optimisation) comes from here
    // The creative template: this ad if it has a spec, else the next running ad that has one.
    let spec = tpl.spec;
    if (!spec) for (const id of await creativeCandidates(env.DB, s.code)) { if (id === t.ad_id) continue; spec = (await meta.adTemplate(id).catch(() => null))?.spec ?? null; if (spec) break; }
    buildSpec(spec, s.caption_text, 'check'); // refuse before anything is created
    const img = await env.DB.prepare('SELECT full FROM creative_candidates WHERE id = ?1').bind(s.image_id).first<{ full: ArrayBuffer | number[] | null }>();
    if (!img?.full) throw new Error('ไม่พบไฟล์ภาพของชุดนี้');
    const hash = await meta.uploadImage(toBase64(img.full));
    campaign = await meta.copyCampaignOnly(tpl.campaign_id, ` ชุด#${s.id} (Grok)`); // one campaign per post, still ending "(Grok)"
    // CBO: the campaign carries the 100; ABO: the new ad set does.
    const cbo = await meta.campaignHasBudget(campaign);
    if (cbo) await meta.setDailyBudget(campaign, cfg.budget);
    const adset = await meta.createAdsetFrom(tpl.adset_id, campaign, name, cbo ? null : cfg.budget);
    const creative = await meta.createCreative(name, buildSpec(spec, s.caption_text, hash));
    const ad = await meta.createAd(adset, name, creative, 'ACTIVE');
    await meta.setStatus(adset, 'ACTIVE');
    await meta.setStatus(campaign, 'ACTIVE');
    const now = new Date(), ends = new Date(now.getTime() + cfg.days * 86_400_000).toISOString();
    await env.DB.prepare(`UPDATE grok_ads SET status = 'running', template_ad_id = ?2, campaign_id = ?3, adset_id = ?4, ad_id = ?5, budget = ?6, launched_at = ?7, ends_at = ?8, error = NULL WHERE set_id = ?1`)
      .bind(setId, t.ad_id, campaign, adset, ad, cfg.budget, now.toISOString(), ends).run();
    return { ok: true, text: `เปิดแล้ว: แคม "${t.campaign_name} ชุด#${s.id} (Grok)" · แอด "${name}" · ${cfg.budget} บาท/วัน · ถึง ${ends.slice(0, 10)} แล้วหยุดเอง` };
  } catch (err: any) {
    if (campaign) await meta.setStatus(campaign, 'PAUSED').catch(() => null);
    return fail(`${err?.message ?? err}${campaign ? ` (แคมที่สร้างค้างไว้ ${campaign} หยุดอยู่ ลบได้ใน Ads Manager)` : ''}`);
  }
}

// ---- 5. after 14 days ----

export interface StopNote { set_id: number; code: string; text: string }

/** Pauses "(Grok)" campaigns past their end and stores their numbers (Meta, last 14 days; Meta-tagged sales). */
export async function stopExpired(env: StudioEnv, meta: GrokMeta | null, stats: Map<string, { spend: number; purchases: number; purchase_value: number }> | null): Promise<StopNote[]> {
  const { results } = await env.DB.prepare(`SELECT set_id, code, campaign_id FROM grok_ads WHERE status = 'running' AND ends_at <= ?1`).bind(new Date().toISOString()).all<{ set_id: number; code: string; campaign_id: string }>();
  const out: StopNote[] = [];
  for (const g of results) {
    if (!meta) break;
    await meta.setStatus(g.campaign_id, 'PAUSED');
    const m = stats?.get(g.campaign_id);
    const result = m ? { spend: Math.round(m.spend), purchases: m.purchases, value: Math.round(m.purchase_value), roas: m.spend ? Math.round((m.purchase_value / m.spend) * 100) / 100 : 0 } : null;
    await env.DB.prepare(`UPDATE grok_ads SET status = 'done', result = ?2 WHERE set_id = ?1`).bind(g.set_id, result ? JSON.stringify(result) : null).run();
    out.push({ set_id: g.set_id, code: g.code, text: result ? `ครบกำหนด หยุดแล้ว: ค่าแอด ${result.spend} · ซื้อ ${result.purchases} · ยอด ${result.value} · ROAS ${result.roas} (ยอดแท็ก Meta)` : 'ครบกำหนด หยุดแล้ว (อ่านตัวเลขไม่ได้)' });
  }
  return out;
}

export async function listGrokAds(db: D1Database) {
  return (await db.prepare(`SELECT * FROM grok_ads ORDER BY set_id DESC LIMIT 50`).all()).results;
}

/** Takes a proposal back (it was wrong to ask): status withdrawn; the caller edits the Discord message. */
export async function withdraw(db: D1Database, setId: number, who: string): Promise<string | null> {
  const r = await db.prepare(`UPDATE grok_ads SET status = 'withdrawn', decided_by = ?2 WHERE set_id = ?1 AND status IN ('proposed', 'failed') RETURNING message_id`).bind(setId, who).first<{ message_id: string | null }>();
  return r ? r.message_id ?? '' : null;
}

/** "(Grok)" ads that ran, with their caption, picture and result: what Grok reads on /studio before the next round. */
export async function grokResults(db: D1Database) {
  return (await db.prepare(
    `SELECT g.set_id, g.code, g.status, g.launched_at, g.ends_at, g.result, g.campaign_id, s.caption_text, s.image_id, c.hook = 'real' AS old_picture
     FROM grok_ads g JOIN creative_sets s ON s.id = g.set_id JOIN creative_candidates c ON c.id = s.image_id
     WHERE g.status IN ('running', 'done') ORDER BY g.launched_at DESC LIMIT 30`,
  ).all()).results;
}
