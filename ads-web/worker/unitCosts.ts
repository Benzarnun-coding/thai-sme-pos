// Raw cost per piece for the ads pages (Benz 27 Oct 2026: one cost for the whole site). It is the catalog's ทุน — a cost
// typed on the website wins over the sheet, and Page365 uploads keep it in line (p365Costs.ts) — looked up by the
// product codes a product line links. Fees and risk (COD, loss/returns, shipping, VAT, bag) are added per order from
// settings.order_fees (db.ts codOf), never folded into this number.

import type { CostRow } from './model.ts';

export interface CatalogCostRow { code: string; cost: number | null; typed: number | null }

/** What a linked product's cost came from: the catalog (with the codes found) or the cost typed on the Products page. */
export type UnitCostRow = CostRow & { cost_from?: 'catalog' | 'typed'; catalog_codes?: string[] };

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
 * ranges, then the same for each word with a digit ("N นูดดี้ 888/1-6" → 888/1…888/6), then the family ("801" → 801/…).
 */
export function codeCandidates(code: string): { exact: string[][]; families: string[] } {
  const whole = up(code);
  const words = whole.split(' ').filter((w) => /\d/.test(w) && w !== whole);
  const exact = [[whole, ...expand(whole)], ...words.map((w) => [w, ...expand(w)])];
  const families = [whole, ...words].filter((w) => /^[A-Z]*\d+$/.test(w)).map((w) => `${w}/`);
  return { exact, families };
}

/** Mean cost of a set of catalog rows (each size counts once); null when none has a cost. */
function meanCost(rows: CatalogCostRow[]): number | null {
  const v = rows.map((r) => r.typed ?? r.cost).filter((c): c is number => c !== null && c > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Pure: the catalog cost of one linked code, and which catalog codes gave it. */
export function catalogCostOf(code: string, rows: CatalogCostRow[]): { cost: number; codes: string[] } | null {
  const byCode = new Map<string, CatalogCostRow[]>();
  for (const r of rows) { const k = up(r.code); byCode.set(k, [...(byCode.get(k) ?? []), r]); }
  const tryCodes = (codes: string[]) => {
    const hits = [...new Set(codes)].map((c) => ({ c, cost: meanCost(byCode.get(c) ?? []) })).filter((h): h is { c: string; cost: number } => h.cost !== null);
    return hits.length ? { cost: hits.reduce((t, h) => t + h.cost, 0) / hits.length, codes: hits.map((h) => h.c) } : null;
  };
  const { exact, families } = codeCandidates(code);
  for (const group of exact) { const hit = tryCodes(group); if (hit) return hit; }
  for (const f of families) { const hit = tryCodes([...byCode.keys()].filter((k) => k.startsWith(f))); if (hit) return hit; }
  return null;
}

/** Pure: every cost row with its avg cost swapped for the catalog's when the catalog has it. */
export function withCatalogCosts(costs: CostRow[], rows: CatalogCostRow[]): UnitCostRow[] {
  return costs.map((c) => {
    const hit = catalogCostOf(c.code, rows);
    return hit
      ? { ...c, avg_cost: hit.cost, min_cost: hit.cost, max_cost: hit.cost, cost_from: 'catalog' as const, catalog_codes: hit.codes }
      : { ...c, cost_from: 'typed' as const };
  });
}

/** The cost rows every ads page and the rules engine use: catalog ทุน first, the Products page's typed cost otherwise. */
export async function loadUnitCosts(db: D1Database, costs: CostRow[]): Promise<UnitCostRow[]> {
  if (!costs.length) return costs;
  const all = costs.map((c) => codeCandidates(c.code));
  const exact = [...new Set(all.flatMap((c) => c.exact.flat()))];
  const families = [...new Set(all.flatMap((c) => c.families))];
  const select = `SELECT c.code, c.cost, COALESCE(s.price, p.price) AS typed FROM catalog c
    LEFT JOIN catalog_prices s ON s.key = c.tab || '|' || c.sku LEFT JOIN catalog_prices p ON p.key = c.tab || '|' || c.spu`;
  const res = await db.batch<CatalogCostRow>([
    db.prepare(`${select} WHERE c.code COLLATE NOCASE IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(exact)),
    ...families.map((f) => db.prepare(`${select} WHERE c.code LIKE ?1`).bind(`${f}%`)),
  ]);
  return withCatalogCosts(costs, res.flatMap((r) => r.results));
}
