// Bigseller order export → GoSell "Import Orders" template. Runs in the browser only (the export holds customer
// names, phones and addresses; nothing is sent to the server). The export has one row per item; GoSell wants one
// row per order with "SKU (qty), SKU (qty)" and per-SKU prices, so items are grouped by order number.
// The template's own sheet XML is filled in place (rows 9+), so its dropdowns, formats and carriers sheet stay as
// GoSell made them.

import { unzip, zip } from './zip.ts';

export type SourceRow = Record<string, string>;

export interface GoSellOrder {
  orderNo: string;
  customer: string;     // A
  phone: string;        // B
  social: string;       // D
  payment: 'COD' | 'การโอนเงิน'; // E
  address: string;      // F
  subdistrict: string;  // G
  district: string;     // H
  province: string;     // I
  zip: string;          // J
  carrier: string;      // L — one of CARRIERS
  skus: string;         // M "SKU (1), SKU (2)"
  prices: string;       // N per SKU, comma separated
  orderDiscount: number; // P
  shipping: number;      // Q (always 0: the export's shipping charge is the COD fee)
  codFee: number;        // R
  orderedAt: string;     // S "2026-10-08 10:27"
  note: string;          // T label note
  total: number;         // the export's Total, for the preview
  problems: string[];    // empty = ready to import
}

/** The template's hidden "carriers" sheet; GoSell refuses anything else. */
export const CARRIERS = ['KEX', 'Flash Express', 'J&T Express', 'Best Express', 'KEX (Pick up)', 'Shopee Xpress', 'DHL eCommerce (Economy)', 'Flash Express Bulky', 'DHL eCommerce (Next day)', 'DHL eCommerce (Temperature control)', 'Inter Express Logistics', 'BS Express (Bigsize)', 'KEX Bulky', 'J&T Express (SP)', 'Thailand Post'];

const PROVINCES = ['กรุงเทพมหานคร', 'กระบี่', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร', 'ขอนแก่น', 'จันทบุรี', 'ฉะเชิงเทรา', 'ชลบุรี', 'ชัยนาท', 'ชัยภูมิ', 'ชุมพร', 'เชียงราย', 'เชียงใหม่', 'ตรัง', 'ตราด', 'ตาก', 'นครนายก', 'นครปฐม', 'นครพนม', 'นครราชสีมา', 'นครศรีธรรมราช', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส', 'น่าน', 'บึงกาฬ', 'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์', 'ปราจีนบุรี', 'ปัตตานี', 'พระนครศรีอยุธยา', 'พะเยา', 'พังงา', 'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'เพชรบุรี', 'เพชรบูรณ์', 'แพร่', 'ภูเก็ต', 'มหาสารคาม', 'มุกดาหาร', 'แม่ฮ่องสอน', 'ยโสธร', 'ยะลา', 'ร้อยเอ็ด', 'ระนอง', 'ระยอง', 'ราชบุรี', 'ลพบุรี', 'ลำปาง', 'ลำพูน', 'เลย', 'ศรีสะเกษ', 'สกลนคร', 'สงขลา', 'สตูล', 'สมุทรปราการ', 'สมุทรสงคราม', 'สมุทรสาคร', 'สระแก้ว', 'สระบุรี', 'สิงห์บุรี', 'สุโขทัย', 'สุพรรณบุรี', 'สุราษฎร์ธานี', 'สุรินทร์', 'หนองคาย', 'หนองบัวลำภู', 'อ่างทอง', 'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์', 'อุทัยธานี', 'อุบลราชธานี'];
const PROVINCE_ALIASES: Record<string, string> = { 'กทม': 'กรุงเทพมหานคร', 'กทม.': 'กรุงเทพมหานคร', 'กรุงเทพ': 'กรุงเทพมหานคร', 'กรุงเทพฯ': 'กรุงเทพมหานคร', 'โคราช': 'นครราชสีมา', 'อยุธยา': 'พระนครศรีอยุธยา' };

/** CSV/TSV bytes → rows keyed by header. Bigseller exports UTF-16 with tabs; UTF-8 (or Thai Windows-874) and commas also work. */
export function parseExport(bytes: Uint8Array): { headers: string[]; rows: SourceRow[] } {
  const table = exportGrid(bytes);
  const headers = (table[0] ?? []).map((h) => h.trim());
  const rows = table.slice(1).filter((r) => r.some((c) => c.trim())).map((r) => {
    const o: SourceRow = {};
    headers.forEach((h, i) => { if (!(h in o)) o[h] = (r[i] ?? '').trim(); });
    return o;
  });
  return { headers, rows };
}

/** CSV/TSV bytes → rows of cells (any encoding parseExport reads), header not assumed. */
export function exportGrid(bytes: Uint8Array): string[][] {
  let text: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
  // No BOM but every other byte zero = UTF-16 LE anyway (some re-saves drop the BOM).
  else if (bytes.length > 3 && bytes[1] === 0 && bytes[3] === 0) text = new TextDecoder('utf-16le').decode(bytes);
  else text = decodeUtf8OrThai(bytes).replace(/^\uFEFF/, '');
  // Separator from the first lines, not only the first (some reports start with a title line).
  const head = text.split('\n', 20).join('\n');
  const sep = (head.match(/\t/g)?.length ?? 0) >= (head.match(/,/g)?.length ?? 0) ? '\t' : ',';
  return splitDelimited(text, sep);
}

/** UTF-8, or Windows-874 (TIS-620) when it is not valid UTF-8 — what Thai Excel writes when a CSV is re-saved. */
function decodeUtf8OrThai(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes); } catch { return new TextDecoder('windows-874').decode(bytes); }
}

