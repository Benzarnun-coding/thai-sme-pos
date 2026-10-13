// /catalog/orders — Bigseller's daily "Order-SKU-inprocess" export (.xlsx or .csv) → order sheets per supplier (BB …) or warehouse
// (PK, CM …), checked on screen, downloaded as Excel or printed like the team's hand-made sheets. The file is read
// in the browser; only the resulting lines (SKU, quantity, supplier) are saved as history, no order numbers.
// Who supplies a product can be changed right here; it is saved for that product and used every day after.

import { useEffect, useMemo, useState } from 'react';
import { api, type PurchaseUpload, type SavedPurchaseLine } from './api.ts';
import { SHOP_STATUSES, skuKey, spuOf, thumb, webToRow, type CatalogRow } from './catalog.ts';
import { num } from './fmt.ts';
import {
  buildLines, dateFromFileName, dayMonth, groupLines, KIND_LABEL, makeLookup, missingOrderColumns, orderWorkbook, readOrderItems,
  orderBlocks, pictureBlocks, sheetRows, thaiShortDate, wantsPictures, type OrderBlock, type OrderItem, type ProductInfo, type PurchaseGroup, type PurchaseLine,
} from './purchase.ts';
import { orderPictureSheets, pictureSheets } from './pictureSheet.ts';
import { Icon, Modal, useUi } from './ui.tsx';
import { useCatalog } from './useCatalog.ts';
import { readFirstSheet } from './xlsx.ts';
import { parseExport } from './gosell.ts';

