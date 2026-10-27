import { useEffect, useState } from 'react';
import { useUi } from './ui.tsx';
import { api, type CostTier, type Settings, type WebhookStatus } from './api.ts';
import { when } from './fmt.ts';
import { MetaPurchasesCard } from './MetaPurchases.tsx';

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
          <label>งบสูงสุดต่อแคมเปญตัวชนะ 7 วัน (฿)<input type="number" value={g.winner_max_daily_budget ?? 5000} onChange={(e) => setG('winner_max_daily_budget', Number(e.target.value))} /></label>
          <label>เว้นระหว่างการเพิ่มงบแต่ละครั้ง (ชม.)<input type="number" value={g.increase_gap_hours ?? 48} onChange={(e) => setG('increase_gap_hours', Number(e.target.value))} /></label>
          <label>งบต่ำกว่านี้เพิ่มได้ทุกรอบ ไม่ต้องเว้น (฿)<input type="number" value={g.free_increase_below ?? 500} onChange={(e) => setG('free_increase_below', Number(e.target.value))} /></label>
          <label>เบรกเมื่อวานพัง (ตัวที่งบเกินงบสูงสุดต่อแคมเปญ)<select value={g.brake_yesterday ?? 'dry'} onChange={(e) => setS({ ...s, guardrails: { ...g, brake_yesterday: e.target.value as 'off' | 'dry' | 'on' } })}>
            <option value="dry">ทดลอง — บอกใน Discord ว่าจะลด แต่ยังไม่ลดจริง</option>
            <option value="on">เปิด — ลดกลับเป็นงบสูงสุดต่อแคมเปญทันที</option>
            <option value="off">ปิด</option>
          </select></label>
          <label>งบเริ่มต้นตอนเปิดแอดใหม่/วัน (฿)<input type="number" value={g.start_daily_budget ?? 50} onChange={(e) => setG('start_daily_budget', Number(e.target.value))} /></label>
        </div>
        <p className="muted small">ตัวชนะ 7 วัน = อยู่กลุ่มชนะ, ROAS จริง 7 วัน ≥ 1.5× คุ้มทุนร้าน และ ≥ 10 ออเดอร์ → กฎเพิ่มงบได้ถึงเพดานนี้แทนงบสูงสุดต่อแคมเปญ (ตัวคัดลอกจะถูกเสนอเมื่อชนเพดานนี้) · แคมเปญที่งบถึงเกณฑ์ "เพิ่มได้ทุกรอบ" แล้ว เพิ่มงบได้ครั้งเดียวในช่วงเว้นนี้ ไม่ว่ากฎไหนสั่ง (ต่ำกว่านั้นเพิ่มได้ทุกรอบตามกฎ) เพื่อให้ ROAS 3 วันเป็นตัวเลขของงบใหม่ก่อนเพิ่มอีก (การลดงบไม่ต้องรอ) · เบรกเมื่อวานพัง: แคมเปญที่งบเกินงบสูงสุดต่อแคมเปญ ถ้าเมื่อวาน ROAS ต่ำกว่า 0.8× คุ้มทุนร้าน และใช้เงิน ≥ 2,000 → ลดกลับเป็นงบสูงสุดต่อแคมเปญในรอบถัดไปเลย แล้วเว้นการเพิ่มงบ 48 ชม. (ยอดจริง Page365 ถ้าอัปโหลดไฟล์เมื่อวานแล้ว ไม่งั้นใช้ยอดแท็ก Meta)</p>
        <p className="muted small">แอดใหม่ที่ระบบเปิดให้ (ตัวคัดลอกจากปุ่ม "คัดลอกเลย") เริ่มที่งบนี้ แล้วไต่ +20% ทุกรอบ (08:00/20:00) ถ้า ROAS จริง 3 วันยังคุ้มทุน จนถึง 1,000/วัน แล้วให้กฎกลุ่มทดสอบดูแลต่อ</p>
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

      <DiscordCard />

      <ConversionHoursCard />

      <WebhookCard />
      <MetaPurchasesCard />

      <CampaignCostSheet s={s} setS={setS} busy={busy} onSave={() => save(s)} campaignNames={campaignNames} onSynced={onSaved} />

      <section className="card">
        <h2>เป้ากำไรและการขยายงบ</h2>
        <p className="muted small">กำไรสุทธิ = ยอดขายจริง − ทุนสินค้า − ค่าใช้จ่ายต่อออเดอร์ − ค่าแอด (ยังไม่หักค่าใช้จ่ายคงที่) · ทุกเช้าวันจันทร์ ถ้า MER จริง 7 วันถึงเกณฑ์ อูนิจะถามใน Discord ว่าจะขยายเพดานงบรวมไหม</p>
        <div className="grid2">
          <label>เป้ากำไรสุทธิต่อเดือน (฿)<input type="number" min={0} step={1000} value={s.goal.monthly_net} onChange={(e) => setS({ ...s, goal: { ...s.goal, monthly_net: Number(e.target.value) } })} /></label>
          <label>MER จริง 7 วันขั้นต่ำก่อนขยายเพดานงบ<input type="number" min={1} step={0.01} value={s.goal.scale_mer} onChange={(e) => setS({ ...s, goal: { ...s.goal, scale_mer: Number(e.target.value) } })} /></label>
          <label>ขยายเพดานงบครั้งละ (%)<input type="number" min={1} max={100} value={s.goal.scale_pct} onChange={(e) => setS({ ...s, goal: { ...s.goal, scale_pct: Number(e.target.value) } })} /></label>
        </div>
        <ScaleCheckButton />
      </section>

      <section className="card">
        <h2>ค่าใช้จ่ายต่อออเดอร์และความเสี่ยง (ทั้งเว็บ)</h2>
        <p className="muted small">ชุดเดียวทั้งเว็บ: ทุนสินค้า = ทุนดิบในแคตตาล็อก แล้วหักชุดนี้จากทุกออเดอร์ — ไฟล์ Page365, กำไรรายแคมเปญ, คุ้มทุนของกฎแอด, เป้ากำไร · ค่าธรรมเนียม COD คิดเฉพาะออเดอร์เก็บปลายทาง (ฝั่งแอดใช้สัดส่วน COD ด้านล่าง) · เปอร์เซ็นต์คิดจากยอดที่ลูกค้าจ่าย · ค่าส่งและค่าซองคิดต่อออเดอร์</p>
        <div className="grid2">
          <label>ค่าธรรมเนียม COD (%)<input type="number" min={0} step={0.1} value={s.order_fees.cod_pct} onChange={(e) => setS({ ...s, order_fees: { ...s.order_fees, cod_pct: Number(e.target.value) } })} /></label>
          <label>ของเสีย/ตีกลับ/หาย (%)<input type="number" min={0} step={0.1} value={s.order_fees.loss_pct} onChange={(e) => setS({ ...s, order_fees: { ...s.order_fees, loss_pct: Number(e.target.value) } })} /></label>
          <label>ค่าส่งต่อออเดอร์ (฿)<input type="number" min={0} value={s.order_fees.ship} onChange={(e) => setS({ ...s, order_fees: { ...s.order_fees, ship: Number(e.target.value) } })} /></label>
          <label>VAT (%)<input type="number" min={0} step={0.1} value={s.order_fees.vat_pct} onChange={(e) => setS({ ...s, order_fees: { ...s.order_fees, vat_pct: Number(e.target.value) } })} /></label>
          <label>VAT คิดจาก
            <select value={s.order_fees.vat_base} onChange={(e) => setS({ ...s, order_fees: { ...s.order_fees, vat_base: e.target.value as 'total' | 'goods' | 'after_ship' } })}>
              <option value="after_ship">ยอดที่ลูกค้าจ่าย − ค่าส่งที่เราจ่าย (ตามที่ตกลง)</option>
              <option value="total">ยอดที่ลูกค้าจ่าย (รวมค่าส่ง)</option>
              <option value="goods">ค่าสินค้า (ไม่รวมค่าส่ง 50 ที่เก็บจาก COD)</option>
            </select>
          </label>
          <label>ค่าซองต่อออเดอร์ (฿)<input type="number" min={0} value={s.order_fees.bag} onChange={(e) => setS({ ...s, order_fees: { ...s.order_fees, bag: Number(e.target.value) } })} /></label>
        </div>
      </section>

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
        ชีต "FB คำนวณค่า ADS" แท็บ "รวมต้นทุน ที่เปิด ADS": ชื่อแคมเปญ (คอลัมน์ A) ต้องตรงกับชื่อใน Meta · ใช้แค่ราคาโปร "ราคาขาย N ตัว ราคา" (คอลัมน์ B)
        · ต้นทุนในชีต (คอลัมน์ C–D) ไม่ใช้แล้ว: ทุน = จำนวนตัว × ทุนแคตตาล็อก + ค่าใช้จ่ายต่อออเดอร์ด้านล่าง · ดึงใหม่ทุกเช้า 07:30
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

