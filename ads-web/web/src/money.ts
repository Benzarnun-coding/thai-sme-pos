// Marketplace money (TikTok / Shopee / Lazada): the platform's own order or income export, read in the browser.
// Bigseller's in-process file has no prices, so this is where marketplace revenue comes from. Every platform names
// its columns differently, so columns are guessed from the header and can be picked by hand once; the choice is
// remembered for the team per header layout. Only order number, date, status, amounts, fees and SKU/qty leave the
// browser — never names, phones or addresses.

import { cleanSku } from './catalog.ts';

export type Platform = 'TikTok' | 'Shopee' | 'Lazada';
export const PLATFORMS: Platform[] = ['TikTok', 'Shopee', 'Lazada'];

/** What the amount column means: what the customer paid for the order, or what the platform pays us (fees already off). */
export type AmountKind = 'gross' | 'net';

export interface MoneyMap {
  order: string;
  amount: string;
  kind: AmountKind;
  /** Fee columns subtracted from a gross amount (commission, transaction, service …); ignored for a net amount */
  fees: string[];
  date: string;
  status: string;
  sku: string;
  qty: string;
  /** Per-item amount, when the file has one row per item */
  itemAmount: string;
}

export const EMPTY_MAP: MoneyMap = { order: '', amount: '', kind: 'gross', fees: [], date: '', status: '', sku: '', qty: '', itemAmount: '' };

export interface MpItem { sku: string; qty: number; amount: number | null }
export interface MpOrder {
  order_no: string;
  platform: Platform;
  /** YYYY-MM-DD (Bangkok) from the file; null = use the day the order first appeared in an order-sheet round */
  date: string | null;
  /** What the customer paid (gross) or what we receive (net) */
  amount: number;
  kind: AmountKind;
  /** Platform fees from the file (gross amounts only); null = not in the file */
  fees: number | null;
  status: string;
  items: MpItem[] | null;
}

/** A layout's signature: its headers, so the same export from the same platform finds its saved columns. */
export function headerSignature(headers: string[]): string {
  return headers.map((h) => h.trim().toLowerCase()).filter(Boolean).join('|').slice(0, 2000);
}

const norm = (h: string) => h.toLowerCase().replace(/[\s_()（）.:/\\-]+/g, ' ').trim();

/** Best guess per field from the header names of TikTok, Shopee, Lazada and Bigseller exports (Thai or English). */
export function guessMap(headers: string[]): MoneyMap {
  const H = headers.map((h) => ({ h, n: norm(h) }));
  const find = (...res: RegExp[]) => {
    for (const re of res) { const hit = H.find((x) => re.test(x.n)); if (hit) return hit.h; }
    return '';
  };
  const net = find(/^total settlement amount/, /settlement amount/, /จำนวนเงินที่โอน/, /ยอดเงินที่ได้รับ/, /ยอดที่ได้รับ/, /รายรับสุทธิ/, /escrow amount/, /payout amount/);
  const gross = find(/^order amount$/, /^order total/, /grand total/, /total amount/, /ยอดรวมที่ผู้ซื้อชำระ/, /ยอดชำระ/, /ยอดคำสั่งซื้อ/, /ยอดรวมคำสั่งซื้อ/, /ราคารวม/, /^paid price/, /^total$/);
  const fees = H.filter((x) => /(commission|transaction fee|service fee|payment fee|platform fee|ค่าคอมมิชชั่น|ค่าธรรมเนียม|ค่าบริการ)/.test(x.n) && !/shipping|ค่าจัดส่ง|ส่วนลด|discount|rebate/.test(x.n)).map((x) => x.h);
  return {
    order: find(/^order id$/, /^order ?no$/, /^order number$/, /หมายเลขคำสั่งซื้อ/, /เลขที่คำสั่งซื้อ/, /^order adjustment id/, /order ?id/, /order ?no/, /order ?number/),
    amount: net || gross,
    kind: net ? 'net' : 'gross',
    fees: net ? [] : fees,
    date: find(/^created time$/, /order creation date/, /order create time/, /order time/, /วันที่ทำการสั่งซื้อ/, /วันที่สั่งซื้อ/, /เวลาสั่งซื้อ/, /^created at$/, /create time/, /order date/, /วันที่/),
    status: find(/^order status$/, /สถานะการสั่งซื้อ/, /สถานะคำสั่งซื้อ/, /^status$/, /สถานะ/),
    sku: find(/^seller sku$/, /sku reference/, /เลขอ้างอิง sku/, /^seller ?sku/, /^sku$/, /รหัสสินค้า/, /sku/),
    qty: find(/^quantity$/, /^qty$/, /จำนวน$/, /^จำนวน/, /quantity/),
    itemAmount: find(/sku subtotal after discount/, /ราคาขายสุทธิ/, /^deal price$/, /item subtotal/, /subtotal after discount/),
  };
}

/**
 * A grid (rows of cells) → header + rows keyed by header. The header is the first of the top 30 rows in which an
 * order-number and an amount column can be recognised (Shopee's income report has title rows above it), else row 1.
 * Empty header cells become "คอลัมน์ N", repeated ones get " (2)".
 */
