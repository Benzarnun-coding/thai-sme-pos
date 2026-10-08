// "ไอเดีย": deterministic suggestions from the numbers — no AI. Each one says what was seen, why it matters,
// and (when there is one) the action a person can take with one click. Nothing here changes anything by itself.

import type { Entity, Metrics } from '../../ads-engine/src/types.ts';

export type IdeaKind = 'declining' | 'rising' | 'underfunded' | 'money_sink' | 'no_sales' | 'fatigue' | 'weak_winner' | 'unassigned';

export type IdeaAction =
  | { type: 'move'; to: string }
  | { type: 'budget_pct'; pct: number }
  | { type: 'pause' }
  | { type: 'open_stage_tab'; tab: string };

export interface Idea {
  id: string;
  kind: IdeaKind;
  severity: 'high' | 'medium' | 'low';
  campaign_id: string | null;
  campaign_name: string;
  title: string;
  detail: string;
  action: IdeaAction | null;
  /** Numbers behind the idea, for the card */
  facts: { label: string; value: string }[];
}

export interface IdeaInput {
  campaign: Entity;
  m7: Metrics | undefined;
  m30: Metrics | undefined;
  stage_id: string | null;
  /** Product break-even ROAS when costs are linked */
  breakeven: number | null;
  /** A budget change in the last few days (here or in Meta): its effect isn't in the 7-day numbers yet */
  recent_budget_change?: { at: string; from: number | null; to: number | null } | null;
}

const fmt = (n: number, d = 2) => n.toLocaleString('th-TH', { maximumFractionDigits: d, minimumFractionDigits: d });
const baht = (n: number) => `฿${Math.round(n).toLocaleString('th-TH')}`;
const roasOf = (m: Pick<Metrics, 'spend' | 'purchase_value'>) => (m.spend > 0 ? m.purchase_value / m.spend : 0);

/**
 * The yardstick for "good": the product's break-even when known, else the account's 7-day ROAS.
 * The previous period is the 30 days minus the last 7, so the two never overlap.
 */
