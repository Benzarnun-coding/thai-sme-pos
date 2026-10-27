// Raw cost per piece for the ads pages (Benz 27 Oct 2026: one cost for the whole site). It is the catalog's ทุน — a cost
// typed on the website wins over the sheet, and Page365 uploads keep it in line (p365Costs.ts) — looked up by the
// product codes a product line links. Fees and risk (COD, loss/returns, shipping, VAT, bag) are added per order from
// settings.order_fees (db.ts codOf), never folded into this number.

import { WEB_TAB, type CostRow, type Section } from './model.ts';

export interface CatalogCostRow { code: string; cost: number | null; typed: number | null; tab?: string; price?: number | null }

/** What a linked product's cost came from: the catalog (with the codes found) or the cost typed on the Products page. */
export type UnitCostRow = CostRow & { cost_from?: 'catalog' | 'typed'; catalog_codes?: string[]; catalog_cost?: number | null };

const up = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toUpperCase();

function expand(p: string): string[] {
  // "501/1-3" → 501/1…501/3 · "E444/5-6-7" → E444/5, E444/6, E444/7
  const slash = p.match(/^(.*\/)(\d+)((?:-\d+)+)$/);
  if (slash) {
    const nums = [slash[2], ...slash[3].slice(1).split('-')].map(Number);
    const list = nums.length === 2 && nums[1] > nums[0] && nums[1] - nums[0] <= 20
      ? Array.from({ length: nums[1] - nums[0] + 1 }, (_, i) => nums[0] + i) : nums;
    return list.map((n) => `${slash[1]}${n}`);
  }
  // "KZ-070-073" → KZ-070…KZ-073
  const dash = p.match(/^([A-Z]+-)(\d+)-(\d+)$/);
  if (dash && Number(dash[3]) > Number(dash[2]) && Number(dash[3]) - Number(dash[2]) <= 20) {
    return Array.from({ length: Number(dash[3]) - Number(dash[2]) + 1 }, (_, i) => `${dash[1]}${String(Number(dash[2]) + i).padStart(dash[2].length, '0')}`);
  }
  // "444/1-444/2", "L100-L300" → both ends
  const ends = p.split('-');
  if (ends.length === 2 && ends.every((e) => /\d/.test(e) && /\D/.test(e))) return ends;
  return [];
}

/**
 * Catalog codes a linked product code may stand for, tried in order until one finds a cost: the whole code and its
 * ranges, then the same for each word with a digit ("N นูดดี้ 888/1-6" → 888/1…888/6), then the family ("801" →
 * 801/…, "AR 16" → 16-…), then a plain number range as the end of a code ("BAGGY 711-714" → RL-711…RL-714).
 */
export function codeCandidates(code: string): { exact: string[][]; families: string[]; suffixes: string[] } {
  const whole = up(code);
  const words = whole.split(' ').filter((w) => /\d/.test(w) && w !== whole);
  const exact = [[whole, ...expand(whole)], ...words.map((w) => [w, ...expand(w)])];
  const families = [whole, ...words].filter((w) => /^[A-Z]*\d+$/.test(w)).flatMap((w) => [`${w}/`, `${w}-`]);
  const suffixes = [whole, ...words].flatMap((w) => {
    const m = w.match(/^(\d+)-(\d+)$/);
    if (!m || Number(m[2]) <= Number(m[1]) || Number(m[2]) - Number(m[1]) > 20) return [];
    return Array.from({ length: Number(m[2]) - Number(m[1]) + 1 }, (_, i) => `-${Number(m[1]) + i}`);
  });
  return { exact, families, suffixes };
}

/**
 * The cost most sizes of a code have (501/1: 28–36 at PK ฿110, 38–44 at BB ฿135 → 110, what the catalog card shows);
 * a tie takes the higher. Null when no size has a cost. Big sizes' real cost comes in with the Page365 orders.
 */
function mainCost(rows: CatalogCostRow[]): number | null {
  const count = new Map<number, number>();
  for (const r of rows) { const c = r.typed ?? r.cost; if (c !== null && c > 0) count.set(c, (count.get(c) ?? 0) + 1); }
  let best: number | null = null;
  for (const [c, n] of count) if (best === null || n > count.get(best)! || (n === count.get(best)! && c > best)) best = c;
  return best;
}

/** Pure: the catalog cost of one linked code (what most of its codes cost; a tie takes the higher), and which catalog codes gave it. */
export function catalogCostOf(code: string, rows: CatalogCostRow[]): { cost: number; codes: string[]; price: number | null } | null {
  const byCode = new Map<string, CatalogCostRow[]>();
  for (const r of rows) { const k = up(r.code); byCode.set(k, [...(byCode.get(k) ?? []), r]); }
  const tryCodes = (codes: string[]) => {
    const hits = [...new Set(codes)].map((c) => ({ c, cost: mainCost(byCode.get(c) ?? []) })).filter((h): h is { c: string; cost: number } => h.cost !== null);
    if (!hits.length) return null;
    const prices = hits.flatMap((h) => byCode.get(h.c)!.map((r) => r.price ?? 0)).filter((p) => p > 0);
    // Same rule across codes as across sizes, so the number is always one a catalog card shows.
    const cost = mainCost(hits.map((h) => ({ code: h.c, cost: h.cost, typed: null })))!;
    return { cost, codes: hits.map((h) => h.c), price: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null };
  };
  const { exact, families, suffixes } = codeCandidates(code);
  for (const group of exact) { const hit = tryCodes(group); if (hit) return hit; }
  for (const f of families) { const hit = tryCodes([...byCode.keys()].filter((k) => k.startsWith(f))); if (hit) return hit; }
  return suffixes.length ? tryCodes([...byCode.keys()].filter((k) => suffixes.some((x) => k.endsWith(x)))) : null;
}

