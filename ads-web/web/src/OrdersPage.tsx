// /catalog/orders — Bigseller's daily "Order-SKU-inprocess" export (.xlsx or .csv) → order sheets per supplier (BB …) or warehouse
// (PK, CM …), checked on screen, downloaded as Excel or printed like the team's hand-made sheets. The file is read
// in the browser; only the resulting lines (SKU, quantity, supplier) are saved as history, no order numbers.
// Who supplies a product can be changed right here; it is saved for that product and used every day after.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, type CatalogAlias, type FoundOrder, type LedgerRow, type PurchaseUpload, type PurchaseExtra, type SavedPurchaseLine, type StockData } from './api.ts';
import { SkuMatch } from './SkuMatch.tsx';
import { SHOP_STATUSES, skuKey, spuOf, thumb, webToRow, type CatalogRow } from './catalog.ts';
import { num } from './fmt.ts';
import {
  applyMoves, buildLines, dateFromFileName, optionParts, saleItems, orderColumns, orderText, paymentWorkbook, PRICE_SOURCE_LABEL, supplierTotals, withPrices, lineKey, MISSING_GROUP, missingGroup, dayMonth, groupLines, KIND_LABEL, makeLookup, missingOrderColumns, orderWorkbook, readOrderItems,
  FB_ROUND, roundFile, roundLabel, FACEBOOK_STORE, GOSELL_GROUP, isFacebookExport, MANUAL_STORE, readFacebookItems, suggestSkus, remapLines, STOCK_GROUP, stockPlacer, orderBlocks, pictureBlocks, sheetRows, thaiShortDate, wantsPictures, type OrderBlock, type OrderItem, type ProductInfo, type PurchaseGroup, type PurchaseLine,
} from './purchase.ts';
import { orderPictureSheets, pictureSheets } from './pictureSheet.ts';
import { Icon, Modal, useUi } from './ui.tsx';
import { useCatalog } from './useCatalog.ts';
import { readFirstSheet } from './xlsx.ts';
import { parseExport } from './gosell.ts';
import { HomeLogo, SiteNav } from './SiteNav.tsx';


interface Loaded { file: string; items: OrderItem[] }

/** Saved Facebook / typed items → order items (and back). */
const fromExtra = (x: PurchaseExtra): OrderItem => ({ store: x.source === 'manual' ? MANUAL_STORE : FACEBOOK_STORE, sku: x.sku, name: x.name, option: x.option, qty: x.qty, order: x.order, tracking: '', carrier: '' });
const toExtra = (it: OrderItem): PurchaseExtra => ({ source: it.store === MANUAL_STORE ? 'manual' : 'facebook', order: it.order, sku: it.sku, name: it.name, option: it.option, qty: it.qty });
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
  return { group: l.grp, kind: l.kind, sku: l.sku, tab: l.tab, product: '', label: l.label, size: l.size, qty: l.qty, note: l.note, orders: l.orders ?? [], stores: l.stores ?? {}, missing: l.missing };
}

