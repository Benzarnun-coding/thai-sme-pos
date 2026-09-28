import { useState } from 'react';
import { api, MODE_LABEL, WINDOW_LABEL, type CampaignView, type EntityView, type Overview as OverviewData, type Stage, type Window } from './api.ts';
import { baht, num, roas, roasTone, time, when } from './fmt.ts';
import type { RulesTarget } from './RulesPage.tsx';
import { NONE, StageTabs, campaignsIn, type StageTab } from './StageTabs.tsx';

interface Props {
  data: OverviewData;
  window: Window;
  onWindow: (w: Window) => void;
  onReload: () => void;
  /** Ask Meta again instead of the few-minutes cache */
  onRefresh: () => void;
  onOpenRules: (t: RulesTarget) => void;
  stageTab: StageTab;
  onStageTab: (t: StageTab) => void;
}

export function Overview({ data, window, onWindow, onReload, onRefresh, onOpenRules, stageTab, onStageTab }: Props) {
  const all = data.campaigns.reduce(
    (t, c) => ({ spend: t.spend + (c.metrics?.spend ?? 0), purchases: t.purchases + (c.metrics?.purchases ?? 0), value: t.value + (c.metrics?.purchase_value ?? 0) }),
    { spend: 0, purchases: 0, value: 0 },
  );
  const withProfit = data.campaigns.filter((c) => c.profit !== null && (c.metrics?.spend ?? 0) > 0);
  const spending = data.campaigns.filter((c) => (c.metrics?.spend ?? 0) > 0).length;
  const profit = withProfit.reduce((t, c) => t + (c.profit ?? 0), 0);
  const stage = data.stages.find((s) => s.id === stageTab) ?? null;

  return (
    <>
      <div className="row between wrap">
        <div className="segmented" role="tablist" aria-label="ช่วงเวลา">
          {(data.snapshot?.windows ?? (Object.keys(WINDOW_LABEL) as Window[])).map((w) => (
            <button key={w} className={w === window ? 'on' : ''} onClick={() => onWindow(w)}>{WINDOW_LABEL[w]}</button>
          ))}
        </div>
        <div className="row">
          {!data.snapshot && <span className="muted small">ข้อมูล Meta เมื่อ {time(data.meta_fetched_at)}</span>}
          <button className="ghost" onClick={onRefresh} title="ดึงข้อมูลใหม่จาก Meta (ไม่เกินนาทีละครั้ง)">รีเฟรช</button>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><span>ใช้จ่าย</span><b>{baht(all.spend)}</b></div>
        <div className="kpi"><span>ยอดซื้อ</span><b>{num(all.purchases)}</b></div>
        <div className="kpi"><span>ROAS</span><b>{roas(all.value, all.spend)}</b></div>
        <div className="kpi">
          <span>กำไรหลังหักทุนและค่าแอด</span>
          <b className={profit < 0 ? 'bad' : ''}>{withProfit.length ? baht(profit) : '–'}</b>
          <small>{withProfit.length ? `นับ ${withProfit.length}/${spending} แคมเปญที่ผูกต้นทุนแล้ว` : 'ผูกต้นทุนในแท็บสินค้าก่อน'}</small>
        </div>
      </div>

      {data.last_run && <p className="muted small">รันล่าสุด {when(data.last_run.run_at)} · {data.last_run.summary}</p>}

      <StageTabs stages={data.stages} campaigns={data.campaigns} value={stageTab} onChange={onStageTab} />
      <StageCard key={stageTab} stage={stageTab === NONE ? null : stage} campaigns={campaignsIn(stageTab, data.campaigns)} data={data} onReload={onReload} onOpenRules={onOpenRules} />
    </>
  );
}

