import { useCallback, useEffect, useState } from 'react';
import { api, type Overview as OverviewData, type RunReport, type Window } from './api.ts';
import { History, RunResult } from './History.tsx';
import { Modal, Overview } from './Overview.tsx';
import { ProductsPage } from './ProductsPage.tsx';
import { RulesPage, type RulesTarget } from './RulesPage.tsx';
import { defaultStageTab, type StageTab } from './StageTabs.tsx';
import { SectionEditor } from './SectionEditor.tsx';
import { SettingsPage } from './SettingsPage.tsx';

type Tab = 'overview' | 'rules' | 'products' | 'history' | 'settings';

function readWindow(): Window {
  try { return (localStorage.getItem('window') as Window) || 'last_7d'; } catch { return 'last_7d'; }
}

export function App() {
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.overview(window));
      setError('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [window]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.me().then(setMe).catch(() => {}); }, []);
  useEffect(() => { try { localStorage.setItem('window', window); } catch { /* private mode */ } }, [window]);

  async function runNow() {
    setRunning(true);
    try {
      setRun(await api.run(true));
      load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setRunning(false);
    }
  }

  const editingSection = data?.sections.find((s) => s.id === editing);
  const openRules = (t: RulesTarget) => {
    // Open the rules tab on the stage tab that holds the target, so it's on screen.
    const stageOf = t.kind === 'stage' ? t.id : (data?.campaigns.find((c) => c.id === t.id)?.stage_id ?? 'none');
    setStageTab(stageOf);
    setRulesTarget(t);
    setTab('rules');
    scrollTo({ top: 0 });
  };
  // Shared by the overview and rules tabs; first visit picks a sensible default.
  const currentStageTab = stageTab ?? (data ? defaultStageTab(data.stages, data.campaigns) : 'none');

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>PkJeans Ads</h1>
          <p className="muted small">{data?.account ?? '…'}{me ? ` · ${me.email}` : ''}</p>
        </div>
        {data && (
          <div className="mode">
            {data.settings.kill_switch && <span className="pill bad">หยุดฉุกเฉิน</span>}
            <span className={`pill ${data.settings.dry_run ? 'warn' : 'on'}`}>{data.settings.dry_run ? 'โหมดทดลอง' : 'ทำงานจริง'}</span>
            <button className="small" disabled={running} onClick={runNow} title="ดูว่ากฎจะทำอะไร โดยไม่แตะ Meta">
              {running ? 'กำลังเช็ค…' : 'ทดลองรันกฎ'}
            </button>
          </div>
        )}
      </header>
      {me?.mock && <div className="banner">ใช้ข้อมูลตัวอย่าง (DEV_MOCK_META) — ยังไม่ได้ต่อ Meta จริง</div>}

      <nav className="tabs">
        <button className={tab === 'overview' ? 'on' : ''} onClick={() => setTab('overview')}>ภาพรวม</button>
        <button className={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}>กฎ</button>
        <button className={tab === 'products' ? 'on' : ''} onClick={() => setTab('products')}>สินค้า/ต้นทุน</button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>ประวัติ</button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>ตั้งค่า</button>
      </nav>

      <main>
        {error && <div className="error">{error} <button className="ghost small" onClick={load}>ลองใหม่</button></div>}
        {(tab === 'overview' || tab === 'rules' || tab === 'products') && !data && !error && <p className="muted">กำลังโหลดข้อมูลจาก Meta…</p>}
        {tab === 'overview' && data && (
          <div className={loading ? 'loading' : ''}>
            <Overview data={data} window={window} onWindow={setWindow} onReload={load} onOpenRules={openRules} stageTab={currentStageTab} onStageTab={setStageTab} />
          </div>
        )}
        {tab === 'rules' && data && <RulesPage data={data} target={rulesTarget} onTarget={(t) => { setRulesTarget(t); scrollTo({ top: 0 }); }} stageTab={currentStageTab} onStageTab={setStageTab} onReload={load} />}
        {tab === 'products' && data && <ProductsPage data={data} onEdit={setEditing} onReload={load} />}
        {tab === 'history' && <History stages={data?.stages ?? []} />}
        {tab === 'settings' && <SettingsPage costsLoaded={data?.costs_loaded ?? 0} onSaved={load} />}
      </main>

      {editingSection && data && (
        <Modal title={editingSection.name} onClose={() => setEditing(null)}>
          <SectionEditor
            key={editingSection.id}
            section={editingSection}
            campaignNames={data.campaigns.filter((c) => c.section_id === editingSection.id).map((c) => c.name)}
            onSaved={() => { setEditing(null); load(); }}
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
