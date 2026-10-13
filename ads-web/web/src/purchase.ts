// Phase 2: Bigseller's daily "Order-SKU-inprocess…xlsx" (one row per item: shop, SKU, name, option, qty, order no …)
// → order sheets ("ใบสั่งสินค้า") per supplier or warehouse, like the ones the team printed by hand.
// Who a product is ordered from, in this order:
//   1. a supplier set on the page for that product (catalog_suppliers) — e.g. PK 501/1 → J.BIG
//   2. the sheet's ร้านค้า column (BB-style tabs), unless it is a status such as "เลิกผลิต"
//   3. tabs that list suppliers but not for this product → "<tab> · ยังไม่ระบุร้าน" (pick one on the page)
//   4. other tabs → the warehouse itself (PK, CM, CN …)
// Rows whose SKU is missing or not in the catalog go to "ตรวจสอบ". Shared by the page and the tests.

import { COLOR_NAMES, compareSize, SHOP_STATUSES, skuKey, spuOf, type CatalogRow } from './catalog.ts';
import { buildXlsx, S, type Cell, type Sheet } from './xlsxWrite.ts';

export type GroupKind = 'supplier' | 'warehouse' | 'unassigned' | 'review';
export const REVIEW = 'ตรวจสอบ';

/** One row of the Bigseller file (only what the sheets need; order numbers are used for counting, never stored). */
export interface OrderItem { store: string; sku: string; name: string; option: string; qty: number; order: string }

export interface PurchaseLine {
  group: string;
  kind: GroupKind;
  /** catalog SKU, or for review lines what Bigseller had (SKU or "name · option") */
  sku: string;
  tab: string;
  /** product key `${tab}|${spu}` (empty for review lines) */
  product: string;
  label: string;
  size: string;
  qty: number;
  note: string;
}

export interface PurchaseGroup { name: string; kind: GroupKind; lines: PurchaseLine[]; pieces: number }

const REQUIRED = ['SKU', 'จำนวน'];

export function missingOrderColumns(headers: string[]): string[] | null {
  const miss = REQUIRED.filter((h) => !headers.includes(h));
  return miss.length ? miss : null;
}

export function readOrderItems(rows: Record<string, string>[]): OrderItem[] {
  return rows.map((r) => ({
    store: (r['ร้านค้า BigSeller'] ?? '').trim(),
    sku: (r['SKU'] ?? '').trim(),
    name: (r['ชื่อสินค้า'] ?? '').trim(),
    option: (r['ชื่อตัวเลือก'] ?? '').trim(),
    qty: Math.max(0, Math.round(Number(String(r['จำนวน'] ?? '').replace(/,/g, '')) || 0)),
    order: (r['หมายเลขคำสั่งซื้อ'] ?? '').trim(),
  })).filter((i) => i.qty > 0 && (i.sku || i.name));
}

/** "Order-SKU-inprocess20261013010110576.xlsx" → 2026-10-13 (the export's date). */
export function dateFromFileName(name: string): string | null {
  const m = name.match(/(20\d{2})(\d{2})(\d{2})\d{6,}/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31 ? `${y}-${mo}-${d}` : null;
}

/** 2026-10-13 → "13/10/69" (Buddhist year, like the printed sheets). */
export function thaiShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}/${m}/${String(y + 543).slice(-2)}`;
}

/** 2026-10-13 → "13-10" for file names. */
export function dayMonth(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}-${m}`;
}

export interface Lookup {
  /** skuKey → catalog row (sheet rows and SKUs added on the page) */
  rows: Map<string, CatalogRow>;
  /** product key → supplier set on the page */
  suppliers: Map<string, string>;
  /** tabs whose sheet has a ร้านค้า column in use */
  supplierTabs: Set<string>;
}

export function makeLookup(rows: CatalogRow[], suppliers: Map<string, string>): Lookup {
  const map = new Map<string, CatalogRow>();
  const supplierTabs = new Set<string>();
  for (const r of rows) {
    const k = skuKey(r.sku);
    if (!map.has(k)) map.set(k, r);
    if (r.shop && !SHOP_STATUSES.has(r.shop)) supplierTabs.add(r.tab);
  }
  return { rows: map, suppliers, supplierTabs };
}

/** Where one catalog row is ordered from. */
export function groupOf(r: CatalogRow, lookup: Lookup): { group: string; kind: GroupKind; note: string } {
  const product = `${r.tab}|${spuOf(r.sku)}`;
  const set = lookup.suppliers.get(product);
  if (set) return { group: set, kind: 'supplier', note: '' };
  if (r.shop && !SHOP_STATUSES.has(r.shop)) return { group: r.shop, kind: 'supplier', note: '' };
  if (lookup.supplierTabs.has(r.tab)) return { group: `${r.tab} · ยังไม่ระบุร้าน`, kind: 'unassigned', note: r.shop ? `ชีต: ${r.shop}` : '' };
  return { group: r.tab, kind: 'warehouse', note: '' };
}

/** What the sheet calls the product: the supplier's own code when ordering from a supplier, else code + colour. */
export function labelOf(r: CatalogRow, kind: GroupKind): string {
  if (kind === 'supplier' && r.alias) return r.alias;
  const color = COLOR_NAMES[r.color.toUpperCase()];
  return `${r.code || spuOf(r.sku)}${color ? ` ${color}` : r.color ? ` ${r.color}` : ''}`;
}

