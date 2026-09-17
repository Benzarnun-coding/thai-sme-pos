import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Play, RefreshCw, Send, TrendingDown, TrendingUp, Calendar, Swords, Boxes, MessageSquareHeart, PenLine } from 'lucide-react';
import { studioApi, clock, type Agent, type Directive, type DirectiveSource, type Run, type Trend, type TrendKind } from '../studio/api';

/**
 * Trend → command.
 *
 * Left: what is happening now (a product taking off, a competitor angle, a
 * shopping day, a post that worked), each with a ready Thai instruction. Right:
 * the command box. The owner picks a trend or types their own, ticks which AI
 * boxes get it, and saves. The command rides in those boxes' prompts until it
 * expires or is marked done; "save and run" also runs them right away.
 */
const STORE = 'climax';

const KIND: Record<TrendKind, { label: string; icon: React.ReactNode; tone: string }> = {
  rising: { label: 'กำลังมา', icon: <TrendingUp size={14} />, tone: 'chip-good' },
  falling: { label: 'ยอดตก', icon: <TrendingDown size={14} />, tone: 'chip-crit' },
  overstock: { label: 'เหลือเยอะ', icon: <Boxes size={14} />, tone: 'chip-warn' },
  competitor: { label: 'คู่แข่ง', icon: <Swords size={14} />, tone: 'chip-brand' },
  season: { label: 'วันสำคัญ', icon: <Calendar size={14} />, tone: 'chip-warn' },
  post: { label: 'โพสต์ที่ได้ผล', icon: <MessageSquareHeart size={14} />, tone: 'chip-good' },
};
const SOURCE_OF: Record<TrendKind, DirectiveSource> = { rising: 'trend', falling: 'trend', overstock: 'trend', competitor: 'competitor', season: 'season', post: 'post' };
const SOURCE_LABEL: Record<DirectiveSource, string> = { trend: 'จากเทรนด์', competitor: 'จากคู่แข่ง', season: 'จากวันสำคัญ', post: 'จากโพสต์', manual: 'พิมพ์เอง' };

interface Draft { title: string; text: string; source: DirectiveSource; targets: string[]; days: number; fromTrend?: string }
const EMPTY: Draft = { title: '', text: '', source: 'manual', targets: ['strategist', 'copywriter'], days: 7 };

const daysLeft = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
};

