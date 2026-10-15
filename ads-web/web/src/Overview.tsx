import { useEffect, useMemo, useState } from 'react';
import { api, parseRange, type GoalStatus, rangeWindow, WINDOW_LABEL, windowLabel, type CampaignView, type Idea, type Overview as OverviewData, type Preview, type PreviewItem, type Stage, type Window } from './api.ts';
import { stageLabel, useCampaignActions } from './actions.tsx';
import { baht, bahtRange, cvr, num, profitTone, roasTone, time, when } from './fmt.ts';
import type { RulesTarget } from './RulesPage.tsx';
import { ALL, NONE, StageTabs, campaignsIn, type StageTab } from './StageTabs.tsx';
import { Icon, StatusSwitch } from './ui.tsx';

export { Modal } from './ui.tsx';

interface Props {
  data: OverviewData;
  window: Window;
  onWindow: (w: Window) => void;
  onReload: () => void;
  /** Ask Meta again instead of the few-minutes cache */
  onRefresh: () => void;
  onOpenRules: (t: RulesTarget) => void;
  onOpenCampaign: (id: string) => void;
  stageTab: StageTab;
  onStageTab: (t: StageTab) => void;
  preview: Preview | null;
  ideas: Idea[];
}

type SortKey = 'spend' | 'value' | 'roas_desc' | 'roas_asc' | 'cvr' | 'cpa' | 'profit' | 'budget' | 'name';
const SORT_LABEL: Record<SortKey, string> = {
  value: 'ยอดขายมากสุด', spend: 'ใช้จ่ายมากสุด', roas_desc: 'ROAS สูงสุด', roas_asc: 'ROAS ต่ำสุด', cvr: 'CVR สูงสุด', cpa: 'ค่าแอด/ออเดอร์ ถูกสุด', profit: 'กำไรมากสุด', budget: 'งบ/วันมากสุด', name: 'ชื่อ ก–ฮ',
};

const roasOf = (c: CampaignView) => (c.metrics && c.metrics.spend > 0 ? c.metrics.purchase_value / c.metrics.spend : null);