function StageCard({ stage, campaigns, data, onReload, onOpenRules }: {
  stage: Stage | null; campaigns: CampaignView[]; data: OverviewData; onReload: () => void; onOpenRules: (t: RulesTarget) => void;
}) {
  const t = campaigns.reduce(
    (a, c) => ({ spend: a.spend + (c.metrics?.spend ?? 0), purchases: a.purchases + (c.metrics?.purchases ?? 0), value: a.value + (c.metrics?.purchase_value ?? 0) }),
    { spend: 0, purchases: 0, value: 0 },
  );
  const profits = campaigns.filter((c) => c.profit !== null);
  const profit = profits.reduce((a, c) => a + (c.profit ?? 0), 0);
  const actionRules = stage?.rules.filter((r) => r.enabled !== false && r.action.type !== 'move').length ?? 0;
  const moveRules = stage?.rules.filter((r) => r.enabled !== false && r.action.type === 'move') ?? [];
  const sorted = [...campaigns].sort((a, b) => (b.metrics?.spend ?? 0) - (a.metrics?.spend ?? 0));

  return (
    <section className={`card stage stage-${stage?.id ?? 'none'}`}>
      <header className="card-head">
        <div>
          <h2>{stage?.name ?? 'ยังไม่จัดกลุ่ม'} <span className="muted small">{campaigns.length} แคมเปญ</span></h2>
          {stage ? (
            <div className="tags">
              <span className={`tag ${stage.automation && actionRules ? 'on' : ''}`}>{stage.automation ? `อัตโนมัติ ${actionRules} กฎ` : 'ปิดอัตโนมัติ'}</span>
              {stage.automation && moveRules.map((r) => (
                <span key={r.id} className="tag">↪ {data.stages.find((s) => s.id === r.action.to)?.name}</span>
              ))}
              {stage.description && <span className="muted small">{stage.description}</span>}
            </div>
          ) : (
            <p className="muted small">ระบบไม่แตะแคมเปญกลุ่มนี้ — เลือกกลุ่มให้แต่ละตัวก่อน</p>
          )}
        </div>
        <div className="stats">
          <div><span>ใช้จ่าย</span><b>{baht(t.spend)}</b></div>
          <div><span>ยอดซื้อ</span><b>{num(t.purchases)}</b></div>
          <div><span>ROAS</span><b>{roas(t.value, t.spend)}</b></div>
          <div><span>กำไร</span><b className={profit < 0 ? 'bad' : ''}>{profits.length ? baht(profit) : '–'}</b></div>
        </div>
        {stage ? <button className="ghost" onClick={() => onOpenRules({ kind: 'stage', id: stage.id })}>กฎของกลุ่ม ›</button> : <span />}
      </header>
      <div className="campaigns">
        {sorted.length === 0 && (
          <p className="muted">{stage ? 'ยังไม่มีแคมเปญในกลุ่มนี้ — ย้ายเข้ามาจากช่อง "กลุ่ม" ของแต่ละแคมเปญ' : 'จัดกลุ่มครบทุกแคมเปญแล้ว'}</p>
        )}
        {sorted.map((c) => <CampaignRow key={c.id} c={c} data={data} onReload={onReload} onOpenRules={onOpenRules} />)}
      </div>
    </section>
  );
}

function CampaignRow({ c, data, onReload, onOpenRules }: { c: CampaignView; data: OverviewData; onReload: () => void; onOpenRules: (t: RulesTarget) => void }) {
  const [busy, setBusy] = useState(false);
  const [showAdsets, setShowAdsets] = useState(false);
  const m = c.metrics;
  const r = m && m.spend > 0 ? m.purchase_value / m.spend : null;
  const section = data.sections.find((s) => s.id === c.section_id);
  const readOnly = data.snapshot !== null;
  const days = c.stage_since ? Math.floor((Date.now() - new Date(c.stage_since).getTime()) / 86_400_000) : null;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); onReload(); } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  }

  const save = (patch: { section_id?: string | null; stage_id?: string | null }) => act(() => api.saveCampaign(c.id, {
    name: c.name,
    section_id: patch.section_id !== undefined ? patch.section_id : (c.pinned ? c.section_id : null),
    stage_id: patch.stage_id !== undefined ? patch.stage_id : c.stage_id,
    mode: c.mode,
    rules: c.rules,
  }));

  return (
    <div className={`campaign ${c.status !== 'ACTIVE' ? 'paused' : ''}`}>
      <div className="c-main">
        <StatusSwitch entity={c} busy={busy || readOnly} onToggle={(status) => act(() => api.setStatus(c.id, status, c.name))} />
        <div className="c-name">
          <b>{c.name}</b>
          <div className="c-metrics">
            <span>{baht(m?.spend)}</span>
            <span>{num(m?.purchases)} ออเดอร์</span>
            <span className={roasTone(r, c.breakeven_roas)} title={c.breakeven_roas ? `คุ้มทุนที่ ${num(c.breakeven_roas, 2)}` : 'ยังไม่ผูกต้นทุน'}>
              ROAS {r === null ? '–' : num(r, 2)}{c.breakeven_roas ? ` / คุ้มทุน ${num(c.breakeven_roas, 2)}` : ''}
            </span>
            {c.profit !== null && <span className={c.profit < 0 ? 'bad' : ''}>กำไร {baht(c.profit)}</span>}
            {m && m.frequency > 0 && <span>Freq {num(m.frequency, 2)}</span>}
            {days !== null && <span>อยู่กลุ่มนี้ {days} วัน</span>}
          </div>
        </div>
        <Budget entity={c} busy={busy || readOnly} nullLabel="งบอยู่ที่ ad set" onSave={(amount) => act(() => api.setBudget(c.id, amount, c.daily_budget, c.name))} />
      </div>
      <div className="c-controls">
        <label>กลุ่ม
          <select value={c.stage_id ?? ''} disabled={busy} onChange={(e) => save({ stage_id: e.target.value || null })}>
            <option value="">— ยังไม่จัด —</option>
            {data.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>สินค้า
          <select value={c.pinned ? c.section_id : ''} disabled={busy} onChange={(e) => save({ section_id: e.target.value || null })}>
            <option value="">อัตโนมัติจากชื่อ ({section?.name ?? '–'})</option>
            {data.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <button className={`small ${c.mode === 'custom' ? 'warn' : 'ghost'}`} onClick={() => onOpenRules({ kind: 'campaign', id: c.id })}>
          กฎ: {MODE_LABEL[c.mode]}{c.mode === 'custom' ? ` (${c.rules?.length ?? 0})` : ''} ›
        </button>
        {c.adsets.length > 0 && (
          <button className="ghost small" onClick={() => setShowAdsets(!showAdsets)}>{showAdsets ? 'ซ่อน' : 'ดู'} ad set ({c.adsets.length})</button>
        )}
      </div>
      {showAdsets && (
        <div className="adsets">
          {c.adsets.map((a) => <AdsetRow key={a.id} a={a} breakeven={c.breakeven_roas} readOnly={readOnly} onReload={onReload} />)}
          {c.adsets.length > 0 && c.adsets.every((a) => !a.metrics) && <p className="muted small">ยังไม่มีตัวเลขระดับ ad set ในช่วงเวลานี้</p>}
        </div>
      )}
    </div>
  );
}

function AdsetRow({ a, breakeven, readOnly, onReload }: { a: EntityView; breakeven: number | null; readOnly: boolean; onReload: () => void }) {
  const [busy, setBusy] = useState(false);
  const m = a.metrics;
  const r = m && m.spend > 0 ? m.purchase_value / m.spend : null;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); onReload(); } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  };
  return (
    <div className={`c-main adset ${a.status !== 'ACTIVE' ? 'paused' : ''}`}>
      <StatusSwitch entity={a} busy={busy || readOnly} onToggle={(status) => act(() => api.setStatus(a.id, status, a.name))} />
      <div className="c-name">
        <span>{a.name}</span>
        <div className="c-metrics">
          <span>{baht(m?.spend)}</span>
          <span>{num(m?.purchases)} ออเดอร์</span>
          <span className={roasTone(r, breakeven)}>ROAS {r === null ? '–' : num(r, 2)}</span>
          {m && m.frequency > 0 && <span>Freq {num(m.frequency, 2)}</span>}
        </div>
      </div>
      <Budget entity={a} busy={busy || readOnly} nullLabel="งบอยู่ที่แคมเปญ (CBO)" onSave={(amount) => act(() => api.setBudget(a.id, amount, a.daily_budget, a.name))} />
    </div>
  );
}

