import { useEffect, useState } from 'react';
import { Lock, ArrowRight, Play, Clock } from 'lucide-react';
import { studioApi, clock, KIND_LABEL, type Agent, type Catalog, type Team } from './api';
import type { Connection } from '../marketing/Connections';
import AgentPage from './AgentPage';

/**
 * The back office — every box in the daily loop, in loop order.
 *
 * Five groups (sense → create → approve → run ads → learn). Each card says what
 * kind of box it is, when it runs, and what it did last time; a button runs it
 * now. AI boxes open into teach + chat, the others into rules + run log. Below,
 * the "who is connected to what" grid for the AI boxes.
 */
const STORE = 'climax';
const CHANNEL_LABEL: Record<string, string> = { facebook: 'Facebook', tiktok: 'TikTok', shopee: 'Shopee', line: 'LINE', pos: 'POS' };

const KIND_STYLE: Record<string, { bg: string; fg: string }> = {
  ai: { bg: 'var(--brand-soft)', fg: 'var(--brand-text)' },
  automation: { bg: 'var(--panel-2)', fg: 'var(--ink-2)' },
  human: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' },
};

export default function StudioView() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [conns, setConns] = useState<Connection[]>([]);
  const [open, setOpen] = useState<string | null>(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('agent'));
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => Promise.all([studioApi.catalog(), studioApi.agents(STORE), fetch(`/api/stores/${STORE}/connections`).then((r) => r.json())])
    .then(([c, a, cn]) => { setCatalog(c); setAgents(a); setConns(cn); setError(null); })
    .catch((e) => setError((e as Error).message));

  useEffect(() => { reload(); }, []);

  const patchAgent = async (slug: string, patch: Parameters<typeof studioApi.update>[2]) => {
    const updated = await studioApi.update(STORE, slug, patch);
    setAgents((prev) => prev.map((a) => (a.slug === slug ? updated : a)));
  };
  const runNow = async (slug: string) => {
    setRunning(slug);
    try { const { agent } = await studioApi.run(STORE, slug); setAgents((prev) => prev.map((a) => (a.slug === slug ? agent : a))); }
    catch (e) { setError((e as Error).message); }
    finally { setRunning(null); }
  };
  const runAll = async () => {
    for (const a of agents.filter((x) => x.enabled)) await runNow(a.slug);
  };

  if (error) return <div className="p-6"><div className="panel panel-pad" style={{ background: 'var(--crit-soft)', color: 'var(--crit)' }}>{error}</div></div>;
  if (!catalog) return <div className="p-10 text-center t-sub" style={{ color: 'var(--muted)' }}>กำลังโหลด…</div>;

  if (open) {
    return <AgentPage store={STORE} slug={open} catalog={catalog} connections={conns.filter((c) => c.status === 'connected')}
      onBack={() => { setOpen(null); window.history.replaceState(null, '', '#Studio'); reload(); }} />;
  }

  const knowledge = catalog.addons.filter((a) => a.kind === 'knowledge');
  const actions = catalog.addons.filter((a) => a.kind === 'action');
  const connected = conns.filter((c) => c.status === 'connected');
  const aiAgents = agents.filter((a) => a.kind === 'ai');
  const openBox = (slug: string) => { setOpen(slug); window.history.replaceState(null, '', `#Studio?agent=${slug}`); };

  return (
    <div className="flex-grow overflow-y-auto p-4 lg:p-6 space-y-6 no-scrollbar">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="t-head text-[22px]">ระบบหลังบ้าน</h2>
          <p className="t-sub">ทุกกล่องใน loop สร้างคอนเทนต์ → อนุมัติ → โพสต์ → ยิงแอด → วัดผล → เรียนรู้ · กล่อง AI สอนได้ด้วยการพิมพ์ กล่องอัตโนมัติทำตามกฎ</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`chip ${catalog.mode === 'claude' ? 'chip-good' : 'chip-warn'}`}>
            {catalog.mode === 'claude' ? `สมองจริง · ${catalog.model}` : 'โหมดตัวอย่าง · ยังไม่ได้ใส่ API key'}
          </span>
          <span className="chip">เฟส {catalog.phase}</span>
          <button className="btn btn-sm btn-primary" disabled={!!running} onClick={runAll}>
            <Play size={13} /> {running ? `กำลังรัน ${agents.find((a) => a.slug === running)?.name ?? ''}…` : 'รันทั้ง loop ตอนนี้'}
          </button>
        </div>
      </div>

      {/* ---- the loop, group by group ---- */}
      {catalog.teams.map((team) => {
        const list = agents.filter((a) => a.team === team.id);
        if (!list.length) return null;
        return (
          <section key={team.id}>
            <div className="flex items-baseline gap-3 mb-3">
              <h3 className="t-head text-[16px]">{team.label}</h3>
              <span className="t-label">ขั้น {list[0].step}{list.length > 1 ? `–${list[list.length - 1].step}` : ''} ของ loop</span>
            </div>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {list.map((a) => <BoxCard key={a.slug} agent={a} catalog={catalog} running={running === a.slug}
                onToggle={(on) => patchAgent(a.slug, { enabled: on })} onRun={() => runNow(a.slug)} onOpen={() => openBox(a.slug)} />)}
            </div>
          </section>
        );
      })}

      {/* ---- who is connected to what (AI boxes) ---- */}
      <section className="panel panel-pad">
        <div className="panel-head">
          <h3>ใครต่อกับอะไร</h3>
          <span className="t-label">เฉพาะกล่อง AI · กดช่องเพื่อเปิด/ปิด · ช่องที่มีกุญแจจะทำงานเมื่อถึงเฟสนั้น</span>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>กล่อง AI</th>
                <th colSpan={knowledge.length} className="text-center" style={{ borderLeft: '1px solid var(--line)' }}>เห็นอะไร</th>
                <th colSpan={actions.length} className="text-center" style={{ borderLeft: '1px solid var(--line)' }}>ทำอะไรได้</th>
                {connected.length > 0 && <th colSpan={connected.length} className="text-center" style={{ borderLeft: '1px solid var(--line)' }}>ต่อบัญชีไหน</th>}
              </tr>
              <tr>
                <th></th>
                {[...knowledge, ...actions].map((ad, i) => (
                  <th key={ad.id} className="text-center font-normal" title={ad.hint}
                    style={{ fontSize: 11, lineHeight: 1.2, maxWidth: 72, whiteSpace: 'normal', borderLeft: i === 0 || i === knowledge.length ? '1px solid var(--line)' : undefined }}>
                    {ad.label}
                  </th>
                ))}
                {connected.map((c, i) => (
                  <th key={c.id} className="text-center font-normal" style={{ fontSize: 11, lineHeight: 1.2, maxWidth: 90, whiteSpace: 'normal', borderLeft: i === 0 ? '1px solid var(--line)' : undefined }}>
                    {CHANNEL_LABEL[c.channel] ?? c.channel}<br /><span style={{ color: 'var(--muted)' }}>{(c.display_name ?? '').slice(0, 18)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {aiAgents.map((a) => {
                const has = (kind: 'knowledge' | 'actions' | 'connections', id: string) => (a.addons[kind] ?? []).includes(id);
                const toggle = (kind: 'knowledge' | 'actions' | 'connections', id: string) => {
                  const cur = a.addons[kind] ?? [];
                  patchAgent(a.slug, { addons: { ...a.addons, [kind]: has(kind, id) ? cur.filter((x) => x !== id) : [...cur, id] } });
                };
                return (
                  <tr key={a.slug}>
                    <td className="whitespace-nowrap"><span className="mr-1.5">{a.emoji}</span><b className="font-medium">{a.name}</b></td>
                    {[...knowledge, ...actions].map((ad, i) => {
                      const kind = ad.kind === 'knowledge' ? 'knowledge' : 'actions';
                      return (
                        <td key={ad.id} className="text-center" style={{ borderLeft: i === 0 || i === knowledge.length ? '1px solid var(--line)' : undefined, padding: 6 }}>
                          <Cell on={has(kind, ad.id)} locked={!ad.available} risky={ad.risky} onClick={() => toggle(kind, ad.id)} />
                        </td>
                      );
                    })}
                    {connected.map((c, i) => (
                      <td key={c.id} className="text-center" style={{ borderLeft: i === 0 ? '1px solid var(--line)' : undefined, padding: 6 }}>
                        <Cell on={has('connections', c.id)} onClick={() => toggle('connections', c.id)} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function BoxCard({ agent: a, catalog, running, onToggle, onRun, onOpen }: {
  agent: Agent; catalog: Catalog; running: boolean; onToggle: (on: boolean) => void; onRun: () => void; onOpen: () => void;
}) {
  const ks = KIND_STYLE[a.kind];
  const run = a.last_run;
  const runTone = run ? (run.status === 'ok' ? 'var(--good)' : run.status === 'error' ? 'var(--crit)' : 'var(--muted)') : 'var(--muted)';
  return (
    <div className="panel panel-pad flex flex-col gap-3" style={!a.enabled ? { opacity: 0.55 } : undefined}>
      <div className="flex items-start gap-3">
        <span className="text-3xl leading-none w-12 h-12 rounded-2xl grid place-items-center flex-none" style={{ background: ks.bg }}>{a.emoji}</span>
        <div className="min-w-0 flex-grow">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="t-head text-[17px]">{a.name}</h3>
            <span className="chip" style={{ background: ks.bg, color: ks.fg, borderColor: 'transparent' }}>{KIND_LABEL[a.kind]}</span>
            {a.kind === 'ai' && <span className={`chip ${a.autonomy === 'auto' ? 'chip-brand' : ''}`}>{a.autonomy === 'auto' ? 'ทำเองได้' : 'เสนอก่อน'}</span>}
          </div>
          <p className="t-sub mt-0.5">{a.role}</p>
        </div>
      </div>

      <div className="text-xs flex items-center gap-1.5" style={{ color: 'var(--muted)' }}><Clock size={12} /> {a.schedule}</div>

      <div className="text-sm rounded-xl px-3 py-2" style={{ background: 'var(--panel-2)', borderLeft: `3px solid ${runTone}` }}>
        {run ? (
          <>
            <div className="t-label">รันล่าสุด {clock(run.started_at)} · {run.trigger === 'manual' ? 'กดเอง' : run.trigger === 'schedule' ? 'ตามเวลา' : 'จาก event'}{run.status !== 'ok' ? ` · ${run.status === 'error' ? 'ผิดพลาด' : 'ข้าม'}` : ''}</div>
            <div className="line-clamp-2 mt-0.5">{run.summary}</div>
          </>
        ) : <div className="t-label">ยังไม่เคยรัน</div>}
      </div>

      {a.kind === 'ai' && (
        <div className="flex flex-wrap gap-1">
          {(a.addons.knowledge ?? []).slice(0, 3).map((id) => <span key={id} className="chip">{catalog.addons.find((x) => x.id === id)?.label ?? id}</span>)}
          {(a.addons.knowledge?.length ?? 0) > 3 && <span className="chip">+{(a.addons.knowledge?.length ?? 0) - 3}</span>}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-1 flex-wrap">
        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--ink-2)' }}>
          <input type="checkbox" checked={a.enabled} onChange={(e) => onToggle(e.target.checked)} /> เปิดใช้
        </label>
        <div className="flex gap-2">
          <button className="btn btn-sm" disabled={running || !a.enabled} onClick={onRun} title="รันตอนนี้ เหมือนที่ตัวตั้งเวลาจะรัน">
            <Play size={13} /> {running ? 'กำลังรัน…' : 'รันตอนนี้'}
          </button>
          <button className="btn btn-sm btn-primary" onClick={onOpen}>
            {a.kind === 'ai' ? 'เปิดกล่อง' : 'ดูกฎและผลรัน'} <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Cell({ on, locked, risky, onClick }: { on: boolean; locked?: boolean; risky?: boolean; onClick: () => void }) {
  const bg = on ? (risky ? 'var(--warn)' : 'var(--good)') : 'var(--panel-2)';
  return (
    <button onClick={onClick} aria-pressed={on}
      title={locked ? 'ยังไม่เปิดในเฟสนี้ — เปิดไว้ก่อนได้ จะทำงานเมื่อถึงเฟส' : on ? 'เปิดอยู่ · กดเพื่อปิด' : 'ปิดอยู่ · กดเพื่อเปิด'}
      className="w-7 h-7 rounded-lg grid place-items-center transition-colors"
      style={{ background: bg, color: on ? '#fff' : 'var(--muted)', border: `1px solid ${on ? bg : 'var(--line-2)'}`, opacity: locked && !on ? 0.55 : 1 }}>
      {locked ? <Lock size={11} /> : on ? '✓' : ''}
    </button>
  );
}

export type { Team };
