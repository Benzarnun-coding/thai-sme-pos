// /catalog/profit — "กำไร": what each channel and each product really made in a range. Facebook from Page365 (prices,
// the shop's per-order fees) less Meta ad spend; TikTok / Shopee / Lazada from the platforms' own money files, uploaded
// here (read in the browser, columns guessed and picked once, remembered for the team). Cost = the catalog's ทุน.
// Display only: nothing here changes the ads rules or the monthly goal (which uses Page365's own cost).

import { useEffect, useMemo, useState } from 'react';
import { api, type ImportMap, type ProfitData } from './api.ts';
import { webToRow, type CatalogRow } from './catalog.ts';
import { num } from './fmt.ts';
import { exportGrid } from './gosell.ts';
import {
  defaultExcluded, EMPTY_MAP, guessMap, headerSignature, parseMoney, PLATFORMS, tableFromGrid,
  type MoneyMap, type Platform,
} from './money.ts';
import { profit, type ChannelProfit } from './profit.ts';
import { makeLookup, thaiShortDate } from './purchase.ts';
import { HomeLogo, SiteNav } from './SiteNav.tsx';
import { Icon, useUi } from './ui.tsx';
import { useCatalog } from './useCatalog.ts';
import { readFirstSheetGrid } from './xlsx.ts';

const PRESETS = [7, 14, 30];
const todayBkk = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const minus = (iso: string, d: number) => new Date(Date.parse(iso) - d * 86400_000).toISOString().slice(0, 10);
const baht = (n: number) => `฿${num(Math.round(n))}`;
const pct = (part: number, whole: number) => (whole ? `${num((part / whole) * 100, 1)}%` : '—');

interface Loaded { file: string; headers: string[]; rows: Record<string, string>[]; signature: string; headerRow: number }