export function buildIdeas(inputs: IdeaInput[]): Idea[] {
  const running = inputs.filter((i) => i.campaign.status === 'ACTIVE' && i.m7);
  const total = running.reduce((t, i) => ({ spend: t.spend + i.m7!.spend, value: t.value + i.m7!.purchase_value, purchases: t.purchases + i.m7!.purchases }), { spend: 0, value: 0, purchases: 0 });
  const accountRoas = total.spend > 0 ? total.value / total.spend : 0;
  const accountCpa = total.purchases > 0 ? total.spend / total.purchases : Infinity;
  const budgets = running.map((i) => i.campaign.daily_budget).filter((b): b is number => b !== null).sort((a, b) => a - b);
  const medianBudget = budgets.length ? budgets[Math.floor(budgets.length / 2)] : 0;

  const ideas: Idea[] = [];
  for (const i of running) {
    const c = i.campaign;
    const m7 = i.m7!;
    const r7 = roasOf(m7);
    const base = i.breakeven ?? accountRoas;
    const baseLabel = i.breakeven !== null ? `คุ้มทุน ${fmt(i.breakeven)}` : `เฉลี่ยบัญชี ${fmt(accountRoas)}`;
    const prev = i.m30 ? { spend: i.m30.spend - m7.spend, purchase_value: i.m30.purchase_value - m7.purchase_value } : null;
    const rPrev = prev && prev.spend >= 500 ? roasOf(prev) : null;
    const facts = [
      { label: 'ใช้จ่าย 7 วัน', value: baht(m7.spend) },
      { label: 'ออเดอร์', value: String(m7.purchases) },
      { label: 'ROAS 7 วัน', value: fmt(r7) },
      ...(rPrev !== null ? [{ label: 'ROAS ช่วงก่อน', value: fmt(rPrev) }] : []),
      { label: 'เกณฑ์', value: baseLabel },
      ...(c.daily_budget !== null ? [{ label: 'งบ/วัน ตอนนี้', value: baht(c.daily_budget) }] : []),
    ];
    const recent = i.recent_budget_change;
    const add = (kind: IdeaKind, severity: Idea['severity'], title: string, detail: string, action: IdeaAction | null) => {
      // Budget just changed: the 7-day numbers can't show it yet, so don't suggest another change for now.
      if (action?.type === 'budget_pct' && recent) {
        const when = new Date(recent.at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });
        detail += ` · ปรับงบแล้ว ${recent.from === null ? '' : `${baht(recent.from)} → `}${baht(recent.to ?? 0)} เมื่อ ${when} — รอดูผล 3 วันก่อนปรับอีก`;
        action = null;
        severity = 'low';
      }
      ideas.push({ id: `${kind}:${c.id}`, kind, severity, campaign_id: c.id, campaign_name: c.name, title, detail, action, facts });
    };
    const hasBudget = c.daily_budget !== null;

    // Spent a real amount (twice the account's cost per order) and sold nothing.
    if (m7.purchases === 0 && Number.isFinite(accountCpa) && m7.spend >= 2 * accountCpa) {
      add('no_sales', 'high', 'ใช้เงินแต่ยังขายไม่ได้', `ใช้ไป ${baht(m7.spend)} ใน 7 วัน (เท่ากับค่าแอดของ ${fmt(m7.spend / accountCpa, 1)} ออเดอร์โดยเฉลี่ย) แต่ยังไม่มีออเดอร์`, { type: 'pause' });
      continue;
    }

    // Used to work, now clearly worse than its own past and below the yardstick.
    if (rPrev !== null && m7.spend >= 1000 && rPrev >= base * 0.9 && r7 < rPrev * 0.8 && r7 < base) {
      const drop = Math.round((1 - r7 / rPrev) * 100);
      add('declining', m7.spend >= 5000 ? 'high' : 'medium', 'กำลังดับ',
        `ROAS ตกจาก ${fmt(rPrev)} เหลือ ${fmt(r7)} (−${drop}%) และต่ำกว่า${baseLabel}`,
        i.stage_id !== 'retest' ? { type: 'move', to: 'retest' } : hasBudget ? { type: 'budget_pct', pct: -20 } : null);
      continue;
    }

    // In "winning" but no longer beats the yardstick.
    if (i.stage_id === 'winning' && m7.spend >= 1000 && r7 < base) {
      add('weak_winner', 'medium', 'อยู่กลุ่มทำเงินแต่ผลต่ำกว่าเกณฑ์', `ROAS 7 วัน ${fmt(r7)} ต่ำกว่า${baseLabel}`, { type: 'move', to: 'retest' });
      continue;
    }

    // Big spender below the yardstick.
    if (m7.spend >= 3000 && r7 < base * 0.8) {
      add('money_sink', 'high', 'ใช้เงินเยอะแต่ผลต่ำ', `ใช้ ${baht(m7.spend)} ใน 7 วัน ROAS ${fmt(r7)} ต่ำกว่า${baseLabel} 20% ขึ้นไป`, hasBudget ? { type: 'budget_pct', pct: -20 } : null);
      continue;
    }

    // Clearly profitable with enough orders to trust it.
    if (m7.purchases >= 5 && r7 >= base * 1.3) {
      if (i.stage_id !== 'winning') {
        add('rising', 'medium', 'ผลงานดี น่าย้ายไปกลุ่มทำเงิน', `ROAS ${fmt(r7)} สูงกว่า${baseLabel} ${Math.round((r7 / base - 1) * 100)}% จาก ${m7.purchases} ออเดอร์`, { type: 'move', to: 'winning' });
      } else if (hasBudget && c.daily_budget! <= medianBudget && m7.purchases >= 10 && r7 >= base * 1.5) {
        add('underfunded', 'medium', 'กำไรดีแต่งบน้อย', `ROAS ${fmt(r7)} แต่งบ ${baht(c.daily_budget!)}/วัน อยู่ครึ่งล่างของบัญชี`, { type: 'budget_pct', pct: 20 });
      }
    }

    // Creative fatigue: shown to the same people often.
    if (m7.frequency >= 3 || (i.m30?.frequency ?? 0) >= 4) {
      add('fatigue', 'low', 'คนเห็นซ้ำเยอะ ควรเปลี่ยนครีเอทีฟ', `Frequency 7 วัน ${fmt(m7.frequency)}${i.m30 ? ` · 30 วัน ${fmt(i.m30.frequency)}` : ''}`, null);
    }
  }

  const unassigned = running.filter((i) => !i.stage_id);
  if (unassigned.length) {
    ideas.push({
      id: 'unassigned', kind: 'unassigned', severity: 'low', campaign_id: null, campaign_name: '',
      title: `มี ${unassigned.length} แคมเปญที่เปิดอยู่แต่ยังไม่จัดกลุ่ม`,
      detail: 'ระบบจะไม่แตะแคมเปญเหล่านี้จนกว่าจะเลือกกลุ่มให้',
      action: { type: 'open_stage_tab', tab: 'none' },
      facts: [{ label: 'ใช้จ่าย 7 วันรวม', value: baht(unassigned.reduce((t, i) => t + i.m7!.spend, 0)) }],
    });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  const spendOf = (id: string | null) => inputs.find((i) => i.campaign.id === id)?.m7?.spend ?? 0;
  return ideas.sort((a, b) => rank[a.severity] - rank[b.severity] || spendOf(b.campaign_id) - spendOf(a.campaign_id));
}
