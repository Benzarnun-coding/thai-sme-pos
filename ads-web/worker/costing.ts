// Which promos (price + all-in cost per order) a campaign sells: from the team's cost sheet, else its product
// line's cost per piece with the promos in its name / product / full price. Shared by every page.

import type { Entity } from '../../ads-engine/src/types.ts';
import { CampaignCostIndex, type CampaignCost, type CostTier } from './campaignCosts.ts';
import { ECONOMICS_WINDOW, sectionMap, sectionTotals } from './engine.ts';
import { campaignEconomics, DEFAULT_SECTION_ID, type CampaignSetting, type Cod, type CostRow, type Section } from './model.ts';

export interface CampaignTiers { tiers: CostTier[]; source: 'sheet' | 'product' | null; label: string; match: 'exact' | 'similar' | null }

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
    if (found) out = { tiers: found.cost.tiers, source: 'sheet', label: found.cost.name, match: found.match };
    else {
      const section = ctx.sections.find((s) => s.id === (sectionOf.get(id) ?? DEFAULT_SECTION_ID));
      if (section) {
        const e = campaignEconomics(section, ctx.costs, totals7.get(section.id) ?? zero, ctx.cod, name);
        if (e.cost_per_unit !== null) {
          const promos = [...section.tiers, ...e.name_tiers];
          const list = promos.length ? promos : e.price_per_unit_max !== null ? [{ units: 1, price: e.price_per_unit_max }] : [];
          if (list.length) out = { tiers: list.map((t) => ({ units: t.units, price: t.price, cost: t.units * e.cost_per_unit! })), source: 'product', label: section.name, match: null };
        }
      }
    }
    memo.set(id, out);
    return out;
  };
}
