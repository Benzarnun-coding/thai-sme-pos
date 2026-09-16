import { useEffect, useState } from 'react';
import { Lock, ArrowRight } from 'lucide-react';
import { studioApi, type Agent, type Catalog } from './api';
import type { Connection } from '../marketing/Connections';
import AgentPage from './AgentPage';

/**
 * AI Studio — every assistant is a box you can open, teach and connect.
 *
 * Gallery on top (like a shelf of GPTs), then the "who is connected to what"
 * grid: one row per assistant, one column per add-on. Every cell is a toggle.
 */
const STORE = 'climax';

const CHANNEL_LABEL: Record<string, string> = { facebook: 'Facebook', tiktok: 'TikTok', shopee: 'Shopee', line: 'LINE', pos: 'POS' };

export default function StudioView() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [conns, setConns] = useState<Connection[]>([]);
  const [open, setOpen] = useState<string | null>(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('agent'));
  const [error, setError] = useState<string | null>(null);

  const reload = () => Promise.all([studioApi.catalog(), studioApi.agents(STORE), fetch(`/api/stores/${STORE}/connections`).then((r) => r.json())])
    .then(([c, a, cn]) => { setCatalog(c); setAgents(a); setConns(cn); setError(null); })
    .catch((e) => setError((e as Error).message));

  useEffect(() => { reload(); }, []);

  const patchAgent = async (slug: string, patch: Parameters<typeof studioApi.update>[2]) => {
    const updated = await studioApi.update(STORE, slug, patch);
    setAgents((prev) => prev.map((a) => (a.slug === slug ? updated : a)));
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

  return (
    <div className="flex-grow overflow-y-auto p-4 lg:p-6 space-y-5 no-scrollbar">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="t-head text-[22px]">ผู้ช่วย AI</h2>
          <p className="t-sub">แต่ละตัวคือกล่องหนึ่งใบ เปิดเข้าไปสอนด้วยการพิมพ์ แล้วเลือกว่าให้มันเห็นอะไร ทำอะไรได้บ้าง</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`chip ${catalog.mode === 'claude' ? 'chip-good' : 'chip-warn'}`}>
            {catalog.mode === 'claude' ? `สมองจริง · ${catalog.model}` : 'โหมดตัวอย่าง · ยังไม่ได้ใส่ API key'}
          </span>
          <span className="chip">เฟส {catalog.phase}</span>
        </div>
      </div>

      {/* ---- gallery ---- */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {agents.map((a) => {
          const k = a.addons.knowledge?.length ?? 0;
          const act = a.addons.actions?.length ?? 0;
          return (
            <div key={a.slug} className="panel panel-pad flex flex-col gap-3" style={!a.enabled ? { opacity: 0.55 } : undefined}>
              <div className="flex items-start gap-3">
                <span className="text-3xl leading-none w-12 h-12 rounded-2xl grid place-items-center flex-none" style={{ background: 'var(--brand-soft)' }}>{a.emoji}</span>
                <div className="min-w-0 flex-grow">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="t-head text-[17px]">{a.name}</h3>
                    <span className={`chip ${a.autonomy === 'auto' ? 'chip-brand' : ''}`}>{a.autonomy === 'auto' ? 'ทำเองได้' : 'เสนอก่อน'}</span>
                  </div>
                  <p className="t-sub mt-0.5">{a.role}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {(a.addons.knowledge ?? []).slice(0, 4).map((id) => <span key={id} className="chip">{catalog.addons.find((x) => x.id === id)?.label ?? id}</span>)}
                {k > 4 && <span className="chip">+{k - 4}</span>}
                {act > 0 && <span className="chip chip-good">{act} สิ่งที่ทำได้</span>}
              </div>
              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--ink-2)' }}>
                  <input type="checkbox" checked={a.enabled} onChange={(e) => patchAgent(a.slug, { enabled: e.target.checked })} />
                  เปิดใช้
                </label>
                <button className="btn btn-sm btn-primary" onClick={() => { setOpen(a.slug); window.history.replaceState(null, '', `#Studio?agent=${a.slug}`); }}>
                  เปิดกล่อง <ArrowRight size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ---- who is connected to what ---- */}
      <section className="panel panel-pad">
        <div className="panel-head">
          <h3>ใครต่อกับอะไร</h3>
          <span className="t-label">กดช่องเพื่อเปิด/ปิด · ช่องที่มีกุญแจจะเปิดได้เมื่อถึงเฟสนั้น</span>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>ผู้ช่วย</th>
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
              {agents.map((a) => {
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
                      const on = has(kind, ad.id);
                      return (
                        <td key={ad.id} className="text-center" style={{ borderLeft: i === 0 || i === knowledge.length ? '1px solid var(--line)' : undefined, padding: 6 }}>
                          <Cell on={on} locked={!ad.available} risky={ad.risky} onClick={() => toggle(kind, ad.id)} />
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
