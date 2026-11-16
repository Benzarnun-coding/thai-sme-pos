// Morning back-office summary for Discord (07:30, after the Page365 numbers): yesterday's order sheets per supplier,
// what sold per channel, how many marketplace orders still have no money file, what is owed to suppliers, and SKUs
// sold in the last 7 days that the catalog doesn't know. All SQL (D1 time, not Worker CPU); text only.

import { channelOfStore, CHANNELS, type Channel } from '../web/src/sales.ts';
import { MISSING_GROUP } from '../web/src/purchase.ts';
import { ledger } from './purchase.ts';
import { salesData } from './sales.ts';
import { lowStock } from './stock.ts';

const SITE = 'https://pkjeans-ads.ads-web.workers.dev';
const minus = (iso: string, d: number) => new Date(Date.parse(iso) - d * 86400_000).toISOString().slice(0, 10);
const n = (x: number) => Math.round(x).toLocaleString('th-TH');

export interface OpsFacts {
  date: string;
  /** Rounds saved that day (a later round repeats the orders still in process, so they are not added up) */
  rounds: { round: number; pieces: number; missing: number }[];
  /** Per supplier / warehouse, latest round */
  sheets: { grp: string; kind: string; qty: number; missing: number }[];
  sold: Partial<Record<Channel, number>>;
  soldKnown: { bigseller: boolean; page365: boolean };
  noMoney: number;
  withMoney: number;
  owed: { grp: string; amount: number }[];
  unknownSkus: number;
  unknownPieces: number;
  /** Our own stock sizes at ≤ 5 pieces (พี่เปีย / GoSell) */
  low: { loc: string; code: string; size: string; qty: number }[];
}

export async function opsFacts(db: D1Database, date: string): Promise<OpsFacts> {
  const week = minus(date, 6);
  const [batch, sales, led, low] = await Promise.all([
    db.batch([
      db.prepare('SELECT round, pieces, missing FROM purchase_uploads WHERE date = ?1 ORDER BY round').bind(date),
      db.prepare(
        `SELECT l.grp, MAX(l.kind) AS kind, SUM(l.qty) AS qty, SUM(l.missing) AS missing
         FROM purchase_uploads u JOIN purchase_lines l ON l.upload_id = u.id
         WHERE u.id = (SELECT id FROM purchase_uploads WHERE date = ?1 ORDER BY round DESC LIMIT 1) GROUP BY l.grp ORDER BY qty DESC`,
      ).bind(date),
      db.prepare(
        `WITH seen AS (SELECT order_no, MIN(substr(upload_id, 1, 10)) AS date FROM purchase_items GROUP BY order_no)
         SELECT SUM(m.order_no IS NULL) AS no_money, SUM(m.order_no IS NOT NULL) AS with_money
         FROM seen s LEFT JOIN mp_orders m ON m.order_no = s.order_no WHERE s.date = ?1 AND s.order_no NOT LIKE '?%'`,
      ).bind(date),
      db.prepare(
        `WITH sold AS (
           SELECT i.sku, i.qty FROM purchase_items i
           JOIN (SELECT order_no, sku, MIN(upload_id) AS upload_id FROM purchase_items GROUP BY order_no, sku) f
             ON f.upload_id = i.upload_id AND f.order_no = i.order_no AND f.sku = i.sku
           WHERE substr(i.upload_id, 1, 10) BETWEEN ?1 AND ?2
           UNION ALL
           SELECT j.value ->> '$.sku', j.value ->> '$.qty' FROM p365_orders o, json_each(o.items) j WHERE o.date BETWEEN ?1 AND ?2
         )
         SELECT COUNT(DISTINCT upper(sku)) AS skus, SUM(qty) AS pieces FROM sold
         WHERE sku <> '' AND sku NOT LIKE '?%'
           AND upper(sku) NOT IN (SELECT upper(sku) FROM catalog)
           AND upper(sku) NOT IN (SELECT upper(sku) FROM catalog_web)
           AND upper(sku) NOT IN (SELECT alias FROM catalog_aliases)`,
      ).bind(week, date),
    ]),
    salesData(db, date, date),
    ledger(db, minus(date, 60)),
    lowStock(db).catch(() => []),
  ]);
  const [rounds, sheets, money, unknown] = batch;
  const sold: Partial<Record<Channel, number>> = {};
  for (const r of sales.bigseller) { const c = channelOfStore(r.store); sold[c] = (sold[c] ?? 0) + (Number(r.qty) || 0); }
  for (const r of sales.page365) sold.Facebook = (sold.Facebook ?? 0) + (Number(r.qty) || 0);
  const owedBy = new Map<string, number>();
  for (const r of led) {
    if (r.done || (r.kind !== 'supplier' && r.grp !== MISSING_GROUP)) continue;
    owedBy.set(r.grp, (owedBy.get(r.grp) ?? 0) + r.due - (r.paid ?? 0));
  }
  const m = (money.results[0] ?? {}) as { no_money: number | null; with_money: number | null };
  const u = (unknown.results[0] ?? {}) as { skus: number | null; pieces: number | null };
  return {
    date,
    rounds: (rounds.results as OpsFacts['rounds']).map((r) => ({ round: Number(r.round), pieces: Number(r.pieces) || 0, missing: Number(r.missing) || 0 })),
    sheets: (sheets.results as OpsFacts['sheets']).map((s) => ({ ...s, qty: Number(s.qty) || 0, missing: Number(s.missing) || 0 })),
    sold,
    soldKnown: { bigseller: sales.bigsellerDays.includes(date), page365: sales.page365Days.includes(date) },
    noMoney: Number(m.no_money ?? 0), withMoney: Number(m.with_money ?? 0),
    owed: [...owedBy].map(([grp, amount]) => ({ grp, amount })).filter((x) => x.amount > 0.5).sort((a, b) => b.amount - a.amount),
    unknownSkus: Number(u.skus ?? 0), unknownPieces: Number(u.pieces ?? 0),
    low,
  };
}