export function OrdersApp() {
  useEffect(() => { document.title = 'ใบสั่งสินค้า'; }, []);
  const { toast, confirm } = useUi();
  const { meta, setMeta, rows, loading, error, canEdit, role, supplierMap, imageMap, priceMap, labelMap, aliasMap, aliasForce } = useCatalog();
  const [data, setData] = useState<Loaded | null>(null);
  // Facebook orders (Page365's per-item export) and lines typed by hand, on the same round as the Bigseller file.
  const [fb, setFb] = useState<Loaded | null>(null);
  const [manual, setManual] = useState<OrderItem[]>([]);
  const allItems = useMemo(() => [...(data?.items ?? []), ...(fb?.items ?? []), ...manual], [data, fb, manual]);
  const [history, setHistory] = useState<PurchaseUpload[]>([]);
  const [viewing, setViewing] = useState<FromHistory | null>(null);
  const [date, setDate] = useState(todayBkk());
  const [round, setRound] = useState(1);
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [printing, setPrinting] = useState<PurchaseGroup[] | null>(null);
  const [savedSig, setSavedSig] = useState('');
  const [pictures, setPictures] = useState<PurchaseGroup | null>(null);
  // Rows found by the order-number search: `${group}\u0000${sku}`, highlighted and scrolled to.
  const [found, setFound] = useState<Set<string>>(new Set());
  // ตรวจสอบ rows moved by hand this round: Bigseller SKU (or "?name · option") → supplier/warehouse
  const [moves, setMoves] = useState<Map<string, string>>(new Map());
  // Out of stock, as ticked on the page after the supplier answered: lineKey → pieces. Saved to D1 on every tick.
  const [missing, setMissingMap] = useState<Map<string, number>>(new Map());
  const moveLine = (sku: string, to: string) => setMoves((m) => { const n = new Map(m); if (to.trim()) n.set(sku, to.trim()); else n.delete(sku); return n; });

  useEffect(() => { api.purchases().then((r) => setHistory(r.uploads)).catch(() => {}); }, []);
  // Owed vs paid per round and supplier, last 60 days (from the rounds as saved + payments recorded).
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const loadLedger = () => api.ledger(60).then((r) => setLedgerRows(r.rows)).catch(() => {});
  useEffect(() => { loadLedger(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sheet rows + SKUs added on the page, so a SKU added this morning already lands on the right sheet.
  const allRows = useMemo<CatalogRow[]>(() => [...rows, ...(meta?.web ?? []).map((w) => webToRow(w, 0))], [rows, meta?.web]);
  const lookup = useMemo(() => makeLookup(allRows, supplierMap, priceMap, labelMap, aliasMap, aliasForce), [allRows, supplierMap, priceMap, labelMap, aliasMap, aliasForce]);
  // Our own codes (the PK tab): code → size → SKU, for "รหัสของเรา" when a row's name is edited.
  const ours = useMemo(() => {
    const m = new Map<string, Map<string, string>>();
    for (const r of allRows) {
      if (r.tab !== 'PK' || !r.code) continue;
      const x = m.get(r.code) ?? new Map<string, string>();
      x.set(r.size, r.sku);
      m.set(r.code, x);
    }
    return new Map([...m].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
  }, [allRows]);
  /** Reads `from` as our `to` from now on (every page, every day), so the two rows add up. */
  async function replaceSku(from: string, to: string) {
    try {
      const { alias } = await api.setAlias(from, to, true);
      if (alias) setMeta((m) => (m ? { ...m, aliases: [alias, ...m.aliases.filter((x) => x.alias !== alias.alias)] } : m));
      toast(`${from} → ${to} · รวมกับบรรทัดของเราแล้ว จำไว้ใช้ทุกวัน${viewing ? ' (ใบย้อนหลังที่เปิดอยู่จะรวมเมื่ออัปโหลดไฟล์เดิมอีกครั้ง)' : ''}`, 'ok');
    } catch (e: any) { toast(e.message, 'bad'); }
  }
  async function unmerge(from: string) {
    try {
      await api.setAlias(from, '');
      setMeta((m) => (m ? { ...m, aliases: m.aliases.filter((x) => x.alias !== skuKey(from)) } : m));
      toast(`${from} แยกกลับเป็นบรรทัดของตัวเองแล้ว`, 'ok');
    } catch (e: any) { toast(e.message, 'bad'); }
  }
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
  // Our own stock at พี่เปีย's BB branch: its products go to the "พี่เปีย" sheet while the balance lasts (cut when the
  // round is saved), from the day after the starting balance. /catalog/stock shows and corrects it.
  const [stock, setStock] = useState<StockData | null>(null);
  const loadStock = () => api.stock().then(setStock).catch(() => {});
  useEffect(() => { loadStock(); }, []);
  const newPlacer = useMemo(() => {
    const skus = new Set((stock?.items ?? []).filter((i) => i.locs.includes('pia')).map((i) => i.sku));
    const gsSkus = new Set((stock?.items ?? []).filter((i) => i.locs.includes('gosell')).map((i) => i.sku));
    const link = new Map((stock?.links ?? []).filter((k) => k.loc === 'pia').map((k) => [k.sku, k.stock_sku]));
    const balance = new Map((stock?.balances ?? []).filter((b) => b.loc === 'pia').map((b) => [b.sku, b.qty]));
    const cut = new Set((stock?.cut ?? []).filter((c) => c.loc === 'pia').map((c) => `${c.order_no}|${c.sku}`));
    const active = !!stock?.start.pia && date > stock.start.pia;
    // Facebook orders of products in GoSell's stock go to the GoSell sheet (GoSell ships them; its stock is cut by the
    // button on the GoSell page, not here); typed lines stay on their usual sheet.
    const gsBalance = new Map((stock?.balances ?? []).filter((b) => b.loc === 'gosell').map((b) => [b.sku, b.qty]));
    return () => {
      const pia = stockPlacer({ skus, balance, cut, active, link });
      const gs = stockPlacer({ skus: gsSkus, balance: gsBalance, cut: new Set(), active: !!stock?.start.gosell, group: GOSELL_GROUP });
      return {
        place: (it: OrderItem, r: CatalogRow) => (it.store === FACEBOOK_STORE ? gs.place(it, r) : it.store === MANUAL_STORE ? null : pia.place(it, r)),
        short: pia.short, gsShort: gs.short,
      };
    };
  }, [stock, date]);
  const warehouses = useMemo(() => new Set([...(meta?.tabs ?? []).map((t) => t.tab), ...(stock?.items.length ? [STOCK_GROUP, GOSELL_GROUP] : [])]), [meta?.tabs, stock?.items.length]);
  // Moves (out of stock → another supplier, ตรวจสอบ rows …) apply to a new upload and to a round reopened from history.
  const built = useMemo(() => {
    if (viewing || !data) return null;
    const p = newPlacer();
    return { lines: buildLines(allItems, lookup, p.place), short: p.short, gsShort: p.gsShort };
  }, [viewing, data, allItems, lookup, newPlacer]);
  // A round opened from history is read through today's matches too, so "รหัสของเรา" merges its rows at once.
  const baseLines = useMemo(() => (viewing ? remapLines(viewing.lines, lookup) : built?.lines ?? []), [viewing, built, lookup]);
  const shortList = (m: Map<string, number> | undefined) => [...(m ?? new Map<string, number>())].map(([sku, n]) => {
    const it = stock?.items.find((i) => i.sku === sku);
    return { sku, n, name: it ? `${it.code} #${it.size}` : sku };
  });
  const stockShort = useMemo(() => shortList(built?.short), [built, stock]); // eslint-disable-line react-hooks/exhaustive-deps
  const gosellShort = useMemo(() => shortList(built?.gsShort), [built, stock]); // eslint-disable-line react-hooks/exhaustive-deps
  // Price per piece is always the current one (typed on the page > ทุน H); it is stored with the round when saved.
  // Names typed for rows that are not in the catalog (ตรวจสอบ) apply to this round only: Bigseller SKU → name.
  const [labelEdits, setLabelEdits] = useState<Map<string, string>>(new Map());
  const lines = useMemo(() => withPrices(applyMoves(baseLines, moves, warehouses, lookup), lookup)
    .map((l) => (labelEdits.get(l.sku) ? { ...l, label: labelEdits.get(l.sku)! } : l)), [baseLines, moves, warehouses, lookup, labelEdits]);
  const groups = useMemo(() => groupLines(lines), [lines]);
  const pieces = groups.reduce((n, g) => n + g.pieces, 0);
  const pia = useMemo(() => missingGroup(lines, missing, lookup), [lines, missing, lookup]);
  const review = groups.find((g) => g.kind === 'review');
  const sig = JSON.stringify([date, round, lines.map((l) => [l.group, l.sku, l.qty, l.price ?? null])]);
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
      else throw new Error('เลือกไฟล์ .xlsx หรือ .csv ที่ export จาก Bigseller (Order-SKU-inprocess…) หรือ Page365');
      if (isFacebookExport(headers)) {
        // Facebook orders join the round on screen (or start one); the Bigseller file can come before or after.
        const items = readFacebookItems(raw);
        if (!items.length) throw new Error('ไม่พบรายการสินค้าในไฟล์ Page365');
        setViewing(null);
        setFb({ file: file.name, items });
        if (!data) {
          // On its own a Facebook file is the day's "รอบ Facebook" (the same file again reopens that round).
          const same = history.find((h) => h.file === file.name);
          setData({ file: file.name, items: [] });
          setDate(same?.date ?? todayBkk());
          setRound(same ? same.round : FB_ROUND);
          setSavedSig('');
          if (same) {
            const { extra } = await api.purchaseLines(same.id);
            setManual((extra ?? []).filter((x) => x.source === 'manual').map(fromExtra));
          }
        }
        toast(`เพิ่มออเดอร์ Facebook ${num(new Set(items.map((i) => i.order)).size)} ออเดอร์ · ${num(items.reduce((t, i) => t + i.qty, 0))} ตัว`, 'ok');
        return;
      }
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
      setLabelEdits(new Map());
      setData({ file: file.name, items });
      if (same) { setFb(null); setManual([]); }
      setDate(d);
      setRound(same ? same.round : nextRound(d));
      setSavedSig('');
      if (same) {
        // Bring back what was done on that round: rows moved by hand, and the out-of-stock ticks.
        const { lines: saved, extra } = await api.purchaseLines(same.id);
        // Facebook orders and typed lines saved with that round come back too.
        const fbItems = (extra ?? []).filter((x) => x.source === 'facebook').map(fromExtra);
        const typed = (extra ?? []).filter((x) => x.source === 'manual').map(fromExtra);
        setFb(fbItems.length ? { file: 'ที่บันทึกไว้กับรอบนี้', items: fbItems } : null);
        setManual(typed);
        // A move is keyed by SKU, so only a SKU that sits in one group both now and as saved can be moved back; a SKU
        // split over groups (e.g. พี่เปีย for TikTok, GoSell for Facebook, PK for the rest) is left as the page puts it.
        const groupsOf = (list: { sku: string; group: string }[]) => {
          const m = new Map<string, Set<string>>();
          for (const l of list) m.set(l.sku, (m.get(l.sku) ?? new Set()).add(l.group));
          return m;
        };
        const fresh = groupsOf(buildLines([...items, ...fbItems, ...typed], lookup, newPlacer().place));
        const was = groupsOf(saved.map((l) => ({ sku: l.sku, group: l.grp })));
        setMoves(new Map([...was].filter(([sku, g]) => g.size === 1 && fresh.get(sku)?.size === 1 && !fresh.get(sku)!.has([...g][0])).map(([sku, g]) => [sku, [...g][0]])));
        // names typed for rows not in the catalog (catalog products get theirs from catalog_labels)
        setLabelEdits(new Map(saved.filter((l) => !l.tab && l.label && l.label !== '(ไม่มี SKU)' && l.label !== l.sku && !l.label.startsWith(spuOf(l.sku))).map((l) => [l.sku, l.label])));
        setMissingMap(new Map(saved.filter((l) => l.missing > 0).map((l) => [lineKey({ sku: l.sku }), l.missing])));
        toast(`ไฟล์นี้เคยบันทึกเป็น ${thaiShortDate(same.date)} ${roundLabel(same.round)} · เปิดรอบเดิมพร้อมการย้ายร้านและติ๊กของไม่มี · ดาวน์โหลด/พิมพ์/ติ๊ก จะอัปเดตรอบนี้ (เติมเลขคำสั่งซื้อ)`, 'info');
      }
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }

  /** History is what was downloaded or printed; saving the same day + round again replaces it. */
  async function save(): Promise<boolean> {
    if ((!viewing && !data) || sig === savedSig || !canEdit) return true;
    try {
      const file = viewing ? viewing.upload.file : data!.file;
      // Saved from a file: also its order rows, for the units-sold page (a reopened round keeps the ones it has).
      const items = !viewing && data ? saleItems(data.items, lookup, `${date}#${round}`) : undefined;
      // Facebook / typed items are kept with the round (not as sales: Facebook units come from the Page365 upload).
      const extra = !viewing && data ? [...(fb?.items ?? []), ...manual].map(toExtra) : undefined;
      const { upload } = await api.savePurchase({ date, round, file, lines: lines.map((l) => ({ ...l })), items, extra });
      setHistory((h) => [upload, ...h.filter((x) => x.id !== upload.id)].sort((a, b) => b.date.localeCompare(a.date) || b.round - a.round));
      setSavedSig(sig);
      loadStock();
      loadLedger();
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
      loadStock();
      setHistory((h) => h.map((u) => (u.id === id ? { ...u, missing: total } : u)));
    } catch (e: any) { setMissingMap(before); toast(e.message, 'bad'); }
  }

  async function exportExcel(only?: PurchaseGroup) {
    setBusy('กำลังสร้างไฟล์…');
    try {
      await save();
      const list = only ? [only] : groups;
      download(await orderWorkbook(list, date, round), `${only ? only.name : 'ใบสั่ง'} ${dayMonth(date)} ${roundFile(round)}.xlsx`);
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

  /**
   * What the sheets call a row. A catalog product: remembered for every size and every day (empty = back to code +
   * colour). A row not in the catalog: this round only.
   */
  async function setLabel(l: PurchaseLine, text: string, onlySize = false) {
    const name = text.trim();
    if (!l.tab || l.sku.startsWith('?')) {
      setLabelEdits((m) => { const n = new Map(m); if (name) n.set(l.sku, name); else n.delete(l.sku); return n; });
      return;
    }
    const spu = spuOf(l.sku);
    // one size: stored under its own SKU; every size: under the product, and sizes named on their own are cleared
    const own = (meta?.labels ?? []).filter((x) => x.tab === l.tab && x.spu !== spu && spuOf(x.spu) === spu).map((x) => x.spu);
    const items = onlySize ? [{ tab: l.tab, spu: l.sku, label: name }] : [{ tab: l.tab, spu, label: name }, ...own.map((o) => ({ tab: l.tab, spu: o, label: '' }))];
    const gone = new Set(items.filter((i) => !i.label).map((i) => `${i.tab}|${i.spu}`));
    try {
      await api.setLabels(items);
      const now = new Date().toISOString();
      setMeta((m) => (m ? { ...m, labels: [...m.labels.filter((x) => !gone.has(x.key) && !(items.length && x.key === `${items[0].tab}|${items[0].spu}`)), ...(name ? [{ key: `${l.tab}|${items[0].spu}`, tab: l.tab, spu: items[0].spu, label: name, updated_by: '', updated_at: now }] : [])] } : m));
      toast(name ? `เปลี่ยนชื่อในใบสั่งเป็น "${name}" · ${onlySize ? `เฉพาะไซส์ ${l.size}` : 'ทุกไซส์'} ใช้ทุกวัน` : 'กลับไปใช้รหัส + สีจากแคตตาล็อก', 'ok');
    } catch (e: any) { toast(e.message, 'bad'); }
  }

  /** Cost per piece for a product (every size), remembered; empty = back to ทุน (H) from the sheet. */
  async function setPrice(l: PurchaseLine, price: number | null) {
    if (!l.tab || l.sku.startsWith('?')) return;
    const spu = spuOf(l.sku), key = `${l.tab}|${spu}`;
    // A cost typed here is for every size: per-size costs set in the catalog's product view are cleared, or they would win.
    const sizes = (meta?.prices ?? []).filter((p) => p.tab === l.tab && p.key !== key && spuOf(p.spu) === spu);
    try {
      await api.setPrices([{ tab: l.tab, spu, price }, ...sizes.map((p) => ({ tab: p.tab, spu: p.spu, price: null }))]);
      const now = new Date().toISOString();
      const gone = new Set([key, ...sizes.map((p) => p.key)]);
      setMeta((m) => (m ? { ...m, prices: [...m.prices.filter((p) => !gone.has(p.key)), ...(price === null ? [] : [{ key, tab: l.tab, spu, price, updated_by: '', updated_at: now }])] } : m));
      toast(price === null ? `${l.label} กลับไปใช้ทุนจากชีต (H)` : `${l.label} ทุน ${num(price)} บาท/ตัว · จำไว้ใช้ทุกวัน`, 'ok');
    } catch (e: any) { toast(e.message, 'bad'); }
  }

  /** Record what was paid to a supplier for this round (saved at once; the round is saved first if needed). */
  async function recordPayment(grp: string, v: { paid: number | null; done: boolean; note: string }) {
    if (!canEdit) return;
    const id = viewing ? viewing.upload.id : `${date}#${round}`;
    if (!viewing && !(await save())) return;
    try {
      await api.savePayments(id, [{ grp, ...v }]);
      setLedgerRows((rows) => {
        const i = rows.findIndex((r) => r.upload_id === id && r.grp === grp);
        const base: LedgerRow = i >= 0 ? rows[i] : { upload_id: id, date, round, grp, kind: 'supplier', due: 0, unpriced: 0, paid: null, done: false, note: '', updated_by: null, updated_at: null };
        const next = { ...base, ...v, updated_at: new Date().toISOString() };
        return i >= 0 ? rows.map((r, j) => (j === i ? next : r)) : [next, ...rows];
      });
      loadLedger();
    } catch (e: any) { toast(e.message, 'bad'); }
  }

  async function exportPayments() {
    setBusy('กำลังสร้างไฟล์…');
    try {
      await save();
      download(await paymentWorkbook(pia ? [...groups, pia] : groups, missing, date, round), `สรุปจ่ายร้าน ${dayMonth(date)} ${roundFile(round)} (ภายใน).xlsx`);
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }

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
      setLabelEdits(new Map());
      setMissingMap(new Map(saved.filter((l) => l.missing > 0).map((l) => [lineKey({ sku: l.sku }), l.missing])));
      setData(null);
      setFb(null);
      setManual([]);
      setDate(u.date);
      setRound(u.round);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }

  async function removeHistory(u: PurchaseUpload) {
    const ok = await confirm({ title: `ลบใบสั่ง ${thaiShortDate(u.date)} ${roundLabel(u.round)}?`, body: <p>ลบเฉพาะประวัติในเว็บ ไฟล์ที่ดาวน์โหลดไปแล้วไม่หาย</p>, confirmLabel: 'ลบ', tone: 'danger' });
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
      <SiteNav current="/catalog/orders" />
      <header className="top">
        <div className="brand">
          <HomeLogo text="PO" />
          <div>
            <h1>ใบสั่งสินค้า</h1>
            <p className="muted small clip">{loading ? `กำลังโหลดแคตตาล็อก ${loading.of ? `${num(loading.done)} / ${num(loading.of)}` : '…'}` : `ไฟล์ Bigseller → ใบสั่งแยกตามร้านค้า / โกดัง · แคตตาล็อก ${num(rows.length)} SKU`}</p>
          </div>
        </div>
      </header>

      {error && <div className="card bad">{error}</div>}
      {ready && !meta?.tabs.length && <div className="card">ยังไม่มีข้อมูลแคตตาล็อก · เปิด <a href="/catalog">แคตตาล็อก</a> แล้วกด "ดึงจากชีต" ก่อน</div>}

      <section className="card">
        <div className="table-card-head" style={{ padding: 0 }}>
          <div>
            <h2>{viewing ? `ใบสั่งย้อนหลัง ${thaiShortDate(viewing.upload.date)} ${roundLabel(viewing.upload.round)}` : 'ไฟล์ออเดอร์ (Bigseller / Facebook)'}</h2>
            <p className="muted small">
              {viewing ? `บันทึกโดย ${viewing.upload.saved_by.split('@')[0]} · ไฟล์ ${viewing.upload.file || '—'}`
                : data ? `${data.file} · อ่านในเบราว์เซอร์นี้ เก็บ SKU จำนวน และเลขคำสั่งซื้อ (ไม่เก็บเลขพัสดุ)` : 'Export "Order-SKU-inprocess" (.xlsx หรือ .csv) จาก Bigseller แล้วอัปโหลดที่นี่ วันละรอบหรือหลายรอบ · ออเดอร์ Facebook (ไฟล์ export ของ Page365) และรายการที่พิมพ์เองเพิ่มได้ด้านล่าง'}
            </p>
          </div>
          <label className={`button ${busy || !ready ? 'disabled' : 'primary'}`}>
            <Icon name="up" size={14} /> {busy || (shown ? 'เลือกไฟล์ใหม่' : 'เลือกไฟล์ Bigseller')}
            <input type="file" accept=".xlsx,.csv,.tsv,.txt" hidden disabled={!!busy || !ready} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
          </label>
        </div>
        {/* Always there (before any file too): Facebook orders and typed lines can start a round on their own. */}
        {!viewing && (
          <Sources
            bigseller={data?.items.length ? { file: data.file, pieces: data.items.reduce((t, i) => t + i.qty, 0) } : null}
            fb={fb ? { file: fb.file, orders: new Set(fb.items.map((i) => i.order)).size, pieces: fb.items.reduce((t, i) => t + i.qty, 0) } : null}
            manual={manual} rows={allRows} busy={!!busy || !ready}
            onFile={onFile} onRemoveFb={() => setFb(null)}
            onAdd={(it) => {
              if (!data) {
                // A typed line before any file starts today's next round.
                setData({ file: 'เพิ่มเอง', items: [] });
                setDate(todayBkk());
                setRound(nextRound(todayBkk()));
                setSavedSig('');
              }
              setManual((m) => [...m, it]);
            }}
            onRemoveManual={(i) => setManual((m) => m.filter((_, j) => j !== i))}
          />
        )}
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
            <label>รอบ<select value={round} disabled={!!viewing} onChange={(e) => setRound(Number(e.target.value))}>{[...new Set([1, 2, 3, 4, 5, 6, ...history.filter((h) => h.date === date && h.round > 6).map((h) => h.round), round].filter((r) => r !== FB_ROUND))].sort((a, b) => a - b).concat(FB_ROUND).map((r) => <option key={r} value={r}>{roundLabel(r)}{history.some((h) => h.date === date && h.round === r) ? ' (มีแล้ว)' : ''}</option>)}</select></label>
            {viewing && <button className="ghost small" onClick={() => setViewing(null)}>ปิดใบย้อนหลัง</button>}
            {viewing && viewing.lines.length > 0 && viewing.lines.every((l) => !l.orders?.length) && (
              <span className="warn small">รอบนี้บันทึกก่อนระบบเก็บเลขคำสั่งซื้อ · อัปโหลดไฟล์เดิม{viewing.upload.file ? ` (${viewing.upload.file})` : ''} อีกครั้ง แล้วกดดาวน์โหลด/พิมพ์ จะเติมเลขให้รอบนี้ (ติ๊กของไม่มียังอยู่)</span>
            )}
            {!viewing && history.some((h) => h.date === date && h.round === round) && <span className="warn small">วันที่และรอบนี้มีใบสั่งแล้ว · ดาวน์โหลด/พิมพ์จะบันทึกทับ</span>}
          </div>
        )}
      </section>

      <OrderSearch
        lines={shown ? lines : []} history={history} currentId={viewing ? viewing.upload.id : `${date}#${round}`}
        onGo={(hits) => {
          setFound(new Set(hits.map((l) => `${l.group}\u0000${l.sku}`)));
          setOpen((o) => new Set([...o, ...hits.map((l) => l.group)]));
          setTimeout(() => document.getElementById(rowId(hits[0].group, hits[0].sku))?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
        }}
        onOpenRound={(u) => openHistory(u)}
      />

      {shown && (
        <>
          <div className="kpis po-kpis">
            <div className="kpi"><span>ชิ้นทั้งหมด</span><b>{num(pieces)}</b>{data && <small>{num(new Set(allItems.map((i) => i.order).filter(Boolean)).size)} ออเดอร์</small>}</div>
            <div className="kpi"><span>ร้านค้า</span><b>{num(groups.filter((g) => g.kind === 'supplier').length)}</b></div>
            <div className="kpi"><span>โกดัง</span><b>{num(groups.filter((g) => g.kind === 'warehouse').length)}</b></div>
            <div className="kpi"><span>ต้องตรวจสอบ</span><b className={review || groups.some((g) => g.kind === 'unassigned') ? 'bad' : 'good'}>{num((review?.pieces ?? 0) + groups.filter((g) => g.kind === 'unassigned').reduce((n, g) => n + g.pieces, 0))}</b><small>ไม่มี SKU / ยังไม่ระบุร้าน · <a href="/catalog/todo">งานค้างทั้งหมด</a></small></div>
          </div>

          {gosellShort.length > 0 && (
            <div className="card warn-card small">
              <b>สต็อก GoSell ไม่พอสำหรับออเดอร์ Facebook</b> · {gosellShort.map((x) => `${x.name} ${num(x.n)} ตัว`).join(' · ')} → อยู่ใบเดิม · <a href="/catalog/stock?gosell=1">ดูสต็อก</a>
            </div>
          )}
          {stockShort.length > 0 && (
            <div className="card warn-card small">
              <b>สต็อก{STOCK_GROUP}ไม่พอ</b> · {stockShort.map((x) => `${x.name} ${num(x.n)} ตัว`).join(' · ')} → อยู่ใบเดิม (ไม่ตัดสต็อก) · ย้ายไป {STOCK_GROUP} เองได้ถ้ามีของจริง · <a href="/catalog/stock">ดูสต็อก</a>
            </div>
          )}

          <section className="card po-actions">
            <div>
              <h2>ใบสั่ง · ส่งร้าน</h2>
              <p className="muted small">ไม่มีทุน/ยอดเงิน · Excel = ชีตสรุป + ชีตละร้าน · พิมพ์ = หน้าละร้าน เลือก "บันทึกเป็น PDF" เพื่อส่งทาง Line ได้{!viewing && canEdit ? ' · ระบบบันทึกประวัติให้เมื่อดาวน์โหลดหรือพิมพ์' : ''}</p>
            </div>
            <div className="row-actions">
              <CopyOrdersButton orders={orderNumbersOf(lines)} label="คัดลอกเลขคำสั่งซื้อทั้งหมด" />
              <button onClick={() => print()} disabled={!!busy}><Icon name="down" size={14} /> พิมพ์ / PDF ทุกใบ</button>
              <button className="primary" onClick={() => exportExcel()} disabled={!!busy}><Icon name="down" size={14} /> Excel ทุกใบ</button>
            </div>
          </section>

          <PaymentCard
            totals={supplierTotals(pia ? [...groups, pia] : groups, missing)} onExport={exportPayments} busy={!!busy}
            payments={new Map(ledgerRows.filter((r) => r.upload_id === (viewing ? viewing.upload.id : `${date}#${round}`)).map((r) => [r.grp, r]))}
            onPay={canEdit ? recordPayment : null}
          />

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
                        <td className="small"><OrderNumbers orders={l.orders} stores={l.stores} /></td>
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
              key={g.name} group={g} open={open.has(g.name)} onToggle={() => toggle(g.name)} found={found}
              missing={missing} onMissing={canEdit ? setLineMissing : null} onPrice={canEdit ? setPrice : null}
              onLabel={(l) => (l.tab && !l.sku.startsWith('?') ? (canEdit ? setLabel : null) : (!viewing || canEdit ? setLabel : null))}
              canRemember={canEdit} movable={!viewing || canEdit} targets={targets} onMove={moveLine}
              matchRows={allRows} onMatched={canEdit ? (a) => setMeta((m) => (m ? { ...m, aliases: [a, ...m.aliases.filter((x) => x.alias !== a.alias)] } : m)) : null}
              ours={ours} onReplace={canEdit ? replaceSku : null} onUnmerge={canEdit ? unmerge : null}
              onSupplier={setSupplier} onExcel={() => exportExcel(g)} onPrint={() => print(g)} busy={!!busy}
              onPictures={() => { save(); setPictures(g); }}
            />
          ))}
        </>
      )}

      {ledgerRows.length > 0 && <LedgerCard rows={ledgerRows} history={history} onOpen={openHistory} />}

      {history.length > 0 && (
        <section className="card table-card">
          <div className="table-card-head"><h2>ใบสั่งย้อนหลัง</h2></div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>วันที่</th><th>รอบ</th><th className="num">ชิ้น</th><th>ร้าน / โกดัง</th><th className="num">ตรวจสอบ</th><th className="num">ของไม่มี</th><th>จ่ายร้าน</th><th>บันทึกโดย</th><th /></tr></thead>
              <tbody>
                {history.map((u) => (
                  <tr key={u.id} className={viewing?.upload.id === u.id ? 'selected' : ''}>
                    <td>{thaiShortDate(u.date)}</td>
                    <td>{u.round === FB_ROUND ? 'Facebook' : u.round}</td>
                    <td className="num">{num(u.pieces)}</td>
                    <td className="small">{u.groups.filter((g) => g.kind !== 'review').sort((a, b) => b.pieces - a.pieces).map((g) => `${g.name} ${g.pieces}`).join(' · ')}</td>
                    <td className={`num ${u.review ? 'bad' : ''}`}>{num(u.review)}</td>
                    <td className={`num ${u.missing ? 'warn' : ''}`}>{num(u.missing ?? 0)}</td>
                    <td className="small"><PaidStatus rows={ledgerRows.filter((r) => r.upload_id === u.id && (r.kind === 'supplier' || r.grp === MISSING_GROUP) && (r.due > 0 || r.unpriced > 0 || r.paid))} /></td>
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
          orders={data && !viewing ? orderBlocks(allItems, lookup, pictures.name, productInfo) : null}
        />
      )}
    </div>
  );
}

// ---- what this round is made of: Bigseller file, Facebook orders, typed lines ----

function Sources({ bigseller, fb, manual, rows, busy, onFile, onRemoveFb, onAdd, onRemoveManual }: {
  bigseller: { file: string; pieces: number } | null;
  fb: { file: string; orders: number; pieces: number } | null;
  manual: OrderItem[]; rows: CatalogRow[]; busy: boolean;
  onFile: (f: File) => void; onRemoveFb: () => void; onAdd: (it: OrderItem) => void; onRemoveManual: (i: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [sku, setSku] = useState<CatalogRow | null>(null);
  const [qty, setQty] = useState('1');
  const hits = useMemo(() => (adding && !sku ? suggestSkus(rows, q, 6) : []), [adding, sku, rows, q]);
  const add = (s: string, name = '') => {
    const n = Math.round(Number(qty));
    if (!s.trim() || !(n > 0)) return;
    onAdd({ store: MANUAL_STORE, sku: s.trim(), name, option: '', qty: n, order: '', tracking: '', carrier: '' });
    setQ(''); setSku(null); setQty('1');
  };
  return (
    <div className="po-sources small">
      <div className="po-source-row">
        <span>Bigseller: {bigseller ? <b>{bigseller.file}</b> : <span className="muted">ยังไม่มีไฟล์</span>}{bigseller && <span className="muted"> · {num(bigseller.pieces)} ตัว</span>}</span>
        <span>
          Facebook: {fb ? <><b>{fb.file}</b> <span className="muted">· {num(fb.orders)} ออเดอร์ · {num(fb.pieces)} ตัว</span> <button className="link small danger" onClick={onRemoveFb}>เอาออก</button></>
            : <label className={`button small po-fb-btn ${busy ? 'disabled' : ''}`}><Icon name="up" size={14} /> เพิ่มไฟล์ Facebook (Page365)
                <input type="file" accept=".csv,.tsv,.txt,.xlsx" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
              </label>}
        </span>
        <span>เพิ่มเอง: {manual.length ? <b>{manual.length} รายการ</b> : <span className="muted">—</span>} {!adding && <button className="small po-add-btn" onClick={() => setAdding(true)}>+ เพิ่มรายการเอง</button>}</span>
      </div>
      {manual.length > 0 && (
        <div className="po-manual-list">
          {manual.map((m, i) => <span key={i} className="pill">{m.sku} × {m.qty} <button className="link small danger" aria-label={`เอา ${m.sku} ออก`} onClick={() => onRemoveManual(i)}>✕</button></span>)}
        </div>
      )}
      {adding && (
        <div className="po-manual-add">
          {sku ? <span className="pill on">{sku.sku} <button className="link small" onClick={() => setSku(null)}>เปลี่ยน</button></span>
            : <input value={q} autoFocus placeholder="SKU หรือ รหัส สี ไซส์ เช่น 501/2 32" aria-label="ค้นหา SKU" onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { if (hits[0]) setSku(hits[0]); else add(q); } if (e.key === 'Escape') setAdding(false); }} />}
          <input className="po-manual-qty" inputMode="numeric" value={qty} aria-label="จำนวน" onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter' && sku) add(sku.sku, sku.name); }} />
          <button className="small primary" disabled={!(sku || q.trim()) || !(Number(qty) > 0)} onClick={() => (sku ? add(sku.sku, sku.name) : add(q))}>เพิ่ม</button>
          <button className="small" onClick={() => { setAdding(false); setQ(''); setSku(null); }}>เสร็จ</button>
          {!sku && hits.length > 0 && (
            <div className="sku-match-list po-manual-hits">
              {hits.map((r) => (
                <button key={`${r.tab}|${r.sku}`} className="sku-match-item" onClick={() => setSku(r)}>
                  <code>{r.sku}</code><span className="muted small">{r.code}{r.size ? ` · ${r.size}` : ''} · {r.tab}</span>
                </button>
              ))}
            </div>
          )}
          {!sku && q.trim() && !hits.length && <span className="muted small">ไม่พบในแคตตาล็อก · กดเพิ่มเพื่อใส่ตามที่พิมพ์ (จะไปอยู่ ตรวจสอบ)</span>}
        </div>
      )}
    </div>
  );
}

// ---- one supplier / warehouse ----

function GroupCard({ group: g, open, onToggle, found, missing, onMissing, onPrice, onLabel, canRemember, movable, targets, onMove, matchRows, onMatched, ours, onReplace, onUnmerge, onSupplier, onExcel, onPrint, onPictures, busy }: {
  group: PurchaseGroup; open: boolean; onToggle: () => void; found: Set<string>; missing: Map<string, number>; onMissing: ((l: PurchaseLine, n: number) => Promise<void>) | null;
  onPrice: ((l: PurchaseLine, price: number | null) => Promise<void>) | null;
  onLabel: (l: PurchaseLine) => ((l: PurchaseLine, text: string, onlySize?: boolean) => Promise<void>) | null;
  canRemember: boolean; movable: boolean; targets: string[]; onMove: (sku: string, to: string) => void;
  matchRows: CatalogRow[]; onMatched: ((a: CatalogAlias) => void) | null;
  ours: Map<string, Map<string, string>>; onReplace: ((from: string, to: string) => Promise<void>) | null; onUnmerge: ((from: string) => Promise<void>) | null;
  onSupplier: (items: { tab: string; spu: string }[], shop: string) => Promise<void>; onExcel: () => void; onPrint: () => void; onPictures: () => void; busy: boolean;
}) {
  const rowsOnSheet = sheetRows(g).length;
  const products = useMemo(() => {
    const seen = new Map<string, { tab: string; spu: string }>();
    for (const l of g.lines) if (l.kind !== 'review' && l.tab && !seen.has(`${l.tab}|${spuOf(l.sku)}`)) seen.set(`${l.tab}|${spuOf(l.sku)}`, { tab: l.tab, spu: spuOf(l.sku) });
    return [...seen.values()];
  }, [g.lines]);
  const [bulk, setBulk] = useState('');
  // Rows ticked for the bulk move; none ticked = the whole group.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [setAll, setSetAll] = useState('');
  const missingHere = g.lines.reduce((n, l) => n + (missing.get(lineKey(l)) ?? 0), 0);
  const pickedLines = g.lines.filter((l) => picked.has(l.sku));
  const toMove = pickedLines.length ? pickedLines : g.lines;
  const togglePick = (sku: string) => setPicked((p) => { const n = new Set(p); if (n.has(sku)) n.delete(sku); else n.add(sku); return n; });
  const total = g.kind === 'review' ? null : supplierTotals([g], missing)[0];
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
          {total && <span className="pill po-money" title="ยอดเงินของที่ได้จริง (ภายใน ไม่ส่งร้าน)">฿{num(total.amount)}{total.unpriced ? ` · ยังไม่มีทุน ${num(total.unpriced)} ชิ้น` : ''}</span>}
        </button>
        <div className="row-actions">
          <CopyOrdersButton orders={orderNumbersOf(g.lines)} />
          {g.kind !== 'review' && <>
            <button className={`small ${wantsPictures(g) ? 'primary' : ''}`} onClick={onPictures} disabled={busy} title="ใบสั่งเป็นรูป: รูปสินค้า + SKU + จำนวน (แยกตามออเดอร์ได้ สำหรับโกดังจีน)">รูปภาพ</button>
            <button className="small" onClick={onPrint} disabled={busy}>พิมพ์</button>
            <button className="small" onClick={onExcel} disabled={busy}>Excel</button>
          </>}
        </div>
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
              <span className="small">{pickedLines.length ? `ย้ายที่ติ๊ก ${num(pickedLines.length)} รายการไป (รอบนี้)` : `ย้ายทั้ง ${num(g.lines.length)} รายการไป (รอบนี้) · ติ๊กช่องหน้าแถวเพื่อเลือกเฉพาะบางรายการ`}</span>
              <input value={bulk} onChange={(e) => setBulk(e.target.value)} list="po-targets" placeholder="เลือกหรือพิมพ์ร้าน/โกดัง" aria-label="ย้ายทั้งกลุ่มไป" />
              <button className="small primary" disabled={!bulk.trim()} onClick={() => { toMove.forEach((l) => onMove(l.sku, bulk.trim())); setBulk(''); setPicked(new Set()); }}>ย้าย</button>
            </div>
          )}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {movable && g.lines.length > 1 && <th className="center"><input type="checkbox" aria-label="เลือกทั้งหมดในกลุ่ม" checked={pickedLines.length === g.lines.length} onChange={(e) => setPicked(e.target.checked ? new Set(g.lines.map((l) => l.sku)) : new Set())} /></th>}
                  <th>{g.kind === 'review' ? 'SKU ใน Bigseller' : 'รหัสสินค้า'}</th><th>ไซส์</th><th className="num">จำนวน</th>
                  <th>{g.kind === 'review' ? 'ปัญหา / ตัวเลือกสินค้า' : 'SKU'}</th><th>ร้านขาย · เลขคำสั่งซื้อ</th>
                  {g.kind !== 'review' && <th className="center">ของไม่มี</th>}
                  {g.kind !== 'review' && <th className="num po-internal" title="ภายใน ไม่ส่งร้าน">ทุน/ตัว</th>}
                  {g.kind !== 'review' && <th className="num po-internal" title="ภายใน ไม่ส่งร้าน">ยอด</th>}
                  {movable && <th>ย้ายไป (รอบนี้)</th>}
                </tr>
              </thead>
              <tbody>
                {g.lines.map((l, i) => {
                  const product = `${l.tab}|${spuOf(l.sku)}`;
                  const firstOfProduct = g.lines.findIndex((x) => `${x.tab}|${spuOf(x.sku)}` === product) === i;
                  return (
                    <tr key={l.sku} id={rowId(g.name, l.sku)} className={`${firstOfProduct && i > 0 ? 'group-start' : ''} ${missing.get(lineKey(l)) ? 'po-missing' : ''} ${found.has(`${g.name}\u0000${l.sku}`) ? 'po-found' : ''}`}>
                      {movable && g.lines.length > 1 && <td className="center"><input type="checkbox" aria-label={`เลือก ${l.sku}`} checked={picked.has(l.sku)} onChange={() => togglePick(l.sku)} /></td>}
                      <td><LabelCell line={l} strong={!!firstOfProduct || g.kind === 'review'} onSave={onLabel(l) ? (text, onlySize) => onLabel(l)!(l, text, onlySize) : null} ours={ours} onReplace={onReplace} onUnmerge={onUnmerge} /></td>
                      <td>{l.size || '—'}</td>
                      <td className="num"><b>{num(l.qty)}</b></td>
                      <td className="small">
                        {g.kind === 'review' ? l.note : <>
                          <code>{l.sku.startsWith('?') ? '(ไม่มี SKU)' : l.sku}</code>
                          {l.moved && <> <span className="pill warn">ย้ายมาจาก {l.from}</span></>}
                          {l.moved && l.option && <div className="muted small">Bigseller: {l.option}</div>}
                          {!l.moved && l.note && <span className="muted"> · {l.note}</span>}
                          {l.sheetNote && <div className="po-sheet-note" title="ข้อความในคอลัมน์ รหัสแทน (M) ของชีต · แสดงให้ทีมเห็นเท่านั้น ไม่พิมพ์ในใบสั่ง">หมายเหตุชีต: {l.sheetNote}</div>}
                        </>}
                      </td>
                      <td className="small"><OrderNumbers orders={l.orders} stores={l.stores} /></td>
                      {g.kind !== 'review' && <td className="center"><MissingCell qty={l.qty} value={missing.get(lineKey(l)) ?? 0} onChange={onMissing ? (n) => onMissing(l, n) : null} /></td>}
                      {g.kind !== 'review' && <td className="num po-internal"><PriceCell line={l} onSave={onPrice && l.tab && !l.sku.startsWith('?') ? (p) => onPrice(l, p) : null} /></td>}
                      {g.kind !== 'review' && (
                        <td className="num po-internal">{l.price != null ? <b>{num((l.qty - Math.min(l.qty, missing.get(lineKey(l)) ?? 0)) * l.price)}</b> : <span className="muted">—</span>}</td>
                      )}
                      {movable && (
                        <td>
                          <div className="po-move">
                            <ShopInput placeholder="เลือกหรือพิมพ์" action="ย้าย" remember={canRemember && g.kind !== 'review'} onSubmit={(to, remember) => move(l, to, remember)} />
                            {l.moved && <button className="link small" onClick={() => onMove(l.sku, '')}>ย้อนกลับไป {l.from}</button>}
                            {g.kind === 'review' && !l.sku.startsWith('?') && onMatched && (
                              <SkuMatch alias={l.sku} rows={matchRows} onMatched={onMatched}
                                initialQuery={(() => { const o = optionParts(l.note.split(' · ').slice(1).join(' · ')); return `${o.model} ${o.size}`.trim(); })()} />
                            )}
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

/**
 * The name on the sheet, editable: a catalog product keeps it for every size and day, a row not in the catalog for
 * this round only. Empty + save = back to the default.
 */
function LabelCell({ line: l, strong, onSave, ours, onReplace, onUnmerge }: {
  line: PurchaseLine; strong: boolean; onSave: ((text: string, onlySize: boolean) => Promise<void>) | null;
  ours: Map<string, Map<string, string>>; onReplace: ((from: string, to: string) => Promise<void>) | null; onUnmerge: ((from: string) => Promise<void>) | null;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(l.label);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [onlySize, setOnlySize] = useState(false);
  const catalog = !!l.tab && !l.sku.startsWith('?');
  // "รหัสของเรา": the same size of one of our codes; picking it makes this SKU read as ours (merged with our row).
  const target = code ? ours.get(code)?.get(l.size) ?? null : null;
  const canReplace = !!onReplace && !l.sku.startsWith('?') && l.tab !== 'PK';
  const save = async () => {
    // A code picked in "รหัสของเรา" is what บันทึก saves; otherwise the name.
    if (code && target) return replace();
    if (!onSave) return;
    if (value.trim() === l.label) { setEditing(false); return; }
    setBusy(true);
    try { await onSave(value.trim(), onlySize && !!l.size); setEditing(false); } finally { setBusy(false); }
  };
  const replace = async () => {
    if (!onReplace || !target) return;
    setBusy(true);
    try { await onReplace(l.sku, target); setEditing(false); setCode(''); } finally { setBusy(false); }
  };
  const merged = l.merged?.length ? (
    <small className="muted po-merged">
      รวม {l.merged.map((m) => <span key={m}>{m}{onUnmerge && <> <button className="link small" title="แยกกลับเป็นบรรทัดของตัวเอง" onClick={() => onUnmerge(m)}>แยก</button></>} </span>)}
    </small>
  ) : null;
  if (editing) {
    return (
      <span className="po-label-edit">
        {canReplace && (
          <span className="po-our-code">
            <label className="small">รหัสของเรา
              <select value={code} disabled={busy} onChange={(e) => setCode(e.target.value)} aria-label="เปลี่ยนเป็นรหัสของเรา">
                <option value="">— เลือก —</option>
                {[...ours.keys()].map((c) => <option key={c} value={c}>{c}{ours.get(c)?.has(l.size) ? '' : ` (ไม่มีไซส์ ${l.size})`}</option>)}
              </select>
            </label>
            {code && (target
              ? <small><code>{l.sku}</code> → <code>{target}</code> · กด <b>บันทึก</b></small>
              : <small className="bad">{code} ไม่มีไซส์ {l.size || '(ไม่ทราบไซส์)'}</small>)}
            <small className="muted">SKU เปลี่ยนเป็นของเรา จำนวนรวมกับบรรทัดเดิม · จำไว้ทุกวัน ทุกหน้า (ยอดขาย ทุน สต็อก)</small>
          </span>
        )}
        <input value={value} autoFocus disabled={busy || (!!code && !!target)} onChange={(e) => setValue(e.target.value)} aria-label="ชื่อในใบสั่ง"
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} />
        <span className="po-label-actions">
          <button className="small primary" disabled={busy || (!!code && !target)} onClick={save}>บันทึก</button>
          <button className="link small" onClick={() => { setEditing(false); setCode(''); }}>ยกเลิก</button>
          {catalog && l.size && <label className="small"><input type="checkbox" checked={onlySize} onChange={(e) => setOnlySize(e.target.checked)} /> เฉพาะไซส์ {l.size}</label>}
          <small className="muted">{catalog ? `ชื่อ: ${onlySize ? `เฉพาะไซส์ ${l.size}` : 'ทุกไซส์'} · จำไว้ทุกวัน · ลบให้ว่าง = กลับเป็นค่าเดิม` : 'ชื่อ: เฉพาะรอบนี้'}</small>
        </span>
      </span>
    );
  }
  return (
    <span className="po-label">
      {strong ? <b>{l.label}</b> : <span className="muted">{l.label}</span>}
      {(onSave || canReplace) && <button className="link small po-label-btn" onClick={() => { setValue(l.label); setEditing(true); }} title="แก้ชื่อ หรือเปลี่ยนเป็นรหัสของเรา">แก้</button>}
      {merged}
    </span>
  );
}

/** What we pay per piece and where the number comes from; typed here when the sheet has none (remembered per product). */
function PriceCell({ line: l, onSave }: { line: PurchaseLine; onSave: ((price: number | null) => Promise<void>) | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (raw: string) => {
    if (!onSave) return;
    const t = raw.trim();
    const p = t === '' ? null : Number(t);
    if (p !== null && !(p >= 0)) return;
    setBusy(true);
    try { await onSave(p); setEditing(false); setValue(''); } finally { setBusy(false); }
  };
  if (editing || (l.price == null && onSave)) {
    return (
      <span className="po-price-edit">
        <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') save(value); if (e.key === 'Escape') setEditing(false); }}
          placeholder={l.price != null ? String(l.price) : 'ใส่ทุน'} aria-label="ทุนต่อตัว" autoFocus={editing} />
        <button className="small" disabled={busy || (!value.trim() && l.priceSource !== 'web')} onClick={() => save(value)}>บันทึก</button>
        {editing && <button className="link small" onClick={() => setEditing(false)}>ยกเลิก</button>}
      </span>
    );
  }
  if (l.price == null) return <span className="muted">—</span>;
  return (
    <span className="po-price">
      <b>{num(l.price)}</b>
      <small className={`muted src-${l.priceSource}`}>{PRICE_SOURCE_LABEL[l.priceSource ?? '']}</small>
      {onSave && <button className="link small" onClick={() => { setEditing(true); setValue(String(l.price)); }}>แก้</button>}
    </span>
  );
}

/**
 * Our side only: what each supplier is owed for what it delivered (out-of-stock pieces not counted), gaps in costs,
 * and what was actually paid — amount, settled tick, note — with the difference.
 */
function PaymentCard({ totals, onExport, busy, payments, onPay }: {
  totals: ReturnType<typeof supplierTotals>; onExport: () => void; busy: boolean;
  payments: Map<string, LedgerRow>; onPay: ((grp: string, v: { paid: number | null; done: boolean; note: string }) => Promise<void>) | null;
}) {
  const [open, setOpen] = useState(false);
  const sum = (f: 'ordered' | 'missing' | 'received' | 'amount' | 'unpriced') => totals.reduce((n, t) => n + t[f], 0);
  const suppliers = totals.filter((t) => t.kind === 'supplier' || t.name === MISSING_GROUP);
  const paidSum = totals.reduce((n, t) => n + (payments.get(t.name)?.paid ?? 0), 0);
  const settled = suppliers.filter((t) => payments.get(t.name)?.done).length;
  return (
    <section className="card table-card po-payments">
      <div className="table-card-head">
        <button className="link po-group-title" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name="chevron" size={14} />
          <b>ยอดจ่ายร้าน</b>
          <span className="pill">ภายใน · ไม่ส่งร้าน</span>
          <span className="muted small">ร้านค้า ฿{num(suppliers.reduce((n, t) => n + t.amount, 0))} · ทุกกลุ่ม ฿{num(sum('amount'))} · ได้จริง {num(sum('received'))} ชิ้น</span>
          {suppliers.length > 0 && <span className={`pill ${settled === suppliers.length ? 'on' : ''}`}>จ่ายแล้ว {settled}/{suppliers.length} ร้าน · ฿{num(paidSum)}</span>}
          {sum('unpriced') > 0 && <span className="pill warn">ยังไม่มีทุน {num(sum('unpriced'))} ชิ้น</span>}
        </button>
        <button className="small primary" onClick={onExport} disabled={busy}><Icon name="down" size={14} /> Excel สรุปจ่ายร้าน (ภายใน)</button>
      </div>
      {open && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ร้าน / โกดัง</th><th>ประเภท</th><th className="num">สั่ง</th><th className="num">ของไม่มี</th><th className="num">ได้จริง</th><th className="num">ยอดเงิน</th><th className="num">ขาดทุน</th>
                <th className="num">จ่ายจริง</th><th className="center">จ่ายแล้ว</th><th className="num">ส่วนต่าง</th><th>หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((t) => <PaymentRow key={t.name} total={t} payment={payments.get(t.name)} onPay={onPay} />)}
              <tr className="total-row">
                <td>รวม</td><td /><td className="num">{num(sum('ordered'))}</td><td className="num">{num(sum('missing'))}</td><td className="num">{num(sum('received'))}</td>
                <td className="num">฿{num(sum('amount'))}</td><td className="num">{sum('unpriced') ? `${num(sum('unpriced'))} ชิ้น` : '—'}</td>
                <td className="num">฿{num(paidSum)}</td><td /><td className="num">{paidSum ? num(paidSum - sum('amount')) : '—'}</td><td />
              </tr>
            </tbody>
          </table>
          <p className="small muted po-hint" style={{ paddingTop: 8 }}>
            ยอดเงิน = (สั่ง − ของไม่มี) × ทุน/ตัว · ทุน: คอลัมน์ H ของชีต (ไม่มีหรือแก้ได้ในช่อง "ทุน/ตัว") ·
            จ่ายจริง: ใส่ยอดที่โอนให้ร้าน แล้วติ๊ก "จ่ายแล้ว" (ติ๊กโดยไม่ใส่ยอด = จ่ายเท่ายอดเงิน) · ส่วนต่าง = จ่ายจริง − ยอดเงิน · บันทึกทันที
          </p>
        </div>
      )}
    </section>
  );
}

function PaymentRow({ total: t, payment, onPay }: {
  total: ReturnType<typeof supplierTotals>[number]; payment?: LedgerRow;
  onPay: ((grp: string, v: { paid: number | null; done: boolean; note: string }) => Promise<void>) | null;
}) {
  const [paid, setPaid] = useState(payment?.paid != null ? String(payment.paid) : '');
  const [note, setNote] = useState(payment?.note ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPaid(payment?.paid != null ? String(payment.paid) : ''); setNote(payment?.note ?? ''); }, [payment?.paid, payment?.note]);
  const done = !!payment?.done;
  const send = async (v: { paid: number | null; done: boolean; note: string }) => {
    if (!onPay) return;
    setBusy(true);
    try { await onPay(t.name, v); } finally { setBusy(false); }
  };
  const paidNum = paid.trim() === '' ? null : Number(paid);
  const changed = paidNum !== (payment?.paid ?? null) || note.trim() !== (payment?.note ?? '');
  const diff = payment?.paid != null ? payment.paid - t.amount : null;
  return (
    <tr className={done ? 'po-paid' : ''}>
      <td><b>{t.name}</b></td>
      <td className="small muted">{t.name === MISSING_GROUP ? 'สั่งข้างนอก' : KIND_LABEL[t.kind]}</td>
      <td className="num">{num(t.ordered)}</td>
      <td className={`num ${t.missing ? 'warn' : ''}`}>{t.missing ? num(t.missing) : '—'}</td>
      <td className="num">{num(t.received)}</td>
      <td className="num"><b>฿{num(t.amount)}</b></td>
      <td className={`num ${t.unpriced ? 'warn' : ''}`}>{t.unpriced ? `${num(t.unpriced)} ชิ้น` : '—'}</td>
      <td className="num">
        {onPay ? (
          <input className="po-pay-input" inputMode="decimal" value={paid} disabled={busy} placeholder={num(t.amount)} aria-label={`จ่ายจริง ${t.name}`}
            onChange={(e) => setPaid(e.target.value.replace(/[^\d.]/g, ''))}
            onBlur={() => { if (changed) send({ paid: paidNum, done, note: note.trim() }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        ) : payment?.paid != null ? `฿${num(payment.paid)}` : '—'}
      </td>
      <td className="center">
        <input type="checkbox" checked={done} disabled={!onPay || busy} aria-label={`จ่ายแล้ว ${t.name}`}
          onChange={(e) => send({ paid: e.target.checked && paidNum === null ? Math.round(t.amount * 100) / 100 : paidNum, done: e.target.checked, note: note.trim() })} />
      </td>
      <td className={`num ${diff === null ? '' : Math.abs(diff) < 0.5 ? 'good' : 'warn'}`}>{diff === null ? '—' : Math.abs(diff) < 0.5 ? 'ตรง' : `${diff > 0 ? '+' : ''}${num(diff)}`}</td>
      <td>
        {onPay ? (
          <input className="po-pay-note" value={note} disabled={busy} placeholder="เช่น โอน 15/10 สลิป…" aria-label={`หมายเหตุ ${t.name}`}
            onChange={(e) => setNote(e.target.value)} onBlur={() => { if (changed) send({ paid: paidNum, done, note: note.trim() }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        ) : <span className="small">{payment?.note || ''}</span>}
      </td>
    </tr>
  );
}

/** "ปิด 3/5" for a round in the history table: suppliers marked paid out of those owed something. */
function PaidStatus({ rows }: { rows: LedgerRow[] }) {
  if (!rows.length) return <span className="muted">—</span>;
  const done = rows.filter((r) => r.done).length;
  const open = rows.filter((r) => !r.done).reduce((n, r) => n + Math.max(0, r.due - (r.paid ?? 0)), 0);
  return <span className={done === rows.length ? 'good' : 'warn'}>{done === rows.length ? 'จ่ายครบ' : `ปิด ${done}/${rows.length} · ค้าง ฿${num(open)}`}</span>;
}

/**
 * Outstanding payments over the last 60 days, per supplier: owed and paid for rounds not yet settled, and how many
 * rounds; open a supplier to see its rounds and jump to one.
 */
function LedgerCard({ rows, history, onOpen }: { rows: LedgerRow[]; history: PurchaseUpload[]; onOpen: (u: PurchaseUpload) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState(false);
  const shown = rows.filter((r) => (warehouses || r.kind === 'supplier' || r.grp === MISSING_GROUP) && (r.due > 0 || r.unpriced > 0 || r.paid));
  const bySupplier = new Map<string, LedgerRow[]>();
  for (const r of shown) bySupplier.set(r.grp, [...(bySupplier.get(r.grp) ?? []), r]);
  const list = [...bySupplier.entries()].map(([grp, rs]) => {
    const unsettled = rs.filter((r) => !r.done);
    return { grp, rs, rounds: unsettled.length, due: unsettled.reduce((n, r) => n + r.due, 0), paid: unsettled.reduce((n, r) => n + (r.paid ?? 0), 0), unpriced: unsettled.reduce((n, r) => n + r.unpriced, 0) };
  }).sort((a, b) => (b.due - b.paid) - (a.due - a.paid));
  const outstanding = list.reduce((n, s) => n + Math.max(0, s.due - s.paid), 0);
  return (
    <section className="card table-card po-payments">
      <div className="table-card-head">
        <div>
          <h2>ยอดค้างจ่ายร้าน <span className="pill">ภายใน</span> <span className="muted small">60 วันล่าสุด · ค้างรวม ฿{num(outstanding)}</span></h2>
          <p className="muted small">นับเฉพาะรอบที่ยังไม่ติ๊ก "จ่ายแล้ว" · ยอดต้องจ่ายมาจากใบสั่งตอนบันทึกล่าสุด</p>
        </div>
        <label className="check small"><input type="checkbox" checked={warehouses} onChange={(e) => setWarehouses(e.target.checked)} /> รวมโกดังของเรา</label>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>ร้าน</th><th className="num">รอบที่ค้าง</th><th className="num">ต้องจ่าย</th><th className="num">จ่ายแล้ว</th><th className="num">ค้าง</th><th /></tr></thead>
          <tbody>
            {list.map((s) => (
              <Fragment key={s.grp}>
                <tr className={s.rounds ? '' : 'dim'}>
                  <td><b>{s.grp}</b>{s.unpriced > 0 && <span className="pill warn" style={{ marginLeft: 6 }}>ยังไม่มีทุน {num(s.unpriced)} ชิ้น</span>}</td>
                  <td className="num">{s.rounds || '—'}</td>
                  <td className="num">฿{num(s.due)}</td>
                  <td className="num">฿{num(s.paid)}</td>
                  <td className={`num ${s.due - s.paid > 0.5 ? 'warn' : 'good'}`}><b>{s.rounds ? `฿${num(Math.max(0, s.due - s.paid))}` : 'จ่ายครบ'}</b></td>
                  <td><button className="link small" onClick={() => setOpen(open === s.grp ? null : s.grp)}>{open === s.grp ? 'ย่อ' : 'ดูรอบ'}</button></td>
                </tr>
                {open === s.grp && s.rs.map((r) => {
                  const u = history.find((h) => h.id === r.upload_id);
                  return (
                    <tr key={r.upload_id} className="formula-row">
                      <td className="small">{thaiShortDate(r.date)} {roundLabel(r.round)}{r.done ? ' · จ่ายแล้ว' : ''}{r.note ? ` · ${r.note}` : ''}</td>
                      <td />
                      <td className="num small">฿{num(r.due)}</td>
                      <td className="num small">{r.paid != null ? `฿${num(r.paid)}` : '—'}</td>
                      <td className="num small">{r.done ? (Math.abs((r.paid ?? 0) - r.due) < 0.5 ? 'ตรง' : `ต่าง ${num((r.paid ?? 0) - r.due)}`) : `฿${num(Math.max(0, r.due - (r.paid ?? 0)))}`}</td>
                      <td>{u && <button className="link small" onClick={() => onOpen(u)}>เปิดรอบ</button>}</td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Order numbers of a line with the store each came from: the first two, the rest behind "+N". */
/** DOM id of a row, for jumping to it from the order search. */
function rowId(group: string, sku: string): string {
  return `po-row-${encodeURIComponent(`${group}|${sku}`).replace(/%/g, '_')}`;
}

/**
 * Find order numbers (one or many, pasted; 4+ characters of one is enough): where they are in the round on screen —
 * jump to the row — and in which saved rounds, to open one.
 */
function OrderSearch({ lines, history, currentId, onGo, onOpenRound }: {
  lines: PurchaseLine[]; history: PurchaseUpload[]; currentId: string;
  onGo: (hits: PurchaseLine[]) => void; onOpenRound: (u: PurchaseUpload) => void;
}) {
  const { toast } = useUi();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ terms: string[]; here: { term: string; order: string; line: PurchaseLine }[]; saved: FoundOrder[] } | null>(null);
  async function run() {
    const terms = [...new Set(q.split(/[\s,;]+/).map((t) => t.trim()).filter((t) => t.length >= 4))].slice(0, 30);
    if (!terms.length) { toast('พิมพ์เลขคำสั่งซื้ออย่างน้อย 4 ตัว', 'bad'); return; }
    const here: { term: string; order: string; line: PurchaseLine }[] = [];
    for (const l of lines) for (const o of l.orders ?? []) for (const t of terms) if (o.includes(t)) here.push({ term: t, order: o, line: l });
    setBusy(true);
    try {
      const { rows } = await api.findOrders(terms.join(' '));
      setResult({ terms, here, saved: rows.filter((r) => r.upload_id !== currentId || !lines.length) });
      if (here.length) onGo(here.map((h) => h.line));
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  const missingTerms = result ? result.terms.filter((t) => !result.here.some((h) => h.term === t) && !result.saved.some((r) => r.term === t)) : [];
  return (
    <section className="card po-search">
      <div className="po-search-bar">
        <label className="search">
          <span className="ico"><Icon name="search" size={16} /></span>
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
            onPaste={(e) => {
              // A pasted column (Excel, the copy buttons) has one number per line; a one-line box would glue them.
              const text = e.clipboardData.getData('text');
              if (!/[\r\n]/.test(text)) return;
              e.preventDefault();
              setQ((v) => `${v.trim()} ${text.replace(/\s+/g, ' ')}`.trim());
            }}
            placeholder="ค้นหาเลขคำสั่งซื้อ · วางได้หลายเลข (เว้นวรรค/ขึ้นบรรทัด) · พิมพ์บางส่วน 4 ตัวขึ้นไปก็ได้" aria-label="ค้นหาเลขคำสั่งซื้อ" />
          {q && <button className="icon-btn" onClick={() => { setQ(''); setResult(null); }} aria-label="ล้าง"><Icon name="x" size={16} /></button>}
        </label>
        <button className="primary" onClick={run} disabled={busy}>{busy ? 'กำลังค้นหา…' : 'ค้นหา'}</button>
      </div>
      {result && (
        <div className="po-search-results">
          {result.here.length > 0 && (
            <>
              <h3>ในรอบนี้ ({num(result.here.length)})</h3>
              <table className="data-table">
                <tbody>
                  {result.here.map((h, i) => (
                    <tr key={i}>
                      <td><code>{h.order}</code>{h.line.stores?.[h.order] && <div className="po-store">{h.line.stores[h.order]}</div>}</td>
                      <td><b>{h.line.group}</b></td>
                      <td>{h.line.label} · {h.line.size || '—'}</td>
                      <td className="num">{num(h.line.qty)} ชิ้น</td>
                      <td><button className="link small" onClick={() => onGo([h.line])}>ไปที่แถว</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {result.saved.length > 0 && (
            <>
              <h3>ในใบสั่งที่บันทึกไว้ ({num(result.saved.length)})</h3>
              <table className="data-table">
                <tbody>
                  {result.saved.map((r, i) => {
                    const u = history.find((h) => h.id === r.upload_id);
                    return (
                      <tr key={i}>
                        <td><code>{r.order_no}</code>{r.store && <div className="po-store">{r.store}</div>}</td>
                        <td>{thaiShortDate(r.date)} {roundLabel(r.round)}</td>
                        <td><b>{r.grp}</b></td>
                        <td>{r.label} · {r.size || '—'}</td>
                        <td className="num">{num(r.qty)} ชิ้น</td>
                        <td>{u && <button className="link small" onClick={() => onOpenRound(u)}>เปิดรอบ</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
          {missingTerms.length > 0 && <p className="small warn">ไม่พบ: {missingTerms.join(', ')}</p>}
        </div>
      )}
    </section>
  );
}

/** Order numbers of lines, each once, in the order they appear (the ones the file had; none are made up). */
function orderNumbersOf(lines: PurchaseLine[]): string[] {
  const seen = new Set<string>();
  for (const l of lines) for (const o of l.orders ?? []) if (o && !o.startsWith('?')) seen.add(o);
  return [...seen];
}

/** Puts text on the clipboard; falls back to a hidden textarea where the Clipboard API is not allowed. */
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

/** Copies every order number given, one per line (pastes straight into Bigseller's search or a sheet). */
function CopyOrdersButton({ orders, label = 'คัดลอกเลขคำสั่งซื้อ' }: { orders: string[]; label?: string }) {
  const { toast } = useUi();
  if (!orders.length) return null;
  return (
    <button className="small" title="คัดลอกเลขคำสั่งซื้อทั้งหมด บรรทัดละเลข" onClick={async () => {
      toast((await copyText(orders.join('\n'))) ? `คัดลอกเลขคำสั่งซื้อ ${num(orders.length)} เลขแล้ว` : 'คัดลอกไม่ได้ในเบราว์เซอร์นี้', 'ok');
    }}>{label} ({num(orders.length)})</button>
  );
}

function OrderNumbers({ orders, stores }: { orders: string[]; stores?: Record<string, string> }) {
  const { toast } = useUi();
  const [all, setAll] = useState(false);
  if (!orders?.length) return <span className="muted">—</span>;
  const shown = all ? orders : orders.slice(0, 2);
  const copyOne = async (o: string) => toast((await copyText(o)) ? `คัดลอก ${o} แล้ว` : 'คัดลอกไม่ได้', 'ok');
  return (
    <span className="po-orders">
      {shown.map((o) => <span key={o}>{stores?.[o] && <span className="po-store">{stores[o]}</span>} <button className="po-copy" title="คลิกเพื่อคัดลอก" onClick={() => copyOne(o)}><code>{o}</code></button></span>)}
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
        return { blob, url, name: `${group.name} ${dayMonth(date)} ${roundFile(round)}${blobs.length > 1 ? ` (${i + 1}-${blobs.length})` : ''}.png` };
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
              <span>{roundLabel(round)}</span>
            </div>
            <table className="po-sheet">
              <colgroup><col className="c-code" /><col className="c-size" /><col className="c-qty" /><col className="c-orders" /><col className="c-note" /></colgroup>
              <thead><tr><th>รหัสสินค้า</th><th>ไซส์</th><th>จำนวน</th><th>ร้านขาย · เลขคำสั่งซื้อ</th><th>หมายเหตุ</th></tr></thead>
              <tbody>
                {sheetRows(g).map((r, ri) => (
                  <tr key={ri} className={r.band % 2 === 0 ? 'shade' : ''}>
                    <td>{r.label}</td><td>{r.size}</td><td>{r.qty}</td>
                    <td className="orders">{r.orders.map((o) => <div key={o}>{orderText(o, r.stores)}</div>)}</td>
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

