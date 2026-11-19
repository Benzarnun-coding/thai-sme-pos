// ตัวแทน (Benz 2026-11-19): when a model is sold out, Max sets another model to ship in its place
// ("801/1 → 501/5"). Admins keep writing 801/1 in the order note; the Page365 fill (p365fill.ts) puts 501/5 on
// the bill: its SKU, stock and bill-name warehouse, but the price of 801/1 (what the customer bought). The cost
// follows by itself: the Page365 export then carries 501/5's SKU, so every page costs it as 501/5.

/** "801-1", " 801/1 " → "801/1": how a code is stored and looked up. */
export function subKey(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '').replace(/-/g, '/');
}

const CODE = /^[A-Z0-9]{1,8}(?:\/[A-Z0-9]{1,6}){0,3}$/;

export interface Substitute { code: string; sub: string; note: string | null; created_by: string; created_at: string }

/** code → substitute code, both as typed on the page (upper case). */
export async function loadSubstitutes(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db.prepare('SELECT code, sub FROM substitutes').all<{ code: string; sub: string }>();
  return new Map(results.map((r) => [r.code, r.sub]));
}

export async function listSubstitutes(db: D1Database): Promise<Substitute[]> {
  const { results } = await db.prepare('SELECT code, sub, note, created_by, created_at FROM substitutes ORDER BY created_at DESC').all<Substitute>();
  return results;
}

/** Checks one pair from the page; returns it normalised, or the reason it can't be saved. */
export function checkSubstitute(code: unknown, sub: unknown): { code: string; sub: string } | { error: string } {
  const c = subKey(String(code ?? ''));
  const s = subKey(String(sub ?? ''));
  if (!c || !s) return { error: 'ใส่ทั้งรุ่นที่หมดและรุ่นที่ใช้แทน' };
  if (!CODE.test(c) || !CODE.test(s)) return { error: 'รหัสรุ่นไม่ถูกต้อง (ตัวอย่าง 801/1, 501/5)' };
  if (c === s) return { error: 'รุ่นที่หมดกับรุ่นที่ใช้แทนเป็นตัวเดียวกัน' };
  return { code: c, sub: s };
}

/** Saves a pair. Refuses chains (801/1 → 501/5 while 501/5 → … is set) so a bill always gets one known model. */
export async function saveSubstitute(db: D1Database, by: string, code: unknown, sub: unknown, note: unknown): Promise<{ code: string; sub: string }> {
  const ok = checkSubstitute(code, sub);
  if ('error' in ok) throw new Error(ok.error);
  const all = await loadSubstitutes(db);
  if (all.has(ok.sub)) throw new Error(`${ok.sub} เองก็ตั้งให้ใช้ ${all.get(ok.sub)} แทนอยู่ — ลบอันนั้นก่อน หรือตั้ง ${ok.code} → ${all.get(ok.sub)} ตรงๆ`);
  const usedBy = [...all].find(([, s]) => s === ok.code);
  if (usedBy) throw new Error(`${usedBy[0]} ใช้ ${ok.code} แทนอยู่ — ${ok.code} เลยตั้งให้มีตัวแทนอีกทอดไม่ได้`);
  const n = typeof note === 'string' ? note.trim().slice(0, 200) || null : null;
  await db.prepare(`INSERT INTO substitutes (code, sub, note, created_by, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET sub = excluded.sub, note = excluded.note, created_by = excluded.created_by, created_at = excluded.created_at`)
    .bind(ok.code, ok.sub, n, by, new Date().toISOString()).run();
  return ok;
}

export async function deleteSubstitute(db: D1Database, code: unknown): Promise<boolean> {
  const r = await db.prepare('DELETE FROM substitutes WHERE code = ?').bind(subKey(String(code ?? ''))).run();
  return (r.meta.changes ?? 0) > 0;
}
