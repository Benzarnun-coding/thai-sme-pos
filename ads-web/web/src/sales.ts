// Units sold (/catalog/sales): the Worker's per-day rows (Bigseller rounds, first appearance of each order + SKU;
// Page365 orders) turned into totals per day and channel, per sales store, per product and per warehouse.
// Channels: TikTok / Shopee (/ Lazada) from Bigseller's store label, Facebook = Page365. Shared with the tests.

import type { SalesData } from './api.ts';
import { skuKey, spuOf } from './catalog.ts';
import { labelFor, priceOf, type Lookup } from './purchase.ts';

export type Channel = 'TikTok' | 'Shopee' | 'Facebook' | 'Lazada' | 'อื่นๆ';
export const CHANNELS: Channel[] = ['TikTok', 'Shopee', 'Facebook', 'Lazada', 'อื่นๆ'];
export const FACEBOOK_STORE = 'Facebook · Page365';

/** "TikTok · STM-SHOP" → TikTok; stores whose platform is unknown → อื่นๆ. */
export function channelOfStore(store: string): Channel {
  const p = store.split(' · ')[0];
  return p === 'TikTok' || p === 'Shopee' || p === 'Lazada' ? p : p === 'Facebook' ? 'Facebook' : 'อื่นๆ';
}

export interface SaleRow { date: string; channel: Channel; store: string; sku: string; name: string; qty: number }

export function saleRows(d: SalesData): SaleRow[] {
  return [
    ...d.bigseller.map((r) => ({ date: r.date, channel: channelOfStore(r.store), store: r.store || '(ไม่ทราบร้าน)', sku: r.sku, name: '', qty: Number(r.qty) || 0 })),
    ...d.page365.map((r) => ({ date: r.date, channel: 'Facebook' as Channel, store: FACEBOOK_STORE, sku: r.sku, name: r.name, qty: Number(r.qty) || 0 })),
  ];
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

const emptyChannels = (): Record<Channel, number> => ({ TikTok: 0, Shopee: 0, Facebook: 0, Lazada: 0, 'อื่นๆ': 0 });

/** `revenue` = what Page365 (Facebook) customers paid; Bigseller's in-process export has no prices, so TikTok/Shopee have none. */
export interface DayTotal { date: string; total: number; channels: Record<Channel, number>; orders: number; revenue: number; bigseller: boolean; page365: boolean }

export function byDay(rows: SaleRow[], d: SalesData): DayTotal[] {
  const days = new Map(daysBetween(d.from, d.to).map((date) => [date, { date, total: 0, channels: emptyChannels(), orders: 0, revenue: 0, bigseller: d.bigsellerDays.includes(date), page365: d.page365Days.includes(date) } as DayTotal]));
  for (const r of rows) {
    const day = days.get(r.date);
    if (!day) continue;
    day.total += r.qty;
    day.channels[r.channel] += r.qty;
  }
  for (const o of d.bigsellerOrders) { const day = days.get(o.date); if (day) day.orders += o.orders; }
  for (const o of d.page365Orders) { const day = days.get(o.date); if (day) { day.orders += o.orders; day.revenue += Number(o.total) || 0; } }
  return [...days.values()];
}

export interface StoreTotal { store: string; channel: Channel; qty: number; orders: number }

export function byStore(rows: SaleRow[], d: SalesData): StoreTotal[] {
  const m = new Map<string, StoreTotal>();
  for (const r of rows) {
    const s = m.get(r.store) ?? { store: r.store, channel: r.channel, qty: 0, orders: 0 };
    s.qty += r.qty;
    m.set(r.store, s);
  }
  for (const o of d.bigsellerOrders) { const s = m.get(o.store || '(ไม่ทราบร้าน)'); if (s) s.orders += o.orders; }
  const fb = m.get(FACEBOOK_STORE);
  if (fb) fb.orders = d.page365Orders.reduce((n, o) => n + o.orders, 0);
  return [...m.values()].sort((a, b) => b.qty - a.qty);
}

export interface ProductTotal { key: string; label: string; tab: string; spu: string; qty: number; channels: Record<Channel, number>; known: boolean }

/** Per product (all sizes) via the catalog; SKUs the catalog does not know are listed as they are. */
export function byProduct(rows: SaleRow[], lookup: Lookup): ProductTotal[] {
  const m = new Map<string, ProductTotal>();
  for (const r of rows) {
    const c = lookup.rows.get(skuKey(r.sku));
    const key = c ? `${c.tab}|${spuOf(c.sku)}` : `?${r.sku || r.name}`;
    const label = c ? labelFor(c, 'warehouse', lookup) : (r.name || r.sku.replace(/^\?/, '') || '(ไม่มี SKU)');
    const p = m.get(key) ?? { key, label, tab: c?.tab ?? '', spu: c ? spuOf(c.sku) : '', qty: 0, channels: emptyChannels(), known: !!c };
    p.qty += r.qty;
    p.channels[r.channel] += r.qty;
    m.set(key, p);
  }
  return [...m.values()].sort((a, b) => b.qty - a.qty);
}

export function byWarehouse(rows: SaleRow[], lookup: Lookup): { tab: string; qty: number; products: number }[] {
  const m = new Map<string, { tab: string; qty: number; products: Set<string> }>();
  for (const r of rows) {
    const c = lookup.rows.get(skuKey(r.sku));
    const tab = c?.tab ?? '(ไม่มีในแคตตาล็อก)';
    const w = m.get(tab) ?? { tab, qty: 0, products: new Set<string>() };
    w.qty += r.qty;
    w.products.add(c ? spuOf(c.sku) : r.sku);
    m.set(tab, w);
  }
  return [...m.values()].map((w) => ({ tab: w.tab, qty: w.qty, products: w.products.size })).sort((a, b) => b.qty - a.qty);
}

/** Cost of what was sold (ทุน H, or a cost typed on the order page); pieces without a cost are counted apart. */
export function costOf(rows: SaleRow[], lookup: Lookup): { cost: number; unpriced: number } {
  let cost = 0, unpriced = 0;
  for (const r of rows) {
    const p = priceOf(r.sku, lookup).price;
    if (p === null) unpriced += r.qty; else cost += p * r.qty;
  }
  return { cost, unpriced };
}
