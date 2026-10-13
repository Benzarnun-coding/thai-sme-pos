// /catalog/orders — Bigseller's daily "Order-SKU-inprocess" export (.xlsx or .csv) → order sheets per supplier (BB …) or warehouse
// (PK, CM …), checked on screen, downloaded as Excel or printed like the team's hand-made sheets. The file is read
// in the browser; only the resulting lines (SKU, quantity, supplier) are saved as history, no order numbers.
// Who supplies a product can be changed right here; it is saved for that product and used every day after.

import { useEffect, useMemo, useState } from 'react';
import { api, type PurchaseUpload, type SavedPurchaseLine } from './api.ts';
import { SHOP_STATUSES, skuKey, spuOf, thumb, webToRow, type CatalogRow } from './catalog.ts';
import { num } from './fmt.ts';
import {
  applyMoves, buildLines, dateFromFileName, orderColumns, lineKey, MISSING_GROUP, missingGroup, dayMonth, groupLines, KIND_LABEL, makeLookup, missingOrderColumns, orderWorkbook, readOrderItems,
  orderBlocks, pictureBlocks, sheetRows, thaiShortDate, wantsPictures, type OrderBlock, type OrderItem, type ProductInfo, type PurchaseGroup, type PurchaseLine,
} from './purchase.ts';
import { orderPictureSheets, pictureSheets } from './pictureSheet.ts';
import { Icon, Modal, useUi } from './ui.tsx';
import { useCatalog } from './useCatalog.ts';
import { readFirstSheet } from './xlsx.ts';
import { parseExport } from './gosell.ts';


interface Loaded { file: string; items: OrderItem[] }
interface FromHistory { upload: PurchaseUpload; lines: PurchaseLine[] }

