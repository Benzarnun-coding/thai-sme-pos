// What the real "(Grok)" test ads taught (Benz 2026-11-26, full loop item 3: real results back into the room).
// Every test ad is one post set = one picture (its task key: offer3 / back / … in creative_candidates.hook) and one
// caption (its hook: price / promo_math / …). Its verdict comes from Page365 orders credited to the campaign, the same
// rule that makes a "winner" for the task list (≥ 3 real orders, real ROAS ≥ break-even), so the room, the task list
// and the caption writer all learn from what really sold, not from what an AI judge liked.

export interface TestAd {
  set_id: number; code: string; status: string;
  image_key: string; caption_key: string;
  spend: number; real_orders: number; real_value: number;
}
export type Outcome = 'win' | 'lose' | 'open';
export const WIN = { orders: 3 };

/** win = sold for real; lose = it ended (stopped / done / paused by the rules) without that; open = still running. */
export function outcome(t: TestAd, breakeven: number): Outcome {
  const roas = t.spend > 0 ? t.real_value / t.spend : 0;
  if (t.status === 'graduated' || (t.real_orders >= WIN.orders && roas >= breakeven)) return 'win';
  return t.status === 'running' ? 'open' : 'lose';
}

export interface KeyResult { key: string; label: string; tests: number; wins: number; losses: number; open: number; spend: number; orders: number; value: number; roas: number | null }

/** Per key (picture task or caption hook): wins / losses / still running, with the real ROAS of all its tests together. */
export function summarize(tests: TestAd[], keyOf: (t: TestAd) => string, labels: Record<string, string>, breakeven: number): KeyResult[] {
  const by = new Map<string, KeyResult>();
  for (const t of tests) {
    const key = keyOf(t);
    const r = by.get(key) ?? { key, label: labels[key] ?? key, tests: 0, wins: 0, losses: 0, open: 0, spend: 0, orders: 0, value: 0, roas: null };
    const o = outcome(t, breakeven);
    r.tests++; if (o === 'win') r.wins++; else if (o === 'lose') r.losses++; else r.open++;
    r.spend += t.spend; r.orders += t.real_orders; r.value += t.real_value;
    by.set(key, r);
  }
  return [...by.values()].map((r) => ({ ...r, spend: Math.round(r.spend), value: Math.round(r.value), roas: r.spend > 0 ? Math.round((r.value / r.spend) * 100) / 100 : null }))
    .sort((a, b) => score(b) - score(a) || b.tests - a.tests);
}

/** Win share with one imagined win and one imagined loss added, so 1 test out of 1 doesn't outrank 3 out of 4. */
export const score = (r: { wins: number; losses: number }) => (r.wins + 1) / (r.wins + r.losses + 2);
/** Lost at least this often and never won → not tried again. */
export const DEAD_LOSSES = 2;
export const isDead = (r: { wins: number; losses: number }) => r.wins === 0 && r.losses >= DEAD_LOSSES;

/** One line per key, for prompts and the /studio card. */
export function lessonLines(rows: KeyResult[]): string[] {
  return rows.map((r) => {
    const verdict = isDead(r) ? ' → แพ้ทุกครั้ง ไม่ใช้อีก' : r.wins > 0 && r.wins >= r.losses ? ' → ใช้ได้ ทำต่อ' : '';
    return `- ${r.label}: ชนะ ${r.wins} แพ้ ${r.losses}${r.open ? ` กำลังทดสอบ ${r.open}` : ''} · ${r.orders} ออเดอร์จริง${r.roas !== null ? ` ROAS จริง ${r.roas.toFixed(2)}` : ''} (ค่าแอด ${r.spend.toLocaleString('en-US')})${verdict}`;
  });
}

export const IMAGE_LABELS_EXTRA: Record<string, string> = { '': 'ภาพใหม่ (ก่อนมีรายการงาน)', real: 'ภาพจากแอดที่ยิงอยู่', untagged: 'ภาพใหม่ (ก่อนมีรายการงาน)' };

