import { useState } from 'react';
import { api, type Overview } from './api.ts';
import { baht, num } from './fmt.ts';
import { useUi } from './ui.tsx';

/** Product lines: which sheet codes each sells and its per-order cost model → break-even ROAS used by every stage rule. */
export function ProductsPage({ data, onEdit, onReload }: { data: Overview; onEdit: (id: string) => void; onReload: () => void }) {
  const { toast } = useUi();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const s = await api.createSection({ name: name.trim(), keywords: [], products: [], units_per_order: 1, extra_cost_per_order: 0, price_per_order: null });
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
    <>
      <p className="muted small">
        สินค้าแต่ละตัวบอกต้นทุนจากชีต → ได้ ROAS คุ้มทุน ซึ่งกฎ "× จุดคุ้มทุน" ในทุกกลุ่มจะใช้ แคมเปญจับคู่สินค้าเองจากคำในชื่อ หรือเลือกเองในหน้ารายละเอียดแคมเปญ
        {data.costs_loaded === 0 && <b className="warn"> · ยังไม่มีต้นทุนในระบบ ไปที่ตั้งค่า → ดึงต้นทุนจากชีต</b>}
      </p>
      {data.sections.map((s) => {
        const e = s.economics;
        return (
          <section key={s.id} className="card product">
            <div className="row between wrap">
              <div>
                <h2>{s.name} <span className="muted small">{s.campaign_count} แคมเปญ</span></h2>
                <div className="tags">
                  {s.keywords.map((k) => <span key={k} className="tag">คำค้น: {k}</span>)}
                  {s.products.length === 0 ? <span className="tag warn">ยังไม่ผูกต้นทุน</span> : s.products.map((p) => <span key={`${p.tab}:${p.code}`} className="tag">{p.tab} · {p.code}</span>)}
                  {e.missing_products.length > 0 && <span className="tag bad">ไม่พบในชีต {e.missing_products.length} รหัส</span>}
                </div>
              </div>
              <button className="ghost" onClick={() => onEdit(s.id)}>แก้ต้นทุน</button>
            </div>
            <div className="econ">
              <div><span>ทุน/ออเดอร์</span><b>{e.cogs_per_order === null ? '–' : baht(e.cogs_per_order + s.extra_cost_per_order)}</b></div>
              <div><span>ราคา/ออเดอร์</span><b>{baht(e.price_per_order)}</b></div>
              <div><span>ROAS คุ้มทุน</span><b className={e.never_profitable ? 'bad' : ''}>{e.never_profitable ? 'ไม่มีกำไร' : num(e.breakeven_roas, 2)}</b></div>
              <div><span>กำไร ({data.window === 'last_7d' ? '7 วัน' : 'ช่วงที่เลือก'})</span><b className={(e.profit ?? 0) < 0 ? 'bad' : ''}>{baht(e.profit)}</b></div>
            </div>
          </section>
        );
      })}
      <form className="row gap" onSubmit={create}>
        <input placeholder="ชื่อสินค้าใหม่ เช่น กระบอก 801" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="primary" disabled={creating || !name.trim()}>+ เพิ่มสินค้า</button>
      </form>
    </>
  );
}
