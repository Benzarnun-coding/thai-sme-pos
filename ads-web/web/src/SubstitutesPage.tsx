// /substitutes — "ตัวแทน" (Benz 2026-11-19): a sold-out model shipped as another one. Admins keep writing the
// sold-out code in the order note; the Page365 fill puts the substitute on the bill (its SKU, stock and bill
// name) at the price of the model the customer bought. Delete the row when the model is back.

import { useEffect, useState } from 'react';
import { HomeLogo, SiteNav } from './SiteNav.tsx';
import { useUi } from './ui.tsx';

interface Sub { code: string; sub: string; note: string | null; created_by: string; created_at: string }

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data: any = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

const when = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });

export function SubstitutesApp() {
  useEffect(() => { document.title = 'ตัวแทน'; }, []);
  const { toast, confirm } = useUi();
  const [items, setItems] = useState<Sub[] | null>(null);
  const [code, setCode] = useState('');
  const [sub, setSub] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => call<{ items: Sub[] }>('GET', '/api/substitutes').then((r) => setItems(r.items)).catch((e) => toast(e.message, 'bad'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    setBusy(true);
    try {
      const r = await call<{ code: string; sub: string }>('POST', '/api/substitutes', { code, sub, note });
      toast(`ตั้งแล้ว: สรุป ${r.code} → ใส่บิลเป็น ${r.sub}`, 'ok');
      setCode(''); setSub(''); setNote('');
      await load();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const remove = async (s: Sub) => {
    if (!(await confirm({ title: `ลบตัวแทน ${s.code} → ${s.sub}?`, body: `บิลใหม่ที่สรุป ${s.code} จะกลับไปใส่ ${s.code} ตามปกติ`, confirmLabel: 'ลบ', tone: 'danger' }))) return;
    try { await call('DELETE', `/api/substitutes?code=${encodeURIComponent(s.code)}`); toast(`ลบ ${s.code} แล้ว`, 'ok'); await load(); }
    catch (e: any) { toast(e.message, 'bad'); }
  };

  return (
    <div className="kb-page">
      <SiteNav current="/substitutes" />
      <header className="kb-head">
        <div className="row"><HomeLogo text="ตท" /><h1>ตัวแทน</h1></div>
        <p className="muted small">รุ่นไหนหมด ตั้งรุ่นที่ส่งแทนไว้ที่นี่ แอดมินสรุปรุ่นเดิมในแชตได้ตามปกติ ระบบจะใส่รุ่นที่ใช้แทนลงบิล Page365 ให้เอง
          · ไซส์และจำนวนตามสรุป · <b>ราคาตามรุ่นที่ลูกค้าซื้อ</b> · สต็อก ทุน และชื่อบิล (PK-/GS-) ตามรุ่นที่ใช้แทน · รุ่นกลับมามีของแล้วกดลบ</p>
      </header>

      <section className="card sub-form">
        <label>รุ่นที่หมด (ที่แอดมินสรุป)<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="801/1" /></label>
        <span className="sub-arrow">→</span>
        <label>ใส่บิลเป็น<input value={sub} onChange={(e) => setSub(e.target.value)} placeholder="501/5" /></label>
        <label className="sub-note">หมายเหตุ (ไม่ใส่ก็ได้)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมดถึงสิ้นเดือน" /></label>
        <button disabled={busy || !code.trim() || !sub.trim()} onClick={add}>ตั้งตัวแทน</button>
      </section>

      <section className="card">
        {items === null ? <p className="muted">กำลังโหลด…</p> : items.length === 0 ? <p className="muted">ยังไม่มีตัวแทน — ทุกบิลใส่รุ่นตามที่สรุป</p> : (
          <table className="sub-table">
            <thead><tr><th>สรุปว่า</th><th></th><th>ใส่บิลเป็น</th><th>หมายเหตุ</th><th>ตั้งโดย</th><th></th></tr></thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.code}>
                  <td><b>{s.code}</b></td><td className="muted">→</td><td><b>{s.sub}</b></td>
                  <td className="muted small">{s.note ?? ''}</td>
                  <td className="muted small">{s.created_by.split('@')[0]} · {when(s.created_at)}</td>
                  <td><button className="ghost small" onClick={() => remove(s)}>ลบ</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
