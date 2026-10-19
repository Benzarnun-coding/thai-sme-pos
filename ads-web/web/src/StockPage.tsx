// /catalog/stock — "สต็อก": our own stock of 5 models × sizes 28–36 in two places.
//   พี่เปีย (BB branch): cut by the order sheets — rows in the "พี่เปีย" group of a saved round, each order once.
//   GoSell (fulfillment): cut by the button on the GoSell page after a file (confirmed here).
// Received stock ("รับของเข้า") and count corrections ("ปรับยอด") are typed here. Replaces the "Stock BB" sheet.

import { useEffect, useMemo, useState } from 'react';
import { api, type GosellCut, type Role, type SalesData, type StockData, type StockItem, type StockLoc, type StockMove } from './api.ts';
import { coverDays, forecast, refill, sizeShares, type Forecast } from './forecast.ts';
import { compareSize } from './catalog.ts';
import { num } from './fmt.ts';
import { roundLabel, thaiShortDate } from './purchase.ts';
import { HomeLogo, SiteNav } from './SiteNav.tsx';
import { useUi } from './ui.tsx';

const LOC_LABEL: Record<StockLoc, string> = { pia: 'พี่เปีย (BB)', gosell: 'GoSell', pk: 'PK (โกดัง)' };
const LOCS: StockLoc[] = ['pia', 'gosell', 'pk'];
const KIND_LABEL: Record<StockMove['kind'], string> = { open: 'ยอดเริ่ม', in: 'ของเข้า', out: 'ออก', adjust: 'ปรับยอด' };
const LOW = 5;
const todayBkk = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const minusDays = (iso: string, d: number) => new Date(Date.parse(iso) - d * 86400_000).toISOString().slice(0, 10);
const TARGET_KEY = 'stock.targetDays';
const HISTORY_DAYS = 28;

/** Forecast per model and days of cover per SKU, for one place (see forecast.ts for the method). */
interface Plan {
  models: Map<string, { f: Forecast; pieces: number }>;
  sku: Map<string, { rate: number; days: number | null; share: number }>;
  source: string;
}

function makePlan(items: StockItem[], sales: SalesData, loc: StockLoc, balance: Map<string, number>, links: Map<string, string>): Plan {
  const today = todayBkk();
  const age = (d: string) => Math.round((Date.parse(today) - Date.parse(d)) / 86400_000);
  const bySku = new Map(items.map((i) => [i.sku, i]));
  // พี่เปีย sells what TikTok/Shopee orders (order-sheet rounds); GoSell what Facebook orders (Page365); PK both.
  const bs = sales.bigseller.map((r) => ({ date: r.date, sku: r.sku, qty: Number(r.qty) || 0 }));
  const fb = sales.page365.map((r) => ({ date: r.date, sku: r.sku, qty: Number(r.qty) || 0 }));
  const rows = (loc === 'pia' ? bs : loc === 'gosell' ? fb : [...bs, ...fb]).map((r) => ({ ...r, sku: links.get(r.sku) ?? links.get(r.sku.toUpperCase()) ?? r.sku }));
  const both = sales.bigsellerDays.filter((d) => sales.page365Days.includes(d));
  const dataDays = (loc === 'pia' ? sales.bigsellerDays : loc === 'gosell' ? sales.page365Days : both.length >= 3 ? both : [...new Set([...sales.bigsellerDays, ...sales.page365Days])]).filter((d) => d < today);
  const perDay = new Map<string, Map<string, number>>(); // model → date → pieces
  const perSize = new Map<string, Map<string, number>>(); // model → size → pieces
  for (const r of rows) {
    const it = bySku.get(r.sku.toUpperCase()) ?? bySku.get(r.sku);
    if (!it || r.date >= today) continue;
    const d = perDay.get(it.code) ?? new Map<string, number>();
    d.set(r.date, (d.get(r.date) ?? 0) + r.qty);
    perDay.set(it.code, d);
    const z = perSize.get(it.code) ?? new Map<string, number>();
    z.set(it.size, (z.get(it.size) ?? 0) + r.qty);
    perSize.set(it.code, z);
  }
  const models = new Map<string, { f: Forecast; pieces: number }>();
  const sku = new Map<string, { rate: number; days: number | null; share: number }>();
  for (const code of [...new Set(items.map((i) => i.code))]) {
    const d = perDay.get(code) ?? new Map<string, number>();
    const f = forecast(dataDays.map((day) => ({ age: age(day), qty: d.get(day) ?? 0 })));
    models.set(code, { f, pieces: [...d.values()].reduce((a, b) => a + b, 0) });
    const sizes = items.filter((i) => i.code === code).map((i) => i.size);
    const shares = sizeShares(perSize.get(code) ?? new Map(), sizes);
    for (const i of items.filter((x) => x.code === code)) {
      // no balance here, or no sales to forecast from: no days shown (rather than a misleading "> 90 วัน")
      if (!balance.has(i.sku) || f.method === 'none' || f.mean === 0) continue;
      const share = shares.get(i.size) ?? 0;
      sku.set(i.sku, { rate: f.at(1) * share, days: coverDays(balance.get(i.sku) ?? 0, f, share), share });
    }
  }
  return { models, sku, source: loc === 'pia' ? 'TikTok/Shopee จากรอบใบสั่ง' : loc === 'gosell' ? 'Facebook จาก Page365' : 'TikTok/Shopee จากรอบใบสั่ง + Facebook จาก Page365' };
}

