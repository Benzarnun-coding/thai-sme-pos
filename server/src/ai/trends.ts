/**
 * Trends → directives.
 *
 * A trend is something happening now that the owner might want the AI team to
 * act on: a product taking off, a competitor angle, a shopping day coming up, a
 * post that outperformed. Each trend comes with a suggested Thai instruction
 * and the boxes it should go to. A directive is that instruction once the owner
 * saves it (edited or not); it is injected into the prompt of every targeted
 * box until it expires or is marked done.
 */
import type { Db } from '../db/client.js';
import { buildProductSignals, type ProductSignal } from '../signals/build.js';
import { loadCompetitors, loadPosts } from './context.js';
import { runAgent } from './jobs.js';
import { AGENT_BY_SLUG } from './catalog.js';
import type { RunRow } from './agents.js';

export type TrendKind = 'rising' | 'falling' | 'overstock' | 'competitor' | 'season' | 'post';
export interface Trend {
  id: string;
  kind: TrendKind;
  title: string;
  detail: string;
  suggestion: string;       // a directive in plain Thai, ready to send
  targets: string[];        // default agent slugs
  score: number;            // sort key, bigger first
}
export type DirectiveSource = 'trend' | 'competitor' | 'season' | 'post' | 'manual';
export interface Directive {
  id: number; store_id: string; title: string; text: string; source: DirectiveSource; targets: string[];
  status: 'active' | 'done' | 'archived'; created_at: string; expires_at: string | null; by: string | null;
}

const HOOK_NAME: Record<string, string> = {
  bogo: '1 แถม 1', set_price: 'ราคาเซ็ต', single_price: 'ราคาเดี่ยวถูก', proof: 'รีวิว/หลักฐาน', wholesale: 'ขายส่ง', service: 'บริการเลือกไซส์', free_ship: 'ส่งฟรี', story: 'เรื่องเล่า',
};
const pct = (v: number | null) => (v === null ? '—' : (v >= 0 ? '+' : '') + v + '%');

/** Shopping moments a Thai page plans around: pay day and the monthly double day, plus fixed holidays. */
export function seasonTrends(today = new Date()): Trend[] {
  const out: Trend[] = [];
  const y = today.getFullYear(), m = today.getMonth();
  const daysTo = (d: Date) => Math.ceil((d.getTime() - today.getTime()) / 86400000);
  const add = (id: string, name: string, date: Date, suggestion: string, extra = '') => {
    const n = daysTo(date);
    if (n < 0 || n > 14) return;
    out.push({
      id, kind: 'season', title: n === 0 ? `${name} วันนี้` : `${name} อีก ${n} วัน`,
      detail: `${date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}${extra ? ' · ' + extra : ''}`,
      suggestion, targets: ['strategist', 'copywriter', 'campaign'], score: 80 - n,
    });
  };
  // the monthly double day (9.9, 10.10 …) this month and next
  for (const mm of [m, m + 1]) {
    const d = new Date(y, mm, mm + 1);
    if (d.getMonth() === mm % 12) add(`dd-${mm + 1}`, `แคมเปญ ${mm + 1}.${mm + 1}`, d, `เตรียมโพสต์และแอดรับวัน ${mm + 1}.${mm + 1}: ชูราคาเซ็ตของสินค้าที่พร้อมไซส์ ลงล่วงหน้า 2 วัน คุมงบไม่เกินเพดาน`, 'ลูกค้ารอซื้อวันนี้');
  }
  // pay day window
  const pay = new Date(y, m, 25);
  if (daysTo(pay) < 0) pay.setMonth(m + 1);
  add('payday', 'เงินเดือนออก', pay, 'ช่วงเงินเดือนออก 25-31: ดันสินค้าขายดีที่พร้อมไซส์ ชูเซ็ต 3 ตัว เพิ่มงบแอดตัวที่ ฿/ทัก ดีสุดไม่เกิน +30%', 'ยอดทักมักขึ้นช่วงนี้');
  // fixed days
  const fixed: [number, number, string, string][] = [
    [0, 1, 'ปีใหม่', 'โพสต์สวัสดีปีใหม่พร้อมเซ็ตของขวัญ ราคาเซ็ตชัด ๆ'],
    [3, 13, 'สงกรานต์', 'ก่อนสงกรานต์คนซื้อกางเกงกลับบ้าน: ชูขาสั้น/ผ้ายืดใส่สบาย ส่งให้ทันก่อนหยุดยาว'],
    [7, 12, 'วันแม่', 'มุมซื้อให้พ่อ/แม่: ยีนส์ใส่สบาย ไซส์ใหญ่มีครบ'],
    [11, 5, 'วันพ่อ', 'มุมซื้อให้พ่อ: ยีนส์ทรงกระบอก ไซส์ 36-44 มีครบ เก็บเงินปลายทาง'],
  ];
  for (const [mm, dd, name, sug] of fixed) {
    const d = new Date(y, mm, dd); if (daysTo(d) < 0) d.setFullYear(y + 1);
    add(`fixed-${mm}-${dd}`, name, d, sug);
  }
  return out;
}

