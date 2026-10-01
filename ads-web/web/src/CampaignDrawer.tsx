// Everything about one campaign in a side panel: numbers, daily chart, what the next run will do, ideas,
// settings (stage, product, rules), budget, ad sets and its history.

import { useEffect, useState } from 'react';
import { api, MODE_LABEL, sectionName, WINDOW_LABEL, type CampaignHistory, type CampaignView, type DailyRow, type EntityView, type Idea, type Overview, type Preview, type Window } from './api.ts';
import { ideaActionLabel, stageLabel, useCampaignActions } from './actions.tsx';
import { DailyChart } from './Chart.tsx';
import { auditText } from './History.tsx';
import { baht, bahtRange, num, profitTone, roasTone, when } from './fmt.ts';
import { previewText } from './Overview.tsx';
import type { RulesTarget } from './RulesPage.tsx';
import { Drawer, Icon, StatusSwitch, useUi } from './ui.tsx';

const CHART_WINDOWS: Window[] = ['last_7d', 'last_14d', 'last_30d'];

export function CampaignDrawer({ c, data, window, preview, ideas, onClose, onReload, onOpenRules, onIdea }: {
  c: CampaignView; data: Overview; window: Window; preview: Preview | null; ideas: Idea[];
  onClose: () => void; onReload: () => void; onOpenRules: (t: RulesTarget) => void; onIdea: (i: Idea) => void;
}) {
  const [chartWindow, setChartWindow] = useState<Window>('last_14d');
  const [days, setDays] = useState<DailyRow[] | null>(null);
  const [chartError, setChartError] = useState('');
  const [history, setHistory] = useState<CampaignHistory | null>(null);
  const readOnly = data.snapshot !== null;
  const actions = useCampaignActions({ stages: data.stages, guardrails: data.settings.guardrails, readOnly, onDone: onReload });
  const { toast } = useUi();

  useEffect(() => {
    let live = true;
    setDays(null);
    setChartError('');
    api.daily(c.id, chartWindow).then((r) => live && setDays(r.days)).catch((e) => live && setChartError(e.message));
    return () => { live = false; };
  }, [c.id, chartWindow]);
  useEffect(() => {
    api.history(c.id).then(setHistory).catch(() => setHistory({ audit: [], runs: [] }));
  }, [c.id, c.stage_id, c.daily_budget, c.status]);

  const m = c.metrics;
  const r = m && m.spend > 0 ? m.purchase_value / m.spend : null;
  const next = preview?.items.filter((i) => i.campaign_id === c.id) ?? [];
  const myIdeas = ideas.filter((i) => i.campaign_id === c.id);
  const section = data.sections.find((s) => s.id === c.section_id);
  const days_ = c.stage_since ? Math.floor((Date.now() - new Date(c.stage_since).getTime()) / 86_400_000) : null;

  const save = async (patch: { section_id?: string | null; stage_id?: string | null }) => {
    try {
      await api.saveCampaign(c.id, {
        name: c.name,
        section_id: patch.section_id !== undefined ? patch.section_id : (c.pinned ? c.section_id : null),
        stage_id: patch.stage_id !== undefined ? patch.stage_id : c.stage_id,
        mode: c.mode,
        rules: c.rules,
      });
      toast('บันทึกแล้ว', 'ok');
      onReload();
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  };

  return (
    <Drawer onClose={onClose} label={c.name}>
      <header className="drawer-head">
        <StatusSwitch name={c.name} status={c.status} disabled={readOnly} onToggle={(s) => actions.setStatus(c.id, c.name, s)} />
        <div className="drawer-title">
          <h2 className="clip-wrap">{c.name}</h2>
          <p className="muted small">
            <span className={`stage-dot stage-${c.stage_id ?? 'none'}`} /> {stageLabel(data.stages, c.stage_id)}
            {days_ !== null && ` · ${days_} วัน`} · {c.status === 'ACTIVE' ? 'เปิดอยู่' : 'หยุดอยู่'} · ID {c.id}
          </p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="ปิด"><Icon name="x" /></button>
      </header>

      <div className="drawer-body">
        <div className="mini-kpis">
          <div><span>ใช้จ่าย · {WINDOW_LABEL[window]}</span><b>{baht(m?.spend)}</b></div>
          <div><span>ออเดอร์</span><b>{num(m?.purchases)}</b></div>
          <div><span>ROAS</span><b className={roasTone(r, c.breakeven_roas)}>{r === null ? '–' : num(r, 2)}</b>{c.breakeven_roas !== null && <small>คุ้มทุน {num(c.breakeven_roas, 2)}</small>}</div>
          <div><span>ค่าแอด/ออเดอร์</span><b>{baht(m?.cpa ?? null)}</b></div>
          <div><span>ขายไป (ประมาณ)</span><b>{c.units_low === null ? '–' : Math.round(c.units_low) === Math.round(c.units_high ?? c.units_low) ? `${num(c.units_low)} ตัว` : `${num(c.units_low)}–${num(c.units_high)} ตัว`}</b></div>
          <div><span>Frequency</span><b className={m && m.frequency >= 3 ? 'warn' : ''}>{m ? num(m.frequency, 2) : '–'}</b></div>
          <div className="wide-kpi">
            <span>กำไรหลังหักทุนและค่าแอด</span>
            <b className={profitTone(c.profit, c.profit_high)}>{bahtRange(c.profit, c.profit_high)}</b>
            <small>
              {c.profit === null
                ? 'ยังไม่ผูกต้นทุน — ผูกในแท็บสินค้า/ต้นทุน'
                : profitTone(c.profit, c.profit_high) === 'warn'
                  ? 'กำไรหรือขาดทุนขึ้นกับว่าลูกค้าซื้อโปรไหน'
                  : 'ค่าต่ำ = ทุกออเดอร์เป็นโปรถูกสุด · ค่าสูง = ขายราคาเต็ม'}
            </small>
          </div>
        </div>

        <section className="panel">
          <div className="panel-head">
            <h3>รายวัน</h3>
            <div className="segmented small">
              {CHART_WINDOWS.map((w) => <button key={w} className={w === chartWindow ? 'on' : ''} onClick={() => setChartWindow(w)}>{WINDOW_LABEL[w]}</button>)}
            </div>
          </div>
          {chartError ? <p className="muted small">{chartError}</p> : days ? <DailyChart days={days} breakeven={c.breakeven_roas} /> : <div className="chart-empty skeleton" />}
        </section>

        <section className="panel">
          <h3>รอบถัดไป <span className="muted small">(08:00 / 20:00{preview?.dry_run ? ' · โหมดทดลอง ยังไม่เปลี่ยนจริง' : ''})</span></h3>
          {!c.stage_id && c.mode !== 'custom' ? (
            <p className="muted small">ยังไม่จัดกลุ่ม — ระบบจะไม่แตะแคมเปญนี้</p>
          ) : c.mode === 'off' ? (
            <p className="muted small">ปิดอัตโนมัติสำหรับแคมเปญนี้</p>
          ) : !preview ? (
            <p className="muted small">กำลังคำนวณ…</p>
          ) : next.length === 0 ? (
            <p className="muted small">ถ้าตัวเลขยังเป็นแบบนี้ รอบหน้าจะไม่มีอะไรเปลี่ยน</p>
          ) : (
            <ul className="plain-list">
              {next.map((n, i) => (
                <li key={i} className={n.skipped_reason ? 'muted' : ''}>
                  <b>{previewText(n, data.stages)}</b>
                  <span className="small muted"> — {n.skipped_reason ? `ยังไม่ทำ: ${n.skipped_reason}` : n.plan}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {myIdeas.length > 0 && (
          <section className="panel">
            <h3>ไอเดีย</h3>
            {myIdeas.map((i) => (
              <div key={i.id} className={`idea-inline ${i.severity}`}>
                <div><b>{i.title}</b><p className="small muted">{i.detail}</p></div>
                {i.action && <button className="small" onClick={() => onIdea(i)}>{ideaActionLabel(i, data.stages)}</button>}
              </div>
            ))}
          </section>
        )}

        <section className="panel">
          <h3>ตั้งค่า</h3>
          <div className="form-grid">
            <label>กลุ่ม
              <select value={c.stage_id ?? ''} onChange={(e) => save({ stage_id: e.target.value || null })}>
                <option value="">— ยังไม่จัด —</option>
                {data.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>สินค้า (ใช้คิดจุดคุ้มทุน)
              <select value={c.pinned ? c.section_id : ''} onChange={(e) => save({ section_id: e.target.value || null })}>
                <option value="">อัตโนมัติจากชื่อ ({section ? sectionName(section) : '–'})</option>
                {data.sections.map((s) => <option key={s.id} value={s.id}>{sectionName(s)}</option>)}
              </select>
            </label>
            <label>งบต่อวัน
              {c.daily_budget === null
                ? <span className="field-note">ตั้งงบไว้ที่ ad set (ด้านล่าง)</span>
                : <BudgetField id={c.id} name={c.name} value={c.daily_budget} disabled={readOnly} onSave={actions.setBudget} />}
            </label>
            <label>กฎ
              <button className="field-btn" onClick={() => onOpenRules({ kind: 'campaign', id: c.id })}>
                {MODE_LABEL[c.mode]}{c.mode === 'custom' ? ` (${c.rules?.length ?? 0} กฎ)` : ''} <Icon name="chevron" size={14} />
              </button>
            </label>
          </div>
        </section>

        {c.adsets.length > 0 && (
          <section className="panel">
            <h3>Ad set ({c.adsets.length})</h3>
            <div className="adset-list">
              {c.adsets.map((a) => <AdsetRow key={a.id} a={a} breakeven={c.breakeven_roas} readOnly={readOnly} actions={actions} />)}
            </div>
          </section>
        )}

        <section className="panel">
          <h3>ประวัติ</h3>
          {!history ? <p className="muted small">กำลังโหลด…</p> : <Timeline history={history} stages={data.stages} />}
        </section>
      </div>
    </Drawer>
  );
}

function BudgetField({ id, name, value, disabled, onSave }: {
  id: string; name: string; value: number; disabled: boolean; onSave: (id: string, name: string, from: number | null, amount: number) => Promise<boolean>;
}) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const n = Number(v);
  const dirty = Number.isFinite(n) && n > 0 && n !== value;
  return (
    <form className="budget-field" onSubmit={async (e) => { e.preventDefault(); if (dirty && !(await onSave(id, name, value, n))) setV(String(value)); }}>
      <span className="prefix">฿</span>
      <input type="number" inputMode="numeric" value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} aria-label={`งบต่อวัน ${name}`} />
      {dirty && <button className="primary small">บันทึก</button>}
    </form>
  );
}

function AdsetRow({ a, breakeven, readOnly, actions }: { a: EntityView; breakeven: number | null; readOnly: boolean; actions: ReturnType<typeof useCampaignActions> }) {
  const m = a.metrics;
  const r = m && m.spend > 0 ? m.purchase_value / m.spend : null;
  return (
    <div className={`adset-row ${a.status !== 'ACTIVE' ? 'paused' : ''}`}>
      <StatusSwitch name={a.name} status={a.status} disabled={readOnly} onToggle={(s) => actions.setStatus(a.id, a.name, s)} />
      <div className="adset-name">
        <span className="clip-wrap">{a.name}</span>
        <span className="small muted">
          {m ? <>{baht(m.spend)} · {num(m.purchases)} ออเดอร์ · <span className={roasTone(r, breakeven)}>ROAS {r === null ? '–' : num(r, 2)}</span></> : 'ไม่มีตัวเลขในช่วงนี้'}
        </span>
      </div>
      {a.daily_budget === null
        ? <span className="small muted">งบที่แคมเปญ</span>
        : <BudgetField id={a.id} name={a.name} value={a.daily_budget} disabled={readOnly} onSave={actions.setBudget} />}
    </div>
  );
}

function Timeline({ history, stages }: { history: CampaignHistory; stages: Overview['stages'] }) {
  const items = [
    ...history.audit.map((a) => ({ at: a.at, who: a.actor, text: auditText(a, (id) => stageLabel(stages, id), false), tone: '' })),
    ...history.runs.map((r) => ({
      at: r.run_at,
      who: r.trigger === 'schedule' ? 'อัตโนมัติ' : 'ทดลองรัน',
      text: `${r.plan}${r.skipped_reason ? ` — ข้าม: ${r.skipped_reason}` : r.dry_run ? ' (ทดลอง)' : ''}${r.error ? ` — ผิดพลาด: ${r.error}` : ''}`,
      tone: r.error ? 'bad' : r.applied ? '' : 'muted',
    })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
  if (!items.length) return <p className="muted small">ยังไม่มีการเปลี่ยนแปลง</p>;
  return (
    <ol className="timeline">
      {items.map((i, k) => (
        <li key={k} className={i.tone}>
          <span className="small muted">{when(i.at)} · {i.who}</span>
          <span>{i.text}</span>
        </li>
      ))}
    </ol>
  );
}
