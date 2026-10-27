// Which promos a campaign sells and what one order of each costs. Promo prices: the team's sheet "FB คำนวณค่า ADS"
// (prices only — its all-in cost column is not used since Benz's 27 Oct 2026 call), else the promos in the campaign
// name / product / full price. Cost of one order = pieces × the product's raw catalog ทุน + the per-order fees and risk
// from settings.order_fees (Cod.pct / Cod.per_order). Shared by every page.

import type { Entity } from '../../ads-engine/src/types.ts';
import { CampaignCostIndex, type CampaignCost, type CostTier } from './campaignCosts.ts';
import { ECONOMICS_WINDOW, sectionMap, sectionTotals } from './engine.ts';
import { campaignEconomics, DEFAULT_SECTION_ID, type CampaignSetting, type Cod, type CostRow, type Section, type Tier } from './model.ts';

export interface CampaignTiers {
  tiers: CostTier[];
  /** sheet = promo prices from the sheet; product = from the product line / campaign name. Cost is always catalog + fees. */
  source: 'sheet' | 'product' | null;
  label: string;
  match: 'exact' | 'similar' | null;
}

/** One order of each promo: pieces × raw cost per piece + fee % of the price + fixed fees + the product's extra. */
export function costTiers(promos: Tier[], costPerUnit: number, cod: Cod, extraPerOrder = 0): CostTier[] {
  return promos.map((t) => ({ units: t.units, price: t.price, cost: t.units * costPerUnit + t.price * (cod.pct ?? 0) + (cod.per_order ?? 0) + extraPerOrder }));
}

export function makeTierResolver(ctx: {
  entities: Entity[]; sections: Section[]; campaignSettings: Map<string, CampaignSetting>; costs: CostRow[]; cod: Cod; campaignCosts: Map<string, CampaignCost>;
}): (id: string, name: string) => CampaignTiers {
  const index = new CampaignCostIndex(ctx.campaignCosts);
  const sectionOf = sectionMap(ctx.entities, ctx.sections, ctx.campaignSettings);
  const totals7 = sectionTotals(ctx.entities, sectionOf, ECONOMICS_WINDOW);
  const zero = { spend: 0, purchases: 0, purchase_value: 0 };
  const memo = new Map<string, CampaignTiers>();
  return (id, name) => {
    const hit = memo.get(id);
    if (hit) return hit;
    let out: CampaignTiers = { tiers: [], source: null, label: '', match: null };
    const found = index.find(name);
    const section = ctx.sections.find((s) => s.id === (sectionOf.get(id) ?? DEFAULT_SECTION_ID));
    const e = section ? campaignEconomics(section, ctx.costs, totals7.get(section.id) ?? zero, ctx.cod, name) : null;
    if (found) {
      // No catalog cost for the product → promo prices alone can't cost anything.
      out = { tiers: e?.cost_per_unit != null ? costTiers(found.cost.tiers, e.cost_per_unit, ctx.cod, section!.extra_cost_per_order) : [], source: 'sheet', label: found.cost.name, match: found.match };
    } else if (section && e && e.cost_per_unit !== null) {
      const promos = [...section.tiers, ...e.name_tiers];
      const list = promos.length ? promos : e.price_per_unit_max !== null ? [{ units: 1, price: e.price_per_unit_max }] : [];
      if (list.length) out = { tiers: costTiers(list, e.cost_per_unit, ctx.cod, section.extra_cost_per_order), source: 'product', label: section.name, match: null };
    }
    memo.set(id, out);
    return out;
  };
}
