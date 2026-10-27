// Costs typed into the dashboard instead of the Google Sheet. Stored like a sheet code under the pseudo tab WEB,
// so sections link them, rules use them, and a sheet sync never overwrites them.

import { useEffect, useState } from 'react';
import { api, sectionName, WEB_TAB, type CostRow, type SectionView } from './api.ts';
import { baht } from './fmt.ts';
import { useUi } from './ui.tsx';

/** Add or edit one cost. `initial` = editing (code fixed). */
export function WebCostForm({ initial, suggestCode, onSaved, onCancel }: {
  initial?: CostRow; suggestCode?: string; onSaved: (row: CostRow) => void; onCancel?: () => void;
}) {
  const { toast } = useUi();
  const [code, setCode] = useState(initial?.code ?? suggestCode ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [cost, setCost] = useState(initial ? String(initial.avg_cost) : '');
  const [price, setPrice] = useState(initial && initial.avg_price > 0 ? String(initial.avg_price) : '');
  const [busy, setBusy] = useState(false);
  const ok = code.trim() && Number(cost) > 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    const c = { code: code.trim(), name: name.trim() || code.trim(), cost: Number(cost), price: price === '' ? null : Number(price) };
    try {
      await api.saveWebCost(c);
      toast(initial ? 'แก้ต้นทุนแล้ว' : 'เพิ่มต้นทุนแล้ว', 'ok');
      onSaved({ tab: WEB_TAB, code: c.code, name: c.name, sku_count: 1, avg_cost: c.cost, min_cost: c.cost, max_cost: c.cost, avg_price: c.price ?? 0 });
    } catch (err: any) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="web-cost-form" onSubmit={save}>
      <label>รหัสสินค้า
        <input value={code} disabled={Boolean(initial)} placeholder="เช่น 801" onChange={(e) => setCode(e.target.value)} autoFocus={!initial} />
      </label>
      <label>ชื่อ
        <input value={name} placeholder="เช่น กระบอกยืด 801" onChange={(e) => setName(e.target.value)} />
      </label>
      <label>ทุนดิบ/ตัว (฿) — ใช้เมื่อแคตตาล็อกไม่มีรุ่นนี้
        <input type="number" inputMode="decimal" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} autoFocus={Boolean(initial)} />
        <small>ราคาที่จ่ายร้าน ไม่รวมค่าส่ง/ตีกลับ (หักแยกในหน้าตั้งค่า)</small>
      </label>
      <label>ราคาเต็ม/ตัว (฿)
        <input type="number" inputMode="decimal" min={0} value={price} placeholder="ไม่บังคับ" onChange={(e) => setPrice(e.target.value)} />
        <small className={price === '' ? 'warn' : ''}>{price === '' ? 'ว่าง = คิดกำไรได้เฉพาะแคมเปญที่ชื่อมีโปร เช่น "3ตัว549"' : 'ใช้เมื่อชื่อแคมเปญไม่มีราคาโปร'}</small>
      </label>
      <div className="web-cost-actions">
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>ยกเลิก</button>}
        <button className="primary" disabled={!ok || busy}>{busy ? 'กำลังบันทึก…' : initial ? 'บันทึก' : 'เพิ่ม'}</button>
      </div>
    </form>
  );
}

