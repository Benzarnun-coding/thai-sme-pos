import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Clock, Lock, Play, Plus, RotateCcw, Send, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react';
import { studioApi, clock, KIND_LABEL, type Agent, type Catalog, type Feedback, type Message, type Run, type Thread } from './api';
import type { Connection } from '../marketing/Connections';

/**
 * One box, opened.
 *
 * AI box — left: teach it (plain-language instructions, what it may see and do,
 * worked examples); right: talk to it and grade the answers. A 👎 with a note is
 * the whole training loop; the owner never sees a prompt.
 *
 * Automation or human box — the rules it follows, its schedule, and its run log.
 * No chat: it does not think, it does.
 */
const CHANNEL_LABEL: Record<string, string> = { facebook: 'Facebook', tiktok: 'TikTok', shopee: 'Shopee', line: 'LINE', pos: 'POS' };
/** Negative ids for messages not yet saved by the server, so they never collide with real ones. */
let pendingId = 0;
const nextPendingId = () => --pendingId;

export default function AgentPage({ store, slug, catalog, connections, onBack }: {
  store: string; slug: string; catalog: Catalog; connections: Connection[]; onBack: () => void;
}) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [feedback, setFeedback] = useState<Feedback>({ up: 0, down: 0, corrections: [] });
  const [runs, setRuns] = useState<Run[]>([]);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [threadId, setThreadId] = useState<string | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [why, setWhy] = useState<number | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const def = catalog.agents.find((a) => a.slug === slug);

  const load = () => studioApi.agent(store, slug).then((p) => { setAgent(p.agent); setDraft(p.agent.instructions); setThreads(p.threads); setFeedback(p.feedback); setRuns(p.runs); })
    .catch((e) => setError((e as Error).message));
  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [store, slug]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const save = async (patch: Parameters<typeof studioApi.update>[2]) => {
    try { const a = await studioApi.update(store, slug, patch); setAgent(a); setSaved(true); setError(null); }
    catch (e) { setError((e as Error).message); }
  };
  const toggleAddon = (kind: 'knowledge' | 'actions' | 'connections', id: string) => {
    if (!agent) return;
    const cur = agent.addons[kind] ?? [];
    save({ addons: { ...agent.addons, [kind]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] } });
  };
  const runNow = async () => {
    setRunning(true); setError(null);
    try {
      const { run, agent: a } = await studioApi.run(store, slug);
      setAgent(a); setRuns((r) => [run, ...r].slice(0, 10));
      // an AI run is a real conversation — show it in the chat so the owner can grade it
      const out = run.output as { thread_id?: string } | null;
      if (a.kind === 'ai' && out?.thread_id) { await openThread(out.thread_id); studioApi.agent(store, slug).then((p) => setThreads(p.threads)).catch(() => {}); }
    } catch (e) { setError((e as Error).message); }
    finally { setRunning(false); }
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput(''); setBusy(true); setError(null);
    setMessages((m) => [...m, { id: nextPendingId(), role: 'user', content: message, mode: null, created_at: '', used: null }]);
    try {
      const r = await studioApi.chat(store, slug, message, threadId);
      if (!threadId) { setThreadId(r.thread_id); studioApi.agent(store, slug).then((p) => setThreads(p.threads)).catch(() => {}); }
      setMessages((m) => [...m, { id: r.message_id, role: 'assistant', content: r.reply, mode: r.mode, created_at: '', used: r.used }]);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const openThread = async (tid: string) => {
    const t = await studioApi.thread(store, slug, tid);
    setThreadId(tid); setMessages(t.messages); setNoteFor(null);
  };

  const grade = async (m: Message, verdict: 'up' | 'down', text?: string) => {
    const r = await studioApi.feedback(store, slug, m.id, verdict, text);
    setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, verdict, note: text } : x)));
    setFeedback((f) => ({ ...f, [verdict]: f[verdict] + 1, corrections: text ? [...f.corrections, { note: text, created_at: '' }] : f.corrections }));
    setNoteFor(null); setNote('');
    return r;
  };

  if (!agent) return <div className="p-10 text-center t-sub" style={{ color: 'var(--muted)' }}>{error ?? 'กำลังโหลด…'}</div>;

  const knowledge = catalog.addons.filter((a) => a.kind === 'knowledge');
  const actions = catalog.addons.filter((a) => a.kind === 'action');
  const dirty = draft !== agent.instructions;
  const isAi = agent.kind === 'ai';

  const header = (
    <div className="flex items-center gap-3 px-4 lg:px-6 py-3 flex-wrap" style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)' }}>
      <button onClick={onBack} className="btn btn-sm" aria-label="กลับ"><ArrowLeft size={15} /> ทุกกล่อง</button>
      <span className="text-2xl leading-none">{agent.emoji}</span>
      <div className="min-w-0">
        <div className="t-head text-[17px] leading-tight flex items-center gap-2">{agent.name} <span className="chip">{KIND_LABEL[agent.kind]}</span></div>
        <div className="t-label truncate">{agent.role}</div>
      </div>
      <div className="ml-auto flex items-center gap-2 flex-wrap">
        <span className="text-xs flex items-center gap-1" style={{ color: 'var(--muted)' }}><Clock size={12} /> {agent.schedule}</span>
        {isAi && (
          <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid var(--line-2)' }}>
            {(['propose', 'auto'] as const).map((v) => (
              <button key={v} onClick={() => save({ autonomy: v })} className="px-3 py-1.5 text-sm"
                style={agent.autonomy === v ? { background: 'var(--brand)', color: 'var(--brand-ink)' } : { color: 'var(--ink-2)' }}>
                {v === 'propose' ? 'เสนอก่อน' : 'ทำเองได้'}
              </button>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--ink-2)' }}>
          <input type="checkbox" checked={agent.enabled} onChange={(e) => save({ enabled: e.target.checked })} /> เปิดใช้
        </label>
        <button className="btn btn-sm btn-primary" disabled={running || !agent.enabled} onClick={runNow}><Play size={13} /> {running ? 'กำลังรัน…' : 'รันตอนนี้'}</button>
        {isAi && (
          <button className="btn btn-sm" title="กลับไปใช้ค่าเริ่มต้น" onClick={async () => { if (confirm('ล้างสิ่งที่สอนไว้ทั้งหมด กลับไปใช้ค่าเริ่มต้น?')) { const a = await studioApi.reset(store, slug); setAgent(a); setDraft(a.instructions); } }}>
            <RotateCcw size={14} /> ค่าเริ่มต้น
          </button>
        )}
      </div>
    </div>
  );

  const runLog = (
    <section className="panel panel-pad">
      <div className="panel-head"><h3>ผลรันล่าสุด</h3><span className="t-label">{agent.cron ? `cron ${agent.cron}` : 'รันเมื่อมี event'}</span></div>
      {runs.length === 0 ? <p className="t-sub" style={{ color: 'var(--muted)' }}>ยังไม่เคยรัน กด "รันตอนนี้" เพื่อดูว่ามันทำอะไร</p> : (
        <ul className="flex flex-col">
          {runs.map((r, i) => (
            <li key={r.id} className="py-2.5 text-sm" style={i ? { borderTop: '1px solid var(--line)' } : undefined}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="t-mono t-label">{clock(r.started_at)}</span>
                <span className={`chip ${r.status === 'ok' ? 'chip-good' : r.status === 'error' ? 'chip-crit' : ''}`}>{r.status === 'ok' ? 'สำเร็จ' : r.status === 'error' ? 'ผิดพลาด' : 'ข้าม'}</span>
                <span className="t-label">{r.trigger === 'manual' ? `กดเอง${r.by ? ` · ${r.by}` : ''}` : r.trigger === 'schedule' ? 'ตามเวลา' : 'จาก event'}</span>
              </div>
              <div className="mt-1 whitespace-pre-line">{r.summary}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  /* ================= automation / human box ================= */
  if (!isAi) {
    return (
      <div className="flex-grow flex flex-col overflow-hidden">
        {header}
        {error && <div className="mx-4 lg:mx-6 mt-3 px-3 py-2 text-sm rounded-xl" style={{ background: 'var(--crit-soft)', color: 'var(--crit)' }}>{error}</div>}
        <div className="flex-grow overflow-y-auto p-4 lg:p-6 no-scrollbar">
          <div className="grid lg:grid-cols-2 gap-5 max-w-5xl">
            <section className="panel panel-pad">
              <div className="panel-head"><h3>{agent.kind === 'human' ? 'กติกาของคิวนี้' : 'กฎที่มันทำตาม'}</h3><span className="t-label">{agent.kind === 'human' ? 'คนเป็นคนกด ระบบแค่จัดคิว' : 'ไม่ใช้ AI · ผลเหมือนเดิมทุกครั้งกับข้อมูลเดิม'}</span></div>
              <ol className="space-y-2 text-sm" style={{ listStyle: 'none', padding: 0 }}>
                {(agent.rules ?? []).map((r, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="t-mono text-[11px] w-5 h-5 rounded-md grid place-items-center flex-none mt-0.5" style={{ background: 'var(--brand-soft)', color: 'var(--brand-text)' }}>{i + 1}</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ol>
              {agent.last_run?.output && (
                <details className="mt-4">
                  <summary className="t-label cursor-pointer">ข้อมูลดิบของรอบล่าสุด</summary>
                  <pre className="t-mono text-[11px] mt-2 p-3 rounded-xl overflow-x-auto" style={{ background: 'var(--panel-2)' }}>{JSON.stringify(agent.last_run.output, null, 2)}</pre>
                </details>
              )}
            </section>
            {runLog}
          </div>
        </div>
      </div>
    );
  }

  /* ================= AI box ================= */
  return (
    <div className="flex-grow flex flex-col overflow-hidden">
      {header}
      {error && <div className="mx-4 lg:mx-6 mt-3 px-3 py-2 text-sm rounded-xl" style={{ background: 'var(--crit-soft)', color: 'var(--crit)' }}>{error}</div>}

      <div className="flex-grow grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-5 p-4 lg:p-6 overflow-hidden">
        {/* ---- teach ---- */}
        <div className="overflow-y-auto no-scrollbar space-y-4 pb-4">
          <section className="panel panel-pad">
            <div className="panel-head">
              <h3>สอนด้วยการพิมพ์</h3>
              <span className="t-label">{dirty ? 'ยังไม่ได้บันทึก' : saved ? 'บันทึกแล้ว ✓' : 'พิมพ์เหมือนสั่งงานพนักงานใหม่'}</span>
            </div>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={7} className="field"
              placeholder={'เช่น\nเสนอไม่เกิน 3 ตัว\nถ้าสต็อกเหลือเยอะให้เสนอโปรเซ็ตแทนลดราคาเดี่ยว\nห้ามพูดถึงแบรนด์อื่น'} />
            <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
              <span className="t-label">หนึ่งบรรทัดต่อหนึ่งกฎ ยิ่งชัดยิ่งดี</span>
              <button className="btn btn-sm btn-primary" disabled={!dirty} onClick={() => save({ instructions: draft })}>บันทึกสิ่งที่สอน</button>
            </div>
          </section>

          {agent.runPrompt && (
            <section className="panel panel-pad">
              <div className="panel-head"><h3>ตอนรันเองมันถูกถามว่า</h3><span className="t-label">{agent.schedule}</span></div>
              <p className="text-sm px-3 py-2 rounded-xl" style={{ background: 'var(--panel-2)' }}>“{agent.runPrompt}”</p>
            </section>
          )}

          <section className="panel panel-pad">
            <div className="panel-head"><h3>ให้เห็นอะไรบ้าง</h3><span className="t-label">ความรู้ที่อ่านได้ก่อนตอบ</span></div>
            <div className="grid sm:grid-cols-2 gap-2">
              {knowledge.map((ad) => <AddonToggle key={ad.id} label={ad.label} hint={ad.hint} on={(agent.addons.knowledge ?? []).includes(ad.id)} onClick={() => toggleAddon('knowledge', ad.id)} />)}
            </div>
          </section>

          <section className="panel panel-pad">
            <div className="panel-head"><h3>ให้ทำอะไรได้บ้าง</h3><span className="t-label">สีส้ม = กระทบโลกจริง ต้องอนุมัติถ้าตั้ง "เสนอก่อน"</span></div>
            <div className="grid sm:grid-cols-2 gap-2">
              {actions.map((ad) => <AddonToggle key={ad.id} label={ad.label} hint={ad.hint} risky={ad.risky} locked={!ad.available} phase={ad.phase}
                on={(agent.addons.actions ?? []).includes(ad.id)} onClick={() => toggleAddon('actions', ad.id)} />)}
            </div>
          </section>

          <section className="panel panel-pad">
            <div className="panel-head"><h3>ต่อบัญชีไหน</h3><span className="t-label">จากหน้าเชื่อมต่อบัญชี</span></div>
            {connections.length === 0 ? <p className="t-sub" style={{ color: 'var(--muted)' }}>ยังไม่มีบัญชีที่เชื่อมต่อ ไปที่หน้าการตลาดเพื่อกดเชื่อมต่อก่อน</p> : (
              <div className="grid sm:grid-cols-2 gap-2">
                {connections.map((c) => <AddonToggle key={c.id} label={`${CHANNEL_LABEL[c.channel] ?? c.channel} · ${c.display_name ?? ''}`} hint={c.external_account_id ?? ''}
                  on={(agent.addons.connections ?? []).includes(c.id)} onClick={() => toggleAddon('connections', c.id)} />)}
              </div>
            )}
          </section>

          <section className="panel panel-pad">
            <div className="panel-head"><h3>ตัวอย่างคำตอบที่ชอบ</h3><span className="t-label">{agent.examples.length} ตัวอย่าง</span></div>
            <ul className="space-y-2 mb-3">
              {agent.examples.map((ex, i) => (
                <li key={i} className="p-3 rounded-xl text-sm" style={{ background: 'var(--panel-2)' }}>
                  <div className="flex items-start gap-2">
                    <div className="flex-grow min-w-0">
                      <div className="t-label">ถาม</div><div>{ex.ask}</div>
                      <div className="t-label mt-1.5">ตอบ</div><div className="whitespace-pre-line">{ex.answer}</div>
                    </div>
                    <button className="flex-none" aria-label="ลบตัวอย่าง" style={{ color: 'var(--muted)' }} onClick={() => save({ examples: agent.examples.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
                  </div>
                </li>
              ))}
            </ul>
            <ExampleForm onAdd={(ex) => save({ examples: [...agent.examples, ex] })} />
          </section>

          <section className="panel panel-pad">
            <div className="panel-head"><h3>สิ่งที่เรียนรู้จากการแก้</h3><span className="t-label">👍 {feedback.up} · 👎 {feedback.down}</span></div>
            {feedback.corrections.length === 0
              ? <p className="t-sub" style={{ color: 'var(--muted)' }}>กด 👎 ที่คำตอบแล้วพิมพ์ว่าควรตอบยังไง กล่องจะจำไว้ทุกครั้งถัดไป</p>
              : <ul className="space-y-1.5">{feedback.corrections.map((c, i) => <li key={i} className="text-sm flex gap-2"><span style={{ color: 'var(--good)' }}>✓</span>{c.note}</li>)}</ul>}
          </section>

          {runLog}
        </div>

        {/* ---- chat ---- */}
        <div className="panel flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 flex-wrap" style={{ borderBottom: '1px solid var(--line)' }}>
            <h3 className="t-head text-[15px]">ลองคุย</h3>
            <span className={`chip ${catalog.mode === 'claude' ? 'chip-good' : 'chip-warn'}`}>{catalog.mode === 'claude' ? agent.model : 'ตัวอย่าง'}</span>
            <div className="ml-auto flex items-center gap-2">
              {threads.length > 0 && (
                <select className="field !w-auto !py-1 text-sm" value={threadId ?? ''} onChange={(e) => e.target.value ? openThread(e.target.value) : (setThreadId(undefined), setMessages([]))}>
                  <option value="">บทสนทนาใหม่</option>
                  {threads.map((t) => <option key={t.id} value={t.id}>{(t.title ?? t.id).slice(0, 32)} · {t.messages}</option>)}
                </select>
              )}
              {messages.length > 0 && <button className="btn btn-sm" onClick={() => { setThreadId(undefined); setMessages([]); }}><Plus size={13} /> ใหม่</button>}
            </div>
          </div>

          <div className="flex-grow overflow-y-auto p-4 space-y-3 no-scrollbar" style={{ background: 'var(--panel-2)' }}>
            {messages.length === 0 && (
              <div className="pt-6 text-center">
                <div className="text-4xl mb-2">{agent.emoji}</div>
                <p className="t-sub mb-4">ลองถามดู หรือกดคำถามตัวอย่าง</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {(def?.starters ?? []).map((s) => <button key={s} className="btn btn-sm" onClick={() => send(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[88%]">
                  <div className="px-3.5 py-2.5 text-sm whitespace-pre-line rounded-2xl"
                    style={m.role === 'user'
                      ? { background: 'var(--brand)', color: 'var(--brand-ink)', borderBottomRightRadius: 6 }
                      : { background: 'var(--panel)', border: '1px solid var(--line)', borderBottomLeftRadius: 6 }}>
                    {m.content}
                  </div>
                  {m.role === 'assistant' && (
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      <button className="btn btn-sm !px-2" aria-label="ดี" disabled={!!m.verdict} onClick={() => grade(m, 'up')}
                        style={m.verdict === 'up' ? { background: 'var(--good-soft)', color: 'var(--good)', borderColor: 'transparent' } : undefined}><ThumbsUp size={13} /></button>
                      <button className="btn btn-sm !px-2" aria-label="ไม่ดี" disabled={!!m.verdict} onClick={() => { setNoteFor(m.id); setNote(''); }}
                        style={m.verdict === 'down' ? { background: 'var(--crit-soft)', color: 'var(--crit)', borderColor: 'transparent' } : undefined}><ThumbsDown size={13} /></button>
                      <button className="t-label ml-1" onClick={() => setWhy(why === m.id ? null : m.id)}>ทำไมถึงตอบแบบนี้</button>
                      {m.note && <span className="chip chip-good ml-1">จำแล้ว: {m.note.slice(0, 40)}{m.note.length > 40 ? '…' : ''}</span>}
                    </div>
                  )}
                  {why === m.id && m.used && (
                    <div className="mt-1 text-xs p-2.5 rounded-xl" style={{ background: 'var(--panel)', border: '1px dashed var(--line-2)', color: 'var(--ink-2)' }}>
                      อ่านจาก: {(m.used.knowledge ?? []).map((k) => catalog.addons.find((a) => a.id === k)?.label ?? k).join(', ') || '—'}
                      {' · '}สิ่งที่เคยแก้ {m.used.corrections ?? 0} ข้อ · สมอง: {m.used.model ?? m.mode}
                    </div>
                  )}
                  {noteFor === m.id && (
                    <div className="mt-2 p-3 rounded-xl" style={{ background: 'var(--panel)', border: '1px solid var(--crit)' }}>
                      <div className="t-label mb-1">ควรตอบยังไง? (กล่องจะจำไว้)</div>
                      <textarea className="field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ราคาเซ็ตต้องอยู่บรรทัดแรก" autoFocus />
                      <div className="flex gap-2 justify-end mt-2">
                        <button className="btn btn-sm" onClick={() => setNoteFor(null)}><X size={13} /></button>
                        <button className="btn btn-sm btn-primary" onClick={() => grade(m, 'down', note)}>จำไว้</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && <div className="flex"><div className="px-3.5 py-2.5 text-sm rounded-2xl" style={{ background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--muted)' }}>กำลังคิด…</div></div>}
            <div ref={bottom} />
          </div>

          <form className="flex gap-2 p-3" style={{ borderTop: '1px solid var(--line)' }} onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <input className="field" value={input} onChange={(e) => setInput(e.target.value)} placeholder={`คุยกับ${agent.name}…`} disabled={busy} />
            <button type="submit" className="btn btn-primary flex-none" disabled={busy || !input.trim()} aria-label="ส่ง"><Send size={15} /></button>
          </form>
        </div>
      </div>
    </div>
  );
}

function AddonToggle({ label, hint, on, locked, risky, phase, onClick }: {
  label: string; hint: string; on: boolean; locked?: boolean; risky?: boolean; phase?: number; onClick: () => void;
}) {
  const onColor = risky ? 'var(--warn)' : 'var(--good)';
  return (
    <button onClick={onClick} aria-pressed={on} className="flex items-start gap-2.5 p-2.5 rounded-xl text-left transition-colors"
      style={{ border: `1px solid ${on ? onColor : 'var(--line)'}`, background: on ? (risky ? 'var(--warn-soft)' : 'var(--good-soft)') : 'transparent', opacity: locked && !on ? 0.6 : 1 }}>
      <span className="w-5 h-5 rounded-md grid place-items-center flex-none text-[11px] mt-0.5"
        style={{ background: on ? onColor : 'var(--panel-2)', color: on ? '#fff' : 'var(--muted)', border: on ? 'none' : '1px solid var(--line-2)' }}>
        {locked ? <Lock size={10} /> : on ? '✓' : ''}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-snug">{label}{locked && phase ? <span className="t-label"> · เฟส {phase}</span> : null}</span>
        <span className="block t-label leading-snug">{hint}</span>
      </span>
    </button>
  );
}

function ExampleForm({ onAdd }: { onAdd: (ex: { ask: string; answer: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState('');
  const [answer, setAnswer] = useState('');
  if (!open) return <button className="btn btn-sm" onClick={() => setOpen(true)}><Plus size={13} /> เพิ่มตัวอย่าง</button>;
  return (
    <div className="space-y-2">
      <input className="field" placeholder="ถามว่า…" value={ask} onChange={(e) => setAsk(e.target.value)} />
      <textarea className="field" rows={3} placeholder="คำตอบที่อยากให้ตอบ" value={answer} onChange={(e) => setAnswer(e.target.value)} />
      <div className="flex gap-2 justify-end">
        <button className="btn btn-sm" onClick={() => setOpen(false)}>ยกเลิก</button>
        <button className="btn btn-sm btn-primary" disabled={!ask.trim() || !answer.trim()} onClick={() => { onAdd({ ask: ask.trim(), answer: answer.trim() }); setAsk(''); setAnswer(''); setOpen(false); }}>เพิ่ม</button>
      </div>
    </div>
  );
}