const daysText = (d: number | null) => (d === null ? '> 90 วัน' : d < 1 ? '< 1 วัน' : `~${Math.floor(d)} วัน`);
const daysClass = (d: number | null, target: number) => (d === null ? '' : d < 7 ? 'bad' : d < target ? 'warn' : 'good');
/** What the GoSell page hands over (same browser): the orders of the file it just made. */
export const GOSELL_HANDOFF = 'gosell.stockCut';
export interface GosellHandoff { file: string; at: string; lines: { order_no: string; sku: string; qty: number }[] }

type Mode = null | 'in' | 'adjust' | 'open';

export function StockApp() {
  useEffect(() => { document.title = 'สต็อก'; }, []);
  const { toast, confirm } = useUi();
  const [data, setData] = useState<StockData | null>(null);
  const [role, setRole] = useState<Role>('viewer');
  const [loc, setLoc] = useState<StockLoc>(() => (new URLSearchParams(location.search).get('gosell') ? 'gosell' : 'pia'));
  const [mode, setMode] = useState<Mode>(null);
  const load = () => api.stock().then(setData).catch((e) => toast(e.message, 'bad'));
  const [sales, setSales] = useState<SalesData | null>(null);
  useEffect(() => { api.sales(minusDays(todayBkk(), HISTORY_DAYS), minusDays(todayBkk(), 1)).then(setSales).catch(() => {}); }, []);
  const [target, setTarget] = useState(() => { try { return Number(localStorage.getItem(TARGET_KEY)) || 14; } catch { return 14; } });
  useEffect(() => { try { localStorage.setItem(TARGET_KEY, String(target)); } catch { /* private mode */ } }, [target]);
  useEffect(() => { load(); api.me().then((m) => setRole(m.role)).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const canEdit = role === 'owner' || role === 'admin' || role === 'costs';
  const canOpen = role === 'owner' || role === 'admin';

  // the products this place keeps
  const items = useMemo(() => (data?.items ?? []).filter((i) => i.locs.includes(loc)), [data, loc]);
  const links = useMemo(() => new Map((data?.links ?? []).filter((k) => k.loc === loc).map((k) => [k.sku, k.stock_sku])), [data, loc]);
  // PK lists every code: in code order (200, 200/2 …); the 5-model places keep their own order
  const models = useMemo(() => { const c = [...new Set(items.map((i) => i.code))]; return loc === 'pk' ? c.sort((a, b) => a.localeCompare(b, 'en', { numeric: true })) : c; }, [items, loc]);
  const sizes = useMemo(() => [...new Set(items.map((i) => i.size))].sort(compareSize), [items]);
  const skuOf = (code: string, size: string) => items.find((i) => i.code === code && i.size === size)?.sku;
  const balance = useMemo(() => new Map((data?.balances ?? []).filter((b) => b.loc === loc).map((b) => [b.sku, b.qty])), [data, loc]);
  const started = !!data?.start[loc];
  const total = [...balance.values()].reduce((a, b) => a + b, 0);
  // A size with no entry at all is not kept at this place (e.g. 701/1 at พี่เปีย): shown as — rather than as sold out.
  const lowCount = items.filter((i) => balance.has(i.sku) && (balance.get(i.sku) ?? 0) <= LOW).length;
  const plan = useMemo(() => (data && sales ? makePlan(items, sales, loc, balance, links) : null), [data, sales, items, loc, balance, links]);

  return (
    <div className="app stock">
      <SiteNav current="/catalog/stock" />
      <header className="top">
        <div className="brand">
          <HomeLogo text="สต็อก" />
          <div>
            <h1>สต็อก</h1>
            <p className="muted small clip">{models.length} รุ่น · ไซส์ {sizes[0] ?? ''}–{sizes[sizes.length - 1] ?? ''} · พี่เปียและ PK ตัดตามใบสั่งของ (ใบ "พี่เปีย" / ใบ "PK") · GoSell ตัดเมื่อกดหลังทำไฟล์ GoSell{links.size ? ` · ${loc === 'pia' ? '601/1–3 ตัดจาก 501/1–3' : ''}` : ''}</p>
          </div>
        </div>
      </header>

      <section className="card units-range">
        <div className="segmented" role="tablist" aria-label="สต็อกที่ไหน">
          {LOCS.map((l) => <button key={l} className={loc === l ? 'on' : ''} onClick={() => { setLoc(l); setMode(null); }}>{LOC_LABEL[l]}</button>)}
        </div>
        {data && <span className="small muted">{started ? `ยอดเริ่ม ${thaiShortDate(data.start[loc]!)} · ${loc === 'gosell' ? 'ตัดเมื่อกดจากหน้า GoSell' : `ตัดจากใบ "${loc === 'pia' ? 'พี่เปีย' : 'PK'}" ตั้งแต่ ${thaiShortDate(nextDay(data.start[loc]!))}`}` : 'ยังไม่ได้ตั้งยอดเริ่ม'}</span>}
      </section>

      {loc === 'gosell' && canEdit && <GosellConfirm data={data} onDone={load} />}

      {data && (
        <section className="card table-card">
          <div className="table-card-head">
            <h2>คงเหลือ {LOC_LABEL[loc]} <span className="muted small">{num(total)} ตัว{lowCount ? ` · เหลือ ≤ ${LOW} ตัว ${lowCount} ไซส์` : ''}</span></h2>
            {canEdit && !mode && (
              <div className="row-actions">
                {started && <button className="small primary" onClick={() => setMode('in')}>+ รับของเข้า</button>}
                {started && <button className="small" onClick={() => setMode('adjust')}>ปรับยอด (นับจริง)</button>}
                {!started && canOpen && <button className="small primary" onClick={() => setMode('open')}>ตั้งยอดเริ่ม</button>}
              </div>
            )}
          </div>
          <div className="table-wrap">
            {mode ? (
              <StockForm mode={mode} loc={loc} models={models} sizes={sizes} skuOf={skuOf} balance={balance}
                onCancel={() => setMode(null)} onSaved={() => { setMode(null); load(); }} />
            ) : (
              <table className="stock-grid">
                <thead><tr><th>รุ่น</th>{sizes.map((s) => <th key={s}>#{s}</th>)}<th>รวม</th></tr></thead>
                <tbody>
                  {models.map((m) => {
                    const row = sizes.map((s) => { const sku = skuOf(m, s); return sku && balance.has(sku) ? balance.get(sku)! : null; });
                    return (
                      <tr key={m}>
                        <td><b>{m}</b></td>
                        {row.map((q, i) => {
                          const p = plan?.sku.get(skuOf(m, sizes[i]) ?? '');
                          return (
                            <td key={sizes[i]} className={q === null ? 'muted' : q <= 0 ? 'out' : q <= LOW ? 'low' : ''}>
                              {q === null ? '—' : num(q)}
                              {q !== null && p && <div className={`stock-days ${daysClass(p.days, target)}`}>{daysText(p.days)}</div>}
                            </td>
                          );
                        })}
                        <td><b>{num(row.reduce<number>((a, b) => a + (b ?? 0), 0))}</b></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr><td>รวม</td>{sizes.map((s) => <td key={s}>{num(models.reduce((t, m) => t + (balance.get(skuOf(m, s) ?? '') ?? 0), 0))}</td>)}<td>{num(total)}</td></tr></tfoot>
              </table>
            )}
          </div>
        </section>
      )}

      {data && plan && <ForecastCard plan={plan} items={items} balance={balance} target={target} setTarget={setTarget} />}

      {data && <History data={data} loc={loc} canEdit={canEdit} onDelete={async (ids) => {
        if (!(await confirm({ title: 'ลบรายการนี้?', body: 'ยอดคงเหลือจะคำนวณใหม่โดยไม่มีรายการนี้', confirmLabel: 'ลบ', tone: 'danger' }))) return;
        try { for (const id of ids) await api.deleteStockMove(id); toast('ลบแล้ว', 'ok'); load(); } catch (e: any) { toast(e.message, 'bad'); load(); }
      }} />}
    </div>
  );
}

const nextDay = (d: string) => new Date(Date.parse(d) + 86400_000).toISOString().slice(0, 10);

/** Per model: recent sales, trend and forecast; per size: what runs out before `target` days and how much to add. */
function ForecastCard({ plan, items, balance, target, setTarget }: {
  plan: Plan; items: StockItem[]; balance: Map<string, number>; target: number; setTarget: (n: number) => void;
}) {
  const today = todayBkk();
  const soon = items.filter((i) => plan.sku.has(i.sku)).map((i) => {
    const p = plan.sku.get(i.sku)!, f = plan.models.get(i.code)!.f, stock = balance.get(i.sku) ?? 0;
    return { i, p, stock, add: refill(stock, f, p.share, target) };
  }).filter((x) => x.add > 0 && plan.models.get(x.i.code)!.f.method !== 'none').sort((a, b) => (a.p.days ?? 999) - (b.p.days ?? 999));
  const out = (d: number | null) => (d === null ? '' : thaiShortDate(new Date(Date.parse(today) + Math.floor(d) * 86400_000).toISOString().slice(0, 10)));
  const trend = (f: Forecast) => (f.prev7 === null || !f.prev7 ? null : (f.last7 - f.prev7) / f.prev7);
  return (
    <section className="card table-card">
      <div className="table-card-head">
        <h2>คาดการณ์ตามเทรนด์</h2>
        <label className="small">เติมให้พอ
          <select value={target} onChange={(e) => setTarget(Number(e.target.value))} style={{ marginLeft: 6 }}>
            {[7, 14, 21, 30].map((d) => <option key={d} value={d}>{d} วัน</option>)}
          </select>
        </label>
      </div>
      <p className="small muted po-hint">
        จากยอดขาย {HISTORY_DAYS} วันล่าสุด ({plan.source}) ไม่นับวันนี้ · ข้อมูลตั้งแต่ 7 วัน = เส้นเทรนด์ที่ให้น้ำหนักวันล่าสุดมากกว่า น้อยกว่านั้น = ค่าเฉลี่ย · คิดทั้งรุ่นแล้วแบ่งตามสัดส่วนไซส์ที่ขายได้
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>รุ่น</th><th className="num">ขาย/วัน (7 วัน)</th><th className="num">เทรนด์</th><th className="num">คาดพรุ่งนี้</th><th className="num">คาด {target} วัน</th><th>ข้อมูล</th></tr></thead>
          <tbody>
            {[...plan.models].filter(([code]) => items.some((i) => i.code === code && plan.sku.has(i.sku))).map(([code, { f }]) => {
              const t = trend(f);
              let next = 0;
              for (let d = 1; d <= target; d++) next += f.at(d);
              return (
                <tr key={code}>
                  <td><b>{code}</b></td>
                  <td className="num">{f.method === 'none' ? '—' : num(f.last7, 1)}</td>
                  <td className={`num ${t === null ? 'muted' : t > 0.05 ? 'good' : t < -0.05 ? 'bad' : ''}`}>{t === null ? '—' : `${t > 0 ? '↑' : t < 0 ? '↓' : ''} ${num(Math.abs(t) * 100, 0)}%`}</td>
                  <td className="num">{f.method === 'none' ? '—' : num(f.at(1), 1)}</td>
                  <td className="num">{f.method === 'none' ? '—' : num(Math.round(next))}</td>
                  <td className="small muted">{f.method === 'none' ? 'ยังไม่มีข้อมูลขาย' : f.mean === 0 ? `ไม่มียอดขาย ${f.days} วัน` : `${f.days} วัน · ${f.method === 'trend' ? 'ตามเทรนด์' : 'ค่าเฉลี่ย (ข้อมูลน้อย)'}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h3 className="po-hint" style={{ marginTop: 14 }}>ไซส์ที่ไม่พอ {target} วัน {soon.length ? <span className="muted small">({soon.length})</span> : null}</h3>
      {soon.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>ไซส์</th><th className="num">คงเหลือ</th><th className="num">คาดขาย/วัน</th><th className="num">พออีก</th><th>หมดราว</th><th className="num">ควรเติม</th></tr></thead>
            <tbody>
              {soon.map(({ i, p, stock, add }) => (
                <tr key={i.sku}>
                  <td><b>{i.code} #{i.size}</b></td>
                  <td className="num">{num(stock)}</td>
                  <td className="num">{num(p.rate, 1)}</td>
                  <td className={`num ${daysClass(p.days, target)}`}>{daysText(p.days)}</td>
                  <td className="small">{p.days !== null && p.days > 0 ? out(p.days) : stock <= 0 ? 'หมดแล้ว' : ''}</td>
                  <td className="num"><b>{num(add)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="small muted po-hint">ทุกไซส์พอขายเกิน {target} วัน</p>}
    </section>
  );
}

/** Grid of inputs: received pieces (in), counted pieces (adjust → difference saved) or the starting balance (open). */
function StockForm({ mode, loc, models, sizes, skuOf, balance, onCancel, onSaved }: {
  mode: Exclude<Mode, null>; loc: StockLoc; models: string[]; sizes: string[]; skuOf: (m: string, s: string) => string | undefined;
  balance: Map<string, number>; onCancel: () => void; onSaved: () => void;
}) {
  const { toast } = useUi();
  const [vals, setVals] = useState<Map<string, string>>(() => new Map(mode === 'adjust' ? [...balance].map(([k, v]) => [k, String(v)]) : []));
  const [date, setDate] = useState(todayBkk());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const changes = [...vals].map(([sku, v]) => {
    if (v.trim() === '') return null;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return null;
    const qty = mode === 'adjust' ? n - (balance.get(sku) ?? 0) : n;
    return qty ? { sku, qty } : null;
  }).filter((x): x is { sku: string; qty: number } => !!x);
  const sum = changes.reduce((t, x) => t + x.qty, 0);
  async function save() {
    if (!changes.length) return;
    setBusy(true);
    try {
      await api.stockMoves(loc, mode, date, note, changes);
      toast(mode === 'in' ? `รับของเข้า ${num(sum)} ตัว` : mode === 'adjust' ? `ปรับยอด ${changes.length} ไซส์ (${sum > 0 ? '+' : ''}${num(sum)})` : `ตั้งยอดเริ่ม ${num(sum)} ตัว`, 'ok');
      onSaved();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  const title = mode === 'in' ? 'รับของเข้า: ใส่จำนวนที่เข้ามา' : mode === 'adjust' ? 'ปรับยอด: ใส่จำนวนที่นับได้จริง (บันทึกเฉพาะส่วนต่าง)' : 'ตั้งยอดเริ่ม: ใส่ยอดคงเหลือตอนนี้';
  return (
    <div className="stock-form">
      <p className="small"><b>{title}</b></p>
      <table className="stock-grid">
        <thead><tr><th>รุ่น</th>{sizes.map((s) => <th key={s}>#{s}</th>)}</tr></thead>
        <tbody>
          {models.map((m) => (
            <tr key={m}>
              <td><b>{m}</b></td>
              {sizes.map((s) => {
                const sku = skuOf(m, s);
                return (
                  <td key={s}>
                    {sku ? <input inputMode="numeric" aria-label={`${m} #${s}`} value={vals.get(sku) ?? ''} placeholder={mode === 'adjust' ? String(balance.get(sku) ?? 0) : ''}
                      onChange={(e) => setVals((x) => new Map(x).set(sku, e.target.value.replace(/[^\d-]/g, '')))} /> : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <label>วันที่<input type="date" value={date} max={todayBkk()} onChange={(e) => setDate(e.target.value)} /></label>
        <label style={{ flex: 1, minWidth: 200 }}>หมายเหตุ<input value={note} maxLength={200} placeholder={mode === 'in' ? 'เช่น ของเข้าจากโรงงาน' : mode === 'adjust' ? 'เช่น นับสต็อกสิ้นเดือน' : ''} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <div className="cat-price-actions">
        <span className="small muted">{changes.length ? `${changes.length} ไซส์ · ${sum > 0 ? '+' : ''}${num(sum)} ตัว` : 'ยังไม่มีการเปลี่ยน'}</span>
        <button className="primary" disabled={busy || !changes.length} onClick={save}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
        <button disabled={busy} onClick={onCancel}>ยกเลิก</button>
      </div>
    </div>
  );
}

/** The orders the GoSell page handed over: what would be cut, then cut on confirm. */
function GosellConfirm({ data, onDone }: { data: StockData | null; onDone: () => void }) {
  const { toast } = useUi();
  const [handoff, setHandoff] = useState<GosellHandoff | null>(() => { try { return JSON.parse(localStorage.getItem(GOSELL_HANDOFF) ?? 'null'); } catch { return null; } });
  const [preview, setPreview] = useState<GosellCut | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!handoff) return;
    api.gosellCut(handoff.file, handoff.lines, true).then(setPreview).catch((e) => toast(e.message, 'bad'));
  }, [handoff]); // eslint-disable-line react-hooks/exhaustive-deps
  const drop = () => { try { localStorage.removeItem(GOSELL_HANDOFF); } catch { /* ignore */ } setHandoff(null); setPreview(null); };
  if (!handoff) return null;
  const name = (sku: string) => { const i = data?.items.find((x) => x.sku === sku); return i ? `${i.code} #${i.size}` : sku; };
  const pieces = preview?.cut.reduce((t, c) => t + c.qty, 0) ?? 0;
  async function cut() {
    if (!handoff) return;
    setBusy(true);
    try {
      const r = await api.gosellCut(handoff.file, handoff.lines, false);
      toast(`ตัดสต็อก GoSell ${num(r.cut.reduce((t, c) => t + c.qty, 0))} ตัว จาก ${num(r.orders)} ออเดอร์`, 'ok');
      drop();
      onDone();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  return (
    <section className="card">
      <h2>ตัดสต็อก GoSell จากไฟล์ {handoff.file}</h2>
      {!preview ? <p className="muted small">กำลังตรวจ…</p> : (
        <>
          <p className="small">
            {preview.cut.length ? <>จะตัด <b>{num(pieces)} ตัว</b> จาก {num(preview.orders)} ออเดอร์: {preview.cut.map((c) => `${name(c.sku)} ${c.qty}`).join(' · ')}</> : 'ไม่มีอะไรต้องตัด'}
            {preview.already > 0 && <span className="muted"> · {num(preview.already)} ออเดอร์ตัดไปแล้ว (ข้าม)</span>}
            {preview.other > 0 && <span className="muted"> · {num(preview.other)} รายการไม่ใช่สินค้าในสต็อก</span>}
          </p>
          <div className="cat-price-actions">
            {preview.cut.length > 0 && <button className="primary" disabled={busy} onClick={cut}>{busy ? 'กำลังตัด…' : `ตัดสต็อก ${num(pieces)} ตัว`}</button>}
            <button disabled={busy} onClick={drop}>{preview.cut.length ? 'ไม่ตัด' : 'ปิด'}</button>
          </div>
        </>
      )}
    </section>
  );
}

/** Changes of the last 45 days, one row per round / file / typed entry. */
function History({ data, loc, canEdit, onDelete }: { data: StockData; loc: StockLoc; canEdit: boolean; onDelete: (ids: number[]) => void }) {
  const name = (sku: string) => { const i = data.items.find((x) => x.sku === sku); return i ? `${i.code} #${i.size}` : sku; };
  const rows = useMemo(() => {
    const m = new Map<string, { key: string; date: string; kind: StockMove['kind']; ref: string; note: string; by: string; moves: StockMove[] }>();
    for (const mv of data.moves.filter((x) => x.loc === loc)) {
      const key = mv.kind === 'out' ? `out|${mv.ref}` : `${mv.kind}|${mv.created_at}`;
      const r = m.get(key) ?? { key, date: mv.date, kind: mv.kind, ref: mv.ref, note: mv.note, by: mv.created_by, moves: [] };
      r.moves.push(mv);
      m.set(key, r);
    }
    return [...m.values()];
  }, [data, loc]);
  const what = (r: (typeof rows)[number]) => r.kind === 'out' && /^\d{4}-\d{2}-\d{2}#\d+$/.test(r.ref) ? `ใบสั่ง ${thaiShortDate(r.ref.slice(0, 10))} ${roundLabel(Number(r.ref.split('#')[1]))}` : r.note || '';
  return (
    <section className="card table-card">
      <div className="table-card-head"><h2>เข้า-ออก 45 วันล่าสุด</h2></div>
      <div className="table-wrap">
        <table className="data-table stock-moves">
          <thead><tr><th>วันที่</th><th>รายการ</th><th className="num">ตัว</th><th>รายละเอียด</th><th>โดย</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const sum = r.moves.reduce((t, x) => t + x.qty, 0);
              return (
                <tr key={r.key}>
                  <td>{thaiShortDate(r.date)}</td>
                  <td><b>{KIND_LABEL[r.kind]}</b>{what(r) && <div className="small muted">{what(r)}</div>}</td>
                  <td className={`num ${sum < 0 ? 'bad' : 'good'}`}><b>{sum > 0 ? '+' : ''}{num(sum)}</b></td>
                  <td className="small">{r.moves.map((x) => `${name(x.sku)} ${x.qty > 0 ? '+' : ''}${x.qty}`).join(' · ')}</td>
                  <td className="small muted">{r.by.split('@')[0]}</td>
                  <td>{canEdit && r.kind !== 'out' && <button className="link small danger" onClick={() => onDelete(r.moves.map((x) => x.id))}>ลบ</button>}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={6} className="muted">ยังไม่มีรายการ</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
