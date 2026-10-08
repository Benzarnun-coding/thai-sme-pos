// "ยอดขายรายวัน": one row per day, then the selected day broken down by campaign — revenue, orders, pieces,
// product cost, ad spend, profit — with the working for each row and a CSV for Excel.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, WINDOW_LABEL, type Overview, type SalesRow, type Window } from './api.ts';
import { stageLabel } from './actions.tsx';
import { baht, num, profitTone, roasTone, when } from './fmt.ts';
import { formulaLines, methodLabel } from './salesFormula.ts';
import { Icon, useUi } from './ui.tsx';

const WINDOWS: Window[] = ['last_7d', 'last_14d', 'last_30d'];

interface DayTotal { date: string; revenue: number; orders: number; units: number; cost: number; spend: number; profit: number; campaigns: number; uncosted: number }

/** Conservative figures (higher cost, lower profit) throughout, matching the rest of the dashboard. */
function totalOf(rows: SalesRow[], date = ''): DayTotal {
  return rows.reduce((t, r) => ({
    ...t,
    revenue: t.revenue + r.revenue,
    orders: t.orders + r.orders,
    units: t.units + (r.units_high ?? 0),
    cost: t.cost + (r.cost_high ?? 0),
    spend: t.spend + r.spend,
    profit: t.profit + (r.profit_low ?? 0),
    campaigns: t.campaigns + 1,
    uncosted: t.uncosted + (r.calc.method === 'none' ? 1 : 0),
  }), { date, revenue: 0, orders: 0, units: 0, cost: 0, spend: 0, profit: 0, campaigns: 0, uncosted: 0 });
}