export interface Lessons {
  breakeven: number; tests: number; decided: number;
  images: KeyResult[]; captions: KeyResult[];
  image_lines: string[]; caption_lines: string[];
}

/** Every test ad that ran, with the numbers it ended on (`result`) or its latest hourly review. */
export async function loadTests(db: D1Database): Promise<TestAd[]> {
  const { results } = await db.prepare(
    `SELECT g.set_id, g.code, g.status, coalesce(i.hook, '') AS image_key, coalesce(c.hook, '') AS caption_key, coalesce(g.result, g.review) AS nums
     FROM grok_ads g JOIN creative_sets s ON s.id = g.set_id
     LEFT JOIN creative_candidates i ON i.id = s.image_id LEFT JOIN creative_candidates c ON c.id = s.caption_id
     WHERE g.status IN ('running', 'graduated', 'done', 'stopped')`,
  ).all<{ set_id: number; code: string; status: string; image_key: string; caption_key: string; nums: string | null }>();
  return results.map((r) => {
    let n: any = {};
    try { n = JSON.parse(r.nums ?? '{}') ?? {}; } catch { /* no numbers yet */ }
    return { set_id: r.set_id, code: r.code, status: r.status, image_key: r.image_key, caption_key: r.caption_key, spend: Number(n.spend) || 0, real_orders: Number(n.real_orders) || 0, real_value: Number(n.real_value) || 0 };
  });
}

/** `breakeven` = the shop's (run.ts shopBreakeven); null → 2.9, the same fallback the task list uses. */
export function lessonsFrom(tests: TestAd[], breakeven: number | null, imageLabels: Record<string, string>, captionLabels: Record<string, string>): Lessons {
  const be = breakeven ?? 2.9;
  const images = summarize(tests, (t) => t.image_key, { ...IMAGE_LABELS_EXTRA, ...imageLabels }, be);
  const captions = summarize(tests, (t) => t.caption_key || 'unknown', captionLabels, be);
  return { breakeven: be, tests: tests.length, decided: tests.filter((t) => outcome(t, be) !== 'open').length, images, captions, image_lines: lessonLines(images), caption_lines: lessonLines(captions) };
}

/** Loads the tests and the shop's break-even (run.ts, imported lazily: it imports most of the worker). */
export async function loadLessons(db: D1Database, imageLabels: Record<string, string>, captionLabels: Record<string, string>, breakeven?: number | null): Promise<Lessons> {
  let be = breakeven;
  if (be === undefined) {
    const [{ shopBreakeven }, { loadSettings }] = await Promise.all([import('./run.ts'), import('./db.ts')]);
    be = await shopBreakeven(db, await loadSettings(db), new Date()).catch(() => null);
  }
  return lessonsFrom(await loadTests(db), be, imageLabels, captionLabels);
}

/** The prompt section: empty until a test has ended, so nothing is claimed from no data. */
export function lessonsPrompt(lines: string[], what: 'caption' | 'image', decided: number): string {
  if (!decided || !lines.length) return '';
  const head = what === 'caption'
    ? '## ผลจากแอดทดสอบจริง แยกตามแนวแคปชัน (ยอดขายจริง Page365 ไม่ใช่ยอดแท็ก Meta)\nเชื่อข้อนี้มากกว่าความเห็นอื่น: แนวที่ชนะให้ใช้เป็นหลัก แนวที่ "แพ้ทุกครั้ง" อย่าใช้ ข้อมูลยังน้อย อย่าสรุปเกินตัวเลข'
    : '## ผลจากแอดทดสอบจริง แยกตามแบบภาพ (ยอดขายจริง Page365 ไม่ใช่ยอดแท็ก Meta)\nเชื่อข้อนี้มากกว่าป้ายภาพ: แบบที่ชนะให้ใช้เป็นหลัก แบบที่ "แพ้ทุกครั้ง" อย่าใช้ ข้อมูลยังน้อย อย่าสรุปเกินตัวเลข';
  return `${head}\n${lines.join('\n')}`;
}
