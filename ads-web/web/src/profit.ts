// Profit per channel and per product (/catalog/profit). Facebook = Page365 orders (prices per item, the shop's
// per-order fees, Meta ad spend); TikTok / Shopee / Lazada = the platforms' money files (money.ts) with the items
// from the file or from the order-sheet rounds. Each order's money and fees are split over its items by value, so
// product rows add up to the channel totals. Cost = the catalog's ทุน (sheet H, or typed on the website) — not the
// cost Page365 has, which the monthly goal uses. Nothing here feeds the ads rules.

import type { ProfitData } from './api.ts';
import { overrideOf, skuKey, spuOf } from './catalog.ts';
import { labelFor, priceOf, type Lookup } from './purchase.ts';
import { channelOfStore, type Channel } from './sales.ts';

export interface ChannelProfit {
  channel: Channel;
  orders: number;
  pieces: number;
  revenue: number;
  /** Platform fees / the shop's per-order fees */
  fees: number;
  cost: number;
  ads: number;
  profit: number;
  /** Pieces whose cost is unknown (counted as 0) */
  unpriced: number;
  /** Marketplace orders seen on order sheets in this range without money from a file */
  noMoney: number;
  /** Some revenue is already after platform fees (a payout file) */
  netFiles: boolean;
  /** Some gross revenue had no fee columns */
  feesMissing: boolean;
}

export interface ProductProfit {
  key: string; label: string; tab: string; spu: string; known: boolean;
  pieces: number; revenue: number; fees: number; cost: number; profit: number; unpriced: number;
  channels: Partial<Record<Channel, number>>;
}

export interface ProfitResult { channels: ChannelProfit[]; products: ProductProfit[]; total: ChannelProfit }

interface Line { sku: string; name: string; qty: number; value: number | null }

const emptyChannel = (channel: Channel): ChannelProfit => ({ channel, orders: 0, pieces: 0, revenue: 0, fees: 0, cost: 0, ads: 0, profit: 0, unpriced: 0, noMoney: 0, netFiles: false, feesMissing: false });

export function profit(d: ProfitData, lookup: Lookup, sell: Map<string, number>): ProfitResult {
  const channels = new Map<Channel, ChannelProfit>();
  const ch = (c: Channel) => { const x = channels.get(c) ?? emptyChannel(c); channels.set(c, x); return x; };
  const products = new Map<string, ProductProfit>();

  /** Split an order's revenue and fees over its lines (by value, else by sell price × qty, else by qty). */
  function book(channel: Channel, lines: Line[], revenue: number, fees: number) {
    const c = ch(channel);
    c.orders++;
    c.revenue += revenue;
    c.fees += fees;
    const weights = lines.map((l) => {
      if (l.value !== null && l.value > 0) return l.value;
      const r = lookup.rows.get(skuKey(l.sku));
      const p = r ? overrideOf(r, sell) ?? r.price : null;
      return p && p > 0 ? p * l.qty : 0;
    });
    const useQty = weights.every((w) => w === 0) || weights.some((w, i) => w === 0 && lines[i].qty > 0);
    const w = useQty ? lines.map((l) => l.qty) : weights;
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    lines.forEach((l, i) => {
      const share = w[i] / sum;
      const r = lookup.rows.get(skuKey(l.sku));
      const key = r ? `${r.tab}|${spuOf(r.sku)}` : `?${l.sku || l.name}`;
      const p = products.get(key) ?? {
        key, label: r ? labelFor(r, 'warehouse', lookup) : (l.name || l.sku || '(ไม่มี SKU)'), tab: r?.tab ?? '', spu: r ? spuOf(r.sku) : '', known: !!r,
        pieces: 0, revenue: 0, fees: 0, cost: 0, profit: 0, unpriced: 0, channels: {},
      };
      const unit = priceOf(l.sku, lookup).price;
      p.pieces += l.qty;
      p.revenue += revenue * share;
      p.fees += fees * share;
      p.channels[channel] = (p.channels[channel] ?? 0) + l.qty;
      c.pieces += l.qty;
      if (unit === null) { p.unpriced += l.qty; c.unpriced += l.qty; } else { p.cost += unit * l.qty; c.cost += unit * l.qty; }
      products.set(key, p);
    });
  }

  for (const o of d.page365) {
    // Page365's item price is already the line total ("x3 THB 1107"), not a price per piece.
    book('Facebook', o.items.map((i) => ({ sku: i.sku, name: i.name, qty: Number(i.qty) || 0, value: Number(i.price) || 0 })), o.total, o.fee);
  }

  // Items per marketplace order from the order-sheet rounds; `inRange` = it first appeared in this range.
  const sheetByOrder = new Map<string, { store: string; inRange: boolean; lines: Line[] }>();
  for (const s of d.sheetItems) {
    const x = sheetByOrder.get(s.order_no) ?? { store: s.store, inRange: s.date >= d.from && s.date <= d.to, lines: [] };
    x.lines.push({ sku: s.sku, name: '', qty: Number(s.qty) || 0, value: null });
    sheetByOrder.set(s.order_no, x);
  }
  const withMoney = new Set<string>();
  for (const o of d.marketplace) {
    withMoney.add(o.order_no);
    const sheet = sheetByOrder.get(o.order_no);
    const channel: Channel = sheet ? channelOfStore(sheet.store) === 'อื่นๆ' ? o.platform : channelOfStore(sheet.store) : o.platform;
    const lines: Line[] = o.items?.length ? o.items.map((i) => ({ sku: i.sku, name: '', qty: i.qty, value: i.amount })) : sheet?.lines ?? [];
    const fees = o.kind === 'gross' ? o.fees ?? 0 : 0;
    const c = ch(channel);
    if (o.kind === 'net') c.netFiles = true;
    if (o.kind === 'gross' && o.fees === null) c.feesMissing = true;
    book(channel, lines, o.amount, fees);
  }
  for (const [no, s] of sheetByOrder) {
    if (withMoney.has(no) || !s.inRange) continue;
    ch(channelOfStore(s.store)).noMoney++;
  }

  // Ad spend only for days whose Page365 orders are in (else a day's spend would count with none of its sales).
  const uploaded = new Set(d.page365Days);
  const ads = (d.spend ?? []).filter((x) => uploaded.has(x.date)).reduce((t, x) => t + x.spend, 0);
  if (ads) ch('Facebook').ads = ads;

  const order: Channel[] = ['Facebook', 'TikTok', 'Shopee', 'Lazada', 'อื่นๆ'];
  const list = order.map((c) => channels.get(c)).filter((c): c is ChannelProfit => !!c);
  for (const c of list) c.profit = c.revenue - c.fees - c.cost - c.ads;
  const total = list.reduce((t, c) => ({
    ...t, orders: t.orders + c.orders, pieces: t.pieces + c.pieces, revenue: t.revenue + c.revenue, fees: t.fees + c.fees, cost: t.cost + c.cost,
    ads: t.ads + c.ads, profit: t.profit + c.profit, unpriced: t.unpriced + c.unpriced, noMoney: t.noMoney + c.noMoney,
    netFiles: t.netFiles || c.netFiles, feesMissing: t.feesMissing || c.feesMissing,
  }), emptyChannel('อื่นๆ'));
  const prods = [...products.values()];
  for (const p of prods) p.profit = p.revenue - p.fees - p.cost;
  return { channels: list, products: prods.sort((a, b) => b.profit - a.profit), total };
}
