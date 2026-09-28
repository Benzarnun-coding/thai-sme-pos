import { useEffect, useState } from 'react';
import { api, type Settings } from './api.ts';

export function SettingsPage({ costsLoaded, onSaved }: { costsLoaded: number; onSaved: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [tabsText, setTabsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [sync, setSync] = useState<{ tab: string; codes: number; error?: string }[] | null>(null);

  useEffect(() => {
    api.settings().then((x) => { setS(x); setTabsText(x.sheet_tabs.join(', ')); }).catch((e) => setError(e.message));
  }, []);
  if (error && !s) return <p className="error">{error}</p>;
  if (!s) return <p className="muted">กำลังโหลด…</p>;
  const g = s.guardrails;
  const setG = (k: keyof Settings['guardrails'], v: number) => setS({ ...s, guardrails: { ...g, [k]: v } });

  async function save(next: Settings) {
    setBusy(true); setError(''); setMsg('');
    try {
      const saved = await api.saveSettings({ ...next, sheet_tabs: tabsText.split(',').map((t) => t.trim()).filter(Boolean) });
      setS(saved); setMsg('บันทึกแล้ว'); onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card">
        <h2>โหมดการทำงาน</h2>
        <label className="check big">
          <input type="checkbox" checked={!s.dry_run} onChange={(e) => {
            if (e.target.checked && !confirm('เปิดโหมดทำจริง: ระบบจะหยุด/ปรับงบแคมเปญบน Meta เองตามกฎ วันละ 2 รอบ (08:00, 20:00) ยืนยัน?')) return;
            save({ ...s, dry_run: !e.target.checked });
          }} />
          <span><b>ทำจริง</b> — ปิดไว้ = โหมดทดลอง ระบบแค่บอกว่าจะทำอะไร ไม่แตะ Meta</span>
        </label>
        <label className="check big">
          <input type="checkbox" checked={s.kill_switch} onChange={(e) => save({ ...s, kill_switch: e.target.checked })} />
          <span><b>หยุดฉุกเฉิน</b> — หยุดระบบอัตโนมัติทั้งหมดทันที (ปุ่มเปิด/ปิด/ปรับงบด้วยมือยังใช้ได้)</span>
        </label>
      </section>

      <section className="card">
        <h2>เพดานความปลอดภัย</h2>
        <p className="muted small">กฎอัตโนมัติใช้ทุกข้อ · ปรับงบด้วยมือเช็คแค่งบต่ำสุด/สูงสุดต่อแคมเปญ</p>
        <div className="grid2">
          <label>ปรับงบได้สูงสุดต่อรอบ (%)<input type="number" value={g.max_change_pct_per_run} onChange={(e) => setG('max_change_pct_per_run', Number(e.target.value))} /></label>
          <label>งบรวมทุกแคมเปญสูงสุด/วัน (฿)<input type="number" value={g.max_total_daily_budget} onChange={(e) => setG('max_total_daily_budget', Number(e.target.value))} /></label>
          <label>งบต่ำสุดต่อแคมเปญ/วัน (฿)<input type="number" value={g.min_daily_budget} onChange={(e) => setG('min_daily_budget', Number(e.target.value))} /></label>
          <label>งบสูงสุดต่อแคมเปญ/วัน (฿)<input type="number" value={g.max_daily_budget} onChange={(e) => setG('max_daily_budget', Number(e.target.value))} /></label>
        </div>
      </section>

      <section className="card">
        <h2>Google Sheet ต้นทุน</h2>
        <div className="grid2">
          <label>Sheet ID<input value={s.sheet_id} onChange={(e) => setS({ ...s, sheet_id: e.target.value })} /></label>
          <label>แท็บที่อ่าน (คั่นด้วย ,)<input value={tabsText} onChange={(e) => setTabsText(e.target.value)} /></label>
        </div>
        <p className="muted small">อ่านคอลัมน์ B (SKU), C (รหัสสินค้า), D (รายละเอียด), H (ต้นทุน), I (ราคา) · ตอนนี้มี {costsLoaded} รหัสในระบบ · ซิงก์เองทุกวัน 07:30</p>
        <button disabled={busy} onClick={async () => {
          // One request per tab (Google needs 5–15 s per tab on this workbook), 3 at a time, with live progress.
          setBusy(true);
          const tabs = [...s.sheet_tabs];
          setSync(tabs.map((tab) => ({ tab, codes: -1 })));
          const put = (r: { tab: string; codes: number; error?: string }) => setSync((cur) => cur?.map((x) => (x.tab === r.tab ? r : x)) ?? null);
          await Promise.all([0, 1, 2].map(async () => {
            for (let tab = tabs.shift(); tab !== undefined; tab = tabs.shift()) {
              try { put((await api.syncCostTab(tab))[0]); } catch (e: any) { put({ tab, codes: 0, error: e.message }); }
            }
          }));
          setBusy(false);
          onSaved();
        }}>{busy ? 'กำลังดึง…' : 'ดึงต้นทุนจากชีตตอนนี้'}</button>
        {sync && (
          <ul className="notes small">
            {sync.map((t) => (
              <li key={t.tab} className={t.error ? 'bad' : ''}>
                {t.tab}: {t.codes === -1 ? 'กำลังดึง…' : t.error ?? `${t.codes} รหัส`}
              </li>
            ))}
          </ul>
        )}
        {tabsText !== s.sheet_tabs.join(', ') && <p className="warn small">แก้รายชื่อแท็บแล้ว กด "บันทึกการตั้งค่า" ก่อนดึง</p>}
      </section>

      {error && <p className="error">{error}</p>}
      {msg && <p className="ok">{msg}</p>}
      <div className="row end sticky-actions">
        <button className="primary" disabled={busy} onClick={() => save(s)}>บันทึกการตั้งค่า</button>
      </div>
    </>
  );
}