/** Bigseller items → one line per (group, SKU) with quantities added up. */
export function buildLines(items: OrderItem[], lookup: Lookup): PurchaseLine[] {
  const lines = new Map<string, PurchaseLine>();
  for (const it of items) {
    const r = it.sku ? lookup.rows.get(skuKey(it.sku)) : undefined;
    let line: PurchaseLine;
    if (!r) {
      const what = it.option || it.name.slice(0, 60);
      line = {
        group: REVIEW, kind: 'review', sku: it.sku || `?${it.name.slice(0, 60)} · ${it.option}`, tab: '', product: '',
        label: it.sku || '(ไม่มี SKU)', size: '', qty: 0, note: `${it.sku ? 'SKU ไม่มีในแคตตาล็อก' : 'ไม่มี SKU ใน Bigseller'} · ${what}`,
      };
    } else {
      const g = groupOf(r, lookup);
      line = { group: g.group, kind: g.kind, sku: r.sku, tab: r.tab, product: `${r.tab}|${spuOf(r.sku)}`, label: labelOf(r, g.kind), size: r.size, qty: 0, note: g.note };
    }
    const key = `${line.group}\u0000${line.sku}`;
    const prev = lines.get(key);
    if (prev) prev.qty += it.qty; else lines.set(key, { ...line, qty: it.qty });
  }
  return [...lines.values()];
}

/** Character order (digits, then Latin, then Thai), the way the team's sheets are sorted; same on every device. */
export function textOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const KIND_ORDER: Record<GroupKind, number> = { supplier: 0, unassigned: 1, warehouse: 2, review: 3 };

/** Lines → groups: suppliers by pieces, then unassigned, warehouses, and ตรวจสอบ last; lines by label (text order) then size. */
export function groupLines(lines: PurchaseLine[]): PurchaseGroup[] {
  const groups = new Map<string, PurchaseGroup>();
  for (const l of lines) {
    const g = groups.get(l.group) ?? { name: l.group, kind: l.kind, lines: [], pieces: 0 };
    g.lines.push(l);
    g.pieces += l.qty;
    groups.set(l.group, g);
  }
  for (const g of groups.values()) {
    // Plain text order like the hand-made sheets: 1306-36, 1306-4, 2003, 501/1 …, Thai names last.
    g.lines.sort((a, b) => textOrder(a.label, b.label) || compareSize(a.size, b.size) || a.sku.localeCompare(b.sku));
  }
  return [...groups.values()].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.pieces - a.pieces || a.name.localeCompare(b.name, 'th'));
}

/** Rows of a printed sheet: same label + size merged (different SKUs can share a supplier code). */
export interface SheetRow { label: string; size: string; qty: number; band: number; note: string }

export function sheetRows(g: PurchaseGroup): SheetRow[] {
  const out: SheetRow[] = [];
  let band = -1, last = '';
  for (const l of g.lines) {
    const prev = out[out.length - 1];
    if (g.kind !== 'review' && prev && prev.label === l.label && prev.size === l.size) { prev.qty += l.qty; continue; }
    if (l.label !== last) { band++; last = l.label; }
    out.push({ label: l.label, size: l.size, qty: l.qty, band, note: l.note });
  }
  return out;
}

export const KIND_LABEL: Record<GroupKind, string> = { supplier: 'ร้านค้า', warehouse: 'โกดัง', unassigned: 'ยังไม่ระบุร้าน', review: 'ต้องตรวจสอบ' };

// ---- Excel ----

function groupSheet(g: PurchaseGroup, date: string, round: number): Sheet {
  const rows: (Cell | string | number | null)[][] = [
    [{ v: thaiShortDate(date), s: S.title }, null, { v: g.name, s: S.title }, null, { v: `รอบ ${round}`, s: S.title }],
    [],
    ['รหัสสินค้า', 'ไซส์', 'จำนวน', 'หมายเหตุ'].map((v) => ({ v, s: S.head })),
  ];
  for (const r of sheetRows(g)) {
    const shade = r.band % 2 === 0;
    rows.push([{ v: r.label, s: shade ? S.bandLeft : S.boxLeft }, { v: /^\d+$/.test(r.size) ? Number(r.size) : r.size, s: shade ? S.band : S.box }, { v: r.qty, s: shade ? S.band : S.box }, { v: r.note, s: S.boxLeft }]);
  }
  rows.push([{ v: 'รวม', s: S.boxBold }, { v: '', s: S.box }, { v: g.pieces, s: S.boxBold }, { v: '', s: S.box }]);
  return { name: g.name, rows, cols: [34, 9, 9, 30, 12], merges: ['A1:B1', 'C1:D1'] };
}

/** One workbook: a summary sheet, then one sheet per group (ตรวจสอบ included when present). */
export async function orderWorkbook(groups: PurchaseGroup[], date: string, round: number): Promise<Uint8Array> {
  const total = groups.reduce((n, g) => n + g.pieces, 0);
  const summary: Sheet = {
    name: 'สรุป',
    rows: [
      [{ v: `ใบสั่งสินค้า ${thaiShortDate(date)} รอบ ${round}`, s: S.bold }],
      [],
      ['ร้าน / โกดัง', 'ประเภท', 'รายการ', 'จำนวน'].map((v) => ({ v, s: S.head })),
      ...groups.map((g) => [{ v: g.name, s: S.boxLeft }, { v: KIND_LABEL[g.kind], s: S.box }, { v: sheetRows(g).length, s: S.box }, { v: g.pieces, s: S.box }]),
      [{ v: 'รวม', s: S.boxBold }, { v: '', s: S.box }, { v: '', s: S.box }, { v: total, s: S.boxBold }],
    ],
    cols: [30, 16, 10, 10],
  };
  return buildXlsx(groups.length > 1 ? [summary, ...groups.map((g) => groupSheet(g, date, round))] : groups.map((g) => groupSheet(g, date, round)));
}
