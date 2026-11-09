// Playbook trial (Benz 2026-11-09, docs/creative.md): a new caption playbook — from Grok, the team or the AI — is
// saved as a draft and has to beat the live one before it is used, so the loop closes without anyone approving it.
//   1. "ทดสอบก่อนใช้" on /studio saves the draft (trial = running, base_id = the live version).
//   2. The room writes captions for the products running as ads, PER_SIDE with the draft and PER_SIDE with the live
//      playbook (one Claude call per step: the training room page loops, the 3-hourly sweep does one step as backup).
//   3. Judges get draft-vs-live pairs first (nextPair in studio.ts), blind like every pair.
//   4. At TRIAL_PAIRS decided pairs: draft won >= TRIAL_WIN → it goes live by itself; else it is set aside. Either way
//      a note goes to Discord. "ย้อนกลับฉบับก่อน" on /studio puts the previous version back.
// Nothing here leaves the room: no Meta, no customers.

import { DEFAULT_PLAYBOOK, currentPlaybook, generateCaptions, recommendedProducts, stopTrials, type Playbook, type StudioEnv } from './studio.ts';
import { BadRequest } from './validate.ts';

export const TRIAL_PAIRS = 20;
export const TRIAL_WIN = 0.55;
export const TRIAL_PRODUCTS = 4;
export const PER_SIDE = 5;

export interface TrialStatus {
  id: number; text: string; proposed_by: string; created_at: string; base_id: number | null;
  pairs: number; wins: number; need: number; win_at: number;
  /** products the trial uses, with how many open captions each side has */
  products: { code: string; draft: number; live: number }[];
  ready: boolean;
}

export async function runningTrial(db: D1Database): Promise<Playbook | null> {
  return db.prepare(`SELECT * FROM playbook_versions WHERE trial = 'running' ORDER BY id DESC LIMIT 1`).first<Playbook>();
}

export async function startTrial(db: D1Database, input: any, user: string): Promise<number> {
  const text = String(input?.text ?? '').replace(/\r/g, '').trim().slice(0, 6000);
  if (!text) throw new BadRequest('คู่มือว่างเปล่า');
  if (await runningTrial(db)) throw new BadRequest('มีร่างกำลังทดสอบอยู่ — รอผล หรือกด "หยุดทดสอบ" ก่อน');
  const live = await currentPlaybook(db);
  if (text === live.text.trim()) throw new BadRequest('ร่างนี้เหมือนคู่มือที่ใช้อยู่ — แก้ก่อนแล้วค่อยทดสอบ');
  const r = await db.prepare(`INSERT INTO playbook_versions (text, proposed_by, approved_by, created_at, trial, base_id) VALUES (?1, ?2, NULL, ?3, 'running', ?4)`)
    .bind(text, user, new Date().toISOString(), live.id).run();
  return Number(r.meta.last_row_id);
}

/** Decided draft-vs-live pairs and how many the draft won (every judge's vote counts). */
export async function trialScore(db: D1Database, t: { id: number | null; base_id?: number | null }): Promise<{ pairs: number; wins: number }> {
  const r = await db.prepare(
    `SELECT count(*) AS pairs, coalesce(sum(w.playbook_id = ?1), 0) AS wins FROM creative_judgements j
     JOIN creative_candidates a ON a.id = j.a_id JOIN creative_candidates b ON b.id = j.b_id JOIN creative_candidates w ON w.id = j.winner_id
     WHERE j.kind = 'caption' AND j.winner_id IS NOT NULL
       AND ((a.playbook_id = ?1 AND b.playbook_id IS ?2 AND b.hook != 'real' AND b.created_by = 'ai')
         OR (b.playbook_id = ?1 AND a.playbook_id IS ?2 AND a.hook != 'real' AND a.created_by = 'ai'))`,
  ).bind(t.id, t.base_id ?? null).first<{ pairs: number; wins: number }>();
  return { pairs: r?.pairs ?? 0, wins: r?.wins ?? 0 };
}

/** won / lost once enough pairs are in, else null. */
export function verdict(pairs: number, wins: number, need = TRIAL_PAIRS, winAt = TRIAL_WIN): 'won' | 'lost' | null {
  if (pairs < need) return null;
  return wins / pairs >= winAt ? 'won' : 'lost';
}

async function trialProducts(db: D1Database, t: Playbook): Promise<{ code: string; draft: number; live: number }[]> {
  const products = await recommendedProducts(db, TRIAL_PRODUCTS);
  if (!products.length) return [];
  const { results } = await db.prepare(
    `SELECT code, sum(playbook_id = ?1) AS draft, sum(playbook_id IS ?2 AND hook != 'real' AND created_by = 'ai') AS live
     FROM creative_candidates WHERE kind = 'caption' AND status = 'open' AND code IN (SELECT value FROM json_each(?3)) GROUP BY code`,
  ).bind(t.id, t.base_id ?? null, JSON.stringify(products.map((p) => p.code))).all<{ code: string; draft: number; live: number }>();
  return products.map((p) => { const r = results.find((x) => x.code === p.code); return { code: p.code, draft: r?.draft ?? 0, live: r?.live ?? 0 }; });
}

