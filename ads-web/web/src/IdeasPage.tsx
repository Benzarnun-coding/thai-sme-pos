// "ไอเดีย": suggestions worked out from the numbers (no AI). Nothing changes until a button is pressed,
// and every button asks first. Hidden ideas come back after 7 days or when the numbers change the idea.

import { useState } from 'react';
import type { Idea, Overview } from './api.ts';
import { ideaActionLabel } from './actions.tsx';
import { when } from './fmt.ts';
import { Icon } from './ui.tsx';

const HIDE_DAYS = 7;
const SEVERITY: Record<Idea['severity'], { label: string; hint: string }> = {
  high: { label: 'ควรดูก่อน', hint: 'เสียเงินอยู่ตอนนี้' },
  medium: { label: 'โอกาส / ควรพิจารณา', hint: 'ย้ายกลุ่มหรือปรับงบ' },
  low: { label: 'ไว้ดูทีหลัง', hint: 'ไม่เร่งด่วน' },
};

function readHidden(): Record<string, string> {
  try {
    const all = JSON.parse(localStorage.getItem('ideas-hidden') ?? '{}') as Record<string, string>;
    const cutoff = Date.now() - HIDE_DAYS * 86_400_000;
    return Object.fromEntries(Object.entries(all).filter(([, at]) => Date.parse(at) > cutoff));
  } catch {
    return {};
  }
}

export function IdeasPage({ data, ideas, loading, error, fetchedAt, onAct, onOpenCampaign, onReload }: {
  data: Overview; ideas: Idea[] | null; loading: boolean; error: string; fetchedAt: string | null;
  onAct: (i: Idea) => void; onOpenCampaign: (id: string) => void; onReload: () => void;
}) {
  const [hidden, setHidden] = useState(readHidden);
  const [showHidden, setShowHidden] = useState(false);
  const hide = (id: string) => {
    const next = { ...hidden, [id]: new Date().toISOString() };
    setHidden(next);
    try { localStorage.setItem('ideas-hidden', JSON.stringify(next)); } catch { /* private mode */ }
  };
  const unhide = (id: string) => {
    const next = { ...hidden };
    delete next[id];
    setHidden(next);
    try { localStorage.setItem('ideas-hidden', JSON.stringify(next)); } catch { /* private mode */ }
  };

  if (error) return <div className="error">{error} <button className="ghost small" onClick={onReload}>ลองใหม่</button></div>;
  if (!ideas) return <p className="muted">กำลังคิดไอเดียจากตัวเลข 7 และ 30 วัน…</p>;

  const visible = ideas.filter((i) => showHidden || !hidden[i.id]);
  const hiddenCount = ideas.filter((i) => hidden[i.id]).length;

  return (
    <div className={loading ? 'loading' : ''}>
      <div className="ideas-intro">
        <div>
          <h2>ไอเดียจากตัวเลข</h2>
          <p className="muted small">
            เทียบ 7 วันล่าสุดกับ 23 วันก่อนหน้า และกับจุดคุ้มทุนของสินค้า (ถ้ายังไม่ผูกต้นทุน ใช้ ROAS เฉลี่ยของบัญชีแทน)
            · คิดด้วยสูตร ไม่ใช้ AI · ไม่มีอะไรเปลี่ยนจนกว่าจะกดปุ่ม
            {fetchedAt && <> · ข้อมูลเมื่อ {when(fetchedAt)}</>}
          </p>
        </div>
        {hiddenCount > 0 && (
          <button className="ghost small" onClick={() => setShowHidden(!showHidden)}>
            <Icon name="eyeoff" size={16} /> {showHidden ? 'ซ่อนที่ปิดไว้' : `ดูที่ปิดไว้ (${hiddenCount})`}
          </button>
        )}
      </div>

      {visible.length === 0 && (
        <div className="empty card">
          <p>ไม่มีอะไรน่าห่วงตอนนี้ 👍</p>
          <p className="muted small">ระบบจะคิดใหม่ทุกครั้งที่ข้อมูลจาก Meta อัปเดต</p>
        </div>
      )}

      {(['high', 'medium', 'low'] as const).map((sev) => {
        const list = visible.filter((i) => i.severity === sev);
        if (!list.length) return null;
        return (
          <section key={sev} className="idea-group">
            <h3><span className={`sev-dot ${sev}`} />{SEVERITY[sev].label} <span className="muted small">{list.length} · {SEVERITY[sev].hint}</span></h3>
            <div className="idea-grid">
              {list.map((i) => (
                <article key={i.id} className={`idea-card ${sev} ${hidden[i.id] ? 'dim' : ''}`}>
                  <header>
                    <b>{i.title}</b>
                    <button className="icon-btn" title={hidden[i.id] ? 'แสดงอีกครั้ง' : `ซ่อน ${HIDE_DAYS} วัน`} aria-label="ซ่อน" onClick={() => (hidden[i.id] ? unhide(i.id) : hide(i.id))}>
                      <Icon name={hidden[i.id] ? 'refresh' : 'x'} size={14} />
                    </button>
                  </header>
                  {i.campaign_id && (
                    <button className="name-link clip-wrap" onClick={() => onOpenCampaign(i.campaign_id!)}>{i.campaign_name}</button>
                  )}
                  <p className="small">{i.detail}</p>
                  <dl className="facts">
                    {i.facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
                  </dl>
                  {i.action && (
                    <div className="idea-actions">
                      <button className={i.action.type === 'pause' ? 'danger-soft' : i.action.type === 'budget_pct' && i.action.pct > 0 ? 'primary' : ''} disabled={data.snapshot !== null && (i.action.type === 'pause' || i.action.type === 'budget_pct')} onClick={() => onAct(i)}>
                        {ideaActionLabel(i, data.stages)}
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        );
      })}

      <p className="muted small ideas-foot">
        อยากได้คำแนะนำแบบคุยได้ (AI agent อ่านตัวเลขแล้วเสนอแผน) — ทำเพิ่มได้ภายหลัง ต้องใช้ Anthropic API key และมีค่าใช้จ่ายต่อครั้งที่ถาม
      </p>
    </div>
  );
}
