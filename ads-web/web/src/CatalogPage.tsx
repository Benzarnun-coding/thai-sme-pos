// /catalog — search every SKU of the SKU+Price sheet, filtered by warehouse (sheet tab) and, where a tab lists them, by supplier.
// The whole catalog (~17k rows) is loaded once and searched in the browser; pages are cached by catalog version,
// so reopening the page costs no D1 reads until someone syncs. Syncing reads each tab's CSV here and sends only
// changed rows. SKUs can also be added here (kept apart from the sheet copy until someone pastes them into the sheet).

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { api, type CatalogImage, type WebSkuInput } from './api.ts';
import { useCatalog } from './useCatalog.ts';
import { productPictures } from './imageResize.ts';
import {
  buildSku, codeToPrefix, colorLabel, COLOR_NAMES, diffTab, groupProducts, locationOf, parseSheetTab, parseSizes, rowFromArray, rowToArray,
  NO_SHOP, search, SHOP_STATUSES, shopsOf, skuKey, spuOf, thumb, toSheetTsv, WAREHOUSE_NAMES, type CatalogRow, type Hit, type ImageOverride, type Product, type WebSku,
} from './catalog.ts';
import { num } from './fmt.ts';
import { Icon, Modal, useUi } from './ui.tsx';

const ALL = '*';
const WEB = '+web';
const PAGE = 60;
const TAB_KEY = 'catalog.tab';
const SHOP_KEY = 'catalog.shop';
const SYNC_CHUNK = 1000;
const SYNC_CONCURRENCY = 3;

function readTab(): string {
  try { return localStorage.getItem(TAB_KEY) ?? ALL; } catch { return ALL; }
}

function readShop(): string {
  try { return localStorage.getItem(SHOP_KEY) ?? ''; } catch { return ''; }
}

function money(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : num(n);
}

function moneyRange(r: [number, number] | null): string {
  if (!r) return '—';
  return r[0] === r[1] ? num(r[0]) : `${num(r[0])}–${num(r[1])}`;
}