export default function TrendView() {
  const [trends, setTrends] = useState<Trend[]>([]);
  const [directives, setDirectives] = useState<Directive[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<number, Run[]>>({});
  const [filter, setFilter] = useState<TrendKind | 'all'>('all');
  const [showDone, setShowDone] = useState(false);
  const [done, setDone] = useState<Directive[]>([]);

  const load = () => Promise.all([studioApi.trends(STORE), studioApi.agents(STORE)])
    .then(([t, a]) => { setTrends(t.trends); setDirectives(t.directives); setAgents(a); setError(null); })
    .catch((e) => setError((e as Error).message));
  useEffect(() => { load(); }, []);

  const aiBoxes = useMemo(() => agents.filter((a) => a.kind === 'ai').sort((a, b) => a.step - b.step), [agents]);
  const nameOf = (slug: string) => agents.find((a) => a.slug === slug);
  const shown = filter === 'all' ? trends : trends.filter((t) => t.kind === filter);
  const counts = trends.reduce((m, t) => { m[t.kind] = (m[t.kind] ?? 0) + 1; return m; }, {} as Record<string, number>);

  const pick = (t: Trend) => {
    setDraft({ title: t.title, text: t.suggestion, source: SOURCE_OF[t.kind], targets: t.targets.filter((s) => aiBoxes.some((a) => a.slug === s)), days: t.kind === 'season' ? 14 : 7, fromTrend: t.id });
    document.getElementById('directive-box')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const toggleTarget = (slug: string) => setDraft((d) => ({ ...d, targets: d.targets.includes(slug) ? d.targets.filter((s) => s !== slug) : [...d.targets, slug] }));

  const save = async (run: boolean) => {
    if (!draft.text.trim() || !draft.targets.length) { setError('พิมพ์คำสั่งและเลือกกล่องอย่างน้อย 1 กล่องก่อน'); return; }
    setBusy(run ? 'run' : 'save'); setError(null);
    try {
      const title = draft.title.trim() || draft.text.trim().split('\n')[0].slice(0, 60);
      const d = await studioApi.createDirective(STORE, { title, text: draft.text.trim(), source: draft.source, targets: draft.targets, days: draft.days });
      setDirectives((prev) => [d, ...prev]);
      setDraft(EMPTY);
      if (run) await runOne(d.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const runOne = async (id: number) => {
    setBusy(`run-${id}`); setError(null);
    try {
      const { runs } = await studioApi.runDirective(STORE, id);
      setResults((prev) => ({ ...prev, [id]: runs }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const finish = async (id: number) => {
    const d = await studioApi.setDirective(STORE, id, 'done');
    setDirectives((prev) => prev.filter((x) => x.id !== id));
    setDone((prev) => [d, ...prev]);
  };
  const loadDone = async () => { setShowDone(true); setDone(await studioApi.directives(STORE, 'done')); };

  if (error && !trends.length && !agents.length) return <div className="p-6"><div className="panel panel-pad" style={{ background: 'var(--crit-soft)', color: 'var(--crit)' }}>{error}</div></div>;

  return (
    <div className="flex-grow overflow-y-auto p-4 lg:p-6 space-y-5 no-scrollbar">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="t-head text-[22px]">เทรนด์ → สั่งงาน AI</h2>
          <p className="t-sub">ดูว่าอะไรกำลังมา แล้วพิมพ์สั่งทีม AI เป็นภาษาไทย · คำสั่งจะติดไปกับทุกกล่องที่เลือกทุกครั้งที่มันทำงาน จนกว่าจะหมดอายุหรือกด "เสร็จแล้ว"</p>
        </div>
        <button className="btn btn-sm" onClick={load}><RefreshCw size={13} /> อ่านเทรนด์ใหม่</button>
      </div>

      <div className="grid lg:grid-cols-[1.15fr_1fr] gap-5 items-start">
        {/* ---------- what is happening ---------- */}
        <section className="space-y-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button className={`chip ${filter === 'all' ? 'chip-brand' : ''}`} onClick={() => setFilter('all')}>ทั้งหมด {trends.length}</button>
            {(Object.keys(KIND) as TrendKind[]).filter((k) => counts[k]).map((k) => (
              <button key={k} className={`chip ${filter === k ? 'chip-brand' : ''}`} onClick={() => setFilter(k)}>{KIND[k].icon} {KIND[k].label} {counts[k]}</button>
            ))}
          </div>
          {shown.map((t) => {
            const used = directives.some((d) => d.title === t.title);
            return (
              <div key={t.id} className="panel panel-pad" style={draft.fromTrend === t.id ? { borderColor: 'var(--brand)', boxShadow: '0 0 0 3px var(--brand-soft)' } : undefined}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap"><span className={`chip ${KIND[t.kind].tone}`}>{KIND[t.kind].icon} {KIND[t.kind].label}</span>{used && <span className="chip">สั่งไปแล้ว</span>}</div>
                    <div className="t-head text-[15px] mt-1.5">{t.title}</div>
                    <div className="t-sub mt-0.5">{t.detail}</div>
                  </div>
                </div>
                <div className="mt-2.5 px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--panel-2)', color: 'var(--ink)' }}>
                  <div className="t-label mb-0.5">คำสั่งที่แนะนำ</div>
                  {t.suggestion}
                </div>
                <div className="flex items-center justify-between gap-2 mt-2.5 flex-wrap">
                  <div className="flex items-center gap-1 flex-wrap t-sub">ส่งให้ {t.targets.map((s) => nameOf(s)).filter(Boolean).map((a) => <span key={a!.slug} className="chip">{a!.emoji} {a!.name}</span>)}</div>
                  <button className="btn btn-sm btn-primary" onClick={() => pick(t)}>สั่งจากเทรนด์นี้ <ArrowRight size={13} /></button>
                </div>
              </div>
            );
          })}
          {trends.length > 0 && shown.length === 0 && <div className="t-sub" style={{ color: 'var(--muted)' }}>ไม่มีเทรนด์ประเภทนี้ตอนนี้</div>}
          {trends.length === 0 && <div className="panel panel-pad t-sub" style={{ color: 'var(--muted)' }}>ยังอ่านเทรนด์ไม่ได้ — ต้องมียอดขาย โพสต์ หรือแอดคู่แข่งในระบบก่อน</div>}
        </section>

        {/* ---------- the command box + what is active ---------- */}
        <section className="space-y-4 lg:sticky lg:top-4">
          <div id="directive-box" className="panel panel-pad" style={{ borderColor: 'var(--brand)' }}>
            <div className="panel-head"><h3><PenLine size={16} /> ออกคำสั่ง</h3>{draft.fromTrend && <button className="t-label" onClick={() => setDraft(EMPTY)}>ล้าง</button>}</div>
            <label className="block">
              <span className="t-label">หัวข้อ (สั้น ๆ)</span>
              <input className="field w-full mt-1" value={draft.title} placeholder="เช่น ดันชิโน่สไตล์เกาหลีสัปดาห์นี้" onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label className="block mt-2.5">
              <span className="t-label">คำสั่งเป็นภาษาไทย (เห็นเทรนด์อะไรจาก TikTok / ตลาด พิมพ์ได้เลย)</span>
              <textarea className="field w-full mt-1 min-h-[110px]" value={draft.text} placeholder="เช่น ตอนนี้ TikTok ฮิตกางเกงทรงกระบอกใหญ่ ให้เขียนโพสต์ชูทรงกระบอกเล็กสีดำว่าใส่ได้ทุกวัน ไม่ตกเทรนด์ และตั้งแอดทดสอบงบ 300/วัน 3 วัน"
                onChange={(e) => setDraft({ ...draft, text: e.target.value, source: draft.fromTrend ? draft.source : 'manual' })} />
            </label>
            <div className="mt-2.5">
              <span className="t-label">สั่งใคร</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {aiBoxes.map((a) => (
                  <button key={a.slug} type="button" className={`chip ${draft.targets.includes(a.slug) ? 'chip-brand' : ''}`} onClick={() => toggleTarget(a.slug)} title={a.role}>
                    {draft.targets.includes(a.slug) && <Check size={12} />} {a.emoji} {a.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
              <label className="flex items-center gap-2 text-sm whitespace-nowrap" style={{ color: 'var(--ink-2)' }}>ใช้ไป
                <select className="field" value={draft.days} onChange={(e) => setDraft({ ...draft, days: Number(e.target.value) })}>
                  {[3, 7, 14, 30].map((n) => <option key={n} value={n}>{n} วัน</option>)}
                </select>
              </label>
              <div className="flex gap-1.5">
                <button className="btn btn-sm" disabled={!!busy} onClick={() => save(false)}>บันทึกคำสั่ง</button>
                <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => save(true)}><Send size={13} /> {busy === 'run' ? 'กำลังรัน…' : 'บันทึกแล้วรันเลย'}</button>
              </div>
            </div>
            {error && <div className="mt-2 px-3 py-2 text-sm rounded-xl" style={{ background: 'var(--crit-soft)', color: 'var(--crit)' }}>{error}</div>}
          </div>

          <div className="panel panel-pad">
            <div className="panel-head"><h3>คำสั่งที่ใช้อยู่ {directives.length ? `(${directives.length})` : ''}</h3><span className="t-label">ติดไปกับทุกรันของกล่องที่เลือก</span></div>
            {directives.length === 0 && <div className="t-sub" style={{ color: 'var(--muted)' }}>ยังไม่มี — เลือกเทรนด์ทางซ้าย หรือพิมพ์คำสั่งเองด้านบน</div>}
            <ul className="flex flex-col">
              {directives.map((d, i) => {
                const left = daysLeft(d.expires_at);
                const res = results[d.id];
                return (
                  <li key={d.id} className="py-3" style={i ? { borderTop: '1px solid var(--line)' } : undefined}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap"><b className="font-medium">{d.title}</b><span className="chip">{SOURCE_LABEL[d.source]}</span>{left !== null && <span className={`chip ${left <= 1 ? 'chip-warn' : ''}`}>เหลือ {left} วัน</span>}</div>
                        <div className="t-sub mt-0.5 line-clamp-2">{d.text}</div>
                        <div className="flex items-center gap-1 flex-wrap mt-1.5">{d.targets.map((s) => nameOf(s)).filter(Boolean).map((a) => <span key={a!.slug} className="chip">{a!.emoji} {a!.name}</span>)}</div>
                      </div>
                      <div className="flex flex-col gap-1 flex-none">
                        <button className="btn btn-sm" disabled={!!busy} onClick={() => runOne(d.id)}><Play size={12} /> {busy === `run-${d.id}` ? 'กำลังรัน…' : 'รันตอนนี้'}</button>
                        <button className="btn btn-sm" onClick={() => finish(d.id)}><Check size={12} /> เสร็จแล้ว</button>
                      </div>
                    </div>
                    {res && (
                      <div className="mt-2 px-3 py-2 rounded-xl text-sm space-y-1.5" style={{ background: 'var(--panel-2)' }}>
                        <div className="t-label">ผลที่ได้ตอน {clock(res[0]?.started_at)}</div>
                        {res.map((r) => {
                          const a = agents.find((x) => x.id === r.agent_id);
                          return (
                            <div key={r.id} className="flex gap-2 items-start">
                              <span className="flex-none">{a?.emoji}</span>
                              <span className="min-w-0"><b className="font-medium">{a?.name}</b> <span className={`chip ${r.status === 'ok' ? 'chip-good' : r.status === 'error' ? 'chip-crit' : ''}`}>{r.status === 'ok' ? 'สำเร็จ' : r.status === 'error' ? 'ผิดพลาด' : 'ข้าม'}</span>
                                <div className="t-sub whitespace-pre-line">{String((r.output as { text?: string } | null)?.text ?? r.summary).slice(0, 600)}</div>
                                {a && <a className="t-label underline" href={`#Studio?agent=${a.slug}`}>ดูทั้งหมดในกล่อง →</a>}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-2">
              {!showDone ? <button className="t-label underline" onClick={loadDone}>ดูคำสั่งที่เสร็จแล้ว</button>
                : <div className="t-sub">{done.length ? done.map((d) => <div key={d.id} className="line-clamp-1">✓ {d.title} <span className="t-label">{SOURCE_LABEL[d.source]}</span></div>) : 'ยังไม่มีคำสั่งที่เสร็จ'}</div>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
