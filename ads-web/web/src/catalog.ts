// Product catalog logic shared by the /catalog page and the Worker (no DOM, no worker imports).
// Source: the SKU+Price sheet, one tab per warehouse. Columns A–J are the same on every tab
// (A SPU · B SKU · C รหัสสินค้า · D รายละเอียด · E สี · F size · G คลังสินค้า · H ทุน · I ราคา · J ลิงก์รูป);
// the supplier columns after that differ per tab, so they are found by header name (ร้านค้า, รหัสแทน, ราคาร้านค้า, รหัสเก่า).

export interface CatalogRow {
  tab: string;
  sku: string;
  pos: number;
  spu: string;
  code: string;
  name: string;
  color: string;
  size: string;
  wh: string;
  cost: number | null;
  price: number | null;
  image: string;
  shop: string;
  alias: string;
  shop_price: number | null;
  old_code: string;
}

/** Wire order for rows sent as arrays (GET /api/catalog/rows, POST /api/catalog/sync). */
export const ROW_FIELDS = ['tab', 'sku', 'pos', 'spu', 'code', 'name', 'color', 'size', 'wh', 'cost', 'price', 'image', 'shop', 'alias', 'shop_price', 'old_code'] as const;
const NUMERIC = new Set(['pos', 'cost', 'price', 'shop_price']);

