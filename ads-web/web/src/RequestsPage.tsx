// /requests — "ไอเดียเว็บ": the feature requests the team sends with /ไอเดีย in Discord, and where each one is
// (ไอเดียใหม่ → กำลังทำ → รอตรวจ → ผ่านแล้ว, or ไม่ทำ). Decisions happen with the buttons on the Discord post;
// this page shows them and every press (worker/featureRequests.ts).

import { useEffect, useState } from 'react';
import { HomeLogo, SiteNav } from './SiteNav.tsx';
import { useUi } from './ui.tsx';

type Status = 'new' | 'doing' | 'review' | 'passed' | 'dropped';
interface LogRow { id: number; at: string; by: string; from_status: string | null; to_status: Status; note: string | null }
interface Req {
  id: number; created_at: string; author: string; area: string; title: string; detail: string | null;
  status: Status; thread_id: string | null; updated_at: string; log: LogRow[];
}

async function call<T>(method: string, path: string): Promise<T> {
  const res = await fetch(path, { method });
  const data: any = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

const STATUS: Record<Status, string> = { new: '💡 ไอเดียใหม่', doing: '🔨 กำลังทำ', review: '🧪 รอตรวจ', passed: '✅ ผ่านแล้ว', dropped: '❌ ไม่ทำ' };
const AREAS: Record<string, string> = { ads: 'แอด', backoffice: 'หลังบ้าน', gosell: 'GoSell', orders: 'ออเดอร์/บิล', bug: 'บั๊ก', other: 'อื่นๆ' };
const when = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });

export function RequestsApp() {
  useEffect(() => { document.title = 'ไอเดียเว็บ'; }, []);
  const { toast } = useUi();
  const [items, setItems] = useState<Req[] | null>(null);
  const [on, setOn] = useState(false);
  const [tab, setTab] = useState<Status>('new');
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { call<{ items: Req[]; on: boolean }>('GET', '/api/requests').then((r) => { setItems(r.items); setOn(r.on); }).catch((e) => toast(e.message, 'bad')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const count = (s: Status) => (items ?? []).filter((x) => x.status === s).length;
  const shown = (items ?? []).filter((x) => x.status === tab);

  return (
    <div className="kb-page">
      <SiteNav current="/requests" />
      <header className="kb-head">
        <div className="row"><HomeLogo text="ID" /><h1>ไอเดียพัฒนาเว็บ</h1></div>
        <p className="muted small">มาจากคำสั่ง <b>/ไอเดีย</b> ใน Discord · เบ้นกด "ให้ทำ / ไม่ทำ" และ "ผ่าน / ไม่ผ่าน" ที่โพสต์ในห้องไอเดีย · คนทำกด "ทำเสร็จแล้ว" · ทุกครั้งที่กดถูกบันทึกไว้ด้านล่างของแต่ละเรื่อง</p>
        {!on && <p className="small warn">ยังไม่เปิดใช้: ตั้ง DISCORD_REQUEST_CHANNEL_ID (ห้อง Forum) ใน wrangler.jsonc แล้วกด "ลงทะเบียนคำสั่ง /ไอเดีย"</p>}
        <div className="row">
          <button className="ghost small" disabled={busy} onClick={async () => {
            setBusy(true);
            try { const r = await call<{ ok: boolean; status: number; body: string }>('POST', '/api/requests/register'); toast(r.ok ? 'ลงทะเบียน /ไอเดีย แล้ว (อาจใช้เวลาสักครู่กว่าจะขึ้นใน Discord)' : `Discord ตอบ ${r.status}: ${r.body}`, r.ok ? 'ok' : 'bad'); }
            catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
          }}>ลงทะเบียนคำสั่ง /ไอเดีย</button>
        </div>
      </header>

      <div className="segmented" role="tablist">
        {(['new', 'doing', 'review', 'passed', 'dropped'] as const).map((s) => (
          <button key={s} role="tab" aria-selected={tab === s} className={tab === s ? 'on' : ''} onClick={() => setTab(s)}>{STATUS[s]} ({count(s)})</button>
        ))}
      </div>

      {items === null ? <div className="skeleton" style={{ height: 200 }} /> : shown.length === 0 ? (
        <p className="muted">ไม่มีเรื่องในสถานะนี้</p>
      ) : (
        <div className="kb-list">
          {shown.map((r) => (
            <article key={r.id} className="card kb-item">
              <div className="row between">
                <span className="badge">#{r.id} · {AREAS[r.area] ?? r.area}</span>
                <span className="muted small">{r.author} · {when(r.created_at)}</span>
              </div>
              <p><b>{r.title}</b></p>
              {r.detail && <p style={{ whiteSpace: 'pre-wrap' }}>{r.detail}</p>}
              <button className="ghost small" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'ซ่อนประวัติ' : `ประวัติ (${r.log.length})`}</button>
              {open === r.id && (
                <ul className="small muted">
                  {r.log.map((l) => <li key={l.id}>{when(l.at)} · {l.by} · {l.from_status ? `${STATUS[l.from_status as Status] ?? l.from_status} → ` : 'เสนอ → '}{STATUS[l.to_status] ?? l.to_status}{l.note ? ` — ${l.note}` : ''}</li>)}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
