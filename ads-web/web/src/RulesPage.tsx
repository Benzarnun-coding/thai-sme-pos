import { useEffect, useState } from 'react';
import { ACTION_LABEL, LEVEL_LABEL, METRIC_LABEL, WINDOW_LABEL, api, type CampaignView, type Mode, type Overview, type Rule, type Stage, sectionName } from './api.ts';
import { baht, num } from './fmt.ts';
import { RulesEditor } from './RulesEditor.tsx';
import { NONE, StageTabs, campaignsIn, type StageTab } from './StageTabs.tsx';
import { STAGE_TEMPLATES } from './stageTemplates.ts';

export type RulesTarget = { kind: 'stage'; id: string } | { kind: 'campaign'; id: string };

interface Props {
  data: Overview;
  target: RulesTarget | null;
  onTarget: (t: RulesTarget) => void;
  stageTab: StageTab;
  onStageTab: (t: StageTab) => void;
  onReload: () => void;
}

/** One place to set rules: pick a stage tab, then its rule set or one of its ads (follow stage / own rules / hands-off). */
export function RulesPage({ data, target, onTarget, stageTab, onStageTab, onReload }: Props) {
  const [q, setQ] = useState('');
  const stage = data.stages.find((s) => s.id === stageTab) ?? null;
  const members = campaignsIn(stageTab, data.campaigns);
  const shown = members.filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  // What the right side shows: the chosen ad if it is in this tab, else this stage's rules, else the first ad.
  const campaign = target?.kind === 'campaign' ? members.find((c) => c.id === target.id) : undefined;
  const current: RulesTarget | null = campaign
    ? { kind: 'campaign', id: campaign.id }
    : stage ? { kind: 'stage', id: stage.id }
    : members[0] ? { kind: 'campaign', id: members[0].id } : null;
  const isOn = (t: RulesTarget) => current?.kind === t.kind && current.id === t.id;

  return (
    <>
      <StageTabs stages={data.stages} campaigns={data.campaigns} value={stageTab} onChange={(t) => { onStageTab(t); setQ(''); }} />
      <div className="rules-layout">
        <nav className="rules-nav" aria-label="กฎของกลุ่มและแอดในกลุ่ม">
          {stage && (
            <button className={`nav-item group-rules stage-${stage.id} ${isOn({ kind: 'stage', id: stage.id }) ? 'on' : ''}`} onClick={() => onTarget({ kind: 'stage', id: stage.id })}>
              <span>⚙ กฎของกลุ่ม {stage.name}</span>
              <small>{stage.automation ? `${stage.rules.filter((r) => r.enabled !== false).length} กฎ` : 'ปิด'}</small>
            </button>
          )}
          <h3>แอดในกลุ่มนี้ ({members.length})</h3>
          {members.length > 6 && <input placeholder="ค้นหาแอด" value={q} onChange={(e) => setQ(e.target.value)} />}
          {members.length === 0 && <p className="muted small">ยังไม่มีแอดในกลุ่มนี้</p>}
          {shown.map((c) => (
            <button key={c.id} className={`nav-item ${isOn({ kind: 'campaign', id: c.id }) ? 'on' : ''}`} onClick={() => onTarget({ kind: 'campaign', id: c.id })}>
              <span className="clip">{c.name}</span>
              <small className={c.mode === 'custom' ? 'warn' : c.mode === 'off' ? 'muted' : ''}>
                {!c.stage_id && c.mode === 'stage' ? '–' : c.mode === 'custom' ? 'เฉพาะ' : c.mode === 'off' ? 'ปิด' : 'ตามกลุ่ม'}
              </small>
            </button>
          ))}
        </nav>

        <section className="rules-main">
          {!current && <p className="muted">{stageTab === NONE ? 'จัดกลุ่มครบทุกแอดแล้ว' : 'เลือกกฎของกลุ่มหรือแอดทางซ้าย'}</p>}
          {current?.kind === 'stage' && stage && <StageEditor key={stage.id} stage={stage} stages={data.stages} data={data} onSaved={onReload} />}
          {current?.kind === 'campaign' && (() => {
            const c = data.campaigns.find((x) => x.id === current.id)!;
            return (
              <CampaignRulesEditor
                key={c.id}
                c={c}
                data={data}
                onSaved={onReload}
                onOpenStage={(id) => { onStageTab(id); onTarget({ kind: 'stage', id }); }}
                // Follow the ad to its new tab when its stage changes, so it stays on screen.
                onStageChanged={(id) => onStageTab(id ?? NONE)}
              />
            );
          })()}
        </section>
      </div>
    </>
  );
}