export function ProfitApp() {
  useEffect(() => { document.title = 'กำไร'; }, []);
  const { toast } = useUi();
  const { meta, rows, loading, canEdit, supplierMap, priceMap, sellMap, labelMap, aliasMap, aliasForce } = useCatalog();
  const [preset, setPreset] = useState<number | null>(7);
  const [to, setTo] = useState(minus(todayBkk(), 1));
  const [from, setFrom] = useState(minus(todayBkk(), 7));
  const [data, setData] = useState<ProfitData | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [sort, setSort] = useState<'profit' | 'pieces' | 'margin'>('profit');

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    api.profit(from, to).then((d) => { if (!cancelled) setData(d); }).catch((e) => toast(e.message, 'bad')).finally(() => !cancelled && setBusy(false));
    return () => { cancelled = true; };
  }, [from, to, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (days: number) => { setPreset(days); setTo(minus(todayBkk(), 1)); setFrom(minus(todayBkk(), days)); };
  const allRows = useMemo<CatalogRow[]>(() => [...rows, ...(meta?.web ?? []).map((w) => webToRow(w, 0))], [rows, meta?.web]);
  const lookup = useMemo(() => makeLookup(allRows, supplierMap, priceMap, labelMap, aliasMap, aliasForce), [allRows, supplierMap, priceMap, labelMap, aliasMap, aliasForce]);
  const result = useMemo(() => (data && !loading ? profit(data, lookup, sellMap) : null), [data, lookup, sellMap, loading]);
  const products = useMemo(() => {
    const list = [...(result?.products ?? [])];
    if (sort === 'pieces') list.sort((a, b) => b.pieces - a.pieces);
    if (sort === 'margin') list.sort((a, b) => (a.revenue ? a.profit / a.revenue : 0) - (b.revenue ? b.profit / b.revenue : 0));
    return list;
  }, [result, sort]);
  const days = data ? Math.round((Date.parse(data.to) - Date.parse(data.from)) / 86400_000) + 1 : 0;
  const t = result?.total;

  return (
    <div className="app profit">
      <SiteNav current="/catalog/profit" />
      <header className="top">
        <div className="brand">
          <HomeLogo text="฿" />
          <div>
            <h1>กำไร</h1>
            <p className="muted small clip">ต่อช่องทางและต่อสินค้า · Facebook จาก Page365 · TikTok/Shopee จากไฟล์ยอดเงินของแต่ละแพลตฟอร์ม · ทุนจากแคตตาล็อก</p>
          </div>
        </div>
      </header>

      <section className="card units-range">
        <div className="segmented" role="tablist" aria-label="ช่วงวัน">
          {PRESETS.map((d) => <button key={d} className={preset === d ? 'on' : ''} onClick={() => pick(d)}>{d} วันล่าสุด</button>)}
        </div>
        <label>ตั้งแต่<input type="date" value={from} max={to} onChange={(e) => { setPreset(null); setFrom(e.target.value); }} /></label>
        <label>ถึง<input type="date" value={to} min={from} max={todayBkk()} onChange={(e) => { setPreset(null); setTo(e.target.value); }} /></label>
        {(busy || loading) && <span className="muted small">กำลังโหลด…</span>}
      </section>

      {canEdit && <MoneyUpload onSaved={() => setReload((n) => n + 1)} files={data?.mpFiles ?? []} />}

      {t && data && (
        <div className="kpis units-kpis">
          <div className="kpi"><span>ยอดขาย</span><b>{baht(t.revenue)}</b><small>{num(t.orders)} ออเดอร์ · {num(t.pieces)} ตัว · {days} วัน</small></div>
          <div className="kpi"><span>ทุนสินค้า</span><b>{baht(t.cost)}</b><small>{pct(t.cost, t.revenue)} ของยอดขาย{t.unpriced ? ` · ไม่มีทุน ${num(t.unpriced)} ตัว` : ''}</small></div>
          <div className="kpi"><span>ค่าธรรมเนียม + แอด</span><b>{baht(t.fees + t.ads)}</b><small>ค่าธรรมเนียม {baht(t.fees)} · แอด FB {data.spend ? `${baht(t.ads)} (${data.page365Days.length} วันที่มีไฟล์ Page365)` : 'ดึงไม่ได้'}</small></div>
          <div className="kpi"><span>กำไร</span><b className={t.profit >= 0 ? 'good' : 'bad'}>{baht(t.profit)}</b><small>{pct(t.profit, t.revenue)} ของยอดขาย · ยังไม่หักค่าใช้จ่ายคงที่</small></div>
        </div>
      )}

      {result && data && (
        <section className="card table-card">
          <div className="table-card-head">
            <h2>ต่อช่องทาง</h2>
            <p className="muted small">กำไร = ยอดขาย − ค่าธรรมเนียม − ทุนสินค้า − ค่าแอด (แอดมีเฉพาะ Facebook จาก Meta)</p>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>ช่องทาง</th><th className="num">ออเดอร์</th><th className="num">ตัว</th><th className="num">ยอดขาย</th><th className="num">ค่าธรรมเนียม</th><th className="num">ทุน</th><th className="num">แอด</th><th className="num">กำไร</th><th className="num">%</th><th>หมายเหตุ</th></tr></thead>
              <tbody>
                {result.channels.map((c) => <ChannelRow key={c.channel} c={c} data={data} />)}
                {!result.channels.length && <tr><td colSpan={10} className="muted">ยังไม่มีข้อมูลในช่วงนี้</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {result && result.products.length > 0 && (
        <section className="card table-card">
          <div className="table-card-head">
            <h2>ต่อสินค้า</h2>
            <div className="segmented" role="tablist" aria-label="เรียง">
              <button className={sort === 'profit' ? 'on' : ''} onClick={() => setSort('profit')}>กำไรมากสุด</button>
              <button className={sort === 'pieces' ? 'on' : ''} onClick={() => setSort('pieces')}>ขายมากสุด</button>
              <button className={sort === 'margin' ? 'on' : ''} onClick={() => setSort('margin')}>% กำไรต่ำสุด</button>
            </div>
          </div>
          <p className="small muted po-hint">กำไรก่อนค่าแอด · ยอดขายและค่าธรรมเนียมของแต่ละออเดอร์แบ่งให้สินค้าในออเดอร์ตามมูลค่า</p>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>สินค้า</th><th className="num">ตัว</th><th className="num">ยอดขาย</th><th className="num">ค่าธรรมเนียม</th><th className="num">ทุน</th><th className="num">กำไร</th><th className="num">%</th><th>ช่องทาง</th></tr></thead>
              <tbody>
                {products.slice(0, 200).map((p) => (
                  <tr key={p.key} className={p.known ? '' : 'dim'}>
                    <td><b>{p.label}</b>{p.spu ? <div className="muted small">{p.tab} · {p.spu}</div> : <div className="muted small">ไม่มีในแคตตาล็อก</div>}</td>
                    <td className="num">{num(p.pieces)}</td>
                    <td className="num">{num(Math.round(p.revenue))}</td>
                    <td className="num">{num(Math.round(p.fees))}</td>
                    <td className="num">{num(Math.round(p.cost))}{p.unpriced ? <div className="small bad">ไม่มีทุน {num(p.unpriced)} ตัว</div> : null}</td>
                    <td className={`num ${p.profit < 0 ? 'bad' : ''}`}><b>{num(Math.round(p.profit))}</b></td>
                    <td className="num">{pct(p.profit, p.revenue)}</td>
                    <td className="small">{Object.entries(p.channels).map(([c, n]) => `${c} ${num(n ?? 0)}`).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {products.length > 200 && <p className="small muted po-hint" style={{ paddingTop: 8 }}>แสดง 200 จาก {num(products.length)} สินค้า</p>}
        </section>
      )}

      <section className="card small muted profit-notes">
        <p><b>ที่มาของตัวเลข</b></p>
        <ul>
          <li>Facebook: ออเดอร์จากไฟล์ Page365 ที่อัปโหลดทุกเช้า · ค่าธรรมเนียมตามที่ตกลงไว้ (COD 1%, เสีย 1%, ค่าส่ง 15, VAT 7%, ถุง 1) · แอด = ค่าแอดทั้งบัญชีจาก Meta</li>
          <li>TikTok / Shopee / Lazada: จากไฟล์ยอดเงินที่อัปโหลดด้านบน · ถ้าไฟล์เป็นยอดที่ได้รับจริง ค่าธรรมเนียมถูกหักไว้แล้ว · สินค้าในออเดอร์จากไฟล์ หรือจากรอบใบสั่งในหน้าสั่งของ</li>
          <li>ทุน = ทุนในแคตตาล็อก (คอลัมน์ H หรือที่แก้ในเว็บ) ไม่ใช่ทุนใน Page365 ที่เป้ากำไรรายเดือนใช้ · หน้านี้ไม่เปลี่ยนตัวเลขของระบบแอด</li>
        </ul>
      </section>
    </div>
  );
}

function ChannelRow({ c, data }: { c: ChannelProfit; data: ProfitData }) {
  const notes: string[] = [];
  if (c.channel === 'Facebook') {
    const days = Math.round((Date.parse(data.to) - Date.parse(data.from)) / 86400_000) + 1;
    if (data.page365Days.length < days) notes.push(`ไฟล์ Page365 ${data.page365Days.length}/${days} วัน · แอดนับเฉพาะวันที่มีไฟล์`);
    if (!data.spend) notes.push(`ดึงค่าแอดไม่ได้${data.spendError ? `: ${data.spendError}` : ''}`);
  }
  if (c.noMoney) notes.push(`ยังไม่มียอดเงิน ${num(c.noMoney)} ออเดอร์ (อัปโหลดไฟล์ยอดเงิน)`);
  if (c.netFiles) notes.push('บางไฟล์เป็นยอดหลังหักค่าธรรมเนียมแล้ว');
  if (c.feesMissing) notes.push('บางไฟล์ไม่มีคอลัมน์ค่าธรรมเนียม');
  if (c.unpriced) notes.push(`ไม่มีทุน ${num(c.unpriced)} ตัว`);
  return (
    <tr>
      <td><b>{c.channel}</b></td>
      <td className="num">{num(c.orders)}</td>
      <td className="num">{num(c.pieces)}</td>
      <td className="num">{c.orders ? num(Math.round(c.revenue)) : '—'}</td>
      <td className="num">{c.orders ? num(Math.round(c.fees)) : '—'}</td>
      <td className="num">{c.orders ? num(Math.round(c.cost)) : '—'}</td>
      <td className="num">{c.ads ? num(Math.round(c.ads)) : '—'}</td>
      <td className={`num ${c.profit < 0 ? 'bad' : 'good'}`}>{c.orders || c.ads ? <b>{num(Math.round(c.profit))}</b> : '—'}</td>
      <td className="num">{pct(c.profit, c.revenue)}</td>
      <td className="small">{notes.join(' · ') || <span className="muted">—</span>}</td>
    </tr>
  );
}

// ---- marketplace money upload ----

const FIELDS: { key: keyof Omit<MoneyMap, 'fees' | 'kind'>; label: string; need?: boolean }[] = [
  { key: 'order', label: 'เลขคำสั่งซื้อ', need: true },
  { key: 'amount', label: 'ยอดเงิน', need: true },
  { key: 'date', label: 'วันที่สั่งซื้อ' },
  { key: 'status', label: 'สถานะ' },
  { key: 'sku', label: 'SKU' },
  { key: 'qty', label: 'จำนวน' },
  { key: 'itemAmount', label: 'ยอดต่อรายการ' },
];

function MoneyUpload({ files, onSaved }: { files: ProfitData['mpFiles']; onSaved: () => void }) {
  const { toast } = useUi();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [map, setMap] = useState<MoneyMap>(EMPTY_MAP);
  const [platform, setPlatform] = useState<Platform | 'auto'>('auto');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [maps, setMaps] = useState<ImportMap[] | null>(null);
  const [savedMap, setSavedMap] = useState('');
  const [busy, setBusy] = useState('');

  async function onFile(file: File) {
    setBusy('กำลังอ่านไฟล์…');
    try {
      let grid: string[][];
      if (/\.xlsx$/i.test(file.name)) grid = await readFirstSheetGrid(file);
      else if (/\.(csv|tsv|txt)$/i.test(file.name)) grid = exportGrid(new Uint8Array(await file.arrayBuffer()));
      else throw new Error('เลือกไฟล์ .xlsx หรือ .csv ที่ export จาก TikTok Shop, Shopee หรือ Lazada');
      const { headers, rows, headerRow } = tableFromGrid(grid);
      if (!rows.length) throw new Error('ไม่พบแถวข้อมูลในไฟล์');
      const signature = headerSignature(headers);
      const known = (maps ?? (await api.importMaps().then((r) => { setMaps(r.maps); return r.maps; }).catch(() => []))).find((m) => m.signature === signature);
      const m = known ? { ...EMPTY_MAP, ...known.map } : guessMap(headers);
      setMap(m);
      setSavedMap(known ? JSON.stringify(m) : '');
      setPlatform(known?.platform ?? 'auto');
      setExcluded(defaultExcluded(rows, m.status));
      setLoaded({ file: file.name, headers, rows, signature, headerRow });
      if (known) toast('ใช้คอลัมน์ที่เลือกไว้ครั้งก่อนสำหรับไฟล์แบบนี้', 'info');
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }

  const parsed = useMemo(() => (loaded && map.order && map.amount ? parseMoney(loaded.rows, map, platform, excluded) : null), [loaded, map, platform, excluded]);
  const setField = (k: keyof MoneyMap, v: string) => {
    const next = { ...map, [k]: v };
    setMap(next);
    if (k === 'status' && loaded) setExcluded(defaultExcluded(loaded.rows, v));
  };

  async function save() {
    if (!loaded || !parsed?.orders.length) return;
    setBusy('กำลังบันทึก…');
    try {
      if (JSON.stringify(map) !== savedMap) await api.saveImportMap(loaded.signature, map, platform);
      let saved = 0;
      for (let i = 0; i < parsed.orders.length; i += 2000) saved += (await api.saveMpOrders(loaded.file, parsed.orders.slice(i, i + 2000))).saved;
      toast(`บันทึกยอดเงิน ${num(saved)} ออเดอร์แล้ว`, 'ok');
      setLoaded(null);
      onSaved();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }

  const amountTotal = parsed?.orders.reduce((t, o) => t + o.amount, 0) ?? 0;
  const feeTotal = parsed?.orders.reduce((t, o) => t + (o.fees ?? 0), 0) ?? 0;
  const dates = parsed?.orders.map((o) => o.date).filter((d): d is string => !!d).sort() ?? [];
  const byPlatform = PLATFORMS.map((p) => ({ p, n: parsed?.orders.filter((o) => o.platform === p).length ?? 0 })).filter((x) => x.n);

  return (
    <section className="card">
      <div className="table-card-head" style={{ padding: 0 }}>
        <div>
          <h2>ยอดเงิน TikTok / Shopee / Lazada</h2>
          <p className="muted small">ไฟล์คำสั่งซื้อหรือรายรับที่ export จาก Seller Center (.xlsx หรือ .csv) · อ่านในเบราว์เซอร์ ส่งเฉพาะเลขคำสั่งซื้อ วันที่ สถานะ ยอดเงิน ค่าธรรมเนียม และ SKU (ไม่ส่งชื่อ เบอร์ ที่อยู่ลูกค้า) · อัปโหลดซ้ำได้ ออเดอร์เดิมจะถูกแทนที่</p>
        </div>
        <label className={`button ${busy ? 'disabled' : 'primary'}`}>
          <Icon name="up" size={14} /> {busy || 'เลือกไฟล์ยอดเงิน'}
          <input type="file" accept=".xlsx,.csv,.tsv,.txt" hidden disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
        </label>
      </div>
      {!loaded && files.length > 0 && (
        <p className="small muted" style={{ marginTop: 8 }}>ล่าสุด: {files.slice(0, 3).map((f) => `${f.file || '(ไม่มีชื่อ)'} ${num(f.orders)} ออเดอร์ (${f.updated_by.split('@')[0]} ${thaiShortDate(f.updated_at.slice(0, 10))})`).join(' · ')}</p>
      )}
      {loaded && (
        <div className="money-map">
          <p className="small"><b>{loaded.file}</b> · {num(loaded.rows.length)} แถว{loaded.headerRow ? ` · หัวตารางอยู่แถว ${loaded.headerRow + 1}` : ''} · ตรวจว่าคอลัมน์ถูก แล้วกดบันทึก (ระบบจำไว้สำหรับไฟล์แบบนี้)</p>
          <div className="money-fields">
            {FIELDS.map((f) => (
              <label key={f.key}>{f.label}{f.need && ' *'}
                <select value={map[f.key]} onChange={(e) => setField(f.key, e.target.value)}>
                  <option value="">{f.need ? '— เลือก —' : '— ไม่มี —'}</option>
                  {loaded.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
            <label>ยอดเงินคือ
              <select value={map.kind} onChange={(e) => setMap({ ...map, kind: e.target.value as MoneyMap['kind'] })}>
                <option value="gross">ยอดที่ลูกค้าจ่าย (ค่าธรรมเนียมแยก)</option>
                <option value="net">ยอดที่ได้รับจริง (หักค่าธรรมเนียมแล้ว)</option>
              </select>
            </label>
            <label>ช่องทาง
              <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform | 'auto')}>
                <option value="auto">ดูจากเลขคำสั่งซื้อ</option>
                {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          </div>
          {map.kind === 'gross' && (
            <details className="money-fees" open={map.fees.length > 0}>
              <summary className="small">คอลัมน์ค่าธรรมเนียม ({map.fees.length ? map.fees.join(', ') : 'ไม่มี'})</summary>
              <div className="money-checks">
                {loaded.headers.map((h) => (
                  <label key={h} className="small"><input type="checkbox" checked={map.fees.includes(h)} onChange={(e) => setMap({ ...map, fees: e.target.checked ? [...map.fees, h] : map.fees.filter((x) => x !== h) })} /> {h}</label>
                ))}
              </div>
            </details>
          )}
          {parsed && parsed.statuses.length > 1 && (
            <div className="money-checks">
              <span className="small muted">นับสถานะ:</span>
              {parsed.statuses.map((s) => (
                <label key={s.status} className="small">
                  <input type="checkbox" checked={!s.excluded} onChange={(e) => { const n = new Set(excluded); if (e.target.checked) n.delete(s.status); else n.add(s.status); setExcluded(n); }} />
                  {' '}{s.status || '(ว่าง)'} <span className="muted">{num(s.orders)}</span>
                </label>
              ))}
            </div>
          )}
          {parsed ? (
            <div className="money-preview">
              <span><b>{num(parsed.orders.length)}</b> ออเดอร์</span>
              <span>ยอดเงิน <b>{baht(amountTotal)}</b></span>
              {map.kind === 'gross' && <span>ค่าธรรมเนียม <b>{map.fees.length ? baht(feeTotal) : 'ไม่มีในไฟล์'}</b></span>}
              <span>{dates.length ? `${thaiShortDate(dates[0])} – ${thaiShortDate(dates[dates.length - 1])}` : 'ไม่มีวันที่ · ใช้วันที่ออเดอร์เข้าใบสั่ง'}</span>
              <span>{byPlatform.map((x) => `${x.p} ${num(x.n)}`).join(' · ')}</span>
              {parsed.skipped > 0 && <span className="muted">ข้าม {num(parsed.skipped)} แถว (ไม่มีเลขหรือยอด)</span>}
              {parsed.rounded > 0 && <span className="bad">เลขคำสั่งซื้อ {num(parsed.rounded)} รายการถูก Excel ปัดเป็นเลขยกกำลัง · ใช้ไฟล์ที่ export มาโดยตรง อย่าเปิดแล้วบันทึกทับ</span>}
            </div>
          ) : <p className="small bad">เลือกคอลัมน์เลขคำสั่งซื้อและยอดเงิน</p>}
          <div className="cat-price-actions">
            <button className="primary" disabled={!!busy || !parsed?.orders.length} onClick={save}>{busy || `บันทึก ${num(parsed?.orders.length ?? 0)} ออเดอร์`}</button>
            <button disabled={!!busy} onClick={() => setLoaded(null)}>ยกเลิก</button>
          </div>
        </div>
      )}
    </section>
  );
}