function StatusSwitch({ entity, busy, onToggle }: { entity: EntityView; busy: boolean; onToggle: (s: 'ACTIVE' | 'PAUSED') => void }) {
  const on = entity.status === 'ACTIVE';
  return (
    <button
      className={`switch ${on ? 'on' : ''}`}
      disabled={busy}
      role="switch"
      aria-checked={on}
      aria-label={on ? 'กำลังเปิด — กดเพื่อหยุด' : 'หยุดอยู่ — กดเพื่อเปิด'}
      onClick={() => {
        const next = on ? 'PAUSED' : 'ACTIVE';
        if (confirm(`${next === 'PAUSED' ? 'หยุด' : 'เปิด'} "${entity.name}" บน Meta จริงเลยใช่ไหม?`)) onToggle(next);
      }}
    >
      <span />
    </button>
  );
}

function Budget({ entity, busy, onSave, nullLabel }: { entity: EntityView; busy: boolean; onSave: (amount: number) => void; nullLabel: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(entity.daily_budget ?? ''));
  if (entity.daily_budget === null) return <div className="budget muted small">{nullLabel}</div>;
  if (!editing) {
    return (
      <button className="budget ghost" disabled={busy} onClick={() => { setValue(String(entity.daily_budget)); setEditing(true); }}>
        {baht(entity.daily_budget)}<small>/วัน ✎</small>
      </button>
    );
  }
  return (
    <form className="budget edit" onSubmit={(e) => {
      e.preventDefault();
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount <= 0) return;
      if (confirm(`เปลี่ยนงบ "${entity.name}" จาก ${baht(entity.daily_budget)} เป็น ${baht(amount)} ต่อวัน บน Meta จริงเลยใช่ไหม?`)) onSave(amount);
      setEditing(false);
    }}>
      <input type="number" autoFocus value={value} onChange={(e) => setValue(e.target.value)} aria-label="งบต่อวัน" />
      <button className="primary small" disabled={busy}>ตั้ง</button>
      <button type="button" className="ghost small" onClick={() => setEditing(false)}>ยกเลิก</button>
    </form>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2>{title}</h2><button className="ghost" onClick={onClose}>ปิด</button></div>
        {children}
      </div>
    </div>
  );
}