function dateTime(iso: string | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** The whole /catalog site: header, search, results, warehouse tabs. */
export function CatalogApp() {
  useEffect(() => { document.title = 'แคตตาล็อกสินค้า'; }, []);
  const { toast, confirm } = useUi();
  const { meta, setMeta, rows, setRows, loading, error, load, role, canEdit, imageMap, supplierMap } = useCatalog();
  const [tab, setTabState] = useState(readTab);
  // Supplier filter inside a warehouse ('' = every supplier); cleared when the warehouse changes.
  const [shop, setShop] = useState(readShop);
  const setTab = (t: string) => { setTabState(t); setShop(''); };
  // ?q=SKU (from the order page's ตรวจสอบ list); ?add=1 also opens the add form for it once the catalog is loaded.
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('q') ?? '');
  const deferred = useDeferredValue(query);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Product | null>(null);
  const [adding, setAdding] = useState<Partial<WebSkuInput> | null>(null);
  const [editing, setEditing] = useState<WebSku | null>(null);
  const [sync, setSync] = useState<SyncState | null>(null);
  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab); localStorage.setItem(SHOP_KEY, shop); } catch { /* private mode */ } }, [tab, shop]);

  const web = meta?.web ?? [];
  const products = useMemo(() => groupProducts(rows, web, imageMap, supplierMap), [rows, web, imageMap, supplierMap]);
  const [noImage, setNoImage] = useState(false);
  const hits = useMemo(() => search(products, deferred), [products, deferred]);
  const byTab = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of hits) m.set(h.product.tab, (m.get(h.product.tab) ?? 0) + 1);
    return m;
  }, [hits]);
  const tabs = meta?.tabs ?? [];
  const activeTab = tab === WEB || tab === ALL || tabs.some((t) => t.tab === tab) ? tab : ALL;
  const inTab = activeTab === ALL ? hits : hits.filter((h) => h.product.tab === activeTab);
  // Suppliers of the products in this warehouse (column ร้านค้า), most products first; statuses like เลิกผลิต last.
  const shopCounts = useMemo(() => {
    if (activeTab === ALL || activeTab === WEB) return [];
    const m = new Map<string, number>();
    for (const h of inTab) for (const s of shopsOf(h.product)) m.set(s, (m.get(s) ?? 0) + 1);
    const tier = (s: string) => (s === NO_SHOP ? 2 : SHOP_STATUSES.has(s) ? 1 : 0);
    return [...m].sort((a, b) => tier(a[0]) - tier(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [inTab, activeTab]);
  const hasShops = shopCounts.some(([s]) => s !== NO_SHOP);
  const activeShop = hasShops && shopCounts.some(([s]) => s === shop) ? shop : '';
  const inShop = activeShop ? inTab.filter((h) => shopsOf(h.product).includes(activeShop)) : inTab;
  const missingImages = useMemo(() => inShop.filter((h) => !h.product.imageSource).length, [inShop]);
  const shown = noImage ? inShop.filter((h) => !h.product.imageSource) : inShop;
  useEffect(() => { setLimit(PAGE); window.scrollTo({ top: 0 }); }, [deferred, activeTab, activeShop, noImage]);

  // Load more cards as the end of the list comes into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setLimit((l) => l + PAGE); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shown.length, activeTab, activeShop, noImage]);

  const skuCount = rows.length;
  const lastSync = tabs.reduce((t, x) => (x.synced_at > t ? x.synced_at : t), '');
  const supplierNames = useMemo(() => {
    const names = new Set<string>();
    for (const r of rows) if (r.shop && !SHOP_STATUSES.has(r.shop)) names.add(r.shop);
    for (const v of supplierMap.values()) names.add(v);
    return [...names].sort((a, b) => a.localeCompare(b, 'th'));
  }, [rows, supplierMap]);
  const looksLikeSku = /^[A-Za-z0-9]+(-[A-Za-z0-9./]+){3}$/.test(query.trim());
  // A full SKU that is not in the catalog: similar SKUs may still match ("2004-BB-BI-38" ⊂ "E2004-BB-BI-38"), so say so.
  const missingSku = useMemo(() => {
    if (!looksLikeSku || loading) return null;
    const k = skuKey(query);
    return rows.some((r) => skuKey(r.sku) === k) || web.some((w) => skuKey(w.sku) === k) ? null : query.trim().toUpperCase();
  }, [looksLikeSku, loading, query, rows, web]);

  async function startSync() {
    if (loading) return;
    const ok = await confirm({
      title: 'ดึงข้อมูลจาก Google Sheet',
      body: <p>อ่านทุกแท็บโกดังของชีต SKU+Price แล้วบันทึกเฉพาะแถวที่เปลี่ยน · ใช้เวลาราว 30–60 วินาที (Google ตอบช้าในไฟล์นี้) · SKU ที่เพิ่มจากเว็บไม่ถูกแตะ</p>,
      confirmLabel: 'เริ่มดึง',
    });
    if (!ok) return;
    const state: SyncState = { running: true, tabs: [] };
    setSync({ ...state });
    try {
      const sheetTabs = (await api.catalogSheetTabs()).tabs;
      state.tabs = sheetTabs.map((t) => ({ tab: t.tab, status: 'รอ' }));
      setSync({ ...state, tabs: [...state.tabs] });
      const update = (i: number, patch: Partial<SyncTabResult>) => { state.tabs[i] = { ...state.tabs[i], ...patch }; setSync({ ...state, tabs: [...state.tabs] }); };
      const fresh = new Map<string, CatalogRow[]>();
      const queue = sheetTabs.map((t, i) => ({ ...t, i }));
      await Promise.all(Array.from({ length: SYNC_CONCURRENCY }, async () => {
        for (let t = queue.shift(); t; t = queue.shift()) {
          try {
            update(t.i, { status: 'กำลังอ่าน…' });
            const parsed = parseSheetTab(t.tab, await api.catalogCsv(t.gid));
            if (parsed.error) { update(t.i, { status: 'ข้าม', error: parsed.error }); continue; }
            const stored = rows.filter((r) => r.tab === t.tab);
            if (!parsed.rows.length && stored.length) { update(t.i, { status: 'ข้าม', error: 'แท็บว่าง — ไม่ลบของเดิม' }); continue; }
            const { upsert, remove } = diffTab(stored, parsed.rows);
            update(t.i, { status: 'กำลังบันทึก…', skus: parsed.rows.length, changed: upsert.length, removed: remove.length, duplicates: parsed.duplicates, skipped: parsed.skipped });
            const parts = Math.max(1, Math.ceil(upsert.length / SYNC_CHUNK));
            for (let p = 0; p < parts; p++) {
              const last = p === parts - 1;
              await api.catalogSync({
                tab: t.tab, gid: t.gid, sort: t.i,
                rows: upsert.slice(p * SYNC_CHUNK, (p + 1) * SYNC_CHUNK).map(rowToArray),
                remove: last ? remove : [],
                done: last ? { skus: parsed.rows.length } : null,
              });
            }
            fresh.set(t.tab, parsed.rows);
            update(t.i, { status: 'เสร็จ' });
          } catch (e: any) {
            update(t.i, { status: 'ผิดพลาด', error: e.message });
          }
        }
      }));
      // Use what was just read instead of downloading it again.
      setRows((old) => [...old.filter((r) => !fresh.has(r.tab)), ...[...fresh.values()].flat()]);
      setMeta(await api.catalog());
    } catch (e: any) {
      toast(e.message, 'bad');
    } finally {
      state.running = false;
      setSync({ ...state, tabs: [...state.tabs] });
    }
  }

  const addRequested = useRef(new URLSearchParams(location.search).get('add') === '1');
  useEffect(() => {
    if (!addRequested.current || loading || !tabs.length || !canEdit) return;
    addRequested.current = false;
    if (missingSku) addFromQuery();
  });

  function addFromQuery() {
    const [prefix, loc, color, size] = query.trim().toUpperCase().split('-');
    const tabOf = tabs.find((t) => locationOf(rows, t.tab) === loc)?.tab ?? '';
    setAdding({ tab: tabOf, code: prefix, color, size, _prefix: prefix, _loc: loc } as any);
  }

  async function removeWeb(w: WebSku) {
    const ok = await confirm({ title: `ลบ ${w.sku}?`, body: <p>ลบเฉพาะรายการที่เพิ่มจากเว็บ ไม่แตะ Google Sheet</p>, confirmLabel: 'ลบ', tone: 'danger' });
    if (!ok) return;
    try {
      await api.deleteWebSku(w.sku);
      setMeta((m) => (m ? { ...m, web: m.web.filter((x) => x.sku !== w.sku) } : m));
      setOpen(null);
      toast(`ลบ ${w.sku} แล้ว`, 'ok');
    } catch (e: any) { toast(e.message, 'bad'); }
  }

  return (
    <div className="app catalog">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">SKU</span>
          <div>
            <h1>แคตตาล็อกสินค้า</h1>
            <p className="muted small clip">
              {loading ? (loading.of ? `กำลังโหลด ${num(loading.done)} / ${num(loading.of)} SKU…` : 'กำลังโหลด…') : `${num(skuCount)} SKU · ${num(products.length)} รุ่น/สี · ดึงชีตล่าสุด ${dateTime(lastSync)}`}
            </p>
          </div>
        </div>
        <div className="row-actions">
          <a className="button" href="/catalog/orders">ใบสั่งสินค้า <Icon name="chevron" size={14} /></a>
          {canEdit && <>
            <button onClick={startSync} disabled={!!loading || !!sync?.running}><Icon name="refresh" size={14} /> {sync?.running ? 'กำลังดึง…' : 'ดึงจากชีต'}</button>
            <button className="primary" onClick={() => setAdding({})} disabled={!tabs.length}>+ เพิ่ม SKU</button>
          </>}
        </div>
      </header>

      <div className="cat-search">
        <label className="search">
          <span className="ico"><Icon name="search" size={16} /></span>
          <input
            type="text" inputMode="search" enterKeyHint="search" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
            placeholder="ค้นหา SKU, รหัสสินค้า, ชื่อ, สี, ร้านค้า, รหัสแทน · เช่น 501/1 32 หรือ 2004-BB-BI-38"
            aria-label="ค้นหาสินค้า"
          />
          {query && <button className="icon-btn" onClick={() => setQuery('')} aria-label="ล้างคำค้น"><Icon name="x" size={16} /></button>}
        </label>
      </div>

      {error && <div className="card bad">{error} <button className="small" onClick={load}>ลองใหม่</button></div>}

      {!loading && !error && meta && !meta.sheet_configured && (role === 'owner' || role === 'admin') && (
        <SheetLinkCard onSaved={() => { setMeta({ ...meta, sheet_configured: true }); startSync(); }} />
      )}
      {!loading && !error && !tabs.length && meta?.sheet_configured && (
        <div className="card empty-state">
          <h2>ยังไม่มีข้อมูลสินค้า</h2>
          <p className="muted">{canEdit ? 'กด "ดึงจากชีต" เพื่ออ่านทุกแท็บโกดังจาก Google Sheet SKU+Price (ครั้งแรกใช้เวลาราว 1 นาที)' : 'ให้ผู้ดูแลกด "ดึงจากชีต" ก่อน'}</p>
        </div>
      )}
      {!loading && !error && meta && !meta.sheet_configured && !(role === 'owner' || role === 'admin') && (
        <div className="card empty-state"><h2>ยังไม่ได้เชื่อมชีต</h2><p className="muted">ให้เจ้าของหรือผู้ดูแลเปิดหน้านี้แล้ววางลิงก์ Google Sheet SKU+Price</p></div>
      )}

      {tabs.length > 0 && (
        <div className="cat-filters">
          <div className="cat-chips" role="tablist" aria-label="โกดัง">
            <button role="tab" aria-selected={activeTab === ALL} className={activeTab === ALL ? 'on' : ''} onClick={() => setTab(ALL)}>ทุกโกดัง <span>{num(hits.length)}</span></button>
            {tabs.map((t) => (
              <button key={t.tab} role="tab" aria-selected={activeTab === t.tab} className={activeTab === t.tab ? 'on' : ''} onClick={() => setTab(t.tab)} disabled={!byTab.get(t.tab) && activeTab !== t.tab}>
                <b>{t.tab}</b>{WAREHOUSE_NAMES[t.tab] && <em>{WAREHOUSE_NAMES[t.tab]}</em>} <span>{num(byTab.get(t.tab) ?? 0)}</span>
              </button>
            ))}
            {web.length > 0 && <button role="tab" aria-selected={activeTab === WEB} className={activeTab === WEB ? 'on' : ''} onClick={() => setTab(WEB)}>เพิ่มจากเว็บ <span>{num(web.length)}</span></button>}
          </div>
          {hasShops && (
            <div className="cat-chips sub" aria-label={`ร้านค้าในโกดัง ${activeTab}`}>
              <span className="muted small">ร้านค้า</span>
              <button className={!activeShop ? 'on' : ''} onClick={() => setShop('')}>ทุกร้าน <span>{num(inTab.length)}</span></button>
              {shopCounts.map(([s, n]) => (
                <button key={s} className={`${activeShop === s ? 'on' : ''} ${s === NO_SHOP || SHOP_STATUSES.has(s) ? 'status' : ''}`} onClick={() => setShop(activeShop === s ? '' : s)}>
                  {s} <span>{num(n)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === WEB ? (
        <WebList web={web} rows={rows} canEdit={canEdit} onEdit={setEditing} onRemove={removeWeb} />
      ) : (
        <>
          {missingSku && tabs.length > 0 && (
            <div className="card cat-missing">
              <span>ไม่มี SKU <code>{missingSku}</code> ในแคตตาล็อก{shown.length > 0 ? ' · ด้านล่างคือรายการที่คล้ายกัน' : ''}</span>
              {canEdit && <button className="primary small" onClick={addFromQuery}>+ เพิ่ม SKU นี้</button>}
            </div>
          )}
          {!loading && tabs.length > 0 && (
            <div className="cat-count-row">
              <p className="muted small cat-count">
                {deferred ? `พบ ${num(shown.length)} รุ่น/สี` : `${num(shown.length)} รุ่น/สี`}
                {activeTab !== ALL && ` ในโกดัง ${activeTab}${WAREHOUSE_NAMES[activeTab] ? ` ${WAREHOUSE_NAMES[activeTab]}` : ''}`}
                {activeShop && ` · ร้าน ${activeShop}`}
              </p>
              {(missingImages > 0 || noImage) && (
                <button className={`small cat-toggle ${noImage ? 'on' : ''}`} aria-pressed={noImage} onClick={() => setNoImage(!noImage)}>
                  {noImage ? '✓ ' : ''}ไม่มีรูป {num(missingImages)}
                </button>
              )}
            </div>
          )}
          <div className="cat-grid">
            {shown.slice(0, limit).map((h) => <ProductCard key={h.product.key} hit={h} showTab={activeTab === ALL} onOpen={() => setOpen(h.product)} />)}
          </div>
          {shown.length > limit && <div ref={sentinel} className="cat-more muted small">กำลังแสดงเพิ่ม…</div>}
          {!loading && tabs.length > 0 && (deferred || activeShop || noImage) && !shown.length && (
            <div className="card empty-state">
              <h2>{noImage && !missingImages ? 'ทุกรายการมีรูปแล้ว' : <>ไม่พบ "{deferred}"{activeTab !== ALL && ` ในโกดัง ${activeTab}`}{activeShop && ` ร้าน ${activeShop}`}</>}</h2>
              {activeShop && inTab.length > 0 && <p><button className="small" onClick={() => setShop('')}>ค้นทุกร้านใน {activeTab} ({num(inTab.length)})</button></p>}
              {activeTab !== ALL && hits.length > 0 && <p><button className="small" onClick={() => setTab(ALL)}>ค้นทุกโกดัง ({num(hits.length)})</button></p>}
            </div>
          )}
        </>
      )}


      {open && (
        <ProductModal
          product={products.find((p) => p.key === open.key) ?? open}
          canEdit={canEdit}
          onClose={() => setOpen(null)}
          onAdd={(p) => { setOpen(null); setAdding({ tab: p.tab, code: p.code, color: p.color, name: p.name, cost: p.cost?.[1] ?? null, price: p.price?.[1] ?? null, image: p.image, shop: p.shops[0] ?? '', alias: p.aliases[0] ?? '' }); }}
          onEdit={(w) => { setOpen(null); setEditing(w); }}
          onRemove={removeWeb}
          supplierNames={supplierNames}
          onSupplier={async (p, shop) => {
            try {
              await api.setSuppliers([{ tab: p.tab, spu: p.spu, shop }]);
              setMeta((m) => (m ? { ...m, suppliers: [...m.suppliers.filter((x) => x.key !== p.key), ...(shop ? [{ key: p.key, tab: p.tab, spu: p.spu, shop, updated_by: '', updated_at: new Date().toISOString() }] : [])] } : m));
              toast(shop ? `${p.code || p.spu} สั่งจาก ${shop}` : `${p.code || p.spu} กลับไปใช้ร้านตามชีต`, 'ok');
            } catch (e: any) { toast(e.message, 'bad'); }
          }}
          onImage={(image, removedKey) => setMeta((m) => (m ? { ...m, images: [...m.images.filter((i) => i.key !== (image?.key ?? removedKey)), ...(image ? [image] : [])] } : m))}
        />
      )}
      {adding && (
        <AddSkuModal
          initial={adding} rows={rows} web={web} tabs={tabs.map((t) => t.tab)}
          onClose={() => setAdding(null)}
          onSaved={(added) => {
            setMeta((m) => (m ? { ...m, web: [...added, ...m.web] } : m));
            setAdding(null);
            setQuery(spuOf(added[0].sku));
            setTab(added[0].tab);
            toast(`เพิ่ม ${added.length} SKU แล้ว`, 'ok');
          }}
        />
      )}
      {editing && (
        <EditWebModal
          sku={editing} tabs={tabs.map((t) => t.tab)} onClose={() => setEditing(null)}
          onSaved={(row) => { setMeta((m) => (m ? { ...m, web: m.web.map((x) => (x.sku === row.sku ? row : x)) } : m)); setEditing(null); toast(`บันทึก ${row.sku} แล้ว`, 'ok'); }}
        />
      )}
      {sync && <SyncModal state={sync} onClose={() => !sync.running && setSync(null)} />}
    </div>
  );
}

// ---- first-time setup ----

function SheetLinkCard({ onSaved }: { onSaved: () => void }) {
  const { toast } = useUi();
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api.setCatalogSheet(link); onSaved(); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  return (
    <div className="card">
      <h2>เชื่อม Google Sheet SKU+Price</h2>
      <p className="muted small">ใช้กับหน้าแคตตาล็อกเท่านั้น ไม่เปลี่ยนต้นทุนที่ระบบแอดใช้ · ชีตต้องแชร์แบบ "ทุกคนที่มีลิงก์ดูได้"</p>
      <div className="cat-sheet-link">
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" aria-label="ลิงก์ Google Sheet" />
        <button className="primary" onClick={save} disabled={busy || !link.trim()}>{busy ? 'กำลังบันทึก…' : 'บันทึกแล้วดึงข้อมูล'}</button>
      </div>
    </div>
  );
}

// ---- cards ----

/** `src` is used as given: cards pass the product's thumb, the product view its large picture. */
function ProductImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return <div className="cat-img none" aria-hidden="true"><span>{alt.slice(0, 8) || '?'}</span><small>{failed ? 'รูปเปิดไม่ได้' : 'ไม่มีรูป'}</small></div>;
  }
  return <img className="cat-img" src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

function ProductCard({ hit, showTab, onOpen }: { hit: Hit; showTab: boolean; onOpen: () => void }) {
  const p = hit.product;
  return (
    <button className="cat-card" onClick={onOpen}>
      <ProductImage src={p.thumb} alt={p.code || p.spu} />
      <div className="cat-body">
        <div className="cat-title">
          <b>{p.code || p.spu}</b>
          {p.color && <span className="pill">{colorLabel(p.color)}</span>}
          {showTab && <span className="pill tab">{p.tab}</span>}
          {p.web && <span className="pill web">เว็บ</span>}
        </div>
        <div className="cat-name">{p.name || <span className="muted">ไม่มีรายละเอียด</span>}</div>
        <div className="cat-sizes">
          {p.skus.map((r) => <span key={r.sku} className={`size ${hit.sizes.has(r.size) ? 'hit' : ''} ${r.web ? 'web' : ''}`}>{r.size || '—'}</span>)}
        </div>
        <div className="cat-foot small">
          <span>ทุน <b>{moneyRange(p.cost)}</b></span>
          <span>ขาย <b>{moneyRange(p.price)}</b></span>
          {p.shops.length > 0 && <span className="muted clip">{p.shops.join(', ')}</span>}
        </div>
      </div>
    </button>
  );
}

// ---- product detail ----

function copy(text: string, toast: (t: string, tone?: 'ok' | 'bad' | 'info') => void) {
  navigator.clipboard.writeText(text).then(() => toast(`คัดลอก ${text.length > 40 ? 'แล้ว' : text}`, 'ok'), () => toast('คัดลอกไม่ได้', 'bad'));
}

function ProductModal({ product: p, canEdit, onClose, onAdd, onEdit, onRemove, onImage, supplierNames, onSupplier }: {
  product: Product; canEdit: boolean; onClose: () => void; onAdd: (p: Product) => void; onEdit: (w: WebSku) => void; onRemove: (w: WebSku) => void;
  onImage: (image: CatalogImage | null, removedKey?: string) => void;
  supplierNames: string[]; onSupplier: (p: Product, shop: string) => Promise<void>;
}) {
  const { toast } = useUi();
  const hasSupplier = p.skus.some((r) => r.shop || r.alias || r.shop_price !== null);
  return (
    <Modal title={`${p.code || p.spu}${p.color ? ` · ${colorLabel(p.color)}` : ''}`} onClose={onClose} wide>
      <div className="cat-detail">
        {canEdit ? <ImageEditor product={p} onImage={onImage} /> : (
          <div className="cat-detail-img">
            <ProductImage src={p.image} alt={p.code || p.spu} />
            {p.image && <a className="small" href={p.image} target="_blank" rel="noreferrer noopener">เปิดรูปเต็ม</a>}
          </div>
        )}
        <div>
          <p>{p.name || <span className="muted">ไม่มีรายละเอียด</span>}</p>
          <dl className="cat-facts">
            <dt>โกดัง</dt><dd>{p.tab}</dd>
            <dt>SPU</dt><dd><code>{p.spu}</code> <button className="link small" onClick={() => copy(p.spu, toast)}>คัดลอก</button></dd>
            <dt>ทุน</dt><dd>{moneyRange(p.cost)}</dd>
            <dt>ราคาขาย</dt><dd>{moneyRange(p.price)}</dd>
            <dt>สั่งจาก</dt>
            <dd>
              {canEdit ? <SupplierPicker product={p} names={supplierNames} onSave={(shop) => onSupplier(p, shop)} />
                : p.shops.length ? p.shops.join(', ') : <span className="muted">ตามโกดัง {p.tab}</span>}
            </dd>
            {p.aliases.length > 0 && <><dt>รหัสแทน</dt><dd>{p.aliases.join(', ')}</dd></>}
          </dl>
          {canEdit && <button className="small" onClick={() => onAdd(p)}>+ เพิ่มไซส์/สีจากรุ่นนี้</button>}
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>SKU</th><th>ไซส์</th><th className="num">ทุน</th><th className="num">ราคา</th>
              {hasSupplier && <><th>ร้านค้า</th><th>รหัสแทน</th><th className="num">ราคาร้าน</th></>}
              <th>ที่มา</th>
            </tr>
          </thead>
          <tbody>
            {p.skus.map((r) => (
              <tr key={r.sku}>
                <td><button className="link" onClick={() => copy(r.sku, toast)} title="คัดลอก SKU"><code>{r.sku}</code></button></td>
                <td>{r.size || '—'}</td>
                <td className="num">{money(r.cost)}</td>
                <td className="num">{money(r.price)}</td>
                {hasSupplier && <><td>{r.shop || '—'}</td><td className="small">{r.alias || '—'}</td><td className="num">{money(r.shop_price)}</td></>}
                <td className="small">
                  {r.web ? (
                    <span>
                      <span className="pill web">เพิ่มจากเว็บ</span> <span className="muted">{r.web.created_by.split('@')[0]}</span>
                      {canEdit && <> <button className="link small" onClick={() => onEdit(r.web!)}>แก้</button> · <button className="link small danger" onClick={() => onRemove(r.web!)}>ลบ</button></>}
                    </span>
                  ) : <span className="muted">ชีต แถว {r.pos}{r.old_code ? ` · เดิม ${r.old_code}` : ''}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// ---- supplier ----

/** Who this product is ordered from on the order sheets. Set here wins over the sheet's ร้านค้า column. */
function SupplierPicker({ product: p, names, onSave }: { product: Product; names: string[]; onSave: (shop: string) => Promise<void> }) {
  const [value, setValue] = useState(p.supplier);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(p.supplier), [p.supplier]);
  const sheet = p.skus.map((r) => r.shop).filter(Boolean);
  const sheetText = sheet.length ? [...new Set(sheet)].join(', ') : '';
  const save = async (shop: string) => { setBusy(true); try { await onSave(shop.trim()); } finally { setBusy(false); } };
  return (
    <div className="cat-supplier">
      <div className="cat-img-link">
        <input value={value} onChange={(e) => setValue(e.target.value)} list="cat-supplier-names" placeholder={sheetText || `ตามโกดัง ${p.tab}`} aria-label="สั่งจากร้าน" />
        <datalist id="cat-supplier-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
        <button className="small primary" disabled={busy || value.trim() === p.supplier} onClick={() => save(value)}>บันทึก</button>
      </div>
      <small className="muted">
        {p.supplier ? <>ตั้งในเว็บ{sheetText && sheetText !== p.supplier ? ` (ชีต: ${sheetText})` : ''} · <button className="link small" disabled={busy} onClick={() => save('')}>ใช้ตามชีต</button></>
          : sheetText ? 'ตามชีต (คอลัมน์ ร้านค้า)' : `ไม่มีร้านในชีต · ใบสั่งจะอยู่ในโกดัง ${p.tab}`}
      </small>
    </div>
  );
}

// ---- product pictures ----

/** Picture box of the product view: upload, take a photo, paste (Ctrl+V), drop a file, or link one. */
function ImageEditor({ product: p, onImage }: { product: Product; onImage: (image: CatalogImage | null, removedKey?: string) => void }) {
  const { toast, confirm } = useUi();
  const [busy, setBusy] = useState('');
  const [linking, setLinking] = useState(false);
  const [link, setLink] = useState('');
  const [over, setOver] = useState(false);

  const upload = useCallback(async (file: Blob) => {
    if (!file.type.startsWith('image/')) { toast('ไฟล์นี้ไม่ใช่รูป', 'bad'); return; }
    setBusy('กำลังย่อรูป…');
    try {
      const pics = await productPictures(file);
      setBusy('กำลังอัปโหลด…');
      const { image } = await api.uploadCatalogImage(p.tab, p.spu, pics);
      onImage(image);
      toast(`บันทึกรูป ${p.code || p.spu} แล้ว (${num((pics.thumb.size + pics.full.size) / 1000)} KB)`, 'ok');
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }, [p.tab, p.spu, p.code, onImage, toast]);

  // Paste a picture copied from Line, Shopee or a screenshot while the product is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (file) { e.preventDefault(); upload(file); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [upload]);

  async function saveLink() {
    setBusy('กำลังบันทึก…');
    try {
      const { image } = await api.linkCatalogImage(p.tab, p.spu, link.trim());
      onImage(image);
      setLinking(false);
      setLink('');
      toast('บันทึกลิงก์รูปแล้ว', 'ok');
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }

  async function remove() {
    const ok = await confirm({ title: 'ลบรูปที่เพิ่มไว้?', body: <p>{p.imageSource === 'page' ? 'จะกลับไปใช้รูปจากชีต (คอลัมน์ J) ถ้ามี' : ''}</p>, confirmLabel: 'ลบรูป', tone: 'danger' });
    if (!ok) return;
    setBusy('กำลังลบ…');
    try {
      await api.deleteCatalogImage(p.tab, p.spu);
      onImage(null, p.key);
      toast('ลบรูปแล้ว', 'ok');
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }

  return (
    <div className="cat-detail-img">
      <div
        className={`cat-drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
      >
        <ProductImage src={p.image} alt={p.code || p.spu} />
        {busy && <div className="cat-busy">{busy}</div>}
      </div>
      <div className="small muted">
        {p.imageSource === 'page' ? 'รูปที่เพิ่มในเว็บ' : p.imageSource === 'sheet' ? 'รูปจากชีต (คอลัมน์ J)' : 'ยังไม่มีรูป'}
        {p.image && <> · <a href={p.image} target="_blank" rel="noreferrer noopener">เปิดรูปเต็ม</a></>}
      </div>
      <div className="cat-img-actions">
        <label className={`button small ${busy ? 'disabled' : ''}`}>
          {p.imageSource ? 'เปลี่ยนรูป' : '+ เพิ่มรูป'}
          <input type="file" accept="image/*" hidden disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
        </label>
        <button className="small ghost" disabled={!!busy} onClick={() => setLinking(!linking)}>วางลิงก์</button>
        {p.imageSource === 'page' && <button className="small ghost danger" disabled={!!busy} onClick={remove}>ลบรูปที่เพิ่ม</button>}
      </div>
      {linking && (
        <div className="cat-img-link">
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" aria-label="ลิงก์รูป" autoFocus />
          <button className="small primary" disabled={!!busy || !link.trim().startsWith('https://')} onClick={saveLink}>บันทึก</button>
        </div>
      )}
      <p className="small muted cat-hint">กด Ctrl+V / ⌘V วางรูปที่คัดลอกไว้ หรือลากไฟล์มาวางบนรูป · บนมือถือกด "เพิ่มรูป" เพื่อถ่ายรูปได้</p>
    </div>
  );
}

// ---- adding SKUs ----

const SIZE_PRESETS: [string, string][] = [['28–36', '28 29 30 31 32 34 36'], ['28–44', '28 29 30 31 32 34 36 38 40 42 44'], ['S–XL', 'S M L XL'], ['M–5XL', 'M L XL 2XL 3XL 4XL 5XL'], ['Free', 'FE']];

function AddSkuModal({ initial, rows, web, tabs, onClose, onSaved }: {
  initial: Partial<WebSkuInput> & { _prefix?: string; _loc?: string }; rows: CatalogRow[]; web: WebSku[]; tabs: string[];
  onClose: () => void; onSaved: (rows: WebSku[]) => void;
}) {
  const { toast } = useUi();
  const [tab, setTab] = useState(initial.tab || tabs[0] || '');
  const [code, setCode] = useState(initial.code ?? '');
  const [prefix, setPrefix] = useState(initial._prefix ?? codeToPrefix(initial.code ?? ''));
  const [prefixTouched, setPrefixTouched] = useState(!!initial._prefix);
  const [loc, setLoc] = useState(initial._loc ?? locationOf(rows, initial.tab || tabs[0] || ''));
  const [locTouched, setLocTouched] = useState(!!initial._loc);
  const [color, setColor] = useState(initial.color ?? '');
  const [sizes, setSizes] = useState(initial.size ?? '');
  const [name, setName] = useState(initial.name ?? '');
  const [cost, setCost] = useState(initial.cost != null ? String(initial.cost) : '');
  const [price, setPrice] = useState(initial.price != null ? String(initial.price) : '');
  const [image, setImage] = useState(initial.image ?? '');
  const [shop, setShop] = useState(initial.shop ?? '');
  const [alias, setAlias] = useState(initial.alias ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!prefixTouched) setPrefix(codeToPrefix(code)); }, [code, prefixTouched]);
  useEffect(() => { if (!locTouched) setLoc(locationOf(rows, tab)); }, [tab, rows, locTouched]);

  const sheetKeys = useMemo(() => new Set(rows.map((r) => skuKey(r.sku))), [rows]);
  const webKeys = useMemo(() => new Set(web.map((w) => skuKey(w.sku))), [web]);
  const shops = useMemo(() => [...new Set(rows.filter((r) => r.tab === tab && r.shop).map((r) => r.shop))].sort(), [rows, tab]);
  const colors = useMemo(() => [...new Set([...Object.keys(COLOR_NAMES), ...rows.map((r) => r.color.toUpperCase()).filter((c) => /^[A-Z]{2,5}$/.test(c))])].sort(), [rows]);
  const sizeList = parseSizes(sizes);
  const planned = prefix && loc && color ? sizeList.map((size) => {
    const sku = buildSku(prefix, loc, color, size);
    const status = sheetKeys.has(skuKey(sku)) ? 'มีในชีตแล้ว' : webKeys.has(skuKey(sku)) ? 'เพิ่มจากเว็บแล้ว' : 'ใหม่';
    return { sku, size, status };
  }) : [];
  const fresh = planned.filter((p) => p.status === 'ใหม่');

  async function save() {
    if (!fresh.length) return;
    setBusy(true);
    try {
      const items: WebSkuInput[] = fresh.map((p) => ({
        sku: p.sku, tab, code, name, color: color.toUpperCase(), size: p.size,
        cost: cost === '' ? null : Number(cost), price: price === '' ? null : Number(price), image: image.trim(), shop, alias, note,
      }));
      onSaved((await api.addWebSkus(items)).rows);
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }

  return (
    <Modal title="เพิ่ม SKU" onClose={onClose} wide>
      <p className="muted small">SKU = [รหัส]-[โกดัง]-[สี]-[ขนาด] · เก็บในเว็บ ใช้ค้นหาได้ทันที แล้วค่อยคัดลอกไปวางในชีต (แท็บ "เพิ่มจากเว็บ")</p>
      <div className="cat-form">
        <label>โกดัง (แท็บ)
          <select value={tab} onChange={(e) => setTab(e.target.value)}>{tabs.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        </label>
        <label>รหัสสินค้า (คอลัมน์ C)
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="เช่น 501/1" autoFocus />
        </label>
        <label>ส่วนหน้า SKU
          <input value={prefix} onChange={(e) => { setPrefix(e.target.value.toUpperCase()); setPrefixTouched(true); }} placeholder="5011" />
        </label>
        <label>รหัสโกดังใน SKU
          <input value={loc} onChange={(e) => { setLoc(e.target.value.toUpperCase()); setLocTouched(true); }} placeholder="BB" />
        </label>
        <label>สี
          <input value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} list="cat-colors" placeholder="เช่น MD" />
          <datalist id="cat-colors">{colors.map((c) => <option key={c} value={c}>{COLOR_NAMES[c] ?? ''}</option>)}</datalist>
          {color && <small>{COLOR_NAMES[color] ?? 'ยังไม่มีในคู่มือ'}</small>}
        </label>
        <label className="span2">ไซส์ (เว้นวรรคระหว่างไซส์)
          <input value={sizes} onChange={(e) => setSizes(e.target.value)} placeholder="28 29 30 31 32 34 36" />
          <span className="chips">{SIZE_PRESETS.map(([label, v]) => <button key={label} type="button" className="chip add" onClick={() => setSizes(v)}>{label}</button>)}</span>
        </label>
        <label className="span3">รายละเอียด (คอลัมน์ D)
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="501/1 กางเกงยีนส์ ขากระบอก ผ้าไม่ยืด สีมิดไนท์" />
        </label>
        <label>ทุน (H)<input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d.]/g, ''))} /></label>
        <label>ราคาขาย (I)<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))} /></label>
        <label>ร้านค้า
          <input value={shop} onChange={(e) => setShop(e.target.value)} list="cat-shops" placeholder={shops.length ? 'เลือกหรือพิมพ์' : ''} />
          <datalist id="cat-shops">{shops.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="span2">ลิงก์รูป (J)
          <input value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…" />
        </label>
        <label>รหัสแทน<input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="รหัสของร้านค้า" /></label>
        <label className="span3">หมายเหตุ<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      {image.startsWith('https://') && <div className="cat-preview"><ProductImage src={image} alt="ตัวอย่างรูป" /></div>}
      {planned.length > 0 && (
        <div className="chips" style={{ marginTop: 12 }}>
          {planned.map((p) => <span key={p.sku} className={`chip ${p.status === 'ใหม่' ? '' : 'missing'}`} style={{ paddingRight: 10 }}><code>{p.sku}</code>{p.status !== 'ใหม่' && ` · ${p.status}`}</span>)}
        </div>
      )}
      <div className="dialog-actions">
        <button className="ghost" onClick={onClose}>ยกเลิก</button>
        <button className="primary" onClick={save} disabled={busy || !fresh.length || !tab}>
          {busy ? 'กำลังบันทึก…' : fresh.length ? `เพิ่ม ${fresh.length} SKU` : 'ใส่รหัส สี และไซส์'}
        </button>
      </div>
    </Modal>
  );
}

function EditWebModal({ sku, tabs, onClose, onSaved }: { sku: WebSku; tabs: string[]; onClose: () => void; onSaved: (row: WebSku) => void }) {
  const { toast } = useUi();
  const [v, setV] = useState({ ...sku, cost: sku.cost ?? '', price: sku.price ?? '' } as any);
  const [busy, setBusy] = useState(false);
  const field = (k: string, label: string, props: Record<string, unknown> = {}) => (
    <label {...(props.span ? { className: `span${props.span}` } : {})}>{label}<input value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>
  );
  async function save() {
    setBusy(true);
    try {
      const { row } = await api.updateWebSku(sku.sku, { ...v, cost: v.cost === '' ? null : Number(v.cost), price: v.price === '' ? null : Number(v.price) });
      onSaved(row);
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  return (
    <Modal title={`แก้ ${sku.sku}`} onClose={onClose} wide>
      <div className="cat-form">
        <label>โกดัง<select value={v.tab} onChange={(e) => setV({ ...v, tab: e.target.value })}>{tabs.map((t) => <option key={t}>{t}</option>)}</select></label>
        {field('code', 'รหัสสินค้า')}{field('color', 'สี')}{field('size', 'ไซส์')}
        {field('name', 'รายละเอียด', { span: 3 })}
        {field('cost', 'ทุน')}{field('price', 'ราคาขาย')}{field('shop', 'ร้านค้า')}
        {field('image', 'ลิงก์รูป', { span: 2 })}{field('alias', 'รหัสแทน')}
        {field('note', 'หมายเหตุ', { span: 3 })}
      </div>
      <div className="dialog-actions">
        <button className="ghost" onClick={onClose}>ยกเลิก</button>
        <button className="primary" onClick={save} disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
      </div>
    </Modal>
  );
}

// ---- SKUs added on the website ----

function WebList({ web, rows, canEdit, onEdit, onRemove }: { web: WebSku[]; rows: CatalogRow[]; canEdit: boolean; onEdit: (w: WebSku) => void; onRemove: (w: WebSku) => void }) {
  const { toast } = useUi();
  const sheetKeys = useMemo(() => new Set(rows.map((r) => skuKey(r.sku))), [rows]);
  const byTab = useMemo(() => {
    const m = new Map<string, WebSku[]>();
    for (const w of [...web].sort((a, b) => a.sku.localeCompare(b.sku))) m.set(w.tab, [...(m.get(w.tab) ?? []), w]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [web]);
  return (
    <>
      <p className="muted small cat-count">SKU ที่เพิ่มจากเว็บ ยังไม่อยู่ในชีต · กด "คัดลอกไปวางในชีต" แล้ววางที่แถวว่างท้ายแท็บนั้น (คอลัมน์ A) · เมื่อดึงชีตแล้วเจอ SKU เดียวกัน จะขึ้น "มีในชีตแล้ว" ให้ลบรายการนี้ได้</p>
      {byTab.map(([tab, list]) => {
        const pending = list.filter((w) => !sheetKeys.has(skuKey(w.sku)));
        return (
          <section key={tab} className="card table-card">
            <div className="table-card-head">
              <h2>{tab} <span className="muted small">({num(list.length)})</span></h2>
              {pending.length > 0 && (
                <button className="small" onClick={() => copy(toSheetTsv(pending, (t) => locationOf(rows, t)), toast)}>คัดลอก {pending.length} แถวไปวางในชีต</button>
              )}
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>SKU</th><th>รหัส</th><th>รายละเอียด</th><th className="num">ทุน</th><th className="num">ราคา</th><th>ร้านค้า</th><th>เพิ่มโดย</th><th /></tr></thead>
                <tbody>
                  {list.map((w) => (
                    <tr key={w.sku}>
                      <td><code>{w.sku}</code>{sheetKeys.has(skuKey(w.sku)) && <div className="good small">มีในชีตแล้ว</div>}</td>
                      <td>{w.code}</td>
                      <td className="small">{w.name}{w.note && <div className="muted">{w.note}</div>}</td>
                      <td className="num">{money(w.cost)}</td>
                      <td className="num">{money(w.price)}</td>
                      <td>{w.shop || '—'}</td>
                      <td className="small muted">{w.created_by.split('@')[0]}<div>{dateTime(w.created_at)}</div></td>
                      <td>{canEdit && <span className="small"><button className="link small" onClick={() => onEdit(w)}>แก้</button> · <button className="link small danger" onClick={() => onRemove(w)}>ลบ</button></span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}

// ---- sync progress ----

interface SyncTabResult { tab: string; status: string; skus?: number; changed?: number; removed?: number; duplicates?: string[]; skipped?: number; error?: string }
interface SyncState { running: boolean; tabs: SyncTabResult[] }

function SyncModal({ state, onClose }: { state: SyncState; onClose: () => void }) {
  const dups = state.tabs.flatMap((t) => (t.duplicates ?? []).map((d) => `${t.tab}: ${d}`));
  const changed = state.tabs.reduce((n, t) => n + (t.changed ?? 0) + (t.removed ?? 0), 0);
  return (
    <Modal title={state.running ? 'กำลังดึงจากชีต…' : 'ดึงจากชีตเสร็จแล้ว'} onClose={onClose}>
      {!state.tabs.length && <p className="muted">กำลังอ่านรายชื่อแท็บ…</p>}
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>แท็บ</th><th>สถานะ</th><th className="num">SKU</th><th className="num">เปลี่ยน</th><th className="num">ลบ</th></tr></thead>
          <tbody>
            {state.tabs.map((t) => (
              <tr key={t.tab}>
                <td><b>{t.tab}</b></td>
                <td className={t.error ? 'bad small' : 'small'}>{t.status}{t.error && ` · ${t.error}`}</td>
                <td className="num">{t.skus !== undefined ? num(t.skus) : ''}</td>
                <td className="num">{t.changed !== undefined ? num(t.changed) : ''}</td>
                <td className="num">{t.removed !== undefined ? num(t.removed) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!state.running && state.tabs.length > 0 && <p className="small muted">บันทึก {num(changed)} แถวที่เปลี่ยน</p>}
      {dups.length > 0 && (
        <details className="small">
          <summary className="warn">SKU ซ้ำในชีต {num(dups.length)} รายการ (ใช้แถวแรก)</summary>
          <p className="muted">{dups.slice(0, 200).join(' · ')}{dups.length > 200 ? ' …' : ''}</p>
        </details>
      )}
      <div className="dialog-actions">
        <button className="primary" onClick={onClose} disabled={state.running}>{state.running ? 'รอสักครู่…' : 'ปิด'}</button>
      </div>
    </Modal>
  );
}
