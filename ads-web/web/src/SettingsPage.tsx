import { useEffect, useState } from 'react';
import { useUi } from './ui.tsx';
import { api, type CostTier, type Settings } from './api.ts';
import { when } from './fmt.ts';

export function SettingsPage({ costsLoaded, campaignNames, onSaved }: { costsLoaded: number; campaignNames: string[]; onSaved: () => void }) {
  const { confirm } = useUi();
  const [s, setS] = useState<Settings | null>(null);
  const [tabsText, setTabsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [editorsText, setEditorsText] = useState<string | null>(null);
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
          <input type="checkbox" checked={!s.dry_run} onChange={async (e) => {
            const on = e.target.checked;
            if (on && !(await confirm({
              title: 'เปิดโหมดทำจริง?',
              body: <p>ระบบจะหยุด/ปรับงบแคมเปญบน Meta เองตามกฎ วันละ 2 รอบ (08:00, 20:00) — รวมถึงเพิ่มงบถ้ามีกฎเพิ่มงบ</p>,
              confirmLabel: 'เปิดทำจริง',
              tone: 'danger',
            }))) return;
            save({ ...s, dry_run: !on });
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
        <h2>ผู้ใช้ที่แก้ได้เฉพาะต้นทุน</h2>
        <p className="muted small">
          อีเมลเหล่านี้ดูได้ทุกหน้า แต่แก้ได้เฉพาะต้นทุน (ต้นทุนในเว็บ, สินค้า/โปร, ดึงต้นทุนจากชีต) — เปิด/ปิดแอด ปรับงบ แก้กฎ ย้ายกลุ่ม และตั้งค่า จะถูกปฏิเสธ
          · คนที่ไม่อยู่ในรายการนี้ (และเข้าเว็บได้) ทำได้ทุกอย่าง · การให้เข้าเว็บได้ ต้องเพิ่มอีเมลใน Cloudflare Access ด้วย
        </p>
        <label>อีเมล (บรรทัดละ 1 หรือคั่นด้วย ,)
          <textarea rows={3} value={editorsText ?? s.cost_editors.join('\n')} onChange={(e) => setEditorsText(e.target.value)} />
        </label>
        <div className="row gap">
          <button className="ghost" disabled={busy || editorsText === null} onClick={() => save({ ...s, cost_editors: (editorsText ?? '').split(/[\s,]+/).filter(Boolean) })}>บันทึก</button>
        </div>
      </section>

      <CampaignCostSheet s={s} setS={setS} busy={busy} onSave={() => save(s)} campaignNames={campaignNames} onSynced={onSaved} />

      <section className="card">
        <h2>เก็บเงินปลายทาง</h2>
        <p className="muted small">แอดมินติ๊กยอดใน Meta รวมค่าเก็บปลายทางไว้แล้ว ระบบนับส่วนนี้เป็นรายได้ แต่หักออกก่อนคำนวณจำนวนตัว จะได้ไม่นับเป็นกางเกงเพิ่ม</p>
        <div className="grid2">
          <label>สัดส่วนออเดอร์ที่เก็บปลายทาง (%)<input type="number" min={0} max={100} value={s.cod_share_pct} onChange={(e) => setS({ ...s, cod_share_pct: Number(e.target.value) })} /></label>
          <label>บวกเพิ่มต่อออเดอร์ปลายทาง (฿)<input type="number" min={0} value={s.cod_fee} onChange={(e) => setS({ ...s, cod_fee: Number(e.target.value) })} /></label>
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

/**
 * The team's per-campaign cost sheet ("FB คำนวณค่า ADS"): sheet link + tab, sync now, and which names in the
 * sheet match a campaign in Meta (names must match; spaces and line breaks don't matter).
 */
function CampaignCostSheet({ s, setS, busy, onSave, campaignNames, onSynced }: {
  s: Settings; setS: (s: Settings) => void; busy: boolean; onSave: () => void; campaignNames: string[]; onSynced: () => void;
}) {
  const { toast } = useUi();
  const [list, setList] = useState<{ synced_at: string | null; campaigns: { name: string; tiers: CostTier[] }[] } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const key = (n: string) => n.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  const load = () => api.campaignCosts().then(setList).catch(() => setList({ synced_at: null, campaigns: [] }));
  useEffect(() => { load(); }, []);
  const ours = new Set(campaignNames.map(key));
  const matched = list?.campaigns.filter((c) => ours.has(key(c.name))) ?? [];
  const unmatched = list?.campaigns.filter((c) => !ours.has(key(c.name))) ?? [];

  async function sync() {
    setSyncing(true);
    try {
      const r = await api.syncCampaignCosts();
      toast(`ดึงต้นทุน ${r.campaigns} แคมเปญแล้ว`, 'ok');
      await load();
      onSynced();
    } catch (e: any) {
      toast(e.message, 'bad');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="card">
      <h2>ชีตต้นทุนรายแคมเปญ</h2>
      <p className="muted small">
        ชีต "FB คำนวณค่า ADS" แท็บ "รวมต้นทุน ที่เปิด ADS": ชื่อแคมเปญ (คอลัมน์ A) ต้องตรงกับชื่อใน Meta · แต่ละแถว "ราคาขาย N ตัว ราคา" + ต้นทุนรวมต่อออเดอร์ (คอลัมน์ D)
        · แคมเปญที่เจอในชีตจะใช้ต้นทุนนี้แทนต้นทุนสินค้า · ดึงใหม่ทุกเช้า 07:30
      </p>
      <div className="grid2">
        <label>ลิงก์หรือ ID ของชีต<input value={s.ads_cost_sheet_id} onChange={(e) => setS({ ...s, ads_cost_sheet_id: e.target.value })} placeholder="วางลิงก์ Google Sheets ได้เลย" /></label>
        <label>ชื่อแท็บ<input value={s.ads_cost_tab} onChange={(e) => setS({ ...s, ads_cost_tab: e.target.value })} /><small>ต้องตรงทุกตัวอักษร รวมเว้นวรรคท้ายชื่อ</small></label>
      </div>
      <div className="row gap">
        <button className="ghost" disabled={busy} onClick={onSave}>บันทึก</button>
        <button className="primary" disabled={syncing || !s.ads_cost_sheet_id} onClick={sync}>{syncing ? 'กำลังดึง…' : 'ดึงต้นทุนจากชีตตอนนี้'}</button>
      </div>
      {list && list.campaigns.length > 0 && (
        <div className="sheet-match">
          <p className="small">
            ในชีต {list.campaigns.length} แคมเปญ · <b className="good">ตรงกับแคมเปญใน Meta {matched.length}</b>
            {unmatched.length > 0 && <> · <b className="warn">ไม่ตรง {unmatched.length}</b></>}
            {list.synced_at && <span className="muted"> · ดึงล่าสุด {when(list.synced_at)}</span>}
          </p>
          {unmatched.length > 0 && (
            <details>
              <summary className="small">ชื่อในชีตที่ไม่ตรงกับแคมเปญที่เปิดอยู่หรือใช้เงินช่วงนี้ (ถ้าเป็นแคมเปญที่ยังเปิดอยู่ แก้ชื่อในชีตให้ตรงกับ Meta)</summary>
              <ul className="notes small">{unmatched.map((c) => <li key={c.name}>{c.name}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
