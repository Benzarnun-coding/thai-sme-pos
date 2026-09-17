import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Play, Users } from 'lucide-react';
import { studioApi, clock, isToday, KIND_LABEL, type Agent, type Catalog, type Run } from '../studio/api';
import { buildScene, Scene, CORRIDOR_Y, H, W, type Person } from './scene';
import { TEAM_SHIRT, type Team } from './sprites';

/**
 * The office — the whole loop as a pixel floor.
 *
 * Every box is a person at a desk, in loop order. Running a box makes them
 * type; when the run ends a paper walks to the next desk. Click a person for
 * their card; run one, or run the whole loop and watch the paper travel.
 */
const STORE = 'climax';
const thb = (n: number) => '฿' + Math.round(n).toLocaleString('th-TH');

interface Summary { sales_7d: number; sales_prev_7d: number; ad_spend_7d: number; roas_7d: number | null; conversations_7d: number }

export default function OfficeView() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [loopRunning, setLoopRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, bump] = useState(0);           // re-render overlays a few times a second

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);

  const load = useCallback(() => Promise.all([
    studioApi.catalog(), studioApi.agents(STORE), fetch(`/api/stores/${STORE}/summary`).then((r) => r.json()), studioApi.runs(STORE, 30),
  ]).then(([c, a, s, r]) => { setCatalog(c); setAgents(a); setSummary(s); setRuns(r); setError(null); })
    .catch((e) => setError((e as Error).message)), []);
  useEffect(() => { load(); }, [load]);

  // build the scene once agents and catalogue are here; keep it across re-renders
  useEffect(() => {
    if (!catalog || !agents.length || sceneRef.current) return;
    const labels = Object.fromEntries(catalog.teams.map((t) => [t.id, t.label])) as Record<Team, string>;
    const { people, zones } = buildScene(agents, labels);
    const built = new Scene(people, zones);
    sceneRef.current = built;
    setScene(built);
  }, [catalog, agents]);

  // animation loop
  useEffect(() => {
    let raf = 0; let last = performance.now(); let tickN = 0;
    const frame = (now: number) => {
      const scene = sceneRef.current; const canvas = canvasRef.current;
      if (scene && canvas) {
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        scene.tick(dt, now);
        const ctx = canvas.getContext('2d');
        if (ctx) scene.render(ctx);
        if (++tickN % 6 === 0) bump((n) => n + 1);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const order = useMemo(() => [...agents].sort((a, b) => a.step - b.step).map((a) => a.slug), [agents]);
  const nextOf = (slug: string) => { const i = order.indexOf(slug); return i < 0 ? null : order[(i + 1) % order.length]; };

  const runOne = async (slug: string) => {
    const scene = sceneRef.current; if (!scene) return;
    setRunning(slug); setError(null);
    scene.startWork(slug);
    try {
      const { run, agent } = await studioApi.run(STORE, slug);
      setAgents((prev) => prev.map((a) => (a.slug === slug ? agent : a)));
      setRuns((prev) => [{ ...run, slug, name: agent.name, emoji: agent.emoji }, ...prev].slice(0, 30));
      // let the typing show for a moment even when the demo answers instantly
      await new Promise((r) => setTimeout(r, 700));
      scene.finishWork(slug, run.summary, run.status, nextOf(slug));
    } catch (e) {
      scene.finishWork(slug, (e as Error).message, 'error', null);
      setError((e as Error).message);
    } finally { setRunning(null); }
  };
  const runLoop = async () => {
    setLoopRunning(true);
    for (const slug of order) {
      const a = agents.find((x) => x.slug === slug);
      if (!a?.enabled) continue;
      await runOne(slug);
      await new Promise((r) => setTimeout(r, 900));   // let the paper arrive
    }
    setLoopRunning(false);
  };
  const toggle = async (slug: string, on: boolean) => {
    const a = await studioApi.update(STORE, slug, { enabled: on });
    setAgents((prev) => prev.map((x) => (x.slug === slug ? a : x)));
    sceneRef.current?.setEnabled(slug, on);
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const scene = sceneRef.current; const canvas = canvasRef.current; if (!scene || !canvas) return;
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
    const hit = scene.people.find((p) => x >= p.desk.x - 3 && x <= p.desk.x + 31 && y >= p.home.y - 4 && y <= p.desk.y + 18);
    const next = hit ? (selected === hit.slug ? null : hit.slug) : null;
    scene.selected = next;
    setSelected(next);
  };

  if (error && !catalog) return <div className="p-6"><div className="panel panel-pad" style={{ background: 'var(--crit-soft)', color: 'var(--crit)' }}>{error}</div></div>;
  if (!catalog || !summary) return <div className="p-10 text-center t-sub" style={{ color: 'var(--muted)' }}>กำลังโหลด…</div>;

  const sel = selected ? agents.find((a) => a.slug === selected) ?? null : null;
  const selPerson = selected && scene ? scene.person(selected) : null;
  const growth = summary.sales_prev_7d > 0 ? Math.round(((summary.sales_7d - summary.sales_prev_7d) / summary.sales_prev_7d) * 100) : null;
  const pct = (v: number) => `${(v / W) * 100}%`;
  const pctY = (v: number) => `${(v / H) * 100}%`;

  return (
    <div className="flex-grow overflow-y-auto p-4 lg:p-6 space-y-5 no-scrollbar">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="t-head text-[22px]">ออฟฟิศ</h2>
          <p className="t-sub">ทุกกล่องนั่งโต๊ะของตัวเองเรียงตาม loop · กล่องไหนรัน คนจะพิมพ์งานแล้วเดินเอากระดาษไปส่งโต๊ะถัดไป · กดที่คนเพื่อดูการ์ด</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="chip"><Users size={12} /> {agents.filter((a) => a.enabled).length}/{agents.length} คนทำงานอยู่</span>
          <button className="btn btn-sm btn-primary" disabled={loopRunning || !!running} onClick={runLoop}>
            <Play size={13} /> {loopRunning ? `กำลังรัน ${agents.find((a) => a.slug === running)?.name ?? '…'}` : 'รันทั้ง loop'}
          </button>
        </div>
      </div>

      {/* scoreboard on the wall */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Board label="ยอดขาย 7 วัน" value={thb(summary.sales_7d)} sub={growth === null ? '' : `${growth >= 0 ? '+' : ''}${growth}% เทียบสัปดาห์ก่อน`} />
        <Board label="ค่าแอด 7 วัน" value={thb(summary.ad_spend_7d)} sub={summary.roas_7d === null ? '' : `ROAS ${summary.roas_7d}x`} />
        <Board label="ทักแชท" value={String(summary.conversations_7d)} sub="จากแอด" />
        <Board label="งานที่ทำวันนี้" value={String(runs.filter((r) => isToday(r.started_at)).length)} sub={runs[0] ? `ล่าสุด ${clock(runs[0].started_at)} ${runs[0].name ?? ''}` : 'ยังไม่มี'} />
      </div>

      {/* the floor */}
      <div className="rounded-2xl overflow-hidden" style={{ background: '#1B2033', padding: 6, border: '3px solid #2B3A67', boxShadow: 'var(--shadow-lg)' }}>
        <div className="relative rounded-lg overflow-hidden" style={{ aspectRatio: `${W} / ${H}`, maxWidth: '100%', background: '#E3D3BA' }}>
          <canvas ref={canvasRef} width={W} height={H} onClick={onCanvasClick}
            className="absolute inset-0 w-full h-full cursor-pointer" style={{ imageRendering: 'pixelated' }} aria-label="ผังออฟฟิศ" />

          {/* zone labels */}
          {scene?.zones.map((z) => (
            <div key={z.team} className="absolute pointer-events-none t-head" style={{ left: pct(z.x), top: pctY(z.y + z.h + 2), fontSize: 'clamp(8px, 0.95vw, 12px)', lineHeight: 1.1, color: '#FFFFFF', background: TEAM_SHIRT[z.team], padding: '2px 6px 1px', borderRadius: 3, boxShadow: '1px 1px 0 rgba(27,32,51,.35)', whiteSpace: 'nowrap' }}>{z.label}</div>
          ))}

          {/* name tags + speech bubbles */}
          {scene?.people.map((p) => (
            <div key={p.slug} className="absolute pointer-events-none" style={{ left: pct(p.desk.x + 14), top: pctY(p.desk.y + 19), transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>
              <span className="inline-flex items-center gap-1" style={{ fontFamily: 'Mitr, sans-serif', fontSize: 'clamp(7px, 0.8vw, 11px)', lineHeight: 1.2, color: p.enabled ? '#1B2033' : '#8A90A8', background: 'rgba(255,255,255,.88)', padding: '1px 5px', borderRadius: 999, border: '1px solid rgba(27,32,51,.12)' }}>
                <i style={{ width: 5, height: 5, borderRadius: 999, background: p.enabled ? TEAM_SHIRT[p.team] : '#B9C0D6', display: 'inline-block' }} />{p.name}
              </span>
            </div>
          ))}
          {scene?.people.filter((p) => p.bubble).map((p) => (
            <div key={'b' + p.slug} className="absolute pointer-events-none"
              style={{ left: pct(Math.min(W - 70, Math.max(70, p.x + 6))), top: pctY(p.y - 5), transform: 'translate(-50%, -100%)', maxWidth: '30%', zIndex: 2 }}>
              <div className="relative px-2 py-1" style={{ fontFamily: 'Mitr, sans-serif', fontSize: 'clamp(8px, 0.9vw, 12px)', background: '#FFFFFF', border: '2px solid #1B2033', borderRadius: 6, boxShadow: '3px 3px 0 rgba(27,32,51,.25)', color: '#1B2033', lineHeight: 1.3, whiteSpace: 'normal' }}>
                {p.state === 'work' ? <span className="inline-block w-2" style={{ animation: 'officeDots 1s steps(3) infinite' }}>…</span> : ''}{p.bubble!.text.slice(0, 70)}{p.bubble!.text.length > 70 ? '…' : ''}
                <i className="absolute" style={{ left: 'calc(50% - 5px)', bottom: -7, width: 8, height: 8, background: '#FFFFFF', borderRight: '2px solid #1B2033', borderBottom: '2px solid #1B2033', transform: 'rotate(45deg)' }} />
              </div>
            </div>
          ))}

          {/* card for the selected person */}
          {sel && selPerson && (
            <div className="absolute z-10" style={{ left: pct(Math.min(W - 120, Math.max(0, selPerson.desk.x - 40))), top: pctY(selPerson.desk.y < CORRIDOR_Y ? selPerson.desk.y + 34 : selPerson.desk.y - 92), width: 'min(280px, 36%)' }}>
              <PersonCard agent={sel} running={running === sel.slug}
                onRun={() => runOne(sel.slug)} onToggle={(on) => toggle(sel.slug, on)}
                onOpen={() => { window.location.hash = `#Studio?agent=${sel.slug}`; }} onClose={() => { if (sceneRef.current) sceneRef.current.selected = null; setSelected(null); }} />
            </div>
          )}
        </div>
      </div>

      {error && <div className="px-3 py-2 text-sm rounded-xl" style={{ background: 'var(--crit-soft)', color: 'var(--crit)' }}>{error}</div>}

      {/* ticker */}
      <section className="panel panel-pad">
        <div className="panel-head"><h3>เกิดอะไรขึ้นในออฟฟิศ</h3><span className="t-label">งานล่าสุดก่อน</span></div>
        <ul className="flex flex-col">
          {runs.slice(0, 8).map((r, i) => (
            <li key={r.id} className="py-2 text-sm flex gap-3 items-start" style={i ? { borderTop: '1px solid var(--line)' } : undefined}>
              <span className="t-mono t-label w-12 flex-none">{clock(r.started_at)}</span>
              <span className="flex-none">{r.emoji}</span>
              <span className="min-w-0"><b className="font-medium">{r.name}</b> <span className={`chip ${r.status === 'ok' ? 'chip-good' : r.status === 'error' ? 'chip-crit' : ''}`}>{r.status === 'ok' ? 'สำเร็จ' : r.status === 'error' ? 'ผิดพลาด' : 'ข้าม'}</span><div className="t-sub line-clamp-1">{r.summary}</div></span>
            </li>
          ))}
          {runs.length === 0 && <li className="t-sub" style={{ color: 'var(--muted)' }}>ยังเงียบอยู่ — กด "รันทั้ง loop" ให้ทุกคนเริ่มทำงาน</li>}
        </ul>
      </section>
    </div>
  );
}

function Board({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl px-4 py-3 relative overflow-hidden" style={{ background: '#1B2033', color: '#EEF0F7', border: '3px solid #2B3A67', boxShadow: 'inset 0 0 0 2px #0F1220, var(--shadow)' }}>
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.06) 1px, transparent 1px)', backgroundSize: '4px 4px' }} />
      <div className="t-mono uppercase flex items-center gap-1.5" style={{ fontSize: 10, letterSpacing: '.08em', color: '#8A90A8' }}><i style={{ width: 6, height: 6, borderRadius: 999, background: '#5FD1FF', boxShadow: '0 0 6px #5FD1FF', display: 'inline-block' }} />{label}</div>
      <div className="t-num" style={{ fontSize: 24, lineHeight: 1.2, color: '#FFD84D', textShadow: '0 0 8px rgba(255,216,77,.35)' }}>{value}</div>
      <div className="t-mono" style={{ fontSize: 11, color: '#B7C3FF' }}>{sub || ' '}</div>
    </div>
  );
}

function PersonCard({ agent: a, running, onRun, onToggle, onOpen, onClose }: {
  agent: Agent; running: boolean; onRun: () => void; onToggle: (on: boolean) => void; onOpen: () => void; onClose: () => void;
}) {
  return (
    <div className="panel p-3 text-sm overflow-hidden relative" style={{ boxShadow: 'var(--shadow-lg)', borderTop: `4px solid ${TEAM_SHIRT[a.team]}` }}>
      <div className="flex items-start gap-2">
        <span className="text-2xl leading-none">{a.emoji}</span>
        <div className="min-w-0 flex-grow">
          <div className="flex items-center gap-1.5 flex-wrap"><b className="t-head text-[15px]">{a.name}</b><span className="chip">{KIND_LABEL[a.kind]}</span></div>
          <div className="t-label">{a.schedule}</div>
        </div>
        <button onClick={onClose} aria-label="ปิด" className="t-label">✕</button>
      </div>
      <p className="t-sub mt-1.5 line-clamp-2">{a.role}</p>
      <div className="mt-2 px-2 py-1.5 rounded-lg" style={{ background: 'var(--panel-2)' }}>
        <div className="t-label">รันล่าสุด {a.last_run ? clock(a.last_run.started_at) : '—'}</div>
        <div className="line-clamp-2">{a.last_run?.summary ?? 'ยังไม่เคยรัน'}</div>
      </div>
      <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--ink-2)' }}>
          <input type="checkbox" checked={a.enabled} onChange={(e) => onToggle(e.target.checked)} /> ทำงาน
        </label>
        <div className="flex gap-1.5">
          <button className="btn btn-sm" disabled={running || !a.enabled} onClick={onRun}><Play size={12} /> {running ? 'กำลังรัน…' : 'รัน'}</button>
          <button className="btn btn-sm btn-primary" onClick={onOpen}>เปิดกล่อง <ArrowRight size={12} /></button>
        </div>
      </div>
    </div>
  );
}

export type { Person };

if (typeof document !== 'undefined' && !document.getElementById('office-kf')) {
  const st = document.createElement('style'); st.id = 'office-kf';
  st.textContent = '@keyframes officeDots { 0% { clip-path: inset(0 100% 0 0) } 100% { clip-path: inset(0 -20% 0 0) } }';
  document.head.appendChild(st);
}
