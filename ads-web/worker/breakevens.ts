// Break-even ROAS per campaign from its real Page365 orders (Benz 27 Oct 2026). The product line's break-even uses the
// catalog's full price, but the ads sell promos (3 for 499 = 166 a piece against a 324 list price) and ship substitutes,
// so it came out far too low (ni9: 1.84 vs 3.62 from its orders). Orders say what was sold, at what price and cost.
// Order of trust: the campaign's own orders → its product line's orders → the cheapest promo price a piece (campaign
// name + product line) with the catalog cost → the product line's catalog break-even → the shop's (from Page365).

import type { Entity } from '../../ads-engine/src/types.ts';
import { DEFAULT_SECTION_ID, economics, tiersFromName, type Cod, type CostRow, type Section } from './model.ts';
import { orderFees, type StoredOrder } from './p365.ts';
import type { OrderFees } from './db.ts';

export type BreakevenSource = 'catalog' | 'orders';

/** Orders (14 days, with a cost) a campaign or product line needs before its own break-even is trusted. */
export const MIN_ORDERS = 15;

export interface CampaignBreakeven { be: number; source: string }

/** revenue ÷ (revenue − product cost − per-order fees) over orders that carry a cost; null below MIN_ORDERS or no margin. */
export function ordersBreakeven(orders: Pick<StoredOrder, 'total' | 'cost' | 'payment' | 'shipping'>[], fees: OrderFees): { be: number; n: number } | null {
  const costed = orders.filter((o) => o.cost !== null && o.total > 0);
  if (costed.length < MIN_ORDERS) return null;
  const revenue = costed.reduce((t, o) => t + o.total, 0);
  const gross = costed.reduce((t, o) => t + o.total - o.cost! - orderFees(o, fees), 0);
  return gross > 0 ? { be: revenue / gross, n: costed.length } : null;
}

export function campaignBreakevens(
  campaigns: Entity[], sections: Section[], sectionOf: Map<string, string>, orders: StoredOrder[], costs: CostRow[],
  cod: Cod, fees: OrderFees, shop: number | null,
): Map<string, CampaignBreakeven> {
  const byCampaign = new Map<string, StoredOrder[]>();
  for (const o of orders) if (o.campaign_id) byCampaign.set(o.campaign_id, [...(byCampaign.get(o.campaign_id) ?? []), o]);
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const bySection = new Map<string, ReturnType<typeof ordersBreakeven>>();
  const sectionOrders = (sid: string) => {
    if (!bySection.has(sid)) {
      const ids = new Set(campaigns.filter((c) => sectionOf.get(c.id) === sid).map((c) => c.id));
      bySection.set(sid, ordersBreakeven(orders.filter((o) => o.campaign_id && ids.has(o.campaign_id)), fees));
    }
    return bySection.get(sid)!;
  };
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const out = new Map<string, CampaignBreakeven>();
  for (const c of campaigns) {
    const own = ordersBreakeven(byCampaign.get(c.id) ?? [], fees);
    if (own) { out.set(c.id, { be: r2(own.be), source: `ออเดอร์จริงของแคมเปญ ${own.n} ใบ` }); continue; }
    const sid = sectionOf.get(c.id) ?? DEFAULT_SECTION_ID;
    const section = sectionById.get(sid);
    // "ยังไม่ระบุสินค้า" mixes every product: its orders say nothing about this campaign, and it has no cost.
    if (section && sid !== DEFAULT_SECTION_ID) {
      const line = sectionOrders(sid);
      if (line) { out.set(c.id, { be: r2(line.be), source: `ออเดอร์จริงของสินค้า ${section.name} ${line.n} ใบ` }); continue; }
      const promos = [...section.tiers, ...tiersFromName(c.name)];
      // The campaign's 7-day order value carries the per-order fees (shipping, bag) into the break-even.
      const e = economics({ ...section, tiers: promos }, costs, c.metrics.last_7d ?? { spend: 0, purchases: 0, purchase_value: 0 }, cod);
      if (e.breakeven_roas !== null && Number.isFinite(e.breakeven_roas)) {
        out.set(c.id, { be: r2(e.breakeven_roas), source: promos.length ? `ราคาโปร ${Math.round(e.price_per_unit_min!)}/ตัว · ทุน ${e.cost_per_unit}` : `ราคาแคตตาล็อก ${Math.round(e.price_per_unit_min!)}/ตัว · ทุน ${e.cost_per_unit}` });
        continue;
      }
    }
    if (shop !== null) out.set(c.id, { be: r2(shop), source: 'คุ้มทุนรวมร้าน' });
  }
  return out;
}
