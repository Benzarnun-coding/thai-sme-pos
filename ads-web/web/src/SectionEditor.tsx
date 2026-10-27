import { useEffect, useState } from 'react';
import { useUi } from './ui.tsx';
import { api, tabLabel, WEB_TAB, type CostRow, type Section, type SectionView, type Tier } from './api.ts';
import { WebCostForm } from './WebCosts.tsx';
import { baht, bahtRange, num, profitTone } from './fmt.ts';

interface Props {
  section: SectionView;
  campaignNames: string[];
  /** COD surcharge included in the tagged value (share 0–1, fee in baht) + per-order fees (pct of value, fixed baht) */
  cod: { share: number; fee: number; pct?: number; per_order?: number };
  onSaved: () => void;
  /** A linked cost was edited (saved immediately, unlike the rest of the form) */
  onCostChanged?: () => void;
}

const key = (p: { tab: string; code: string }) => `${p.tab}:${p.code}`;

export function SectionEditor({ section, campaignNames, cod, onSaved, onCostChanged }: Props) {
  const { confirm } = useUi();
  const [draft, setDraft] = useState<Section>(() => strip(section));
  const [keywordText, setKeywordText] = useState(section.keywords.join(', '));
  const [known, setKnown] = useState<Map<string, CostRow>>(new Map());
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CostRow[]>([]);
  const [suggested, setSuggested] = useState<CostRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [editingCost, setEditingCost] = useState<string | null>(null);
  const [error, setError] = useState('');
  const isDefault = section.id === 'default';

  const remember = (rows: CostRow[]) => setKnown((m) => new Map([...m, ...rows.map((r) => [key(r), r] as const)]));

  // Load cost rows for linked products, and suggestions from the section's campaign names.
  useEffect(() => {
    Promise.all(section.products.map((p) => api.searchCosts(p.code)))
      .then((rs) => remember(rs.flatMap((r) => r.results)))
      .catch(() => {});
    const text = [section.name, ...section.keywords, ...campaignNames].join(' ');
    api.suggestCosts(text).then((r) => { setSuggested(r.results); remember(r.results); }).catch(() => {});
  }, [section.id]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(() => api.searchCosts(query).then((r) => { setResults(r.results); remember(r.results); }).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [query]);

  const linked = draft.products.map((p) => ({ p, row: known.get(key(p)) }));
  const has = (r: CostRow) => draft.products.some((p) => key(p) === key(r));
  const toggle = (r: CostRow) => setDraft((d) => ({
    ...d,
    products: has(r) ? d.products.filter((p) => key(p) !== key(r)) : [...d.products, { tab: r.tab, code: r.code }],
  }));

  // Same formula as worker/model.ts economics(), for a live preview before saving.
  const preview = (() => {
    const rows = linked.map((l) => l.row).filter((r): r is CostRow => Boolean(r));
    const unit = rows.length ? rows.reduce((s, r) => s + (r.catalog_cost ?? r.avg_cost), 0) / rows.length : null;
    const tiers = draft.tiers.filter((t) => t.units > 0 && t.price > 0);
    const sheetPrices = rows.map((r) => r.avg_price).filter((p) => p > 0);
    const perUnit = tiers.length
      ? tiers.map((t) => t.price / t.units)
      : draft.price_per_order !== null
        ? [draft.price_per_order / draft.units_per_order]
        : sheetPrices.length ? [sheetPrices.reduce((a, b) => a + b, 0) / sheetPrices.length] : [];
    const min = perUnit.length ? Math.min(...perUnit) : null;
    const max = perUnit.length ? Math.max(...perUnit) : null;
    const t = section.totals;
    const aov = t.purchases ? t.purchase_value / t.purchases : null;
    const be = (p: number | null) => {
      if (unit === null || p === null) return null;
      const margin = 1 - unit / p - (cod.pct ?? 0) + (aov ? (cod.fee * cod.share * unit / p - draft.extra_cost_per_order - (cod.per_order ?? 0)) / aov : 0);
      return margin > 0 ? 1 / margin : Infinity;
    };
    const rest = t.purchase_value * (1 - (cod.pct ?? 0)) - t.purchases * (draft.extra_cost_per_order + (cod.per_order ?? 0)) - t.spend;
    const goods = Math.max(0, t.purchase_value - cod.fee * cod.share * t.purchases);
    const profitLow = unit === null || min === null ? null : rest - (goods / min) * unit;
    const profitHigh = unit === null || max === null ? null : rest - (goods / max) * unit;
    return { unit, min, max, beWorst: be(min), beBest: be(max), profitLow, profitHigh, source: tiers.length ? 'tiers' : draft.price_per_order !== null ? 'manual' : sheetPrices.length ? 'sheet' : null };
  })();

  // Promo prices written in campaign names, e.g. "1 ตัว 189 (3ตัว549)" → 1 for 189, 3 for 549.
  const tierHints = (() => {
    const out = new Map<string, Tier>();
    for (const n of campaignNames) for (const m of n.matchAll(/(\d{1,2})\s*ตัว\s*(\d{2,5})/g)) {
      const t = { units: Number(m[1]), price: Number(m[2]) };
      if (t.units > 0 && !draft.tiers.some((x) => x.units === t.units && x.price === t.price)) out.set(`${t.units}:${t.price}`, t);
    }
    return [...out.values()].sort((a, b) => a.units - b.units || a.price - b.price);
  })();
  const setTier = (i: number, patch: Partial<Tier>) => setDraft((d) => ({ ...d, tiers: d.tiers.map((t, k) => (k === i ? { ...t, ...patch } : t)) }));
  const addTier = (t: Tier) => setDraft((d) => ({ ...d, tiers: [...d.tiers, t].sort((a, b) => a.units - b.units) }));

  async function save() {
    setBusy(true); setError('');
    try {
      await api.saveSection({ ...draft, keywords: keywordText.split(',').map((k) => k.trim()).filter(Boolean) });
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirm({ title: `ลบสินค้า "${section.name}"?`, body: <p className="muted">แคมเปญที่ผูกไว้จะกลับไปจับตามคำค้น</p>, confirmLabel: 'ลบ', tone: 'danger' }))) return;
    setBusy(true);
    try { await api.deleteSection(section.id); onSaved(); } catch (e: any) { setError(e.message); setBusy(false); }
  }

  return (
    <div className="editor">
      <div className="grid2">
        {!isDefault && (
          <label>ชื่อสินค้า/กลุ่มสินค้า
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
        )}
        {!isDefault && (
          <label>คำในชื่อแคมเปญที่ให้เข้ากลุ่มนี้อัตโนมัติ (คั่นด้วย ,)
            <input value={keywordText} placeholder="เช่น 801, REV 801" onChange={(e) => setKeywordText(e.target.value)} />
          </label>
        )}
      </div>
      {isDefault && (
        <div className="banner">
          นี่ไม่ใช่สินค้าตัวเดียว: ทุกแคมเปญที่ชื่อไม่ตรงคำค้นของสินค้าไหนเลย ({campaignNames.length} แคมเปญ) จะใช้ต้นทุนและโปรที่ตั้งตรงนี้ร่วมกัน
          — ถ้าจะตั้งต้นทุนให้สินค้าเฉพาะรุ่น ให้ปิดหน้านี้แล้วกด "+ เพิ่มสินค้า"
        </div>
      )}

      <h3>ต้นทุนสินค้า (จากชีต หรือกรอกเองในเว็บ)</h3>
      <div className="chips">
        {linked.length === 0 && <span className="muted">ยังไม่ผูกสินค้า</span>}
        {linked.map(({ p, row }) => (
          <span key={key(p)} className={`chip ${row ? '' : 'missing'}`}>
            {tabLabel(p.tab)} · {p.code} {row ? `· ทุน ${baht(row.avg_cost)}` : '· ไม่พบต้นทุน'}
            {row && p.tab === WEB_TAB && <button className="x" onClick={() => setEditingCost(p.code)} aria-label="แก้ต้นทุน" title="แก้ต้นทุน">✎</button>}
            <button className="x" onClick={() => setDraft({ ...draft, products: draft.products.filter((x) => key(x) !== key(p)) })} aria-label="เอาออก">×</button>
          </span>
        ))}
      </div>
      {editingCost && known.get(`${WEB_TAB}:${editingCost}`) && (
        <WebCostForm
          initial={known.get(`${WEB_TAB}:${editingCost}`)}
          onCancel={() => setEditingCost(null)}
          onSaved={(row) => { remember([row]); setEditingCost(null); onCostChanged?.(); }}
        />
      )}
      {suggested.filter((r) => !has(r)).length > 0 && (
        <div className="suggest">
          <span className="muted small">รหัสที่น่าจะใช่ (จากชื่อแคมเปญ):</span>
          {suggested.filter((r) => !has(r)).map((r) => (
            <button key={key(r)} className="chip add" onClick={() => toggle(r)} title={r.name}>+ {tabLabel(r.tab)} · {r.code} · {baht(r.avg_cost)}</button>
          ))}
        </div>
      )}
      <div className="row">
        <input className="grow" placeholder="ค้นหารหัสหรือชื่อสินค้า เช่น 801, ni9, ขาสั้น" value={query} onChange={(e) => setQuery(e.target.value)} />
        {!typing && <button className="ghost" onClick={() => setTyping(true)}>+ กรอกต้นทุนเอง</button>}
      </div>
      {typing && (
        <WebCostForm
          suggestCode={draft.keywords[0] ?? ''}
          onCancel={() => setTyping(false)}
          onSaved={(row) => {
            remember([row]);
            setDraft((d) => (d.products.some((p) => key(p) === key(row)) ? d : { ...d, products: [...d.products, { tab: row.tab, code: row.code }] }));
            setTyping(false);
          }}
        />
      )}
      {results.length > 0 && (
        <div className="results">
          {results.map((r) => (
            <label key={key(r)} className="result">
              <input type="checkbox" checked={has(r)} onChange={() => toggle(r)} />
              <span className="code">{tabLabel(r.tab)} · {r.code}</span>
              <span className="name">{r.name}</span>
              <span className="cost">ทุน {baht(r.avg_cost)}{r.min_cost !== r.max_cost ? ` (${num(r.min_cost)}–${num(r.max_cost)})` : ''}</span>
            </label>
          ))}
        </div>
      )}

      <h3>ราคาโปรที่ขายในแอด</h3>
      <p className="muted small">ระบบนับกำไรเป็น "ตัว": ยอดขายจาก Meta ÷ ราคาต่อตัว = จำนวนตัวที่ขาย แล้วหักทุนต่อตัว · ว่างไว้ = ใช้ราคาขายจากชีต (คอลัมน์ I)</p>
      <div className="tiers">
        {draft.tiers.map((t, i) => (
          <div key={i} className="tier">
            <input type="number" min={1} value={t.units} onChange={(e) => setTier(i, { units: Number(e.target.value) })} aria-label="จำนวนตัว" />
            <span className="muted">ตัว</span>
            <input type="number" min={1} value={t.price} onChange={(e) => setTier(i, { price: Number(e.target.value) })} aria-label="ราคา" />
            <span className="per">{t.units > 0 && t.price > 0 ? `= ${baht(t.price / t.units, 2)}/ตัว` : ''}</span>
            <button className="icon-btn" onClick={() => setDraft((d) => ({ ...d, tiers: d.tiers.filter((_, k) => k !== i) }))} aria-label="ลบโปรนี้">×</button>
          </div>
        ))}
        <div className="chips">
          <button className="chip add" onClick={() => addTier({ units: (draft.tiers.at(-1)?.units ?? 0) + 1, price: 0 })}>+ เพิ่มโปร</button>
          {tierHints.length > 0 && <span className="muted small">จากชื่อแคมเปญ:</span>}
          {tierHints.map((t) => (
            <button key={`${t.units}:${t.price}`} className="chip add" onClick={() => addTier(t)}>+ {t.units} ตัว {baht(t.price)}</button>
          ))}
        </div>
      </div>

      <details className="advanced" open={draft.extra_cost_per_order > 0 || draft.price_per_order !== null}>
        <summary>ขั้นสูง (ปกติไม่ต้องใส่)</summary>
        <div className="grid3">
          <label>ค่าใช้จ่ายเพิ่มต่อออเดอร์ (฿)
            <input type="number" value={draft.extra_cost_per_order} onChange={(e) => setDraft({ ...draft, extra_cost_per_order: Number(e.target.value) })} />
            <small>ใส่เฉพาะถ้าทุนในชีตยังไม่รวมค่าส่ง/แพ็ก</small>
          </label>
          <label>ราคาขายต่อออเดอร์ (฿)
            <input type="number" value={draft.price_per_order ?? ''} placeholder="ว่าง" onChange={(e) => setDraft({ ...draft, price_per_order: e.target.value === '' ? null : Number(e.target.value) })} />
            <small>ใช้เมื่อไม่มีโปรด้านบน</small>
          </label>
          <label>จำนวนตัวต่อออเดอร์
            <input type="number" step="0.1" value={draft.units_per_order} onChange={(e) => setDraft({ ...draft, units_per_order: Number(e.target.value) })} />
            <small>คู่กับราคาต่อออเดอร์</small>
          </label>
        </div>
      </details>

      <div className="econ">
        <div><span>ทุน/ตัว</span><b>{baht(preview.unit, 2)}</b></div>
        <div>
          <span>ราคาขาย/ตัว{preview.source === 'sheet' ? ' (ราคาเต็ม)' : ''}</span>
          <b>{preview.min === null ? '–' : preview.min === preview.max ? baht(preview.min, 2) : `${baht(preview.min, 2)}–${baht(preview.max, 2)}`}</b>
        </div>
        <div>
          <span>ROAS คุ้มทุน</span>
          <b className={preview.beWorst === Infinity ? 'bad' : ''}>
            {preview.beWorst === null ? '–' : preview.beWorst === Infinity ? 'ราคานี้ไม่มีกำไร' : preview.beBest !== null && preview.beWorst - preview.beBest >= 0.01 ? `${num(preview.beBest, 2)}–${num(preview.beWorst, 2)}` : num(preview.beWorst, 2)}
          </b>
        </div>
        <div><span>กำไร (ช่วงที่ดูอยู่)</span><b className={profitTone(preview.profitLow, preview.profitHigh)}>{bahtRange(preview.profitLow, preview.profitHigh)}</b></div>
      </div>
      <p className="muted small">กฎอัตโนมัติใช้ค่าคุ้มทุนที่สูงกว่า (สมมติว่าทุกออเดอร์เป็นโปรที่ถูกที่สุด) เพื่อไม่ให้เพิ่มงบเกินจริง</p>

      {error && <p className="error">{error}</p>}
      <div className="row between sticky-actions">
        {!isDefault ? <button className="danger ghost" disabled={busy} onClick={remove}>ลบสินค้านี้</button> : <span />}
        <button className="primary" disabled={busy} onClick={save}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
      </div>
    </div>
  );
}

function strip(s: SectionView): Section {
  const { totals: _t, economics: _e, campaign_count: _c, ...rest } = s;
  return rest;
}
