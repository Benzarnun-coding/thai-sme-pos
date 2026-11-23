// /command?view=agents: the team's positions (SkillTree) and who fills them. Read-only. The data is not in the bundle:
// it comes from GET /api/command/agents, behind the same Access login as /command. Lazy-loaded (AgentsShell.tsx) so the
// dashboard never downloads this code. Design: docs/command-center/agents-design.md.
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import './command.css';
import './agents.css';
import { SESSION_EXPIRED, thrownError } from './commandErrors.ts';
import {
  NO_FILTER, STATUS_ORDER, STATUS_TH, awaitingApproval, bkkToday, countRows, deptCounts, filterRows, groupByDept, isApproved, isDraftFromTitle,
  isEvidenced, loadAgents, proposalChipCounts, sortRows, statusChipCounts, thaiDate, type Filter, type Loaded, type Position, type Status,
} from './agents/agentsView.ts';

interface AgentsBody { version: 1; status: 'ok' | 'stale' | 'missing' | 'not_connected' | 'error'; as_of: string | null; data: unknown; note?: string }
type Payload = { loaded: Loaded; updated: string | null; target: { year?: number; positions?: number } | undefined; asOf: string | null };

/** null = `body` has the positions; otherwise what to tell the user. `data: null` is "not loaded yet", never zero. */
export function agentsProblem(res: Pick<Response, 'status' | 'ok' | 'redirected'>, body: AgentsBody | null): { text: string; empty?: boolean } | null {
  if (res.status === 401 || res.redirected || (res.ok && !body)) return { text: SESSION_EXPIRED };
  if (res.status === 403) return { text: 'บัญชีนี้ดูหน้านี้ไม่ได้' };
  if (!res.ok || !body || body.version !== 1) return { text: String((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`) };
  if (body.data === null || body.data === undefined) return { text: body.note ?? 'ยังไม่ได้โหลดข้อมูลตำแหน่ง', empty: body.status === 'missing' };
  return null;
}

function useAgents() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [problem, setProblem] = useState<{ text: string; empty?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/command/agents', { headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' });
      const body = (await res.json().catch(() => null)) as AgentsBody | null;
      const bad = agentsProblem(res, body);
      if (bad) { setProblem(bad); setPayload(null); return; }
      const d = body!.data as { updated?: unknown; capacity_target?: Payload['target'] };
      setPayload({ loaded: loadAgents(body!.data), updated: thaiDate(d.updated), target: d.capacity_target, asOf: body!.as_of });
      setProblem(null);
    } catch (e) {
      setProblem({ text: thrownError(e) });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { payload, problem, loading, load };
}
const SHOW_TOP_FROM = 15;
const STATUS_CLASS: Record<Status, string> = { active: 'cc-done', 'pk-auto': 'cc-ag-pk', paused: 'cc-ag-paused', vacant: 'cc-ag-vac' };

const Chev = () => <svg className="cc-chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>;
const StatusChip = ({ s }: { s: Status }) => <span className={`cc-st ${STATUS_CLASS[s]}`}>{STATUS_TH[s]}</span>;
type Prop = NonNullable<Position['proposal']>;
/** "ข้อเสนอ" until `isApproved` says otherwise; the source badge stays after approval. */
const PropTag = ({ p }: { p: Prop }) => (
  <>
    {isApproved(p) ? <span className="cc-ag-prop cc-ag-ok">เบ๊นอนุมัติแล้ว</span> : <span className="cc-ag-prop">ข้อเสนอ · รอเบ๊นอนุมัติ</span>}
    {isDraftFromTitle(p) && <span className="cc-ag-basis">ร่างจากชื่อตำแหน่ง</span>}
    {isEvidenced(p) && <span className="cc-ag-basis">มีหลักฐาน</span>}
  </>
);
const None = ({ children = 'ไม่ระบุ' }: { children?: string }) => <span className="cc-ag-none">{children}</span>;
const covText = (c: Position['coverage']) => (c === 'full' ? 'ครอบคลุมเต็ม' : c === 'partial' ? 'ครอบคลุมบางส่วน' : null);
const srcLabel = (s: string) => (s === 'skilltree' ? 'SkillTree' : s === 'pk-jeans' ? 'PK JEANS' : s);

function who(r: Position) {
  if (r.status === 'vacant') {
    const p = r.proposal;
    if (!p) return <>ยังไม่มี agent · ยังไม่มีสเปกข้อเสนอ</>;
    return <>ยังไม่มี agent · เสนอ: <b>{p.name || 'ไม่ระบุชื่อ'}</b>{p.priority !== null ? ` · ความคุ้มอันดับ ${p.priority}` : ''}</>;
  }
  return r.agent ? <><b>{r.agent}</b>{r.team ? ` · ${r.team}` : ''}</> : <>ยังไม่ระบุ agent{r.team ? ` · ${r.team}` : ''}</>;
}

function Row({ r, onOpen }: { r: Position; onOpen: (id: string) => void }) {
  const cov = covText(r.coverage);
  return (
    <li>
      <button type="button" className={`cc-ag-row${r.status === 'vacant' ? ' cc-ag-vacant' : ''}`} data-row={r.id} aria-haspopup="dialog" onClick={() => onOpen(r.id)}>
        <span className="cc-ag-t">
          <span className="cc-ag-title">{r.title}</span>
          <span className="cc-ag-who">{who(r)}</span>
          <span className="cc-ag-tags">
            {r.proposal && (awaitingApproval(r) || r.status === 'vacant') && <PropTag p={r.proposal} />}
            {r.source !== 'skilltree' && <span className="cc-ag-srcl">นอก SkillTree · {srcLabel(r.source)}</span>}
            {cov && <span className="cc-ag-cov">{cov}</span>}
          </span>
        </span>
        <span className="cc-ag-side"><StatusChip s={r.status} /><Chev /></span>
      </button>
    </li>
  );
}

function Dl({ rows }: { rows: [string, React.ReactNode][] }) {
  return <dl className="cc-ag-dl">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}
const Items = ({ items }: { items: string[] }) => (items.length ? <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <None />);

function Detail({ r, deptName, onClose }: { r: Position; deptName: string; onClose: () => void }) {
  const p = r.proposal;
  const approved = !!p && isApproved(p);
  const showProp = p && (r.status === 'vacant' || !approved);
  const ev = r.evidence;
  const link = ev && /^https:\/\/\S+$/.test(ev);
  return (
    <div className="cc-ag-dlg-in">
      <div className="cc-ag-dlg-h">
        <button type="button" className="cc-btn" data-autofocus onClick={onClose}>ปิด</button>
        <div className="cc-grow"><h2 id="ag-dlg-t">{r.title}</h2><p className="cc-small" style={{ margin: 0 }}>{deptName} · <span className="cc-jid">{r.id}</span></p></div>
      </div>
      <div className="cc-ag-dlg-b">
        <div className="cc-ag-tags" style={{ marginBottom: 12 }}>
          <StatusChip s={r.status} />
          {p && <PropTag p={p} />}
          <span className="cc-ag-srcl">แหล่ง: {srcLabel(r.source)}</span>
        </div>
        <Dl rows={[
          ['agent ที่ทำอยู่', r.agent ?? (r.status === 'vacant' ? <None>ว่าง ยังไม่มี agent</None> : <None>ยังไม่ระบุ agent</None>)],
          ['ทีม', r.team ?? <None />],
          ['สถานะ', <>{STATUS_TH[r.status]}{r.pkAuto && <><br /><span className="cc-small">มีระบบอัตโนมัติของ PK Jeans ทำงานนี้ (บางส่วนหรือทั้งหมด) ไม่ใช่ agent ในทีม</span></>}</>],
          ['ความครอบคลุม', covText(r.coverage) ?? (r.status === 'vacant' ? <None>ยังไม่มี (ว่าง)</None> : <None />)],
          ['ธุรกิจที่ใช้', r.businesses.length ? <span className="cc-ag-pills">{r.businesses.map((b) => <span className="cc-tag" key={b}>{b}</span>)}</span> : <None />],
          ['หลักฐาน', ev ? (link ? <a href={ev} target="_blank" rel="noopener noreferrer">{ev} ↗</a> : ev) : <None>{r.status === 'vacant' ? 'ไม่มี (ตำแหน่งว่าง)' : 'ยังไม่มีหลักฐาน'}</None>],
        ]} />
        {showProp ? (
          <section className="cc-ag-propbox" aria-labelledby="ag-prop-h">
            <h3 id="ag-prop-h">สเปกข้อเสนอ <PropTag p={p} /></h3>
            <p className="cc-ag-warn">{approved
              ? <>อนุมัติโดย <b>{p.approvedBy}</b> เมื่อ {thaiDate(p.approvedOn)} · แต่ยังไม่มี agent ทำงานจริง สถานะจะเปลี่ยนเมื่อทีมสร้างเสร็จ</>
              : r.status !== 'vacant' && r.agent ? <>ตำแหน่งนี้มี agent ทำอยู่แล้ว (<b>{r.agent}</b>) สเปกนี้เป็นข้อเสนอ<b>เสริม</b>ที่ทีมร่างไว้ ยังไม่ได้สร้าง จะเริ่มทำเมื่อเบ๊นอนุมัติ (บอก Marcus ในแชท หน้านี้อ่านอย่างเดียว)</>
              : <>นี่คือสเปกที่ทีมร่างไว้ <b>ยังไม่ใช่ agent จริง</b> และยังไม่ได้สร้าง จะเริ่มทำเมื่อเบ๊นอนุมัติ (บอก Marcus ในแชท หน้านี้อ่านอย่างเดียว)</>}</p>
            <Dl rows={[
              ['ชื่อที่เสนอ', p.name || <None />],
              ['หน้าที่', p.duty || <None />],
              ['รับอะไรเข้า', <Items items={p.inputs} />],
              ['ส่งอะไรออก', <Items items={p.outputs} />],
              ['ขอบเขต', p.scope.length ? <ul className="cc-ag-scope">{p.scope.map((x, i) => <li key={i}>{x}</li>)}</ul> : <None />],
              ['ทีมที่จะดูแล', p.team ?? <None />],
              ['ความคุ้ม', p.priority !== null ? `อันดับ ${p.priority} (1 = ควรทำก่อน)` : 'ยังไม่จัดอันดับ'],
            ]} />
          </section>
        ) : r.status === 'vacant' ? (
          <div className="cc-card" style={{ marginTop: 14 }}><div className="cc-empty"><b>ยังไม่มีสเปกข้อเสนอ</b>ตำแหน่งนี้ว่าง และทีมยังไม่ได้ร่างว่าจะให้ agent ทำอะไร</div></div>
        ) : null}
        <p className="cc-src">ที่มา: ไฟล์ตำแหน่งของทีม แถว <span className="cc-jid">{r.id}</span> · ทีมบันทึกเอง ไม่ได้ดึงสถานะสดจากระบบ</p>
      </div>
    </div>
  );
}

export default function AgentsApp() {
  const { payload, problem, loading, load } = useAgents();
  useEffect(() => {
    document.title = 'ทีม Agent · Benz Command Center';
    const prev = document.body.style.background;
    document.body.style.background = '#000';
    return () => { document.body.style.background = prev; };
  }, []);
  return (
    <div className="cc">
      <header className="cc-top">
        <a className="cc-btn cc-ag-back" href="/command" aria-label="กลับไป Command Center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
        </a>
        <div className="cc-grow">
          <h1><b>ทีม</b> Agent</h1>
          <p>อ่านอย่างเดียว{payload?.updated ? ` · อัปเดตข้อมูล ${payload.updated}` : ''}</p>
        </div>
      </header>
      <main id="main">
        {!payload && loading && <div className="cc-sec" aria-busy="true" aria-label="กำลังโหลด"><div className="cc-sk" style={{ height: 132 }} /></div>}
        {!payload && !loading && problem && (
          problem.empty
            ? <div className="cc-card" style={{ marginTop: 16 }}><div className="cc-empty"><b>ยังไม่มีรายการตำแหน่ง</b>{problem.text} · ทีมต้องโหลดข้อมูลเข้าระบบก่อน หน้านี้จะไม่แสดงตัวเลขจนกว่าจะโหลด</div></div>
            : <div className="cc-banner cc-err" role="alert" style={{ marginTop: 16 }}>
                <span><b>โหลดรายการ agent ไม่ได้</b><br />{problem.text}</span>
                <button className="cc-btn" type="button" onClick={problem.text.startsWith(SESSION_EXPIRED) ? () => location.reload() : load}>{problem.text.startsWith(SESSION_EXPIRED) ? 'โหลดหน้าใหม่' : 'ลองใหม่'}</button>
              </div>
        )}
        {payload && <AgentsView p={payload} />}
      </main>
    </div>
  );
}

function AgentsView({ p: { loaded, target: TARGET } }: { p: Payload }) {
  const { rows, departments, skipped } = loaded;
  const today = useMemo(() => bkkToday(), []);
  const [f, setF] = useState<Filter>(NO_FILTER);
  const [openId, setOpenId] = useState<string | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLHeadingElement>(null);
  const lastOpener = useRef<string | null>(null);
  const deferred = useDeferredValue(f.query);
  const eff = useMemo<Filter>(() => ({ ...f, query: deferred }), [f, deferred]);

  useEffect(() => { for (const id of loaded.unknownStatus) console.warn('agents data: unknown status, shown as paused:', id); if (skipped.length) console.warn('agents data: skipped rows:', skipped.join(', ')); }, [skipped, loaded.unknownStatus]);

  // Detail <-> history: a pushed #id so the phone's back button closes the dialog.
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  useEffect(() => {
    const fromHash = () => { const h = decodeURIComponent(location.hash.slice(1)); return byId.has(h) ? h : null; };
    setOpenId(fromHash());
    const onPop = () => setOpenId(fromHash());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [byId]);
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (openId && !d.open) { d.showModal(); d.querySelector<HTMLElement>('[data-autofocus]')?.focus(); }
    if (!openId && d.open) {
      d.close();
      const id = lastOpener.current;
      if (id) document.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`)?.focus();
    }
  }, [openId]);
  const open = (id: string) => { lastOpener.current = id; history.pushState({ ag: id }, '', `#${encodeURIComponent(id)}`); setOpenId(id); };
  const close = () => {
    if (history.state?.ag) history.back();
    else { history.replaceState(null, '', location.pathname + location.search); setOpenId(null); }
  };

  const all = useMemo(() => countRows(rows, today), [rows, today]);
  const depts = useMemo(() => deptCounts(rows, departments), [rows, departments]);
  const shown = useMemo(() => sortRows(filterRows(rows, eff, undefined, today), departments), [rows, departments, eff, today]);
  const groups = useMemo(() => groupByDept(shown, rows, departments), [shown, rows, departments]);
  const chips = useMemo(() => statusChipCounts(rows, eff), [rows, eff]);
  const pchips = useMemo(() => proposalChipCounts(rows, eff, today), [rows, eff, today]);
  const filtered = !!(f.query.trim() || f.department || f.status || f.prop || f.basis);
  const clearAll = () => setF(NO_FILTER);
  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? '';
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pickDept = (id: string) => {
    setF((x) => ({ ...x, department: x.department === id ? null : id }));
    listRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  };
  const current = openId ? byId.get(openId) ?? null : null;

  return (
    <>
        <section className="cc-sec" aria-labelledby="ag-h-sum">
          <div className="cc-sec-h"><h2 id="ag-h-sum">ภาพรวม</h2><span className="cc-when">{all.total} ตำแหน่ง</span></div>
          <div className="cc-card">
            {all.total === 0 ? (
              <div className="cc-empty"><b>ยังไม่มีรายการตำแหน่ง</b>เมื่อทีมโหลดข้อมูลตำแหน่งเข้าระบบแล้ว จะขึ้นที่นี่</div>
            ) : <>
              <div className="cc-stats" aria-label="จำนวนตำแหน่งตามสถานะ">
                <div className="cc-stat"><b>{all.active}</b><span>ใช้งาน</span></div>
                <div className="cc-stat"><b>{all.pkAuto}</b><span>PK-auto</span></div>
                <div className="cc-stat"><b>{all.paused}</b><span>พัก</span></div>
                <div className="cc-stat cc-need"><b>{all.vacant}</b><span>ว่าง</span></div>
              </div>
              <p className="cc-small">มีคนทำ {all.staffed} จาก {all.total} ตำแหน่ง (มี agent {all.active + all.paused} + PK-auto {all.pkAuto} ซึ่งไม่ใช่ agent) · ข้อเสนอรอเบ๊นอนุมัติ <b style={{ color: 'var(--y)' }}>{all.pending}</b> (มีหลักฐาน {all.pendingEvidenced} · ร่างจากชื่อตำแหน่ง {all.pendingDraft}) · ตำแหน่งว่าง {all.pendingVacant} · เสริมตำแหน่งที่มีคนทำบางส่วน {all.pendingStaffed}{all.approved ? ` · อนุมัติแล้ว ${all.approved}` : ''}
                {TARGET?.positions ? ` · เป้า ${TARGET.year ?? ''}: ${TARGET.positions} ตำแหน่ง` : ''}</p>
              <p className="cc-small">ต่อแผนก (กดแถวเพื่อกรองรายการด้านล่าง)</p>
              <table className="cc-ag-depts">
                <thead><tr><th colSpan={4} scope="colgroup"><div className="cc-ag-grid"><span>แผนก</span><span>มี</span><span>ว่าง</span><span>สัดส่วน</span></div></th></tr></thead>
                <tbody>
                  {depts.map(({ dept, total, staffed, vacant }) => (
                    <tr key={dept.id}><td>
                      <button type="button" className="cc-ag-dept-btn" aria-pressed={f.department === dept.id}
                        aria-label={`${dept.name} มี ${staffed} ว่าง ${vacant} จาก ${total} ตำแหน่ง กดเพื่อกรอง`} onClick={() => pickDept(dept.id)}>
                        <span className="cc-ag-dn">{dept.name}</span>
                        <span className="cc-ag-num">{staffed}</span>
                        <span className={`cc-ag-num${vacant > 0 ? ' cc-ag-gap' : ''}`}>{vacant}</span>
                        <span className="cc-ag-mini" aria-hidden="true"><i style={{ width: `${total ? (staffed / total) * 100 : 0}%` }} /></span>
                      </button>
                    </td></tr>
                  ))}
                </tbody>
              </table>
            </>}
            <p className="cc-src">ที่มา: นับจากข้อมูลตำแหน่งทั้งชุด (ไม่ขึ้นกับตัวกรอง) · "มี" = ใช้งาน + PK-auto + พัก · "ว่าง" = ยังไม่มี agent · PK-auto = ระบบอัตโนมัติของ PK JEANS ทำงานนี้ ไม่ใช่ agent</p>
          </div>
        </section>

        <section className="cc-sec" aria-labelledby="ag-h-list">
          <div className="cc-sec-h"><h2 id="ag-h-list" ref={listRef} tabIndex={-1}>ตำแหน่งทั้งหมด</h2></div>
          {all.total > 0 && (
            <div className="cc-ag-tools">
              <label className="cc-ag-field"><span>ค้นหา</span>
                <span className="cc-ag-search">
                  <input ref={searchRef} type="search" enterKeyHint="search" autoComplete="off" placeholder="ชื่อตำแหน่ง, agent, ทีม หรือธุรกิจ" value={f.query} onChange={(e) => setF({ ...f, query: e.target.value })} />
                  {f.query && <button type="button" className="cc-ag-clear" aria-label="ล้างคำค้น" onClick={() => { setF({ ...f, query: '' }); searchRef.current?.focus(); }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>}
                </span>
              </label>
              <label className="cc-ag-field"><span>แผนก</span>
                <select value={f.department ?? ''} onChange={(e) => setF({ ...f, department: e.target.value || null })}>
                  <option value="">ทุกแผนก ({rows.length})</option>
                  {depts.map(({ dept, total }) => <option key={dept.id} value={dept.id}>{dept.name} ({total})</option>)}
                </select>
              </label>
              <fieldset className="cc-ag-seg"><legend>สถานะ</legend>
                <button type="button" className="cc-ag-chip" aria-pressed={f.status === null} onClick={() => setF({ ...f, status: null })}>ทั้งหมด <small>{chips.all}</small></button>
                {STATUS_ORDER.map((s) => <button key={s} type="button" className="cc-ag-chip" aria-pressed={f.status === s} onClick={() => setF({ ...f, status: s })}>{STATUS_TH[s]} <small>{chips[s]}</small></button>)}
              </fieldset>
              <fieldset className="cc-ag-seg"><legend>ข้อเสนอ</legend>
                <button type="button" className="cc-ag-chip" aria-pressed={!f.prop} onClick={() => setF({ ...f, prop: null })}>ทั้งหมด</button>
                <button type="button" className="cc-ag-chip" aria-pressed={f.prop === 'pending'} onClick={() => setF({ ...f, prop: 'pending' })}>ข้อเสนอรออนุมัติ <small>{pchips.pending}</small></button>
                <button type="button" className="cc-ag-chip" aria-pressed={f.prop === 'approved'} onClick={() => setF({ ...f, prop: 'approved' })}>อนุมัติแล้ว <small>{pchips.approved}</small></button>
              </fieldset>
              <fieldset className="cc-ag-seg"><legend>ที่มาของข้อเสนอ</legend>
                <button type="button" className="cc-ag-chip" aria-pressed={!f.basis} onClick={() => setF({ ...f, basis: null })}>ทั้งหมด</button>
                <button type="button" className="cc-ag-chip" aria-pressed={f.basis === 'evidenced'} onClick={() => setF({ ...f, basis: 'evidenced' })}>มีหลักฐาน <small>{pchips.evidenced}</small></button>
                <button type="button" className="cc-ag-chip" aria-pressed={f.basis === 'draft'} onClick={() => setF({ ...f, basis: 'draft' })}>ร่างจากชื่อตำแหน่ง <small>{pchips.draft}</small></button>
              </fieldset>
            </div>
          )}
          <div className="cc-ag-result" role="status">
            <span>{filtered ? <>แสดง <b>{shown.length}</b> จาก {all.total} ตำแหน่ง</> : <>ทั้งหมด <b>{all.total}</b> ตำแหน่ง</>}</span>
            {filtered && <button type="button" className="cc-ag-link" onClick={clearAll}>ล้างตัวกรอง</button>}
          </div>
          {skipped.length > 0 && <p className="cc-small">ข้ามไป {skipped.length} แถวที่ข้อมูลไม่ครบ</p>}

          {all.total > 0 && shown.length === 0 && (
            <div className="cc-card"><div className="cc-empty">
              {f.query.trim() ? <>
                <b>ไม่พบตำแหน่งที่ตรงกับ "{f.query.trim()}"</b>
                {f.department || f.status ? 'ในตัวกรองที่เลือกอยู่ ลองล้างตัวกรองหรือใช้คำอื่น' : 'ลองคำอื่น หรือค้นด้วยชื่อทีมหรือธุรกิจ'}
                <div><button type="button" className="cc-ag-link" onClick={() => { if (f.department || f.status) clearAll(); else { setF({ ...f, query: '' }); searchRef.current?.focus(); } }}>{f.department || f.status ? 'ล้างคำค้นและตัวกรอง' : 'ล้างคำค้น'}</button></div>
              </> : <>
                <b>{f.department ? `แผนก ${deptName(f.department)} ไม่มีตำแหน่งที่ "${f.status ? STATUS_TH[f.status] : ''}"` : `ทุกแผนก ไม่มีตำแหน่งที่ "${f.status ? STATUS_TH[f.status] : ''}"`}</b>
                ลองเลือกสถานะอื่น
                <div><button type="button" className="cc-ag-link" onClick={clearAll}>ล้างตัวกรอง</button></div>
              </>}
            </div></div>
          )}

          {groups.map((g) => (
            <section className="cc-ag-group" key={g.dept.id} aria-labelledby={`ag-g-${g.dept.id}`}>
              <div className="cc-ag-gh">
                <h3 id={`ag-g-${g.dept.id}`}>{g.dept.name}</h3>
                <span>มี {g.staffed} · ว่าง {g.vacant}{filtered ? ` · แสดง ${g.rows.length}` : ''}</span>
              </div>
              <ul className="cc-list">{g.rows.map((r) => <Row key={r.id} r={r} onOpen={open} />)}</ul>
            </section>
          ))}
          {shown.length >= SHOW_TOP_FROM && <a className="cc-ag-link cc-ag-top" href="#main" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0 }); }}>กลับขึ้นด้านบน</a>}
          <p className="cc-src">ที่มา: ข้อมูลตำแหน่งที่ทีมบันทึกเองและโหลดเข้าระบบ (ไม่ได้ดึงสด) · ตำแหน่งจาก SkillTree 7 แผนก และตำแหน่งนอก SkillTree ติดป้ายแหล่งที่มา · "ข้อเสนอ" คือสเปกที่ทีมร่าง ยังไม่ใช่ agent จริงจนกว่าเบ๊นอนุมัติ</p>
        </section>
      <dialog ref={dlg} className="cc-ag-dlg" aria-labelledby="ag-dlg-t" onCancel={(e) => { e.preventDefault(); close(); }}>
        {current && <Detail r={current} deptName={deptName(current.department) || current.department} onClose={close} />}
      </dialog>
    </>
  );
}
