// Daily chart for one campaign: spend as bars, ROAS as a line, break-even as a dashed guide. Inline SVG, no library.

import { useState } from 'react';
import type { DailyRow } from './api.ts';
import { baht, num } from './fmt.ts';

const W = 640;
const H = 200;
const PAD = { l: 8, r: 8, t: 12, b: 22 };

export function DailyChart({ days, breakeven }: { days: DailyRow[]; breakeven: number | null }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!days.length) return <div className="chart-empty muted small">ยังไม่มีข้อมูลรายวันในช่วงนี้</div>;

  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const maxSpend = Math.max(1, ...days.map((d) => d.spend));
  const roas = days.map((d) => (d.spend > 0 ? d.purchase_value / d.spend : null));
  const maxRoas = Math.max(1, breakeven ?? 0, ...roas.map((r) => r ?? 0)) * 1.1;
  const step = innerW / days.length;
  const barW = Math.max(2, step * 0.62);
  const x = (i: number) => PAD.l + step * i + step / 2;
  const ySpend = (v: number) => PAD.t + innerH - (v / maxSpend) * innerH;
  const yRoas = (v: number) => PAD.t + innerH - (v / maxRoas) * innerH;

  // Break the line where a day had no spend.
  const segments: string[] = [];
  let cur = '';
  roas.forEach((r, i) => {
    if (r === null) { if (cur) segments.push(cur); cur = ''; return; }
    cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${yRoas(r).toFixed(1)}`;
  });
  if (cur) segments.push(cur);

  const labelEvery = Math.ceil(days.length / 7);
  const sel = hover ?? days.length - 1;
  const d = days[sel];

  return (
    <div className="chart">
      <div className="chart-readout">
        <span className="muted">{thaiDate(d.date)}</span>
        <span><i className="dot spend" />ใช้จ่าย <b>{baht(d.spend)}</b></span>
        <span><i className="dot roas" />ROAS <b>{roas[sel] === null ? '–' : num(roas[sel], 2)}</b></span>
        <span>ออเดอร์ <b>{num(d.purchases)}</b></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="กราฟใช้จ่ายและ ROAS รายวัน" onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + innerH * (1 - f)} y2={PAD.t + innerH * (1 - f)} className="grid" />
        ))}
        {days.map((day, i) => (
          <g key={day.date} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
            <rect x={x(i) - step / 2} y={PAD.t} width={step} height={innerH} className="hit" />
            <rect x={x(i) - barW / 2} y={ySpend(day.spend)} width={barW} height={Math.max(0, PAD.t + innerH - ySpend(day.spend))} rx="2" className={`bar ${i === sel ? 'sel' : ''}`} />
            {i % labelEvery === (days.length - 1) % labelEvery && (
              <text x={x(i)} y={H - 6} textAnchor="middle" className="axis">{shortDate(day.date)}</text>
            )}
          </g>
        ))}
        {breakeven !== null && breakeven < maxRoas && (
          <g>
            <line x1={PAD.l} x2={W - PAD.r} y1={yRoas(breakeven)} y2={yRoas(breakeven)} className="be" />
            <text x={W - PAD.r - 2} y={yRoas(breakeven) - 4} textAnchor="end" className="axis be-label">คุ้มทุน {num(breakeven, 2)}</text>
          </g>
        )}
        {segments.map((p, i) => <path key={i} d={p} className="line" />)}
        {roas.map((r, i) => r !== null && <circle key={i} cx={x(i)} cy={yRoas(r)} r={i === sel ? 4 : 2.5} className="pt" />)}
      </svg>
    </div>
  );
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}`;
}

function thaiDate(iso: string): string {
  return new Date(`${iso}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });
}