export function opsText(f: OpsFacts): string {
  const thai = new Date(`${f.date}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });
  const lines = [`🗂️ **หลังบ้าน ${thai}**`];
  if (f.rounds.length) {
    const last = f.rounds[f.rounds.length - 1];
    const missing = f.rounds.reduce((t, r) => t + r.missing, 0);
    const top = f.sheets.filter((s) => s.kind !== 'review').slice(0, 6).map((s) => `${s.grp} ${n(s.qty)}`).join(' · ');
    const review = f.sheets.filter((s) => s.kind === 'review').reduce((t, s) => t + s.qty, 0);
    const rounds = f.rounds.length > 1 ? `${f.rounds.length} รอบ (${f.rounds.map((r) => n(r.pieces)).join(' / ')} ตัว) · รอบล่าสุด` : '1 รอบ';
    lines.push(`📦 ใบสั่งของ ${rounds} **${n(last.pieces)} ตัว**: ${top}${review ? ` · ตรวจสอบ ${n(review)}` : ''}${missing ? ` · ของไม่มี ${n(missing)} ตัว` : ''}`);
  } else lines.push('📦 ไม่มีใบสั่งของที่บันทึกไว้เมื่อวาน');
  const sold = CHANNELS.filter((c) => f.sold[c]).map((c) => `${c} ${n(f.sold[c] ?? 0)}`).join(' · ');
  const total = Object.values(f.sold).reduce((t, x) => t + (x ?? 0), 0);
  const gaps = [!f.soldKnown.bigseller && 'ไม่มีรอบใบสั่ง (TikTok/Shopee)', !f.soldKnown.page365 && 'ไม่มีไฟล์ Page365'].filter(Boolean).join(' · ');
  lines.push(`🛒 ขายได้ **${n(total)} ตัว**${sold ? `: ${sold}` : ''}${gaps ? ` (${gaps})` : ''}`);
  if (f.noMoney || f.withMoney) lines.push(`💰 ออเดอร์ TikTok/Shopee มียอดเงินแล้ว ${n(f.withMoney)}/${n(f.withMoney + f.noMoney)}${f.noMoney ? ` · อัปโหลดไฟล์ยอดเงินที่ ${SITE}/catalog/profit` : ''}`);
  if (f.owed.length) {
    const sum = f.owed.reduce((t, x) => t + x.amount, 0);
    lines.push(`💸 ค้างจ่ายร้าน **฿${n(sum)}**: ${f.owed.slice(0, 5).map((x) => `${x.grp} ฿${n(x.amount)}`).join(' · ')}${f.owed.length > 5 ? ` · อีก ${f.owed.length - 5} ร้าน` : ''}`);
  }
  for (const [loc, label] of [['pia', 'พี่เปีย'], ['gosell', 'GoSell'], ['pk', 'PK']] as const) {
    const l = f.low.filter((x) => x.loc === loc);
    if (l.length) lines.push(`📉 สต็อก${label}เหลือน้อย: ${l.slice(0, 8).map((x) => `${x.code} #${x.size} ${n(x.qty)}`).join(' · ')}${l.length > 8 ? ` · อีก ${l.length - 8} ไซส์` : ''} · ${SITE}/catalog/stock`);
  }
  if (f.unknownSkus) lines.push(`🧩 SKU ที่ไม่มีในแคตตาล็อก ${n(f.unknownSkus)} ตัว (ขายไป ${n(f.unknownPieces)} ชิ้นใน 7 วัน) · จับคู่ที่ ${SITE}/catalog/todo`);
  return lines.join('\n');
}