function splitDelimited(text: string, sep: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}

/** Columns the file must have; null = fine. Two layouts work: one row per item (No. + SKU/Item Qty/Item Price), or
 *  one row per order (Order no. + Item Detail, as in the .xlsx export). */
export function missingColumns(headers: string[]): string[] | null {
  const has = (h: string) => headers.includes(h);
  const base = ['Customer Name', 'Customer Phone', 'Customer Address'].filter((h) => !has(h));
  if (!has('No.') && !has('Order no.')) base.unshift('No. / Order no.');
  const items = has('SKU') && has('Item Qty') && has('Item Price') ? [] : has('Item Detail') ? [] : ['SKU, Item Qty, Item Price (หรือ Item Detail)'];
  const out = [...base, ...items];
  return out.length ? out : null;
}

/** "ชื่อ (SKU) (CF code) x3 THB 1107.0", one item per line; THB is the line total. */
export function parseItemDetail(detail: string): { sku: string; qty: number; price: number }[] | null {
  const out: { sku: string; qty: number; price: number }[] = [];
  for (const line of detail.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/\(([^()]+)\)\s*(?:\(([^()]+)\)\s*)?x\s*(\d+)\s*THB\s*([\d.,]+)\s*$/i);
    if (!m) return null;
    // Two brackets = SKU then CF code (the same here); take the first.
    const sku = m[1].trim();
    const qty = Number(m[3]);
    const lineTotal = Number(m[4].replace(/,/g, ''));
    out.push({ sku, qty, price: qty > 0 ? Math.round((lineTotal / qty) * 100) / 100 : lineTotal });
  }
  return out.length ? out : null;
}

/** One-row-per-order files → one row per item, same keys as the item layout. Unreadable details keep one empty item. */
function expandOrders(rows: SourceRow[]): SourceRow[] {
  if (!rows.some((r) => 'Item Detail' in r) || rows.some((r) => r['SKU'])) return rows;
  return rows.flatMap((r) => {
    const items = parseItemDetail(r['Item Detail'] ?? '');
    const no = r['No.'] || r['Order no.'] || '';
    if (!items) return [{ ...r, 'No.': no, SKU: '', 'Item Qty': '0', 'Item Price': '0', _detailError: r['Item Detail'] ?? '' }];
    return items.map((i) => ({ ...r, 'No.': no, SKU: i.sku, 'Item Qty': String(i.qty), 'Item Price': String(i.price) }));
  });
}

