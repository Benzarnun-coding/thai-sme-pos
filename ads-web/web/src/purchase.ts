// Phase 2: Bigseller's daily "Order-SKU-inprocess" export, .xlsx or .csv (one row per item: shop, SKU, name, option, qty, order no …)
// → order sheets ("ใบสั่งสินค้า") per supplier or warehouse, like the ones the team printed by hand.
// Who a product is ordered from, in this order:
//   1. a supplier set on the page for that product (catalog_suppliers) — e.g. PK 501/1 → J.BIG
//   2. the sheet's ร้านค้า column (BB-style tabs), unless it is a status such as "เลิกผลิต"
//   3. BB (โบ๊เบ๊, many suppliers; every product must be ordered from one) without a supplier → "BB · ยังไม่ระบุร้าน"
//   4. other tabs → the warehouse itself (PK, CM, CN …)
// Rows whose SKU is missing or not in the catalog go to "ตรวจสอบ". Shared by the page and the tests.

import { COLOR_NAMES, compareSize, SHOP_STATUSES, skuKey, spuOf, type CatalogRow } from './catalog.ts';
import { buildXlsx, S, type Cell, type Sheet } from './xlsxWrite.ts';

export type GroupKind = 'supplier' | 'warehouse' | 'unassigned' | 'review';
export const REVIEW = 'ตรวจสอบ';

/** One row of the Bigseller file. Order and tracking numbers stay in the browser (counting, per-order picture sheets); never stored. */
export interface OrderItem { store: string; sku: string; name: string; option: string; qty: number; order: string; tracking: string; carrier: string }

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
  /** marketplace order numbers this line came from (shown on the sheets) */
  orders: string[];
  /** the sales store of each order number: {"5865…": "TikTok · STM-SHOP"} */
  stores?: Record<string, string>;
  /** a note from the sheet's column M (for the team, not printed), filled by withPrices */
  sheetNote?: string;
  /** what we pay per piece (ทุน H from the sheet, or typed on the page), filled by withPrices; null = unknown */
  price?: number | null;
  priceSource?: PriceSource;
  /** pieces the supplier reported out of stock (ticked on the page; goes to the พี่เปีย file) */
  missing?: number;
  /** moved by hand to another supplier/warehouse for this round (out of stock, a substitute, a ตรวจสอบ row …) */
  moved?: boolean;
  /** the group it was in before the move */
  from?: string;
  /** Bigseller's option text of a moved ตรวจสอบ row (what the customer ordered), shown on screen */
  option?: string;
}

export interface PurchaseGroup { name: string; kind: GroupKind; lines: PurchaseLine[]; pieces: number }

// ---- sales store of an order (TikTok / Shopee + the Bigseller store) ----

const PLATFORMS: Record<string, string> = { tiktok: 'TikTok', shopee: 'Shopee', lazada: 'Lazada' };

/** "TikTok-TH-J&T Express" → TikTok; else from the store name ("Shopee PK-JEANS"). Facebook orders are not in Bigseller (they come from Page365). */
export function platformOf(carrier: string, store: string): string {
  const m = (carrier.match(/^(tiktok|shopee|lazada)/i) ?? store.match(/^(tiktok|shopee|lazada)\b/i))?.[1];
  return m ? PLATFORMS[m.toLowerCase()] : '';
}

/** "TikTok · STM-SHOP", "Shopee · PK-JEANS" (the platform is not repeated when the store name starts with it). */
export function storeLabel(store: string, carrier: string): string {
  const p = platformOf(carrier, store);
  const lower = store.toLowerCase(), pl = p.toLowerCase();
  const name = !p ? store : lower === pl ? '' : lower.startsWith(`${pl} `) ? store.slice(p.length + 1) : store;
  return p ? (name ? `${p} · ${name}` : p) : name;
}

/** An order number with its store in front, for sheets: "TikTok · STM-SHOP 586549…". */
export function orderText(order: string, stores?: Record<string, string>): string {
  const s = stores?.[order];
  return s ? `${s} ${order}` : order;
}

