import { useEffect, useState } from 'react';
import { api, type AuditRow, type RunReport, type RunRow, type Stage } from './api.ts';
import { baht, when } from './fmt.ts';

export function RunResult({ report }: { report: RunReport }) {
  const acted = report.decisions.filter((d) => !d.skipped_reason);
  const skipped = report.decisions.filter((d) => d.skipped_reason);
  const moves = report.moves ?? [];
  return (
    <div className="run-result">
      <p>
        {report.dry_run ? '🧪 ทดลอง — ยังไม่ได้เปลี่ยนอะไรบน Meta' : '✅ ทำจริง'} · ตรวจ {report.entities_evaluated} รายการ
        · งบรวม/วัน {baht(report.totals.daily_budget_before)} → {baht(report.totals.daily_budget_after)}
      </p>
      {moves.length > 0 && (
        <ul className="decisions">
          {moves.map((m, i) => (
            <li key={i} className={m.skipped_reason ? 'muted' : ''}>
              ↪ {m.plan}
              {m.skipped_reason ? <span className="small"> · ยังไม่ย้าย: {m.skipped_reason}</span> : report.dry_run ? <span className="small"> · (ทดลอง)</span> : null}
            </li>
          ))}
        </ul>
      )}
      {acted.length === 0 && moves.length === 0 && <p className="muted">ไม่มีกฎไหนตรงเงื่อนไข</p>}
      {acted.length > 0 && (
        <ul className="decisions">
          {acted.map((d, i) => (
            <li key={i} className={d.error ? 'bad' : ''}>
              <b>{actionText(d.action.type, d.action.pct)}</b> {d.entity.level === 'adset' ? `ad set "${d.entity.name}" ใน ` : ''}"{d.entity.campaign_name}"
              <span className="muted small"> · {d.group} · กฎ {d.rule_id}: {d.metric} = {d.observed ?? '∞'} เทียบ {d.threshold}</span>
              {d.after?.daily_budget != null && d.before?.daily_budget != null && d.after.daily_budget !== d.before.daily_budget && (
                <span> · {baht(d.before.daily_budget)} → {baht(d.after.daily_budget)}</span>
              )}
              {d.error && <span className="bad"> · ❌ {d.error}</span>}
            </li>
          ))}
        </ul>
      )}
      {skipped.length > 0 && (
        <details>
          <summary className="muted small">ข้าม {skipped.length} รายการ</summary>
          <ul className="decisions small">
            {skipped.map((d, i) => <li key={i}>{d.entity.name} ({d.rule_id}) — {d.skipped_reason}</li>)}
          </ul>
        </details>
      )}
      {report.notes.length > 0 && <ul className="notes small">{report.notes.map((n, i) => <li key={i}>ℹ️ {n}</li>)}</ul>}
      {report.errors.length > 0 && <ul className="notes small bad">{report.errors.map((n, i) => <li key={i}>❌ {n}</li>)}</ul>}
    </div>
  );
}

function actionText(type: string, pct?: number): string {
  if (type === 'pause') return 'หยุด';
  if (type === 'enable') return 'เปิด';
  if (type === 'notify') return 'แจ้งเตือน';
  return `งบ ${pct && pct > 0 ? '+' : ''}${pct}%`;
}

const AUDIT_LABEL: Record<string, string> = {
  'meta.status': 'เปิด/หยุดบน Meta', 'meta.budget': 'เปลี่ยนงบบน Meta', 'section.create': 'เพิ่มสินค้า', 'section.update': 'แก้ต้นทุนสินค้า',
  'section.delete': 'ลบสินค้า', 'campaign.settings': 'ตั้งค่าแคมเปญ', 'settings.update': 'แก้ตั้งค่า', 'costs.sync': 'ซิงก์ต้นทุน',
  'campaign.stage': 'ย้ายกลุ่ม', 'stage.update': 'แก้กฎของกลุ่ม',
};

export function History({ stages }: { stages: Stage[] }) {
  const stageName = (id: string | null) => (id ? (stages.find((s) => s.id === id)?.name ?? id) : 'ไม่จัดกลุ่ม');
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [auditRows, setAudit] = useState<AuditRow[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.runs(), api.audit()]).then(([r, a]) => { setRuns(r); setAudit(a); }).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!runs) return <p className="muted">กำลังโหลด…</p>;
  return (
    <>
      <section className="card">
        <h2>รอบการทำงานของกฎ</h2>
        {runs.length === 0 && <p className="muted">ยังไม่เคยรัน</p>}
        {runs.map((r) => (
          <div key={r.id} className="history-row">
            <button className="link" onClick={() => setOpen(open === r.id ? null : r.id)}>
              {when(r.run_at)} · {r.trigger === 'schedule' ? 'ตามเวลา' : r.trigger.replace('manual:', 'กดเอง: ')} · {r.summary}
            </button>
            {open === r.id && <RunResult report={r.report} />}
          </div>
        ))}
      </section>
      <section className="card">
        <h2>ใครแก้อะไร</h2>
        {auditRows.length === 0 && <p className="muted">ยังไม่มี</p>}
        <ul className="audit">
          {auditRows.map((a) => {
            const d = safeParse(a.detail);
            const name = d?.name ?? d?.after?.name ?? d?.before?.name;
            return (
              <li key={a.id}>
                <span className="muted small">{when(a.at)}</span> <b>{a.actor}</b> {AUDIT_LABEL[a.action] ?? a.action}
                {name ? ` "${name}"` : ` ${a.target}`}
                {a.action === 'meta.budget' && d ? ` ${baht(d.from)} → ${baht(d.to)}` : ''}
                {a.action === 'meta.status' && d ? ` → ${d.status === 'ACTIVE' ? 'เปิด' : 'หยุด'}` : ''}
                {a.action === 'campaign.stage' && d ? ` ${stageName(d.from)} → ${stageName(d.to)}` : ''}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}