function StageEditor({ stage, stages, data, onSaved }: { stage: Stage; stages: Stage[]; data: Overview; onSaved: () => void }) {
  const [draft, setDraft] = useState(stage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // After a save the server returns the normalised rules; adopt them so "unsaved" clears. Keyed on content, not identity.
  const saved = JSON.stringify(stage);
  useEffect(() => { setDraft(JSON.parse(saved)); }, [saved]);
  const members = data.campaigns.filter((c) => c.stage_id === stage.id);
  const dirty = JSON.stringify(draft) !== JSON.stringify(stage);
  return (
    <div className="editor">
      <h2>กฎของกลุ่ม: {stage.name} <span className="muted small">ใช้กับ {members.filter((c) => c.mode === 'stage').length} แอด</span></h2>
      <div className="grid2">
        <label>ชื่อกลุ่ม<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>คำอธิบาย<input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
      </div>
      <label className="check">
        <input type="checkbox" checked={draft.automation} onChange={(e) => setDraft({ ...draft, automation: e.target.checked })} />
        <span>เปิดให้ระบบทำตามกฎของกลุ่มนี้ (ปรับงบ, หยุด, ย้ายกลุ่ม)</span>
      </label>
      {draft.rules.length === 0 && STAGE_TEMPLATES[stage.id] && (
        <div className="template-hint">
          <span>ยังไม่มีกฎ — แอดในกลุ่มนี้ระบบแค่แสดงข้อมูล ไม่แตะ</span>
          <button type="button" className="ghost small" onClick={() => setDraft({ ...draft, rules: STAGE_TEMPLATES[stage.id].map((r) => ({ ...r, enabled: true })) })}>
            ใส่กฎแนะนำ ({STAGE_TEMPLATES[stage.id].length} ข้อ) แล้วค่อยแก้
          </button>
        </div>
      )}
      <RulesEditor rules={draft.rules} onChange={(rules) => setDraft({ ...draft, rules })} stages={stages} stageId={stage.id} breakeven={null} />
      {error && <p className="error">{error}</p>}
      <div className="row end sticky-actions">
        <button className="primary" disabled={busy || !dirty} onClick={async () => {
          setBusy(true); setError('');
          try { await api.saveStage(draft); onSaved(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
        }}>{busy ? 'กำลังบันทึก…' : dirty ? 'บันทึก' : 'บันทึกแล้ว'}</button>
      </div>
    </div>
  );
}

function CampaignRulesEditor({ c, data, onSaved, onOpenStage, onStageChanged }: {
  c: CampaignView; data: Overview; onSaved: () => void; onOpenStage: (id: string) => void; onStageChanged: (id: string | null) => void;
}) {
  const stage = data.stages.find((s) => s.id === c.stage_id);
  const [mode, setMode] = useState<Mode>(c.mode);
  const [rules, setRules] = useState<Rule[]>(() => c.rules ?? (stage?.rules ?? []).map((r) => ({ ...r })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // After a save the server returns normalised rules; adopt them so "unsaved" clears. Keyed on content, not identity.
  const savedRules = JSON.stringify(c.rules);
  useEffect(() => { setMode(c.mode); }, [c.mode]);
  useEffect(() => { if (c.rules) setRules(JSON.parse(savedRules)); }, [savedRules]);

  const m = c.metrics;
  const r = m && m.spend > 0 ? m.purchase_value / m.spend : null;
  const dirty = mode !== c.mode || (mode === 'custom' && JSON.stringify(rules) !== JSON.stringify(c.rules ?? []));

  async function save(next: { mode?: Mode; stage_id?: string | null; section_id?: string | null }) {
    setBusy(true); setError('');
    const m2 = next.mode ?? mode;
    try {
      await api.saveCampaign(c.id, {
        name: c.name,
        stage_id: next.stage_id !== undefined ? next.stage_id : c.stage_id,
        section_id: next.section_id !== undefined ? next.section_id : (c.pinned ? c.section_id : null),
        mode: m2,
        rules: m2 === 'custom' ? rules : null,
      });
      if (next.stage_id !== undefined) onStageChanged(next.stage_id);
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const choose = (next: Mode) => {
    setMode(next);
    if (next === 'custom' && !c.rules) setRules((stage?.rules ?? []).map((x) => ({ ...x })));
  };

  return (
    <div className="editor">
      <h2 className="clip-wrap">{c.name}</h2>
      <p className="muted small">
        {c.status === 'ACTIVE' ? 'เปิดอยู่' : 'หยุดอยู่'} · ใช้จ่าย {baht(m?.spend)} · {num(m?.purchases)} ออเดอร์ · ROAS {r === null ? '–' : num(r, 2)}
        {c.breakeven_roas ? ` · คุ้มทุนที่ ${num(c.breakeven_roas, 2)}` : ' · ยังไม่ผูกต้นทุน (กฎ × คุ้มทุนจะถูกข้าม)'}
      </p>

      <div className="grid2">
        <label>กลุ่ม
          <select value={c.stage_id ?? ''} disabled={busy} onChange={(e) => save({ stage_id: e.target.value || null })}>
            <option value="">— ยังไม่จัด —</option>
            {data.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>สินค้า (ใช้คิดจุดคุ้มทุน)
          <select value={c.pinned ? c.section_id : ''} disabled={busy} onChange={(e) => save({ section_id: e.target.value || null })}>
            <option value="">อัตโนมัติจากชื่อ ({(() => { const x = data.sections.find((s) => s.id === c.section_id); return x ? sectionName(x) : '–'; })()})</option>
            {data.sections.filter((s) => s.id !== 'default' || (c.pinned && c.section_id === 'default')).map((s) => <option key={s.id} value={s.id}>{sectionName(s)}</option>)}
          </select>
        </label>
      </div>

      <h3>แอดนี้ใช้กฎแบบไหน</h3>
      <div className="choices" role="radiogroup">
        {([
          ['stage', 'ตามกฎของกลุ่ม', stage ? `ใช้กฎของ "${stage.name}" ถ้าแก้กฎกลุ่ม แอดนี้เปลี่ยนตาม` : 'ต้องเลือกกลุ่มก่อน ไม่งั้นระบบไม่แตะ'],
          ['custom', 'ตั้งกฎเฉพาะแอดนี้', 'เริ่มจากสำเนากฎของกลุ่ม แล้วแก้ได้อิสระ'],
          ['off', 'ไม่ให้ระบบแตะ', 'คุมเองด้วยมืออย่างเดียว'],
        ] as [Mode, string, string][]).map(([k, label, hint]) => (
          <button key={k} role="radio" aria-checked={mode === k} className={`choice ${mode === k ? 'on' : ''}`} onClick={() => choose(k)}>
            <b>{label}</b><small>{hint}</small>
          </button>
        ))}
      </div>

      {mode === 'stage' && (
        stage ? (
          <>
            <h3>กฎที่ใช้กับแอดนี้ตอนนี้</h3>
            <EffectiveRules rules={stage.automation ? stage.rules : []} breakeven={c.breakeven_roas} stages={data.stages} />
            {!stage.automation && <p className="warn small">กลุ่มนี้ปิดอัตโนมัติอยู่</p>}
            <button className="ghost small" onClick={() => onOpenStage(stage.id)}>แก้กฎของกลุ่ม "{stage.name}" ›</button>
          </>
        ) : <p className="muted">ยังไม่ได้จัดกลุ่ม — ระบบจะไม่แตะแอดนี้</p>
      )}
      {mode === 'custom' && (
        <RulesEditor rules={rules} onChange={setRules} stages={data.stages} stageId={c.stage_id ?? undefined} breakeven={c.breakeven_roas} />
      )}
      {mode === 'off' && <p className="muted">ระบบจะไม่ปรับงบ ไม่หยุด และไม่ย้ายกลุ่มแอดนี้ ใช้ปุ่มในหน้าภาพรวมคุมเอง</p>}

      {error && <p className="error">{error}</p>}
      <div className="row end sticky-actions">
        <button className="primary" disabled={busy || !dirty} onClick={() => save({})}>{busy ? 'กำลังบันทึก…' : dirty ? 'บันทึก' : 'บันทึกแล้ว'}</button>
      </div>
    </div>
  );
}

/** Read-only rules as sentences, with break-even thresholds turned into this ad's actual numbers. */
function EffectiveRules({ rules, breakeven, stages }: { rules: Rule[]; breakeven: number | null; stages: Stage[] }) {
  const on = rules.filter((r) => r.enabled !== false);
  if (!on.length) return <p className="muted">ไม่มีกฎที่เปิดอยู่</p>;
  return (
    <ul className="effective">
      {on.map((r) => {
        const be = r.value_mode === 'x_breakeven';
        const threshold = be ? (breakeven === null ? null : r.value * breakeven) : r.value;
        const act = r.action.type === 'move'
          ? `ย้ายไป "${stages.find((s) => s.id === r.action.to)?.name ?? r.action.to}"`
          : r.action.type === 'budget_pct' ? `${(r.action.pct ?? 0) > 0 ? 'เพิ่ม' : 'ลด'}งบ ${Math.abs(r.action.pct ?? 0)}%` : ACTION_LABEL[r.action.type];
        const extra = [
          r.min_spend ? `ใช้เงิน ≥ ${baht(r.min_spend)}` : '',
          r.min_purchases ? `ยอดซื้อ ≥ ${r.min_purchases}` : '',
          r.action.type === 'move' && r.min_days_in_stage ? `อยู่กลุ่ม ≥ ${r.min_days_in_stage} วัน` : '',
        ].filter(Boolean).join(' · ');
        return (
          <li key={r.id} className={threshold === null ? 'muted' : ''}>
            ถ้า {METRIC_LABEL[r.metric]} {r.level === 'adset' ? `ของ ${LEVEL_LABEL.adset} ` : ''}{WINDOW_LABEL[r.window]} {r.op}{' '}
            <b>{threshold === null ? '(ยังไม่รู้จุดคุ้มทุน → ข้าม)' : num(threshold, Number.isInteger(threshold) ? 0 : 2)}</b>
            {be && threshold !== null && <span className="muted small"> ({r.value} × คุ้มทุน)</span>}
            {extra && <span className="muted small"> · {extra}</span>} → <b>{act}</b>
          </li>
        );
      })}
    </ul>
  );
}
