// Costs follow Page365 (Benz 2026-10-27: "รับ 365 มาแล้ว ต้นทุนตัวไหนไม่ตรง ให้ปรับทั้งบ้านให้ตรงตาม 365"). Page365's
// export has one Cost per order, not per item, so the cost of each product is solved from the orders: an order of
// one product gives it directly; in a mixed order the products already known are taken off and the one left is
// solved. Per product (SKU minus size) and size band (≥ 38 often costs more). A value counts only when its orders
// agree (±1 baht). Where our ทุน (cost typed on the website > sheet column H) differs, the website cost is set to
// Page365's for every size of that product in the band — so the order sheets, what we owe suppliers, the profit
// page and the to-do list all use it. Runs after each Page365 upload over the last 14 days; audited per change.

import { savePrices } from './catalog.ts';
import { audit } from './db.ts';
import { cleanSku } from '../web/src/catalog.ts';

export interface P365Item { sku: string; code?: string; qty: number }
export interface CostOrder { cost: number | null; items: P365Item[] }
export interface Solved { key: string; band: Band; cost: number; orders: number; pieces: number }
export interface CatalogCostRow { tab: string; sku: string; spu: string; cost: number | null }
export interface CostChange { tab: string; sku: string; from: number | null; to: number; source: 'sheet' | 'web' | 'none' }
export interface CostPlan { solved: Solved[]; changes: CostChange[]; missing: Solved[]; explained: number; orders: number }

type Band = 'std' | 'big';
const up = (s: unknown) => cleanSku(s).toUpperCase();
const splitSku = (sku: string): [string, string] => { const i = sku.lastIndexOf('-'); return i > 0 ? [sku.slice(0, i), sku.slice(i + 1)] : [sku, '']; };
const bandOf = (size: string): Band => (/^\d+$/.test(size) && Number(size) >= 38 ? 'big' : 'std');
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Pure: Page365's cost per piece for each product × size band, from whole-order costs. */
export function solveP365Costs(orders: CostOrder[], alias: Map<string, string> = new Map()): { solved: Solved[]; explained: number; orders: number } {
  const lines: { cost: number; g: Map<string, number> }[] = [];
  const pieces = new Map<string, number>();
  for (const o of orders) {
    if (!o.items.length || !(Number(o.cost) > 0)) continue;
    const g = new Map<string, number>();
    for (const i of o.items) {
      const sku = alias.get(up(i.sku || i.code)) ?? up(i.sku || i.code);
      const [spu, size] = splitSku(sku);
      const k = `${spu}|${bandOf(size)}`;
      g.set(k, (g.get(k) ?? 0) + i.qty);
      pieces.set(k, (pieces.get(k) ?? 0) + i.qty);
    }
    lines.push({ cost: Number(o.cost), g });
  }
  const est = new Map<string, { cost: number; orders: number }>();
  for (let pass = 0; pass < 6; pass++) {
    const cand = new Map<string, number[]>();
    for (const l of lines) {
      const unknown = [...l.g.keys()].filter((k) => !est.has(k));
      if (unknown.length !== 1) continue;
      let rest = l.cost;
      for (const [k, q] of l.g) if (est.has(k)) rest -= est.get(k)!.cost * q;
      cand.set(unknown[0], [...(cand.get(unknown[0]) ?? []), rest / l.g.get(unknown[0])!]);
    }
    let added = false;
    for (const [k, v] of cand) {
      const m = median(v);
      // The orders must agree: all within a baht, or at least 3 orders with 80% of them.
      const near = v.filter((x) => Math.abs(x - m) <= 1).length;
      if (m > 0 && (near === v.length || (v.length >= 3 && near / v.length >= 0.8))) { est.set(k, { cost: Math.round(m * 100) / 100, orders: v.length }); added = true; }
    }
    if (!added) break;
  }
  let explained = 0;
  for (const l of lines) {
    if (![...l.g.keys()].every((k) => est.has(k))) continue;
    if (Math.abs([...l.g].reduce((t, [k, q]) => t + est.get(k)!.cost * q, 0) - l.cost) <= 1) explained++;
  }
  const solved = [...est].map(([k, e]) => { const [key, band] = k.split('|') as [string, Band]; return { key, band, cost: e.cost, orders: e.orders, pieces: pieces.get(k) ?? 0 }; });
  return { solved: solved.sort((a, b) => b.pieces - a.pieces), explained, orders: lines.length };
}

/** Pure: which catalog sizes get Page365's cost. `typed` = catalog_prices (key tab|SKU or tab|SPU). */
export function planCostSync(solved: Solved[], rows: CatalogCostRow[], typed: Map<string, number>): { changes: CostChange[]; missing: Solved[] } {
  const changes: CostChange[] = [], missing: Solved[] = [];
  for (const s of solved) {
    const sizes = rows.filter((r) => { const [spu, size] = splitSku(up(r.sku)); return spu === s.key && bandOf(size) === s.band; });
    if (!sizes.length) { missing.push(s); continue; }
    for (const r of sizes) {
      const web = typed.get(`${r.tab}|${r.sku}`) ?? typed.get(`${r.tab}|${r.spu}`);
      const now = web ?? r.cost;
      if (now !== null && now !== undefined && Math.abs(now - s.cost) < 0.5) continue;
      changes.push({ tab: r.tab, sku: r.sku, from: now ?? null, to: s.cost, source: web !== undefined ? 'web' : r.cost !== null ? 'sheet' : 'none' });
    }
  }
  return { changes, missing };
}

/** Last 14 days of Page365 orders → plan; with `apply`, the website costs are set (≤ 200 a batch) and audited. */
export async function syncP365Costs(db: D1Database, user: string, opts: { apply?: boolean; days?: number } = {}): Promise<CostPlan> {
  const since = new Date(Date.now() + 7 * 3_600_000 - (opts.days ?? 14) * 86_400_000).toISOString().slice(0, 10);
  const [o, a, p] = await db.batch([
    db.prepare('SELECT cost, items FROM p365_orders WHERE date >= ? AND cost IS NOT NULL').bind(since),
    db.prepare('SELECT alias, sku FROM catalog_aliases'),
    db.prepare('SELECT key, price FROM catalog_prices'),
  ]);
  const orders = (o.results as { cost: number; items: string }[]).map((r) => ({ cost: r.cost, items: JSON.parse(r.items || '[]') as P365Item[] }));
  const alias = new Map((a.results as { alias: string; sku: string }[]).map((r) => [up(r.alias), up(r.sku)]));
  const { solved, explained, orders: n } = solveP365Costs(orders, alias);
  const { results: rows } = solved.length
    ? await db.prepare(`SELECT tab, sku, spu, cost FROM catalog c WHERE EXISTS (SELECT 1 FROM json_each(?) j WHERE upper(c.sku) LIKE j.value || '-%')`).bind(JSON.stringify([...new Set(solved.map((s) => s.key))])).all<CatalogCostRow>()
    : { results: [] as CatalogCostRow[] };
  const typed = new Map((p.results as { key: string; price: number }[]).map((r) => [r.key, r.price]));
  const { changes, missing } = planCostSync(solved, rows, typed);
  if (opts.apply && changes.length) {
    for (let i = 0; i < changes.length; i += 200) await savePrices(db, { items: changes.slice(i, i + 200).map((c) => ({ tab: c.tab, spu: c.sku, price: c.to })) }, user);
    await audit(db, user, 'catalog.price.p365', `${changes.length} sizes`, changes.slice(0, 300).map((c) => [c.sku, c.from, c.to]));
  }
  return { solved, changes, missing, explained, orders: n };
}
