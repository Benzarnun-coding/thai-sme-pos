// /botkb — "คลังคำตอบบอท": answers for Meta's Business AI. น้องจิบิ proposes them from the chats (Mon/Thu, and a
// first bank from all chats); Benz/Max approve here or in Discord; Fear copies the approved ones into Business Suite
// on Monday and presses "ใส่บอทแล้ว". Meta has no API for the bot's settings, so pasting stays a person's job.

import { useEffect, useState } from 'react';
import { HomeLogo, SiteNav } from './SiteNav.tsx';
import { useUi } from './ui.tsx';

interface KbItem {
  id: number; created_at: string; kind: 'fix' | 'faq'; question: string; answer: string; rule: string | null;
  why: string | null; evidence: string | null; status: 'proposed' | 'approved' | 'rejected' | 'applied';
  decided_by: string | null; decided_at: string | null; applied_at: string | null;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data: any = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

const STATUS: Record<KbItem['status'], string> = { approved: 'อนุมัติแล้ว · รอใส่บอท', proposed: 'รอตรวจ', applied: 'ใส่บอทแล้ว', rejected: 'ไม่ใช้' };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' }) : '');

export function BotKbApp() {
  useEffect(() => { document.title = 'คลังคำตอบบอท'; }, []);
  const { toast } = useUi();
  const [items, setItems] = useState<KbItem[] | null>(null);
  const [paste, setPaste] = useState('');
  const [tab, setTab] = useState<KbItem['status']>('approved');
  const [busy, setBusy] = useState(false);
  const load = () => call<{ items: KbItem[]; paste: string }>('GET', '/api/botkb').then((r) => { setItems(r.items); setPaste(r.paste); }).catch((e) => toast(e.message, 'bad'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const count = (s: KbItem['status']) => (items ?? []).filter((x) => x.status === s).length;
  const shown = (items ?? []).filter((x) => x.status === tab);
  const decide = async (id: number, status: 'approved' | 'rejected' | 'proposed') => {
    try { await call('POST', `/api/botkb/${id}`, { status }); await load(); } catch (e: any) { toast(e.message, 'bad'); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(paste); toast('คัดลอกแล้ว — ไปวางใน Business AI ได้เลย', 'ok'); }
    catch { toast('คัดลอกไม่ได้ — เลือกข้อความในกล่องแล้วคัดลอกเองนะคะ', 'bad'); }
  };

  return (
    <div className="kb-page">
      <SiteNav current="/botkb" />
      <header className="kb-head">
        <div className="row"><HomeLogo text="AI" /><h1>คลังคำตอบบอท Business AI</h1></div>
        <p className="muted small">น้องจิบิเสนอจากแชทจริง (จันทร์/พฤหัส) · เบ้น/แม็กซ์อนุมัติ · เฟียร์คัดลอกไปใส่ Meta Business Suite → Business AI ทุกวันจันทร์ แล้วกด "ใส่บอทแล้ว"</p>
      </header>

      <div className="segmented" role="tablist">
        {(['approved', 'proposed', 'applied', 'rejected'] as const).map((s) => (
          <button key={s} role="tab" aria-selected={tab === s} className={tab === s ? 'on' : ''} onClick={() => setTab(s)}>{STATUS[s]} ({count(s)})</button>
        ))}
      </div>

      {tab === 'approved' && count('approved') > 0 && (
        <section className="card kb-paste">
          <div className="row between">
            <h2>ข้อความสำหรับวางในบอท</h2>
            <div className="row">
              <button onClick={copy}>คัดลอกทั้งหมด</button>
              <button className="ghost" disabled={busy} onClick={async () => {
                setBusy(true);
                try { const r = await call<{ applied: number }>('POST', '/api/botkb/applied'); toast(`บันทึกแล้ว ${r.applied} ข้อ`, 'ok'); await load(); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
              }}>ใส่บอทแล้ว</button>
            </div>
          </div>
          <textarea id="kb-paste" readOnly value={paste} rows={Math.min(16, paste.split('\n').length + 1)} onFocus={(e) => e.currentTarget.select()} />
        </section>
      )}

      {items === null ? <div className="skeleton" style={{ height: 200 }} /> : shown.length === 0 ? (
        <p className="muted">{tab === 'approved' ? 'ไม่มีข้อที่รอใส่บอทค่ะ' : tab === 'proposed' ? 'ไม่มีข้อที่รอตรวจ — น้องจิบิจะเสนอรอบถัดไปวันจันทร์/พฤหัส 08:00' : 'ยังไม่มี'}</p>
      ) : (
        <div className="kb-list">
          {shown.map((it) => (
            <article key={it.id} className="card kb-item">
              <div className="row between">
                <span className={`badge ${it.kind === 'fix' ? 'warn-badge' : ''}`}>{it.kind === 'fix' ? `แก้บอท #${it.id}` : `คำถามที่พบบ่อย #${it.id}`}</span>
                <span className="muted small">{day(it.created_at)}{it.decided_by ? ` · ${it.decided_by.replace(/^discord:/, '')} ${day(it.decided_at)}` : ''}{it.applied_at ? ` · ใส่บอท ${day(it.applied_at)}` : ''}</span>
              </div>
              <p><b>ลูกค้า:</b> {it.question}</p>
              <p><b>บอทควรตอบ:</b> {it.answer}</p>
              {it.rule && <p><b>กฎให้บอท:</b> {it.rule}</p>}
              {it.why && <p className="muted small">{it.kind === 'fix' ? 'บอทพลาด: ' : ''}{it.why}{it.evidence ? ` · ${it.evidence}` : ''}</p>}
              {it.status !== 'applied' && (
                <div className="row">
                  {it.status !== 'approved' && <button className="small" onClick={() => decide(it.id, 'approved')}>อนุมัติ</button>}
                  {it.status !== 'rejected' && <button className="ghost small" onClick={() => decide(it.id, 'rejected')}>ไม่ใช้</button>}
                  {it.status !== 'proposed' && <button className="ghost small" onClick={() => decide(it.id, 'proposed')}>กลับไปรอตรวจ</button>}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