const ROWS_PER_COLUMN = 32;

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
  return { group: l.grp, kind: l.kind, sku: l.sku, tab: l.tab, product: '', label: l.label, size: l.size, qty: l.qty, note: l.note };
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
  const lines = useMemo(() => (viewing ? viewing.lines : data ? buildLines(data.items, lookup) : []), [viewing, data, lookup]);
  const groups = useMemo(() => groupLines(lines), [lines]);
  const pieces = groups.reduce((n, g) => n + g.pieces, 0);
  const review = groups.find((g) => g.kind === 'review');
  const sig = JSON.stringify([date, round, lines.map((l) => [l.group, l.sku, l.qty])]);
  const supplierNames = useMemo(() => {
    const names = new Set<string>();
    for (const r of rows) if (r.shop && !SHOP_STATUSES.has(r.shop)) names.add(r.shop);
    for (const v of supplierMap.values()) names.add(v);
    return [...names].sort((a, b) => a.localeCompare(b, 'th'));
  }, [rows, supplierMap]);

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
      const d = dateFromFileName(file.name) ?? todayBkk();
      setViewing(null);
      setData({ file: file.name, items });
      setDate(d);
      setRound(nextRound(d));
      setSavedSig('');
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }

  /** History is what was downloaded or printed; saving the same day + round again replaces it. */
  async function save(): Promise<boolean> {
    if (viewing || !data || sig === savedSig || !canEdit) return true;
    try {
      const { upload } = await api.savePurchase({ date, round, file: data.file, lines: lines.map((l) => ({ ...l })) });
      setHistory((h) => [upload, ...h.filter((x) => x.id !== upload.id)].sort((a, b) => b.date.localeCompare(a.date) || b.round - a.round));
      setSavedSig(sig);
      return true;
    } catch (e: any) { toast(`บันทึกประวัติไม่ได้: ${e.message}`, 'bad'); return false; }
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

  async function openHistory(u: PurchaseUpload) {
    setBusy('กำลังเปิด…');
    try {
      const { lines: saved } = await api.purchaseLines(u.id);
      setViewing({ upload: u, lines: saved.map(fromSaved) });
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
                : data ? `${data.file} · อ่านในเบราว์เซอร์นี้ เก็บเฉพาะ SKU กับจำนวน` : 'Export "Order-SKU-inprocess" (.xlsx หรือ .csv) จาก Bigseller แล้วอัปโหลดที่นี่ วันละรอบหรือหลายรอบ'}
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

          {groups.map((g) => (
            <GroupCard
              key={g.name} group={g} open={open.has(g.name)} onToggle={() => toggle(g.name)}
              editable={canEdit && !viewing} supplierNames={supplierNames}
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
              <thead><tr><th>วันที่</th><th>รอบ</th><th className="num">ชิ้น</th><th>ร้าน / โกดัง</th><th className="num">ตรวจสอบ</th><th>บันทึกโดย</th><th /></tr></thead>
              <tbody>
                {history.map((u) => (
                  <tr key={u.id} className={viewing?.upload.id === u.id ? 'selected' : ''}>
                    <td>{thaiShortDate(u.date)}</td>
                    <td>{u.round}</td>
                    <td className="num">{num(u.pieces)}</td>
                    <td className="small">{u.groups.filter((g) => g.kind !== 'review').sort((a, b) => b.pieces - a.pieces).map((g) => `${g.name} ${g.pieces}`).join(' · ')}</td>
                    <td className={`num ${u.review ? 'bad' : ''}`}>{num(u.review)}</td>
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

function GroupCard({ group: g, open, onToggle, editable, supplierNames, onSupplier, onExcel, onPrint, onPictures, busy }: {
  group: PurchaseGroup; open: boolean; onToggle: () => void; editable: boolean; supplierNames: string[];
  onSupplier: (items: { tab: string; spu: string }[], shop: string) => Promise<void>; onExcel: () => void; onPrint: () => void; onPictures: () => void; busy: boolean;
}) {
  const rowsOnSheet = sheetRows(g).length;
  const products = useMemo(() => {
    const seen = new Map<string, { tab: string; spu: string }>();
    for (const l of g.lines) if (l.product && !seen.has(l.product)) seen.set(l.product, { tab: l.tab, spu: l.product.split('|')[1] });
    return [...seen.values()];
  }, [g.lines]);
  const [bulk, setBulk] = useState('');
  return (
    <section className={`card table-card po-group ${g.kind}`}>
      <div className="table-card-head">
        <button className="link po-group-title" onClick={onToggle} aria-expanded={open}>
          <Icon name="chevron" size={14} />
          <b>{g.name}</b>
          <span className={`pill ${g.kind === 'review' || g.kind === 'unassigned' ? 'bad' : g.kind === 'supplier' ? 'on' : ''}`}>{KIND_LABEL[g.kind]}</span>
          <span className="muted small">{num(g.pieces)} ชิ้น · {num(rowsOnSheet)} รายการ</span>
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
            <p className="small muted po-hint">SKU เหล่านี้มีในแคตตาล็อกแล้ว แต่คอลัมน์ ร้านค้า (L) ในชีตยังว่าง จึงยังไม่รู้ว่าจะสั่งร้านไหน · เลือกร้านในช่อง "สั่งจาก" (จำไว้ใช้วันต่อไป) หรือกรอกในชีตแล้วดึงใหม่</p>
          )}
          {editable && g.kind === 'unassigned' && products.length > 0 && (
            <div className="po-bulk">
              <span className="small">ตั้งร้านให้ทั้ง {num(products.length)} รุ่นในกลุ่มนี้</span>
              <input value={bulk} onChange={(e) => setBulk(e.target.value)} list="po-supplier-names" placeholder="ชื่อร้าน" aria-label="ร้านสำหรับทั้งกลุ่ม" />
              <button className="small primary" disabled={!bulk.trim()} onClick={() => onSupplier(products, bulk.trim()).then(() => setBulk(''))}>ตั้งร้าน</button>
            </div>
          )}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{g.kind === 'review' ? 'SKU ใน Bigseller' : 'รหัสสินค้า'}</th><th>ไซส์</th><th className="num">จำนวน</th>
                  <th>{g.kind === 'review' ? 'ปัญหา / ตัวเลือกสินค้า' : 'SKU'}</th>{editable && g.kind !== 'review' && <th>สั่งจาก</th>}{g.kind === 'review' && <th />}
                </tr>
              </thead>
              <tbody>
                {g.lines.map((l, i) => {
                  const firstOfProduct = l.product && g.lines.findIndex((x) => x.product === l.product) === i;
                  return (
                    <tr key={l.sku} className={firstOfProduct && i > 0 ? 'group-start' : ''}>
                      <td>{firstOfProduct || g.kind === 'review' ? <b>{l.label}</b> : <span className="muted">{l.label}</span>}</td>
                      <td>{l.size || '—'}</td>
                      <td className="num"><b>{num(l.qty)}</b></td>
                      <td className="small">{g.kind === 'review' ? l.note : <><code>{l.sku}</code>{l.note && <span className="muted"> · {l.note}</span>}</>}</td>
                      {editable && g.kind !== 'review' && (
                        <td>{firstOfProduct && <SupplierSelect current={g.kind === 'supplier' ? g.name : ''} names={supplierNames} onPick={(shop) => onSupplier([{ tab: l.tab, spu: l.product.split('|')[1] }], shop)} />}</td>
                      )}
                      {g.kind === 'review' && (
                        <td>{!l.sku.startsWith('?') && <a className="small" href={`/catalog?q=${encodeURIComponent(l.sku)}&add=1`} target="_blank" rel="noreferrer">+ เพิ่มในแคตตาล็อก</a>}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <datalist id="po-supplier-names">{supplierNames.map((n) => <option key={n} value={n} />)}</datalist>
        </>
      )}
    </section>
  );
}

/** Moves the whole product (every size) to another supplier, for today and the days after. */
function SupplierSelect({ current, names, onPick }: { current: string; names: string[]; onPick: (shop: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <select
      className="po-supplier" value={current} disabled={busy} aria-label="สั่งจากร้าน"
      onChange={async (e) => { setBusy(true); try { await onPick(e.target.value); } finally { setBusy(false); } }}
    >
      <option value="">{current ? 'ตามชีต / โกดัง' : '— ตามชีต / โกดัง —'}</option>
      {names.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
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
        {mode === 'orders' && orders ? 'ออเดอร์ละบล็อกแบบใบหยิบของ Bigseller: เลขออเดอร์ · ขนส่ง + เลขพัสดุ · รูป · ชื่อสินค้า · SKU · ตัวเลือก · จำนวน · ร้าน · ทั้งหมด · เส้นตัด (เลขออเดอร์/พัสดุใช้ในรูปนี้เท่านั้น ไม่บันทึก)'
          : 'รุ่นละบล็อก: รูป · รหัส · SKU · สี · ไซส์ × จำนวน'}
        {!orders && ' · ใบย้อนหลังไม่มีเลขออเดอร์ จึงทำได้แบบรวมตามสินค้าเท่านั้น'}
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

// ---- print: one A4 page per sheet, two columns like the hand-made ones ----

function PrintSheets({ groups, date, round }: { groups: PurchaseGroup[]; date: string; round: number }) {
  const pages: { g: PurchaseGroup; cols: ReturnType<typeof sheetRows>[]; last: boolean }[] = [];
  for (const g of groups) {
    const rows = sheetRows(g);
    const perPage = ROWS_PER_COLUMN * 2;
    for (let i = 0; i < Math.max(rows.length, 1); i += perPage) {
      const chunk = rows.slice(i, i + perPage);
      pages.push({ g, cols: [chunk.slice(0, ROWS_PER_COLUMN), chunk.slice(ROWS_PER_COLUMN)], last: i + perPage >= rows.length });
    }
  }
  return (
    <div className="print-area">
      {pages.map((p, pi) => (
        <div className="po-page" key={pi}>
          <div className="po-page-head">
            <span>{thaiShortDate(date)}</span>
            <b>{p.g.name}</b>
            <span>รอบ {round}</span>
          </div>
          <div className="po-page-cols">
            {p.cols.map((col, ci) => (
              <table key={ci} className="po-sheet">
                <thead><tr><th>รหัสสินค้า</th><th>ไซส์</th><th>จำนวน</th><th>หมายเหตุ</th></tr></thead>
                <tbody>
                  {col.map((r, ri) => (
                    <tr key={ri} className={r.band % 2 === 0 ? 'shade' : ''}><td>{r.label}</td><td>{r.size}</td><td>{r.qty}</td><td>{p.g.kind === 'unassigned' ? r.note : ''}</td></tr>
                  ))}
                  {p.last && ci === (p.cols[1].length ? 1 : 0) && <tr className="total"><td>รวม</td><td /><td>{p.g.pieces}</td><td /></tr>}
                </tbody>
              </table>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

