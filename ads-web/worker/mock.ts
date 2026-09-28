// Stand-in for MetaClient when DEV_MOCK_META=true, so the dashboard can be developed without a Meta token.
// Numbers are PkJeans campaigns from 21–27 Sep 2026 (ads-engine/reports). Changes live in memory until the dev server restarts.

import type { Entity, Level, Metrics, Window } from '../../ads-engine/src/types.ts';

// [id, name, daily budget (CBO) or null (ABO), spend 7d, purchases 7d, ROAS 7d, frequency 7d]
const CAMPAIGNS: [string, string, number | null, number, number, number, number][] = [
  ['120246475548900069', 'REV 801 - กระบอกยืด 3 ตัว 799', null, 14590.18, 79, 2.31, 2.5],
  ['120248995329510069', 'แอดผี : E200 1ตัว199 - 1200', 1200, 8223.85, 98, 4.59, 1.61],
  ['120248593134640069', 'กระบอก  ni9 ไม่ยืด - V6 ฿1000', 1000, 7810.46, 28, 1.85, 1.75],
  ['120248603201540069', 'REV 801 - กระบอกยืด 3 ตัว 799 - V1 ฿800', 800, 6918.94, 30, 1.91, 2.25],
  ['120248862350800069', 'ni9 ผ้าสี 3ตัว499 ฿900', 900, 6246.27, 52, 3.52, 1.9],
  ['120248857938250069', 'โพสผี : 501 กระบอกไม่ยืด 1 ตัว 199 ฿800 V2', 800, 5609.86, 52, 2.63, 1.34],
  ['120248781790650069', 'โพสผี : 501 กระบอกไม่ยืด 1 ตัว 199 ฿800', 800, 5608.36, 48, 2.66, 1.31],
  ['120249267547060069', 'โพสผี : 501 กระบอกไม่ยืด 1 ตัว 199 ฿500 V3', 500, 4411.09, 42, 2.98, 1.39],
  ['120248517041400069', 'กระบอก  ni9 ไม่ยืด - V2 ฿500', 500, 3477.47, 9, 1.82, 1.5],
  ['120249267552710069', 'แอดผี : 444/1 (199 ส่งฟรี - 2ตัว 349) - ฿500 V1', 500, 3407.43, 31, 3.32, 1.39],
  ['120249091581760069', 'โพสผี : 801 กระบอกยืด 1 ตัว 189 (3ตัว549) ฿300', 300, 2114.43, 29, 7.59, 1.65],
  ['120247076697030069', 'CLIMAX - L100-300 - 200฿', 200, 1369.24, 13, 6.33, 1.96],
  ['120248431470320069', '444/1 ขาสั้น 3ตัว700 -130฿ V2', 130, 916.74, 1, 0.71, 1.87],
  ['120248466116520069', 'อันยอง เกาหลี - 50฿ V2', 50, 730.38, 2, 0.51, 1.56],
  ['120249179285970069', 'โพสผี : ขาสั้น W 1ตัว199 / 2ตัว379 ฿50', 50, 351, 0, 0, 1.41],
  ['120250097797590069', 'ขาสั้น 009 2ตัว349 พื้นหลังขาว', 90, 218.28, 1, 0.91, 1.21],
];

interface Row { e: Entity; m7: Metrics }

function metrics(spend: number, purchases: number, roas: number, frequency: number): Metrics {
  const purchase_value = Math.round(spend * roas);
  const impressions = Math.round(spend * 14);
  const clicks = Math.round(impressions * 0.022);
  return {
    spend, impressions, clicks, ctr: 2.2, cpc: clicks ? spend / clicks : 0, frequency, purchases, purchase_value,
    cpa: purchases ? spend / purchases : Infinity, roas: spend ? purchase_value / spend : 0, messages: 0, cost_per_message: Infinity,
  };
}

function build(): Row[] {
  const rows: Row[] = [];
  for (const [id, name, budget, spend, purchases, roas, freq] of CAMPAIGNS) {
    rows.push({ e: { level: 'campaign', id, name, campaign_id: id, campaign_name: name, status: 'ACTIVE', daily_budget: budget, metrics: {} }, m7: metrics(spend, purchases, roas, freq) });
    // ABO campaigns hold budget on their ad sets; CBO ad sets have none.
    const adsets: [string, number | null, number][] = budget === null ? [['กางเกงขายาว-1200', 1200, 0.58], ['ทั่วไป-1000', 850, 0.42]] : [['ทั่วไป', null, 1]];
    adsets.forEach(([asName, asBudget, share], i) => {
      rows.push({
        e: { level: 'adset', id: `${id}${i}`, name: asName, campaign_id: id, campaign_name: name, status: 'ACTIVE', daily_budget: asBudget, metrics: {} },
        m7: metrics(round(spend * share), Math.round(purchases * share), roas, freq),
      });
    });
  }
  return rows;
}

let rows: Row[] | null = null;

export class MockMeta {
  private get rows(): Row[] {
    return (rows ??= build());
  }

  async accountName(): Promise<string> {
    return 'PkJeans (ข้อมูลตัวอย่าง) (THB)';
  }

  async listEntities(): Promise<Entity[]> {
    return this.rows.map((r) => ({ ...r.e, metrics: {} }));
  }

  async insights(level: Level, window: Window): Promise<Map<string, Metrics>> {
    const scale: Record<Window, number> = { today: 1 / 7, yesterday: 1 / 7, last_3d: 3 / 7, last_7d: 1, last_14d: 2, last_30d: 30 / 7 };
    const k = scale[window];
    return new Map(this.rows.filter((r) => r.e.level === level).map((r) => {
      const m = r.m7;
      return [r.e.id, { ...m, spend: round(m.spend * k), purchases: Math.round(m.purchases * k), purchase_value: Math.round(m.purchase_value * k), impressions: Math.round(m.impressions * k), clicks: Math.round(m.clicks * k) }];
    }));
  }

  async setStatus(id: string, status: 'ACTIVE' | 'PAUSED'): Promise<void> {
    this.find(id).status = status;
  }

  async setDailyBudget(id: string, amount: number): Promise<void> {
    const e = this.find(id);
    if (e.daily_budget === null) throw new Error('This object has no daily budget (mock)');
    e.daily_budget = amount;
  }

  private find(id: string): Entity {
    const r = this.rows.find((x) => x.e.id === id);
    if (!r) throw new Error(`Unknown object ${id} (mock)`);
    return r.e;
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
