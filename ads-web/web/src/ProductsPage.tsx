import { useEffect, useMemo, useState } from 'react';
import { api, sectionName, tabLabel, windowLabel, type CampaignView, type CostTier, type Overview } from './api.ts';
import { WebCosts } from './WebCosts.tsx';
import { baht, bahtRange, num, profitTone, roasTone, when } from './fmt.ts';
import { Icon, useUi } from './ui.tsx';

/**
 * Costs as tables: per-campaign promo costs from the team's sheet first (what profit is counted with), then the
 * product-line costs used for campaigns the sheet doesn't list, then costs typed in the web.
 */
export function ProductsPage({ data, onEdit, onReload, onOpenCampaign }: {
  data: Overview; onEdit: (id: string) => void; onReload: () => void; onOpenCampaign: (id: string) => void;
}) {
  return (
    <>
      <CampaignCostTable data={data} onReload={onReload} onOpenCampaign={onOpenCampaign} />
      <ProductTable data={data} onEdit={onEdit} onReload={onReload} />
      <WebCosts sections={data.sections} campaignNames={data.campaigns.map((c) => c.name)} onChanged={onReload} />
    </>
  );
}

const key = (n: string) => n.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
type Filter = 'all' | 'loss' | 'missing';

function CampaignCostTable({ data, onReload, onOpenCampaign }: { data: Overview; onReload: () => void; onOpenCampaign: (id: string) => void }) {
  const { toast } = useUi();
  const [sheet, setSheet] = useState<{ synced_at: string | null; campaigns: { name: string; tiers: CostTier[] }[] } | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [syncing, setSyncing] = useState(false);
  const load = () => api.campaignCosts().then(setSheet).catch(() => setSheet({ synced_at: null, campaigns: [] }));
  useEffect(() => { load(); }, []);

  // Every campaign using a sheet block: by exact name, or the same name with another budget/version.
  const bySheet = useMemo(() => {
    const m = new Map<string, CampaignView[]>();
    for (const c of data.campaigns) if (c.cost_sheet_name) m.set(key(c.cost_sheet_name), [...(m.get(key(c.cost_sheet_name)) ?? []), c]);
    return m;
  }, [data.campaigns]);
  const profitOf = (cs: CampaignView[]) => (cs.some((c) => c.profit !== null) ? cs.reduce((t, c) => t + (c.profit ?? 0), 0) : null);
  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (sheet?.campaigns ?? [])
      .map((s) => ({ s, cs: bySheet.get(key(s.name)) ?? [] }))
      .filter(({ s, cs }) => words.every((w) => s.name.toLowerCase().includes(w) || cs.some((c) => c.name.toLowerCase().includes(w))))
      .filter(({ s, cs }) => filter === 'all'
        || (filter === 'missing' && !cs.length)
        || (filter === 'loss' && ((profitOf(cs) ?? 0) < 0 || s.tiers.some((t) => t.price <= t.cost))))
      .sort((a, b) => (profitOf(a.cs) ?? Infinity) - (profitOf(b.cs) ?? Infinity));
  }, [sheet, bySheet, q, filter]);
  const notInSheet = data.campaigns.filter((c) => c.status === 'ACTIVE' && !c.cost_sheet_name);

  async function sync() {
    setSyncing(true);
    try { const r = await api.syncCampaignCosts(); toast(`ดึงต้นทุน ${r.campaigns} แคมเปญแล้ว`, 'ok'); await load(); onReload(); }
    catch (e: any) { toast(e.message, 'bad'); }
    finally { setSyncing(false); }
  }

  if (!sheet) return <div className="skeleton" style={{ height: 240, margin: '12px 0' }} />;
  const missing = sheet.campaigns.filter((s) => !bySheet.has(key(s.name))).length;
  const losing = sheet.campaigns.filter((s) => s.tiers.some((t) => t.price <= t.cost) || (profitOf(bySheet.get(key(s.name)) ?? []) ?? 0) < 0).length;

  return (
    <section className="card table-card">
      <div className="table-card-head">
        <div>
          <h2>ต้นทุนรายแคมเปญ <span className="muted small">จากชีต "FB คำนวณค่า ADS" · {sheet.campaigns.length} แคมเปญ</span></h2>
          <p className="muted small">
            ทุน/ออเดอร์ รวมค่าส่ง ภาษี เสียหาย COD แล้ว · ROAS และกำไรช่วง {windowLabel(data.window)}
            {sheet.synced_at && <> · ดึงล่าสุด {when(sheet.synced_at)}</>} · แก้ตัวเลขในชีต
          </p>
        </div>
        <button className="ghost small" disabled={syncing} onClick={sync}><Icon name="refresh" size={14} /> {syncing ? 'กำลังดึง…' : 'ดึงใหม่'}</button>
      </div>
      {sheet.campaigns.length === 0 ? (
        <p className="muted small">ยังไม่ได้ผูกชีต — ใส่ลิงก์ชีตในหน้าตั้งค่า → "ชีตต้นทุนรายแคมเปญ"</p>
      ) : (
        <>
          <div className="list-tools flat">
            <label className="search">
              <Icon name="search" size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อแคมเปญ" />
            </label>
            <div className="segmented small">
              <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>ทั้งหมด</button>
              <button className={filter === 'loss' ? 'on' : ''} onClick={() => setFilter('loss')}>ขาดทุน ({losing})</button>
              <button className={filter === 'missing' ? 'on' : ''} onClick={() => setFilter('missing')}>ไม่เจอใน Meta ({missing})</button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>แคมเปญ</th>
                  <th>โปร</th>
                  <th className="num">ราคา</th>
                  <th className="num">ทุน/ออเดอร์</th>
                  <th className="num">เหลือก่อนค่าแอด</th>
                  <th className="num">คุ้มทุนที่ ROAS</th>
                  <th className="num">ROAS จริง</th>
                  <th className="num">กำไร</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ s, cs }) => s.tiers.map((t, i) => (
                  <tr key={`${s.name}:${i}`} className={`${i === 0 ? 'group-start' : ''} ${!cs.length ? 'dim' : ''}`}>
                    {i === 0 && (
                      <td rowSpan={s.tiers.length} className="campaign-cell">
                        <b>{s.name}</b>
                        {cs.length === 0 && <><br /><span className="small warn">ไม่เจอแคมเปญนี้ใน Meta</span></>}
                        {cs.map((c) => (
                          <div key={c.id} className="small">
                            <button className="name-link" onClick={() => onOpenCampaign(c.id)}><i className={`status-dot ${c.status === 'ACTIVE' ? 'on' : ''}`} />{c.cost_match === 'similar' ? c.name : 'เปิดดูแคมเปญ'}</button>
                            {c.cost_match === 'similar' && <span className="muted"> (ชื่อคล้าย)</span>}
                          </div>
                        ))}
                      </td>
                    )}
                    <TierCells t={t} />
                    {i === 0 && <CampaignResult cs={cs} rowSpan={s.tiers.length} />}
                  </tr>
                )))}
                {rows.length === 0 && <tr><td colSpan={8} className="muted center">ไม่มีแคมเปญที่ตรงกับตัวกรอง</td></tr>}
              </tbody>
            </table>
          </div>
          {notInSheet.length > 0 && (
            <details className="not-in-sheet">
              <summary className="small"><b className="warn">แคมเปญที่เปิดอยู่แต่ไม่มีในชีต {notInSheet.length} ตัว</b> — ใช้ต้นทุนตามสินค้าแทน ถ้าต้องการต้นทุนแม่นๆ ให้เพิ่มชื่อเหล่านี้ในชีต</summary>
              <ul className="notes small">
                {notInSheet.map((c) => <li key={c.id}><button className="name-link" onClick={() => onOpenCampaign(c.id)}>{c.name}</button></li>)}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function TierCells({ t }: { t: CostTier }) {
  const margin = t.price - t.cost;
  return (
    <>
      <td>{t.units} ตัว</td>
      <td className="num">{baht(t.price)}</td>
      <td className="num">{baht(t.cost, 2)}</td>
      <td className={`num ${margin <= 0 ? 'bad' : ''}`}>{baht(margin, 2)} <span className="muted small">{num((margin / t.price) * 100)}%</span></td>
      <td className={`num ${margin <= 0 ? 'bad' : ''}`}>{margin > 0 ? num(t.price / margin, 2) : 'ขาดทุน'}</td>
    </>
  );
}

/** ROAS and profit of every campaign using this sheet block, added up. */
function CampaignResult({ cs, rowSpan }: { cs: CampaignView[]; rowSpan: number }) {
  if (!cs.length) return <><td rowSpan={rowSpan} className="num muted">–</td><td rowSpan={rowSpan} className="num muted">–</td></>;
  const spend = cs.reduce((t, c) => t + (c.metrics?.spend ?? 0), 0);
  const value = cs.reduce((t, c) => t + (c.metrics?.purchase_value ?? 0), 0);
  const r = spend > 0 ? value / spend : null;
  const withProfit = cs.filter((c) => c.profit !== null);
  const low = withProfit.length ? withProfit.reduce((t, c) => t + c.profit!, 0) : null;
  const high = withProfit.length ? withProfit.reduce((t, c) => t + (c.profit_high ?? c.profit!), 0) : null;
  return (
    <>
      <td rowSpan={rowSpan} className={`num strong ${roasTone(r, cs[0].breakeven_roas)}`}>{r === null ? '–' : num(r, 2)}</td>
      <td rowSpan={rowSpan} className={`num strong ${profitTone(low, high)}`} title={low === null ? undefined : `ประมาณ ${bahtRange(low, high)}${cs.length > 1 ? ` · รวม ${cs.length} แคมเปญ` : ''}`}>
        {low === null ? '–' : baht(low)}
      </td>
    </>
  );
}

/** Product lines: the cost for campaigns the sheet doesn't list (matched by keyword in the campaign name). */
function ProductTable({ data, onEdit, onReload }: { data: Overview; onEdit: (id: string) => void; onReload: () => void }) {
  const { toast } = useUi();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const s = await api.createSection({ name: name.trim(), keywords: [], products: [], tiers: [], units_per_order: 1, extra_cost_per_order: 0, price_per_order: null });
      setName('');
      onReload();
      onEdit(s.id);
    } catch (err: any) {
      toast(err.message, 'bad');
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="card table-card">
      <div className="table-card-head">
        <div>
          <h2>ต้นทุนตามสินค้า <span className="muted small">สำรอง สำหรับแคมเปญที่ไม่อยู่ในชีตรายแคมเปญ</span></h2>
          <p className="muted small">แคมเปญจับคู่สินค้าจากคำในชื่อ · ทุนต่อตัวจากชีต SKU+Price หรือที่กรอกในเว็บ · ราคาจากโปรในชื่อแคมเปญ</p>
        </div>
        <form className="row" onSubmit={create}>
          <input placeholder="ชื่อสินค้าใหม่" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="primary small" disabled={creating || !name.trim()}>+ เพิ่ม</button>
        </form>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>สินค้า</th>
              <th>คำค้น</th>
              <th>ต้นทุนที่ผูก</th>
              <th className="num">ทุน/ตัว</th>
              <th className="num">ราคา/ตัว</th>
              <th className="num">คุ้มทุนที่ ROAS</th>
              <th className="num">แคมเปญ</th>
              <th className="num">กำไร</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.sections.map((s) => {
              const e = s.economics;
              return (
                <tr key={s.id}>
                  <td><b>{sectionName(s)}</b></td>
                  <td className="small">{s.keywords.join(', ') || <span className="muted">–</span>}</td>
                  <td className="small">
                    {s.products.length === 0
                      ? <span className="warn">ยังไม่ผูก</span>
                      : s.products.map((p) => `${tabLabel(p.tab)} · ${p.code}`).join(', ')}
                    {e.missing_products.length > 0 && <span className="bad"> · ไม่พบ {e.missing_products.length}</span>}
                  </td>
                  <td className="num" title={e.catalog_codes.length ? `แคตตาล็อก: ${e.catalog_codes.join(', ')}` : undefined}>
                    {baht(e.cost_per_unit, 2)}
                    {e.cost_from && <div className={`small ${e.cost_from === 'catalog' ? 'muted' : 'warn'}`}>{e.cost_from === 'catalog' ? 'แคตตาล็อก' : e.cost_from === 'typed' ? 'พิมพ์เอง (ไม่พบในแคตตาล็อก)' : 'แคตตาล็อก + พิมพ์เอง'}</div>}
                  </td>
                  <td className="num">{e.price_per_unit_min === null ? '–' : e.price_per_unit_min === e.price_per_unit_max ? baht(e.price_per_unit_min) : `${baht(e.price_per_unit_min)}–${baht(e.price_per_unit_max)}`}</td>
                  <td className={`num ${e.never_profitable ? 'bad' : ''}`}>{e.never_profitable ? 'ขาดทุน' : num(e.breakeven_roas, 2)}</td>
                  <td className="num">{s.campaign_count}</td>
                  <td className={`num ${profitTone(e.profit, e.profit_high)}`}>{bahtRange(e.profit, e.profit_high)}</td>
                  <td><button className="ghost small" onClick={() => onEdit(s.id)}>แก้</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
