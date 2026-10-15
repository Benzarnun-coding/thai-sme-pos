// /catalog/todo — "งานค้าง": what is still missing for the order sheets, costs and sales to be right, most-sold first
// (from the units sold in the last 7/14/30 days, so the list is what matters now, not all 17k SKUs):
//   SKUs not in the catalog (match them to ours) · sold without a cost (type it) · BB products without a supplier ·
//   sold without a picture · SKUs added on the web that are not in the sheet yet.

import { useEffect, useMemo, useState } from 'react';
import { api, type SalesData } from './api.ts';
import { SHOP_STATUSES, skuKey, spuOf, webToRow, type CatalogRow } from './catalog.ts';
import { num } from './fmt.ts';
import { groupOf, labelFor, makeLookup, priceOf, SUPPLIER_TABS } from './purchase.ts';
import { saleRows } from './sales.ts';
import { HomeLogo, SiteNav } from './SiteNav.tsx';
import { SkuMatch } from './SkuMatch.tsx';
import { Icon, useUi } from './ui.tsx';
import { useCatalog } from './useCatalog.ts';

const RANGES = [7, 14, 30];
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const minus = (iso: string, d: number) => new Date(Date.parse(iso) - d * 86400_000).toISOString().slice(0, 10);

interface SoldProduct { key: string; tab: string; spu: string; label: string; qty: number; row: CatalogRow; unassigned: boolean }