/** The list on the products page: add, edit, delete. */
export function WebCosts({ sections, campaignNames, onChanged }: { sections: SectionView[]; campaignNames: string[]; onChanged: () => void }) {
  const { confirm, toast } = useUi();
  const [rows, setRows] = useState<CostRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const load = () => api.webCosts().then((r) => setRows(r.results)).catch((e) => toast(e.message, 'bad'));
  useEffect(() => { load(); }, []);
  const usedBy = (code: string) => sections.filter((s) => s.products.some((p) => p.tab === WEB_TAB && p.code === code)).map(sectionName);
  const done = () => { setAdding(false); setEditing(null); load(); onChanged(); };

  /** One click: a product line named after the code, matching campaigns whose name contains it, linked to this cost. */
  async function makeSection(r: CostRow) {
    const kw = r.code.trim();
    const matched = campaignNames.filter((n) => n.toLowerCase().includes(kw.toLowerCase()));
    const yes = await confirm({
      title: `สร้างสินค้า "${kw}" และผูกต้นทุนนี้?`,
      body: (
        <>
          <p>แคมเปญที่ชื่อมีคำว่า <b>{kw}</b> จะใช้ทุน {baht(r.avg_cost, 2)}/ตัว{r.avg_price > 0 ? ` ราคาเต็ม ${baht(r.avg_price)}` : ''} คิดกำไร</p>
          {matched.length
            ? <ul className="name-list">{matched.slice(0, 8).map((n) => <li key={n} className="clip">{n}</li>)}{matched.length > 8 && <li className="muted">และอีก {matched.length - 8} แคมเปญ</li>}</ul>
            : <p className="warn small">ตอนนี้ยังไม่มีแคมเปญที่ชื่อมีคำนี้ — แก้คำค้นหรือเลือกสินค้าในหน้ารายละเอียดแคมเปญได้ภายหลัง</p>}
          <p className="muted small">ใส่ราคาโปร (1 ตัว / 2 ตัว / 3 ตัว) ต่อได้ที่ปุ่ม "แก้ต้นทุน" ของสินค้า</p>
        </>
      ),
      confirmLabel: 'สร้างสินค้า',
    });
    if (!yes) return;
    try {
      await api.createSection({ name: r.name && r.name !== r.code ? r.name : kw, keywords: [kw], products: [{ tab: WEB_TAB, code: r.code }], tiers: [], units_per_order: 1, extra_cost_per_order: 0, price_per_order: null });
      toast(`สร้างสินค้า "${kw}" แล้ว`, 'ok');
      done();
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  }

  async function remove(r: CostRow) {
    const used = usedBy(r.code);
    const yes = await confirm({
      title: `ลบต้นทุน "${r.code}"?`,
      body: used.length
        ? <p>ยังผูกอยู่กับสินค้า <b>{used.join(', ')}</b> — ลบแล้วสินค้านั้นจะไม่มีต้นทุนจนกว่าจะผูกใหม่</p>
        : <p className="muted">ยังไม่ได้ผูกกับสินค้าไหน</p>,
      confirmLabel: 'ลบ',
      tone: 'danger',
    });
    if (!yes) return;
    try { await api.deleteWebCost(r.code); toast('ลบแล้ว', 'ok'); done(); } catch (e: any) { toast(e.message, 'bad'); }
  }

  return (
    <section className="card">
      <div className="row between wrap">
        <div>
          <h2>ต้นทุนที่กรอกในเว็บ</h2>
          <p className="muted small">สำหรับสินค้าที่ไม่อยู่ในชีต หรือใช้แทนชีตไปเลย · การดึงจากชีตไม่ทับข้อมูลชุดนี้</p>
        </div>
        {!adding && <button className="primary" onClick={() => { setAdding(true); setEditing(null); }}>+ เพิ่มต้นทุน</button>}
      </div>
      {adding && <WebCostForm onSaved={done} onCancel={() => setAdding(false)} />}
      {rows === null ? <p className="muted small">กำลังโหลด…</p> : rows.length === 0 && !adding ? (
        <p className="muted small">ยังไม่มี — กด "+ เพิ่มต้นทุน" หรือกรอกตอนแก้สินค้าก็ได้</p>
      ) : (
        <div className="web-cost-list">
          {rows.map((r) => editing === r.code ? (
            <WebCostForm key={r.code} initial={r} onSaved={done} onCancel={() => setEditing(null)} />
          ) : (
            <div key={r.code} className="web-cost-row">
              <div className="clip-wrap"><b>{r.code}</b>{r.name !== r.code && <span className="muted"> · {r.name}</span>}</div>
              <span className="num">ทุน <b>{baht(r.avg_cost, 2)}</b>/ตัว</span>
              <span className="num muted">{r.avg_price > 0 ? `ราคา ${baht(r.avg_price)}` : 'ไม่ระบุราคา'}</span>
              {usedBy(r.code).length
                ? <span className="small muted clip">ใช้ใน {usedBy(r.code).join(', ')}</span>
                : <span><button className="small warn" onClick={() => makeSection(r)} title="ยังไม่ได้ผูกกับสินค้า — ระบบยังไม่ใช้ต้นทุนนี้">ยังไม่ผูก · สร้างสินค้า</button></span>}
              <span className="row">
                <button className="ghost small" onClick={() => { setEditing(r.code); setAdding(false); }}>แก้</button>
                <button className="ghost small danger" onClick={() => remove(r)}>ลบ</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
