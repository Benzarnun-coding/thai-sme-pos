// The working behind one row of the daily sales report, in words with the real numbers — shown under the row
// and written to the CSV so the numbers can be checked by hand.

import type { SalesRow } from './api.ts';
import { baht, num } from './fmt.ts';

const b2 = (n: number) => baht(n, 2);
const n1 = (n: number) => num(n, Number.isInteger(Math.round(n * 10) / 10) ? 0 : 1);
const pct = (r: number) => `${num(r * 100, 1)}%`;

export function formulaLines(r: SalesRow): string[] {
  const c = r.calc;
  const R = r.revenue, N = r.orders, S = r.spend;
  const profitLine = (cost: number, profit: number) => `กำไร = ยอดขาย ${b2(R)} − ทุนสินค้า ${b2(cost)} − ค่าแอด ${b2(S)} = ${b2(profit)}`;
  if (c.method === 'none') return [`คิดทุนไม่ได้: ${c.reason}`];
  if (c.method === 'orders') {
    const promos = c.tiers.map((t) => `${t.units} ตัว ${baht(t.price)} (ทุน ${b2(t.cost)})`).join(' · ');
    return [
      `คิดรายครั้ง จากยอดที่แอดมินติ๊กวันนั้น ${num(c.orders)} ครั้ง · ทุนจาก${c.source}: ${promos}`,
      `ตรงโปร ${num(c.matched)} ครั้ง (${num(c.match_rate * 100)}% ของยอด) ใช้ทุนจริงของโปร · ที่ไม่ตรงโปรคิดทุนแบบระวัง (ดูรายครั้งในตาราง "รายการยอดเข้า")`,
      `ทุนรวมทุกครั้ง ÷ ยอดรวม = ${pct(c.cost_ratio)} → ทุนสินค้า = ${b2(R)} × ${pct(c.cost_ratio)} = ${b2(r.cost_high ?? 0)}`,
      `จำนวนตัว ≈ ${n1(r.units_high ?? 0)} ตัว (จากโปรที่จับคู่ได้)`,
      profitLine(r.cost_high ?? 0, r.profit_low ?? 0),
    ];
  }
  if (c.method === 'sheet_exact' || c.method === 'sheet_ratio') {
    const promos = c.tiers.map((t) => `${t.units} ตัว ${baht(t.price)} (ทุน ${b2(t.cost)})`).join(' · ');
    const lines = [`ต้นทุนจากชีต "${c.sheet_name}": ${promos}`];
    if (c.method === 'sheet_exact') {
      const [t1, t2] = c.tiers;
      const [m1, m2] = c.mix;
      lines.push(
        `ออเดอร์ ${num(N)} · ยอดขาย ${b2(R)} → โปร ${t2.units} ตัว = (${num(R)} − ${num(t1.price)}×${num(N)}) ÷ (${num(t2.price)} − ${num(t1.price)}) = ${n1(m2)} ออเดอร์ · โปร ${t1.units} ตัว = ${num(N)} − ${n1(m2)} = ${n1(m1)} ออเดอร์`,
        `จำนวนตัว = ${n1(m1)}×${t1.units} + ${n1(m2)}×${t2.units} = ${n1(r.units_low ?? 0)} ตัว`,
        `ทุนสินค้า = ${n1(m1)}×${b2(t1.cost)} + ${n1(m2)}×${b2(t2.cost)} = ${b2(r.cost_low ?? 0)}`,
        profitLine(r.cost_low ?? 0, r.profit_low ?? 0),
      );
      return lines;
    }
    lines.push(c.tiers.length === 1
      ? 'มีโปรเดียว → ทุนสินค้า = ยอดขาย × (ทุน ÷ ราคา)'
      : `ยอดเฉลี่ย ${b2(N ? R / N : 0)}/ออเดอร์ อยู่นอกช่วงราคาโปร หรือมีมากกว่า 2 โปร → แยกไม่ได้ว่าขายโปรไหน คิดทุนเป็นสัดส่วนของยอดขาย`);
    const same = Math.abs(c.ratio_max - c.ratio_min) < 1e-9;
    lines.push(`ทุนสินค้า = ${b2(R)} × ${pct(c.ratio_max)} = ${b2(r.cost_high ?? 0)}${same ? '' : ` (ถ้าเป็นโปรทุนเบาสุด: × ${pct(c.ratio_min)} = ${b2(r.cost_low ?? 0)})`}`);
    lines.push(profitLine(r.cost_high ?? 0, r.profit_low ?? 0) + (same ? '' : ` (ถึง ${b2(r.profit_high ?? 0)})`));
    return lines;
  }
  const goods = R - c.cod_deducted;
  const lines = [`ต้นทุนตามสินค้า "${c.product}": ทุน ${b2(c.cost_per_unit)}/ตัว · ราคาขาย ${c.price_min === c.price_max ? b2(c.price_min) : `${b2(c.price_min)}–${b2(c.price_max)}`}/ตัว`];
  if (c.cod_deducted > 0) lines.push(`หักค่าเก็บปลายทางที่รวมในยอด ${b2(c.cod_deducted)} → ยอดค่าสินค้า ${b2(goods)}`);
  lines.push(`จำนวนตัว = ${b2(goods)} ÷ ${b2(c.price_min)} = ${n1(r.units_high ?? 0)} ตัว${c.price_min === c.price_max ? '' : ` (ถ้าขายราคาเต็ม ÷ ${b2(c.price_max)} = ${n1(r.units_low ?? 0)})`}`);
  lines.push(`ทุนสินค้า = ${n1(r.units_high ?? 0)} × ${b2(c.cost_per_unit)}${c.extra_per_order ? ` + ${num(N)} ออเดอร์ × ${b2(c.extra_per_order)}` : ''} = ${b2(r.cost_high ?? 0)}`);
  lines.push(profitLine(r.cost_high ?? 0, r.profit_low ?? 0));
  return lines;
}

export function methodLabel(r: SalesRow): string {
  return { orders: `รายครั้ง · ตรงโปร ${r.calc.method === 'orders' ? num(r.calc.match_rate * 100) : 0}%`, sheet_exact: 'ประมาณ · ชีต แยกโปรได้', sheet_ratio: 'ประมาณ · ชีต สัดส่วน', product: 'ประมาณ · ตามสินค้า', none: 'ไม่มีทุน' }[r.calc.method];
}
