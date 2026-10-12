// Suggested starting rules per stage. Not active by default: the "ใส่กฎแนะนำ" button copies them into a stage.
// Thresholds are multiples of each product's break-even, so they fit every product once its cost is linked.

import type { Rule } from './api.ts';

export const STAGE_TEMPLATES: Record<string, Rule[]> = {
  experiment: [
    { id: 'stop-no-sale', description: 'ใช้เงินแล้วยังขายไม่ได้ → หยุด ad set', level: 'adset', window: 'last_7d', metric: 'purchases', op: '<=', value: 0, min_spend: 400, action: { type: 'pause' }, cooldown_hours: 72 },
    { id: 'to-testing', description: 'เริ่มขายได้ถึงจุดคุ้มทุน → ย้ายไปทดสอบระบบ', level: 'campaign', window: 'last_7d', metric: 'roas', op: '>=', value: 1, value_mode: 'x_breakeven', min_purchases: 3, action: { type: 'move', to: 'testing' }, min_days_in_stage: 3 },
  ],
  testing: [
    { id: 'stop-loser', description: 'ต่ำกว่าคุ้มทุน 20% → หยุด ad set', level: 'adset', window: 'last_7d', metric: 'roas', op: '<', value: 0.8, value_mode: 'x_breakeven', min_spend: 500, action: { type: 'pause' }, cooldown_hours: 72 },
    { id: 'to-winning', description: 'กำไรชัดและยอดพอ → ย้ายไปทำเงิน', level: 'campaign', window: 'last_7d', metric: 'roas', op: '>=', value: 1.3, value_mode: 'x_breakeven', min_purchases: 10, action: { type: 'move', to: 'winning' }, min_days_in_stage: 3 },
  ],
  winning: [
    { id: 'scale-winner', description: 'กำไรดี → เพิ่มงบ 20%', level: 'campaign', window: 'last_7d', metric: 'roas', op: '>=', value: 1.5, value_mode: 'x_breakeven', min_spend: 1000, min_purchases: 10, action: { type: 'budget_pct', pct: 20 }, cooldown_hours: 48 },
    { id: 'cut-below-breakeven', description: 'ต่ำกว่าคุ้มทุน → ลดงบ 20%', level: 'campaign', window: 'last_7d', metric: 'roas', op: '<', value: 1, value_mode: 'x_breakeven', min_spend: 1000, action: { type: 'budget_pct', pct: -20 }, cooldown_hours: 48 },
    { id: 'fatigue-alert', description: 'คนเห็นซ้ำเยอะ → แจ้งเปลี่ยนครีเอทีฟ', level: 'adset', window: 'last_7d', metric: 'frequency', op: '>', value: 3, action: { type: 'notify' }, cooldown_hours: 72 },
    { id: 'to-retest', description: 'ดับแล้ว → ย้ายไปดับ/ทดสอบใหม่', level: 'campaign', window: 'last_7d', metric: 'roas', op: '<', value: 0.9, value_mode: 'x_breakeven', min_spend: 1000, action: { type: 'move', to: 'retest' }, min_days_in_stage: 3 },
  ],
  retest: [
    { id: 'cut-while-losing', description: 'ยังต่ำกว่าคุ้มทุน → ลดงบ 20% ต่อรอบจนถึงงบขั้นต่ำ', level: 'campaign', window: 'last_7d', metric: 'roas', op: '<', value: 1, value_mode: 'x_breakeven', min_spend: 500, action: { type: 'budget_pct', pct: -20 }, cooldown_hours: 48 },
    { id: 'stop-no-sale', description: 'ใช้เงินแล้วยังขายไม่ได้ → หยุด ad set', level: 'adset', window: 'last_7d', metric: 'purchases', op: '<=', value: 0, min_spend: 400, action: { type: 'pause' }, cooldown_hours: 72 },
    { id: 'back-to-winning', description: 'กลับมากำไร → ย้ายกลับไปทำเงิน', level: 'campaign', window: 'last_7d', metric: 'roas', op: '>=', value: 1.3, value_mode: 'x_breakeven', min_purchases: 10, action: { type: 'move', to: 'winning' }, min_days_in_stage: 3 },
  ],
};
