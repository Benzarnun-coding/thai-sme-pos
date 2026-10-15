// /catalog/sales — units sold per day: Bigseller (TikTok, Shopee; from the order-sheet rounds, each order counted once)
// + Page365 (Facebook). Daily chart and table by channel, then by sales store, best-selling products and warehouse.

import { useEffect, useMemo, useState } from 'react';
import { api, type SalesData } from './api.ts';
import { thumb, webToRow, type CatalogRow } from './catalog.ts';
import { num } from './fmt.ts';
import { makeLookup, thaiShortDate } from './purchase.ts';
import { byDay, byProduct, byStore, byWarehouse, CHANNELS, costOf, saleRows, type Channel, type DayTotal } from './sales.ts';
import { Icon, useUi } from './ui.tsx';
import { useCatalog } from './useCatalog.ts';

const COLORS: Record<Channel, string> = { TikTok: '#0fb5a6', Shopee: '#ee4d2d', Facebook: '#1877f2', Lazada: '#7a4fd6', 'อื่นๆ': '#98a1b2' };
const PRESETS = [7, 14, 30, 60];
const RANGE_KEY = 'units.range';

function todayBkk(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}
const minus = (iso: string, days: number) => new Date(Date.parse(iso) - days * 86400_000).toISOString().slice(0, 10);

function readPreset(): number {
  try { const n = Number(localStorage.getItem(RANGE_KEY)); return PRESETS.includes(n) ? n : 14; } catch { return 14; }
}