/** Header names per field: Bigseller in Thai (the file Benz uses), Bigseller in English, and close variants. */
const COLUMNS = {
  store: ['ร้านค้า BigSeller', 'ร้านค้า', 'BigSeller Store', 'Store', 'Shop', 'Store Name'],
  sku: ['SKU', 'Seller SKU', 'SKU ผู้ขาย', 'Merchant SKU'],
  name: ['ชื่อสินค้า', 'Product Name', 'Item Name', 'Product'],
  option: ['ชื่อตัวเลือก', 'Variation', 'Variation Name', 'Variant Name', 'Option'],
  qty: ['จำนวน', 'Quantity', 'Qty', 'Item Qty'],
  order: ['หมายเลขคำสั่งซื้อ', 'เลขที่คำสั่งซื้อ', 'เลขคำสั่งซื้อ', 'หมายเลขออเดอร์', 'เลขออเดอร์', 'Order No.', 'Order Number', 'Order ID', 'Order No', 'Order SN', 'Platform Order No.'],
  tracking: ['หมายเลขแทรคกิ้ง', 'หมายเลขติดตามพัสดุ', 'Tracking No.', 'Tracking Number', 'Tracking No'],
  carrier: ['ชื่อโลจิสติกส์', 'ขนส่ง', 'Logistics', 'Shipping Provider', 'Logistics Name', 'Shipping Carrier'],
} as const;
type Field = keyof typeof COLUMNS;

const norm = (h: string) => h.replace(/^\uFEFF/, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Which header holds each field (exact name first, case and spacing ignored). */
export function orderColumns(headers: string[]): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  for (const field of Object.keys(COLUMNS) as Field[]) {
    const found = COLUMNS[field].map(norm).map((want) => headers.find((h) => norm(h) === want)).find(Boolean);
    if (found) out[field] = found;
  }
  return out;
}

export function missingOrderColumns(headers: string[]): string[] | null {
  const cols = orderColumns(headers);
  const miss = [cols.sku ? '' : 'SKU', cols.qty ? '' : 'จำนวน'].filter(Boolean);
  return miss.length ? miss : null;
}