export async function buildTrends(db: Db, storeId: string, today = new Date()): Promise<Trend[]> {
  const [signals, competitors, posts] = await Promise.all([buildProductSignals(db, storeId), loadCompetitors(db, storeId), loadPosts(db, storeId)]);
  return [...productTrends(signals), ...competitorTrends(competitors, today), ...postTrends(posts), ...seasonTrends(today)]
    .sort((a, b) => b.score - a.score);
}

export function productTrends(signals: ProductSignal[]): Trend[] {
  const out: Trend[] = [];
  for (const s of signals) {
    const t = s.trend_pct ?? 0;
    if (t >= 15 && s.sales_7d >= 10) {
      out.push({
        id: `rising-${s.product_id}`, kind: 'rising', title: `${s.name} กำลังมา ${pct(t)}`,
        detail: `ขาย 7 วัน ${s.sales_7d} ตัว (สัปดาห์ก่อน ${s.sales_prev_7d}) · สต็อก ${s.stock_total} · ${s.promotable ? 'พร้อมไซส์' : 'ห้ามโฆษณา: ' + s.note}`,
        suggestion: s.promotable
          ? `ดัน ${s.name} สัปดาห์นี้: ยอดขึ้น ${pct(t)} ให้เขียนโพสต์ 2 แบบ${s.set_price ? ` ชูเซ็ต ${s.set_price.qty} ตัว ${s.set_price.price}` : ''} และตั้งแอดทดสอบงบเล็ก 3 วัน`
          : `${s.name} กำลังมาแต่${s.note} — ห้ามโฆษณาจนกว่าจะเติมไซส์ แจ้งให้เติมสต็อกก่อน`,
        targets: s.promotable ? ['strategist', 'copywriter', 'campaign'] : ['strategist'], score: 60 + Math.min(30, t),
      });
    } else if (t <= -20 && s.sales_prev_7d >= 10) {
      out.push({
        id: `falling-${s.product_id}`, kind: 'falling', title: `${s.name} ตก ${pct(t)}`,
        detail: `ขาย 7 วัน ${s.sales_7d} ตัว (สัปดาห์ก่อน ${s.sales_prev_7d})`,
        suggestion: `${s.name} ยอดตก ${pct(t)}: ตรวจว่าแอดของตัวนี้ยังคุ้มไหม ถ้า ROAS ต่ำกว่า 1.5 ให้เสนอพักแล้วย้ายงบไปตัวที่กำลังมา`,
        targets: ['analyst', 'campaign'], score: 50 + Math.min(25, -t / 2),
      });
    }
    if (s.overstock && s.promotable) {
      out.push({
        id: `over-${s.product_id}`, kind: 'overstock', title: `${s.name} เหลือเยอะ`,
        detail: `สต็อก ${s.stock_total} ตัว ≈ ${s.days_of_cover ?? '—'} วัน`,
        suggestion: `ล้างสต็อก ${s.name}: เหลือ ${s.stock_total} ตัว ให้เสนอ${s.set_price ? `เซ็ต ${s.set_price.qty} ตัว ${s.set_price.price}` : 'ราคาเซ็ตพิเศษ'} ลงแอดงบเล็ก 3 วัน ไม่ลดราคาเดี่ยว`,
        targets: ['strategist', 'copywriter'], score: 40,
      });
    }
  }
  return out;
}