export function UnitsApp() {
  useEffect(() => { document.title = 'ยอดขาย'; }, []);
  const { toast } = useUi();
  const { meta, rows, supplierMap, priceMap, labelMap, imageMap, aliasMap } = useCatalog();
  const [preset, setPreset] = useState<number | null>(readPreset);
  const [to, setTo] = useState(todayBkk());
  const [from, setFrom] = useState(minus(todayBkk(), readPreset() - 1));
  const [data, setData] = useState<SalesData | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'stores' | 'products' | 'warehouses'>('stores');
  const [channel, setChannel] = useState<Channel | null>(null);

  useEffect(() => { try { if (preset) localStorage.setItem(RANGE_KEY, String(preset)); } catch { /* private mode */ } }, [preset]);
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    api.sales(from, to).then((d) => { if (!cancelled) setData(d); }).catch((e) => toast(e.message, 'bad')).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (days: number) => { setPreset(days); setTo(todayBkk()); setFrom(minus(todayBkk(), days - 1)); };

  const allRows = useMemo<CatalogRow[]>(() => [...rows, ...(meta?.web ?? []).map((w) => webToRow(w, 0))], [rows, meta?.web]);
  const lookup = useMemo(() => makeLookup(allRows, supplierMap, priceMap, labelMap, aliasMap), [allRows, supplierMap, priceMap, labelMap, aliasMap]);
  const sales = useMemo(() => (data ? saleRows(data) : []), [data]);
  const shown = useMemo(() => (channel ? sales.filter((r) => r.channel === channel) : sales), [sales, channel]);
  const days = useMemo(() => (data ? byDay(sales, data) : []), [sales, data]);
  const stores = useMemo(() => (data ? byStore(shown, data) : []), [shown, data]);
  const products = useMemo(() => byProduct(shown, lookup), [shown, lookup]);
  const warehouses = useMemo(() => byWarehouse(shown, lookup), [shown, lookup]);
  const cost = useMemo(() => costOf(shown, lookup), [shown, lookup]);
  const imageOf = useMemo(() => {
    const first = new Map<string, string>();
    for (const r of allRows) { const k = `${r.tab}|${r.sku.split('-').slice(0, -1).join('-')}`; if (r.image && !first.has(k)) first.set(k, r.image); }
    return (key: string) => imageMap.get(key)?.thumb || thumb(first.get(key) ?? '');
  }, [allRows, imageMap]);

  const total = shown.reduce((n, r) => n + r.qty, 0);
  // Real money only: what Page365 customers paid. Bigseller's in-process file has no prices.
  const revenueKnown = !channel || channel === 'Facebook';
  const revenue = days.reduce((n, d) => n + d.revenue, 0);
  const orders = days.reduce((n, d) => n + d.orders, 0);
  const counted = days.filter((d) => d.bigseller || d.page365).length;
  const channelTotals = CHANNELS.map((c) => ({ c, qty: sales.filter((r) => r.channel === c).reduce((n, r) => n + r.qty, 0) })).filter((x) => x.qty > 0);

  return (
    <div className="app units">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">ขาย</span>
          <div>
            <h1>ยอดขาย</h1>
            <p className="muted small clip">จำนวนตัวที่ขายได้ต่อวัน · Bigseller (TikTok, Shopee) + Page365 (Facebook)</p>
          </div>
        </div>
        <div className="row-actions">
          <a className="button" href="/catalog"><Icon name="back" size={14} /> แคตตาล็อก</a>
          <a className="button" href="/catalog/orders">สั่งของ</a>
        </div>
      </header>

      <section className="card units-range">
        <div className="segmented" role="tablist" aria-label="ช่วงวัน">
          {PRESETS.map((d) => <button key={d} className={preset === d ? 'on' : ''} onClick={() => pick(d)}>{d} วัน</button>)}
        </div>
        <label>ตั้งแต่<input type="date" value={from} max={to} onChange={(e) => { setPreset(null); setFrom(e.target.value); }} /></label>
        <label>ถึง<input type="date" value={to} min={from} max={todayBkk()} onChange={(e) => { setPreset(null); setTo(e.target.value); }} /></label>
        {busy && <span className="muted small">กำลังโหลด…</span>}
      </section>

      <div className="kpis units-kpis">
        <div className="kpi"><span>ขายได้</span><b>{num(total)} ตัว</b><small>{channel ? `เฉพาะ ${channel}` : `${num(counted)} จาก ${num(days.length)} วันที่มีข้อมูล`}</small></div>
        <div className="kpi"><span>ออเดอร์</span><b>{num(orders)}</b><small>ทุกช่องทาง</small></div>
        <div className="kpi"><span>เฉลี่ยต่อวัน</span><b>{counted ? num(total / counted, 1) : '—'} ตัว</b><small>เฉพาะวันที่มีข้อมูล</small></div>
        <div className="kpi">
          <span>ยอดขาย (บาท)</span>
          <b>{revenueKnown ? `฿${num(revenue)}` : '—'}</b>
          <small>{channel && channel !== 'Facebook' ? 'ไฟล์ Bigseller ไม่มีราคาขาย' : 'เฉพาะ Facebook (Page365) · TikTok/Shopee: ไฟล์ Bigseller ไม่มีราคาขาย'} · <a href="/catalog/profit">ยอดเงินและกำไรทุกช่องทาง</a></small>
        </div>
        <div className="kpi">
          <span>ต้นทุนของเรา</span>
          <b>฿{num(cost.cost)}</b>
          <small>ทุน H ของสินค้าที่ขาย · ไม่ใช่ยอดขาย{cost.unpriced ? ` · ไม่มีทุน ${num(cost.unpriced)} ตัว` : ''}</small>
        </div>
      </div>

      <section className="card">
        <div className="units-legend">
          <button className={!channel ? 'on' : ''} onClick={() => setChannel(null)}>ทุกช่องทาง <b>{num(sales.reduce((n, r) => n + r.qty, 0))}</b></button>
          {channelTotals.map(({ c, qty }) => (
            <button key={c} className={channel === c ? 'on' : ''} onClick={() => setChannel(channel === c ? null : c)}>
              <i style={{ background: COLORS[c] }} /> {c} <b>{num(qty)}</b>
            </button>
          ))}
        </div>
        <UnitsChart days={days} only={channel} />
      </section>

      <section className="card table-card">
        <div className="table-card-head"><h2>รายวัน</h2><p className="muted small">Bigseller นับจากรอบใบสั่งที่บันทึกในหน้าสั่งของ (ออเดอร์ละครั้ง วันแรกที่เจอ) · Page365 นับตามวันที่สร้างออเดอร์</p></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>วันที่</th><th className="num">รวม</th>{CHANNELS.filter((c) => channelTotals.some((x) => x.c === c)).map((c) => <th key={c} className="num">{c}</th>)}<th className="num">ออเดอร์</th><th className="num" title="เฉพาะ Facebook (Page365) · ไฟล์ Bigseller ไม่มีราคาขาย">ยอดขาย FB (฿)</th><th>ข้อมูล</th></tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.date} className={d.bigseller || d.page365 ? '' : 'dim'}>
                  <td>{thaiShortDate(d.date)}</td>
                  <td className="num"><b>{num(d.total)}</b></td>
                  {CHANNELS.filter((c) => channelTotals.some((x) => x.c === c)).map((c) => <td key={c} className="num">{d.channels[c] ? num(d.channels[c]) : '—'}</td>)}
                  <td className="num">{d.orders ? num(d.orders) : '—'}</td>
                  <td className="num">{d.revenue ? num(d.revenue) : '—'}</td>
                  <td className="small">
                    <span className={d.bigseller ? 'good' : 'muted'}>Bigseller {d.bigseller ? '✓' : 'ไม่มีไฟล์'}</span>
                    {' · '}
                    <span className={d.page365 ? 'good' : 'muted'}>Page365 {d.page365 ? '✓' : 'ไม่มีไฟล์'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card table-card">
        <div className="table-card-head">
          <div className="segmented" role="tablist" aria-label="แยกตาม">
            <button className={tab === 'stores' ? 'on' : ''} onClick={() => setTab('stores')}>ตามร้านขาย</button>
            <button className={tab === 'products' ? 'on' : ''} onClick={() => setTab('products')}>สินค้าขายดี</button>
            <button className={tab === 'warehouses' ? 'on' : ''} onClick={() => setTab('warehouses')}>ตามโกดัง</button>
          </div>
          {channel && <span className="pill">เฉพาะ {channel}</span>}
        </div>
        <div className="table-wrap">
          {tab === 'stores' && (
            <table className="data-table">
              <thead><tr><th>ร้านขาย</th><th>ช่องทาง</th><th className="num">ตัว</th><th className="num">ออเดอร์</th><th className="num">สัดส่วน</th></tr></thead>
              <tbody>
                {stores.map((s) => (
                  <tr key={s.store}>
                    <td><b>{s.store.split(' · ').slice(-1)[0]}</b></td>
                    <td><span className="units-chip"><i style={{ background: COLORS[s.channel] }} />{s.channel}</span></td>
                    <td className="num">{num(s.qty)}</td>
                    <td className="num">{s.orders ? num(s.orders) : '—'}</td>
                    <td className="num">{total ? `${num((s.qty / total) * 100, 1)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'products' && (
            <table className="data-table">
              <thead><tr><th>สินค้า</th><th>โกดัง</th><th className="num">ตัว</th>{CHANNELS.filter((c) => channelTotals.some((x) => x.c === c)).map((c) => <th key={c} className="num">{c}</th>)}</tr></thead>
              <tbody>
                {products.slice(0, 100).map((p) => (
                  <tr key={p.key}>
                    <td>
                      <span className="units-product">
                        {p.known && imageOf(p.key) ? <img src={imageOf(p.key)} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="units-noimg" />}
                        <span><b>{p.label}</b>{p.spu && <div className="muted small">{p.spu}</div>}{!p.known && <div className="warn small">ไม่มีในแคตตาล็อก</div>}</span>
                      </span>
                    </td>
                    <td>{p.tab || '—'}</td>
                    <td className="num"><b>{num(p.qty)}</b></td>
                    {CHANNELS.filter((c) => channelTotals.some((x) => x.c === c)).map((c) => <td key={c} className="num">{p.channels[c] ? num(p.channels[c]) : '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'warehouses' && (
            <table className="data-table">
              <thead><tr><th>โกดัง</th><th className="num">ตัว</th><th className="num">รุ่น/สี</th><th className="num">สัดส่วน</th></tr></thead>
              <tbody>
                {warehouses.map((w) => (
                  <tr key={w.tab}><td><b>{w.tab}</b></td><td className="num">{num(w.qty)}</td><td className="num">{num(w.products)}</td><td className="num">{total ? `${num((w.qty / total) * 100, 1)}%` : '—'}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {!shown.length && !busy && <p className="muted small" style={{ padding: '12px 18px' }}>ยังไม่มีข้อมูลในช่วงนี้ · Bigseller: อัปโหลดไฟล์ในหน้าสั่งของแล้วดาวน์โหลด/พิมพ์ (ระบบบันทึกรอบ) · Page365: อัปโหลดในหน้ายอดขายของแดชบอร์ด</p>}
        </div>
      </section>
    </div>
  );
}

/** Stacked bars per day by channel (or one channel). */
function UnitsChart({ days, only }: { days: DayTotal[]; only: Channel | null }) {
  const W = 1000, H = 220, pad = { l: 36, r: 8, t: 10, b: 26 };
  const value = (d: DayTotal) => (only ? d.channels[only] : d.total);
  const max = Math.max(1, ...days.map(value));
  const step = (W - pad.l - pad.r) / Math.max(1, days.length);
  const bar = Math.max(2, Math.min(36, step * 0.7));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, Math.round(max / 2), max];
  const labelEvery = Math.ceil(days.length / 15);
  return (
    <svg className="units-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="ตัวที่ขายได้ต่อวัน">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="axis">{t}</text>
        </g>
      ))}
      {days.map((d, i) => {
        const x = pad.l + i * step + (step - bar) / 2;
        let acc = 0;
        const parts = (only ? [only] : CHANNELS).map((c) => {
          const v = d.channels[c];
          const y0 = y(acc + v), h = y(acc) - y(acc + v);
          acc += v;
          return v ? <rect key={c} x={x} y={y0} width={bar} height={h} fill={COLORS[c]} rx={1.5}><title>{`${thaiShortDate(d.date)} · ${c} ${v} ตัว`}</title></rect> : null;
        });
        return (
          <g key={d.date} opacity={d.bigseller || d.page365 ? 1 : 0.35}>
            {parts}
            {value(d) > 0 && step > 22 && <text x={x + bar / 2} y={y(value(d)) - 4} textAnchor="middle" className="val">{value(d)}</text>}
            {i % labelEvery === 0 && <text x={x + bar / 2} y={H - 8} textAnchor="middle" className="axis">{thaiShortDate(d.date).split('/').slice(0, 2).join('/')}</text>}
          </g>
        );
      })}
    </svg>
  );
}