/** Stored hourly purchases: how many of the last 30 days are there, and a button to fetch more now. */
/** Messenger webhook: Meta tells us which ad each customer came from, from the day it is switched on. */
function WebhookCard() {
  const { toast } = useUi();
  const [st, setSt] = useState<WebhookStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.webhook().then(setSt).catch(() => setSt(null));
  useEffect(() => { load(); }, []);
  async function setup() {
    setBusy(true);
    try {
      await api.setupWebhook();
      toast('เชื่อมต่อแล้ว — ข้อมูลจะเริ่มเข้าเมื่อมีลูกค้าทักจากแอด', 'ok');
      await load();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  const ready = st && st.configured.app_secret && st.configured.verify_token && st.configured.app_id;
  const connected = st && st.app_subscribed && st.page?.subscribed;
  return (
    <section className="card">
      <h2>ลูกค้าทักจากแอดไหน (Messenger webhook)</h2>
      <p className="muted small">
        Meta ส่งมาบอกทันทีที่ลูกค้ากดทักจากแอด ว่าลูกค้า (รหัส) คนนี้มาจากแอดตัวไหน · เก็บแค่รหัสลูกค้า แอด และเวลา ไม่เก็บชื่อหรือข้อความ (ยกเว้นบรรทัดสรุปออเดอร์ที่แอดมินพิมพ์ เช่น "501/1 32 cod 249" ซึ่งไม่มีข้อมูลลูกค้า)
        · ย้อนหลังก่อนวันเชื่อมต่อไม่มี (Meta ไม่ให้ดึง) · ดูผลได้ในหน้ายอดขายรายวัน
      </p>
      {!st ? <div className="skeleton" style={{ height: 60 }} /> : (
        <>
          <div className="grid2">
            <div><div className="small muted">สถานะ</div><b>{connected ? 'เชื่อมต่อแล้ว' : ready ? 'ยังไม่ได้เชื่อมต่อ' : 'ยังไม่ได้ตั้งค่า'}</b></div>
            <div><div className="small muted">เพจ</div><b>{st.page ? `${st.page.name}${st.page.subscribed ? '' : ' (ยังไม่ส่งข้อมูล)'}` : '–'}</b></div>
            <div><div className="small muted">เหตุการณ์ที่รับมาทั้งหมด</div><b>{st.events_total.toLocaleString('th-TH')}</b>{st.last_event_at && <span className="small muted"> · ล่าสุด {when(st.last_event_at)}</span>}</div>
            <div><div className="small muted">ลูกค้าทักจากแอด</div><b>{st.referrals_total.toLocaleString('th-TH')}</b>{st.last_referral_at && <span className="small muted"> · ล่าสุด {when(st.last_referral_at)}</span>}</div>
            <div><div className="small muted">บรรทัดสรุปออเดอร์ที่แอดมินพิมพ์</div><b>{st.order_notes_total.toLocaleString('th-TH')}</b>{st.last_order_note_at && <span className="small muted"> · ล่าสุด {when(st.last_order_note_at)}</span>}</div>
            <div><div className="small muted">ข้อความที่เพจส่ง (ทั้งหมด)</div><b>{st.echoes_total.toLocaleString('th-TH')}</b>{st.last_echo_at && <span className="small muted"> · ล่าสุด {when(st.last_echo_at)}</span>}</div>
          </div>
          {connected && st.echoes_missing && <p className="small warn">ยังไม่ได้รับข้อความที่เพจตอบ (message_echoes) — กด "เชื่อมต่อใหม่" เพื่อเริ่มเก็บบรรทัดสรุปออเดอร์</p>}
          {!ready && (
            <p className="small warn">
              ต้องตั้ง secret ใน Worker ก่อน:{!st.configured.app_secret && ' META_APP_SECRET (รหัสลับแอป Stat)'}{!st.configured.verify_token && ' META_WEBHOOK_VERIFY_TOKEN'}{!st.configured.app_id && ' META_APP_ID'}
            </p>
          )}
          {st.error && <p className="small warn">{st.error}</p>}
          <div className="row gap">
            <button className="ghost" disabled={busy || !ready} onClick={setup}>{busy ? 'กำลังเชื่อมต่อ…' : connected ? 'เชื่อมต่อใหม่' : 'เชื่อมต่อ'}</button>
            <span className="small muted">URL: {st.callback_url}</span>
          </div>
        </>
      )}
    </section>
  );
}

function ScaleCheckButton() {
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  return (
    <button className="ghost" disabled={busy} onClick={async () => {
      setBusy(true);
      try { const r = await api.goalScaleCheck(); toast(r.reason, r.asked ? 'ok' : undefined); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
    }}>{busy ? 'กำลังเช็ก…' : 'เช็กขยายเพดานงบตอนนี้'}</button>
  );
}

function DiscordCard() {
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  return (
    <section className="card">
      <h2>บอท Discord (ปุ่มอนุมัติ)</h2>
      <p className="muted small">การหยุดแคมเปญและการย้ายลงกลุ่มดับ จะส่งเป็นคำถามพร้อมปุ่มในห้องรายงานแอด ให้คนกดอนุมัติก่อน · ปรับงบ ±20% ยังทำเองอัตโนมัติ</p>
      <p className="muted small">จันทร์และพฤหัส 08:00 อูนิส่งไอเดียโพสต์ใหม่ให้แม็กซ์ (สินค้าไหนควรทำโพสต์เพิ่ม/ลองเปิด/ยังไม่ต้องทำ จากออเดอร์จริง 14 วัน)</p>
      <button className="ghost" disabled={busy} onClick={async () => {
        setBusy(true);
        try { const r = await api.sendPostIdeas(); toast(`ส่งไอเดียแล้ว ${r.ideas} ข้อ`, 'ok'); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
      }}>{busy ? 'กำลังส่ง…' : 'ส่งไอเดียโพสต์ให้แม็กซ์ตอนนี้'}</button>
      <p className="muted small">10:00 ถ้ายังไม่มีไฟล์ Page365 ของเมื่อวาน อูนิจะแท็กคนอัปโหลด (เคน) ให้กด "อัปโหลดแล้ว"</p>
      <div className="row">
        {([[undefined, 'ส่งข้อความทดสอบเข้า Discord'], ['upload', 'ทดสอบเตือนอัปโหลด Page365']] as const).map(([kind, label]) => (
          <button key={label} className="ghost" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await api.discordTest(kind); toast('ส่งแล้ว — ไปกดปุ่มในห้อง Discord ได้เลย', 'ok'); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
          }}>{busy ? 'กำลังส่ง…' : label}</button>
        ))}
      </div>
      <p className="muted small">ทุกข้อความใน Discord ขึ้นชื่อ "น้องอูนิ" กับรูปแมว · ปุ่มนี้เปลี่ยนรูปและชื่อของตัวบอท (ข้อความที่มีปุ่ม) ให้ตรงกัน กดครั้งเดียวพอ</p>
      <button className="ghost" disabled={busy} onClick={async () => {
        setBusy(true);
        try { const r = await api.discordPersona(); toast(r.error ? `ทำได้บางส่วน: ${r.error}` : 'บอทเป็นน้องอูนิแล้ว', r.error ? 'bad' : 'ok'); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
      }}>{busy ? 'กำลังเปลี่ยน…' : 'เปลี่ยนบอทเป็นน้องอูนิ (รูป + ชื่อ)'}</button>
    </section>
  );
}

function ConversionHoursCard() {
  const { toast } = useUi();
  const [st, setSt] = useState<{ stored: number; of: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.conversionHours().then(setSt).catch(() => setSt(null));
  useEffect(() => { load(); }, []);
  async function sync() {
    setBusy(true);
    try {
      const r = await api.syncConversionHours();
      toast(`ดึงแล้ว ${r.fetched.length} วัน · เหลือ ${r.missing} วัน${r.errors.length ? ` · ${r.errors[0]}` : ''}`, r.errors.length ? 'bad' : 'ok');
      await load();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  return (
    <section className="card">
      <h2>ข้อมูลยอดเข้ารายครั้ง</h2>
      <p className="muted small">
        กำไรทุกหน้าคิดรายครั้ง: ยอดที่แอดมินติ๊กแต่ละครั้ง (จาก Meta รายชั่วโมง) จับคู่กับราคาโปรและทุนของแอด
        · ระบบดึงเมื่อวานกับ 2 วันก่อนหน้าทุกเช้า 07:30 และเติมย้อนหลังวันละ 5 วัน · ช่วงที่ยังไม่มีข้อมูลใช้วิธีประมาณจากยอดรวม
      </p>
      <div className="row gap">
        <b>{st ? `มีข้อมูล ${st.stored} จาก ${st.of} วันล่าสุด` : '–'}</b>
        <button className="ghost" disabled={busy || (st !== null && st.stored >= st.of)} onClick={sync}>{busy ? 'กำลังดึง…' : 'ดึงย้อนหลังเพิ่มตอนนี้ (ทีละ 6 วัน)'}</button>
      </div>
    </section>
  );
}
