// "ยอดขายรายวัน": one row per day, then the selected day broken down by campaign — revenue, orders, pieces,
// product cost, ad spend, profit — with the working for each row and a CSV for Excel.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, WINDOW_LABEL, type ActualSales, type ConversionCampaign, type Overview, type P365Upload, type ReferralSummary, type SalesRow, type UploadedOrder, type Window } from './api.ts';
import { readFirstSheet } from './xlsx.ts';
import { stageLabel } from './actions.tsx';
import { baht, num, profitTone, roasTone, when } from './fmt.ts';
import { formulaLines, methodLabel } from './salesFormula.ts';
import { Icon, useUi } from './ui.tsx';

const WINDOWS: Window[] = ['last_7d', 'last_14d', 'last_30d'];

interface DayTotal { date: string; revenue: number; orders: number; units: number; cost: number; spend: number; profit: number; campaigns: number; uncosted: number; costedRevenue: number }

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
    costedRevenue: t.costedRevenue + (r.calc.method === 'none' ? 0 : r.revenue),
  }), { date, revenue: 0, orders: 0, units: 0, cost: 0, spend: 0, profit: 0, campaigns: 0, uncosted: 0, costedRevenue: 0 });
}

const thaiDay = (iso: string) => new Date(`${iso}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });
const todayBkk = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

export function SalesPage({ data, onOpenCampaign }: { data: Overview; onOpenCampaign: (id: string) => void }) {
  const { toast } = useUi();
  const [window, setWindow] = useState<Window>('last_14d');
  const [report, setReport] = useState<{ rows: SalesRow[]; uploaded: string[]; fetched_at: string; warning: string | null } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState('');
  const [date, setDate] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    setReport(null); setError('');
    api.salesReport(window).then(setReport).catch((e) => setError(e.message));
  }, [window, reloadKey]);

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
      <P365UploadCard window={window} onUploaded={() => setReloadKey((k) => k + 1)} campaignName={(id) => data.campaigns.find((c) => c.id === id)?.name ?? `แคมเปญ ${id}`} />
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
                      <td><b>{thaiDay(d.date)}</b>{d.date === todayBkk() && <span className="muted small"> (วันนี้ ยังไม่ครบ)</span>}{report?.uploaded.includes(d.date) && <span className="badge ok-badge" style={{ marginLeft: 6 }}>ของจริง</span>}</td>
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

          <ActualCompare days={days} />

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

          {selected && <ConversionList date={selected} window={window} onOpenCampaign={onOpenCampaign} />}
          {selected && <ReferralList date={selected} data={data} onOpenCampaign={onOpenCampaign} />}
        </>
      )}
    </div>
  );
}

/**
 * Real totals from Page365 (typed in daily) against what Meta attributes to ads. The gap is sales without an ad
 * click — organic, people who saw an ad and came back another way, untagged chats. MER and shop profit use the
 * real totals; product cost for them uses that day's cost ÷ revenue from the costed campaigns.
 */
function ActualCompare({ days }: { days: DayTotal[] }) {
  const { toast } = useUi();
  const [actual, setActual] = useState<Map<string, ActualSales> | null>(null);
  const load = () => api.actualSales().then((rows) => setActual(new Map(rows.map((r) => [r.date, r])))).catch(() => setActual(new Map()));
  useEffect(() => { load(); }, []);
  if (!actual) return null;

  const rows = days.map((d) => {
    const a = actual.get(d.date);
    const ratio = d.costedRevenue > 0 ? d.cost / d.costedRevenue : null;
    const shopProfit = a?.revenue != null && ratio !== null ? a.revenue - a.revenue * ratio - d.spend : null;
    return { d, a, ratio, shopProfit, mult: a?.orders != null && d.orders ? a.orders / d.orders : null, mer: a?.revenue != null && d.spend ? a.revenue / d.spend : null };
  });
  const last7 = rows.filter((r) => r.a?.orders != null && r.d.orders).slice(0, 7);
  const avgMult = last7.length ? last7.reduce((t, r) => t + r.a!.orders!, 0) / last7.reduce((t, r) => t + r.d.orders, 0) : null;

  return (
    <section className="card table-card">
      <div className="table-card-head">
        <div>
          <h2>ยอดจริง (Page365) เทียบกับยอดจาก Meta</h2>
          <p className="muted small">
            กรอกยอดจากใบปะหน้าใน Page365 วันละครั้ง · ส่วนต่าง = ยอดที่ไม่ได้มาจากการกดแอด (organic, เห็นแอดแล้วทักทีหลัง, ไม่ได้ติ๊ก)
            · MER = ยอดขายจริง ÷ ค่าแอดทั้งหมด · กำไรทั้งร้าน = ยอดจริง − ทุน (สัดส่วนทุนของวันนั้น) − ค่าแอด
          </p>
        </div>
        {avgMult !== null && (
          <div className="mult-stat" title={`จาก ${last7.length} วันล่าสุดที่กรอกยอดจริง`}>
            <span className="small muted">ยอดจริง ÷ ยอด Meta (เฉลี่ย {last7.length} วัน)</span>
            <b>× {num(avgMult, 2)}</b>
            <span className="small muted">ROAS จริงของแอด ≈ ROAS ใน Meta × {num(avgMult, 2)}</span>
          </div>
        )}
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>วันที่</th>
              <th className="num">ออเดอร์จริง</th><th className="num">ชิ้นจริง</th><th className="num">ยอดเงินจริง</th><th />
              <th className="num">ออเดอร์ Meta</th><th className="num">ส่วนต่าง</th><th className="num">ตัวคูณ</th>
              <th className="num">ค่าแอด</th><th className="num">MER</th><th className="num">กำไรทั้งร้าน</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ d, a, ratio, shopProfit, mult, mer }) => (
              <tr key={d.date}>
                <td><b>{thaiDay(d.date)}</b></td>
                <ActualInputs date={d.date} a={a} onSaved={() => { toast('บันทึกยอดจริงแล้ว', 'ok'); load(); }} />
                <td className="num">{num(d.orders)}</td>
                <td className="num">{a?.orders != null ? <>{a.orders - d.orders >= 0 ? '+' : ''}{num(a.orders - d.orders)} <span className="muted small">({num(d.orders ? ((a.orders - d.orders) / d.orders) * 100 : 0)}%)</span></> : '–'}</td>
                <td className="num strong">{mult === null ? '–' : `× ${num(mult, 2)}`}</td>
                <td className="num">{baht(d.spend)}</td>
                <td className="num">{mer === null ? '–' : num(mer, 2)}</td>
                <td className={`num strong ${shopProfit === null ? '' : shopProfit < 0 ? 'bad' : 'good'}`} title={shopProfit === null ? (a?.revenue == null ? 'กรอกยอดเงินจริงก่อน' : 'วันนั้นยังไม่มีแคมเปญที่มีทุน') : `${baht(a!.revenue!)} − ทุน ${num(ratio! * 100, 1)}% − ค่าแอด ${baht(d.spend)}`}>
                  {shopProfit === null ? '–' : baht(shopProfit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ActualInputs({ date, a, onSaved }: { date: string; a: ActualSales | undefined; onSaved: () => void }) {
  const { toast } = useUi();
  const init = { orders: a?.orders?.toString() ?? '', pieces: a?.pieces?.toString() ?? '', revenue: a?.revenue?.toString() ?? '' };
  const [v, setV] = useState(init);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setV(init); }, [a?.updated_at]);
  const dirty = v.orders !== init.orders || v.pieces !== init.pieces || v.revenue !== init.revenue;
  const toNum = (x: string) => (x.trim() === '' ? null : Number(x));
  async function save() {
    setBusy(true);
    try { await api.saveActualSales(date, { orders: toNum(v.orders), pieces: toNum(v.pieces), revenue: toNum(v.revenue) }); onSaved(); }
    catch (e: any) { toast(e.message, 'bad'); }
    finally { setBusy(false); }
  }
  const input = (k: keyof typeof v, w: number) => (
    <input className="cell-input" style={{ width: w }} type="number" inputMode="decimal" min={0} value={v[k]} placeholder="–"
      onChange={(e) => setV({ ...v, [k]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && dirty) save(); }} />
  );
  return (
    <>
      <td className="num">{input('orders', 64)}</td>
      <td className="num">{input('pieces', 64)}</td>
      <td className="num">{input('revenue', 96)}</td>
      <td>{dirty && <button className="primary small" disabled={busy} onClick={save}>บันทึก</button>}</td>
    </>
  );
}

/**
 * Every time revenue came in on that day, per ad: "1,500 บาท · 3 ครั้ง: 450, 550, 500", each order matched to the
 * ad's promos (ตรงโปร → its real cost; ไม่ตรงโปร → probably another model, costed as a share of its value).
 */
function ConversionList({ date, window, onOpenCampaign }: { date: string; window: Window; onOpenCampaign: (id: string) => void }) {
  const [res, setRes] = useState<{ cod_fee: number; campaigns: ConversionCampaign[] } | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    setRes(null); setError(''); setOpen(new Set());
    api.conversions(date, window).then(setRes).catch((e) => setError(e.message));
  }, [date, window]);
  const cs = res?.campaigns ?? [];
  const t = cs.reduce((a, c) => ({ n: a.n + c.count, v: a.v + c.value, m: a.m + c.orders.filter((o) => o.status === 'match').reduce((x, o) => x + o.value, 0) }), { n: 0, v: 0, m: 0 });

  return (
    <section className="card table-card">
      <div className="table-card-head">
        <div>
          <h2>รายการยอดเข้า {thaiDay(date)} <span className="muted small">แต่ละแอดเข้ากี่ครั้ง ครั้งละเท่าไร</span></h2>
          <p className="muted small">
            ยอดแต่ละครั้งจับคู่กับราคาโปรของแอด (รวม +{res?.cod_fee ?? 50} เก็บปลายทาง และหลายชุดในออเดอร์เดียว) ·
            <span className="badge ok-badge">ตรงโปร</span> ใช้ทุนของโปรนั้น ·
            <span className="badge warn">ไม่ตรงโปร</span> น่าจะซื้อรุ่นอื่น/ราคาอื่น คิดทุนแบบระวังเป็นสัดส่วน
            {t.v > 0 && <> · ทั้งวันตรงโปร <b>{num((t.m / t.v) * 100)}%</b> ของยอด</>}
          </p>
        </div>
        {cs.length > 0 && <button className="ghost small" onClick={() => setOpen(open.size ? new Set() : new Set(cs.map((c) => c.campaign_id)))}>{open.size ? 'ย่อทั้งหมด' : 'แสดงทุกครั้ง'}</button>}
      </div>
      {error ? <p className="error" style={{ margin: '0 18px 12px' }}>{error}</p> : !res ? <div className="skeleton" style={{ height: 160, margin: '0 18px 12px' }} /> : cs.length === 0 ? <p className="muted small" style={{ padding: '0 18px 12px' }}>ไม่มียอดเข้าในวันนี้</p> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>แคมเปญ</th><th className="num">ยอดรวม</th><th>ยอดแต่ละครั้ง</th><th className="num">ตรงโปร</th><th className="num">ทุนสินค้า</th><th className="num">ค่าแอด</th><th className="num">กำไร</th></tr></thead>
            <tbody>
              {cs.map((c) => {
                const isOpen = open.has(c.campaign_id);
                const toggle = () => setOpen((s) => { const n = new Set(s); if (n.has(c.campaign_id)) n.delete(c.campaign_id); else n.add(c.campaign_id); return n; });
                return (
                  <Fragment key={c.campaign_id}>
                    <tr className={isOpen ? 'open' : ''}>
                      <td className="campaign-cell">
                        <button className="name-link" onClick={() => onOpenCampaign(c.campaign_id)}>{c.name}</button>
                        <div className="small muted">{c.count} ครั้ง{c.cost_source === 'sheet' ? ' · ทุนจากชีต' : c.cost_source === 'product' ? ` · ทุนตามสินค้า ${c.cost_label}` : ' · ยังไม่มีทุน'}</div>
                      </td>
                      <td className="num strong">{baht(c.value)}</td>
                      <td>
                        <button className="chips-btn" onClick={toggle} title="ดูรายละเอียดแต่ละครั้ง">
                          {c.orders.map((o, i) => (
                            <span key={i} className={`order-chip ${o.status}`}>{o.status === 'no_value' ? '฿0' : `${o.count > 1 ? `${o.count}× ` : ''}${num(o.value)}`}</span>
                          ))}
                          <Icon name={isOpen ? 'up' : 'down'} size={12} />
                        </button>
                      </td>
                      <td className={`num ${c.match_rate >= 0.9 ? 'good' : c.match_rate >= 0.6 ? '' : 'warn'}`}>{c.tiers.length ? `${c.matched}/${c.orders.length} · ${num(c.match_rate * 100)}%` : '–'}</td>
                      <td className="num">{c.cost === null ? '–' : baht(c.cost)}</td>
                      <td className="num">{c.spend === null ? '–' : baht(c.spend)}</td>
                      <td className={`num strong ${c.profit === null ? '' : c.profit < 0 ? 'bad' : 'good'}`}>{c.profit === null ? '–' : baht(c.profit)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="formula-row">
                        <td colSpan={7}>
                          {c.tiers.length > 0 && <p className="small muted" style={{ margin: '6px 0' }}>โปรของแอดนี้: {c.tiers.map((x) => `${x.units} ตัว ${baht(x.price)} (ทุน ${baht(x.cost, 2)})`).join(' · ')}</p>}
                          <ol className="formula">
                            {c.orders.map((o, i) => (
                              <li key={i}>
                                <span className="muted">{o.hour}</span> · <b>{o.status === 'no_value' ? '฿0' : baht(o.value)}</b>{o.count > 1 && ` (${o.count} ครั้งในชั่วโมงนี้)`} —{' '}
                                {o.status === 'match' && <><span className="badge ok-badge">ตรงโปร</span> {o.sets.map((s2) => `${s2.units} ตัว ${num(s2.price)}`).join(' + ')}{o.cod ? ` + เก็บปลายทาง ${num(o.cod)}` : ''} → ทุน {baht(o.cost, 2)}</>}
                                {o.status === 'mismatch' && (c.tiers.length
                                  ? <><span className="badge warn">ไม่ตรงโปร</span> ไม่ตรงกับราคาโปรของแอดนี้ อาจซื้อรุ่นอื่น → ทุนประมาณ {baht(o.cost, 2)} ({num((o.cost / o.value) * 100, 1)}% ของยอด)</>
                                  : <span className="muted">ยังไม่มีทุน/ราคาโปรของแอดนี้</span>)}
                                {o.status === 'unsplit' && <><span className="badge warn">แยกไม่ได้</span> {o.count} ครั้งรวมกันไม่ตรงกับโปร → ทุนประมาณ {baht(o.cost, 2)}</>}
                                {o.status === 'no_value' && <span className="badge">ไม่มียอดเงิน</span>}
                              </li>
                            ))}
                          </ol>
                          {c.cost !== null && c.spend !== null && <p className="small" style={{ margin: '6px 0 0' }}>กำไร = ยอด {baht(c.value, 2)} − ทุน {baht(c.cost, 2)} − ค่าแอด {baht(c.spend, 2)} = <b>{baht(c.profit ?? 0, 2)}</b></p>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="total-row">
                <td>รวม {cs.length} แอด · {num(t.n)} ครั้ง</td><td className="num">{baht(t.v)}</td><td /><td className="num">{t.v ? `${num((t.m / t.v) * 100)}%` : ''}</td>
                <td className="num">{baht(cs.reduce((a, c) => a + (c.cost ?? 0), 0))}</td>
                <td className="num">{baht(cs.reduce((a, c) => a + (c.spend ?? 0), 0))}</td>
                <td className="num">{baht(cs.reduce((a, c) => a + (c.profit ?? 0), 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * People who opened a chat from an ad that day (from the Messenger webhook, so only from the day it was switched
 * on). Different from "orders": this is who came in, before anyone bought.
 */
function ReferralList({ date, data, onOpenCampaign }: { date: string; data: Overview; onOpenCampaign: (id: string) => void }) {
  const [rows, setRows] = useState<ReferralSummary[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setRows(null); setError('');
    api.adReferrals({ date }).then((r) => setRows(r.rows)).catch((e) => setError(e.message));
  }, [date]);
  const byCampaign = useMemo(() => {
    const m = new Map<string, { campaign_id: string | null; people: number; bought: number; events: number; ads: ReferralSummary[] }>();
    for (const r of rows ?? []) {
      const k = r.campaign_id ?? '';
      const g = m.get(k) ?? { campaign_id: r.campaign_id, people: 0, bought: 0, events: 0, ads: [] };
      g.people += r.people; g.bought += r.bought; g.events += r.events; g.ads.push(r);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.people - a.people);
  }, [rows]);
  const nameOf = (id: string | null) => (id ? data.campaigns.find((c) => c.id === id)?.name ?? `แคมเปญ ${id}` : 'ไม่ทราบแอด/ลิงก์อื่น');
  const total = byCampaign.reduce((t, g) => t + g.people, 0);
  const bought = byCampaign.reduce((t, g) => t + g.bought, 0);

  return (
    <section className="card table-card">
      <div className="table-card-head">
        <div>
          <h2>ลูกค้าทักจากแอด {thaiDay(date)} <span className="muted small">{total ? `${num(total)} คน${bought ? ` · ซื้อแล้ว ${num(bought)} (${num((bought / total) * 100)}%)` : ''}` : ''}</span></h2>
          <p className="muted small">นับคนที่กดทักเพจจากแอด (Messenger webhook) · มีข้อมูลตั้งแต่วันที่เชื่อมต่อในหน้าตั้งค่า · "ซื้อแล้ว" = คนที่มีออเดอร์ในไฟล์ Page365 หลังจากทัก (ภายใน 14 วัน)</p>
        </div>
      </div>
      {error ? <p className="error" style={{ margin: '0 18px 12px' }}>{error}</p> : !rows ? <div className="skeleton" style={{ height: 80, margin: '0 18px 12px' }} /> : rows.length === 0 ? <p className="muted small" style={{ padding: '0 18px 12px' }}>ไม่มีข้อมูลวันนี้ (ถ้ายังไม่ได้เชื่อมต่อ webhook ให้เปิดในหน้าตั้งค่า)</p> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>แคมเปญ</th><th>แอด</th><th className="num">คน</th><th className="num">ซื้อแล้ว</th><th className="num">ครั้ง</th></tr></thead>
            <tbody>
              {byCampaign.map((g) => g.ads.map((a, i) => (
                <tr key={`${g.campaign_id}-${a.ad_id}`}>
                  <td className="campaign-cell">{i === 0 && (g.campaign_id ? <button className="name-link" onClick={() => onOpenCampaign(g.campaign_id!)}>{nameOf(g.campaign_id)}</button> : <span className="muted">{nameOf(null)}</span>)}</td>
                  <td className="small">{a.ad_name ?? a.ad_id ?? '–'}</td>
                  <td className="num strong">{num(a.people)}</td>
                  <td className="num">{a.bought ? <span className="good">{num(a.bought)}</span> : <span className="muted">0</span>}</td>
                  <td className="num">{num(a.events)}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const numOrNull = (v: string | undefined) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Page365's daily export, read in the browser (only the columns the numbers need are sent; names are hashed server-side, never stored). */
function P365UploadCard({ window, onUploaded, campaignName }: { window: Window; onUploaded: () => void; campaignName: (id: string) => string }) {
  const { toast } = useUi();
  const [uploads, setUploads] = useState<P365Upload[] | null>(null);
  const [busy, setBusy] = useState('');
  const [showAll, setShowAll] = useState(false);
  const load = () => api.p365Uploads(window).then((r) => setUploads(r.uploads)).catch(() => setUploads([]));
  useEffect(() => { load(); }, [window]);

  const [pending, setPending] = useState<{ name: string; orders: UploadedOrder[]; days: { date: string; n: number; total: number }[] } | null>(null);

  // Step 1: read the file in the browser and show what is in it. Nothing is sent yet.
  async function onFile(file: File) {
    setBusy('กำลังอ่านไฟล์…');
    try {
      const { headers, rows } = await readFirstSheet(file);
      const need = ['Order no.', 'Created At', 'Total'];
      const missing = need.filter((h) => !headers.includes(h));
      if (missing.length) throw new Error(`ไฟล์ไม่มีคอลัมน์ ${missing.join(', ')} — ต้องเป็นไฟล์ export ออเดอร์จาก Page365`);
      const orders: UploadedOrder[] = rows.filter((r) => r['Order no.']).map((r) => ({
        order_no: r['Order no.'], created_at: r['Created At'], total: Number(r['Total']),
        subtotal: numOrNull(r['Subtotal']), discount: numOrNull(r['Discount']), shipping: numOrNull(r['Shipping Cost']), cost: numOrNull(r['Cost']),
        payment: r['Payment Provider'] ?? null, paid_at: r['Paid At'] ?? null, item_detail: r['Item Detail'] ?? null, profile_name: r['Profile name'] ?? r['Customer Name'] ?? null,
      }));
      if (!orders.length) throw new Error('ไม่พบออเดอร์ในไฟล์');
      const byDay = new Map<string, { n: number; total: number }>();
      for (const o of orders) {
        const d = (o.created_at ?? '').slice(0, 10);
        const x = byDay.get(d) ?? { n: 0, total: 0 };
        x.n++; x.total += Number.isFinite(o.total) ? o.total : 0;
        byDay.set(d, x);
      }
      setPending({ name: file.name, orders, days: [...byDay].map(([date, x]) => ({ date, ...x })).sort((a, b) => a.date.localeCompare(b.date)) });
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }

  // Step 2: the person has checked the summary and confirms.
  async function submit() {
    if (!pending) return;
    setBusy(`กำลังส่ง ${pending.orders.length} ออเดอร์…`);
    try {
      const res = await api.p365Upload(pending.orders);
      const c = Object.values(res.credits).reduce((t, x) => ({ customer: t.customer + x.customer, exact: t.exact + x.exact, approx: t.approx + x.approx, none: t.none + x.none }), { customer: 0, exact: 0, approx: 0, none: 0 });
      toast(`บันทึก ${res.orders} ออเดอร์ (${res.dates.join(', ')}) · จับคู่แอดได้ ${c.customer + c.exact + c.approx} · ไม่ทราบแอด ${c.none}${res.errors.length ? ` · ข้าม ${res.errors.length} แถว` : ''}`, 'ok');
      setPending(null);
      await load();
      onUploaded();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }

  // The team's "รวม" sheet, generated: one row per real order with the per-order fees and the campaign it was credited to.
  async function exportOrders(dates: string[]) {
    if (!dates.length) return;
    setBusy('กำลังเตรียมไฟล์…');
    try {
      const days = await Promise.all(dates.map((d) => api.p365Orders(d)));
      const f = days[0]?.fees;
      const esc = (v: string | number | null | undefined) => { const t = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const head = ['วันที่', 'เลขออเดอร์', 'สินค้า', 'จำนวนตัว', 'ราคาขาย', 'ต้นทุน', 'ขนส่ง', `COD ${f?.cod_pct ?? ''}%`, `LOSS ${f?.loss_pct ?? ''}%`, `ค่าส่ง ${f?.ship ?? ''}`, `VAT ${f?.vat_pct ?? ''}%`, `ค่าซอง ${f?.bag ?? ''}`, 'กำไรก่อนค่าแอด', 'แคมเปญ', 'วิธีจับคู่'];
      const rows = days.flatMap((d) => d.orders.map((o) => {
        const cod = o.payment === 'cod' && f ? o.total * f.cod_pct / 100 : 0;
        const loss = f ? o.total * f.loss_pct / 100 : 0;
        const vat = f ? (f.vat_base === 'goods' ? Math.max(0, o.total - (o.shipping ?? 0)) : o.total) * f.vat_pct / 100 : 0;
        const net = o.cost === null ? null : o.total - o.cost - o.fees;
        return [
          new Date(o.created_at).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }), o.order_no, o.items.map((i) => `${i.name} (${i.sku}) x${i.qty}`).join(' | '), o.units, r2(o.total), o.cost === null ? '' : r2(o.cost),
          o.payment === 'cod' ? 'COD' : 'โอน', r2(cod), r2(loss), f?.ship ?? '', r2(vat), f?.bag ?? '', net === null ? '' : r2(net),
          o.campaign_id ? campaignName(o.campaign_id) : 'ไม่ทราบแอด', { customer: 'ลูกค้าทักจากแอด', exact: 'เวลา+ยอด', approx: 'ประมาณ', none: '' }[o.match],
        ].map(esc).join(',');
      }));
      const blob = new Blob(['\ufeff' + [head.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pkjeans-orders-${dates[dates.length - 1]}_${dates[0]}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`ดาวน์โหลด ${rows.length} ออเดอร์แล้ว`, 'ok');
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }

  const list = uploads ?? [];
  const shown = showAll ? list : list.slice(0, 3);
  return (
    <section className="card">
      <div className="table-card-head" style={{ padding: 0, marginBottom: 8 }}>
        <div>
          <h2>ไฟล์ออเดอร์จาก Page365</h2>
          <p className="muted small">
            อัปโหลดไฟล์ export ออเดอร์ (.xlsx) วันละครั้ง → วันนั้นใช้ยอด ทุน และจำนวนตัวจริงแทนการประมาณ และจับคู่แต่ละออเดอร์กับแอด (จากลูกค้าที่ทักจากแอด หรือจากเวลา+ยอดที่แอดมินติ๊ก)
            · เก็บเฉพาะตัวเลขและรหัสสินค้า ไม่เก็บชื่อ เบอร์ ที่อยู่
          </p>
        </div>
        <label className={`button ${busy ? 'disabled' : ''}`} style={{ cursor: busy ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
          <Icon name="up" size={14} /> {busy || 'เลือกไฟล์ .xlsx'}
          <input type="file" accept=".xlsx" style={{ display: 'none' }} disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
        </label>
      </div>
      {pending && (
        <div className="banner" style={{ marginBottom: 12 }}>
          <div><b>{pending.name}</b> — {num(pending.orders.length)} ออเดอร์ · {pending.days.map((d) => `${thaiDay(d.date)} ${num(d.n)} ออเดอร์ ${baht(d.total)}`).join(' · ')}</div>
          <div className="muted small" style={{ margin: '4px 0 8px' }}>
            {pending.days.some((d) => list.some((u) => u.date === d.date)) ? 'วันนี้เคยอัปโหลดแล้ว — ยืนยันแล้วจะแทนที่ข้อมูลเดิมของวันนั้น · ' : ''}
            ยังไม่ได้ส่งอะไร กดยืนยันเพื่อบันทึก
          </div>
          <div className="row gap">
            <button className="primary" disabled={!!busy} onClick={submit}>{busy || `ยืนยันอัปโหลด ${num(pending.orders.length)} ออเดอร์`}</button>
            <button className="ghost" disabled={!!busy} onClick={() => setPending(null)}>ยกเลิก</button>
          </div>
        </div>
      )}
      {uploads === null ? null : list.length === 0 ? <p className="muted small">ยังไม่มีไฟล์ในช่วงนี้</p> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>วันที่</th><th className="num">ออเดอร์</th><th className="num">ยอด</th><th className="num">ตัว</th><th className="num">จับคู่แอดได้</th><th className="num">ไม่ทราบแอด</th><th>อัปโหลด</th></tr></thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.date}>
                  <td><b>{thaiDay(u.date)}</b></td>
                  <td className="num">{num(u.orders)}</td>
                  <td className="num">{baht(u.revenue)}</td>
                  <td className="num">{num(u.units)}</td>
                  <td className="num">{num(u.credits.customer + u.credits.exact + u.credits.approx)}<span className="muted small"> ({u.credits.customer} ลูกค้า · {u.credits.exact} เวลา/ยอด · {u.credits.approx} ประมาณ)</span></td>
                  <td className="num">{num(u.credits.none)}</td>
                  <td className="small muted">{when(u.uploaded_at)} · {u.uploaded_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row gap wrap" style={{ marginTop: 8 }}>
            {list.length > 3 && <button className="ghost small" onClick={() => setShowAll(!showAll)}>{showAll ? 'ย่อ' : `ดูทั้งหมด ${list.length} วัน`}</button>}
            <button className="ghost small" disabled={!!busy} onClick={() => exportOrders(list.map((u) => u.date))}><Icon name="down" size={14} /> รายออเดอร์พร้อมหักค่าใช้จ่าย (CSV เหมือนชีต "รวม")</button>
          </div>
        </div>
      )}
    </section>
  );
}
