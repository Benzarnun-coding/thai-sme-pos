// Settings card: sending Page365 purchases to Meta (Conversions API for Business Messaging), so admins no longer
// tag sales in Meta's inbox. Off → test (Events Manager → Test events, not counted) → live. A dry run lists what
// would be sent right now without sending.

import { useEffect, useState } from 'react';
import { baht, when } from './fmt.ts';
import { useUi } from './ui.tsx';

type Mode = 'off' | 'test' | 'live';
interface Config { mode: Mode; dataset_id: string; test_code: string; live_from: string; last_sync: string }
interface Row { order_no: number; value: number; cod: number; stage: string; event_time: string; status: string; detail: string | null; sent_at: string }
interface SyncResult { mode: Mode; dry: boolean; checked: number; sent: { no: number; value: number; cod: boolean; stage: string }[]; skipped: { no: number; why: string }[]; error: string | null }

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j as T;
}

const MODE_LABEL: Record<Mode, string> = { off: 'ปิด', test: 'ปิด (ดูอย่างเดียว)', live: 'ส่งจริง' };

export function MetaPurchasesCard() {
  const { toast, confirm } = useUi();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState({ dataset_id: '', test_code: '' });
  const [dry, setDry] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState('');
  // With source "note" each sale went out when the admin typed the note; sending bills too would count them twice.
  const [source, setSource] = useState<'note' | 'bill' | null>(null);
  useEffect(() => { call<{ source: 'note' | 'bill' }>('GET', '/api/meta/purchases/source').then((r) => setSource(r.source)).catch(() => {}); }, []);
  const load = () => call<{ config: Config; rows: Row[] }>('GET', '/api/meta/purchases').then((r) => { setCfg(r.config); setRows(r.rows); setForm({ dataset_id: r.config.dataset_id, test_code: r.config.test_code }); }).catch(() => {});
  useEffect(() => { load(); }, []);

  async function save(mode: Mode) {
    if (mode === 'live' && !(await confirm({ title: 'ส่งยอดขายให้ Meta จริง?', body: 'ตั้งแต่ตอนนี้ บิล Page365 ที่ขายแล้ว (ปลายทาง: ส่งบิลแล้ว · โอน: ได้เงินแล้ว) จะถูกส่งเป็น Purchase ให้ Meta นับจริง — ให้แอดมินเลิกติ๊กสร้างคำสั่งซื้อใน Meta พร้อมกัน ไม่งั้นนับซ้ำ', confirmLabel: 'เปิดส่งจริง', tone: 'danger' }))) return;
    setBusy('save');
    try { await call('PUT', '/api/meta/purchases/config', { ...form, mode }); toast(`ตั้งเป็น "${MODE_LABEL[mode]}" แล้ว`, 'ok'); await load(); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }
  async function run(isDry: boolean) {
    setBusy(isDry ? 'dry' : 'sync');
    try {
      const r = await call<SyncResult>('POST', `/api/meta/purchases/sync${isDry ? '?dry=1' : ''}`);
      setDry(r);
      if (!isDry) { toast(r.error ? `ส่งไม่สำเร็จ: ${r.error}` : `ส่งแล้ว ${r.sent.length} บิล`, r.error ? 'bad' : 'ok'); await load(); }
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }

  const today = rows.filter((r) => r.sent_at.slice(0, 10) === new Date().toISOString().slice(0, 10));
  return (
    <section className="card">
      <h2>ส่งยอดขายให้ Meta (แทนการติ๊กในกล่องแชท)</h2>
      <p className="muted small">
        ส่ง Purchase ให้แอดตัวที่ลูกค้าทักเข้ามา (Conversions API for Business Messaging) แทนการกด Create order ในแชท · ไม่ส่งชื่อ/เบอร์/ที่อยู่ ·
        ส่งตอน: <b>แอดมินพิมพ์สรุป</b> (แนะนำ — ยอดเข้าวันที่ลูกค้าตกลง, ยอด = ยอดในบรรทัดสรุป, ลูกค้าเดิมใน 2 ชม. ไม่นับซ้ำ) หรือ <b>ส่งบิลใน Page365</b> (ปลายทาง: ส่งบิลแล้ว · โอน: ได้เงินแล้ว)
      </p>
      {!cfg ? <div className="skeleton" style={{ height: 60 }} /> : (
        <>
          <div className="grid2">
            <div><div className="small muted">สถานะ</div><b>{MODE_LABEL[cfg.mode]}</b>{cfg.mode === 'live' && cfg.live_from && <span className="small muted"> · ตั้งแต่ {when(cfg.live_from)}</span>}</div>
            <div><div className="small muted">เช็กล่าสุด</div><b>{cfg.last_sync ? when(cfg.last_sync) : '–'}</b>{today.length > 0 && <span className="small muted"> · วันนี้ {today.length} บิล</span>}</div>
            <label className="small">Dataset ID (Events Manager)<input value={form.dataset_id} onChange={(e) => setForm({ ...form, dataset_id: e.target.value })} placeholder="ตัวเลข" /></label>
            <label className="small">Test event code (Events Manager → Test events)<input value={form.test_code} onChange={(e) => setForm({ ...form, test_code: e.target.value })} placeholder="TEST12345" /></label>
          </div>
          <div className="row gap wrap" style={{ marginTop: 8 }}>
            <button className="ghost" disabled={!!busy} onClick={() => run(true)}>{busy === 'dry' ? 'กำลังดู…' : 'ดูว่าตอนนี้จะส่งอะไร (ไม่ส่งจริง)'}</button>
            {cfg.mode !== 'live' && <button className="warn" disabled={!!busy} onClick={() => save('live')}>เปิดส่งจริง</button>}
            {cfg.mode !== 'off' && <button className="ghost" disabled={!!busy} onClick={() => save('off')}>ปิด</button>}
            {cfg.mode === 'live' && source === 'bill' && <button className="ghost" disabled={!!busy} onClick={() => run(false)}>{busy === 'sync' ? 'กำลังส่ง…' : 'ส่งตอนนี้'}</button>}
          </div>
          <NoteSource source={source} setSource={setSource} />
          {dry && (
            <div className="small" style={{ marginTop: 8 }}>
              {dry.error && <div className="bad">{dry.error}</div>}
              <div>{dry.dry ? 'จะส่ง' : 'ส่งแล้ว'} {dry.sent.length} บิล · {baht(dry.sent.reduce((t, s) => t + s.value, 0))} (ดู {dry.checked} บิล)</div>
              {dry.sent.slice(0, 30).map((s) => <div key={s.no} className="muted">#{s.no} {baht(s.value)} · {s.cod ? 'ปลายทาง' : 'โอน'} · {s.stage}</div>)}
              {dry.skipped.map((s) => <div key={s.no} className="warn">ข้าม #{s.no} — {s.why}</div>)}
            </div>
          )}
          <AdjustmentDays />
          {rows.some((r) => r.status === 'error') && <p className="small bad">มีบิลที่ส่งไม่สำเร็จ: {rows.filter((r) => r.status === 'error').slice(0, 3).map((r) => `#${r.order_no} ${r.detail ?? ''}`).join(' · ')}</p>}
        </>
      )}
    </section>
  );
}

/** Days whose Meta purchases or spend we correct (duplicates sent on 15 Oct, an intruder's spend on 1 Nov), with a remove button. */
function AdjustmentDays() {
  const { toast } = useUi();
  const [days, setDays] = useState<{ date: string; reason: string; purchases: number; value: number; spend: number; campaigns: number; unknown: number }[]>([]);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const load = () => call<{ days: typeof days; campaigns: typeof campaigns }>('GET', '/api/meta/adjustments').then((r) => { setDays(r.days); setCampaigns(r.campaigns ?? []); }).catch(() => {});
  useEffect(() => { load(); }, []);
  const [locked, setLocked] = useState<string[]>([]);
  useEffect(() => { call<{ days: string[] }>('GET', '/api/meta/lock-hours').then((r) => setLocked(r.days)).catch(() => {}); }, []);
  const [cut, setCut] = useState<{ date: string; campaign_id: string; spend: string; reason: string } | null>(null);
  return (
    <div className="small" style={{ marginTop: 10 }}>
      {locked.length > 0 && <div><b>ล็อกยอดรายชั่วโมงไว้ ไม่ดึงจาก Meta ซ้ำ:</b> {locked.join(', ')}</div>}
      <b>แก้ยอด Meta รายวัน</b> <span className="muted">— ยอดซื้อหักจากรายชั่วโมงก่อนจับคู่ออเดอร์/คิดต้นทุน · ค่าแอดหักจากทุกหน้า เป้า pace กฎ และไอเดียโพส (Meta เองไม่เปลี่ยน)</span>
      {' '}<button className="ghost small" onClick={() => setCut(cut ? null : { date: new Date(Date.now() + 7 * 3_600_000 - 86_400_000).toISOString().slice(0, 10), campaign_id: '', spend: '', reason: 'ไม่ใช่ค่าแอดของเรา' })}>{cut ? 'ยกเลิก' : 'ตัดค่าแอดออก'}</button>
      {cut && (
        <form className="row gap wrap" style={{ marginTop: 6 }} onSubmit={async (e) => {
          e.preventDefault();
          try {
            await call('POST', '/api/meta/adjustments/spend', { ...cut, spend: Number(cut.spend) });
            toast(`ตัดค่าแอด ${baht(Number(cut.spend))} ของ ${cut.date} ออกแล้ว`, 'ok'); setCut(null); load();
          } catch (err: any) { toast(err.message, 'bad'); }
        }}>
          <input type="date" value={cut.date} onChange={(e) => setCut({ ...cut, date: e.target.value })} required />
          <select value={cut.campaign_id} onChange={(e) => setCut({ ...cut, campaign_id: e.target.value })} required style={{ maxWidth: 320 }}>
            <option value="">— แคมเปญ —</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input type="number" min={1} step={0.01} placeholder="บาท" value={cut.spend} onChange={(e) => setCut({ ...cut, spend: e.target.value })} required style={{ width: 110 }} />
          <input placeholder="เหตุผล" value={cut.reason} onChange={(e) => setCut({ ...cut, reason: e.target.value })} style={{ width: 180 }} />
          <button className="small" type="submit">ตัดออก</button>
        </form>
      )}
      {days.map((d) => (
        <div key={d.date + d.reason} className="row gap" style={{ justifyContent: 'space-between' }}>
          <span>{d.date} · {d.reason}{d.purchases || d.value ? ` · −${d.purchases} ออเดอร์ · −${baht(d.value)}` : ''}{d.spend ? ` · ค่าแอด −${baht(d.spend)}` : ''} · {d.campaigns} แคมเปญ{d.unknown ? ` · ไม่ทราบแอด ${d.unknown}` : ''}</span>
          <button className="ghost small" onClick={async () => {
            try { await call('DELETE', `/api/meta/adjustments?date=${d.date}`); toast(`เลิกแก้ ${d.date} แล้ว`, 'ok'); load(); } catch (e: any) { toast(e.message, 'bad'); }
          }}>เลิกแก้วันนี้</button>
        </div>
      ))}
    </div>
  );
}

/** When a sale is sent (at the admin's note / at the bill), and what today's notes would send — nothing is sent from here. */
function NoteSource({ source, setSource }: { source: 'note' | 'bill' | null; setSource: (s: 'note' | 'bill') => void }) {
  const { toast } = useUi();
  const [rows, setRows] = useState<{ mid: string; at: string; value: number; send: boolean; why: string | null; text?: string; status: string | null }[] | null>(null);
  if (!source) return null;
  return (
    <div className="small" style={{ marginTop: 8 }}>
      <div className="row gap wrap">
        <span>ส่งตอน:</span>
        {(['note', 'bill'] as const).map((v) => (
          <button key={v} className={source === v ? '' : 'ghost'} onClick={async () => {
            try { const r = await call<{ source: 'note' | 'bill' }>('PUT', '/api/meta/purchases/source', { source: v }); setSource(r.source); toast('บันทึกแล้ว', 'ok'); } catch (e: any) { toast(e.message, 'bad'); }
          }}>{v === 'note' ? 'แอดมินพิมพ์สรุป' : 'ส่งบิลใน Page365'}</button>
        ))}
        {source === 'note' && <button className="ghost" onClick={() => call<{ rows: NonNullable<typeof rows> }>('GET', '/api/meta/purchases/note-preview').then((r) => setRows(r.rows)).catch((e) => toast(e.message, 'bad'))}>ดูว่าวันนี้จะส่งอะไร (ไม่ส่งจริง)</button>}
      </div>
      {rows && (
        <div style={{ marginTop: 6 }}>
          <div>วันนี้ {rows.filter((r) => r.send).length} ยอด · {baht(rows.filter((r) => r.send).reduce((t, r) => t + r.value, 0))}{rows.some((r) => r.status === 'sent') && ` · ส่งแล้ว ${rows.filter((r) => r.status === 'sent').length}`}</div>
          {rows.map((r) => (
            <div key={r.mid} className={r.send ? 'muted' : 'warn'}>
              {new Date(r.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })} · {baht(r.value)} · “{r.text}”{r.why ? ` — ไม่ส่ง: ${r.why}` : ''}{r.status ? ` · ${r.status}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
