// Competitor analysis by formula (no AI): long-running ads, price per piece vs ours, words and formats they use,
// and whether each page is running more or fewer ads than last time.

import type { Competitor, CompetitorAd, CompetitorCheck, Overview } from './api.ts';

const DAY = 86_400_000;
export const today = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10); // Bangkok date

/** Days an ad has run: until today while active, until it was last seen once stopped. */
export function daysRunning(a: CompetitorAd, now = today()): number | null {
  if (!a.started_at) return null;
  const end = a.status === 'active' ? now : (a.last_seen ?? now);
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(a.started_at)) / DAY));
}

/** Cheapest price per piece written in a promo: "3 ตัว 499" → 166.33, "ตัวละ 199" → 199. */
export function pricePerPiece(text: string): number | null {
  const prices: number[] = [];
  for (const m of text.matchAll(/(\d{1,2})\s*ตัว\s*(?:ราคา\s*)?(\d{2,5})/g)) {
    const units = Number(m[1]); const price = Number(m[2]);
    if (units >= 1 && units <= 20 && price / units >= 20) prices.push(price / units);
  }
  for (const m of text.matchAll(/ตัวละ\s*(\d{2,5})/g)) prices.push(Number(m[1]));
  return prices.length ? Math.min(...prices) : null;
}

/** Our cheapest price per piece for a product line, from its campaigns (promos in their names) or its settings. */
export function ourPricePerPiece(data: Overview, sectionId: string): number | null {
  const fromCampaigns = data.campaigns.filter((c) => c.section_id === sectionId && c.price_per_unit_min !== null).map((c) => c.price_per_unit_min!);
  if (fromCampaigns.length) return Math.min(...fromCampaigns);
  return data.sections.find((s) => s.id === sectionId)?.economics.price_per_unit_min ?? null;
}

/** Selling angles worth counting in Thai jeans ads. */
export const ANGLES: [string, RegExp][] = [
  ['ส่งฟรี', /ส่งฟรี|ฟรีค่าส่ง|free\s*ship/i],
  ['เก็บเงินปลายทาง', /ปลายทาง|cod\b/i],
  ['ซื้อหลายตัวถูกลง', /\d\s*ตัว\s*\d{2,}/],
  ['ของแถม / 1 แถม 1', /แถม/],
  ['ลดราคา / %', /ลด|sale|%|เซล/i],
  ['รีวิว / ลูกค้าจริง', /รีวิว|ลูกค้า|review/i],
  ['ผ้ายืด / ใส่สบาย', /ยืด|สบาย|นุ่ม/],
  ['ไซส์ใหญ่ / อวบ', /ไซส์ใหญ่|อวบ|บิ๊กไซส์|big\s*size|xl/i],
  ['เก็บทรง / หุ่นดี', /เก็บพุง|เก็บทรง|หุ่น|ขายาว|สะโพก/],
  ['ด่วน / จำนวนจำกัด', /ด่วน|จำกัด|หมดแล้ว|วันนี้เท่านั้น|สุดท้าย/],
];

export function angleCounts(ads: CompetitorAd[]): { label: string; count: number }[] {
  return ANGLES.map(([label, re]) => ({ label, count: ads.filter((a) => re.test(`${a.promo} ${a.hook} ${a.notes}`)).length }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);
}

export function formatMix(ads: CompetitorAd[]): { format: string; count: number }[] {
  const label: Record<string, string> = { video: 'วิดีโอ', image: 'รูปเดียว', carousel: 'หลายรูป', '': 'ไม่ระบุ' };
  const counts = new Map<string, number>();
  for (const a of ads) counts.set(label[a.format], (counts.get(label[a.format]) ?? 0) + 1);
  return [...counts].map(([format, count]) => ({ format, count })).sort((a, b) => b.count - a.count);
}

/** Latest check and the one before it: is the page running more ads (testing/scaling) or fewer? */
export function trend(checks: CompetitorCheck[], competitorId: string): { now: CompetitorCheck; before: CompetitorCheck | null } | null {
  const mine = checks.filter((k) => k.competitor_id === competitorId).sort((a, b) => b.checked_at.localeCompare(a.checked_at));
  return mine.length ? { now: mine[0], before: mine[1] ?? null } : null;
}

/** Ad Library for one page (by page id) or a keyword search for its name, active ads in Thailand. */
export function adLibraryUrl(c: Pick<Competitor, 'name' | 'page_id'>): string {
  const base = 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=TH&media_type=all';
  return c.page_id
    ? `${base}&search_type=page&view_all_page_id=${c.page_id}`
    : `${base}&search_type=keyword_unordered&q=${encodeURIComponent(c.name)}`;
}