export function Overview({ data, window, onWindow, onReload, onRefresh, onOpenRules, onOpenCampaign, stageTab, onStageTab, preview, ideas }: Props) {
  const all = data.campaigns.reduce(
    (t, c) => ({ spend: t.spend + (c.metrics?.spend ?? 0), purchases: t.purchases + (c.metrics?.purchases ?? 0), value: t.value + (c.metrics?.purchase_value ?? 0), clicks: t.clicks + (c.metrics?.clicks ?? 0) }),
    { spend: 0, purchases: 0, value: 0, clicks: 0 },
  );
  const withProfit = data.campaigns.filter((c) => c.profit !== null && (c.metrics?.spend ?? 0) > 0);
  const spending = data.campaigns.filter((c) => (c.metrics?.spend ?? 0) > 0).length;
  const profit = withProfit.reduce((t, c) => t + (c.profit ?? 0), 0);
  const profitHigh = withProfit.reduce((t, c) => t + (c.profit_high ?? c.profit ?? 0), 0);
  const running = data.campaigns.filter((c) => c.status === 'ACTIVE').length;
  const budget = data.campaigns.filter((c) => c.status === 'ACTIVE').reduce((t, c) => t + (c.daily_budget ?? c.adsets.reduce((a, s) => a + (s.status === 'ACTIVE' ? (s.daily_budget ?? 0) : 0), 0)), 0);
  const stage = data.stages.find((s) => s.id === stageTab) ?? null;

  return (
    <>
      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="ช่วงเวลา">
          {(data.snapshot?.windows ?? (Object.keys(WINDOW_LABEL) as Window[])).map((w) => (
            <button key={w} role="tab" aria-selected={w === window} className={w === window ? 'on' : ''} onClick={() => onWindow(w)}>{WINDOW_LABEL[w]}</button>
          ))}
        </div>
        {!data.snapshot && <RangePicker window={window} onWindow={onWindow} />}
        {!data.snapshot && (
          <button className="ghost small fresh" onClick={onRefresh} title="ดึงข้อมูลใหม่จาก Meta (ไม่เกินนาทีละครั้ง)">
            <Icon name="refresh" size={16} /> อัปเดต {time(data.meta_fetched_at)}
          </button>
        )}
      </div>

      <GoalCard />

      <div className="kpis">
        {(() => {
          // Real Page365 numbers when uploaded; Meta's tagged figures alongside so the two can be compared.
          const a = data.actual;
          const tag = a ? (a.covered === a.dates ? ' · ของจริง' : ` · ของจริง ${a.covered}/${a.dates} วัน`) : '';
          return (
            <>
              <Kpi label={`ยอดขาย${tag}`} value={baht(a ? a.revenue : all.value)}
                sub={a ? `เฉลี่ย ${baht(a.orders ? a.revenue / a.orders : 0)}/ออเดอร์ · Meta นับ ${baht(all.value)}` : all.purchases ? `เฉลี่ย ${baht(all.value / all.purchases)}/ออเดอร์ · ตามที่ติ๊กใน Meta` : undefined} />
              <Kpi label="ใช้จ่าย" value={baht(all.spend)} sub={`${spending} แคมเปญที่ใช้เงิน`} />
              <Kpi label={`ออเดอร์${tag}`} value={num(a ? a.orders : all.purchases)}
                sub={a
                  ? `Meta นับ ${num(all.purchases)} · ไม่ใช่แอด ${num(a.organic_orders)} · ค่าแอด ${baht(a.orders ? a.ads / a.orders : 0)}/ออเดอร์จริง${a.covered < a.dates ? ' · ยังขาดไฟล์บางวัน' : ''}`
                  : all.purchases ? `ค่าแอด ${baht(all.spend / all.purchases)}/ออเดอร์${all.clicks ? ` · CVR ${num((all.purchases / all.clicks) * 100, 2)}%` : ''} · ตามที่ติ๊กใน Meta` : undefined} />
            </>
          );
        })()}
        <Kpi
          label={data.actual ? 'ทุนสินค้า · ของจริง' : 'ทุนสินค้า'}
          value={data.actual ? baht(data.actual.cost) : '–'}
          sub={data.actual
            ? `${data.actual.revenue ? num((data.actual.cost / data.actual.revenue) * 100) : 0}% ของยอด · ${num(data.actual.units)} ตัว · + ค่าใช้จ่ายต่อออเดอร์ ${baht(data.actual.fees)} (COD, ของเสีย, ส่ง, VAT, ซอง)`
            : 'อัปโหลดไฟล์ Page365 เพื่อดูทุนจริง'}
        />
        <Kpi label="ROAS" value={all.spend ? num(all.value / all.spend, 2) : '–'} sub="ยอดขาย ÷ ค่าแอด" />
        {data.actual ? (
          <Kpi
            label={data.actual.covered === data.actual.dates ? 'กำไรสุทธิ · ของจริง Page365' : `กำไรสุทธิ · ของจริง ${data.actual.covered}/${data.actual.dates} วัน`}
            value={baht(data.actual.net)}
            tone={data.actual.net < 0 ? 'bad' : 'good'}
            sub={`ยอดจริง ${baht(data.actual.revenue)} (${num(data.actual.orders)} ออเดอร์) − ทุน+ค่าใช้จ่าย ${baht(data.actual.cost + data.actual.fees)} − แอด ${baht(data.actual.ads)} · ไม่ใช่แอด ${baht(data.actual.organic_revenue)}${data.actual.covered < data.actual.dates ? ` · อัปโหลดไฟล์ให้ครบทุกวันเพื่อดูทั้งช่วง` : ''}`}
          />
        ) : (
          <Kpi
            label="กำไรหลังหักทุน+แอด (ประมาณ)"
            value={withProfit.length ? baht(profit) : '–'}
            tone={withProfit.length ? (profit < 0 ? 'bad' : 'good') : undefined}
            sub={withProfit.length
              ? `${profitHigh - profit >= 50 ? `ถึง ${baht(profitHigh)} ถ้าขายราคาเต็ม · ` : ''}นับ ${withProfit.length}/${spending} แคมเปญที่ผูกต้นทุน · อัปโหลดไฟล์ Page365 เพื่อใช้ของจริง`
              : 'ผูกต้นทุนในแท็บสินค้าก่อน'}
          />
        )}
      </div>
      <p className="muted small meta-line">
        เปิดอยู่ {running} แคมเปญ · งบรวม {baht(budget)}/วัน
        {data.last_run && <> · รันกฎล่าสุด {when(data.last_run.run_at)} — {data.last_run.summary}</>}
      </p>

      <StageTabs stages={data.stages} campaigns={data.campaigns} value={stageTab} onChange={onStageTab} withAll />
      <StageSection
        key={stageTab}
        stage={stageTab === NONE || stageTab === ALL ? null : stage}
        all={stageTab === ALL}
        campaigns={campaignsIn(stageTab, data.campaigns)}
        data={data}
        preview={preview}
        ideas={ideas}
        onReload={onReload}
        onOpenRules={onOpenRules}
        onOpenCampaign={onOpenCampaign}
      />
    </>
  );
}