export function competitorTrends(rows: { page_name: string; hook: string | null; first_seen: string; price_hint: number | null }[], today = new Date()): Trend[] {
  const recent = rows.filter((c) => (today.getTime() - new Date(c.first_seen).getTime()) < 14 * 86400000);
  const byHook = new Map<string, Set<string>>();
  for (const c of recent) { const h = c.hook ?? 'other'; if (!byHook.has(h)) byHook.set(h, new Set()); byHook.get(h)!.add(c.page_name); }
  const out: Trend[] = [];
  for (const [hook, pages] of byHook) {
    if (pages.size < 2 && !['bogo', 'single_price'].includes(hook)) continue;
    const price = hook === 'single_price' ? recent.filter((c) => c.hook === hook && c.price_hint).sort((a, b) => a.price_hint! - b.price_hint!)[0]?.price_hint : null;
    const war = hook === 'bogo' || hook === 'single_price';
    out.push({
      id: `comp-${hook}`, kind: 'competitor', title: `คู่แข่ง ${pages.size} เพจเล่น "${HOOK_NAME[hook] ?? hook}"`,
      detail: `${[...pages].join(', ')}${price ? ` · ถูกสุด ${price}.-` : ''} · 14 วันล่าสุด`,
      suggestion: war
        ? `คู่แข่งกำลังเล่น${HOOK_NAME[hook]}${price ? ` ที่ ${price}.-` : ''}: อย่าสู้ราคาเดี่ยว ให้ชูราคาเซ็ตเมื่อคิดต่อตัว + ไซส์ 28-44 ครบ + เคลมได้ ในโพสต์และแอดทุกชิ้นสัปดาห์นี้`
        : `คู่แข่งใช้มุม "${HOOK_NAME[hook] ?? hook}" หลายเพจ: หามุมที่เขายังไม่เล่น (รีวิวลูกค้าจริง / เรื่องเล่าโรงงาน) มาใช้ในโพสต์ถัดไป`,
      targets: ['scout', 'strategist', 'copywriter'], score: (war ? 55 : 35) + pages.size * 3,
    });
  }
  return out;
}

export function postTrends(posts: { external_post_id: string; message: string | null; reach: number | null; engaged: number | null }[]): Trend[] {
  const scored = posts.filter((p) => p.reach).map((p) => ({ p, rate: (p.engaged ?? 0) / Math.max(1, p.reach ?? 0) }));
  if (scored.length < 2) return [];
  const avg = scored.reduce((s, x) => s + x.rate, 0) / scored.length;
  const best = scored.sort((a, b) => b.rate - a.rate)[0];
  if (best.rate < avg * 1.3) return [];
  const first = (best.p.message ?? '').split('\n')[0].slice(0, 60);
  return [{
    id: `post-${best.p.external_post_id}`, kind: 'post', title: `โพสต์ "${first}" คนสนใจสูงสุด`,
    detail: `engaged ${Math.round(best.rate * 100)}% ของ reach (เฉลี่ย ${Math.round(avg * 100)}%) · reach ${(best.p.reach ?? 0).toLocaleString('th-TH')}`,
    suggestion: `โพสต์แนว "${first}" ได้ผลดีกว่าเฉลี่ย ให้เขียนโพสต์ถัดไป 2 แบบในโครงเดียวกัน (เปิดด้วยราคาเซ็ต ตามด้วยไซส์ครบ ปิดด้วยทักแชท) แต่เปลี่ยนสินค้า`,
    targets: ['copywriter', 'learner'], score: 45,
  }];
}