function todayBkk(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

function download(bytes: Uint8Array, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = name.replace(/[\\/:*?"<>|]/g, '-');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

function fromSaved(l: SavedPurchaseLine): PurchaseLine {
  return { group: l.grp, kind: l.kind, sku: l.sku, tab: l.tab, product: '', label: l.label, size: l.size, qty: l.qty, note: l.note, orders: l.orders ?? [], missing: l.missing };
}

export function OrdersApp() {
  useEffect(() => { document.title = 'ใบสั่งสินค้า'; }, []);
  const { toast, confirm } = useUi();
  const { meta, setMeta, rows, loading, error, canEdit, role, supplierMap, imageMap } = useCatalog();
  const [data, setData] = useState<Loaded | null>(null);
  const [history, setHistory] = useState<PurchaseUpload[]>([]);
  const [viewing, setViewing] = useState<FromHistory | null>(null);
  const [date, setDate] = useState(todayBkk());
  const [round, setRound] = useState(1);
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [printing, setPrinting] = useState<PurchaseGroup[] | null>(null);
  const [savedSig, setSavedSig] = useState('');
  const [pictures, setPictures] = useState<PurchaseGroup | null>(null);
  // ตรวจสอบ rows moved by hand this round: Bigseller SKU (or "?name · option") → supplier/warehouse
  const [moves, setMoves] = useState<Map<string, string>>(new Map());
  // Out of stock, as ticked on the page after the supplier answered: lineKey → pieces. Saved to D1 on every tick.
  const [missing, setMissingMap] = useState<Map<string, number>>(new Map());
  const moveLine = (sku: string, to: string) => setMoves((m) => { const n = new Map(m); if (to.trim()) n.set(sku, to.trim()); else n.delete(sku); return n; });

  useEffect(() => { api.purchases().then((r) => setHistory(r.uploads)).catch(() => {}); }, []);

  // Sheet rows + SKUs added on the page, so a SKU added this morning already lands on the right sheet.
  const allRows = useMemo<CatalogRow[]>(() => [...rows, ...(meta?.web ?? []).map((w) => webToRow(w, 0))], [rows, meta?.web]);
  const lookup = useMemo(() => makeLookup(allRows, supplierMap), [allRows, supplierMap]);
  // Photo, code and colour per SKU for picture sheets: a picture added on the page, else column J of any size.
  const productInfo = useMemo(() => {
    const firstImage = new Map<string, string>();
    for (const r of allRows) { const k = `${r.tab}|${spuOf(r.sku)}`; if (r.image && !firstImage.has(k)) firstImage.set(k, r.image); }
    return (sku: string): ProductInfo | undefined => {
      const r = lookup.rows.get(skuKey(sku));
      if (!r) return undefined;
      const key = `${r.tab}|${spuOf(r.sku)}`;
      return { key, code: r.code || spuOf(r.sku), color: r.color, image: imageMap.get(key)?.thumb || thumb(firstImage.get(key) ?? '') };
    };
  }, [allRows, lookup, imageMap]);
  const warehouses = useMemo(() => new Set((meta?.tabs ?? []).map((t) => t.tab)), [meta?.tabs]);
  // Moves (out of stock → another supplier, ตรวจสอบ rows …) apply to a new upload and to a round reopened from history.
  const baseLines = useMemo(() => (viewing ? viewing.lines : data ? buildLines(data.items, lookup) : []), [viewing, data, lookup]);
  const lines = useMemo(() => applyMoves(baseLines, moves, warehouses, lookup), [baseLines, moves, warehouses, lookup]);
  const groups = useMemo(() => groupLines(lines), [lines]);
  const pieces = groups.reduce((n, g) => n + g.pieces, 0);
  const pia = useMemo(() => missingGroup(lines, missing, lookup), [lines, missing, lookup]);
  const review = groups.find((g) => g.kind === 'review');
  const sig = JSON.stringify([date, round, lines.map((l) => [l.group, l.sku, l.qty])]);
  const supplierNames = useMemo(() => {
    const names = new Set<string>();
    for (const r of rows) if (r.shop && !SHOP_STATUSES.has(r.shop)) names.add(r.shop);
    for (const v of supplierMap.values()) names.add(v);
    return [...names].sort((a, b) => a.localeCompare(b, 'th'));
  }, [rows, supplierMap]);
  /** What a row can be moved to: every supplier, then the warehouses. Anything else can be typed. */
  const targets = useMemo(() => [...supplierNames, ...[...warehouses].filter((w) => !supplierNames.includes(w))], [supplierNames, warehouses]);

  // Unassigned products and ตรวจสอบ need a look; the rest stay folded.
  useEffect(() => { setOpen(new Set(groups.filter((g) => g.kind === 'unassigned' || g.kind === 'review').map((g) => g.name))); }, [data, viewing]); // eslint-disable-line react-hooks/exhaustive-deps

  function nextRound(d: string) {
    return Math.max(0, ...history.filter((h) => h.date === d).map((h) => h.round)) + 1;
  }

  async function onFile(file: File) {
    setBusy('กำลังอ่านไฟล์…');
    try {
      let headers: string[], raw: Record<string, string>[];
      if (/\.xlsx$/i.test(file.name)) ({ headers, rows: raw } = await readFirstSheet(file));
      else if (/\.(csv|tsv|txt)$/i.test(file.name)) ({ headers, rows: raw } = parseExport(new Uint8Array(await file.arrayBuffer())));
      else throw new Error('เลือกไฟล์ .xlsx หรือ .csv ที่ export จาก Bigseller (Order-SKU-inprocess…)');
      const missing = missingOrderColumns(headers);
      if (missing) throw new Error(`ไฟล์ "${file.name}" ไม่มีคอลัมน์ ${missing.join(', ')} · หัวตารางที่อ่านได้: ${headers.slice(0, 6).join(', ') || '(ว่าง)'}`);
      const items = readOrderItems(raw, headers);
      if (!items.length) throw new Error('ไม่พบรายการสินค้าในไฟล์');
      if (!orderColumns(headers).order) toast('ไฟล์นี้ไม่มีคอลัมน์ "หมายเลขคำสั่งซื้อ" · ใบสั่งจะไม่มีเลขคำสั่งซื้อ', 'bad');
      // The same file again (e.g. a round saved before order numbers were kept): pick that round, so saving updates
      // it — order numbers filled in, out-of-stock ticks kept — instead of starting a new round.
      const same = history.find((h) => h.file === file.name);
      const d = same?.date ?? dateFromFileName(file.name) ?? todayBkk();
      setViewing(null);
      setMoves(new Map());
      setMissingMap(new Map());
      setData({ file: file.name, items });
      setDate(d);
      setRound(same ? same.round : nextRound(d));
      setSavedSig('');
      if (same) {
        // Bring back what was done on that round: rows moved by hand, and the out-of-stock ticks.
        const { lines: saved } = await api.purchaseLines(same.id);
        const fresh = new Map(buildLines(items, lookup).map((l) => [l.sku, l.group]));
        setMoves(new Map(saved.filter((l) => fresh.has(l.sku) && fresh.get(l.sku) !== l.grp).map((l) => [l.sku, l.grp])));
        setMissingMap(new Map(saved.filter((l) => l.missing > 0).map((l) => [lineKey({ sku: l.sku }), l.missing])));
        toast(`ไฟล์นี้เคยบันทึกเป็น ${thaiShortDate(same.date)} รอบ ${same.round} · เปิดรอบเดิมพร้อมการย้ายร้านและติ๊กของไม่มี · ดาวน์โหลด/พิมพ์/ติ๊ก จะอัปเดตรอบนี้ (เติมเลขคำสั่งซื้อ)`, 'info');
      }
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }

  /** History is what was downloaded or printed; saving the same day + round again replaces it. */
  async function save(): Promise<boolean> {
    if ((!viewing && !data) || sig === savedSig || !canEdit) return true;
    try {
      const file = viewing ? viewing.upload.file : data!.file;
      const { upload } = await api.savePurchase({ date, round, file, lines: lines.map((l) => ({ ...l })) });
      setHistory((h) => [upload, ...h.filter((x) => x.id !== upload.id)].sort((a, b) => b.date.localeCompare(a.date) || b.round - a.round));
      setSavedSig(sig);
      // Saving over a round that already had out-of-stock ticks keeps them; show them here too.
      if (upload.missing > 0) {
        const { lines: saved } = await api.purchaseLines(upload.id);
        setMissingMap(new Map(saved.filter((l) => l.missing > 0).map((l) => [lineKey({ sku: l.sku }), l.missing])));
      }
      return true;
    } catch (e: any) { toast(`บันทึกประวัติไม่ได้: ${e.message}`, 'bad'); return false; }
  }

  /** Tick (or untick) a line as out of stock. The round is saved first if it has not been yet. */
  async function setLineMissing(l: PurchaseLine, n: number) {
    if (!canEdit) { toast('บัญชีนี้ติ๊กของไม่มีไม่ได้', 'bad'); return; }
    const id = viewing ? viewing.upload.id : `${date}#${round}`;
    if (!viewing && !(await save())) return;
    const before = missing;
    setMissingMap((m) => { const x = new Map(m); if (n > 0) x.set(lineKey(l), n); else x.delete(lineKey(l)); return x; });
    try {
      const { missing: total } = await api.setMissing(id, [{ grp: l.group, sku: l.sku, missing: n }]);
      setHistory((h) => h.map((u) => (u.id === id ? { ...u, missing: total } : u)));
    } catch (e: any) { setMissingMap(before); toast(e.message, 'bad'); }
  }

  async function exportExcel(only?: PurchaseGroup) {
    setBusy('กำลังสร้างไฟล์…');
    try {
      await save();
      const list = only ? [only] : groups;
      download(await orderWorkbook(list, date, round), `${only ? only.name : 'ใบสั่ง'} ${dayMonth(date)} รอบ${round}.xlsx`);
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }

  async function print(only?: PurchaseGroup) {
    await save();
    setPrinting(only ? [only] : groups.filter((g) => g.kind !== 'review'));
  }
  useEffect(() => {
    if (!printing) return;
    document.body.classList.add('printing-orders');
    const done = () => { document.body.classList.remove('printing-orders'); setPrinting(null); };
    window.addEventListener('afterprint', done, { once: true });
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [printing]);

  async function setSupplier(items: { tab: string; spu: string }[], shop: string) {
    if (!items.length) return;
    try {
      await api.setSuppliers(items.map((i) => ({ ...i, shop })));
      const now = new Date().toISOString();
      setMeta((m) => {
        if (!m) return m;
        const keys = new Set(items.map((i) => `${i.tab}|${i.spu}`));
        return { ...m, suppliers: [...m.suppliers.filter((s) => !keys.has(s.key)), ...(shop ? items.map((i) => ({ key: `${i.tab}|${i.spu}`, tab: i.tab, spu: i.spu, shop, updated_by: '', updated_at: now })) : [])] };
      });
      toast(shop ? `ย้าย ${items.length} รุ่นไปร้าน ${shop} แล้ว · ใช้กับทุกวันต่อจากนี้` : 'กลับไปใช้ร้านตามชีตแล้ว', 'ok');
    } catch (e: any) { toast(e.message, 'bad'); }
  }

  // A round reopened from history saves itself after every change (moves); the first run only records the baseline.
  useEffect(() => {
    if (!viewing || !canEdit) return;
    if (!savedSig) { setSavedSig(sig); return; }
    if (sig !== savedSig) save();
  }, [viewing, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openHistory(u: PurchaseUpload) {
    setBusy('กำลังเปิด…');
    try {
      const { lines: saved } = await api.purchaseLines(u.id);
      setSavedSig('');
      setViewing({ upload: u, lines: saved.map(fromSaved) });
      setMoves(new Map());
      setMissingMap(new Map(saved.filter((l) => l.missing > 0).map((l) => [lineKey({ sku: l.sku }), l.missing])));
      setData(null);
      setDate(u.date);
      setRound(u.round);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }

  async function removeHistory(u: PurchaseUpload) {
    const ok = await confirm({ title: `ลบใบสั่ง ${thaiShortDate(u.date)} รอบ ${u.round}?`, body: <p>ลบเฉพาะประวัติในเว็บ ไฟล์ที่ดาวน์โหลดไปแล้วไม่หาย</p>, confirmLabel: 'ลบ', tone: 'danger' });
    if (!ok) return;
    try {
      await api.deletePurchase(u.id);
      setHistory((h) => h.filter((x) => x.id !== u.id));
      if (viewing?.upload.id === u.id) setViewing(null);
    } catch (e: any) { toast(e.message, 'bad'); }
  }

  const toggle = (name: string) => setOpen((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const ready = !loading && !error;
  const shown = data || viewing;

  return (
    <div className="app orders">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">PO</span>
          <div>
            <h1>ใบสั่งสินค้า</h1>
            <p className="muted small clip">{loading ? `กำลังโหลดแคตตาล็อก ${loading.of ? `${num(loading.done)} / ${num(loading.of)}` : '…'}` : `ไฟล์ Bigseller → ใบสั่งแยกตามร้านค้า / โกดัง · แคตตาล็อก ${num(rows.length)} SKU`}</p>
          </div>
        </div>
        <div className="row-actions">
          <a className="button" href="/catalog"><Icon name="back" size={14} /> แคตตาล็อก</a>
        </div>
      </header>

      {error && <div className="card bad">{error}</div>}
      {ready && !meta?.tabs.length && <div className="card">ยังไม่มีข้อมูลแคตตาล็อก · เปิด <a href="/catalog">แคตตาล็อก</a> แล้วกด "ดึงจากชีต" ก่อน</div>}

      <section className="card">
        <div className="table-card-head" style={{ padding: 0 }}>
          <div>
            <h2>{viewing ? `ใบสั่งย้อนหลัง ${thaiShortDate(viewing.upload.date)} รอบ ${viewing.upload.round}` : 'ไฟล์จาก Bigseller'}</h2>
            <p className="muted small">
              {viewing ? `บันทึกโดย ${viewing.upload.saved_by.split('@')[0]} · ไฟล์ ${viewing.upload.file || '—'}`
                : data ? `${data.file} · อ่านในเบราว์เซอร์นี้ เก็บ SKU จำนวน และเลขคำสั่งซื้อ (ไม่เก็บเลขพัสดุ)` : 'Export "Order-SKU-inprocess" (.xlsx หรือ .csv) จาก Bigseller แล้วอัปโหลดที่นี่ วันละรอบหรือหลายรอบ'}
            </p>
          </div>
          <label className={`button ${busy || !ready ? 'disabled' : 'primary'}`}>
            <Icon name="up" size={14} /> {busy || (shown ? 'เลือกไฟล์ใหม่' : 'เลือกไฟล์ Bigseller')}
            <input type="file" accept=".xlsx,.csv,.tsv,.txt" hidden disabled={!!busy || !ready} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
          </label>
        </div>
        {!shown && (
          <div
            className="po-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && ready) onFile(f); }}
          >
            ลากไฟล์มาวางที่นี่
            <ul className="notes muted small">
              <li>โกดังที่มีร้านค้าในชีต (BB …) แยกใบตามคอลัมน์ ร้านค้า · โกดังอื่น (PK, CM, CN …) ใบละโกดัง</li>
              <li>เปลี่ยนร้านที่สั่งของรุ่นไหนก็ได้ในหน้านี้ (เช่น PK 501/1 → J.BIG) ระบบจำไว้ใช้วันต่อไป</li>
              <li>SKU ที่ไม่มีในแคตตาล็อกไปอยู่ "ตรวจสอบ" พร้อมปุ่มเพิ่ม SKU</li>
            </ul>
          </div>
        )}
        {shown && (
          <div className="po-meta">
            <label>วันที่<input type="date" value={date} disabled={!!viewing} onChange={(e) => { setDate(e.target.value); if (!viewing) setRound(nextRound(e.target.value)); }} /></label>
            <label>รอบ<select value={round} disabled={!!viewing} onChange={(e) => setRound(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6].map((r) => <option key={r} value={r}>รอบ {r}{history.some((h) => h.date === date && h.round === r) ? ' (มีแล้ว)' : ''}</option>)}</select></label>
            {viewing && <button className="ghost small" onClick={() => setViewing(null)}>ปิดใบย้อนหลัง</button>}
            {viewing && viewing.lines.length > 0 && viewing.lines.every((l) => !l.orders?.length) && (
              <span className="warn small">รอบนี้บันทึกก่อนระบบเก็บเลขคำสั่งซื้อ · อัปโหลดไฟล์เดิม{viewing.upload.file ? ` (${viewing.upload.file})` : ''} อีกครั้ง แล้วกดดาวน์โหลด/พิมพ์ จะเติมเลขให้รอบนี้ (ติ๊กของไม่มียังอยู่)</span>
            )}
            {!viewing && history.some((h) => h.date === date && h.round === round) && <span className="warn small">วันที่และรอบนี้มีใบสั่งแล้ว · ดาวน์โหลด/พิมพ์จะบันทึกทับ</span>}
          </div>
        )}
      </section>

      {shown && (
        <>
          <div className="kpis po-kpis">
            <div className="kpi"><span>ชิ้นทั้งหมด</span><b>{num(pieces)}</b>{data && <small>{num(new Set(data.items.map((i) => i.order).filter(Boolean)).size)} ออเดอร์</small>}</div>
            <div className="kpi"><span>ร้านค้า</span><b>{num(groups.filter((g) => g.kind === 'supplier').length)}</b></div>
            <div className="kpi"><span>โกดัง</span><b>{num(groups.filter((g) => g.kind === 'warehouse').length)}</b></div>
            <div className="kpi"><span>ต้องตรวจสอบ</span><b className={review || groups.some((g) => g.kind === 'unassigned') ? 'bad' : 'good'}>{num((review?.pieces ?? 0) + groups.filter((g) => g.kind === 'unassigned').reduce((n, g) => n + g.pieces, 0))}</b><small>ไม่มี SKU / ยังไม่ระบุร้าน</small></div>
          </div>

          <section className="card po-actions">
            <div>
              <h2>ส่งออกใบสั่ง</h2>
              <p className="muted small">Excel = ชีตสรุป + ชีตละร้าน · พิมพ์ = หน้าละร้าน เลือก "บันทึกเป็น PDF" เพื่อส่งทาง Line ได้{!viewing && canEdit ? ' · ระบบบันทึกประวัติให้เมื่อดาวน์โหลดหรือพิมพ์' : ''}</p>
            </div>
            <div className="row-actions">
              <button onClick={() => print()} disabled={!!busy}><Icon name="down" size={14} /> พิมพ์ / PDF ทุกใบ</button>
              <button className="primary" onClick={() => exportExcel()} disabled={!!busy}><Icon name="down" size={14} /> Excel ทุกใบ</button>
            </div>
          </section>

          {pia ? (
            <section className="card table-card po-group pia">
              <div className="table-card-head">
                <div>
                  <h2>ของไม่มี → ไฟล์{MISSING_GROUP} <span className="muted small">{num(pia.pieces)} ชิ้น · {num(pia.lines.length)} รายการ</span></h2>
                  <p className="muted small">รวมทุกรายการที่ติ๊ก "ของไม่มี" ในรอบนี้ ไปสั่งข้างนอก · ชื่อสินค้าใช้รหัส + สีของเราเอง (ไม่ใช่รหัสร้านเดิม)</p>
                </div>
                <div className="row-actions">
                  <button className="small" onClick={() => setPictures(pia)} disabled={!!busy}>รูปภาพ</button>
                  <button className="small" onClick={() => print(pia)} disabled={!!busy}>พิมพ์</button>
                  <button className="small primary" onClick={() => exportExcel(pia)} disabled={!!busy}><Icon name="down" size={14} /> Excel {MISSING_GROUP}</button>
                </div>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>รหัสสินค้า</th><th>ไซส์</th><th className="num">ไม่มี</th><th>ร้านเดิม</th><th>SKU</th><th>เลขคำสั่งซื้อ</th>{canEdit && <th />}</tr></thead>
                  <tbody>
                    {pia.lines.map((l) => (
                      <tr key={`${l.note}|${l.sku}`}>
                        <td><b>{l.label}</b></td><td>{l.size || '—'}</td><td className="num"><b>{num(l.qty)}</b></td>
                        <td className="small">{l.note.replace(/^ไม่มีที่ /, '')}</td><td className="small"><code>{l.sku}</code></td>
                        <td className="small"><OrderNumbers orders={l.orders} /></td>
                        {canEdit && <td><button className="link small" onClick={() => { const orig = lines.find((x) => x.sku === l.sku && `ไม่มีที่ ${x.group}` === l.note); if (orig) setLineMissing(orig, 0); }}>เอาออก</button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <p className="muted small po-hint" style={{ padding: 0 }}>ร้านแจ้งว่าของไม่มี? เปิดรอบนั้น (ตารางใบสั่งย้อนหลังด้านล่าง) แล้วติ๊กช่อง "ของไม่มี" ท้ายรายการ · รายการที่ติ๊กจะรวมเป็นไฟล์{MISSING_GROUP}ให้ดาวน์โหลด</p>
          )}

          {groups.map((g) => (
            <GroupCard
              key={g.name} group={g} open={open.has(g.name)} onToggle={() => toggle(g.name)}
              missing={missing} onMissing={canEdit ? setLineMissing : null}
              canRemember={canEdit} movable={!viewing || canEdit} targets={targets} onMove={moveLine}
              onSupplier={setSupplier} onExcel={() => exportExcel(g)} onPrint={() => print(g)} busy={!!busy}
              onPictures={() => { save(); setPictures(g); }}
            />
          ))}
        </>
      )}

      {history.length > 0 && (
        <section className="card table-card">
          <div className="table-card-head"><h2>ใบสั่งย้อนหลัง</h2></div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>วันที่</th><th>รอบ</th><th className="num">ชิ้น</th><th>ร้าน / โกดัง</th><th className="num">ตรวจสอบ</th><th className="num">ของไม่มี</th><th>บันทึกโดย</th><th /></tr></thead>
              <tbody>
                {history.map((u) => (
                  <tr key={u.id} className={viewing?.upload.id === u.id ? 'selected' : ''}>
                    <td>{thaiShortDate(u.date)}</td>
                    <td>{u.round}</td>
                    <td className="num">{num(u.pieces)}</td>
                    <td className="small">{u.groups.filter((g) => g.kind !== 'review').sort((a, b) => b.pieces - a.pieces).map((g) => `${g.name} ${g.pieces}`).join(' · ')}</td>
                    <td className={`num ${u.review ? 'bad' : ''}`}>{num(u.review)}</td>
                    <td className={`num ${u.missing ? 'warn' : ''}`}>{num(u.missing ?? 0)}</td>
                    <td className="small muted">{u.saved_by.split('@')[0]}</td>
                    <td className="small">
                      <button className="link small" onClick={() => openHistory(u)}>เปิด</button>
                      {(role === 'owner' || role === 'admin') && <> · <button className="link small danger" onClick={() => removeHistory(u)}>ลบ</button></>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {printing && <PrintSheets groups={printing} date={date} round={round} />}
      {pictures && (
        <PictureModal
          group={pictures} date={date} round={round} info={productInfo} onClose={() => setPictures(null)}
          orders={data && !viewing ? orderBlocks(data.items, lookup, pictures.name, productInfo) : null}
        />
      )}
    </div>
  );
}

// ---- one supplier / warehouse ----

function GroupCard({ group: g, open, onToggle, missing, onMissing, canRemember, movable, targets, onMove, onSupplier, onExcel, onPrint, onPictures, busy }: {
  group: PurchaseGroup; open: boolean; onToggle: () => void; missing: Map<string, number>; onMissing: ((l: PurchaseLine, n: number) => Promise<void>) | null;
  canRemember: boolean; movable: boolean; targets: string[]; onMove: (sku: string, to: string) => void;
  onSupplier: (items: { tab: string; spu: string }[], shop: string) => Promise<void>; onExcel: () => void; onPrint: () => void; onPictures: () => void; busy: boolean;
}) {
  const rowsOnSheet = sheetRows(g).length;
  const products = useMemo(() => {
    const seen = new Map<string, { tab: string; spu: string }>();
    for (const l of g.lines) if (l.kind !== 'review' && l.tab && !seen.has(`${l.tab}|${spuOf(l.sku)}`)) seen.set(`${l.tab}|${spuOf(l.sku)}`, { tab: l.tab, spu: spuOf(l.sku) });
    return [...seen.values()];
  }, [g.lines]);
  const [bulk, setBulk] = useState('');
  const [setAll, setSetAll] = useState('');
  const missingHere = g.lines.reduce((n, l) => n + (missing.get(lineKey(l)) ?? 0), 0);
  /** Move a row this round; with "จำไว้ทุกวัน" also make it the product's supplier from now on. */
  const move = async (l: PurchaseLine, to: string, remember: boolean) => {
    onMove(l.sku, to);
    if (remember && to && l.kind !== 'review' && l.tab) await onSupplier([{ tab: l.tab, spu: spuOf(l.sku) }], to);
  };
  return (
    <section className={`card table-card po-group ${g.kind}`}>
      <div className="table-card-head">
        <button className="link po-group-title" onClick={onToggle} aria-expanded={open}>
          <Icon name="chevron" size={14} />
          <b>{g.name}</b>
          <span className={`pill ${g.kind === 'review' || g.kind === 'unassigned' ? 'bad' : g.kind === 'supplier' ? 'on' : ''}`}>{KIND_LABEL[g.kind]}</span>
          <span className="muted small">{num(g.pieces)} ชิ้น · {num(rowsOnSheet)} รายการ</span>
          {missingHere > 0 && <span className="pill warn">ของไม่มี {num(missingHere)}</span>}
        </button>
        {g.kind !== 'review' && (
          <div className="row-actions">
            <button className={`small ${wantsPictures(g) ? 'primary' : ''}`} onClick={onPictures} disabled={busy} title="ใบสั่งเป็นรูป: รูปสินค้า + SKU + จำนวน (แยกตามออเดอร์ได้ สำหรับโกดังจีน)">รูปภาพ</button>
            <button className="small" onClick={onPrint} disabled={busy}>พิมพ์</button>
            <button className="small" onClick={onExcel} disabled={busy}>Excel</button>
          </div>
        )}
      </div>
      {open && (
        <>
          {g.kind === 'unassigned' && (
            <p className="small muted po-hint">SKU เหล่านี้มีในแคตตาล็อกแล้ว แต่คอลัมน์ ร้านค้า (L) ในชีตยังว่าง · ตั้งร้านประจำให้ทั้งกลุ่มด้านล่าง หรือย้ายทีละรายการแล้วติ๊ก "จำไว้ทุกวัน" · หรือกรอกในชีตแล้วดึงใหม่</p>
          )}
          {g.kind === 'review' && (
            <p className="small muted po-hint">SKU ไม่มีในแคตตาล็อก หรือ Bigseller ไม่ได้ใส่ SKU · ย้ายไปร้าน/โกดังได้ในช่อง "ย้ายไป" (เลือกจากรายการหรือพิมพ์ชื่อเอง) ใช้กับรอบนี้ · ถ้าอยากให้จำไว้ทุกวัน กด "+ เพิ่มในแคตตาล็อก"</p>
          )}
          {canRemember && g.kind === 'unassigned' && products.length > 0 && (
            <div className="po-bulk">
              <span className="small">ตั้งร้านประจำให้ทั้ง {num(products.length)} รุ่น (จำไว้ทุกวัน)</span>
              <input value={setAll} onChange={(e) => setSetAll(e.target.value)} list="po-targets" placeholder="เลือกหรือพิมพ์ชื่อร้าน" aria-label="ร้านประจำสำหรับทั้งกลุ่ม" />
              <button className="small primary" disabled={!setAll.trim()} onClick={() => onSupplier(products, setAll.trim()).then(() => setSetAll(''))}>ตั้งร้าน</button>
            </div>
          )}
          {movable && g.lines.length > 1 && (
            <div className="po-bulk">
              <span className="small">ย้ายทั้ง {num(g.lines.length)} รายการไป (รอบนี้)</span>
              <input value={bulk} onChange={(e) => setBulk(e.target.value)} list="po-targets" placeholder="เลือกหรือพิมพ์ร้าน/โกดัง" aria-label="ย้ายทั้งกลุ่มไป" />
              <button className="small primary" disabled={!bulk.trim()} onClick={() => { g.lines.forEach((l) => onMove(l.sku, bulk.trim())); setBulk(''); }}>ย้าย</button>
            </div>
          )}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{g.kind === 'review' ? 'SKU ใน Bigseller' : 'รหัสสินค้า'}</th><th>ไซส์</th><th className="num">จำนวน</th>
                  <th>{g.kind === 'review' ? 'ปัญหา / ตัวเลือกสินค้า' : 'SKU'}</th><th>เลขคำสั่งซื้อ</th>
                  {g.kind !== 'review' && <th className="center">ของไม่มี</th>}
                  {movable && <th>ย้ายไป (รอบนี้)</th>}
                </tr>
              </thead>
              <tbody>
                {g.lines.map((l, i) => {
                  const product = `${l.tab}|${spuOf(l.sku)}`;
                  const firstOfProduct = g.lines.findIndex((x) => `${x.tab}|${spuOf(x.sku)}` === product) === i;
                  return (
                    <tr key={l.sku} className={`${firstOfProduct && i > 0 ? 'group-start' : ''} ${missing.get(lineKey(l)) ? 'po-missing' : ''}`}>
                      <td>{firstOfProduct || g.kind === 'review' ? <b>{l.label}</b> : <span className="muted">{l.label}</span>}</td>
                      <td>{l.size || '—'}</td>
                      <td className="num"><b>{num(l.qty)}</b></td>
                      <td className="small">
                        {g.kind === 'review' ? l.note : <>
                          <code>{l.sku.startsWith('?') ? '(ไม่มี SKU)' : l.sku}</code>
                          {l.moved && <> <span className="pill warn">ย้ายมาจาก {l.from}</span></>}
                          {!l.moved && l.note && <span className="muted"> · {l.note}</span>}
                        </>}
                      </td>
                      <td className="small"><OrderNumbers orders={l.orders} /></td>
                      {g.kind !== 'review' && <td className="center"><MissingCell qty={l.qty} value={missing.get(lineKey(l)) ?? 0} onChange={onMissing ? (n) => onMissing(l, n) : null} /></td>}
                      {movable && (
                        <td>
                          <div className="po-move">
                            <ShopInput placeholder="เลือกหรือพิมพ์" action="ย้าย" remember={canRemember && g.kind !== 'review'} onSubmit={(to, remember) => move(l, to, remember)} />
                            {l.moved && <button className="link small" onClick={() => onMove(l.sku, '')}>ย้อนกลับไป {l.from}</button>}
                            {g.kind === 'review' && !l.sku.startsWith('?') && <a className="small" href={`/catalog?q=${encodeURIComponent(l.sku)}&add=1`} target="_blank" rel="noreferrer">+ เพิ่มในแคตตาล็อก</a>}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <datalist id="po-targets">{targets.map((n) => <option key={n} value={n} />)}</datalist>
        </>
      )}
    </section>
  );
}

/** Order numbers of a line: the first two, the rest behind "+N". */
function OrderNumbers({ orders }: { orders: string[] }) {
  const [all, setAll] = useState(false);
  if (!orders?.length) return <span className="muted">—</span>;
  const shown = all ? orders : orders.slice(0, 2);
  return (
    <span className="po-orders">
      {shown.map((o) => <code key={o}>{o}</code>)}
      {orders.length > 2 && <button className="link small" onClick={() => setAll(!all)}>{all ? 'ย่อ' : `+${orders.length - 2}`}</button>}
    </span>
  );
}

/** Out of stock: a tick for the whole line; with more than one piece, how many the supplier did not have. */
function MissingCell({ qty, value, onChange }: { qty: number; value: number; onChange: ((n: number) => Promise<void>) | null }) {
  const [busy, setBusy] = useState(false);
  const set = async (n: number) => { if (!onChange) return; setBusy(true); try { await onChange(Math.max(0, Math.min(qty, n))); } finally { setBusy(false); } };
  return (
    <span className="po-missing-cell">
      <input type="checkbox" checked={value > 0} disabled={!onChange || busy} onChange={(e) => set(e.target.checked ? qty : 0)} aria-label="ของไม่มี" />
      {value > 0 && qty > 1 && (
        <select value={value} disabled={!onChange || busy} onChange={(e) => set(Number(e.target.value))} aria-label="ไม่มีกี่ชิ้น">
          {Array.from({ length: qty }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}/{qty}</option>)}
        </select>
      )}
    </span>
  );
}

/**
 * A supplier/warehouse box: pick from the list or type any name, then the button (or Enter). With `remember`, a
 * "จำไว้ทุกวัน" tick also makes it the product's supplier from now on.
 */
function ShopInput({ placeholder, action, remember = false, onSubmit }: { placeholder: string; action: string; remember?: boolean; onSubmit: (value: string, remember: boolean) => Promise<void> }) {
  const [value, setValue] = useState('');
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try { await onSubmit(value.trim(), remember && keep); setValue(''); setKeep(false); } finally { setBusy(false); }
  };
  return (
    <span className="po-shop">
      <input value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} list="po-targets" placeholder={placeholder} aria-label={placeholder} />
      <button className="small" disabled={!value.trim() || busy} onClick={submit}>{action}</button>
      {remember && <label className="po-keep" title="ตั้งเป็นร้านประจำของสินค้านี้ ใช้ทุกวันต่อจากนี้"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> จำไว้ทุกวัน</label>}
    </span>
  );
}

// ---- picture sheets (no Thai) ----

/**
 * Per order (Bigseller picking-list layout, cut into slips, one per parcel) when the uploaded file is at hand — the
 * default for CN, which packs and ships orders itself; or per product (sizes × qty), the only choice for a round
 * reopened from history since order and tracking numbers are never saved.
 */
function PictureModal({ group, date, round, info, orders, onClose }: {
  group: PurchaseGroup; date: string; round: number; info: (sku: string) => ProductInfo | undefined; orders: OrderBlock[] | null; onClose: () => void;
}) {
  const { toast } = useUi();
  const [mode, setMode] = useState<'orders' | 'products'>(orders?.length && wantsPictures(group) ? 'orders' : 'products');
  const [images, setImages] = useState<{ blob: Blob; url: string; name: string }[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    setImages(null);
    const make = mode === 'orders' && orders ? orderPictureSheets(group.name, date, round, orders) : pictureSheets(group.name, date, round, pictureBlocks(group, info));
    make.then((blobs) => {
      if (cancelled) return;
      setImages(blobs.map((blob, i) => {
        const url = URL.createObjectURL(blob);
        made.push(url);
        return { blob, url, name: `${group.name} ${dayMonth(date)} รอบ${round}${blobs.length > 1 ? ` (${i + 1}-${blobs.length})` : ''}.png` };
      }));
    }).catch((e) => setError(e.message));
    return () => { cancelled = true; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [group, date, round, info, orders, mode]);

  const files = images?.map((im) => new File([im.blob], im.name, { type: 'image/png' })) ?? [];
  const canShare = files.length > 0 && typeof navigator.canShare === 'function' && navigator.canShare({ files });
  const saveAll = () => images?.forEach((im, i) => setTimeout(() => {
    const a = document.createElement('a');
    a.href = im.url;
    a.download = im.name;
    a.click();
  }, i * 300));
  async function copy(im: { blob: Blob }) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': im.blob })]);
      toast('คัดลอกรูปแล้ว · วางใน Line/WeChat ได้เลย', 'ok');
    } catch { toast('คัดลอกรูปไม่ได้ในเบราว์เซอร์นี้ · ใช้ดาวน์โหลดแทน', 'bad'); }
  }

  return (
    <Modal title={`รูปใบสั่ง ${group.name} · ${group.pieces} ชิ้น`} onClose={onClose} wide>
      {orders && orders.length > 0 && (
        <div className="segmented" role="tablist" aria-label="รูปแบบรูป" style={{ marginBottom: 8 }}>
          <button className={mode === 'orders' ? 'on' : ''} onClick={() => setMode('orders')}>แยกตามออเดอร์ ({orders.length}) · มีเลขพัสดุ ตัดแปะกล่อง</button>
          <button className={mode === 'products' ? 'on' : ''} onClick={() => setMode('products')}>รวมตามสินค้า</button>
        </div>
      )}
      <p className="muted small">
        {mode === 'orders' && orders ? 'ออเดอร์ละบล็อกแบบใบหยิบของ Bigseller: เลขออเดอร์ · ขนส่ง + เลขพัสดุ · รูป · ชื่อสินค้า · SKU · ตัวเลือก · จำนวน · ร้าน · ทั้งหมด · เส้นตัด (เลขพัสดุใช้ในรูปนี้เท่านั้น ไม่บันทึก)'
          : 'รุ่นละบล็อก: รูป · รหัส · SKU · สี · ไซส์ × จำนวน'}
        {!orders && ' · ใบย้อนหลังไม่ได้เก็บเลขพัสดุ จึงทำได้แบบรวมตามสินค้าเท่านั้น'}
      </p>
      {error && <p className="bad">{error}</p>}
      {!images && !error && <p className="muted">กำลังสร้างรูป…</p>}
      {images && (
        <>
          <div className="row-actions" style={{ margin: '8px 0 12px' }}>
            {canShare && <button className="primary" onClick={() => navigator.share({ files, title: `${group.name} ${dayMonth(date)}` }).catch(() => {})}>แชร์ไป Line / WeChat</button>}
            <button className={canShare ? '' : 'primary'} onClick={saveAll}><Icon name="down" size={14} /> ดาวน์โหลด {images.length > 1 ? `ทั้ง ${images.length} รูป` : 'รูป'}</button>
          </div>
          <div className="po-pictures">
            {images.map((im) => (
              <figure key={im.url}>
                <img src={im.url} alt={im.name} />
                <figcaption className="small">
                  {im.name} · <a href={im.url} download={im.name}>ดาวน์โหลด</a>
                  {'ClipboardItem' in window && <> · <button className="link small" onClick={() => copy(im)}>คัดลอกรูป</button></>}
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

// ---- print: one sheet per supplier/warehouse, starting on a new page; long sheets run on with the header repeated ----

function PrintSheets({ groups, date, round }: { groups: PurchaseGroup[]; date: string; round: number }) {
  return (
    <div className="print-area">
      {groups.map((g) => {
        const showNote = g.kind === 'unassigned' || g.name === MISSING_GROUP;
        return (
          <div className="po-page" key={g.name}>
            <div className="po-page-head">
              <span>{thaiShortDate(date)}</span>
              <b>{g.name}</b>
              <span>รอบ {round}</span>
            </div>
            <table className="po-sheet">
              <colgroup><col className="c-code" /><col className="c-size" /><col className="c-qty" /><col className="c-orders" /><col className="c-note" /></colgroup>
              <thead><tr><th>รหัสสินค้า</th><th>ไซส์</th><th>จำนวน</th><th>เลขคำสั่งซื้อ</th><th>หมายเหตุ</th></tr></thead>
              <tbody>
                {sheetRows(g).map((r, ri) => (
                  <tr key={ri} className={r.band % 2 === 0 ? 'shade' : ''}>
                    <td>{r.label}</td><td>{r.size}</td><td>{r.qty}</td>
                    <td className="orders">{r.orders.map((o) => <div key={o}>{o}</div>)}</td>
                    <td>{showNote ? r.note : ''}</td>
                  </tr>
                ))}
                <tr className="total"><td>รวม</td><td /><td>{g.pieces}</td><td /><td /></tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

