// อูนิ's post ideas for Max (Benz, 14 Oct 2026): which products deserve a new ad post, which promo to put on
// it, and which products not to make more posts for yet. Worked out from real Page365 orders (pieces per product
// family, promo mix, organic demand) and the last 7 days of ad spend per campaign — no AI, same numbers every time.

import { orderFees, type StoredOrder } from './p365.ts';
import type { OrderFees } from './db.ts';

/** "501/2 ยีนส์กระบอก…" → "501", "NI9-2 ขาสั้น…" → "NI9", "16-4 ขาสั้นชิโน่…" → "16" */
export function familyOf(itemName: string): { family: string; label: string } | null {
  const m = /^\s*([A-Za-z]*\d+[A-Za-z]*)(?:[/-]\d+)?\s+(.*)$/.exec(itemName);
  if (!m) return null;
  const label = m[2].replace(/\s+/g, ' ').replace(/\s*Ni9$/i, '').replace(/สี\S*$/, '').trim();
  return { family: m[1].toUpperCase(), label };
}

/**
 * Campaign names mention a family as a code: "501" in "โพสผี : 501/1 …", "200" in "E200", but not "16" in "1600"
 * nor "200" in a budget like "฿200".
 */
export function nameHasFamily(campaignName: string, family: string): boolean {
  const f = family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9A-Za-z฿])[A-Za-z]?${f}(?![0-9฿])`, 'i').test(campaignName);
}

export interface CampaignWeek { id: string; name: string; spend: number }

/**
 * Meta's last-7-day spend, cut to the days whose Page365 file is uploaded (revenue only exists for those): a week
 * with 4 of 7 files must not compare 7 days of spend with 4 days of sales (real ROAS 3.0 read as ~1.7).
 * Spend per day isn't fetched (API calls are scarce), so it is taken as even across the week.
 */
export function spendForUploadedDays(campaigns: CampaignWeek[], days7: string[], uploaded: Set<string>): { campaigns: CampaignWeek[]; week: Set<string> } {
  const week = new Set(days7.filter((d) => uploaded.has(d)));
  const share = days7.length ? week.size / days7.length : 0;
  return { campaigns: campaigns.map((c) => ({ ...c, spend: c.spend * share })), week };
}

export interface FamilyStats {
  family: string; label: string;
  pieces: number; organic_pieces: number; orders: number;
  revenue: number; net_before_ads: number;
  /** Campaigns that sold this family in the last 7 days (real orders), with the share of their spend it carries */
  campaigns: { name: string; spend: number; revenue: number }[];
  /** A running campaign's name carries this family's code */
  own_campaign: boolean;
  spend: number; ad_revenue: number; roas: number | null;
  /** Orders with only this family, by pieces: count and average net before ads per order */
  promos: { pieces: number; orders: number; avg_total: number; avg_net: number }[];
}

const blank = (family: string): FamilyStats => ({ family, label: '', pieces: 0, organic_pieces: 0, orders: 0, revenue: 0, net_before_ads: 0, campaigns: [], own_campaign: false, spend: 0, ad_revenue: 0, roas: null, promos: [] });

/**
 * Per product family: pieces, organic pieces and promo mix over all the given orders; ad spend and real ad revenue
 * over `week` only. A campaign's spend is split over the families its credited orders actually contained (campaign
 * names don't say what an ad sells — the 444 posts sell mostly other models); a campaign with no credited order is
 * charged to the families its name mentions.
 */
export function familyStats(orders: StoredOrder[], fees: OrderFees, campaigns: CampaignWeek[], week: Set<string>): FamilyStats[] {
  const fam = new Map<string, FamilyStats>();
  const promo = new Map<string, Map<number, { orders: number; total: number; net: number }>>();
  const labels = new Map<string, Map<string, number>>();
  const sold = new Map<string, Map<string, number>>(); // campaign → family → revenue (week)
  for (const o of orders) {
    const items = o.items.map((it) => ({ it, f: familyOf(it.name) })).filter((x) => x.f);
    if (!items.length) continue;
    const listTotal = items.reduce((t, x) => t + (x.it.price || 0), 0) || items.length;
    const orderNet = o.total - (o.cost ?? 0) - orderFees(o, fees);
    const seen = new Set<string>();
    for (const { it, f } of items) {
      const s = fam.get(f!.family) ?? blank(f!.family);
      const share = (it.price || 1) / listTotal;
      s.pieces += it.qty;
      if (o.match === 'none') s.organic_pieces += it.qty;
      s.revenue += o.total * share;
      s.net_before_ads += orderNet * share;
      if (!seen.has(s.family)) { s.orders++; seen.add(s.family); }
      fam.set(s.family, s);
      const l = labels.get(s.family) ?? new Map<string, number>();
      l.set(f!.label, (l.get(f!.label) ?? 0) + it.qty);
      labels.set(s.family, l);
      if (o.match !== 'none' && o.campaign_id && week.has(o.date)) {
        const c = sold.get(o.campaign_id) ?? new Map<string, number>();
        c.set(s.family, (c.get(s.family) ?? 0) + o.total * share);
        sold.set(o.campaign_id, c);
      }
    }
    if (seen.size === 1) {
      const f = [...seen][0];
      const pieces = Math.min(3, items.reduce((n, x) => n + x.it.qty, 0));
      const m = promo.get(f) ?? new Map();
      const p = m.get(pieces) ?? { orders: 0, total: 0, net: 0 };
      p.orders++; p.total += o.total; p.net += orderNet;
      m.set(pieces, p); promo.set(f, m);
    }
  }
  for (const c of campaigns) {
    const bySold = sold.get(c.id);
    const total = bySold ? [...bySold.values()].reduce((a, b) => a + b, 0) : 0;
    const named = [...fam.keys()].filter((f) => nameHasFamily(c.name, f));
    for (const f of named) fam.get(f)!.own_campaign = true;
    const parts: [string, number, number][] = total > 0
      ? [...bySold!.entries()].map(([f, r]) => [f, c.spend * (r / total), r])
      : named.map((f) => [f, c.spend / named.length, 0]);
    for (const [f, spend, revenue] of parts) {
      const s = fam.get(f) ?? blank(f);
      s.spend += spend; s.ad_revenue += revenue;
      s.campaigns.push({ name: c.name, spend, revenue });
      fam.set(f, s);
    }
  }
  for (const s of fam.values()) {
    s.label = [...(labels.get(s.family) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    s.promos = [...(promo.get(s.family) ?? new Map()).entries()].sort((a, b) => a[0] - b[0])
      .map(([pieces, p]) => ({ pieces, orders: p.orders, avg_total: p.total / p.orders, avg_net: p.net / p.orders }));
    s.campaigns.sort((a, b) => b.revenue - a.revenue || b.spend - a.spend);
    s.roas = s.spend > 0 ? s.ad_revenue / s.spend : null;
  }
  return [...fam.values()].sort((a, b) => b.pieces - a.pieces);
}

export interface PostIdea { kind: 'scale' | 'untapped' | 'hold'; family: string; text: string }

/**
 * Up to ~6 ideas: winners that need fresh posts (so a bigger budget has somewhere to go), products that sell
 * without ads behind them, and products not to make more posts for until the promo or price is fixed.
 */
export function postIdeas(stats: FamilyStats[], breakeven: number, days: number): PostIdea[] {
  const b = (x: number) => Math.round(x).toLocaleString('th-TH');
  const promoTip = (s: FamilyStats) => {
    const one = s.promos.find((p) => p.pieces === 1), multi = s.promos.filter((p) => p.pieces > 1).sort((a, c) => c.avg_net - a.avg_net)[0];
    if (one && multi && multi.orders >= 3 && multi.avg_net > one.avg_net * 1.5)
      return ` · โปร ${multi.pieces === 3 ? '3 ตัวขึ้นไป' : `${multi.pieces} ตัว`} กำไร/ออเดอร์ ${b(multi.avg_net)} vs 1 ตัว ${b(one.avg_net)} → ใช้โปรหลายตัวเป็นหลัก`;
    const best = [...s.promos].filter((p) => p.orders >= 3).sort((a, c) => c.avg_net - a.avg_net)[0];
    return best ? ` · โปรที่กำไร/ออเดอร์ดีสุด: ${best.pieces === 3 ? '3 ตัวขึ้นไป' : `${best.pieces} ตัว`} (เฉลี่ย ${b(best.avg_total)} ได้ ${b(best.avg_net)})` : '';
  };
  const ideas: PostIdea[] = [];
  const minPieces = Math.max(5, days);
  for (const s of stats) {
    const name = `**${s.family}** ${s.label}`;
    if (s.roas !== null && s.spend >= 1000 && s.roas >= breakeven * 1.25)
      ideas.push({ kind: 'scale', family: s.family, text: `🟢 ${name} — ROAS จริง ${s.roas.toFixed(2)} (คุ้มทุน ${breakeven.toFixed(2)}) ค่าแอด 7 วัน ${b(s.spend)} · ขายได้ ${b(s.pieces)} ตัวใน ${days} วัน → **ทำโพสต์ใหม่ 1–2 ชิ้น** มุมใหม่ (รีวิวลูกค้าใส่จริง / เทียบไซส์ / จัดเซ็ตหลายสี) จะได้มีที่ให้เพิ่มงบ${promoTip(s)}` });
    else if (!s.own_campaign && s.pieces >= minPieces && (s.roas === null || s.roas >= breakeven)) {
      const via = s.campaigns.slice(0, 2).map((c) => `"${c.name}"`).join(', ');
      ideas.push({ kind: 'untapped', family: s.family, text: `🆕 ${name} — ขายได้ ${b(s.pieces)} ตัวใน ${days} วัน${s.organic_pieces ? ` (${b(s.organic_pieces)} ตัวไม่ได้มาจากแอด)` : ''} แต่ยังไม่มีโพสต์ของตัวเอง${via ? ` — ขายติดไปกับ ${via}` : ''} → **ลองเปิดโพสต์ของ ${s.family} เอง** ฿100–200/วัน 3–5 วัน${promoTip(s)}` });
    }
    else if (s.roas !== null && s.spend >= 1000 && s.roas < breakeven)
      ideas.push({ kind: 'hold', family: s.family, text: `🔴 ${name} — ROAS จริง ${s.roas.toFixed(2)} ต่ำกว่าคุ้มทุน ${breakeven.toFixed(2)} (ค่าแอด 7 วัน ${b(s.spend)}) → **ยังไม่ต้องทำโพสต์เพิ่ม** แก้โปร/ราคา หรือเปลี่ยนรูปก่อน${promoTip(s)}` });
  }
  const pick = (k: PostIdea['kind'], n: number) => ideas.filter((i) => i.kind === k).slice(0, n);
  return [...pick('scale', 3), ...pick('untapped', 3), ...pick('hold', 2)];
}

export function postIdeasText(ideas: PostIdea[], mention: string, days: number): string {
  const who = mention ? `คุณ ${mention}` : 'ทีม';
  if (!ideas.length) return `💡 อูนิสรุปไอเดียโพสต์ให้${who}ค่ะ — สัปดาห์นี้ยังไม่มีสินค้าไหนเด่นพอจะแนะนำให้ทำโพสต์เพิ่มนะคะ`;
  const sec = (k: PostIdea['kind'], title: string) => {
    const list = ideas.filter((i) => i.kind === k);
    return list.length ? ['', title, ...list.map((i) => i.text)] : [];
  };
  return [
    `💡 อูนิสรุปไอเดียโพสต์ใหม่ให้${who}ค่ะ 🙏 (จากออเดอร์จริง Page365 ${days} วัน + ค่าแอด 7 วัน)`,
    ...sec('scale', '**ทำโพสต์เพิ่ม — ตัวที่ทำกำไรอยู่แล้ว**'),
    ...sec('untapped', '**ลองเปิดแอด — ขายได้แต่ยังไม่มีแอดของตัวเอง**'),
    ...sec('hold', '**ยังไม่ต้องทำเพิ่ม**'),
    '',
    '_โพสต์ใหม่ใส่กลุ่ม "ทดลอง" ในเว็บ กฎจะดูแลงบให้เองค่ะ_',
  ].join('\n');
}