/* ---------- directives ---------- */

const AI_TARGET = (slug: string) => AGENT_BY_SLUG[slug]?.kind === 'ai';

export async function listDirectives(db: Db, storeId: string, status?: Directive['status']): Promise<Directive[]> {
  const rows = await db.query<Directive>(
    `select id, store_id, title, text, source, targets, status, created_at::text, expires_at::text, by
       from directive where store_id=$1 ${status ? 'and status=$2' : ''} order by id desc limit 100`, status ? [storeId, status] : [storeId]);
  return rows.map(normalize);
}

/** Active, unexpired directives aimed at one box — what its prompt carries. */
export async function activeDirectivesFor(db: Db, storeId: string, slug: string): Promise<Directive[]> {
  const rows = await db.query<Directive>(
    `select id, store_id, title, text, source, targets, status, created_at::text, expires_at::text, by
       from directive where store_id=$1 and status='active' and (expires_at is null or expires_at > now()) and targets @> $2::jsonb order by id`,
    [storeId, JSON.stringify([slug])]);
  return rows.map(normalize);
}

export async function createDirective(db: Db, o: { storeId: string; title: string; text: string; source?: DirectiveSource; targets: string[]; days?: number; by?: string }): Promise<Directive> {
  const targets = o.targets.filter(AI_TARGET);
  const rows = await db.query<Directive>(
    `insert into directive(store_id, title, text, source, targets, expires_at, by)
     values ($1,$2,$3,$4,$5, ${o.days ? `now() + ($6 || ' days')::interval` : 'null'}, $${o.days ? 7 : 6})
     returning id, store_id, title, text, source, targets, status, created_at::text, expires_at::text, by`,
    o.days ? [o.storeId, o.title, o.text, o.source ?? 'manual', JSON.stringify(targets), String(o.days), o.by ?? null]
      : [o.storeId, o.title, o.text, o.source ?? 'manual', JSON.stringify(targets), o.by ?? null]);
  return normalize(rows[0]);
}

export async function setDirectiveStatus(db: Db, storeId: string, id: number, status: Directive['status']): Promise<Directive | null> {
  const rows = await db.query<Directive>(
    `update directive set status=$3 where store_id=$1 and id=$2
     returning id, store_id, title, text, source, targets, status, created_at::text, expires_at::text, by`, [storeId, id, status]);
  return rows[0] ? normalize(rows[0]) : null;
}

/** Run every targeted box now, in loop order, with the directive already in their prompts. */
export async function runDirective(db: Db, storeId: string, id: number, by?: string): Promise<{ directive: Directive; runs: RunRow[] } | null> {
  const d = (await listDirectives(db, storeId)).find((x) => x.id === id);
  if (!d) return null;
  const order = [...d.targets].sort((a, b) => (AGENT_BY_SLUG[a]?.step ?? 99) - (AGENT_BY_SLUG[b]?.step ?? 99));
  const runs: RunRow[] = [];
  for (const slug of order) {
    const r = await runAgent(db, { storeId, slug, trigger: 'event', by: by ?? `คำสั่ง #${id}` });
    if (r) runs.push(r);
  }
  return { directive: d, runs };
}

function normalize(r: Directive): Directive {
  return { ...r, id: Number(r.id), targets: typeof r.targets === 'string' ? JSON.parse(r.targets) : (r.targets ?? []) };
}

/** How a directive reads inside a prompt (and in the demo brain). */
export function renderDirectives(list: { title: string; text: string; expires_at?: string | null }[]): string {
  return list.map((d) => `- ${d.title}: ${d.text}${d.expires_at ? ` (ถึง ${String(d.expires_at).slice(0, 10)})` : ''}`).join('\n');
}