/** "70/2 ม.13 ต.ทุ่งปรัง อ.สิชล จ.นครศรีธรรมราช 80120" → parts. Bangkok's แขวง/เขต too. Missing parts are ''. */
export function splitAddress(raw: string): { address: string; subdistrict: string; district: string; province: string; zip: string } {
  let s = raw.replace(/\s+/g, ' ').trim();
  let zipCode = '';
  const z = s.match(/\s*(\d{5})\s*$/);
  if (z) { zipCode = z[1]; s = s.slice(0, z.index).trim(); }
  // Take each marker's last occurrence, right to left, so "ซอย"/"ถนน" text earlier in the line can't match.
  const take = (re: RegExp) => {
    let m: RegExpExecArray | null, last: RegExpExecArray | null = null;
    const g = new RegExp(re.source, 'g');
    while ((m = g.exec(s))) last = m;
    if (!last) return '';
    const value = s.slice(last.index + last[0].length).trim();
    s = s.slice(0, last.index).trim();
    return value;
  };
  let province = take(/(?:^|\s)(?:จ\.|จังหวัด)\s*/);
  if (!province) {
    const bkk = s.match(/\s*(กรุงเทพมหานคร|กรุงเทพฯ?|กทม\.?)$/);
    if (bkk) { province = bkk[1]; s = s.slice(0, bkk.index).trim(); }
  }
  const district = take(/(?:^|\s)(?:อ\.|อำเภอ|เขต)\s*/);
  const subdistrict = take(/(?:^|\s)(?:ต\.|ตำบล|แขวง)\s*/);
  province = PROVINCE_ALIASES[province] ?? province;
  return { address: s, subdistrict, district, province, zip: zipCode };
}

export function carrierFor(shippingOption: string): string {
  const s = shippingOption.toLowerCase();
  if (s.includes('kerry') || s.includes('kex')) return 'KEX';
  if (s.includes('flash')) return 'Flash Express';
  if (s.includes('j&t') || s.includes('jt express')) return 'J&T Express';
  if (s.includes('best')) return 'Best Express';
  if (s.includes('shopee')) return 'Shopee Xpress';
  if (s.includes('dhl')) return 'DHL eCommerce (Economy)';
  if (s.includes('ไปรษณีย์') || s.includes('thailand post') || s.includes('ems')) return 'Thailand Post';
  return '';
}

