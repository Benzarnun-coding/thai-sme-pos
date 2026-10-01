import { useCallback, useEffect, useState } from 'react';
import { api, sectionName, type Idea, type Overview as OverviewData, type Preview, type RunReport, type Window } from './api.ts';
import { useCampaignActions } from './actions.tsx';
import { CampaignDrawer } from './CampaignDrawer.tsx';
import { History, RunResult } from './History.tsx';
import { IdeasPage } from './IdeasPage.tsx';
import { when } from './fmt.ts';
import { Overview } from './Overview.tsx';
import { ProductsPage } from './ProductsPage.tsx';
import { RulesPage, type RulesTarget } from './RulesPage.tsx';
import { defaultStageTab, type StageTab } from './StageTabs.tsx';
import { SectionEditor } from './SectionEditor.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { Icon, Modal, useUi } from './ui.tsx';

type Tab = 'overview' | 'ideas' | 'rules' | 'products' | 'history' | 'settings';
const TABS: [Tab, string][] = [['overview', 'ภาพรวม'], ['ideas', 'ไอเดีย'], ['rules', 'กฎ'], ['products', 'สินค้า/ต้นทุน'], ['history', 'ประวัติ'], ['settings', 'ตั้งค่า']];

function readWindow(): Window {
  try { return (localStorage.getItem('window') as Window) || 'last_7d'; } catch { return 'last_7d'; }
}

