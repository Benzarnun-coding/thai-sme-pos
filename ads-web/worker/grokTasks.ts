// The task list on "งานวันนี้ของ Grok" (Benz 2026-11-12: Grok is told what to make by the site, from real data, so
// its own prompt never changes). Every picture tests one thing:
//   - exploit (~70% of free slots): a test ad that really sells (≥ 3 Page365 orders, real ROAS ≥ break-even) is the
//     control; the new picture changes ONE variable not tried for that product yet;
//   - explore (the rest): a product running as ads that the room has no picture for, in the format that sells.
// The picture is uploaded with the task's key (creative_candidates.hook), so results can be read per variable.

export const VARIABLES: { key: string; label: string; text: string }[] = [
  { key: 'offer3', label: 'แพ็ก 3 ตัวเด่น', text: 'ให้ราคาแพ็ก 3 ตัวใหญ่และเด่นที่สุดบนภาพ ราคา 1 ตัวเล็กไว้ข้างล่าง' },
  { key: 'offer1', label: 'ราคา 1 ตัวเด่น', text: 'ให้ราคา 1 ตัวใหญ่และเด่นที่สุด พร้อมคำว่า "เฉพาะคนที่เห็นโพสต์นี้" ราคา 3 ตัวเล็กไว้ข้างล่าง' },
  { key: 'back', label: 'มุมหันหลัง', text: 'นายแบบหันหลัง โชว์กระเป๋าหลังและป้าย เรียง 2–3 สีพร้อมชื่อสี' },
  { key: 'front', label: 'มุมด้านหน้า', text: 'นายแบบหันหน้า ครอปเอวลง มือล้วงกระเป๋า เรียง 2–3 สีพร้อมชื่อสี' },
  { key: 'single', label: 'คนเดียวเต็มตัว', text: 'นายแบบคนเดียว เห็นเต็มตัว สีที่ขายดีสุดสีเดียว พื้นหลังเรียบ ราคาใหญ่' },
];
export const NEW_KEY = 'new';
export const TASK_LABEL: Record<string, string> = { ...Object.fromEntries(VARIABLES.map((v) => [v.key, v.label])), [NEW_KEY]: 'สินค้าใหม่' };

export interface Winner { code: string; set_id: number; roas: number }
export interface Task { n: number; code: string; key: string; base_set: number | null; text: string }

/** `tried`: per product code (lower case), the task keys already made. */
export function planTasks(i: { free: number; winners: Winner[]; tried: Map<string, Set<string>>; explore: { code: string; promo: string }[]; promos: Map<string, string> }): Task[] {
  const out: Omit<Task, 'n'>[] = [];
  if (i.free <= 0) return [];
  const lc = (x: string) => x.toLowerCase();
  const promo = (code: string) => { const p = i.promos.get(lc(code)); return p ? ` · ราคาบนภาพ: ${p}` : ' · ราคา: ใช้ตามช่องโปรในเว็บ ถ้าว่างให้ถามแม็กซ์ก่อน'; };
  // one winner per product: its best set
  const best = new Map<string, Winner>();
  for (const w of [...i.winners].sort((a, b) => b.roas - a.roas)) if (!best.has(lc(w.code))) best.set(lc(w.code), w);
  const winners = [...best.values()];
  const used = new Map([...i.tried].map(([k, v]) => [k, new Set(v)]));
  const exploit = (limit: number) => {
    for (let round = 0; round < VARIABLES.length && out.length < limit; round++) {
      let any = false;
      for (const w of winners) {
        if (out.length >= limit) break;
        const seen = used.get(lc(w.code)) ?? new Set<string>();
        const v = VARIABLES.find((x) => !seen.has(x.key));
        if (!v) continue;
        seen.add(v.key); used.set(lc(w.code), seen); any = true;
        out.push({ code: w.code, key: v.key, base_set: w.set_id, text: `ตัวตั้ง: ชุด#${w.set_id} (ROAS จริง ${w.roas.toFixed(1)}) — เปลี่ยนอย่างเดียว: ${v.text}${promo(w.code)}` });
      }
      if (!any) break;
    }
  };
  const explore = (limit: number) => {
    for (const p of i.explore) {
      if (out.length >= limit) break;
      if (best.has(lc(p.code)) || (used.get(lc(p.code))?.size ?? 0) > 0) continue;
      used.set(lc(p.code), new Set([NEW_KEY]));
      out.push({ code: p.code, key: NEW_KEY, base_set: null, text: `สินค้าที่ห้องฝึกยังไม่เคยทำภาพ — ใช้รูปแบบที่ขายดี: นายแบบหันหลัง 2–3 สีเรียงกัน ราคาตามโปรตัวใหญ่ (ถ้าโปรมีแพ็ก 3 ตัว ให้แพ็ก 3 ตัวเด่น)${promo(p.code)}` });
    }
  };
  exploit(winners.length ? Math.ceil(i.free * 0.7) : 0);
  explore(i.free);
  exploit(i.free); // explore ran out: the rest goes to the winners' untried variables
  return out.map((t, n) => ({ n: n + 1, ...t }));
}

/** Winners from the 3-hourly review stored on each test ad (real Page365 orders). */
export async function loadTaskInputs(db: D1Database, breakeven: number | null): Promise<{ winners: Winner[]; tried: Map<string, Set<string>> }> {
  const be = breakeven ?? 2.9;
  const { results: ads } = await db.prepare(`SELECT set_id, code, review FROM grok_ads WHERE status IN ('running', 'graduated', 'done') AND review IS NOT NULL`).all<{ set_id: number; code: string; review: string }>();
  const winners: Winner[] = [];
  for (const a of ads) {
    const r = JSON.parse(a.review) as { spend?: number; real_orders?: number; real_value?: number };
    const roas = r.spend ? (r.real_value ?? 0) / r.spend : 0;
    if ((r.real_orders ?? 0) >= 3 && roas >= be) winners.push({ code: a.code, set_id: a.set_id, roas });
  }
  const tried = new Map<string, Set<string>>();
  const add = (code: string, key: string) => { const k = code.toLowerCase(); tried.set(k, (tried.get(k) ?? new Set()).add(key)); };
  const { results: imgs } = await db.prepare(`SELECT code, hook FROM creative_candidates WHERE kind = 'image' AND hook != 'real'`).all<{ code: string; hook: string }>();
  for (const x of imgs) add(x.code, x.hook || 'untagged');
  return { winners, tried };
}
