import { ACTION_LABEL, LEVEL_LABEL, METRIC_LABEL, WINDOW_LABEL, type ActionType, type Level, type Metric, type Op, type Rule, type Stage, type Window } from './api.ts';
import { num } from './fmt.ts';

const newId = () => `r-${Math.random().toString(36).slice(2, 7)}`;

interface Props {
  rules: Rule[];
  onChange: (rules: Rule[]) => void;
  /** Targets for "move" rules */
  stages: Stage[];
  /** The stage these rules belong to (can't move to itself); undefined for a campaign's own rules */
  stageId?: string;
  /** A single break-even to show actual thresholds (campaign rules); null = varies per product */
  breakeven: number | null;
}

export function RulesEditor({ rules, onChange, stages, stageId, breakeven }: Props) {
  const targets = stages.filter((s) => s.id !== stageId);
  const update = (i: number, patch: Partial<Rule>) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...rules];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const setAction = (i: number, type: ActionType) => {
    const r = rules[i];
    if (type === 'move') update(i, { action: { type, to: targets[0]?.id }, level: 'campaign', min_days_in_stage: r.min_days_in_stage ?? 3 });
    else update(i, { action: { type, pct: type === 'budget_pct' ? (r.action.pct ?? 20) : undefined }, min_days_in_stage: undefined });
  };

  return (
    <div className="rules">
      {rules.length === 0 && <p className="muted">ยังไม่มีกฎ — ระบบจะไม่แตะแคมเปญที่ใช้ชุดนี้</p>}
      {rules.map((r, i) => {
        const isMove = r.action.type === 'move';
        return (
          <div key={r.id} className={`rule ${r.enabled === false ? 'off' : ''} ${isMove ? 'move' : ''}`}>
            <div className="rule-head">
              <label className="check">
                <input type="checkbox" checked={r.enabled !== false} onChange={(e) => update(i, { enabled: e.target.checked })} />
                <span>{isMove ? '↪ ย้าย' : `ข้อ ${i + 1}`}</span>
              </label>
              <input className="desc" placeholder="คำอธิบาย (ไม่บังคับ)" value={r.description ?? ''} onChange={(e) => update(i, { description: e.target.value })} />
              <div className="rule-tools">
                <button type="button" className="icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="เลื่อนขึ้น">↑</button>
                <button type="button" className="icon" disabled={i === rules.length - 1} onClick={() => move(i, 1)} aria-label="เลื่อนลง">↓</button>
                <button type="button" className="icon danger" onClick={() => onChange(rules.filter((_, j) => j !== i))} aria-label="ลบกฎ">✕</button>
              </div>
            </div>

            <div className="sentence">
              <span>ถ้า</span>
              <select value={r.metric} onChange={(e) => update(i, { metric: e.target.value as Metric, value_mode: e.target.value === 'roas' ? r.value_mode : 'abs' })}>
                {Object.entries(METRIC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <span>ของ</span>
              <select value={r.level} disabled={isMove} onChange={(e) => update(i, { level: e.target.value as Level })}>
                {Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <span>ช่วง</span>
              <select value={r.window} onChange={(e) => update(i, { window: e.target.value as Window })}>
                {Object.entries(WINDOW_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select value={r.op} onChange={(e) => update(i, { op: e.target.value as Op })} aria-label="เงื่อนไข">
                {['<', '<=', '>', '>='].map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <input type="number" step="any" className="n" value={r.value} onChange={(e) => update(i, { value: Number(e.target.value) })} aria-label="ค่า" />
              {r.metric === 'roas' && (
                <select value={r.value_mode ?? 'abs'} onChange={(e) => update(i, { value_mode: e.target.value as Rule['value_mode'] })}>
                  <option value="abs">(ค่าตายตัว)</option>
                  <option value="x_breakeven">× จุดคุ้มทุน</option>
                </select>
              )}
            </div>
            {r.value_mode === 'x_breakeven' && (
              <p className="hint">
                {breakeven !== null
                  ? `ตอนนี้ = ROAS ${num(r.value * breakeven, 2)} (คุ้มทุน ${num(breakeven, 2)})`
                  : 'คูณกับจุดคุ้มทุนของสินค้าแต่ละแคมเปญ — สินค้าที่ยังไม่ผูกต้นทุนจะข้ามกฎข้อนี้'}
              </p>
            )}

            <div className="sentence">
              <span>ใช้เงิน ≥ ฿</span>
              <input type="number" className="n" value={r.min_spend ?? ''} placeholder="0" onChange={(e) => update(i, { min_spend: e.target.value === '' ? undefined : Number(e.target.value) })} aria-label="ใช้เงินขั้นต่ำ" />
              <span>ยอดซื้อ ≥</span>
              <input type="number" className="n" value={r.min_purchases ?? ''} placeholder="0" onChange={(e) => update(i, { min_purchases: e.target.value === '' ? undefined : Number(e.target.value) })} aria-label="ยอดซื้อขั้นต่ำ" />
              {isMove && (
                <>
                  <span>อยู่ในกลุ่ม ≥</span>
                  <input type="number" className="n" value={r.min_days_in_stage ?? 0} onChange={(e) => update(i, { min_days_in_stage: Number(e.target.value) })} aria-label="อยู่ในกลุ่มอย่างน้อยกี่วัน" />
                  <span>วัน</span>
                </>
              )}
            </div>

            <div className="sentence">
              <span>→</span>
              <select value={r.action.type} onChange={(e) => setAction(i, e.target.value as ActionType)}>
                {(Object.keys(ACTION_LABEL) as ActionType[]).filter((k) => k !== 'move' || targets.length).map((k) => <option key={k} value={k}>{ACTION_LABEL[k]}</option>)}
              </select>
              {isMove && (
                <select value={r.action.to} onChange={(e) => update(i, { action: { type: 'move', to: e.target.value } })} aria-label="กลุ่มปลายทาง">
                  {targets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              {r.action.type === 'budget_pct' && (
                <>
                  <input type="number" className="n" value={r.action.pct ?? 0} onChange={(e) => update(i, { action: { type: 'budget_pct', pct: Number(e.target.value) } })} aria-label="เปอร์เซ็นต์" />
                  <span>%</span>
                </>
              )}
              {!isMove && (
                <>
                  <span>· แล้วพัก</span>
                  <input type="number" className="n" value={r.cooldown_hours ?? 24} onChange={(e) => update(i, { cooldown_hours: Number(e.target.value) })} aria-label="ชั่วโมงพัก" />
                  <span>ชม.</span>
                </>
              )}
            </div>
          </div>
        );
      })}

      <div className="row gap">
        <button type="button" onClick={() => onChange([...rules, { id: newId(), level: 'campaign', window: 'last_7d', metric: 'roas', op: '<', value: 1, value_mode: 'x_breakeven', min_spend: 1000, action: { type: 'budget_pct', pct: -20 }, cooldown_hours: 48, enabled: true }])}>
          + เพิ่มกฎ
        </button>
        {targets.length > 0 && (
          <button type="button" className="ghost" onClick={() => onChange([...rules, { id: newId(), level: 'campaign', window: 'last_7d', metric: 'roas', op: '>=', value: 1.3, value_mode: 'x_breakeven', min_purchases: 10, min_days_in_stage: 3, action: { type: 'move', to: targets[0].id }, enabled: true }])}>
            + เพิ่มกฎย้ายกลุ่ม
          </button>
        )}
      </div>
      <p className="muted small">
        กฎปรับแอดเช็คจากบนลงล่าง ข้อบนสุดที่ตรงชนะ (รอบละ 1 การเปลี่ยนต่อตัว) · กฎย้ายกลุ่มเช็คแยก ไม่แตะ Meta แค่เปลี่ยนกลุ่ม แล้วรอบถัดไปใช้กฎของกลุ่มใหม่
      </p>
    </div>
  );
}