const thaiDay = (iso: string) => new Date(`${iso}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });
const todayBkk = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

export function SalesPage({ data, onOpenCampaign }: { data: Overview; onOpenCampaign: (id: string) => void }) {
  const { toast } = useUi();
  const [window, setWindow] = useState<Window>('last_14d');
  const [report, setReport] = useState<{ rows: SalesRow[]; fetched_at: string; warning: string | null } | null>(null);
  const [error, setError] = useState('');
  const [date, setDate] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    setReport(null); setError('');
    api.salesReport(window).then(setReport).catch((e) => setError(e.message));
  }, [window]);

  const days = useMemo(() => {
    const by = new Map<string, SalesRow[]>();
    for (const r of report?.rows ?? []) by.set(r.date, [...(by.get(r.date) ?? []), r]);
    return [...by].map(([d, rows]) => totalOf(rows, d)).sort((a, b) => b.date.localeCompare(a.date));
  }, [report]);
  // Default to the latest complete day: today is still being tagged by the admins.
  const selected = date ?? days.find((d) => d.date !== todayBkk())?.date ?? days[0]?.date ?? null;
  const dayRows = (report?.rows ?? []).filter((r) => r.date === selected).sort((a, b) => b.revenue - a.revenue);
  const all = totalOf(report?.rows ?? []);

  function exportCsv() {
    if (!report) return;
    const head = ['วันที่', 'แคมเปญ', 'กลุ่ม', 'ยอดขาย', 'ออเดอร์', 'จำนวนตัว', 'ทุนสินค้า', 'ค่าแอด', 'กำไร', 'กำไร (สูงสุด)', 'ROAS', 'วิธีคิดทุน', 'สูตร'];
    const esc = (v: string | number | null) => {
      const s = v === null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
    const lines = [...report.rows].sort((a, b) => a.date.localeCompare(b.date) || b.revenue - a.revenue).map((r) => [
      r.date, r.name, stageLabel(data.stages, r.stage_id), r2(r.revenue), r.orders, r2(r.units_high), r2(r.cost_high), r2(r.spend),
      r2(r.profit_low), r2(r.profit_high), r.spend ? r2(r.revenue / r.spend) : null, methodLabel(r), formulaLines(r).join(' | '),
    ].map(esc).join(','));
    // BOM so Excel opens Thai text correctly.
    const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pkjeans-sales-${window}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('ดาวน์โหลด CSV แล้ว — เปิดด้วย Excel ได้เลย', 'ok');
  }

  return (
    <div className="sales">
      <div className="ideas-intro">
        <div>
          <h2>ยอดขายรายวัน</h2>
          <p className="muted small">
            ยอดขายและออเดอร์จาก Meta (ที่แอดมินติ๊ก) · ทุนจากชีตรายแคมเปญ หรือทุนตามสินค้า · ตัวเลขแบบระวัง (ทุนสูง กำไรต่ำ) · กด "วิธีคิด" เพื่อดูสูตรของแต่ละแถว
            {report && <> · ข้อมูลเมื่อ {when(report.fetched_at)}</>}
          </p>
        </div>
        <div className="row wrap">
          <div className="segmented">
            {WINDOWS.map((w) => <button key={w} className={w === window ? 'on' : ''} onClick={() => { setWindow(w); setDate(null); }}>{WINDOW_LABEL[w]}</button>)}
          </div>
          <button className="ghost small" disabled={!report} onClick={exportCsv}><Icon name="down" size={14} /> CSV (Excel)</button>
        </div>
      </div>
      {report?.warning && <div className="banner">{report.warning}</div>}
      {error && <div className="error">{error}</div>}
      {!report && !error && <div className="skeleton" style={{ height: 320 }} />}

      {report && (
        <>
          <section className="card table-card">
            <div className="table-card-head">
              <h2>สรุปรายวัน <span className="muted small">กดวันเพื่อดูแยกตามแอด</span></h2>
              {all.uncosted > 0 && <p className="small warn">กำไรนับเฉพาะแอดที่มีทุน — แอดที่ไม่มีทุนนับยอดขายและค่าแอด แต่ไม่นับทุนและกำไร (เพิ่มในชีตต้นทุนเพื่อให้ครบ)</p>}
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>วันที่</th><th className="num">ยอดขาย</th><th className="num">ออเดอร์</th><th className="num">ตัว</th><th className="num">ทุนสินค้า</th><th className="num">ค่าแอด</th><th className="num">กำไร</th><th className="num">ROAS</th><th className="num">แอดที่มียอด</th></tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.date} className={`clickable ${d.date === selected ? 'selected' : ''}`} onClick={() => setDate(d.date)}>
                      <td><b>{thaiDay(d.date)}</b>{d.date === todayBkk() && <span className="muted small"> (วันนี้ ยังไม่ครบ)</span>}</td>
                      <td className="num strong">{baht(d.revenue)}</td>
                      <td className="num">{num(d.orders)}</td>
                      <td className="num">{num(d.units)}</td>
                      <td className="num">{baht(d.cost)}</td>
                      <td className="num">{baht(d.spend)}</td>
                      <td className={`num strong ${d.profit < 0 ? 'bad' : 'good'}`}>{baht(d.profit)}</td>
                      <td className="num">{d.spend ? num(d.revenue / d.spend, 2) : '–'}</td>
                      <td className="num">{d.campaigns}{d.uncosted > 0 && <span className="warn small" title="แอดที่ยังไม่มีทุน: ไม่ได้นับทุนและกำไร"> ({d.uncosted} ไม่มีทุน)</span>}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="total-row">
                    <td>รวม {WINDOW_LABEL[window]}</td>
                    <td className="num">{baht(all.revenue)}</td><td className="num">{num(all.orders)}</td><td className="num">{num(all.units)}</td>
                    <td className="num">{baht(all.cost)}</td><td className="num">{baht(all.spend)}</td>
                    <td className={`num ${all.profit < 0 ? 'bad' : 'good'}`}>{baht(all.profit)}</td>
                    <td className="num">{all.spend ? num(all.revenue / all.spend, 2) : '–'}</td><td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {selected && (
            <section className="card table-card">
              <div className="table-card-head">
                <h2>{thaiDay(selected)} <span className="muted small">แยกตามแอด · {dayRows.length} แคมเปญ</span></h2>
                <button className="ghost small" onClick={() => setOpen(open.size ? new Set() : new Set(dayRows.map((r) => r.campaign_id)))}>{open.size ? 'ซ่อนวิธีคิดทั้งหมด' : 'แสดงวิธีคิดทั้งหมด'}</button>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>แคมเปญ</th><th className="num">ยอดขาย</th><th className="num">ออเดอร์</th><th className="num">ตัว</th><th className="num">ทุนสินค้า</th><th className="num">ค่าแอด</th><th className="num">กำไร</th><th className="num">ROAS</th><th>วิธีคิดทุน</th></tr>
                  </thead>
                  <tbody>
                    {dayRows.map((r) => {
                      const isOpen = open.has(r.campaign_id);
                      const roas = r.spend ? r.revenue / r.spend : null;
                      const be = r.calc.method === 'sheet_exact' || r.calc.method === 'sheet_ratio'
                        ? 1 / (1 - Math.max(...r.calc.tiers.map((t) => t.cost / t.price)))
                        : data.campaigns.find((c) => c.id === r.campaign_id)?.breakeven_roas ?? null;
                      return (
                        <Fragment key={r.campaign_id}>
                          <tr className={isOpen ? 'open' : ''}>
                            <td className="campaign-cell">
                              <button className="name-link" onClick={() => onOpenCampaign(r.campaign_id)}>{r.name}</button>
                              <div className="small muted">{stageLabel(data.stages, r.stage_id)}</div>
                            </td>
                            <td className="num strong">{baht(r.revenue)}</td>
                            <td className="num">{num(r.orders)}</td>
                            <td className="num">{r.units_high === null ? '–' : num(r.units_high)}</td>
                            <td className="num">{r.cost_high === null ? '–' : baht(r.cost_high)}</td>
                            <td className="num">{baht(r.spend)}</td>
                            <td className={`num strong ${profitTone(r.profit_low, r.profit_high)}`}>{r.profit_low === null ? '–' : baht(r.profit_low)}</td>
                            <td className={`num ${roasTone(roas, be !== null && Number.isFinite(be) ? be : null)}`}>{roas === null ? '–' : num(roas, 2)}</td>
                            <td>
                              <button className={`small ${r.calc.method === 'none' ? 'warn' : 'ghost'}`} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(r.campaign_id)) n.delete(r.campaign_id); else n.add(r.campaign_id); return n; })}>
                                {methodLabel(r)} <Icon name={isOpen ? 'up' : 'down'} size={12} />
                              </button>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="formula-row">
                              <td colSpan={9}>
                                <ol className="formula">{formulaLines(r).map((l, i) => <li key={i}>{l}</li>)}</ol>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    {(() => { const t = totalOf(dayRows); return (
                      <tr className="total-row">
                        <td>รวมวันนี้</td>
                        <td className="num">{baht(t.revenue)}</td><td className="num">{num(t.orders)}</td><td className="num">{num(t.units)}</td>
                        <td className="num">{baht(t.cost)}</td><td className="num">{baht(t.spend)}</td>
                        <td className={`num ${t.profit < 0 ? 'bad' : 'good'}`}>{baht(t.profit)}</td>
                        <td className="num">{t.spend ? num(t.revenue / t.spend, 2) : '–'}</td>
                        <td className="small muted">{t.uncosted ? `${t.uncosted} แอดไม่มีทุน (ไม่นับกำไร)` : ''}</td>
                      </tr>
                    ); })()}
                  </tfoot>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