/** Pure: every cost row with its avg cost swapped for the catalog's when the catalog has it. A row of a catalog tab
 * (a product picked from the catalog, e.g. PK · 200) only looks in that tab. */
export function withCatalogCosts(costs: CostRow[], rows: CatalogCostRow[]): UnitCostRow[] {
  return costs.map((c) => {
    const hit = catalogCostOf(c.code, c.tab === WEB_TAB ? rows : rows.filter((r) => !r.tab || r.tab === c.tab));
    return hit
      ? { ...c, avg_cost: hit.cost, min_cost: hit.cost, max_cost: hit.cost, avg_price: c.avg_price || hit.price || 0, cost_from: 'catalog' as const, catalog_codes: hit.codes, catalog_cost: hit.cost }
      : { ...c, cost_from: 'typed' as const };
  });
}

/** The cost rows every ads page and the rules engine use: catalog ทุน first, the Products page's typed cost otherwise. */
export async function loadUnitCosts(db: D1Database, costs: CostRow[]): Promise<UnitCostRow[]> {
  if (!costs.length) return costs;
  const all = costs.map((c) => codeCandidates(c.code));
  const exact = [...new Set(all.flatMap((c) => c.exact.flat()))];
  const families = [...new Set(all.flatMap((c) => c.families))];
  const suffixes = [...new Set(all.flatMap((c) => c.suffixes))];
  const select = `SELECT c.tab, c.code, c.cost, c.price, COALESCE(s.price, p.price) AS typed FROM catalog c
    LEFT JOIN catalog_prices s ON s.key = c.tab || '|' || c.sku LEFT JOIN catalog_prices p ON p.key = c.tab || '|' || c.spu`;
  const res = await db.batch<CatalogCostRow>([
    db.prepare(`${select} WHERE c.code COLLATE NOCASE IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(exact)),
    ...families.map((f) => db.prepare(`${select} WHERE c.code LIKE ?1`).bind(`${f}%`)),
    ...(suffixes.length ? [db.prepare(`${select} WHERE EXISTS (SELECT 1 FROM json_each(?1) j WHERE c.code LIKE '%' || j.value)`).bind(JSON.stringify(suffixes))] : []),
  ]);
  return withCatalogCosts(costs, res.flatMap((r) => r.results));
}

/**
 * Products linked straight to a catalog code (tab = catalog tab, e.g. PK · 200) have no row in `costs`: one is made
 * from the catalog for each, and kept only when the catalog has its cost.
 */
export function catalogLinkRows(sections: Section[], costs: CostRow[]): CostRow[] {
  const have = new Set(costs.map((c) => `${c.tab}|${c.code}`));
  const out = new Map<string, CostRow>();
  for (const p of sections.flatMap((s) => s.products)) {
    const k = `${p.tab}|${p.code}`;
    if (p.tab === WEB_TAB || have.has(k) || out.has(k)) continue;
    out.set(k, { tab: p.tab, code: p.code, name: p.code, sku_count: 0, avg_cost: 0, min_cost: 0, max_cost: 0, avg_price: 0 });
  }
  return [...out.values()];
}

/** Every stored cost row and every catalog-linked product, with the catalog ทุน the ads pages and the rules use. */
export async function unitCostsFor(db: D1Database, costs: CostRow[], sections: Section[]): Promise<UnitCostRow[]> {
  const links = catalogLinkRows(sections, costs);
  const rows = await loadUnitCosts(db, [...costs, ...links]);
  return rows.filter((r, i) => i < costs.length || r.cost_from === 'catalog');
}

/** Catalog products by code or name for the product pickers: one row per warehouse tab + code, ทุน = what most sizes cost. */
export async function searchCatalogCodes(db: D1Database, q: string, limit = 15): Promise<UnitCostRow[]> {
  const text = q.trim();
  if (!text) return [];
  const { results } = await db.prepare(
    `SELECT c.tab, c.code, MIN(c.name) AS name, COUNT(*) AS skus, GROUP_CONCAT(COALESCE(s.price, p.price, c.cost)) AS costs, AVG(c.price) AS price
     FROM catalog c LEFT JOIN catalog_prices s ON s.key = c.tab || '|' || c.sku LEFT JOIN catalog_prices p ON p.key = c.tab || '|' || c.spu
     WHERE c.code LIKE ?1 || '%' OR (length(?1) >= 2 AND c.name LIKE '%' || ?1 || '%')
     GROUP BY c.tab, c.code ORDER BY upper(c.code) = upper(?1) DESC, length(c.code), c.code LIMIT ?2`,
  ).bind(text, limit).all<{ tab: string; code: string; name: string; skus: number; costs: string | null; price: number | null }>();
  return results.map((r) => ({ ...r, cost: mainCost((r.costs ?? '').split(',').filter(Boolean).map((c) => ({ code: r.code, cost: Number(c), typed: null }))) })).map((r) => ({
    tab: r.tab, code: r.code, name: r.name, sku_count: r.skus, avg_cost: r.cost ?? 0, min_cost: r.cost ?? 0, max_cost: r.cost ?? 0, avg_price: r.price ?? 0,
    cost_from: 'catalog' as const, catalog_codes: [r.code], catalog_cost: r.cost,
  }));
}
