import { useEffect, useMemo, useState } from 'react';
import { Check, RefreshCw, X } from 'lucide-react';
import { studioApi, clock, type Agent, type WorkItem, type WorkKind, type WorkPage, type WorkStatus } from '../studio/api';

/**
 * The approval queue — the one place a person is in the loop.
 *
 * Every post the reviewer passed, every ad plan, budget change and learned rule
 * waits here. Approve → the publisher runs at once (simulated until the page
 * permission exists). Reject → back with a note the boxes can learn from. The
 * other tabs are the record: what went out, what was turned down.
 */
import { STORE } from '../store';
const TABS: { id: WorkStatus[]; label: string }[] = [
  { id: ['pending'], label: 'รออนุมัติ' }, { id: ['done'], label: 'โพสต์/ทำแล้ว' }, { id: ['approved'], label: 'อนุมัติแล้ว รอโพสต์' },
  { id: ['rejected'], label: 'ไม่อนุมัติ' }, { id: ['open', 'changes'], label: 'กำลังทำในทีม' },
];
const KIND_TONE: Record<WorkKind, string> = { intel: '', brief: '', post: 'chip-brand', ad_plan: 'chip-warn', adjust: 'chip-warn', rule: 'chip-good' };
const RISK: Partial<Record<WorkKind, string>> = { post: 'โพสต์ลงเพจสาธารณะ', ad_plan: 'ใช้เงินจริงตามงบในแผน', adjust: 'เปลี่ยนงบแอดที่รันอยู่', rule: 'ทุกกล่อง AI จะยึดกฎนี้ในทุกงานถัดไป' };

