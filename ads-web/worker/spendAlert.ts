// Spend spike check, every 3 hours (Benz 3 Nov 2026, after an intruder's campaign spent 51,157 THB on 1 Nov
// before anyone saw it): any campaign — with a stage or not — whose spend today is over the limit is told to the
// ads channel once per day. Read-only: nothing is paused or changed here.

import type { Entity, Metrics } from '../../ads-engine/src/types.ts';

export interface SpendSpike {
  id: string;
  name: string;
  status: string;
  spend: number;
  /** The campaign's own daily budget, or the sum of its ad sets' (ABO); null when neither is set */
  budget: number | null;
  limit: number;
  /** No row in the campaigns table: the rules never look at it */
  unstaged: boolean;
}

export interface SpendLimits {
  /** Spend over this (THB) is always flagged */
  min: number;
  /** Spend over budget × this is flagged */
  times: number;
}
export const DEFAULT_SPEND_LIMITS: SpendLimits = { min: 5000, times: 3 };

/** Campaigns whose spend today exceeds max(min, budget × times). */
export function findSpendSpikes(entities: Entity[], today: Map<string, Metrics>, staged: Set<string>, limits = DEFAULT_SPEND_LIMITS): SpendSpike[] {
  const adsetBudget = new Map<string, number>();
  for (const e of entities) if (e.level === 'adset' && e.daily_budget) adsetBudget.set(e.campaign_id, (adsetBudget.get(e.campaign_id) ?? 0) + e.daily_budget);
  const out: SpendSpike[] = [];
  for (const e of entities) {
    if (e.level !== 'campaign') continue;
    const spend = today.get(e.id)?.spend ?? 0;
    const budget = e.daily_budget ?? adsetBudget.get(e.id) ?? null;
    const limit = Math.max(limits.min, budget ? budget * limits.times : 0);
    if (spend > limit) out.push({ id: e.id, name: e.name, status: e.status, spend, budget, limit, unstaged: !staged.has(e.id) });
  }
  return out.sort((a, b) => b.spend - a.spend);
}

export function spendAlertText(spikes: SpendSpike[], date: string, limits = DEFAULT_SPEND_LIMITS): string {
  const b = (x: number) => Math.round(x).toLocaleString('th-TH');
  return [
    `🚨 **ค่าแอดวันนี้ผิดปกติ (${date})** — เกิน ${b(limits.min)} หรือเกิน ${limits.times} เท่าของงบรายวัน ช่วยเปิด Ads Manager ดูด่วนค่ะ`,
    ...spikes.map((s) => `• ${s.name} — ใช้ไปแล้ว **${b(s.spend)}**${s.budget ? ` (งบ ${b(s.budget)}/วัน)` : ' (ไม่มีงบรายวัน)'} · ${s.status === 'ACTIVE' ? 'ยังเปิดอยู่' : s.status}${s.unstaged ? ' · ไม่มี stage กฎไม่ได้ดูตัวนี้' : ''}`),
    'ระบบไม่ได้หยุดอะไรให้ แค่เตือน',
  ].join('\n');
}