export async function trialStatus(db: D1Database): Promise<TrialStatus | null> {
  const t = await runningTrial(db);
  if (!t || t.id === null) return null;
  const [score, products] = await Promise.all([trialScore(db, t), trialProducts(db, t)]);
  return {
    id: t.id, text: t.text, proposed_by: t.proposed_by, created_at: t.created_at, base_id: t.base_id ?? null, ...score,
    need: TRIAL_PAIRS, win_at: TRIAL_WIN, products, ready: products.length > 0 && products.every((p) => p.draft >= PER_SIDE && p.live >= PER_SIDE),
  };
}

/**
 * One preparation step: the first product short of captions on either side gets 6 from that side's playbook.
 * Returns what it made, or done when every product has enough (or there are no products running as ads).
 */
export async function trialStep(env: StudioEnv, user: string): Promise<{ done: boolean; made?: { code: string; side: 'draft' | 'live'; n: number }; error?: string; tokens?: { input: number; output: number } }> {
  const t = await runningTrial(env.DB);
  if (!t || t.id === null) return { done: true };
  const products = await trialProducts(env.DB, t);
  if (!products.length) return { done: true, error: 'ยังไม่มีสินค้าที่ยิงแอดอยู่ — ไปที่วัตถุดิบ › โพสต์ที่ยิงอยู่ แล้วกด "ดึงโพสต์จากเพจ" ก่อน' };
  const p = products.find((x) => x.draft < PER_SIDE || x.live < PER_SIDE);
  if (!p) return { done: true };
  const side = p.draft < PER_SIDE ? 'draft' : 'live';
  // The live side writes with the version the draft is tested against, even if it is the built-in default.
  const live = await currentPlaybook(env.DB);
  const use: Playbook = side === 'draft' ? t : live;
  const r = await generateCaptions(env, p.code, 6, user, use);
  return { done: false, made: { code: p.code, side, n: r.candidates.length }, tokens: r.tokens };
}

export interface TrialResult { id: number; result: 'won' | 'lost'; pairs: number; wins: number }

/** After a judgement: settle the running trial if it has enough pairs. The draft goes live only if it won. */
export async function checkTrial(db: D1Database): Promise<TrialResult | null> {
  const t = await runningTrial(db);
  if (!t || t.id === null) return null;
  const score = await trialScore(db, t);
  const v = verdict(score.pairs, score.wins);
  if (!v) return null;
  const result = JSON.stringify(score);
  const r = v === 'won'
    ? await db.prepare(`UPDATE playbook_versions SET trial = 'won', trial_result = ?2, approved_by = 'ทดสอบชนะ' WHERE id = ?1 AND trial = 'running'`).bind(t.id, result).run()
    : await db.prepare(`UPDATE playbook_versions SET trial = 'lost', trial_result = ?2 WHERE id = ?1 AND trial = 'running'`).bind(t.id, result).run();
  if (!r.meta.changes) return null; // another request settled it first
  return { id: t.id, result: v, ...score };
}

export function trialMessage(r: TrialResult, origin: string): string {
  const pct = Math.round((r.wins / r.pairs) * 100);
  return r.result === 'won'
    ? `🧪 คู่มือแคปชันฉบับใหม่ (#${r.id}) **ชนะ** ฉบับเดิม ${r.wins}/${r.pairs} คู่ (${pct}%) ในห้องฝึก — ใช้ฉบับใหม่แล้วอัตโนมัติ\nไม่ชอบ: ${origin}/studio กด "ย้อนกลับฉบับก่อน"`
    : `🧪 คู่มือแคปชันฉบับใหม่ (#${r.id}) **แพ้** ฉบับเดิม ชนะแค่ ${r.wins}/${r.pairs} คู่ (${pct}%, ต้อง ≥ ${Math.round(TRIAL_WIN * 100)}%) — ใช้ฉบับเดิมต่อ\nดูเหตุผลที่กรรมการให้ได้ที่ ${origin}/studio/train`;
}

export async function stopTrial(db: D1Database): Promise<void> {
  await stopTrials(db);
}

/** Puts the version before the live one back, as a new version (so the history stays in order). */
export async function undoPlaybook(db: D1Database, user: string): Promise<number> {
  const live = await currentPlaybook(db);
  if (live.id === null) throw new BadRequest('ยังใช้ค่าตั้งต้นอยู่ ไม่มีฉบับก่อนหน้า');
  const prev = await db.prepare('SELECT text FROM playbook_versions WHERE approved_by IS NOT NULL AND id < ?1 AND text != ?2 ORDER BY id DESC LIMIT 1').bind(live.id, live.text).first<{ text: string }>();
  const text = prev?.text ?? (live.text !== DEFAULT_PLAYBOOK ? DEFAULT_PLAYBOOK : null);
  if (!text) throw new BadRequest('ไม่มีฉบับก่อนหน้า');
  const r = await db.prepare('INSERT INTO playbook_versions (text, proposed_by, approved_by, created_at) VALUES (?1, ?2, ?2, ?3)').bind(text, `ย้อนกลับ (${user})`, new Date().toISOString()).run();
  await stopTrials(db);
  return Number(r.meta.last_row_id);
}
