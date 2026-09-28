// Optional LINE push via Messaging API. Silent no-op when env vars are missing.

import type { RunReport } from './types.ts';

export function formatReport(r: RunReport): string {
  const lines: string[] = [];
  lines.push(`${r.dry_run ? '🧪 DRY RUN' : '✅ APPLIED'} · ${r.account_id}`);
  lines.push(`${r.run_at.slice(0, 16).replace('T', ' ')} · ${r.entities_evaluated} entities`);
  const acted = r.decisions.filter((d) => !d.skipped_reason);
  const skipped = r.decisions.filter((d) => d.skipped_reason);
  lines.push(`งบรวม/วัน: ${r.totals.daily_budget_before} → ${r.totals.daily_budget_after}`);
  if (acted.length === 0) lines.push('ไม่มีกฎไหนตรงเงื่อนไข');
  for (const d of acted) {
    const tail = d.error ? ` ❌ ${d.error}` : d.after?.daily_budget !== undefined && d.after.daily_budget !== d.before?.daily_budget ? ` → ${d.after.daily_budget}` : '';
    lines.push(`• [${d.rule_id}] ${d.plan}${tail}`);
  }
  if (skipped.length) lines.push(`ข้าม ${skipped.length} รายการ (${[...new Set(skipped.map((d) => d.skipped_reason))].join(', ')})`);
  if (r.errors.length) lines.push(`errors: ${r.errors.join(' | ')}`);
  return lines.join('\n');
}

export async function pushLine(text: string, token?: string, to?: string): Promise<boolean> {
  if (!token || !to) return false;
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
  });
  if (!res.ok) console.error('LINE push failed:', res.status, await res.text());
  return res.ok;
}
