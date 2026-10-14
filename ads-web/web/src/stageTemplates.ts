// Suggested starting rules per stage (the set agreed 12 Oct 2026: thresholds are multiples of each product's
// break-even; windows 3 days for budget moves, 7 days for stage moves; every cut needs real spend first).
// 14 Oct 2026: win-boost / test-boost added (Benz: aggressive mode for clear winners, every run).
// Not active by default: the "ใส่กฎแนะนำ" button copies them into a stage.

import type { Rule } from './api.ts';

export const STAGE_TEMPLATES: Record<string, Rule[]> = {
  "experiment": [
    {
      "id": "exp-stop-no-sale",
      "description": "ใช้เงิน ≥ 2× CPA แล้ว 0 ออเดอร์ใน 3 วัน → หยุด",
      "level": "campaign",
      "window": "last_3d",
      "metric": "purchases",
      "op": "<=",
      "value": 0,
      "min_spend": 300,
      "action": {
        "type": "pause"
      },
      "cooldown_hours": 72
    },
    {
      "id": "exp-timeout",
      "description": "7 วันยังต่ำกว่าคุ้มทุน 20% → หยุด",
      "level": "campaign",
      "window": "last_7d",
      "metric": "roas",
      "op": "<",
      "value": 0.8,
      "value_mode": "x_breakeven",
      "min_spend": 700,
      "action": {
        "type": "pause"
      },
      "cooldown_hours": 168
    },
    {
      "id": "exp-to-testing",
      "description": "3 วันถึงคุ้มทุนและ ≥ 3 ออเดอร์ → ย้ายไปทดสอบ",
      "level": "campaign",
      "window": "last_3d",
      "metric": "roas",
      "op": ">=",
      "value": 1.0,
      "value_mode": "x_breakeven",
      "min_purchases": 3,
      "action": {
        "type": "move",
        "to": "testing"
      },
      "min_days_in_stage": 3
    }
  ],
  "testing": [
    {
      "id": "test-boost",
      "description": "โหมดเร่ง: 3 วัน ROAS ≥ 1.6× คุ้มทุน และ ≥ 5 ออเดอร์ → +20% ทุกรอบ (เว้น 11 ชม.)",
      "level": "campaign",
      "window": "last_3d",
      "metric": "roas",
      "op": ">=",
      "value": 1.6,
      "value_mode": "x_breakeven",
      "min_spend": 450,
      "min_purchases": 5,
      "action": {
        "type": "budget_pct",
        "pct": 20
      },
      "cooldown_hours": 11
    },
    {
      "id": "test-up",
      "description": "3 วัน ROAS ≥ 1.4× คุ้มทุน และ ≥ 5 ออเดอร์ → +20% (เว้น 72 ชม.)",
      "level": "campaign",
      "window": "last_3d",
      "metric": "roas",
      "op": ">=",
      "value": 1.4,
      "value_mode": "x_breakeven",
      "min_spend": 600,
      "min_purchases": 5,
      "action": {
        "type": "budget_pct",
        "pct": 20
      },
      "cooldown_hours": 72
    },
    {
      "id": "test-cut",
      "description": "ลดเบา: 3 วันต่ำกว่าคุ้มทุน ใช้ ≥ 3× CPA → −20% (เว้น 48 ชม.)",
      "level": "campaign",
      "window": "last_3d",
      "metric": "roas",
      "op": "<",
      "value": 1.0,
      "value_mode": "x_breakeven",
      "min_spend": 450,
      "action": {
        "type": "budget_pct",
        "pct": -20
      },
      "cooldown_hours": 48
    },
    {
      "id": "test-cut-hard",
      "description": "ลดหนัก: 3 วันต่ำกว่า 0.8× คุ้มทุน ใช้ ≥ 5× CPA → −20% อีกรอบภายใน 24 ชม.",
      "level": "campaign",
      "window": "last_3d",
      "metric": "roas",
      "op": "<",
      "value": 0.8,
      "value_mode": "x_breakeven",
      "min_spend": 750,
      "action": {
        "type": "budget_pct",
        "pct": -20
      },
      "cooldown_hours": 24
    },
    {
      "id": "test-stop-no-sale",
      "description": "ใช้เงิน ≥ 2× CPA แล้ว 0 ออเดอร์ใน 3 วัน → หยุด",
      "level": "campaign",
      "window": "last_3d",
      "metric": "purchases",
      "op": "<=",
      "value": 0,
      "min_spend": 300,
      "action": {
        "type": "pause"
      },
      "cooldown_hours": 72
    },
    {
      "id": "test-to-winning",
      "description": "7 วัน ROAS ≥ 1.4× คุ้มทุน และ ≥ 10 ออเดอร์ → ย้ายไปทำเงิน",
      "level": "campaign",
      "window": "last_7d",
      "metric": "roas",
      "op": ">=",
      "value": 1.4,
      "value_mode": "x_breakeven",
      "min_purchases": 10,
      "action": {
        "type": "move",
        "to": "winning"
      },
      "min_days_in_stage": 5
    },
    {
      "id": "test-bleed",
      "description": "ตัดเลือดไหล: 3 วันต่ำกว่า 0.5× คุ้มทุน ใช้ ≥ 5× CPA → ย้ายไปดับ (ลดต่อจนถึงขั้นต่ำ)",
      "level": "campaign",
      "window": "last_3d",
      "metric": "roas",
      "op": "<",
      "value": 0.5,
      "value_mode": "x_breakeven",
      "min_spend": 750,
      "action": {
        "type": "move",
        "to": "retest"
      },
      "min_days_in_stage": 1
    },
    {
      "id": "test-to-retest",
      "description": "7 วันต่ำกว่าคุ้มทุน → ย้ายไปดับ",
      "level": "campaign",
      "window": "last_7d",
      "metric": "roas",
      "op": "<",
      "value": 1.0,
      "value_mode": "x_breakeven",
      "min_spend": 1000,
      "action": {
        "type": "move",
        "to": "retest"
      },
      "min_days_in_stage": 7
    }
  ],
  "winning": [
    {
      "id": "win-boost",
      "description": "โหมดเร่ง: 3 วัน ROAS ≥ 1.5× คุ้มทุน และ ≥ 6 ออเดอร์ → +20% ทุกรอบ (เว้น 11 ชม.)",
      "level": "campaign",
      "window": "last_3d",
      "metric": "roas",
      "op": ">=",
      "value": 1.5,
      "value_mode": "x_breakeven",
      "min_spend": 600,
      "min_purchases": 6,
      "action": {
        "type": "budget_pct",
        "pct": 20
      },
      "cooldown_hours": 11
    },
    {
      "id": "win-up",
      "description": "3 วัน ROAS ≥ 1.4× คุ้มทุน และ ≥ 8 ออเดอร์ → +20% (เว้น 72 ชม.)",
      "level": "campaign",
      "window": "last_3d",
      "metric": "roas",
      "op": ">=",
      "value": 1.4,
      "value_mode": "x_breakeven",
      "min_spend": 1000,
      "min_purchases": 8,
      "action": {
        "type": "budget_pct",
        "pct": 20
      },
      "cooldown_hours": 72
    },
    {
      "id": "win-cut",
      "description": "ลดเบา: 3 วันต่ำกว่า 1.1× คุ้มทุน ใช้ ≥ 3× CPA → −20% (เว้น 48 ชม.)",
      "level": "campaign",
      "window": "last_3d",
      "metric": "roas",
      "op": "<",
      "value": 1.1,
      "value_mode": "x_breakeven",
      "min_spend": 450,
      "action": {
        "type": "budget_pct",
        "pct": -20
      },
      "cooldown_hours": 48
    },
    {
      "id": "win-cut-hard",
      "description": "ลดหนัก: 3 วันต่ำกว่า 0.8× คุ้มทุน ใช้ ≥ 5× CPA → −20% อีกรอบภายใน 24 ชม.",
      "level": "campaign",
      "window": "last_3d",
      "metric": "roas",
      "op": "<",
      "value": 0.8,
      "value_mode": "x_breakeven",
      "min_spend": 750,
      "action": {
        "type": "budget_pct",
        "pct": -20
      },
      "cooldown_hours": 24
    },
    {
      "id": "win-fatigue",
      "description": "คนเห็นซ้ำเยอะ (frequency 7 วัน > 3) → แจ้งเปลี่ยนครีเอทีฟ ห้ามเพิ่มงบ",
      "level": "adset",
      "window": "last_7d",
      "metric": "frequency",
      "op": ">",
      "value": 3,
      "action": {
        "type": "notify"
      },
      "cooldown_hours": 72
    },
    {
      "id": "win-bleed",
      "description": "ตัดเลือดไหล: 3 วันต่ำกว่า 0.5× คุ้มทุน ใช้ ≥ 5× CPA → ย้ายไปดับ",
      "level": "campaign",
      "window": "last_3d",
      "metric": "roas",
      "op": "<",
      "value": 0.5,
      "value_mode": "x_breakeven",
      "min_spend": 750,
      "action": {
        "type": "move",
        "to": "retest"
      },
      "min_days_in_stage": 1
    },
    {
      "id": "win-to-retest",
      "description": "7 วันต่ำกว่าคุ้มทุน → ย้ายไปดับ",
      "level": "campaign",
      "window": "last_7d",
      "metric": "roas",
      "op": "<",
      "value": 1.0,
      "value_mode": "x_breakeven",
      "min_spend": 1000,
      "action": {
        "type": "move",
        "to": "retest"
      },
      "min_days_in_stage": 7
    }
  ],
  "retest": [
    {
      "id": "re-cut",
      "description": "ยังต่ำกว่าคุ้มทุน → −20% ทุก 48 ชม. จนถึงงบขั้นต่ำ",
      "level": "campaign",
      "window": "last_3d",
      "metric": "roas",
      "op": "<",
      "value": 1.0,
      "value_mode": "x_breakeven",
      "min_spend": 450,
      "action": {
        "type": "budget_pct",
        "pct": -20
      },
      "cooldown_hours": 48
    },
    {
      "id": "re-stop-no-sale",
      "description": "ใช้เงิน ≥ 2× CPA แล้ว 0 ออเดอร์ใน 3 วัน → หยุด",
      "level": "campaign",
      "window": "last_3d",
      "metric": "purchases",
      "op": "<=",
      "value": 0,
      "min_spend": 300,
      "action": {
        "type": "pause"
      },
      "cooldown_hours": 72
    },
    {
      "id": "re-stop",
      "description": "ให้โอกาส 7 วันแล้วยังต่ำกว่าคุ้มทุน → หยุด (ทำแอดใหม่แทน)",
      "level": "campaign",
      "window": "last_7d",
      "metric": "roas",
      "op": "<",
      "value": 1.0,
      "value_mode": "x_breakeven",
      "min_spend": 700,
      "action": {
        "type": "pause"
      },
      "cooldown_hours": 168
    },
    {
      "id": "re-back",
      "description": "7 วัน ROAS ≥ 1.2× คุ้มทุน และ ≥ 5 ออเดอร์ → กลับไปทำเงิน",
      "level": "campaign",
      "window": "last_7d",
      "metric": "roas",
      "op": ">=",
      "value": 1.2,
      "value_mode": "x_breakeven",
      "min_purchases": 5,
      "action": {
        "type": "move",
        "to": "winning"
      },
      "min_days_in_stage": 5
    }
  ]
};
