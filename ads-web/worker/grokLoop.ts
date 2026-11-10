// Closing the "(Grok)" loop (Benz 2026-11-10, docs/creative.md "Full loop"). Pure parts, tested in grokLoop.test.ts:
//   reviewAd   a running test ad → graduate (hand it to the testing-stage rules), stop early, or wait
//   brief      the month's goal gap → how many test posts and new images are needed now (the card Grok reads)
//   chatVoice  what customers asked / why they didn't buy, from the daily chat reads → the caption writer's prompt

export type ReviewMode = 'off' | 'dry' | 'on';
export const GRADUATE = { spend: 500, orders: 3, x_be: 1.5 };
export const STOP = { days: 5, spend: 300 };

export interface AdNumbers { days: number; spend: number; meta_purchases: number; real_orders: number; real_value: number }
export interface Verdict { action: 'graduate' | 'stop' | 'wait'; why: string }

/**
 * Real orders (Page365, credited to the campaign) over Meta's spend, which also counts days not uploaded yet, so the
 * ROAS here is never higher than the true one. Stop needs both Meta's tags and Page365 to say nothing sold.
 */
export function reviewAd(a: AdNumbers, breakeven: number | null): Verdict {
  const roas = a.spend > 0 ? a.real_value / a.spend : 0;
  const nums = `ค่าแอด ${Math.round(a.spend)} · ออเดอร์จริง ${a.real_orders} · ROAS จริง ${roas.toFixed(2)}`;
  if (a.spend >= GRADUATE.spend && a.real_orders >= GRADUATE.orders) {
    if (breakeven === null) return { action: 'wait', why: `${nums} — ยังไม่มีจุดคุ้มทุนของร้าน (ต้องมีไฟล์ Page365 ≥ 7 วัน)` };
    if (roas >= GRADUATE.x_be * breakeven) return { action: 'graduate', why: `${nums} ≥ ${GRADUATE.x_be}× คุ้มทุน (${(GRADUATE.x_be * breakeven).toFixed(2)}) → ย้ายเข้ากลุ่มทดสอบ ให้กฎงบดูแลต่อ` };
  }
  if (a.days >= STOP.days && a.spend >= STOP.spend && a.meta_purchases === 0 && a.real_orders === 0) return { action: 'stop', why: `${a.days} วัน ค่าแอด ${Math.round(a.spend)} ยังไม่มีออเดอร์เลย (ทั้ง Meta และ Page365) → หยุดก่อนกำหนด เปิดช่องให้ชุดใหม่` };
  return { action: 'wait', why: `${nums} — รอ (ผ่าน: ค่าแอด ≥ ${GRADUATE.spend}, ≥ ${GRADUATE.orders} ออเดอร์, ROAS ≥ ${GRADUATE.x_be}× คุ้มทุน · หยุดก่อน: ${STOP.days} วัน ≥ ${STOP.spend} บาท ไม่มีออเดอร์)` };
}

/** A graduated post is taken to absorb about this much a day (the copy ramp's ceiling, DUP_RAMP_TO). */
export const WINNER_ABSORBS = 1000;
/** Share of tests that graduate, assumed until MIN_FINISHED tests have ended. */
export const ASSUMED_HIT_RATE = 1 / 3, MIN_FINISHED = 5;

export interface BriefInput {
  needed_per_day: number | null; avg_net: number | null; mer: number | null; gross_margin: number | null;
  running: number; max_active: number; waiting_images: number; proposed: number; finished: number; graduated: number;
}
export interface Brief {
  gap_per_day: number; extra_ads_per_day: number | null; winners_needed: number; tests_needed: number;
  hit_rate: number; hit_rate_assumed: boolean; free_slots: number; images_now: number; lines: string[];
}

