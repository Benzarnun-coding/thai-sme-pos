/**
 * Signal builder (Automation, no AI).
 *
 * Turns catalog + stock + sales facts into one row per product that the
 * dashboard shows today and the Strategist agent will read in project 4.
 * Everything here is deterministic and unit-tested.
 */
import type { Db } from '../db/client.js';
import { sortSizes } from '../catalog/sku.js';

export interface ProductSignal {
  product_id: string;
  name: string;
  category: string | null;
  sku_group: string;
  base_price: number | null;
  set_price: { qty: number; price: number } | null;
  sales_7d: number;
  sales_prev_7d: number;
  sales_30d: number;
  trend_pct: number | null;          // 7d vs previous 7d
  stock_total: number;
  stock_by_size: Record<string, number>;
  stock_by_color_size: Record<string, Record<string, number>>;
  core_sizes: string[];
  missing_core_sizes: string[];      // core sizes with qty < min_qty_per_size in every color
  core_size_ok: boolean;
  days_of_cover: number | null;      // stock_total / avg daily sales (30d)
  overstock: boolean;                // days_of_cover > 60
  promotable: boolean;               // is_promotable && core_size_ok && stock_total > 0
  note: string;
}

export async function buildProductSignals(db: Db, storeId: string, today = new Date()): Promise<ProductSignal[]> {
  const d = (n: number) => { const x = new Date(today); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
  const products = await db.query<{ id: string; name: string; category: string | null; sku_group: string; base_price: string | null; set_price: ProductSignal['set_price']; is_promotable: boolean }>(
    'select id, name, category, sku_group, base_price, set_price, is_promotable from product where store_id=$1 order by name', [storeId]);
  const sales = await db.query<{ product_id: string; period: string; qty: string }>(
    `select v.product_id,
            case when f.date >= $2 then 'w1' when f.date >= $3 then 'w2' else 'm' end as period,
            sum(f.qty)::text as qty
       from fact_sales_daily f join variant v on v.id = f.variant_id
      where f.store_id=$1 and f.date >= $4 and f.date <= $5
      group by 1,2`, [storeId, d(6), d(13), d(29), d(0)]);
  const stock = await db.query<{ product_id: string; color: string; size: string; qty: string }>(
    `select v.product_id, v.color, v.size, sum(l.qty)::text as qty
       from variant v join v_stock_latest l on l.variant_id = v.id
       join product p on p.id = v.product_id
      where p.store_id=$1 group by 1,2,3`, [storeId]);
  const rules = await db.query<{ category: string; core_sizes: string[]; min_qty_per_size: number }>(
    'select category, core_sizes, min_qty_per_size from size_rule where store_id=$1', [storeId]);
  const ruleFor = (cat: string | null) => rules.find((r) => r.category === cat) ?? rules.find((r) => r.category === '*');

  return products.map((p) => {
    const s = (period: string) => sales.filter((r) => r.product_id === p.id && r.period === period).reduce((a, r) => a + Number(r.qty), 0);
    const w1 = s('w1'), w2 = s('w2'), m = s('m');
    const sales_30d = w1 + w2 + m;
    const bySize: Record<string, number> = {}, byColorSize: Record<string, Record<string, number>> = {};
    let total = 0;
    for (const r of stock.filter((x) => x.product_id === p.id)) {
      const q = Number(r.qty); total += q;
      bySize[r.size] = (bySize[r.size] ?? 0) + q;
      (byColorSize[r.color] ??= {})[r.size] = q;
    }
    const rule = ruleFor(p.category);
    const core = rule?.core_sizes ?? [];
    const minQ = rule?.min_qty_per_size ?? 1;
    const missing = core.filter((z) => (bySize[z] ?? 0) < minQ);
    const core_size_ok = missing.length === 0;
    const avgDaily = sales_30d / 30;
    const days_of_cover = avgDaily > 0 ? Math.round(total / avgDaily) : null;
    const overstock = days_of_cover !== null && days_of_cover > 60;
    const trend_pct = w2 > 0 ? Math.round(((w1 - w2) / w2) * 100) : (w1 > 0 ? 100 : null);
    const note = !core_size_ok ? `ขาดไซส์ ${sortSizes(missing).join(', ')}`
      : overstock ? `เหลือเยอะ (${days_of_cover} วัน)`
      : total === 0 ? 'ไม่มีสต็อก' : 'ครบไซส์';
    return {
      product_id: p.id, name: p.name, category: p.category, sku_group: p.sku_group,
      base_price: p.base_price === null ? null : Number(p.base_price), set_price: p.set_price ?? null,
      sales_7d: w1, sales_prev_7d: w2, sales_30d, trend_pct,
      stock_total: total, stock_by_size: Object.fromEntries(sortSizes(Object.keys(bySize)).map((z) => [z, bySize[z]])),
      stock_by_color_size: byColorSize,
      core_sizes: core, missing_core_sizes: sortSizes(missing), core_size_ok,
      days_of_cover, overstock,
      promotable: p.is_promotable && core_size_ok && total > 0,
      note,
    };
  });
}

export async function storeSummary(db: Db, storeId: string, today = new Date()) {
  const d = (n: number) => { const x = new Date(today); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
  const [sales] = await db.query<{ revenue: string; qty: string }>(
    `select coalesce(sum(revenue),0)::text as revenue, coalesce(sum(qty),0)::text as qty from fact_sales_daily where store_id=$1 and date >= $2`, [storeId, d(6)]);
  const [prev] = await db.query<{ revenue: string }>(
    `select coalesce(sum(revenue),0)::text as revenue from fact_sales_daily where store_id=$1 and date >= $2 and date < $3`, [storeId, d(13), d(6)]);
  const [ads] = await db.query<{ spend: string; conversations: string; purchases: string; revenue: string }>(
    `select coalesce(sum(spend),0)::text as spend, coalesce(sum(conversations),0)::text as conversations, coalesce(sum(purchases),0)::text as purchases, coalesce(sum(revenue),0)::text as revenue
       from fact_ad_insight_daily where store_id=$1 and date >= $2`, [storeId, d(6)]);
  const daily = await db.query<{ date: string; revenue: string }>(
    `select date::text, sum(revenue)::text as revenue from fact_sales_daily where store_id=$1 and date >= $2 group by date order by date`, [storeId, d(13)]);
  const [page] = await db.query<{ followers: number | null; date: string }>(
    `select followers, date::text from page_snapshot where store_id=$1 and channel='facebook' order by date desc limit 1`, [storeId]);
  const spend = Number(ads?.spend ?? 0);
  return {
    sales_7d: Number(sales?.revenue ?? 0), qty_7d: Number(sales?.qty ?? 0),
    sales_prev_7d: Number(prev?.revenue ?? 0),
    ad_spend_7d: spend, conversations_7d: Number(ads?.conversations ?? 0), purchases_7d: Number(ads?.purchases ?? 0),
    ad_revenue_7d: Number(ads?.revenue ?? 0),
    roas_7d: spend > 0 ? Number((Number(ads?.revenue ?? 0) / spend).toFixed(2)) : null,
    cost_per_conversation: Number(ads?.conversations ?? 0) > 0 ? Math.round(spend / Number(ads?.conversations)) : null,
    daily: daily.map((r) => ({ date: r.date, revenue: Number(r.revenue) })),
    followers: page?.followers ?? null, followers_date: page?.date ?? null,
  };
}
