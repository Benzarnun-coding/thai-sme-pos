// Grok's door into the training room (Benz 2026-11-09). Grok can't log in through Cloudflare Access, so it uses
// /webhook/grok/* (Access bypasses /webhook) with its own key, the secret GROK_KEY. No key set = door closed.
//   GET  /webhook/grok/playbook?key=…  → the playbook the caption room uses now + the team's liked/disliked examples
//   POST /webhook/grok/playbook        → a new playbook draft (Authorization: Bearer …); it waits on /studio/posts
//                                        for an owner to press "ใช้คู่มือนี้", exactly like the AI analysis draft.
// Grok never changes the live playbook itself.

import { currentPlaybook, listExamples, type CaptionExample, type Playbook } from './studio.ts';

interface GrokEnv { DB: D1Database; GROK_KEY?: string }

const MAX_PER_DAY = 10;
const clean = (v: unknown, max: number) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);

/** Same length and same characters, compared without stopping early. */
export function keyOk(given: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || expected.length < 16 || !given || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export interface GrokProposal { playbook: string; findings: { point: string; evidence: string }[] }

/** Grok's JSON body → a draft, or a Thai reason it was refused. */
export function parseProposal(body: any): GrokProposal | string {
  const playbook = clean(body?.playbook, 6000);
  if (!playbook) return 'ต้องมี "playbook" (ข้อความคู่มือทั้งฉบับ)';
  const findings = (Array.isArray(body?.findings) ? body.findings : []).slice(0, 8)
    .map((f: any) => ({ point: clean(f?.point, 500), evidence: clean(f?.evidence, 500) }))
    .filter((f: { point: string }) => f.point);
  if (!findings.length) return 'ต้องมี "findings" อย่างน้อย 1 ข้อ แต่ละข้อมี point + evidence (ลิงก์โพสต์หรือแชตที่เป็นที่มา)';
  if (findings.some((f: { evidence: string }) => !f.evidence)) return 'ทุกข้อใน findings ต้องมี evidence — ไม่มีที่มาให้ตัดข้อนั้นทิ้ง';
  return { playbook, findings };
}

/** What Grok reads before every round: plain text, newest examples first. */
export function playbookText(p: Playbook, examples: CaptionExample[], origin: string): string {
  const ex = (liked: number) => examples.filter((e) => e.liked === liked).slice(0, 15)
    .map((e) => `- ${e.text.replace(/\n+/g, ' / ')}\n  เหตุผล: ${e.reason}`).join('\n') || '- (ยังไม่มี)';
  return [
    '# คู่มือเขียนแคปชันที่ห้องฝึก PK Jeans ใช้อยู่ตอนนี้',
    `ฉบับ: ${p.id ?? 'ค่าเริ่มต้น'}${p.created_at ? ` · อนุมัติ ${p.created_at.slice(0, 10)}` : ''}`,
    '',
    p.text,
    '',
    '## ตัวอย่างแคปชันที่ทีมชอบ (พร้อมเหตุผล)',
    ex(1),
    '',
    '## ตัวอย่างแคปชันที่ทีมไม่ชอบ (พร้อมเหตุผล)',
    ex(0),
    '',
    '## ส่งร่างคู่มือฉบับใหม่',
    `POST ${origin}/webhook/grok/playbook`,
    'Header: Authorization: Bearer <GROK_KEY> · Content-Type: application/json',
    'Body: {"playbook": "<คู่มือทั้งฉบับ ไม่เกิน 6000 ตัวอักษร>", "findings": [{"point": "<สิ่งที่เรียนรู้ 1 ข้อ>", "evidence": "<ลิงก์โพสต์/แชตที่เป็นที่มา>"}]}',
    'ร่างจะรอเจ้าของกด "ใช้คู่มือนี้" ก่อนใช้จริง · ห้ามแต่งตัวเลข ทุกข้อต้องมีที่มา',
  ].join('\n');
}

const text = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function grokRoute(req: Request, env: GrokEnv, url: URL): Promise<Response> {
  if (url.pathname !== '/webhook/grok/playbook') return text('Not found', 404);
  if (!env.GROK_KEY) return text('ยังไม่ได้เปิดให้ Grok ใช้ (ต้องตั้ง secret GROK_KEY ก่อน)', 503);
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1]?.trim();
  if (!keyOk(bearer ?? url.searchParams.get('key'), env.GROK_KEY)) return text('key ไม่ถูกต้อง', 401);

  if (req.method === 'GET') {
    const [p, examples] = await Promise.all([currentPlaybook(env.DB), listExamples(env.DB)]);
    return text(playbookText(p, examples, url.origin));
  }
  if (req.method !== 'POST') return text('method not allowed', 405);
  // Writes only with the key in the header: a key in a link can end up in logs or chat history.
  if (!bearer) return text('การส่งร่างต้องใส่ key ใน header Authorization: Bearer … ไม่ใช่ในลิงก์', 401);
  const parsed = parseProposal(await req.json().catch(() => null));
  if (typeof parsed === 'string') return text(parsed, 400);
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const n = await env.DB.prepare(`SELECT count(*) n FROM playbook_versions WHERE proposed_by = 'grok' AND created_at > ?1`).bind(since).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_PER_DAY) return text(`ส่งร่างได้ไม่เกิน ${MAX_PER_DAY} ครั้งต่อวัน`, 429);
  const r = await env.DB.prepare(`INSERT INTO playbook_versions (text, proposed_by, approved_by, created_at, note) VALUES (?1, 'grok', NULL, ?2, ?3)`)
    .bind(parsed.playbook, new Date().toISOString(), JSON.stringify({ findings: parsed.findings, source: 'grok' })).run();
  const id = Number(r.meta.last_row_id);
  await env.DB.prepare('INSERT INTO audit (at, actor, action, target, detail) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(new Date().toISOString(), 'grok', 'studio.playbook.grok', String(id), JSON.stringify({ findings: parsed.findings.length })).run();
  return text(`รับร่างคู่มือฉบับ ${id} แล้ว รอเจ้าของกด "ใช้คู่มือนี้" ที่ ${url.origin}/studio/posts`);
}
