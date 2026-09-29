// Actions on campaigns shared by the overview (bulk), the campaign drawer and the ideas tab.
// Every change on Meta asks first in an in-app dialog that shows exactly what will change.

import { useCallback } from 'react';
import { api, type BulkBudgetResult, type CampaignView, type Guardrails, type Idea, type Stage } from './api.ts';
import { baht } from './fmt.ts';
import { useUi } from './ui.tsx';

export function nextBudget(from: number, pct: number, g: Guardrails): number {
  return Math.round(Math.min(g.max_daily_budget, Math.max(g.min_daily_budget, from * (1 + pct / 100))));
}

export function stageLabel(stages: Stage[], id: string | null): string {
  return id ? (stages.find((s) => s.id === id)?.name ?? id) : 'ยังไม่จัด';
}

export function ideaActionLabel(idea: Idea, stages: Stage[]): string | null {
  const a = idea.action;
  if (!a) return null;
  if (a.type === 'move') return `ย้ายไป ${stageLabel(stages, a.to)}`;
  if (a.type === 'budget_pct') return `${a.pct > 0 ? 'เพิ่ม' : 'ลด'}งบ ${Math.abs(a.pct)}%`;
  if (a.type === 'pause') return 'หยุดแคมเปญ';
  return 'ไปจัดกลุ่ม';
}

