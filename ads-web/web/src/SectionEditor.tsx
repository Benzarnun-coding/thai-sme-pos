import { useEffect, useState } from 'react';
import { api, type CostRow, type Section, type SectionView } from './api.ts';
import { baht, num } from './fmt.ts';

interface Props {
  section: SectionView;
  campaignNames: string[];
  onSaved: () => void;
}

const key = (p: { tab: string; code: string }) => `${p.tab}:${p.code}`;

export function SectionEditor({ section, campaignNames, onSaved }: Props) {
  const [draft, setDraft] = useState<Section>(() => strip(section));
  const [keywordText, setKeywordText] = useState(section.keywords.join(', '));
  const [known, setKnown] = useState<Map<string, CostRow>>(new Map());
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CostRow[]>([]);
  const [suggested, setSuggested] = useState<CostRow[]>([]);
  const [busy, setBusy] = useState(false);
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
    const unit = rows.length ? rows.reduce((s, r) => s + r.avg_cost, 0) / rows.length : null;
    const aov = section.totals.purchases ? section.totals.purchase_value / section.totals.purchases : null;
    const price = draft.price_per_order ?? aov;
    if (unit === null || price === null) return { unit, price, be: null as number | null, margin: null as number | null };
    const margin = price - unit * draft.units_per_order - draft.extra_cost_per_order;
    return { unit, price, margin, be: margin > 0 ? price / margin : Infinity };
  })();

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
    if (!confirm(`ลบสินค้า "${section.name}"? แคมเปญที่ผูกไว้จะกลับไปจับตามคำค้น`)) return;
    setBusy(true);
    try { await api.deleteSection(section.id); onSaved(); } catch (e: any) { setError(e.message); setBusy(false); }
  }

  return (
    <div className="editor">
      <div className="grid2">
        <label>ชื่อสินค้า/กลุ่มสินค้า
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        {!isDefault && (
          <label>คำในชื่อแคมเปญที่ให้เข้ากลุ่มนี้อัตโนมัติ (คั่นด้วย ,)
            <input value={keywordText} placeholder="เช่น 801, REV 801" onChange={(e) => setKeywordText(e.target.value)} />
          </label>
        )}
      </div>
      {isDefault && <p className="muted small">แคมเปญที่ไม่ตรงกับคำค้นของสินค้าไหนเลยจะมาอยู่ที่นี่ ถ้าผูกต้นทุนตรงนี้ จะใช้เป็นต้นทุนกลางของแคมเปญเหล่านั้น</p>}

      <h3>ต้นทุนสินค้า (จาก Google Sheet)</h3>
      <div className="chips">
        {linked.length === 0 && <span className="muted">ยังไม่ผูกสินค้า</span>}
        {linked.map(({ p, row }) => (
          <span key={key(p)} className={`chip ${row ? '' : 'missing'}`}>
            {p.tab} · {p.code} {row ? `· ทุน ${baht(row.avg_cost)}` : '· ไม่พบในชีต'}
            <button className="x" onClick={() => setDraft({ ...draft, products: draft.products.filter((x) => key(x) !== key(p)) })} aria-label="เอาออก">×</button>
          </span>
        ))}
      </div>
      {suggested.filter((r) => !has(r)).length > 0 && (
        <div className="suggest">
          <span className="muted small">รหัสที่น่าจะใช่ (จากชื่อแคมเปญ):</span>
          {suggested.filter((r) => !has(r)).map((r) => (
            <button key={key(r)} className="chip add" onClick={() => toggle(r)} title={r.name}>+ {r.tab} · {r.code} · {baht(r.avg_cost)}</button>
          ))}
        </div>
      )}
      <input placeholder="ค้นหารหัสหรือชื่อสินค้าในชีต เช่น 801, ni9, ขาสั้น" value={query} onChange={(e) => setQuery(e.target.value)} />
      {results.length > 0 && (
        <div className="results">
          {results.map((r) => (
            <label key={key(r)} className="result">
              <input type="checkbox" checked={has(r)} onChange={() => toggle(r)} />
              <span className="code">{r.tab} · {r.code}</span>
              <span className="name">{r.name}</span>
              <span className="cost">ทุน {baht(r.avg_cost)}{r.min_cost !== r.max_cost ? ` (${num(r.min_cost)}–${num(r.max_cost)})` : ''}</span>
            </label>
          ))}
        </div>
      )}

      <div className="grid3">
        <label>จำนวนตัวต่อออเดอร์
          <input type="number" step="0.1" value={draft.units_per_order} onChange={(e) => setDraft({ ...draft, units_per_order: Number(e.target.value) })} />
          <small>โปร 3 ตัว 799 = 3 · ถ้าลูกค้าซื้อหลายแบบใส่ค่าเฉลี่ย</small>
        </label>
        <label>ค่าใช้จ่ายอื่นต่อออเดอร์ (฿)
          <input type="number" value={draft.extra_cost_per_order} onChange={(e) => setDraft({ ...draft, extra_cost_per_order: Number(e.target.value) })} />
          <small>ค่าส่ง ค่าแพ็ค ค่าธรรมเนียม</small>
        </label>
        <label>ราคาขายต่อออเดอร์ (฿)
          <input type="number" value={draft.price_per_order ?? ''} placeholder={`ว่าง = ใช้ยอดเฉลี่ยจาก Meta`} onChange={(e) => setDraft({ ...draft, price_per_order: e.target.value === '' ? null : Number(e.target.value) })} />
          <small>ว่างไว้ = ใช้ยอดขายเฉลี่ยต่อออเดอร์จาก Meta</small>
        </label>
      </div>

      <div className="econ">
        <div><span>ทุน/ตัว</span><b>{baht(preview.unit, 2)}</b></div>
        <div><span>ราคา/ออเดอร์</span><b>{baht(preview.price)}</b></div>
        <div><span>กำไรต่อออเดอร์ (ก่อนค่าแอด)</span><b>{baht(preview.margin)}</b></div>
        <div><span>ROAS คุ้มทุน</span><b className={preview.be === Infinity ? 'bad' : ''}>{preview.be === null ? '–' : preview.be === Infinity ? 'ขายราคานี้ไม่มีกำไร' : num(preview.be, 2)}</b></div>
      </div>

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