export function readOrderItems(rows: Record<string, string>[], headers: string[] = [...new Set(rows.flatMap((r) => Object.keys(r)))]): OrderItem[] {
  const cols = orderColumns(headers);
  const get = (r: Record<string, string>, f: Field) => (cols[f] ? String(r[cols[f]!] ?? '').trim() : '');
  return rows.map((r) => ({
    store: get(r, 'store'),
    sku: get(r, 'sku'),
    name: get(r, 'name'),
    option: get(r, 'option'),
    qty: Math.max(0, Math.round(Number(get(r, 'qty').replace(/,/g, '')) || 0)),
    order: get(r, 'order'),
    tracking: get(r, 'tracking'),
    carrier: get(r, 'carrier'),
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

/**
 * Tabs whose products are each bought from one of many suppliers, so a product without one needs a decision.
 * Other tabs may name a supplier for a few products (BBW: นอร์ท) — those get the supplier's sheet, the rest the tab's.
 */
export const SUPPLIER_TABS = ['BB'];

export interface Lookup {
  /** skuKey → catalog row (sheet rows and SKUs added on the page) */
  rows: Map<string, CatalogRow>;
  /** product key → supplier set on the page */
  suppliers: Map<string, string>;
  /** tabs whose sheet has a ร้านค้า column in use */
  /** tabs where every product must have a supplier (only BB, agreed 2026-10-13) */
  supplierTabs: Set<string>;
  /** product key → price per piece typed on the page */
  prices: Map<string, number>;
  /** product key → what the order sheets call it, typed on the page */
  labels: Map<string, string>;
}

export function makeLookup(rows: CatalogRow[], suppliers: Map<string, string>, prices: Map<string, number> = new Map(), labels: Map<string, string> = new Map()): Lookup {
  const map = new Map<string, CatalogRow>();
  const supplierTabs = new Set(SUPPLIER_TABS);
  for (const r of rows) {
    const k = skuKey(r.sku);
    if (!map.has(k)) map.set(k, r);
  }
  return { rows: map, suppliers, supplierTabs, prices, labels };
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
/**
 * Words that mark the รหัสแทน column (M) as a note rather than the supplier's code: in BB it is mostly notes —
 * "มีทุกร้าน", "**ต้องสั่งโรงงานอย่างเดียว คืนของไม่ได้", "ร้าน ส.", "เลิกผลิต", "เวลาสั่งใส่รหัสด้วย" … (2026-10-15).
 */
const NOTE_WORDS = /ร้าน|สั่ง|เลิก|มีทุก|ไม่มี|เขียน|แทน|เวลา|คืน|ลดให้|ทวง|โรงงาน|ขาย|\*/;

/** The supplier's own code from column M when it looks like one ("1306-2 สีดำ", "M700/6"); '' for notes. */
export function supplierCodeOf(alias: string): string {
  const a = alias.trim();
  return a && a.length <= 30 && /\d/.test(a) && !NOTE_WORDS.test(a) ? a : '';
}

/** A note left in column M (not a code), shown to the team on screen, never printed for the supplier. */
export function sheetNoteOf(alias: string): string {
  const a = alias.trim();
  return a && !supplierCodeOf(a) ? a : '';
}

/**
 * What the sheet calls the product: always our code + colour, so whoever reads it knows the product; when ordering
 * from a supplier, its own code from column M is added in brackets (only when it is a code, not a note).
 */
export function labelOf(r: CatalogRow, kind: GroupKind): string {
  const color = COLOR_NAMES[r.color.toUpperCase()];
  const ours = `${r.code || spuOf(r.sku)}${color ? ` ${color}` : r.color ? ` ${r.color}` : ''}`;
  const theirs = kind === 'supplier' ? supplierCodeOf(r.alias) : '';
  return theirs && !ours.startsWith(theirs) ? `${ours} (${theirs})` : ours;
}

/**
 * Model and size from Bigseller's option text when there is no usable SKU: the size is the first word after the last
 * comma — "B63, 36" → B63 / 36, "L712/2 (มิดไนท์), 30 (ซิป)" → L712/2 (มิดไนท์) / 30, "PK-001 (สีเทา), 5XL (รอบเอว 40)" → 5XL.
 */
export function optionParts(option: string): { model: string; size: string } {
  const cut = option.lastIndexOf(',');
  if (cut < 0) return { model: option.trim(), size: '' };
  const size = option.slice(cut + 1).trim().match(/^(free\s*size|freesize|\d{1,3}(?:-\d{1,3})?|\d?x{0,3}[sml]|\dxl|fe)\b/i)?.[0] ?? '';
  return { model: option.slice(0, cut).trim(), size: size.replace(/\s+/g, '') };
}

/**
 * Our SKU format: [code]-[warehouse]-[colour]-[size] with letters in the warehouse and colour parts ("2004-BB-BI-38",
 * "PK004-CN-BL-L"). A marketplace's own id ("5409161349-1729665190325-32" from Lazada) is not.
 */
export function isOurSku(sku: string): boolean {
  return /^[A-Za-z0-9.]+-[A-Za-z]{2,4}-[A-Za-z]{2,6}(-|$)/.test(sku);
}

/** The size part of a SKU that is not in the catalog ("200-BB-MD-38" → 38); '' when it has no such part. */
export function sizeFromSku(sku: string): string {
  const parts = sku.split('-');
  return parts.length >= 4 ? parts[parts.length - 1] : '';
}

/** The name typed on the page for the product, else our code + colour (+ supplier code). */
export function labelFor(r: CatalogRow, kind: GroupKind, lookup: Lookup | null): string {
  return lookup?.labels.get(`${r.tab}|${spuOf(r.sku)}`) || labelOf(r, kind);
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
        label: it.sku || '(ไม่มี SKU)', size: (it.sku ? sizeFromSku(it.sku) : '') || optionParts(it.option).size, qty: 0,
        note: `${it.sku ? 'SKU ไม่มีในแคตตาล็อก' : 'ไม่มี SKU ใน Bigseller'} · ${what}`, orders: [],
      };
    } else {
      const g = groupOf(r, lookup);
      line = { group: g.group, kind: g.kind, sku: r.sku, tab: r.tab, product: `${r.tab}|${spuOf(r.sku)}`, label: labelFor(r, g.kind, lookup), size: r.size, qty: 0, note: g.note, orders: [] };
    }
    const key = `${line.group}\u0000${line.sku}`;
    const target = lines.get(key) ?? { ...line, orders: [], stores: {} };
    target.qty += it.qty;
    if (it.order && !target.orders.includes(it.order)) target.orders.push(it.order);
    if (it.order && (it.store || it.carrier)) target.stores![it.order] = storeLabel(it.store, it.carrier);
    lines.set(key, target);
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
export interface SheetRow { label: string; size: string; qty: number; band: number; note: string; orders: string[]; stores: Record<string, string> }

export function sheetRows(g: PurchaseGroup): SheetRow[] {
  const out: SheetRow[] = [];
  let band = -1, last = '';
  for (const l of g.lines) {
    const prev = out[out.length - 1];
    if (g.kind !== 'review' && prev && prev.label === l.label && prev.size === l.size) {
      prev.qty += l.qty;
      for (const o of l.orders ?? []) if (!prev.orders.includes(o)) prev.orders.push(o);
      Object.assign(prev.stores, l.stores ?? {});
      continue;
    }
    if (l.label !== last) { band++; last = l.label; }
    out.push({ label: l.label, size: l.size, qty: l.qty, band, note: l.note, orders: [...(l.orders ?? [])], stores: { ...(l.stores ?? {}) } });
  }
  return out;
}

export const KIND_LABEL: Record<GroupKind, string> = { supplier: 'ร้านค้า', warehouse: 'โกดัง', unassigned: 'พบ SKU · ยังไม่มีร้าน', review: 'ต้องตรวจสอบ' };

// ---- Excel ----

function groupSheet(g: PurchaseGroup, date: string, round: number): Sheet {
  const rows: (Cell | string | number | null)[][] = [
    [{ v: thaiShortDate(date), s: S.title }, null, { v: g.name, s: S.title }, null, { v: `รอบ ${round}`, s: S.title }],
    [],
    ['รหัสสินค้า', 'ไซส์', 'จำนวน', 'หมายเหตุ', 'ร้านขาย · เลขคำสั่งซื้อ'].map((v) => ({ v, s: S.head })),
  ];
  for (const r of sheetRows(g)) {
    const shade = r.band % 2 === 0;
    rows.push([
      { v: r.label, s: shade ? S.bandLeft : S.boxLeft }, { v: /^\d+$/.test(r.size) ? Number(r.size) : r.size, s: shade ? S.band : S.box },
      { v: r.qty, s: shade ? S.band : S.box }, { v: r.note, s: S.boxLeft }, { v: r.orders.map((o) => orderText(o, r.stores)).join(', '), s: S.boxLeft },
    ]);
  }
  rows.push([{ v: 'รวม', s: S.boxBold }, { v: '', s: S.box }, { v: g.pieces, s: S.boxBold }, { v: '', s: S.box }, { v: '', s: S.box }]);
  return { name: g.name, rows, cols: [34, 9, 9, 24, 60], merges: ['A1:B1', 'C1:D1'] };
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

// ---- picture sheets (the China warehouse CN: pictures are easier to pick from than a list) ----

export interface PictureBlock { key: string; code: string; spu: string; color: string; image: string; sizes: { size: string; qty: number; orders: string[]; stores: Record<string, string> }[]; qty: number }
export interface ProductInfo { key: string; code: string; color: string; image: string }

/** One block per product: picture, code, colour, every size with its quantity. Same order as the sheet. */
export function pictureBlocks(g: PurchaseGroup, info: (sku: string) => ProductInfo | undefined): PictureBlock[] {
  const blocks = new Map<string, PictureBlock>();
  for (const l of g.lines) {
    const i = info(l.sku);
    const key = i?.key || l.product || l.sku;
    const b = blocks.get(key) ?? { key, code: i?.code || l.label, spu: spuOf(l.sku), color: i?.color ?? '', image: i?.image ?? '', sizes: [], qty: 0 };
    const s = b.sizes.find((x) => x.size === l.size);
    if (s) {
      s.qty += l.qty;
      for (const o of l.orders ?? []) if (!s.orders.includes(o)) s.orders.push(o);
      Object.assign(s.stores, l.stores ?? {});
    } else b.sizes.push({ size: l.size, qty: l.qty, orders: [...(l.orders ?? [])], stores: { ...(l.stores ?? {}) } });
    b.qty += l.qty;
    blocks.set(key, b);
  }
  for (const b of blocks.values()) b.sizes.sort((x, y) => compareSize(x.size, y.size));
  return [...blocks.values()];
}

/** Groups that get a picture sheet by default: the China warehouse. */
export function wantsPictures(g: PurchaseGroup): boolean {
  return g.name === 'CN' || g.lines.every((l) => l.tab === 'CN');
}

/** One parcel for a warehouse that packs orders itself (CN): the items of that order in this group, with tracking. */
export interface OrderBlock { order: string; tracking: string; carrier: string; store: string; items: { sku: string; code: string; color: string; size: string; name: string; option: string; image: string; qty: number }[]; qty: number }

/** Orders (in file order) that have items in `group`; only those items. Same SKU twice in an order is added up. */
export function orderBlocks(items: OrderItem[], lookup: Lookup, group: string, info: (sku: string) => ProductInfo | undefined): OrderBlock[] {
  const blocks = new Map<string, OrderBlock>();
  for (const it of items) {
    const r = it.sku ? lookup.rows.get(skuKey(it.sku)) : undefined;
    if (!r || groupOf(r, lookup).group !== group) continue;
    const key = it.order || `${it.tracking}|${it.store}`;
    const b = blocks.get(key) ?? { order: it.order, tracking: it.tracking, carrier: it.carrier, store: it.store, items: [], qty: 0 };
    const same = b.items.find((x) => x.sku === r.sku);
    if (same) same.qty += it.qty;
    else {
      const i = info(r.sku);
      b.items.push({ sku: r.sku, code: i?.code || r.code || spuOf(r.sku), color: r.color, size: r.size, name: it.name || r.name, option: it.option, image: i?.image ?? '', qty: it.qty });
    }
    b.qty += it.qty;
    blocks.set(key, b);
  }
  return [...blocks.values()];
}

/**
 * Rows moved by hand to another supplier or warehouse (picked or typed), for this round only: a supplier is out of
 * stock and another one has it, or a ตรวจสอบ row whose SKU is not in the catalog. Keyed by SKU (one line per SKU per
 * round). A moved catalog product is labelled with our own code + colour, since the old supplier's code means nothing
 * to the new one; a ตรวจสอบ row shows its SKU without the size part (or Bigseller's option text when it has no SKU).
 */
export function applyMoves(lines: PurchaseLine[], moves: Map<string, string>, warehouses: Set<string>, lookup: Lookup | null = null): PurchaseLine[] {
  return lines.map((l) => {
    const to = moves.get(l.sku)?.trim();
    if (!to || to === l.group) return l;
    const kind: GroupKind = warehouses.has(to) ? 'warehouse' : 'supplier';
    if (l.kind === 'review') {
      const raw = l.sku.startsWith('?') ? '' : l.sku;
      const parts = raw.split('-');
      const sized = parts.length >= 3;
      const what = l.note.split(' · ').slice(1).join(' · ');
      const opt = optionParts(what);
      // Our own SKU format names the product; a marketplace's id (Lazada "5409161349-1729665190325-32") does not,
      // so the sheet uses what the customer ordered (Bigseller's option) instead.
      const label = raw && isOurSku(raw) ? (sized ? parts.slice(0, -1).join('-') : raw)
        : (opt.size ? opt.model : what) || (raw ? (sized ? parts.slice(0, -1).join('-') : raw) : l.label);
      const size = opt.size || (raw && sized ? parts[parts.length - 1] : '') || l.size;
      return { ...l, group: to, kind, label, size, note: '', option: what, moved: true, from: l.group };
    }
    const r = lookup?.rows.get(skuKey(l.sku));
    return { ...l, group: to, kind, label: r ? labelFor(r, 'warehouse', lookup) : l.label, note: '', moved: true, from: l.group };
  });
}

// ---- out of stock → the พี่เปีย file ----

/** Name of the sheet of everything suppliers did not have, bought elsewhere by พี่เปีย. */
export const MISSING_GROUP = 'พี่เปีย';

/** How moves and out-of-stock ticks are keyed on the page: the SKU (a SKU is on one line per round). */
export const lineKey = (l: Pick<PurchaseLine, 'sku'>) => l.sku;

/**
 * Every ticked line of the round, with the ticked quantity, as one group named พี่เปีย. Labels are the product's own
 * code + colour (not the old supplier's code, which means nothing elsewhere); the note says which supplier lacked it.
 */
export function missingGroup(lines: PurchaseLine[], missing: Map<string, number>, lookup: Lookup | null): PurchaseGroup | null {
  const out: PurchaseLine[] = [];
  for (const l of lines) {
    const n = Math.min(l.qty, missing.get(lineKey(l)) ?? 0);
    if (n <= 0) continue;
    const r = lookup?.rows.get(skuKey(l.sku));
    out.push({ ...l, group: MISSING_GROUP, kind: 'supplier', label: r ? labelFor(r, 'warehouse', lookup) : l.label, qty: n, note: `ไม่มีที่ ${l.group}`, missing: n });
  }
  if (!out.length) return null;
  return groupLines(out)[0];
}

// ---- what we pay suppliers (internal: never on the sheets sent to them) ----

/** cost = ทุน, column H of the sheet (the only sheet column used, agreed 2026-10-15) · web = typed on the page */
export type PriceSource = 'web' | 'cost' | '';
export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = { web: 'กรอกในเว็บ', cost: 'ทุนในชีต (H)', '': 'ยังไม่มีทุน' };

/** Price per piece of a catalog SKU: typed on the page (fills or corrects a missing ทุน) > ทุน, column H. ราคาร้านค้า (N) is not used. */
export function priceOf(sku: string, lookup: Lookup): { price: number | null; source: PriceSource } {
  const r = lookup.rows.get(skuKey(sku));
  if (!r) return { price: null, source: '' };
  const typed = lookup.prices.get(`${r.tab}|${spuOf(r.sku)}`);
  if (typed !== undefined) return { price: typed, source: 'web' };
  if (r.cost !== null && r.cost > 0) return { price: r.cost, source: 'cost' };
  return { price: null, source: '' };
}

/**
 * Current price per piece and current label for every catalog line — also for rounds reopened from history, so a
 * sheet saved with an old label (e.g. "ร้าน ส." from column M) prints the product's code when printed again.
 */
export function withPrices(lines: PurchaseLine[], lookup: Lookup): PurchaseLine[] {
  return lines.map((l) => {
    const p = priceOf(l.sku, lookup);
    const r = l.kind === 'review' ? undefined : lookup.rows.get(skuKey(l.sku));
    const label = r ? labelFor(r, l.moved ? 'warehouse' : l.kind, lookup) : l.label;
    return { ...l, label, sheetNote: r ? sheetNoteOf(r.alias) : '', price: p.price, priceSource: p.source };
  });
}

export interface SupplierTotal { name: string; kind: GroupKind; ordered: number; missing: number; received: number; amount: number; unpriced: number }

/** Per supplier/warehouse: pieces ordered, out of stock, received, amount owed for what was received, pieces without a price. */
export function supplierTotals(groups: PurchaseGroup[], missing: Map<string, number>): SupplierTotal[] {
  return groups.filter((g) => g.kind !== 'review').map((g) => {
    const t: SupplierTotal = { name: g.name, kind: g.kind, ordered: 0, missing: 0, received: 0, amount: 0, unpriced: 0 };
    for (const l of g.lines) {
      const miss = g.name === MISSING_GROUP ? 0 : Math.min(l.qty, missing.get(lineKey(l)) ?? 0);
      const got = l.qty - miss;
      t.ordered += l.qty; t.missing += miss; t.received += got;
      if (l.price != null) t.amount += got * l.price; else t.unpriced += got;
    }
    return t;
  });
}

const money = (n: number) => Math.round(n * 100) / 100;

/** Internal workbook: what to pay each supplier (summary), then each one's lines with price and amount. Not for suppliers. */
export async function paymentWorkbook(groups: PurchaseGroup[], missing: Map<string, number>, date: string, round: number): Promise<Uint8Array> {
  const totals = supplierTotals(groups, missing);
  const sum = (f: keyof SupplierTotal) => totals.reduce((n, t) => n + (t[f] as number), 0);
  const summary: Sheet = {
    name: 'สรุปจ่ายร้าน',
    rows: [
      [{ v: `สรุปยอดจ่ายร้าน ${thaiShortDate(date)} รอบ ${round} (ภายใน ไม่ส่งร้าน)`, s: S.bold }],
      [],
      ['ร้าน / โกดัง', 'ประเภท', 'สั่ง', 'ของไม่มี', 'ได้จริง', 'ยอดเงิน', 'ยังไม่มีทุน (ชิ้น)'].map((v) => ({ v, s: S.head })),
      ...totals.map((t) => [{ v: t.name, s: S.boxLeft }, { v: t.name === MISSING_GROUP ? 'สั่งข้างนอก' : KIND_LABEL[t.kind], s: S.box }, { v: t.ordered, s: S.box }, { v: t.missing, s: S.box }, { v: t.received, s: S.box }, { v: money(t.amount), s: S.box }, { v: t.unpriced || '', s: S.box }]),
      [{ v: 'รวม', s: S.boxBold }, { v: '', s: S.box }, { v: sum('ordered'), s: S.boxBold }, { v: sum('missing'), s: S.boxBold }, { v: sum('received'), s: S.boxBold }, { v: money(sum('amount')), s: S.boxBold }, { v: sum('unpriced') || '', s: S.boxBold }],
    ],
    cols: [26, 16, 8, 10, 9, 14, 18],
  };
  const sheets: Sheet[] = [summary];
  for (const g of groups) {
    if (g.kind === 'review') continue;
    const rows: (Cell | string | number | null)[][] = [
      [{ v: `${g.name} · ${thaiShortDate(date)} รอบ ${round} (ภายใน)`, s: S.bold }],
      [],
      ['รหัสสินค้า', 'ไซส์', 'SKU', 'สั่ง', 'ของไม่มี', 'ได้จริง', 'ทุน/ตัว', 'ที่มา', 'ยอดเงิน', 'ร้านขาย · เลขคำสั่งซื้อ'].map((v) => ({ v, s: S.head })),
    ];
    let amount = 0;
    for (const l of g.lines) {
      const miss = g.name === MISSING_GROUP ? 0 : Math.min(l.qty, missing.get(lineKey(l)) ?? 0);
      const got = l.qty - miss;
      const line = l.price != null ? got * l.price : null;
      if (line !== null) amount += line;
      rows.push([
        { v: l.label, s: S.boxLeft }, { v: l.size, s: S.box }, { v: l.sku.startsWith('?') ? '' : l.sku, s: S.boxLeft }, { v: l.qty, s: S.box }, { v: miss || '', s: S.box },
        { v: got, s: S.box }, { v: l.price ?? '', s: S.box }, { v: PRICE_SOURCE_LABEL[l.priceSource ?? ''], s: S.box }, { v: line === null ? '' : money(line), s: S.box },
        { v: (l.orders ?? []).map((o) => orderText(o, l.stores)).join(', '), s: S.boxLeft },
      ]);
    }
    rows.push([{ v: 'รวม', s: S.boxBold }, ...Array.from({ length: 7 }, () => ({ v: '', s: S.box })), { v: money(amount), s: S.boxBold }, { v: '', s: S.box }]);
    sheets.push({ name: g.name, rows, cols: [30, 8, 22, 7, 9, 8, 10, 13, 12, 60] });
  }
  return buildXlsx(sheets);
}

// ---- order rows for the units-sold page ----

/**
 * One row per order + SKU of the file (catalog SKU when known), with its sales store — saved with the round so the
 * units-sold page can count each order once even when it comes back in a later round. Rows without an order number
 * get a key of their own so they are never merged with others.
 */
export function saleItems(items: OrderItem[], lookup: Lookup, roundKey: string): { order: string; sku: string; qty: number; store: string }[] {
  return items.map((it, i) => {
    const r = it.sku ? lookup.rows.get(skuKey(it.sku)) : undefined;
    return {
      order: it.order || `?${roundKey}#${i}`,
      sku: r ? r.sku : it.sku || `?${it.name.slice(0, 60)} · ${it.option}`,
      qty: it.qty,
      store: storeLabel(it.store, it.carrier),
    };
  });
}