export function useCampaignActions(ctx: { stages: Stage[]; guardrails: Guardrails; readOnly: boolean; onDone: () => void }) {
  const { confirm, toast } = useUi();
  const { stages, guardrails, readOnly, onDone } = ctx;

  const guard = useCallback(() => {
    if (readOnly) toast('ข้อมูลนี้เป็น snapshot — เปลี่ยนบน Meta ได้เมื่อใส่ Meta token แล้ว', 'info');
    return readOnly;
  }, [readOnly, toast]);

  /** Stage change is only in this dashboard (no Meta call), so one confirm for many is enough. */
  const moveStage = useCallback(async (list: CampaignView[], to: string | null): Promise<boolean> => {
    const moving = list.filter((c) => c.stage_id !== to);
    if (!moving.length) { toast('อยู่ในกลุ่มนี้อยู่แล้ว'); return false; }
    const ok = await confirm({
      title: `ย้าย ${moving.length} แคมเปญไป "${stageLabel(stages, to)}"?`,
      body: (
        <>
          <NameList names={moving.map((c) => c.name)} />
          <p className="muted small">เปลี่ยนแค่กลุ่มในระบบนี้ ไม่แตะโฆษณาบน Meta · กฎของกลุ่มใหม่จะเริ่มใช้รอบถัดไป</p>
        </>
      ),
      confirmLabel: 'ย้าย',
    });
    if (!ok) return false;
    try {
      await api.bulkStage(moving.map((c) => ({ id: c.id, name: c.name })), to);
      toast(`ย้าย ${moving.length} แคมเปญแล้ว`, 'ok');
      onDone();
      return true;
    } catch (e: any) {
      toast(e.message, 'bad');
      return false;
    }
  }, [confirm, toast, stages, onDone]);

  /** Returns per-campaign results (null when cancelled). */
  const changeBudget = useCallback(async (list: CampaignView[], pct: number): Promise<BulkBudgetResult[] | null> => {
    if (guard()) return null;
    const withBudget = list.filter((c) => c.daily_budget !== null);
    const abo = list.length - withBudget.length;
    if (!withBudget.length) { toast('แคมเปญที่เลือกตั้งงบไว้ที่ ad set (ABO) — ปรับในหน้ารายละเอียด'); return null; }
    const rows = withBudget.map((c) => ({ c, from: c.daily_budget!, to: nextBudget(c.daily_budget!, pct, guardrails) }));
    const before = rows.reduce((t, r) => t + r.from, 0);
    const after = rows.reduce((t, r) => t + r.to, 0);
    const ok = await confirm({
      title: `${pct > 0 ? 'เพิ่ม' : 'ลด'}งบ ${Math.abs(pct)}% · ${rows.length} แคมเปญ`,
      body: (
        <>
          <table className="confirm-table">
            <tbody>
              {rows.map(({ c, from, to }) => (
                <tr key={c.id}>
                  <td className="clip">{c.name}</td>
                  <td className="num muted">{baht(from)}</td>
                  <td className="num">→ <b>{baht(to)}</b>{to === from && <span className="muted small"> (ติดขอบเขต)</span>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>รวมต่อวัน</td><td className="num muted">{baht(before)}</td><td className="num">→ <b>{baht(after)}</b></td></tr></tfoot>
          </table>
          {abo > 0 && <p className="muted small">ข้าม {abo} แคมเปญที่ตั้งงบไว้ที่ ad set</p>}
          <p className={`small ${pct > 0 ? 'warn' : 'muted'}`}>{pct > 0 ? 'เพิ่มการใช้จ่ายจริงบน Meta ทันที' : 'เปลี่ยนงบจริงบน Meta ทันที'} · ขอบเขตงบ {baht(guardrails.min_daily_budget)}–{baht(guardrails.max_daily_budget)}/วัน</p>
        </>
      ),
      confirmLabel: pct > 0 ? `เพิ่มงบ ${rows.length} แคมเปญ` : `ลดงบ ${rows.length} แคมเปญ`,
      tone: pct > 0 ? 'primary' : 'danger',
    });
    if (!ok) return null;
    try {
      const { results } = await api.bulkBudget(rows.map(({ c }) => ({ id: c.id, name: c.name })), pct);
      const done = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      toast(failed.length ? `ปรับงบแล้ว ${done}/${results.length} · ${failed[0].name}: ${failed[0].message}` : `ปรับงบแล้ว ${done} แคมเปญ`, failed.length ? 'bad' : 'ok');
      onDone();
      return results;
    } catch (e: any) {
      toast(e.message, 'bad');
      return null;
    }
  }, [confirm, toast, guard, guardrails, onDone]);

  const setStatus = useCallback(async (id: string, name: string, status: 'ACTIVE' | 'PAUSED') => {
    if (guard()) return;
    try {
      await api.setStatus(id, status, name);
      toast(status === 'PAUSED' ? `หยุด "${name}" แล้ว` : `เปิด "${name}" แล้ว`, 'ok');
      onDone();
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  }, [guard, toast, onDone]);

  const pause = useCallback(async (c: CampaignView) => {
    if (guard()) return;
    const ok = await confirm({
      title: 'หยุดแคมเปญนี้?',
      body: <><p className="clip-wrap"><b>{c.name}</b></p><p className="muted">โฆษณาจะหยุดใช้เงินทันทีบน Meta · เปิดกลับได้ทุกเมื่อ</p></>,
      confirmLabel: 'หยุดเลย',
      tone: 'danger',
    });
    if (ok) await setStatus(c.id, c.name, 'PAUSED');
  }, [guard, confirm, setStatus]);

  const setBudget = useCallback(async (id: string, name: string, from: number | null, amount: number) => {
    if (guard()) return false;
    const ok = await confirm({
      title: 'เปลี่ยนงบต่อวัน?',
      body: <><p className="clip-wrap"><b>{name}</b></p><p className="big-change">{baht(from)} → <b>{baht(amount)}</b> <span className="muted small">/วัน</span></p><p className="muted small">เปลี่ยนจริงบน Meta ทันที</p></>,
      confirmLabel: 'เปลี่ยนงบ',
    });
    if (!ok) return false;
    try {
      await api.setBudget(id, amount, from, name);
      toast('เปลี่ยนงบแล้ว', 'ok');
      onDone();
      return true;
    } catch (e: any) {
      toast(e.message, 'bad');
      return false;
    }
  }, [guard, confirm, toast, onDone]);

  return { moveStage, changeBudget, pause, setStatus, setBudget };
}

function NameList({ names }: { names: string[] }) {
  const shown = names.slice(0, 8);
  return (
    <ul className="name-list">
      {shown.map((n, i) => <li key={i} className="clip">{n}</li>)}
      {names.length > shown.length && <li className="muted">และอีก {names.length - shown.length} แคมเปญ</li>}
    </ul>
  );
}