/** Goal gap → extra ad spend at today's real efficiency → winners to carry it → tests at the hit rate → images now. */
export function brief(i: BriefInput): Brief {
  const gap = Math.max(0, Math.round((i.needed_per_day ?? 0) - (i.avg_net ?? 0)));
  const perBaht = i.mer !== null && i.gross_margin !== null ? i.mer * i.gross_margin - 1 : null; // net per ad baht
  const extra = gap > 0 && perBaht !== null && perBaht > 0 ? Math.round(gap / perBaht) : null;
  const winners = extra === null ? 0 : Math.ceil(extra / WINNER_ABSORBS);
  const assumed = i.finished < MIN_FINISHED;
  const rate = assumed ? ASSUMED_HIT_RATE : Math.max(0.1, i.graduated / i.finished);
  const tests = Math.ceil(winners / rate);
  const free = Math.max(0, i.max_active - i.running);
  const images = Math.max(0, Math.min(tests, free) - i.waiting_images - i.proposed);
  const n = (x: number) => x.toLocaleString('th-TH');
  const lines: string[] = [];
  if (i.needed_per_day === null || i.avg_net === null) lines.push('ยังคำนวณเป้าไม่ได้ (ยังไม่มีไฟล์ Page365 ของเดือนนี้)');
  else if (!gap) lines.push(`กำไรเฉลี่ย ${n(Math.round(i.avg_net))}/วัน ถึงอัตราที่เป้าต้องการแล้ว (${n(Math.round(i.needed_per_day))}/วัน) — ทำโพสต์ใหม่เพื่อรักษาระดับ`);
  else {
    lines.push(`เป้าต้องได้ ${n(Math.round(i.needed_per_day))}/วัน ตอนนี้เฉลี่ย ${n(Math.round(i.avg_net))}/วัน → ขาด ${n(gap)}/วัน`);
    if (extra === null) lines.push('แอดตอนนี้ยังไม่เหลือกำไรต่อบาท (MER × กำไรขั้นต้น ≤ 1) — เพิ่มงบไม่ช่วย ต้องได้โพสต์ที่ขายดีกว่าเดิม');
    else lines.push(`ที่ประสิทธิภาพจริงตอนนี้ (MER ${i.mer!.toFixed(2)} × กำไรขั้นต้น ${Math.round(i.gross_margin! * 100)}%) ต้องใช้ค่าแอดเพิ่ม ~${n(extra)}/วัน = โพสต์ที่ผ่าน ~${winners} ตัว (ตัวละ ~${n(WINNER_ABSORBS)}/วัน) = ต้องทดสอบ ~${tests} โพสต์ (${assumed ? `สมมติผ่าน 1 ใน 3 จนกว่าจะมีผลครบ ${MIN_FINISHED} ตัว` : `ผ่านจริง ${i.graduated}/${i.finished}`})`);
  }
  lines.push(`แอดทดสอบเปิดอยู่ ${i.running}/${i.max_active} · ว่าง ${free} ช่อง · ภาพใหม่รอจับคู่ ${i.waiting_images} · รอแม็กซ์กด ${i.proposed}`);
  lines.push(images > 0 ? `👉 วันนี้ทำภาพใหม่ ${images} ภาพ (1 ภาพใหม่ = 1 โพสต์ทดสอบ)` : free === 0 ? '👉 ช่องเต็ม — รอผล ไม่ต้องทำภาพเพิ่มวันนี้' : '👉 มีภาพ/ข้อเสนอรออยู่พอกับช่องที่ว่างแล้ว — ตามให้แม็กซ์กดใน Discord');
  return { gap_per_day: gap, extra_ads_per_day: extra, winners_needed: winners, tests_needed: tests, hit_rate: rate, hit_rate_assumed: assumed, free_slots: free, images_now: images, lines };
}

/**
 * From the daily chat reads (chatInsights.ts headings): what customers asked and why they didn't buy, newest first,
 * with the "ลูกค้า N (…)" citations removed. No customer names are in the reads (the read's own rule).
 */
export function chatVoice(reads: string[], maxChars = 1500): string {
  const out: string[] = [];
  for (const text of reads) {
    for (const head of ['ลูกค้าถามบ่อย', 'ทำไมไม่ซื้อ']) {
      const m = new RegExp(`\\*\\*[^*\\n]*${head}[^*\\n]*\\*\\*([\\s\\S]*?)(?=\\n\\*\\*|$)`).exec(text);
      if (!m) continue;
      for (const line of m[1].split('\n').map((l) => l.replace(/\(?ลูกค้า \d+[^)]*\)/g, '').replace(/\s+/g, ' ').trim()).filter((l) => l.length > 8)) out.push(`[${head}] ${line.replace(/^[-•\d.\s]+/, '')}`);
    }
  }
  const seen = new Set<string>(), kept: string[] = [];
  let used = 0;
  for (const l of out) { if (seen.has(l) || used + l.length > maxChars) continue; seen.add(l); kept.push(`- ${l}`); used += l.length; }
  return kept.join('\n');
}