export function App() {
  const { toast } = useUi();
  const [tab, setTab] = useState<Tab>('overview');
  const [window, setWindow] = useState<Window>(readWindow);
  const [data, setData] = useState<OverviewData | null>(null);
  const [me, setMe] = useState<{ email: string; mock: boolean } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [rulesTarget, setRulesTarget] = useState<RulesTarget | null>(null);
  const [stageTab, setStageTab] = useState<StageTab | null>(null);
  const [run, setRun] = useState<RunReport | null>(null);
  const [running, setRunning] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ideas, setIdeas] = useState<{ list: Idea[] | null; error: string; fetchedAt: string | null; loading: boolean }>({ list: null, error: '', fetchedAt: null, loading: false });

  // Ideas and the next-run preview come from the same cached Meta data, so they load after the overview.
  const loadExtras = useCallback(() => {
    setIdeas((s) => ({ ...s, loading: true }));
    api.ideas()
      .then((r) => setIdeas({ list: r.ideas, error: '', fetchedAt: r.meta_fetched_at, loading: false }))
      .catch((e) => setIdeas((s) => ({ ...s, error: e.message, loading: false })));
    api.preview().then(setPreview).catch(() => setPreview(null));
  }, []);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      setData(await api.overview(window, fresh));
      setError('');
      loadExtras();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [window, loadExtras]);

  useEffect(() => { load(); }, [load]);
  const refresh = () => load(true);
  const reload = useCallback(() => { load(); }, [load]);
  // A snapshot only has some windows; don't sit on one it can't show.
  useEffect(() => {
    if (data?.snapshot && !data.snapshot.windows.includes(window)) setWindow(data.snapshot.windows[0]);
  }, [data?.snapshot, window]);
  useEffect(() => { api.me().then(setMe).catch(() => {}); }, []);
  useEffect(() => { try { localStorage.setItem('window', window); } catch { /* private mode */ } }, [window]);

  const actions = useCampaignActions({
    stages: data?.stages ?? [],
    guardrails: data?.settings.guardrails ?? { max_change_pct_per_run: 0, min_daily_budget: 0, max_daily_budget: 0, max_total_daily_budget: 0 },
    readOnly: data?.snapshot != null,
    onDone: reload,
  });

  async function actOnIdea(i: Idea) {
    const a = i.action;
    if (!a || !data) return;
    if (a.type === 'open_stage_tab') { setStageTab(a.tab); setTab('overview'); scrollTo({ top: 0 }); return; }
    const c = data.campaigns.find((x) => x.id === i.campaign_id);
    if (!c) { toast('ไม่พบแคมเปญนี้ในข้อมูลปัจจุบัน — ลองรีเฟรช', 'bad'); return; }
    if (a.type === 'move') await actions.moveStage([c], a.to);
    else if (a.type === 'budget_pct') await actions.changeBudget([c], a.pct);
    else if (a.type === 'pause') await actions.pause(c);
  }

  async function runNow() {
    setRunning(true);
    try {
      setRun(await api.run(true));
      load();
    } catch (e: any) {
      toast(e.message, 'bad');
    } finally {
      setRunning(false);
    }
  }

  const go = (t: Tab) => { setTab(t); scrollTo({ top: 0 }); };
  const editingSection = data?.sections.find((s) => s.id === editing);
  const openCampaign = data?.campaigns.find((c) => c.id === openId);
  const openRules = (t: RulesTarget) => {
    // Open the rules tab on the stage tab that holds the target, so it's on screen.
    const stageOf = t.kind === 'stage' ? t.id : (data?.campaigns.find((c) => c.id === t.id)?.stage_id ?? 'none');
    setStageTab(stageOf);
    setRulesTarget(t);
    setOpenId(null);
    go('rules');
  };
  // Shared by the overview and rules tabs; first visit picks a sensible default.
  const currentStageTab = stageTab ?? (data ? defaultStageTab(data.stages, data.campaigns) : 'none');
  const urgent = (ideas.list ?? []).filter((i) => i.severity === 'high').length;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">PK</span>
          <div>
            <h1>PkJeans Ads</h1>
            <p className="muted small clip">{data?.account ?? 'กำลังโหลด…'}{me ? ` · ${me.email}` : ''}</p>
          </div>
        </div>
        {data && (
          <div className="mode">
            {data.settings.kill_switch && <span className="pill bad">หยุดฉุกเฉิน</span>}
            <span className={`pill ${data.settings.dry_run ? 'warn' : 'on'}`} title={data.settings.dry_run ? 'กฎคำนวณแต่ไม่เปลี่ยนอะไรบน Meta' : 'กฎเปลี่ยนงบ/สถานะบน Meta จริง'}>
              <i className="pulse" />{data.settings.dry_run ? 'โหมดทดลอง' : 'ทำงานจริง'}
            </span>
            <button className="small" disabled={running} onClick={runNow} title="ดูว่ากฎจะทำอะไร โดยไม่แตะ Meta">
              <Icon name="play" size={14} /> {running ? 'กำลังเช็ค…' : 'ทดลองรันกฎ'}
            </button>
          </div>
        )}
      </header>

      <nav className="tabs" aria-label="เมนู">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => go(id)}>
            {label}
            {id === 'ideas' && ideas.list && ideas.list.length > 0 && <span className={`nav-count ${urgent ? 'hot' : ''}`}>{ideas.list.length}</span>}
          </button>
        ))}
      </nav>

      {data?.snapshot ? (
        <div className="banner">ข้อมูลจริง ณ {when(data.snapshot.taken_at)} (ดึงผ่าน Claude) — ดูได้อย่างเดียว · ปุ่มเปิด/หยุด/แก้งบใช้ได้เมื่อใส่ Meta token</div>
      ) : me?.mock && <div className="banner">ใช้ข้อมูลตัวอย่าง (DEV_MOCK_META) — ยังไม่ได้ต่อ Meta จริง</div>}

      <main>
        {error && <div className="error">{error} <button className="ghost small" onClick={refresh}>ลองใหม่</button></div>}
        {data?.meta_warning && <div className="banner">{data.meta_warning} · กำลังแสดงข้อมูลเมื่อ {when(data.meta_fetched_at)}</div>}
        {!data && !error && tab !== 'history' && tab !== 'settings' && <Skeleton />}
        {tab === 'overview' && data && (
          <div className={loading ? 'loading' : ''}>
            <Overview
              data={data} window={window} onWindow={setWindow} onReload={reload} onRefresh={refresh} onOpenRules={openRules}
              onOpenCampaign={setOpenId} stageTab={currentStageTab} onStageTab={setStageTab} preview={preview} ideas={ideas.list ?? []}
            />
          </div>
        )}
        {tab === 'ideas' && data && (
          <IdeasPage
            data={data} ideas={ideas.list} loading={ideas.loading} error={ideas.error} fetchedAt={ideas.fetchedAt}
            onAct={actOnIdea} onOpenCampaign={setOpenId} onReload={loadExtras}
          />
        )}
        {tab === 'rules' && data && <RulesPage data={data} target={rulesTarget} onTarget={(t) => { setRulesTarget(t); scrollTo({ top: 0 }); }} stageTab={currentStageTab} onStageTab={setStageTab} onReload={load} />}
        {tab === 'products' && data && <ProductsPage data={data} onEdit={setEditing} onReload={load} />}
        {tab === 'history' && <History stages={data?.stages ?? []} />}
        {tab === 'settings' && <SettingsPage costsLoaded={data?.costs_loaded ?? 0} onSaved={load} />}
      </main>

      {openCampaign && data && (
        <CampaignDrawer
          key={openCampaign.id}
          c={openCampaign} data={data} window={window} preview={preview} ideas={ideas.list ?? []}
          onClose={() => setOpenId(null)} onReload={reload} onOpenRules={openRules} onIdea={actOnIdea} onEditSection={setEditing}
        />
      )}
      {editingSection && data && (
        <Modal title={sectionName(editingSection)} onClose={() => setEditing(null)}>
          <SectionEditor
            key={editingSection.id}
            section={editingSection}
            campaignNames={data.campaigns.filter((c) => c.section_id === editingSection.id).map((c) => c.name)}
            cod={{ share: data.settings.cod_share_pct / 100, fee: data.settings.cod_fee }}
            onSaved={() => { setEditing(null); load(); }}
            onCostChanged={reload}
          />
        </Modal>
      )}
      {run && (
        <Modal title="ผลทดลองรันกฎ" onClose={() => setRun(null)}>
          <RunResult report={run} />
        </Modal>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="กำลังโหลดข้อมูลจาก Meta">
      <div className="kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="kpi skeleton" style={{ height: 84 }} />)}</div>
      {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ height: 56, margin: '10px 0' }} />)}
    </div>
  );
}
