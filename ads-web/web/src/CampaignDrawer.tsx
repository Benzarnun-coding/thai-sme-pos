// Everything about one campaign in a side panel: numbers, daily chart, what the next run will do, ideas,
// settings (stage, product, rules), budget, ad sets and its history.

import { useEffect, useState } from 'react';
import { api, MODE_LABEL, sectionName, WEB_TAB, type CampaignStats, type CostRow, WINDOW_LABEL, type CampaignHistory, type CampaignView, type DailyRow, type EntityView, type Idea, type Overview, type Preview, type Window } from './api.ts';
import { ideaActionLabel, stageLabel, useCampaignActions } from './actions.tsx';
import { DailyChart } from './Chart.tsx';
import { auditText } from './History.tsx';
import { baht, bahtRange, cvr, num, profitTone, roasTone, when } from './fmt.ts';
import { previewText } from './Overview.tsx';
import type { RulesTarget } from './RulesPage.tsx';
import { Drawer, Icon, StatusSwitch, useUi } from './ui.tsx';
import { WebCostForm } from './WebCosts.tsx';

const CHART_WINDOWS: Window[] = ['last_7d', 'last_14d', 'last_30d'];

export function CampaignDrawer({ c, data, window, preview, ideas, onClose, onReload, onOpenRules, onIdea, onEditSection }: {
  c: CampaignView; data: Overview; window: Window; preview: Preview | null; ideas: Idea[];
  onClose: () => void; onReload: () => void; onOpenRules: (t: RulesTarget) => void; onIdea: (i: Idea) => void; onEditSection: (id: string) => void;
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
        <StatsTable c={c} />

        <CostPanel c={c} data={data} onEditSection={onEditSection} onReload={onReload} />

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
                {data.sections.filter((s) => s.id !== 'default' || (c.pinned && c.section_id === 'default')).map((s) => <option key={s.id} value={s.id}>{sectionName(s)}</option>)}
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

/** A product code guessed from a campaign name: "แอดผี : E200 1ตัว199" → E200, "444/1 ขาสั้น" → 444/1. */
export function guessCode(name: string): string {
  return name.match(/\b([A-Za-z]{0,3}\d{1,4}(?:\/\d+)?)\b/)?.[1] ?? '';
}

/**
 * The cost this campaign's profit is counted with, editable in place.
 * Linked product → its costs (web costs edit inline; sheet costs are edited in the sheet) + "แก้สินค้า/โปร".
 * No product yet → one small form that creates the cost, the product and pins this campaign to it.
 */
function CostPanel({ c, data, onEditSection, onReload }: {
  c: CampaignView; data: Overview; onEditSection: (id: string) => void; onReload: () => void;
}) {
  const { toast } = useUi();
  const section = data.sections.find((s) => s.id === c.section_id);
  const [web, setWeb] = useState<CostRow[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Re-read when the overview reloads with a different cost (e.g. edited in the product editor on top of this drawer).
  useEffect(() => { api.webCosts().then((r) => setWeb(r.results)).catch(() => setWeb([])); }, [c.section_id, section?.products.length, section?.economics.cost_per_unit, section?.economics.price_per_unit_max]);

  if (c.cost_source === 'sheet' && c.cost_tiers) return <SheetCostPanel c={c} />;

  if (!section || section.id === 'default') {
    return (
      <section className="panel">
        <h3>ต้นทุน</h3>
        <p className="muted small">แคมเปญนี้ยังไม่ผูกสินค้า เลยยังคิดกำไรไม่ได้ — กรอกต้นทุนตรงนี้ ระบบจะสร้างสินค้าและผูกแคมเปญนี้ให้</p>
        <WebCostForm
          suggestCode={guessCode(c.name)}
          onSaved={async (row) => {
            try {
              // Reuse a product already named after this code, else create one that also catches other campaigns with the code in their name.
              const existing = data.sections.find((s) => s.id !== 'default' && s.name.toLowerCase() === row.code.toLowerCase());
              const product = { tab: row.tab, code: row.code };
              const target = existing
                ? (existing.products.some((p) => p.tab === row.tab && p.code === row.code)
                  ? existing
                  : await api.saveSection({ ...strip(existing), products: [...existing.products, product] }))
                : await api.createSection({ name: row.code, keywords: [row.code], products: [product], tiers: [], units_per_order: 1, extra_cost_per_order: 0, price_per_order: null });
              await api.saveCampaign(c.id, { name: c.name, section_id: target.id, stage_id: c.stage_id, mode: c.mode, rules: c.rules });
              toast(`ผูก "${c.name}" กับสินค้า ${target.name} แล้ว`, 'ok');
              onReload();
            } catch (e: any) {
              toast(e.message, 'bad');
            }
          }}
        />
      </section>
    );
  }

  const e = section.economics;
  const webRows = section.products.filter((p) => p.tab === WEB_TAB).map((p) => web?.find((r) => r.code === p.code)).filter((r): r is CostRow => Boolean(r));
  const sheetProducts = section.products.filter((p) => p.tab !== WEB_TAB);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>ต้นทุน · {sectionName(section)}</h3>
        <button className="ghost small" onClick={() => onEditSection(section.id)}>แก้สินค้า/โปร <Icon name="chevron" size={14} /></button>
      </div>
      {section.products.length === 0 && <p className="muted small">สินค้านี้ยังไม่ผูกต้นทุน — กด "แก้สินค้า/โปร"</p>}
      <div className="cost-lines">
        {webRows.map((r) => editing === r.code ? (
          <WebCostForm key={r.code} initial={r} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setWeb(null); api.webCosts().then((x) => setWeb(x.results)); onReload(); }} />
        ) : (
          <div key={r.code} className="cost-line">
            <span><b>{r.code}</b>{r.name !== r.code && <span className="muted"> · {r.name}</span>}</span>
            <span>ทุน <b>{baht(r.avg_cost, 2)}</b>/ตัว{r.avg_price > 0 && <span className="muted"> · ราคาเต็ม {baht(r.avg_price)}</span>}</span>
            <button className="small" onClick={() => setEditing(r.code)}>แก้ต้นทุน</button>
          </div>
        ))}
        {sheetProducts.map((p) => (
          <div key={`${p.tab}:${p.code}`} className="cost-line">
            <span><b>{p.code}</b> <span className="muted">· ชีตแท็บ {p.tab}</span></span>
            <span className="muted small">แก้ทุนในชีต (ดึงใหม่ทุกเช้า 07:30)</span>
            <span />
          </div>
        ))}
      </div>
      {e.cost_per_unit !== null && c.price_per_unit_min === null ? (
        <div className="banner">
          มีทุนแล้ว แต่ยังไม่มีราคาขาย ระบบเลยนับจำนวนตัวและคิดกำไรไม่ได้ — ใส่ "ราคาเต็ม/ตัว" ที่ปุ่มแก้ต้นทุน
          หรือใส่โปรที่ "แก้สินค้า/โปร" (หรือเขียนโปรในชื่อแคมเปญ เช่น "1 ตัว 189 (3ตัว549)")
        </div>
      ) : e.cost_per_unit !== null && (
        <p className="small muted">
          ทุนเฉลี่ย {baht(e.cost_per_unit, 2)}/ตัว
          {c.price_per_unit_min !== null && <> · ขาย {c.price_per_unit_min === c.price_per_unit_max ? baht(c.price_per_unit_min, 2) : `${baht(c.price_per_unit_min, 2)}–${baht(c.price_per_unit_max!, 2)}`}/ตัว</>}
          {c.name_tiers.length > 0 && <> (โปรจากชื่อแคมเปญ: {c.name_tiers.map((t) => `${t.units} ตัว ${baht(t.price)}`).join(' · ')})</>}
          {c.breakeven_roas !== null && <> · คุ้มทุนที่ ROAS {num(c.breakeven_roas, 2)}</>}
        </p>
      )}
    </section>
  );
}