export function tableFromGrid(grid: string[][]): { headers: string[]; rows: Record<string, string>[]; headerRow: number } {
  let at = grid.slice(0, 30).findIndex((r) => { const g = guessMap(r.map((c) => (c ?? '').trim())); return !!g.order && !!g.amount; });
  if (at < 0) at = 0;
  const seen = new Map<string, number>();
  const headers = (grid[at] ?? []).map((c, i) => {
    const h = (c ?? '').trim() || `คอลัมน์ ${i + 1}`;
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n > 1 ? `${h} (${n})` : h;
  });
  const rows = grid.slice(at + 1).filter((r) => r.some((c) => (c ?? '').trim())).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
  return { headers, rows, headerRow: at };
}

/** Number from "1,234.50", "฿1,234", "(12.00)" or "-12"; null when there is none. */
export function money(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = raw.replace(/[฿,\s]|THB/gi, '').trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/** "2026-10-13 10:27", "13/10/2026 10:27:00", "2026/10/13", an Excel serial (45940.4) → 2026-10-13; else null. */
export function dayOf(raw: string | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) {
    let y = Number(m[3]);
    if (y > 2400) y -= 543; // Buddhist year
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 40000 && serial < 80000) return new Date(Math.round((serial - 25569) * 86400_000)).toISOString().slice(0, 10);
  }
  return null;
}

/** Platform from the order number's shape: TikTok 18 digits, Shopee yymmdd + 8 letters/digits, Lazada 12–16 digits. */
export function platformOfOrderNo(no: string): Platform | null {
  if (/^\d{17,19}$/.test(no)) return 'TikTok';
  if (/^\d{6}[A-Z0-9]{8}$/.test(no) && /[A-Z]/.test(no)) return 'Shopee';
  if (/^\d{12,16}$/.test(no)) return 'Lazada';
  return null;
}

/** Statuses counted by default as no sale. */
export const NO_SALE = /(cancel|ยกเลิก|unpaid|ยังไม่ชำระ|return|refund|คืนเงิน|คืนสินค้า|failed|ล้มเหลว)/i;

export interface ParsedMoney {
  orders: MpOrder[];
  /** Rows per status, to choose which count as a sale */
  statuses: { status: string; orders: number; excluded: boolean }[];
  skipped: number;
  /** Orders whose number looks like Excel rounded it (18-digit TikTok ids saved as numbers) */
  rounded: number;
}

/**
 * Rows → one entry per order. A per-order column repeated on every item row is taken once; a column whose values
 * differ between an order's rows is summed (per-item amounts). Rows without an order number or amount are skipped
 * (description rows under TikTok's header, totals at the bottom).
 */
export function parseMoney(rows: Record<string, string>[], map: MoneyMap, platform: Platform | 'auto', excluded: Set<string>): ParsedMoney {
  const byOrder = new Map<string, Record<string, string>[]>();
  let skipped = 0, rounded = 0;
  for (const r of rows) {
    const no = (r[map.order] ?? '').trim().replace(/^'/, '');
    const amount = money(r[map.amount]);
    if (!no || amount === null || /\s/.test(no) || no.length > 40) { skipped++; continue; }
    const list = byOrder.get(no);
    if (list) list.push(r); else byOrder.set(no, [r]);
  }
  const statusCount = new Map<string, number>();
  const orders: MpOrder[] = [];
  const once = (list: Record<string, string>[], col: string): number | null => {
    if (!col) return null;
    const vals = list.map((r) => money(r[col]));
    if (vals.every((v) => v === null)) return null;
    const nums = vals.map((v) => v ?? 0);
    return nums.every((v) => v === nums[0]) ? nums[0] : nums.reduce((a, b) => a + b, 0);
  };
  for (const [no, list] of byOrder) {
    if (/e\+?\d+$/i.test(no)) rounded++;
    const status = map.status ? (list[0][map.status] ?? '').trim() : '';
    statusCount.set(status, (statusCount.get(status) ?? 0) + 1);
    if (excluded.has(status)) continue;
    const plat = platform === 'auto' ? platformOfOrderNo(no) ?? 'Shopee' : platform;
    const fees = map.kind === 'gross' && map.fees.length
      ? map.fees.reduce((t, c) => t + Math.abs(once(list, c) ?? 0), 0)
      : null;
    let items: MpItem[] | null = null;
    if (map.sku) {
      const m = new Map<string, MpItem>();
      for (const r of list) {
        const sku = cleanSku(r[map.sku] ?? '');
        if (!sku) continue;
        const qty = Math.max(1, Math.round(money(r[map.qty]) ?? 1));
        const amt = map.itemAmount ? money(r[map.itemAmount]) : null;
        const it = m.get(sku) ?? { sku, qty: 0, amount: amt === null ? null : 0 };
        it.qty += qty;
        if (amt !== null && it.amount !== null) it.amount += amt;
        m.set(sku, it);
      }
      items = m.size ? [...m.values()] : null;
    }
    orders.push({ order_no: no, platform: plat, date: map.date ? dayOf(list[0][map.date]) : null, amount: once(list, map.amount) ?? 0, kind: map.kind, fees, status, items });
  }
  const statuses = [...statusCount].map(([status, n]) => ({ status, orders: n, excluded: excluded.has(status) })).sort((a, b) => b.orders - a.orders);
  return { orders, statuses, skipped, rounded };
}

/** Statuses to leave out by default: cancelled, unpaid, returned. */
export function defaultExcluded(rows: Record<string, string>[], statusCol: string): Set<string> {
  if (!statusCol) return new Set();
  return new Set(rows.map((r) => (r[statusCol] ?? '').trim()).filter((s) => s && NO_SALE.test(s)));
}