export default function ApproveView({ onCount }: { onCount?: (n: number) => void }) {
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState<WorkPage | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<Record<number, string>>({});
  const [when, setWhen] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);

  const load = (t = tab) => Promise.all([studioApi.work(STORE, { status: TABS[t].id, limit: 100 }), studioApi.agents(STORE)])
    .then(([w, a]) => { setPage(w); setAgents(a); setError(null); if (t === 0) onCount?.(w.items.length); })
    .catch((e) => setError((e as Error).message));
  useEffect(() => { load(tab); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [tab]);

  const byId = useMemo(() => Object.fromEntries(agents.map((a) => [a.slug, a])), [agents]);
  const who = (slug: string | null) => (slug ? byId[slug] : null);

  const act = async (it: WorkItem, decision: 'approve' | 'reject') => {
    setBusy(it.id); setError(null);
    try {
      const at = when[it.id] ? new Date(when[it.id]).toISOString() : null;
      const { run, item } = await studioApi.decide(STORE, it.id, decision, note[it.id], decision === 'approve' ? at : null);
      setLast(decision === 'approve'
        ? (run ? `อนุมัติแล้ว · ${run.summary}` : item.publish_at ? `อนุมัติแล้ว · นัดโพสต์ ${clock(item.publish_at)} ตัวโพสต์จะทำเมื่อถึงเวลา` : 'อนุมัติแล้ว · กฎนี้มีผลกับทุกกล่องตั้งแต่งานถัดไป')
        : 'ไม่อนุมัติ · บันทึกเหตุผลไว้แล้ว');
      await load(tab);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  if (error && !page) return <div className="p-6"><div className="panel panel-pad" style={{ background: 'var(--crit-soft)', color: 'var(--crit)' }}>{error}</div></div>;
  if (!page) return <div className="p-10 text-center t-sub" style={{ color: 'var(--muted)' }}>กำลังโหลด…</div>;
  const items = page.items;

  return (
    <div className="flex-grow overflow-y-auto p-4 lg:p-6 space-y-5 no-scrollbar">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="t-head text-[22px]">คิวอนุมัติ</h2>
          <p className="t-sub">ทุกอย่างที่จะออกสู่โลกภายนอกหรือใช้เงิน มาหยุดที่นี่ก่อน · อนุมัติ = ตัวโพสต์ทำต่อทันที · ไม่อนุมัติ = บอกเหตุผลสั้น ๆ ทีมจะเรียนรู้</p>
        </div>
        <button className="btn btn-sm" onClick={() => load(tab)}><RefreshCw size={13} /> โหลดใหม่</button>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {TABS.map((t, i) => <button key={t.label} className={`chip ${tab === i ? 'chip-brand' : ''}`} onClick={() => setTab(i)}>{t.label}{tab === i ? ` ${items.length}` : ''}</button>)}
      </div>

      {last && <div className="px-3 py-2 text-sm rounded-xl" style={{ background: 'var(--good-soft)', color: 'var(--good)' }}>{last}</div>}
      {error && <div className="px-3 py-2 text-sm rounded-xl" style={{ background: 'var(--crit-soft)', color: 'var(--crit)' }}>{error}</div>}

      {items.length === 0 && (
        <div className="panel panel-pad t-sub" style={{ color: 'var(--muted)' }}>
          {tab === 0 ? 'ไม่มีอะไรรออนุมัติ — เมื่อกล่องส่งงานมาถึงตรงนี้ จะเห็นที่นี่และเป็นตัวเลขบนเมนู' : 'ยังไม่มีรายการ'}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {items.map((it) => {
          const from = who(it.from_slug); const maker = who(it.kind === 'post' ? 'copywriter' : it.from_slug);
          return (
            <article key={it.id} className="panel panel-pad flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`chip ${KIND_TONE[it.kind]}`}>{page.labels.kind[it.kind]}</span>
                    <span className="chip">{page.labels.status[it.status]}</span>
                    {it.review && it.kind === 'post' && <span className={`chip ${it.review.pass ? 'chip-good' : it.review.pass === false ? 'chip-crit' : 'chip-warn'}`}>ผู้ตรวจ: {it.review.pass ? 'ผ่าน' : it.review.pass === false ? 'ไม่ผ่าน' : 'ไม่ฟันธง'}</span>}
                    {it.rounds > 1 && <span className="chip">แก้แล้ว {it.rounds - 1} รอบ</span>}
                    {it.published_as && <span className="chip chip-good">โพสต์แล้ว ({it.published_as})</span>}
                    {it.budget_thb != null && <span className="chip chip-warn">฿{Math.round(it.budget_thb).toLocaleString('th-TH')}/วัน</span>}
                    {it.status === 'approved' && it.publish_at && <span className="chip">นัด {new Date(it.publish_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
                  </div>
                  <h3 className="t-head text-[15px] mt-1.5">{it.title}</h3>
                  <div className="t-label mt-0.5">{maker?.emoji} {maker?.name ?? it.from_slug}{from && from.slug !== maker?.slug ? ` → ส่งมาโดย ${from.emoji} ${from.name}` : ''} · {clock(it.updated_at)}{it.decided_by ? ` · ตัดสินโดย ${it.decided_by}` : ''}</div>
                </div>
              </div>

              <pre className="text-sm whitespace-pre-wrap rounded-xl px-3 py-2 max-h-72 overflow-y-auto" style={{ background: 'var(--panel-2)', fontFamily: 'inherit', margin: 0 }}>{it.body}</pre>

              {it.review && it.review.issues.length > 0 && (
                <div className="text-sm rounded-xl px-3 py-2" style={{ background: 'var(--warn-soft)', color: 'var(--ink)' }}>
                  <div className="t-label mb-0.5">ผู้ตรวจพบ</div>
                  <ul className="list-disc pl-4">{it.review.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </div>
              )}
              {it.decision_note && <div className="text-sm rounded-xl px-3 py-2" style={{ background: 'var(--panel-2)' }}><span className="t-label">หมายเหตุ</span> {it.decision_note}</div>}

              {it.status === 'pending' && (
                <div className="mt-auto space-y-2">
                  <div className="t-label">ถ้าอนุมัติ: {RISK[it.kind]}</div>
                  <input className="field w-full" placeholder="หมายเหตุ (ไม่บังคับ) — ถ้าไม่อนุมัติ บอกสั้น ๆ ว่าทำไม ทีมจะได้แก้" value={note[it.id] ?? ''} onChange={(e) => setNote({ ...note, [it.id]: e.target.value })} />
                  {it.kind !== 'rule' && (
                    <label className="flex items-center gap-2 text-xs flex-wrap" style={{ color: 'var(--ink-2)' }}>นัดเวลา (ไม่บังคับ · ว่างไว้ = ทำทันที)
                      <input type="datetime-local" className="field" value={when[it.id] ?? ''} onChange={(e) => setWhen({ ...when, [it.id]: e.target.value })} />
                    </label>
                  )}
                  <div className="flex gap-2 justify-end">
                    <button className="btn btn-sm" disabled={busy === it.id} onClick={() => act(it, 'reject')}><X size={13} /> ไม่อนุมัติ</button>
                    <button className="btn btn-sm btn-primary" disabled={busy === it.id} onClick={() => act(it, 'approve')}><Check size={13} /> {busy === it.id ? 'กำลังทำ…' : it.kind === 'rule' ? 'อนุมัติกฎนี้' : 'อนุมัติ'}</button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