function strip(s: Overview['sections'][number]) {
  const { totals: _t, economics: _e, campaign_count: _c, ...rest } = s;
  return rest;
}

const STAT_LABEL: Record<string, string> = { yesterday: 'เมื่อวาน', last_3d: '3 วัน', last_7d: '7 วัน', last_30d: '30 วัน' };

/**
 * One table, four windows side by side (yesterday · 3 · 7 · 30 days): revenue, ad spend, product cost, profit,
 * then the ratios. Product cost = revenue − ad spend − profit, so each column adds up.
 */
function StatsTable({ c }: { c: CampaignView }) {
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setStats(null);
    api.stats(c.id).then(setStats).catch((e) => setError(e.message));
  }, [c.id, c.daily_budget, c.section_id, c.breakeven_roas]);

  if (error) return <p className="muted small">{error}</p>;
  if (!stats) return <div className="skeleton" style={{ height: 300 }} />;
  const be = stats.breakeven_roas;
  const cols = stats.windows;
  type Col = (typeof cols)[number];
  const money = (v: number | null | undefined) => (v === null || v === undefined ? '–' : baht(v));
  const cost = (w: Col) => (w.metrics && w.profit_low !== null ? [w.metrics.purchase_value - w.metrics.spend - (w.profit_high ?? w.profit_low), w.metrics.purchase_value - w.metrics.spend - w.profit_low] as const : null);
  const units = (w: Col) => (w.units_low === null ? '–' : num(w.units_low) === num(w.units_high) ? num(w.units_low) : `${num(w.units_low)}–${num(w.units_high)}`);
  const roasOf = (w: Col) => (w.metrics && w.metrics.spend > 0 ? w.metrics.purchase_value / w.metrics.spend : null);

  const rows: { label: string; cell: (w: Col) => React.ReactNode; strong?: boolean; group?: boolean }[] = [
    { label: 'ยอดขาย', cell: (w) => money(w.metrics?.purchase_value), strong: true },
    { label: 'ค่าแอด', cell: (w) => money(w.metrics?.spend) },
    { label: 'ทุนสินค้า', cell: (w) => { const x = cost(w); return x ? <span title={x[0] !== x[1] ? `${baht(x[0])} – ${baht(x[1])}` : undefined}>{baht(x[1])}</span> : '–'; } },
    { label: 'กำไร', cell: (w) => w.profit_low === null ? '–' : <b className={profitTone(w.profit_low, w.profit_high)} title={`ประมาณ ${bahtRange(w.profit_low, w.profit_high)}`}>{baht(w.profit_low)}</b>, strong: true },
    { label: 'ROAS', cell: (w) => { const r = roasOf(w); return <span className={roasTone(r, be)}>{r === null ? '–' : num(r, 2)}</span>; }, group: true },
    { label: 'ออเดอร์', cell: (w) => num(w.metrics?.purchases) },
    { label: 'ขายไป (ตัว)', cell: units },
    { label: 'ค่าแอด/ออเดอร์', cell: (w) => money(w.metrics?.cpa ?? null) },
    { label: 'CVR', cell: (w) => { const v = cvr(w.metrics?.purchases, w.metrics?.clicks); return v === null ? '–' : `${num(v, 2)}%`; } },
    { label: 'Frequency', cell: (w) => (w.metrics ? <span className={w.metrics.frequency >= 3 ? 'warn' : ''}>{num(w.metrics.frequency, 2)}</span> : '–') },
  ];

  return (
    <section className="panel stats-panel">
      <table className="stats-table">
        <thead>
          <tr><th />{cols.map((w) => <th key={w.window}>{STAT_LABEL[w.window]}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={`${r.strong ? 'strong' : ''} ${r.group ? 'group' : ''}`}>
              <th scope="row">{r.label}</th>
              {cols.map((w) => <td key={w.window}>{r.cell(w)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted stats-note">
        {stats.cost_source === 'sheet' && <>ต้นทุนจากชีตรายแคมเปญ · </>}
        {be === null
          ? (c.section_id !== 'default' && c.price_per_unit_min === null ? 'ยังไม่มีราคาขาย — ใส่ราคาในช่อง "ต้นทุน" ด้านล่างเพื่อดูทุนสินค้าและกำไร' : 'ยังไม่ผูกต้นทุน — กรอกในช่อง "ต้นทุน" ด้านล่างเพื่อดูทุนสินค้าและกำไร')
          : <>คุ้มทุนที่ ROAS {num(be, 2)} · กำไรคิดแบบระวัง ({stats.cost_source === 'sheet' ? 'ทุกออเดอร์เป็นโปรที่ทุนหนักสุด' : 'ทุกออเดอร์เป็นโปรถูกสุด'}) ชี้ที่ตัวเลขเพื่อดูช่วง</>}
        {' · '}"เมื่อวาน" แทน "วันนี้" เพราะยอดวันนี้แอดมินยังติ๊กไม่ครบ
      </p>
    </section>
  );
}

/** Promo costs for this campaign from the team's sheet: margin per order and break-even per promo. */
function SheetCostPanel({ c }: { c: CampaignView }) {
  const tiers = c.cost_tiers ?? [];
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>ต้นทุน · จากชีตรายแคมเปญ</h3>
        <span className="small muted">แก้ในชีต "FB คำนวณค่า ADS" · ดึงใหม่ทุกเช้า 07:30</span>
      </div>
      {c.cost_match === 'similar' && (
        <p className="small warn">ใช้ทุนของ "{c.cost_sheet_name}" ในชีต (ชื่อเดียวกัน ต่างแค่งบ/เวอร์ชัน) — ถ้าโปรหรือทุนต่างกัน ให้เพิ่มชื่อแคมเปญนี้ในชีต</p>
      )}
      <table className="compare">
        <thead><tr><th>โปร</th><th className="num">ราคา</th><th className="num">ทุน/ออเดอร์</th><th className="num">เหลือก่อนค่าแอด</th><th className="num">คุ้มทุนที่ ROAS</th></tr></thead>
        <tbody>
          {tiers.map((t) => {
            const margin = t.price - t.cost;
            return (
              <tr key={`${t.units}:${t.price}`}>
                <td>{t.units} ตัว</td>
                <td className="num">{baht(t.price)}</td>
                <td className="num">{baht(t.cost, 2)}</td>
                <td className={`num ${margin <= 0 ? 'bad' : ''}`}>{baht(margin, 2)} <span className="muted small">({num((margin / t.price) * 100)}%)</span></td>
                <td className="num">{margin > 0 ? num(t.price / margin, 2) : 'ขาดทุนทุกออเดอร์'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small muted">
        {tiers.length === 2 && c.cost_exact
          ? 'มี 2 โปร: ระบบคำนวณจากยอดขายและจำนวนออเดอร์ว่าขายโปรไหนกี่ออเดอร์ กำไรจึงเป็นตัวเลขเดียว'
          : tiers.length === 1
            ? 'มีโปรเดียว: ทุนคิดเป็นสัดส่วนของยอดขาย'
            : 'ยอดเฉลี่ยต่อออเดอร์อยู่นอกช่วงราคาโปร หรือมีมากกว่า 2 โปร: กำไรแสดงเป็นช่วง (ค่าต่ำ = ทุกออเดอร์เป็นโปรที่ทุนสูงสุด)'}
        {c.breakeven_roas !== null && <> · กฎใช้คุ้มทุนที่ ROAS {num(c.breakeven_roas, 2)} (โปรที่ทุนหนักสุด)</>}
      </p>
    </section>
  );
}
