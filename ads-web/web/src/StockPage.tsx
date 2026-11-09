// /catalog/stock — "สต็อก": our own stock of 5 models × sizes 28–36 in two places.
//   พี่เปีย (BB branch): cut by the order sheets — rows in the "พี่เปีย" group of a saved round, each order once.
//   GoSell (fulfillment): cut by the button on the GoSell page after a file (confirmed here).
// Received stock ("รับของเข้า") and count corrections ("ปรับยอด") are typed here. Replaces the "Stock BB" sheet.

import { useEffect, useMemo, useState } from 'react';
import { api, type StockReturnRow, type GosellCut, type Role, type SalesData, type StockData, type StockItem, type StockLoc, type StockMove } from './api.ts';
import { coverDays, forecast, refill, sizeShares, type Forecast } from './forecast.ts';
import { compareSize, rowFromArray, type CatalogRow } from './catalog.ts';
import { isShopLoc, shopTab, SHOP_LABEL, SHOP_LOCS } from './stockLocs.ts';
import { num } from './fmt.ts';
import { missingOrderColumns, orderColumns, readOrderItems, roundLabel, thaiShortDate } from './purchase.ts';
import { byTracking, normTrack, trackHash } from './returns.ts';
import { parseExport } from './gosell.ts';
import { readFirstSheet } from './xlsx.ts';
import { HomeLogo, SiteNav } from './SiteNav.tsx';
import { useUi } from './ui.tsx';

const LOC_LABEL: Record<StockLoc, string> = { pia: 'พี่เปีย (BB)', gosell: 'GoSell', pk: 'PK (โกดัง)', ...SHOP_LABEL };
const LOCS: StockLoc[] = ['pia', 'gosell', 'pk', ...SHOP_LOCS];
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
  const shop = isShopLoc(loc);
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
            <p className="muted small clip">{models.length} รุ่น · ไซส์ {sizes[0] ?? ''}–{sizes[sizes.length - 1] ?? ''} · พี่เปียและ PK ตัดตามใบสั่งของ (ใบ "พี่เปีย" / ใบ "PK") · GoSell ตัดเมื่อกดหลังทำไฟล์ GoSell · ร้าน AR/BB/BBW/BT/GG/CM/CN ใส่ของเข้าเอง แล้วตัดตามใบสั่งของ{links.size ? ` · ${loc === 'pia' ? '601/1–3 ตัดจาก 501/1–3' : ''}` : ''}</p>
          </div>
        </div>
      </header>

      <section className="card units-range">
        <div className="segmented" role="tablist" aria-label="สต็อกที่ไหน">
          {LOCS.map((l) => <button key={l} className={loc === l ? 'on' : ''} onClick={() => { setLoc(l); setMode(null); }}>{LOC_LABEL[l]}</button>)}
        </div>
        {data && shop && <span className="small muted">ไม่ต้องตั้งยอดเริ่ม · ใส่ของด้วย "รับของเข้า" / "ปรับยอด" · ตัดตามใบสั่งของ (แถวของ {shopTab(loc)} ที่มีสต็อกแล้ว) ตั้งแต่วันที่ใส่ของ</span>}
        {data && !shop && <span className="small muted">{started ? `ยอดเริ่ม ${thaiShortDate(data.start[loc]!)} · ${loc === 'gosell' ? 'ตัดเมื่อกดจากหน้า GoSell' : `ตัดจากใบ "${loc === 'pia' ? 'พี่เปีย' : 'PK'}" ตั้งแต่ ${thaiShortDate(nextDay(data.start[loc]!))}`}` : 'ยังไม่ได้ตั้งยอดเริ่ม'}</span>}
      </section>

      {loc === 'gosell' && canEdit && <GosellConfirm data={data} onDone={load} />}

      {data && shop && <ShopStock loc={loc} data={data} canEdit={canEdit} onChanged={load} />}

      {data && !shop && (
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

      {data && !shop && started && canEdit && <ReturnsCard data={data} loc={loc} canDecide={canOpen} onDone={load} />}

      {data && !shop && plan && <ForecastCard plan={plan} items={items} balance={balance} target={target} setTarget={setTarget} />}

      {data && <History data={data} loc={loc} canEdit={canEdit} onDelete={async (ids) => {
        if (!(await confirm({ title: 'ลบรายการนี้?', body: 'ยอดคงเหลือจะคำนวณใหม่โดยไม่มีรายการนี้', confirmLabel: 'ลบ', tone: 'danger' }))) return;
        try { for (const id of ids) await api.deleteStockMove(id); toast('ลบแล้ว', 'ok'); load(); } catch (e: any) { toast(e.message, 'bad'); load(); }
      }} />}
    </div>
  );
}