const num = (v: string | undefined) => {
  const n = Number((v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const money = (n: number) => String(Math.round(n * 100) / 100);

/** Carrier used when none is picked on the page: the shop's J&T special rate (2026-10). */
export const DEFAULT_CARRIER = 'J&T Express (SP)';

/** Groups item rows into orders and maps them to GoSell's columns. Cancelled orders are left out.
 *  `carrier` sets every order's carrier; '' = map each order's Shipping Option (carrierFor). */
export function toGoSell(rows: SourceRow[], carrier = DEFAULT_CARRIER): { orders: GoSellOrder[]; skipped: { orderNo: string; reason: string }[] } {
  const byOrder = new Map<string, SourceRow[]>();
  for (const r of expandOrders(rows)) {
    const no = r['No.'] || r['Order no.'];
    if (!no) continue;
    byOrder.set(no, [...(byOrder.get(no) ?? []), r]);
  }
  const orders: GoSellOrder[] = [];
  const skipped: { orderNo: string; reason: string }[] = [];
  for (const [orderNo, items] of byOrder) {
    const r = items[0];
    const status = (r['Status'] ?? '').toLowerCase();
    if (/cancel|void|refund|ยกเลิก/.test(status)) { skipped.push({ orderNo, reason: `สถานะ ${r['Status']}` }); continue; }
    const problems: string[] = [];
    const addr = splitAddress(r['Customer Address'] ?? '');
    if (!addr.address) problems.push('ไม่มีบ้านเลขที่');
    if (!addr.subdistrict) problems.push('หาตำบล/แขวงไม่เจอ');
    if (!addr.district) problems.push('หาอำเภอ/เขตไม่เจอ');
    if (!addr.province) problems.push('หาจังหวัดไม่เจอ');
    else if (!PROVINCES.includes(addr.province)) problems.push(`จังหวัด "${addr.province}" ไม่ตรงชื่อทางการ`);
    if (!addr.zip) problems.push('ไม่มีรหัสไปรษณีย์');
    const phone = (r['Customer Phone'] ?? '').replace(/\D/g, '');
    if (!/^0\d{8,9}$/.test(phone)) problems.push(`เบอร์ "${r['Customer Phone']}" ไม่ถูกต้อง`);
    const orderCarrier = carrier || carrierFor(r['Shipping Option'] ?? '');
    if (!orderCarrier) problems.push(`ไม่รู้จักขนส่ง "${r['Shipping Option'] ?? ''}"`);
    if (items.some((i) => '_detailError' in i)) problems.push(`อ่านรายการสินค้าไม่ได้: "${items.find((i) => '_detailError' in i)!._detailError.slice(0, 80)}"`);
    const lines = items.filter((i) => !('_detailError' in i)).map((i) => ({ sku: i['SKU'] || i['CF code/Mine Code'] || '', qty: num(i['Item Qty']), price: num(i['Item Price']) }));
    if (lines.some((l) => !l.sku)) problems.push('มีสินค้าที่ไม่มี SKU');
    if (lines.some((l) => l.qty <= 0)) problems.push('มีสินค้าจำนวน 0');
    const goods = lines.reduce((t, l) => t + l.qty * l.price, 0);
    const discount = num(r['Discount']);
    const shippingCharge = num(r['Shipping Cost']);
    const total = num(r['Total']);
    if (r['Total'] && Math.abs(goods - discount + shippingCharge - total) > 0.01) problems.push(`ยอดไม่ตรง: สินค้า ${money(goods)} − ส่วนลด ${money(discount)} + ค่าส่ง ${money(shippingCharge)} ≠ ${money(total)}`);
    const created = (r['Created At'] ?? '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    orders.push({
      orderNo,
      customer: r['Customer Name'] || r['Profile name'] || '',
      phone,
      social: r['Profile name'] || r['Customer Name'] || '',
      payment: (r['Payment Provider'] ?? '').toLowerCase() === 'cod' ? 'COD' : 'การโอนเงิน',
      ...addr,
      carrier: orderCarrier,
      skus: lines.map((l) => `${l.sku} (${l.qty})`).join(', '),
      prices: lines.map((l) => money(l.price)).join(', '),
      orderDiscount: discount,
      shipping: 0,
      codFee: shippingCharge,
      orderedAt: created ? `${created[1]} ${created[2]}` : '',
      note: r['Note'] ?? '',
      total,
      problems,
    });
  }
  return { orders, skipped };
}

const FIRST_ROW = 9;
const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/** Fills the GoSell template (its bytes) with orders from row 9 down and returns the new .xlsx. */
export async function buildWorkbook(template: Uint8Array, orders: GoSellOrder[]): Promise<Uint8Array> {
  const files = await unzip(template);
  const dec = new TextDecoder(), enc = new TextEncoder();
  const sheetPath = 'xl/worksheets/sheet1.xml', ssPath = 'xl/sharedStrings.xml';
  let sheet = dec.decode(files.get(sheetPath));
  let sst = dec.decode(files.get(ssPath));
  if (!sheet.includes('<sheetData>') || !sst.includes('<sst')) throw new Error('ไฟล์ template GoSell ไม่ถูกต้อง');

  const strings: string[] = [];
  const baseCount = Number(sst.match(/uniqueCount="(\d+)"/)?.[1] ?? (sst.match(/<si>/g)?.length ?? 0));
  const str = (v: string) => { strings.push(v); return baseCount + strings.length - 1; };
  // Styles of the template's first empty data row, reused for rows past the end of the template.
  const styleOf: Record<string, string> = {};
  for (const m of (sheet.match(new RegExp(`<row r="${FIRST_ROW}"[^>]*>(.*?)</row>`))?.[1] ?? '').matchAll(/<c r="([A-Z]+)\d+"[^>]*? s="(\d+)"/g)) styleOf[m[1]] = m[2];

  orders.forEach((o, i) => {
    const r = FIRST_ROW + i;
    const values: Record<string, string | number> = {
      A: o.customer, B: o.phone, D: o.social, E: o.payment, F: o.address, G: o.subdistrict, H: o.district, I: o.province, J: o.zip,
      K: 'ประเทศไทย', L: o.carrier, M: o.skus, N: o.prices.includes(',') ? o.prices : Number(o.prices), P: o.orderDiscount, Q: o.shipping,
      R: o.codFee, S: o.orderedAt, T: o.note,
    };
    const cellXml = (col: string, style: string) => {
      const v = values[col];
      const s = style ? ` s="${style}"` : '';
      if (v === undefined || v === '') return `<c r="${col}${r}"${s}/>`;
      if (typeof v === 'number') return `<c r="${col}${r}"${s}><v>${v}</v></c>`;
      return `<c r="${col}${r}"${s} t="s"><v>${str(v)}</v></c>`;
    };
    const rowRe = new RegExp(`(<row r="${r}"[^>]*>)(.*?)</row>`);
    if (rowRe.test(sheet)) {
      sheet = sheet.replace(rowRe, (_, open: string, body: string) => {
        const done = new Set<string>();
        let out = body.replace(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>.*?<\/c>)/g, (cell, col: string, attrs: string) => {
          if (!(col in values)) return cell;
          done.add(col);
          return cellXml(col, attrs.match(/ s="(\d+)"/)?.[1] ?? '');
        });
        // Cells the template row didn't have (not the case in GoSell's template, rows 9–1000 list A–T).
        for (const col of Object.keys(values)) if (!done.has(col) && values[col] !== '') out += cellXml(col, styleOf[col] ?? '');
        return `${open}${out}</row>`;
      });
    } else {
      const cols = 'ABCDEFGHIJKLMNOPQRST'.split('');
      sheet = sheet.replace('</sheetData>', `<row r="${r}">${cols.map((c) => cellXml(c, styleOf[c] ?? '')).join('')}</row></sheetData>`);
    }
  });
  const lastRow = FIRST_ROW + orders.length - 1;
  sheet = sheet.replace(/<dimension ref="A1:([A-Z]+)(\d+)"\/>/, (m, col: string, row: string) => (Number(row) < lastRow ? `<dimension ref="A1:${col}${lastRow}"/>` : m));
  // Open on the data, not the instructions.
  sheet = sheet.replace(/<sheetView([^>]*?) topLeftCell="[A-Z]+\d+"/, '<sheetView$1').replace(/<selection [^>]*\/>/, `<selection activeCell="A${FIRST_ROW}" sqref="A${FIRST_ROW}"/>`);

  const added = strings.map((v) => `<si><t xml:space="preserve">${xmlEscape(v)}</t></si>`).join('');
  sst = sst.replace('</sst>', `${added}</sst>`)
    .replace(/count="(\d+)"/, (_, n: string) => `count="${Number(n) + strings.length}"`)
    .replace(/uniqueCount="(\d+)"/, `uniqueCount="${baseCount + strings.length}"`);

  files.set(sheetPath, enc.encode(sheet));
  files.set(ssPath, enc.encode(sst));
  return zip(files);
}