/** Counts up from 0 to the value once, so the scoreboard "runs" when the page opens. */
function useCountUp(target: number, ms = 1200): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setV(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/**
 * Scoreboard: month-to-date real net (Page365 days) against the monthly goal — how much is still missing, a running
 * bar with a marker where the month should be by now, and the pace needed. Loaded on its own so the overview isn't slowed.
 */
function GoalCard() {
  const [g, setG] = useState<GoalStatus | null>(null);
  const [err, setErr] = useState('');
  const [shown, setShown] = useState(false);
  useEffect(() => { api.goal().then((x) => { setG(x); requestAnimationFrame(() => setShown(true)); }).catch((e) => setErr(e.message)); }, []);
  const net = useCountUp(g?.net ?? 0);
  if (err) return <p className="muted small">เป้ากำไร: {err}</p>;
  if (!g) return <section className="card scoreboard"><div className="skeleton" style={{ height: 120 }} /></section>;
  const goal = g.goal.monthly_net;
  const pct = goal ? Math.max(0, Math.min(100, (g.net / goal) * 100)) : 0;
  const pacePct = Math.min(100, (g.elapsed.length / g.days_in_month) * 100);
  const paceNet = (goal * g.elapsed.length) / g.days_in_month;
  const gap = g.net - paceNet;
  const missing = Math.max(0, goal - g.net);
  const monthTh = new Date(`${g.month}-01T00:00:00+07:00`).toLocaleDateString('th-TH', { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' });
  const onTrack = g.projected !== null && g.projected >= goal;
  const perDayGoal = goal / g.days_in_month;
  const daysLeft = g.days_in_month - g.elapsed.length;
  return (
    <section className={`card scoreboard ${gap >= 0 ? 'ahead' : 'behind'}`} aria-label="สกอร์บอร์ดเป้ากำไร">
      <div className="sb-head">
        <div>
          <span className="sb-label">🎯 เป้ากำไรสุทธิ {monthTh}</span>
          <div className="sb-score"><b>{baht(net)}</b><span> / {baht(goal)}</span></div>
        </div>
        <div className="sb-missing">
          <span className="sb-label">{missing > 0 ? 'ขาดอีก' : 'ถึงเป้าแล้ว 🎉'}</span>
          <b>{missing > 0 ? baht(missing) : baht(g.net - goal)}</b>
          <span className="muted small">{daysLeft > 0 ? `เหลือ ${daysLeft} วัน · ต้องได้วันละ ${baht(g.needed_per_day)}` : 'จบเดือนแล้ว'}</span>
        </div>
      </div>

      <div className="sb-track" role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.round(g.net)} aria-label={`ได้ ${num(pct)}% ของเป้า`}>
        <i className="sb-fill" style={{ width: shown ? `${pct}%` : '0%' }}><span>{num(pct)}%</span></i>
        <em className="sb-pace" style={{ left: `${pacePct}%` }} title={`ควรถึง ${baht(paceNet)} ภายในวันนี้`}><span>ควรถึง {baht(paceNet)}</span></em>
      </div>
      <p className={`sb-status ${gap >= 0 ? 'good' : 'bad'}`}>
        {gap >= 0 ? `▲ นำเป้า ${baht(gap)}` : `▼ ช้ากว่าเป้า ${baht(-gap)}`}
        <span className="muted"> · ยอดจริง Page365 {g.days.length} วัน{g.missing.length ? ` (ขาดไฟล์ ${g.missing.length} วัน)` : ''} · หลังหักทุน ค่าใช้จ่ายต่อออเดอร์ และค่าแอด</span>
      </p>

      <div className="goal-grid">
        <div><span className="muted small">เฉลี่ยต่อวัน</span><b className={g.avg_net !== null && g.avg_net >= perDayGoal ? 'good' : 'bad'}>{g.avg_net === null ? '–' : baht(g.avg_net)}</b><span className="muted small">เป้า {baht(perDayGoal)}/วัน</span></div>
        <div><span className="muted small">คาดสิ้นเดือน</span><b className={onTrack ? 'good' : 'bad'}>{g.projected === null ? '–' : baht(g.projected)}</b><span className="muted small">ถ้าเฉลี่ยเท่าเดิม</span></div>
        <div><span className="muted small">MER จริง 7 วัน</span><b className={g.mer_7d !== null && g.mer_7d >= g.goal.scale_mer ? 'good' : 'bad'}>{g.mer_7d === null ? '–' : num(g.mer_7d, 2)}</b><span className="muted small">เป้า ≥ {g.goal.scale_mer} · ผ่านแล้วขยายงบได้</span></div>
        <div><span className="muted small">ออเดอร์หลายตัว (ปิดการขาย)</span><b>{g.multi_share_7d === null ? '–' : `${num(g.multi_share_7d * 100)}%`}</b><span className="muted small">7 วันล่าสุด · ทั้งเดือน {g.multi_share === null ? '–' : `${num(g.multi_share * 100)}%`} · {g.units_per_order === null ? '–' : num(g.units_per_order, 2)} ตัว/ออเดอร์</span></div>
        <div><span className="muted small">ยอดขายที่ต้องได้/วัน</span><b>{g.target_revenue_per_day ? baht(g.target_revenue_per_day) : '–'}</b><span className="muted small">กำไรก่อนแอด {g.gross_margin === null ? '–' : `${num(g.gross_margin * 100, 1)}%`} · ที่ MER {g.goal.scale_mer}</span></div>
      </div>
    </section>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <b className={tone ?? ''}>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function StageSection({ stage, all, campaigns, data, preview, ideas, onReload, onOpenRules, onOpenCampaign }: {
  stage: Stage | null; all: boolean; campaigns: CampaignView[]; data: OverviewData; preview: Preview | null; ideas: Idea[];
  onReload: () => void; onOpenRules: (t: RulesTarget) => void; onOpenCampaign: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>(() => readSort());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const actions = useCampaignActions({ stages: data.stages, guardrails: data.settings.guardrails, readOnly: data.snapshot !== null, onDone: onReload });

  const actionRules = stage?.rules.filter((r) => r.enabled !== false && r.action.type !== 'move').length ?? 0;
  const moveRules = stage?.rules.filter((r) => r.enabled !== false && r.action.type === 'move') ?? [];

  const list = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hit = campaigns.filter((c) => words.every((w) => c.name.toLowerCase().includes(w) || c.id.includes(w)));
    const by: Record<SortKey, (a: CampaignView, b: CampaignView) => number> = {
      spend: (a, b) => (b.metrics?.spend ?? 0) - (a.metrics?.spend ?? 0),
      value: (a, b) => (b.metrics?.purchase_value ?? 0) - (a.metrics?.purchase_value ?? 0),
      roas_desc: (a, b) => (roasOf(b) ?? -1) - (roasOf(a) ?? -1),
      roas_asc: (a, b) => (roasOf(a) ?? Infinity) - (roasOf(b) ?? Infinity),
      cvr: (a, b) => (cvr(b.metrics?.purchases, b.metrics?.clicks) ?? -1) - (cvr(a.metrics?.purchases, a.metrics?.clicks) ?? -1),
      cpa: (a, b) => (a.metrics?.cpa ?? Infinity) - (b.metrics?.cpa ?? Infinity),
      profit: (a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity),
      budget: (a, b) => (b.daily_budget ?? 0) - (a.daily_budget ?? 0),
      name: (a, b) => a.name.localeCompare(b.name, 'th'),
    };
    // Running campaigns first, then the chosen order.
    return [...hit].sort((a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE') || by[sort](a, b));
  }, [campaigns, q, sort]);

  const nextOf = useMemo(() => {
    const m = new Map<string, PreviewItem[]>();
    for (const i of preview?.items ?? []) if (!i.skipped_reason && i.action !== 'notify') m.set(i.campaign_id, [...(m.get(i.campaign_id) ?? []), i]);
    return m;
  }, [preview]);
  const ideaOf = useMemo(() => {
    const m = new Map<string, Idea>();
    for (const i of ideas) if (i.campaign_id && !m.has(i.campaign_id)) m.set(i.campaign_id, i);
    return m;
  }, [ideas]);

  const chosen = list.filter((c) => selected.has(c.id));
  const allOn = list.length > 0 && chosen.length === list.length;
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const clear = () => setSelected(new Set());

  return (
    <section className={`stage-panel stage-${all ? 'all' : (stage?.id ?? 'none')}`}>
      <header className="stage-head">
        <div className="stage-title">
          <h2>{all ? 'ทุกกลุ่มรวมกัน' : (stage?.name ?? 'ยังไม่จัดกลุ่ม')}</h2>
          {all ? (
            <p className="muted small">ทุกแคมเปญจากทุกกลุ่ม · ป้ายใต้ชื่อบอกว่าอยู่กลุ่มไหน · เลือกหลายตัวแล้ว "ย้ายไป" กลุ่มใดก็ได้</p>
          ) : stage ? (
            <div className="tags">
              <span className={`tag ${stage.automation && actionRules ? 'on' : ''}`}>{stage.automation ? (actionRules ? `อัตโนมัติ ${actionRules} กฎ` : 'ยังไม่มีกฎ — ดูอย่างเดียว') : 'ปิดอัตโนมัติ'}</span>
              {stage.automation && moveRules.map((r) => <span key={r.id} className="tag">ย้ายอัตโนมัติ → {stageLabel(data.stages, r.action.to ?? null)}</span>)}
              {stage.description && <span className="muted small">{stage.description}</span>}
            </div>
          ) : (
            <p className="muted small">ระบบไม่แตะแคมเปญกลุ่มนี้ — เลือกหลายตัวแล้วกด "ย้ายไป" ได้ทีเดียว</p>
          )}
        </div>
        {stage && <button className="ghost small" onClick={() => onOpenRules({ kind: 'stage', id: stage.id })}>กฎของกลุ่ม <Icon name="chevron" size={14} /></button>}
      </header>

      {campaigns.length > 0 && (
        <div className="list-tools">
          <label className="search">
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อแคมเปญ" aria-label="ค้นหาแคมเปญ" />
            {q && <button className="icon-btn" onClick={() => setQ('')} aria-label="ล้าง"><Icon name="x" size={14} /></button>}
          </label>
          <label className="sort">
            <Icon name="sort" size={16} />
            <select value={sort} onChange={(e) => { setSort(e.target.value as SortKey); saveSort(e.target.value); }} aria-label="เรียงตาม">
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
            </select>
          </label>
        </div>
      )}

      <div className="table" role="table" aria-label="แคมเปญ">
        {list.length > 0 && (
          <div className="tr th" role="row">
            <span className="cell-check">
              <input type="checkbox" checked={allOn} ref={(el) => { if (el) el.indeterminate = chosen.length > 0 && !allOn; }} onChange={() => setSelected(allOn ? new Set() : new Set(list.map((c) => c.id)))} aria-label="เลือกทั้งหมด" />
            </span>
            <span />
            <span>แคมเปญ ({list.length})</span>
            <span className="num" title="มูลค่าคอนเวอร์ชั่นที่แอดมินติ๊กใน Meta">ยอดขาย</span>
            <span className="num">ใช้จ่าย</span>
            <span className="num">ออเดอร์</span>
            <span className="num" title="ค่าแอดต่อออเดอร์">ค่าแอด/ออเดอร์</span>
            <span className="num">ROAS</span>
            <span className="num">กำไร</span>
            <span className="num">งบ/วัน</span>
          </div>
        )}
        {list.map((c) => (
          <CampaignRow
            key={c.id}
            c={c}
            data={data}
            selected={selected.has(c.id)}
            onSelect={() => toggle(c.id)}
            next={nextOf.get(c.id) ?? []}
            idea={ideaOf.get(c.id)}
            onOpen={() => onOpenCampaign(c.id)}
            onStatus={(s) => actions.setStatus(c.id, c.name, s)}
            showStage={all}
          />
        ))}
        {list.length > 1 && <TotalsRow list={list} filtered={list.length !== campaigns.length} />}
        {campaigns.length === 0 && (
          <div className="empty">
            <p>{stage ? 'ยังไม่มีแคมเปญในกลุ่มนี้' : 'จัดกลุ่มครบทุกแคมเปญแล้ว 🎉'}</p>
            {stage && <p className="muted small">ไปที่แท็บ "ยังไม่จัด" หรือกลุ่มอื่น เลือกแคมเปญ แล้วกด "ย้ายไป"</p>}
          </div>
        )}
        {campaigns.length > 0 && list.length === 0 && <div className="empty muted">ไม่พบแคมเปญที่ชื่อมี "{q}"</div>}
      </div>

      {chosen.length > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label="ทำกับที่เลือก">
          <span className="bulk-count"><b>{chosen.length}</b> ที่เลือก</span>
          <label className="bulk-move">
            <Icon name="move" size={16} />
            <select value="" onChange={async (e) => { const v = e.target.value; if (!v) return; if (await actions.moveStage(chosen, v === NONE ? null : v)) clear(); }} aria-label="ย้ายไปกลุ่ม">
              <option value="">ย้ายไป…</option>
              {data.stages.filter((s) => s.id !== stage?.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              {(stage || all) && <option value={NONE}>ยังไม่จัด</option>}
            </select>
          </label>
          <div className="bulk-budget" aria-label="ปรับงบ">
            <span className="muted small">งบ</span>
            {[-20, -10, 10, 20].map((p) => (
              <button key={p} className={`small ${p < 0 ? 'down' : 'up'}`} disabled={data.snapshot !== null} onClick={async () => { if (await actions.changeBudget(chosen, p)) clear(); }}>
                {p > 0 ? '+' : '−'}{Math.abs(p)}%
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={clear} aria-label="ยกเลิกที่เลือก"><Icon name="x" /></button>
        </div>
      )}
    </section>
  );
}

/** One summary row under the table, like Ads Manager: totals of the campaigns listed (after search). */
function TotalsRow({ list, filtered }: { list: CampaignView[]; filtered: boolean }) {
  const t = list.reduce(
    (a, c) => ({
      spend: a.spend + (c.metrics?.spend ?? 0),
      value: a.value + (c.metrics?.purchase_value ?? 0),
      purchases: a.purchases + (c.metrics?.purchases ?? 0),
      clicks: a.clicks + (c.metrics?.clicks ?? 0),
      budget: a.budget + (c.status === 'ACTIVE' ? (c.daily_budget ?? c.adsets.reduce((x, s) => x + (s.status === 'ACTIVE' ? (s.daily_budget ?? 0) : 0), 0)) : 0),
    }),
    { spend: 0, value: 0, purchases: 0, clicks: 0, budget: 0 },
  );
  const withProfit = list.filter((c) => c.profit !== null);
  const low = withProfit.reduce((a, c) => a + (c.profit ?? 0), 0);
  const high = withProfit.reduce((a, c) => a + (c.profit_high ?? c.profit ?? 0), 0);
  return (
    <div className="tr total" role="row">
      <span />
      <span />
      <span className="cell-name">
        <b>ผลรวม {list.length} แคมเปญ{filtered ? ' (ที่ค้นเจอ)' : ''}</b>
        {withProfit.length > 0 && withProfit.length < list.length && <span className="small muted">กำไรนับ {withProfit.length} แคมเปญที่ผูกต้นทุน</span>}
      </span>
      <span className="num" data-label="ยอดขาย">{baht(t.value)}</span>
      <span className="num" data-label="ใช้จ่าย">{baht(t.spend)}</span>
      <span className="num" data-label="ออเดอร์" title={t.clicks ? `CVR ${num((t.purchases / t.clicks) * 100, 2)}%` : undefined}>{num(t.purchases)}</span>
      <span className="num" data-label="ค่าแอด/ออเดอร์">{t.purchases ? baht(t.spend / t.purchases) : '–'}</span>
      <span className="num strong" data-label="ROAS">{t.spend ? num(t.value / t.spend, 2) : '–'}</span>
      <span className={`num ${withProfit.length ? profitTone(low, high) : ''}`} data-label="กำไร" title={withProfit.length ? `ประมาณ ${bahtRange(low, high)}` : 'ยังไม่ผูกต้นทุน'}>{withProfit.length ? baht(low) : '–'}</span>
      <span className="num" data-label="งบ/วัน" title="งบรวมต่อวันของแคมเปญที่เปิดอยู่">{baht(t.budget)}</span>
    </div>
  );
}

function CampaignRow({ c, data, selected, onSelect, next, idea, onOpen, onStatus, showStage }: {
  c: CampaignView; data: OverviewData; selected: boolean; onSelect: () => void; next: PreviewItem[]; idea?: Idea;
  onOpen: () => void; onStatus: (s: 'ACTIVE' | 'PAUSED') => Promise<void>; showStage?: boolean;
}) {
  const m = c.metrics;
  const r = roasOf(c);
  const section = data.sections.find((s) => s.id === c.section_id);
  const days = c.stage_since ? Math.floor((Date.now() - new Date(c.stage_since).getTime()) / 86_400_000) : null;
  return (
    <div className={`tr campaign ${c.status !== 'ACTIVE' ? 'paused' : ''} ${selected ? 'selected' : ''}`} role="row" onClick={onOpen}>
      <span className="cell-check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`เลือก ${c.name}`} />
      </span>
      <span onClick={(e) => e.stopPropagation()}>
        <StatusSwitch name={c.name} status={c.status} disabled={data.snapshot !== null} onToggle={onStatus} />
      </span>
      <span className="cell-name">
        <button className="name-link" onClick={(e) => { e.stopPropagation(); onOpen(); }}>{c.name}</button>
        <span className="badges">
          {next.map((n, i) => <span key={i} className="badge next" title={n.plan}><Icon name="clock" size={12} />{previewText(n, data.stages)}</span>)}
          {idea && <span className={`badge idea ${idea.severity}`} title={idea.detail}><Icon name="bulb" size={12} />{idea.title}</span>}
          {c.cost_source === 'product' && c.price_per_unit_min === null && <span className="badge warn" title="มีทุนแล้วแต่ไม่มีราคาขาย — กดชื่อแคมเปญ → ต้นทุน → แก้ต้นทุน ใส่ราคาเต็ม/ตัว">ยังไม่มีราคาขาย</span>}
          {c.cost_source === 'sheet' ? <span className="badge" title="ต้นทุนจากชีตรายแคมเปญ">ทุนจากชีต</span> : section && section.id !== 'default' && <span className="badge">{section.name}</span>}
          {c.mode !== 'stage' && <span className="badge warn">{c.mode === 'custom' ? 'กฎเฉพาะ' : 'ไม่อัตโนมัติ'}</span>}
          {showStage && <span className={`badge stage-badge stage-${c.stage_id ?? 'none'}`}><i className="stage-dot" />{stageLabel(data.stages, c.stage_id)}</span>}
          {days !== null && <span className="badge plain">{days} วันในกลุ่ม</span>}
        </span>
      </span>
      <span className="num strong" data-label="ยอดขาย">{baht(m?.purchase_value)}</span>
      <span className="num" data-label="ใช้จ่าย">{baht(m?.spend)}</span>
      <span className="num" data-label="ออเดอร์" title={cvr(m?.purchases, m?.clicks) === null ? undefined : `CVR ${num(cvr(m?.purchases, m?.clicks), 2)}% (${num(m?.purchases)} ออเดอร์ ÷ ${num(m?.clicks)} คลิก)`}>{num(m?.purchases)}</span>
      <span className="num" data-label="ค่าแอด/ออเดอร์">{baht(m?.cpa ?? null)}</span>
      <span className={`num strong ${roasTone(r, c.breakeven_roas)}`} data-label="ROAS" title={c.breakeven_roas ? `คุ้มทุนที่ ${num(c.breakeven_roas, 2)}` : 'ยังไม่ผูกต้นทุน'}>
        {r === null ? '–' : num(r, 2)}
      </span>
      <span
        className={`num ${profitTone(c.profit, c.profit_high)}`}
        data-label="กำไร"
        title={c.profit === null ? 'ยังไม่ผูกต้นทุน' : `ประมาณ ${bahtRange(c.profit, c.profit_high)} · ${num(c.units_low) === num(c.units_high) ? num(c.units_low) : `${num(c.units_low)}–${num(c.units_high)}`} ตัว`}
      >
        {c.profit === null ? '–' : baht(c.profit)}{profitTone(c.profit, c.profit_high) === 'warn' && <sup>?</sup>}
      </span>
      <span className="num" data-label="งบ/วัน">{c.daily_budget === null ? <span className="muted small">ที่ ad set</span> : baht(c.daily_budget)}</span>
    </div>
  );
}

export function previewText(i: PreviewItem, stages: Stage[]): string {
  const who = i.level === 'adset' ? 'ad set: ' : '';
  if (i.action === 'move') return `ย้าย → ${stageLabel(stages, i.move_to ?? null)}`;
  if (i.action === 'pause') return `${who}หยุด`;
  if (i.action === 'enable') return `${who}เปิด`;
  if (i.action === 'budget_pct') return `${who}งบ → ${baht(i.after?.daily_budget ?? null)}`;
  return `${who}แจ้งเตือน`;
}

function readSort(): SortKey {
  try { return (localStorage.getItem('sort') as SortKey) || 'value'; } catch { return 'value'; }
}
function saveSort(v: string) {
  try { localStorage.setItem('sort', v); } catch { /* private mode */ }
}

/** Pick one day or a date range, like Ads Manager's date picker. Up to 90 days, nothing after today. */
function RangePicker({ window, onWindow }: { window: Window; onWindow: (w: Window) => void }) {
  const current = parseRange(window);
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() + 7 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [since, setSince] = useState(current?.since ?? yesterday);
  const [until, setUntil] = useState(current?.until ?? yesterday);
  const days = Math.round((Date.parse(until) - Date.parse(since)) / 86_400_000) + 1;
  const valid = since && until && since <= until && until <= today && days <= 31;
  const apply = (s: string, u: string) => { onWindow(rangeWindow(s, u)); setOpen(false); };
  return (
    <span className="range-picker">
      <button className={`range-btn ${current ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="calendar" size={14} /> {current ? windowLabel(window) : 'เลือกวัน'}
      </button>
      {open && (
        <div className="range-pop" role="dialog" aria-label="เลือกช่วงวันที่">
          <div className="range-quick">
            {[1, 2, 3, 4, 5, 6, 7].map((back) => {
              const d = new Date(Date.now() + 7 * 3_600_000 - back * 86_400_000).toISOString().slice(0, 10);
              return <button key={d} className="ghost small" onClick={() => apply(d, d)}>{windowLabel(rangeWindow(d, d))}</button>;
            })}
          </div>
          <div className="row gap wrap">
            <label>ตั้งแต่<input type="date" id="range-since" value={since} max={today} onChange={(e) => { setSince(e.target.value); if (e.target.value > until) setUntil(e.target.value); }} /></label>
            <label>ถึง<input type="date" id="range-until" value={until} max={today} min={since} onChange={(e) => setUntil(e.target.value)} /></label>
          </div>
          <div className="row gap">
            <button className="primary" disabled={!valid} onClick={() => apply(since, until)}>ดู {valid ? (days === 1 ? '1 วัน' : `${days} วัน`) : ''}</button>
            <button className="ghost" onClick={() => setOpen(false)}>ปิด</button>
          </div>
          {!valid && days > 31 && <p className="small warn">เลือกได้ไม่เกิน 31 วัน (ช่วงยาวกว่านี้ดูที่ 30 วัน)</p>}
        </div>
      )}
    </span>
  );
}