/** A shop's (AR / BB / …) stock: a list of the SKUs that have entries, typed in with received / counted. */
function ShopStock({ loc, data, canEdit, onChanged }: { loc: StockLoc; data: StockData; canEdit: boolean; onChanged: () => void }) {
  const [mode, setMode] = useState<'in' | 'adjust' | null>(null);
  const [q, setQ] = useState('');
  const balance = useMemo(() => new Map(data.balances.filter((b) => b.loc === loc).map((b) => [b.sku, b.qty])), [data, loc]);
  const rows = useMemo(() => data.shops.filter((r) => r.loc === loc), [data, loc]);
  const shown = rows.filter((r) => !q.trim() || `${r.sku} ${r.code ?? ''} ${r.name ?? ''} ${r.color ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const total = rows.reduce((t, r) => t + (balance.get(r.sku) ?? 0), 0);
  useEffect(() => { setMode(null); setQ(''); }, [loc]);
  return (
    <section className="card table-card">
      <div className="table-card-head">
        <h2>คงเหลือ {LOC_LABEL[loc]} <span className="muted small">{num(rows.length)} SKU · {num(total)} ตัว</span></h2>
        {canEdit && !mode && (
          <div className="row-actions">
            <button className="small primary" onClick={() => setMode('in')}>+ รับของเข้า</button>
            <button className="small" onClick={() => setMode('adjust')}>ปรับยอด (นับจริง)</button>
          </div>
        )}
      </div>
      <p className="small muted po-hint">ที่มา: ของที่พิมพ์ใส่ที่นี่ − ชิ้นในใบสั่งของที่บันทึกแล้ว (แถวของแท็บ {shopTab(loc as any)} ในแคตตาล็อก{loc === 'bb' ? ' ทุกร้าน BB รวมเป็นยอดเดียว' : ''}) ไม่นับแถวที่ย้ายไปพี่เปีย / GoSell / เก็บตกแทน และชิ้นที่ติ๊ก "ของไม่มี"</p>
      {mode ? (
        <ShopForm mode={mode} loc={loc} rows={rows} balance={balance} onCancel={() => setMode(null)} onSaved={() => { setMode(null); onChanged(); }} />
      ) : (
        <>
          {rows.length > 6 && <div className="cat-price-actions"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา SKU / รหัส / สี" /></div>}
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>SKU</th><th>สินค้า</th><th>ไซส์</th><th className="num">คงเหลือ</th></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const n = balance.get(r.sku) ?? 0;
                  return (
                    <tr key={r.sku}>
                      <td><code>{r.sku}</code></td>
                      <td>{[r.code, r.color].filter(Boolean).join(' · ') || r.name || '—'}</td>
                      <td>{r.size || '—'}</td>
                      <td className={`num ${n <= 0 ? 'bad' : n <= LOW ? 'warn' : ''}`}><b>{num(n)}</b></td>
                    </tr>
                  );
                })}
                {!shown.length && <tr><td colSpan={4} className="muted">{rows.length ? 'ไม่พบ' : 'ยังไม่มีสต็อก · กด "+ รับของเข้า" แล้วค้นหา SKU จากแคตตาล็อก'}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/** Pick SKUs of the shop's catalog tab and type received pieces (in) or counted pieces (adjust → the difference is saved). */
function ShopForm({ mode, loc, rows, balance, onCancel, onSaved }: {
  mode: 'in' | 'adjust'; loc: StockLoc; rows: StockData['shops']; balance: Map<string, number>; onCancel: () => void; onSaved: () => void;
}) {
  const { toast } = useUi();
  const [catalog, setCatalog] = useState<CatalogRow[] | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>(() => (mode === 'adjust' ? rows.map((r) => r.sku) : []));
  const [vals, setVals] = useState<Map<string, string>>(() => new Map(mode === 'adjust' ? [...balance].map(([k, v]) => [k, String(v)]) : []));
  const [date, setDate] = useState(todayBkk());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const m = await api.catalog();
        const out: CatalogRow[] = [];
        for (let after = ''; ;) {
          const page = await api.catalogRows(shopTab(loc as any), after, m.version);
          for (const a of page.rows) out.push(rowFromArray(a));
          if (!page.next) break;
          after = page.next;
        }
        if (live) setCatalog(out);
      } catch (e: any) { toast(e.message, 'bad'); }
    })();
    return () => { live = false; };
  }, [loc]); // eslint-disable-line react-hooks/exhaustive-deps
  const bySku = useMemo(() => new Map((catalog ?? []).map((r) => [r.sku, r])), [catalog]);
  const found = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t || !catalog) return [];
    const words = t.split(/\s+/);
    return catalog.filter((r) => !picked.includes(r.sku) && words.every((w) => `${r.sku} ${r.code} ${r.name} ${r.color} ${r.size}`.toLowerCase().includes(w))).slice(0, 12);
  }, [q, catalog, picked]);
  const label = (sku: string) => { const r = bySku.get(sku), s = rows.find((x) => x.sku === sku); const c = r ?? s; return c ? [c.code, c.color, c.size && `#${c.size}`].filter(Boolean).join(' ') || sku : sku; };
  const changes = picked.map((sku) => {
    const v = (vals.get(sku) ?? '').trim();
    if (v === '') return null;
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
      toast(mode === 'in' ? `รับของเข้า ${num(sum)} ตัว` : `ปรับยอด ${changes.length} SKU (${sum > 0 ? '+' : ''}${num(sum)})`, 'ok');
      onSaved();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  return (
    <div className="stock-form">
      <p className="small"><b>{mode === 'in' ? 'รับของเข้า: ค้นหา SKU แล้วใส่จำนวนที่เข้ามา' : 'ปรับยอด: ใส่จำนวนที่นับได้จริง (บันทึกเฉพาะส่วนต่าง) · เพิ่ม SKU ใหม่ได้ด้วยการค้นหา'}</b></p>
      <div className="cat-price-actions">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={catalog ? `ค้นหา SKU / รหัส / สี ในแท็บ ${shopTab(loc as any)}` : 'กำลังโหลดแคตตาล็อก…'} disabled={!catalog} autoFocus />
      </div>
      {found.length > 0 && (
        <ul className="small">
          {found.map((r) => (
            <li key={r.sku}><button className="small" onClick={() => { setPicked((p) => [...p, r.sku]); setQ(''); }}>+ เพิ่ม</button> <code>{r.sku}</code> · {r.code} {r.color} #{r.size}</li>
          ))}
        </ul>
      )}
      {picked.length > 0 && (
        <table className="data-table">
          <thead><tr><th>SKU</th><th>สินค้า</th>{mode === 'adjust' && <th className="num">ในระบบ</th>}<th className="num">{mode === 'in' ? 'เข้า' : 'นับได้'}</th><th /></tr></thead>
          <tbody>
            {picked.map((sku) => (
              <tr key={sku}>
                <td><code>{sku}</code></td>
                <td>{label(sku)}</td>
                {mode === 'adjust' && <td className="num muted">{num(balance.get(sku) ?? 0)}</td>}
                <td className="num"><input inputMode="numeric" aria-label={sku} style={{ width: 80 }} value={vals.get(sku) ?? ''}
                  onChange={(e) => setVals((x) => new Map(x).set(sku, e.target.value.replace(/[^\d-]/g, '')))} /></td>
                <td><button className="link small" onClick={() => setPicked((p) => p.filter((x) => x !== sku))}>เอาออก</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        <label>วันที่<input type="date" value={date} max={todayBkk()} onChange={(e) => setDate(e.target.value)} /></label>
        <label style={{ flex: 1, minWidth: 200 }}>หมายเหตุ<input value={note} maxLength={200} placeholder={mode === 'in' ? 'เช่น รับของจากร้าน' : 'เช่น นับสต็อกสิ้นเดือน'} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <div className="cat-price-actions">
        <span className="small muted">{changes.length ? `${changes.length} SKU · ${sum > 0 ? '+' : ''}${num(sum)} ตัว` : 'ยังไม่มีการเปลี่ยน'}</span>
        <button className="primary" disabled={busy || !changes.length} onClick={save}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
        <button disabled={busy} onClick={onCancel}>ยกเลิก</button>
      </div>
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
        <label style={{ flex: 1, minWidth: 200 }}>หมายเหตุ<input value={note} maxLength={200} placeholder={mode === 'in' ? (loc === 'pia' ? 'เช่น ของเข้าจากโรงงาน (ตัดสต็อก PK ให้เอง)' : 'เช่น ของเข้าจากโรงงาน') : mode === 'adjust' ? 'เช่น นับสต็อกสิ้นเดือน' : ''} onChange={(e) => setNote(e.target.value)} /></label>
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

/**
 * Returned parcels (idea #20): load the Bigseller order file (it has the parcel numbers; read here, never sent), scan the
 * number on each parcel, and the pieces go to "รออนุมัติ". Only an owner/admin's approval puts them into the stock.
 */
function ReturnsCard({ data, loc, canDecide, onDone }: { data: StockData; loc: StockLoc; canDecide: boolean; onDone: () => void }) {
  const { toast } = useUi();
  const [file, setFile] = useState('');
  const [index, setIndex] = useState<Map<string, { sku: string; qty: number }[]>>(new Map());
  const [code, setCode] = useState('');
  const [scanned, setScanned] = useState<{ track: string; items: { sku: string; qty: number }[] | null }[]>([]);
  const [rows, setRows] = useState<StockReturnRow[]>([]);
  const [busy, setBusy] = useState(false);
  const loadRows = () => api.stockReturns().then((r) => setRows(r.returns)).catch(() => {});
  useEffect(() => { loadRows(); }, []);
  const name = (sku: string) => { const i = data.items.find((x) => x.sku === sku); return i ? `${i.code} #${i.size}` : sku; };
  const mine = (sku: string) => data.items.some((x) => x.sku === sku && x.locs.includes(loc));

  async function onFile(f: File) {
    try {
      let headers: string[], raw: Record<string, string>[];
      if (/\.xlsx$/i.test(f.name)) ({ headers, rows: raw } = await readFirstSheet(f));
      else ({ headers, rows: raw } = parseExport(new Uint8Array(await f.arrayBuffer())));
      const missing = missingOrderColumns(headers);
      if (missing) throw new Error(`ไฟล์ไม่มีคอลัมน์ ${missing.join(', ')}`);
      if (!orderColumns(headers).tracking) throw new Error('ไฟล์นี้ไม่มีคอลัมน์เลขพัสดุ (หมายเลขแทรคกิ้ง) · ใช้ไฟล์ Order-SKU จาก Bigseller');
      const m = byTracking(readOrderItems(raw, headers));
      setIndex(m); setFile(f.name);
      toast(`อ่านเลขพัสดุได้ ${num(m.size)} พัสดุ`, 'ok');
    } catch (e: any) { toast(e.message, 'bad'); }
  }
  function scan() {
    const t = normTrack(code);
    setCode('');
    if (!t || scanned.some((s) => normTrack(s.track) === t)) return;
    setScanned((s) => [{ track: code.trim(), items: index.get(t) ?? null }, ...s]);
  }
  const ready = scanned.filter((s) => s.items?.length);
  async function send() {
    setBusy(true);
    try {
      const parcels = await Promise.all(ready.map(async (s) => ({ hash: await trackHash(s.track), tail: normTrack(s.track).slice(-4), items: s.items! })));
      const r = await api.addStockReturns(loc, parcels);
      toast(`ส่งรออนุมัติ ${num(r.added)} รายการ${r.repeated.length ? ` · ซ้ำ ${r.repeated.length} พัสดุ (ข้าม)` : ''}`, 'ok');
      setScanned([]); loadRows(); onDone();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  async function decide(id: number, approve: boolean) {
    try { await api.decideStockReturn(id, approve); toast(approve ? 'เข้าสต็อกแล้ว' : 'ไม่อนุมัติ', 'ok'); loadRows(); onDone(); } catch (e: any) { toast(e.message, 'bad'); loadRows(); }
  }
  const pending = rows.filter((r) => r.status === 'pending' && r.loc === loc);
  const done = rows.filter((r) => r.status !== 'pending' && r.loc === loc).slice(0, 10);
  return (
    <section className="card">
      <h2>พัสดุตีกลับ <span className="muted small">ยิงเลขหน้าซอง → รออนุมัติ → เข้าสต็อก {LOC_LABEL[loc]}</span></h2>
      <p className="muted small">ที่มา: เลขพัสดุ → SKU จากไฟล์ Order-SKU ของ Bigseller ที่เลือกด้านล่าง (อ่านในเครื่องนี้ ไม่ส่งขึ้นเว็บ) · เก็บแค่ SKU จำนวน และท้ายเลขพัสดุ 4 ตัว</p>
      <div className="cat-price-actions">
        <input type="file" accept=".xlsx,.csv,.tsv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
        {file && <span className="small muted">{file} · {num(index.size)} พัสดุ</span>}
      </div>
      {file && (
        <form className="cat-price-actions" onSubmit={(e) => { e.preventDefault(); scan(); }}>
          <input autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="ยิงเลขพัสดุที่นี่ แล้วกด Enter" />
          <button type="submit">เพิ่ม</button>
        </form>
      )}
      {scanned.length > 0 && (
        <>
          <ul className="small">
            {scanned.map((s) => (
              <li key={s.track}>
                {s.track} → {s.items ? s.items.map((i) => `${name(i.sku)} ×${i.qty}${mine(i.sku) ? '' : ' (ไม่อยู่ในสต็อกนี้)'}`).join(', ') : <b>ไม่พบเลขนี้ในไฟล์</b>}
                {' '}<button className="small" onClick={() => setScanned((x) => x.filter((y) => y !== s))}>เอาออก</button>
              </li>
            ))}
          </ul>
          <div className="cat-price-actions">
            <button className="primary" disabled={busy || !ready.length} onClick={send}>{busy ? 'กำลังส่ง…' : `ส่งรออนุมัติ ${ready.length} พัสดุ`}</button>
            <button disabled={busy} onClick={() => setScanned([])}>ล้าง</button>
          </div>
        </>
      )}
      {pending.length > 0 && (
        <>
          <h3>รออนุมัติ {pending.length} รายการ</h3>
          <ul className="small">
            {pending.map((r) => (
              <li key={r.id}>
                {name(r.sku)} ×{r.qty} · พัสดุ …{r.track_tail} · สแกนโดย {r.created_by.split('@')[0]}
                {canDecide ? <> <button className="small primary" onClick={() => decide(r.id, true)}>อนุมัติ</button> <button className="small" onClick={() => decide(r.id, false)}>ไม่อนุมัติ</button></> : <span className="muted"> · รอเจ้าของ/ผู้ดูแลกด</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {done.length > 0 && <p className="small muted">ล่าสุด: {done.map((r) => `${name(r.sku)} ×${r.qty} ${r.status === 'approved' ? '✓' : '✗'}`).join(' · ')}</p>}
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