/** A SKU added on the website, kept apart from the sheet copy. */
export interface WebSku {
  sku: string;
  tab: string;
  code: string;
  name: string;
  color: string;
  size: string;
  cost: number | null;
  price: number | null;
  image: string;
  shop: string;
  alias: string;
  note: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const MAX_SKU_LENGTH = 64;
const MAX_TEXT = 500;

// ---- cleaning ----

/** Zero-width characters and no-break spaces hide in copy-pasted SKUs (Bigseller had "5012-PK-NV-30​"). */
export function cleanSku(s: unknown): string {
  return String(s ?? '').replace(/[​-‍⁠﻿ \s]/g, '');
}

/** Case-insensitive key for matching SKUs from other systems. */
export function skuKey(s: unknown): string {
  return cleanSku(s).toUpperCase();
}

export function cleanText(s: unknown, max = MAX_TEXT): string {
  return String(s ?? '').replace(/[​-‍⁠﻿]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function parseNumber(s: unknown): number | null {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const t = String(s ?? '').replace(/[,\s฿]/g, '').replace(/บาท$/, '');
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** A row from the network or a form, made safe to store. Throws on a missing or malformed SKU. */
export function normaliseRow(input: Record<string, unknown>): CatalogRow {
  const sku = cleanSku(input.sku);
  if (!sku) throw new Error('ไม่มี SKU');
  if (sku.length > MAX_SKU_LENGTH) throw new Error(`SKU ยาวเกิน ${MAX_SKU_LENGTH} ตัวอักษร: ${sku.slice(0, 20)}…`);
  const tab = cleanText(input.tab, 40);
  if (!tab) throw new Error(`ไม่มีชื่อแท็บของ ${sku}`);
  return {
    tab,
    sku,
    pos: Math.max(0, Math.trunc(parseNumber(input.pos) ?? 0)),
    spu: cleanText(input.spu, 80),
    code: cleanText(input.code, 80),
    name: cleanText(input.name),
    color: cleanText(input.color, 40),
    size: cleanText(input.size, 40),
    wh: cleanText(input.wh, 40),
    cost: parseNumber(input.cost),
    price: parseNumber(input.price),
    image: cleanImage(input.image),
    shop: cleanText(input.shop, 80),
    alias: cleanText(input.alias, 120),
    shop_price: parseNumber(input.shop_price),
    old_code: cleanText(input.old_code, 120),
  };
}

function cleanImage(s: unknown): string {
  const t = String(s ?? '').trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(t) && t.length <= 2000 ? t : '';
}

export function rowToArray(r: CatalogRow): unknown[] {
  return ROW_FIELDS.map((f) => r[f]);
}

export function rowFromArray(a: unknown[]): CatalogRow {
  const o: Record<string, unknown> = {};
  ROW_FIELDS.forEach((f, i) => { o[f] = a[i] ?? (NUMERIC.has(f) ? null : ''); });
  return o as unknown as CatalogRow;
}

// ---- reading a sheet tab ----

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export interface ParsedTab {
  tab: string;
  rows: CatalogRow[];
  /** SKUs listed more than once in the tab (the first row wins) */
  duplicates: string[];
  /** Rows with something in column B that is not a usable SKU */
  skipped: number;
  error?: string;
}

/** Columns found by header text, since they sit in different places per tab. */
function namedColumns(header: string[]) {
  const h = header.map((x) => cleanText(x));
  const find = (test: (s: string) => boolean) => { const i = h.findIndex(test); return i < 0 ? null : i; };
  return {
    shop_price: find((s) => s.includes('ราคาร้านค้า')),
    shop: find((s) => s.includes('ร้านค้า') && !s.includes('ราคา')),
    alias: find((s) => s.startsWith('รหัสแทน')),
    old_code: find((s) => s.startsWith('รหัสเก่า')),
  };
}

/** A tab's CSV export (`/export?format=csv&gid=…`) → catalog rows. Header = the first row whose column B is "SKU". */
export function parseSheetTab(tab: string, csv: string): ParsedTab {
  const table = parseCsv(csv);
  const hi = table.slice(0, 8).findIndex((r) => cleanText(r[1]).toUpperCase() === 'SKU');
  if (hi < 0) return { tab, rows: [], duplicates: [], skipped: 0, error: 'ไม่พบหัวตาราง (คอลัมน์ B ต้องเป็น "SKU")' };
  const named = namedColumns(table[hi]);
  const cell = (r: string[], i: number | null) => (i === null ? '' : r[i] ?? '');
  const seen = new Set<string>();
  const rows: CatalogRow[] = [];
  const duplicates: string[] = [];
  let skipped = 0;
  for (let i = hi + 1; i < table.length; i++) {
    const r = table[i];
    const sku = cleanSku(r[1]);
    if (!sku) continue;
    if (sku.length > MAX_SKU_LENGTH || !sku.includes('-') || sku.toUpperCase() === 'SKU') { skipped++; continue; }
    if (seen.has(sku)) { duplicates.push(sku); continue; }
    seen.add(sku);
    rows.push(normaliseRow({
      tab, sku, pos: i + 1,
      spu: r[0], code: r[2], name: r[3], color: r[4], size: r[5], wh: r[6], cost: r[7], price: r[8], image: r[9],
      shop: cell(r, named.shop), alias: cell(r, named.alias), shop_price: cell(r, named.shop_price), old_code: cell(r, named.old_code),
    }));
  }
  return { tab, rows, duplicates, skipped };
}

/**
 * What has to be written to make the stored tab match the sheet: changed/new rows and SKUs no longer there.
 * A row that only moved (rows inserted or deleted above it) is not rewritten: a deletion shifts every row below by
 * the same amount, so their order is unchanged, and rewriting them cost ~2k D1 writes for one deleted product.
 */
export function diffTab(stored: CatalogRow[], incoming: CatalogRow[]): { upsert: CatalogRow[]; remove: string[] } {
  const before = new Map(stored.map((r) => [r.sku, r]));
  const upsert = incoming.filter((r) => {
    const old = before.get(r.sku);
    return !old || ROW_FIELDS.some((f) => f !== 'pos' && old[f] !== r[f]);
  });
  const now = new Set(incoming.map((r) => r.sku));
  const remove = stored.filter((r) => !now.has(r.sku)).map((r) => r.sku);
  return { upsert, remove };
}

// ---- display ----

const LETTER_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL', '7XL'];
const LETTER_ALIASES: Record<string, string> = { XXL: '2XL', XXXL: '3XL', XXXXL: '4XL' };

/** Waist sizes in number order, then S…5XL, then anything else (Free size, FE) alphabetically. */
export function sizeRank(size: string): [number, number, string] {
  const s = size.trim().toUpperCase();
  const n = /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  if (Number.isFinite(n)) return [0, n, ''];
  const letter = LETTER_SIZES.indexOf(LETTER_ALIASES[s] ?? s);
  if (letter >= 0) return [1, letter, ''];
  return [2, 0, s];
}

export function compareSize(a: string, b: string): number {
  const x = sizeRank(a), y = sizeRank(b);
  return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
}

/** Smaller copy of a product image where the host offers one (Shopee `_tn` ≈ 20 KB instead of 90 KB; Drive thumbnails). */
export function thumb(url: string): string {
  if (!url) return '';
  if (/^https:\/\/cf\.shopee\.co\.th\/file\/[\w-]+$/.test(url)) return `${url}_tn`;
  let m = url.match(/^https:\/\/(down-[a-z]+\.img\.susercontent\.com)\/(?:file\/)?([\w-]+)$/);
  if (m) return `https://${m[1]}/file/${m[2]}_tn`;
  m = url.match(/^https:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/);
  if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w400`;
  return url;
}

/** The product (all sizes of one model + colour): the SKU without its last part. */
export function spuOf(sku: string): string {
  const parts = sku.split('-');
  return parts.length >= 3 ? parts.slice(0, -1).join('-') : sku;
}

export interface Product {
  key: string;
  tab: string;
  spu: string;
  code: string;
  name: string;
  color: string;
  /** Large picture; `thumb` is the small one for cards */
  image: string;
  thumb: string;
  /** Where the picture comes from: added on the page, the sheet's column J, or none */
  imageSource: 'page' | 'sheet' | '';
  shops: string[];
  aliases: string[];
  skus: (CatalogRow & { web?: WebSku })[];
  pos: number;
  cost: [number, number] | null;
  price: [number, number] | null;
  /** Some sizes were added on the website and are not in the sheet yet */
  web: boolean;
  hay: string;
}

function range(values: (number | null)[]): [number, number] | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? [Math.min(...v), Math.max(...v)] : null;
}

export function webToRow(w: WebSku, pos: number): CatalogRow & { web: WebSku } {
  return {
    tab: w.tab, sku: w.sku, pos, spu: spuOf(w.sku), code: w.code, name: w.name, color: w.color, size: w.size, wh: '',
    cost: w.cost, price: w.price, image: w.image, shop: w.shop, alias: w.alias, shop_price: null, old_code: '', web: w,
  };
}

/** A picture added on the page for one product (key = `${tab}|${spu}`). */
export interface ImageOverride { full: string; thumb: string }

/**
 * Rows → products (one card per SKU-minus-size), in sheet order. Web SKUs already in the sheet are left out.
 * A picture added on the page wins over column J.
 */
export function groupProducts(rows: CatalogRow[], web: WebSku[] = [], images: Map<string, ImageOverride> = new Map()): Product[] {
  const inSheet = new Set(rows.map((r) => skuKey(r.sku)));
  const all: (CatalogRow & { web?: WebSku })[] = [...rows, ...web.filter((w) => !inSheet.has(skuKey(w.sku))).map((w) => webToRow(w, 1e9))];
  const groups = new Map<string, (CatalogRow & { web?: WebSku })[]>();
  for (const r of all) {
    const key = `${r.tab}|${spuOf(r.sku)}`;
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }
  const out: Product[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => compareSize(a.size, b.size) || a.sku.localeCompare(b.sku));
    const first = (f: 'code' | 'name' | 'color' | 'image') => list.find((r) => r[f])?.[f] ?? '';
    const uniq = (f: 'shop' | 'alias') => [...new Set(list.map((r) => r[f]).filter(Boolean))];
    const added = images.get(key);
    const sheetImage = first('image');
    const p: Product = {
      key,
      tab: list[0].tab,
      spu: spuOf(list[0].sku),
      code: first('code'),
      name: first('name'),
      color: first('color'),
      image: added?.full ?? sheetImage,
      thumb: added?.thumb ?? thumb(sheetImage),
      imageSource: added ? 'page' : sheetImage ? 'sheet' : '',
      shops: uniq('shop'),
      aliases: uniq('alias'),
      skus: list,
      pos: Math.min(...list.map((r) => r.pos)),
      cost: range(list.map((r) => r.cost)),
      price: range(list.map((r) => r.price)),
      web: list.some((r) => r.web),
      hay: '',
    };
    p.hay = [p.spu, p.code, p.name, p.color, COLOR_NAMES[p.color.toUpperCase()] ?? '', ...p.shops, ...p.aliases, ...list.map((r) => `${r.sku} ${r.old_code}`)]
      .join(' ').toLowerCase();
    out.push(p);
  }
  return out.sort((a, b) => a.tab.localeCompare(b.tab) || a.pos - b.pos);
}

export interface Hit {
  product: Product;
  /** Sizes the query named (e.g. "501/1 32" → 32) */
  sizes: Set<string>;
  score: number;
}

/**
 * Every word must match the product (SKU, code, name, colour, supplier, supplier code, old code) or one of its sizes.
 * "501/1 32" finds 501/1 and marks size 32; a full SKU puts that product first.
 */
export function search(products: Product[], query: string): Hit[] {
  const words = cleanText(query).toLowerCase().split(' ').filter(Boolean);
  if (!words.length) return products.map((product) => ({ product, sizes: new Set(), score: 0 }));
  const hits: Hit[] = [];
  for (const product of products) {
    const sizes = new Set<string>();
    let score = 0;
    let ok = true;
    for (const w of words) {
      const size = product.skus.find((r) => r.size.toLowerCase() === w);
      if (size) { sizes.add(size.size); continue; }
      if (!product.hay.includes(w)) { ok = false; break; }
      if (product.skus.some((r) => r.sku.toLowerCase() === w)) {
        score += 100;
        const r = product.skus.find((x) => x.sku.toLowerCase() === w)!;
        if (r.size) sizes.add(r.size);
      } else if (product.code.toLowerCase() === w || product.spu.toLowerCase() === w) score += 50;
      else if (product.aliases.some((a) => a.toLowerCase() === w)) score += 30;
    }
    if (ok) hits.push({ product, sizes, score });
  }
  return hits.sort((a, b) => b.score - a.score);
}

// ---- building new SKUs ----

/** "501/1" → "5011", "PK-004" → "PK004": how the sheet turns a product code into the first part of its SKUs. */
export function codeToPrefix(code: string): string {
  return code.normalize('NFKC').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/** The location part most SKUs of a tab use (tab MNM → "MN", JW → "CJ"). */
export function locationOf(rows: CatalogRow[], tab: string): string {
  const count = new Map<string, number>();
  for (const r of rows) {
    if (r.tab !== tab) continue;
    const loc = r.sku.split('-')[1];
    if (loc) count.set(loc, (count.get(loc) ?? 0) + 1);
  }
  let best = tab, n = 0;
  for (const [k, v] of count) if (v > n) { best = k; n = v; }
  return best;
}

export function parseSizes(text: string): string[] {
  const out: string[] = [];
  for (const s of text.split(/[\s,/]+/)) {
    const t = s.trim().toUpperCase();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.sort(compareSize);
}

/** [รหัส]-[โกดัง]-[สี]-[ขนาด] */
export function buildSku(prefix: string, loc: string, color: string, size: string): string {
  return [prefix, loc, color, size].map((p) => cleanSku(p).toUpperCase()).join('-');
}

/** Rows to paste into the sheet (columns A–J, plus L ร้านค้า when any row has a supplier). */
export function toSheetTsv(rows: WebSku[], loc: (tab: string) => string): string {
  const withShop = rows.some((r) => r.shop);
  return rows.map((r) => {
    const cells = [spuOf(r.sku), r.sku, r.code, r.name, r.color, r.size, loc(r.tab), r.cost ?? '', r.price ?? '', r.image];
    if (withShop) cells.push('', r.shop);
    return cells.map((c) => String(c).replace(/[\t\n]/g, ' ')).join('\t');
  }).join('\n');
}

/** Warehouse (tab) names, from the sheet's คู่มือ tab. */
export const WAREHOUSE_NAMES: Record<string, string> = {
  AR: 'อารียา', BB: 'โบ๊เบ๊', BBW: 'โบ๊เบ๊ ผู้หญิง', BLD: 'BLADE', GG: 'จิกก้า168', BT: 'Bentoy', CM: 'Climax', CN: 'โกดังจีน',
  JW: 'Jewelry', PK: 'พีเค', MNM: 'MONO ชาย', MNW: 'MONO หญิง', MK: 'Markchelin', AM: 'A&M', SP: 'Sport',
};

/** Values people put in the ร้านค้า column that are a status, not a supplier. */
export const SHOP_STATUSES = new Set(['เลิกผลิต', 'หมด', 'ไม่เคยมีการสั่ง', 'ไม่มีประวัติการสั่ง']);
export const NO_SHOP = '(ไม่ระบุร้าน)';

/** A product's suppliers for filtering; products with no supplier at all count as NO_SHOP. */
export function shopsOf(p: Pick<Product, 'shops'>): string[] {
  return p.shops.length ? p.shops : [NO_SHOP];
}

/** Colour codes from the sheet's คู่มือ tab. */
export const COLOR_NAMES: Record<string, string> = {
  BL: 'ดำ', BD: 'สนิมดำ', BW: 'ดำฟอก', FL: 'ฟอกซีด', FD: 'ฟอกเข้ม', MD: 'มิดไนท์', NV: 'กรม', NB: 'กรมไบโอ', NR: 'กรมย้อมสนิม',
  MR: 'มิดไนท์ย้อมสนิม', MB: 'มิดไนท์ไบโอ', BI: 'ฟอกไบโอ', SB: 'ฟ้า', PB: 'ฟ้าซีด', DB: 'ฟ้าเข้ม', BN: 'น้ำตาล', BR: 'น้ำตาลเข้ม',
  LB: 'น้ำตาลอ่อน', OG: 'เขียวขี้ม้า', KH: 'กากี', GY: 'เทา', LG: 'เทาอ่อน', GB: 'เทาฟ้า', CR: 'ครีม', TL: 'น้ำทะเล', JN: 'สียีนส์',
  WT: 'ขาว', OW: 'Off-White', GN: 'เขียว', OR: 'ส้ม', RE: 'แดง', DR: 'แดงเข้ม', MI: 'ไมโล', OV: 'โอวัลติน', PU: 'ม่วง', LP: 'ม่วงอ่อน',
  RB: 'เรนโบว์', PK: 'ชมพู', PP: 'ชมพูพาสเทล', MAG: 'บานเย็น', BU: 'น้ำเงิน', YL: 'เหลือง', PY: 'เหลืองพาสเทล', CF: 'กาแฟ', PC: 'พีช',
  MG: 'เขียวมิ้น', NG: 'เขียวนีออน', BG: 'เบจ', MS: 'มัสตาร์ด', CC: 'ชาร์โคล', CA: 'คาราเมล', OL: 'โอลีฟ', GD: 'ทอง', JD: 'หยก', CB: 'โกโก้',
  FLGO: 'ฟอกซีดด้ายทอง',
};

export function colorLabel(code: string): string {
  const name = COLOR_NAMES[code.toUpperCase()];
  return name ? `${code} ${name}` : code;
}