export function TodoApp() {
  useEffect(() => { document.title = 'งานค้าง'; }, []);
  const { toast } = useUi();
  const { meta, setMeta, rows, loading, canEdit, supplierMap, priceMap, labelMap, aliasMap, imageMap } = useCatalog();
  const [days, setDays] = useState(14);
  const [data, setData] = useState<SalesData | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.sales(minus(today(), days - 1), today()).then((d) => { if (!cancelled) setData(d); }).catch((e) => toast(e.message, 'bad'));
    return () => { cancelled = true; };
  }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const allRows = useMemo<CatalogRow[]>(() => [...rows, ...(meta?.web ?? []).map((w) => webToRow(w, 0))], [rows, meta?.web]);
  const lookup = useMemo(() => makeLookup(allRows, supplierMap, priceMap, labelMap, aliasMap), [allRows, supplierMap, priceMap, labelMap, aliasMap]);
  const sales = useMemo(() => (data ? saleRows(data) : []), [data]);

  // What sold, per product (known SKUs) and per unknown SKU.
  const { products, unknown } = useMemo(() => {
    const products = new Map<string, SoldProduct>();
    const unknown = new Map<string, { sku: string; name: string; qty: number }>();
    for (const s of sales) {
      const r = lookup.rows.get(skuKey(s.sku));
      if (!r) {
        if (!s.sku || s.sku.startsWith('?')) continue;
        const u = unknown.get(skuKey(s.sku)) ?? { sku: s.sku, name: s.name, qty: 0 };
        u.qty += s.qty;
        if (!u.name && s.name) u.name = s.name;
        unknown.set(skuKey(s.sku), u);
        continue;
      }
      const key = `${r.tab}|${spuOf(r.sku)}`;
      const p = products.get(key) ?? { key, tab: r.tab, spu: spuOf(r.sku), label: labelFor(r, 'warehouse', lookup), qty: 0, row: r, unassigned: false };
      p.qty += s.qty;
      if (groupOf(r, lookup).kind === 'unassigned') p.unassigned = true; // the same rule the order sheets use
      products.set(key, p);
    }
    return { products: [...products.values()].sort((a, b) => b.qty - a.qty), unknown: [...unknown.values()].sort((a, b) => b.qty - a.qty) };
  }, [sales, lookup]);

  const sheetImage = useMemo(() => {
    const m = new Set<string>();
    for (const r of allRows) if (r.image) m.add(`${r.tab}|${spuOf(r.sku)}`);
    return m;
  }, [allRows]);
  const noCost = products.filter((p) => priceOf(p.row.sku, lookup).price === null);
  const noSupplier = products.filter((p) => p.unassigned);
  const noImage = products.filter((p) => !imageMap.has(p.key) && !sheetImage.has(p.key));
  const sheetKeys = useMemo(() => new Set(rows.map((r) => skuKey(r.sku))), [rows]);
  const webPending = (meta?.web ?? []).filter((w) => !sheetKeys.has(skuKey(w.sku)));

  // Whole catalog, for scale
  const bbAll = useMemo(() => {
    const keys = new Set<string>(), withShop = new Set<string>();
    for (const r of allRows) {
      if (!SUPPLIER_TABS.includes(r.tab)) continue;
      const k = `${r.tab}|${spuOf(r.sku)}`;
      keys.add(k);
      if ((r.shop && !SHOP_STATUSES.has(r.shop)) || supplierMap.get(k)) withShop.add(k);
    }
    return keys.size - withShop.size;
  }, [allRows, supplierMap]);

  const total = unknown.length + noCost.length + noSupplier.length + noImage.length + webPending.length;
  const soldPieces = sales.reduce((n, s) => n + s.qty, 0);

  async function setCost(p: SoldProduct, raw: string) {
    const price = Number(raw);
    if (!(price >= 0) || raw.trim() === '') return;
    try {
      const { prices } = await api.setPrices([{ tab: p.tab, spu: p.spu, price }]);
      const keys = new Set(prices.map((x) => x.key));
      setMeta((m) => (m ? { ...m, prices: [...m.prices.filter((x) => !keys.has(x.key)), ...prices] } : m));
      toast(`${p.label} ทุน ${num(price)} บาท`, 'ok');
    } catch (e: any) { toast(e.message, 'bad'); }
  }
  async function setSupplier(p: SoldProduct, shop: string) {
    if (!shop.trim()) return;
    try {
      const { suppliers } = await api.setSuppliers([{ tab: p.tab, spu: p.spu, shop: shop.trim() }]);
      const keys = new Set(suppliers.map((x) => x.key));
      setMeta((m) => (m ? { ...m, suppliers: [...m.suppliers.filter((x) => !keys.has(x.key)), ...suppliers] } : m));
      toast(`${p.label} สั่งจาก ${shop.trim()}`, 'ok');
    } catch (e: any) { toast(e.message, 'bad'); }
  }
  const supplierNames = useMemo(() => [...new Set([...allRows.map((r) => r.shop).filter((s) => s && !SHOP_STATUSES.has(s)), ...supplierMap.values()])].sort((a, b) => a.localeCompare(b, 'th')), [allRows, supplierMap]);

  return (
    <div className="app todo">
      <SiteNav current="/catalog/todo" />
      <header className="top">
        <div className="brand">
          <HomeLogo text="✓" />
          <div>
            <h1>งานค้าง</h1>
            <p className="muted small clip">{loading || !data ? 'กำลังโหลด…' : `${num(total)} รายการ · จากสินค้าที่ขาย ${num(soldPieces)} ตัวใน ${days} วัน · เรียงจากขายมากสุด`}</p>
          </div>
        </div>
      </header>

      <section className="card units-range">
        <div className="segmented" role="tablist" aria-label="ดูจากยอดขายกี่วัน">
          {RANGES.map((d) => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>ขายใน {d} วัน</button>)}
        </div>
        {!canEdit && <span className="warn small">บัญชีนี้ดูได้อย่างเดียว · แก้ได้เฉพาะเจ้าของ ผู้ดูแล และสิทธิ์แก้ต้นทุน</span>}
      </section>

      <TodoCard title="SKU ที่ไม่มีในแคตตาล็อก" count={unknown.length} hint="Lazada หรือร้านอื่นส่ง SKU ของตัวเองมา หรือพิมพ์ผิด · จับคู่ครั้งเดียว ออเดอร์ต่อไปเข้าใบที่ถูก ได้ทุนและยอดขายถูกสินค้า">
        <table className="data-table">
          <thead><tr><th>SKU ที่มา</th><th className="num">ขายไป</th><th>จับคู่กับ SKU ของเรา</th></tr></thead>
          <tbody>
            {unknown.slice(0, 100).map((u) => (
              <tr key={u.sku}>
                <td><code>{u.sku}</code>{u.name && <div className="muted small">{u.name}</div>}</td>
                <td className="num">{num(u.qty)}</td>
                <td>
                  {canEdit ? <SkuMatch alias={u.sku} rows={allRows} initialQuery={u.name} onMatched={(a) => setMeta((m) => (m ? { ...m, aliases: [a, ...m.aliases.filter((x) => x.alias !== a.alias)] } : m))} /> : '—'}
                  {' · '}<a className="small" href={`/catalog?q=${encodeURIComponent(u.sku)}&add=1`} target="_blank" rel="noreferrer">เพิ่มเป็น SKU ใหม่</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TodoCard>

      <TodoCard title="ขายแล้วแต่ยังไม่มีทุน" count={noCost.length} hint="ยอดจ่ายร้านและต้นทุนในหน้ายอดขายจะขาดไปจนกว่าจะมีทุน · ใส่ทุน/ตัว ใช้กับทุกไซส์ของรุ่น จำไว้ทุกวัน (หรือกรอกคอลัมน์ H ในชีต)">
        <table className="data-table">
          <thead><tr><th>สินค้า</th><th>โกดัง</th><th className="num">ขายไป</th><th>ทุน/ตัว</th></tr></thead>
          <tbody>
            {noCost.slice(0, 100).map((p) => (
              <tr key={p.key}>
                <td><b>{p.label}</b><div className="muted small">{p.spu}</div></td>
                <td>{p.tab}</td>
                <td className="num">{num(p.qty)}</td>
                <td>{canEdit ? <InlineInput placeholder="ใส่ทุน" numeric action="บันทึก" onSave={(v) => setCost(p, v)} /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TodoCard>

      <TodoCard title="สินค้าโบ๊เบ๊ที่ยังไม่ระบุร้าน" count={noSupplier.length} hint={`ใบสั่งจะไปอยู่ "BB · ยังไม่ระบุร้าน" · ตั้งร้านครั้งเดียวจำไว้ทุกวัน (ทั้งแคตตาล็อกยังไม่มีร้าน ${num(bbAll)} รุ่น)`}>
        <table className="data-table">
          <thead><tr><th>สินค้า</th><th className="num">ขายไป</th><th>สั่งจาก</th></tr></thead>
          <tbody>
            {noSupplier.slice(0, 100).map((p) => (
              <tr key={p.key}>
                <td><b>{p.label}</b><div className="muted small">{p.spu}</div></td>
                <td className="num">{num(p.qty)}</td>
                <td>{canEdit ? <InlineInput placeholder="ชื่อร้าน" list="todo-suppliers" action="ตั้งร้าน" onSave={(v) => setSupplier(p, v)} /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="todo-suppliers">{supplierNames.map((n) => <option key={n} value={n} />)}</datalist>
      </TodoCard>

      <TodoCard title="ขายแล้วแต่ไม่มีรูป" count={noImage.length} hint="รูปช่วยตอนทำใบสั่งแบบรูปภาพ (โกดังจีน) และตอนค้นหา · กดเปิดในแคตตาล็อกแล้วกด + เพิ่มรูป">
        <table className="data-table">
          <thead><tr><th>สินค้า</th><th>โกดัง</th><th className="num">ขายไป</th><th /></tr></thead>
          <tbody>
            {noImage.slice(0, 100).map((p) => (
              <tr key={p.key}>
                <td><b>{p.label}</b><div className="muted small">{p.spu}</div></td>
                <td>{p.tab}</td>
                <td className="num">{num(p.qty)}</td>
                <td><a className="small" href={`/catalog?q=${encodeURIComponent(p.spu)}`} target="_blank" rel="noreferrer">เปิดในแคตตาล็อก <Icon name="chevron" size={12} /></a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TodoCard>

      <TodoCard title="SKU ที่เพิ่มในเว็บ แต่ยังไม่อยู่ในชีต" count={webPending.length} hint={`คัดลอกไปวางในชีต SKU+Price ได้จากแท็บ "เพิ่มจากเว็บ" ในแคตตาล็อก`}>
        <table className="data-table">
          <thead><tr><th>SKU</th><th>โกดัง</th><th>รายละเอียด</th><th>เพิ่มโดย</th></tr></thead>
          <tbody>
            {webPending.slice(0, 100).map((w) => (
              <tr key={w.sku}><td><code>{w.sku}</code></td><td>{w.tab}</td><td className="small">{w.name || '—'}</td><td className="small muted">{w.created_by.split('@')[0]}</td></tr>
            ))}
          </tbody>
        </table>
      </TodoCard>
    </div>
  );
}

function TodoCard({ title, count, hint, children }: { title: string; count: number; hint: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`card table-card todo-card ${count ? 'has' : 'done'}`}>
      <div className="table-card-head">
        <button className="link po-group-title" onClick={() => setOpen(!open)} aria-expanded={open && count > 0} disabled={!count}>
          <Icon name="chevron" size={14} />
          <b>{title}</b>
          {count ? <span className="pill warn">{num(count)}</span> : <span className="pill on">เรียบร้อย ✓</span>}
        </button>
      </div>
      {count > 0 && open && (
        <>
          <p className="small muted po-hint">{hint}</p>
          <div className="table-wrap">{children}</div>
          {count > 100 && <p className="small muted po-hint" style={{ paddingTop: 8 }}>แสดง 100 อันดับที่ขายมากสุด จาก {num(count)}</p>}
        </>
      )}
    </section>
  );
}

function InlineInput({ placeholder, action, numeric, list, onSave }: { placeholder: string; action: string; numeric?: boolean; list?: string; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => { if (!v.trim() || busy) return; setBusy(true); try { await onSave(v); setV(''); } finally { setBusy(false); } };
  return (
    <span className="po-shop">
      <input value={v} list={list} inputMode={numeric ? 'decimal' : undefined} placeholder={placeholder} aria-label={placeholder}
        onChange={(e) => setV(numeric ? e.target.value.replace(/[^\d.]/g, '') : e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
      <button className="small primary" disabled={busy || !v.trim()} onClick={save}>{action}</button>
    </span>
  );
}
