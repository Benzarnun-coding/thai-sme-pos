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

/** Discord incoming webhook. Messages over 2,000 characters are split. Silent no-op when the URL is missing. */
export async function pushDiscord(text: string, url?: string): Promise<boolean> {
  if (!url) return false;
  const chunks: string[] = [];
  // A line longer than a message is cut into pieces by code point (never through an emoji's surrogate pair).
  const lines = text.replace(/\r/g, '').split('\n').flatMap((line) => {
    const cps = Array.from(line);
    if (cps.length <= 1900) return [line];
    const parts: string[] = [];
    for (let i = 0; i < cps.length; i += 1900) parts.push(cps.slice(i, i + 1900).join(''));
    return parts;
  });
  for (const line of lines) {
    const last = chunks[chunks.length - 1];
    if (last !== undefined && last.length + line.length + 1 <= 1900) chunks[chunks.length - 1] = `${last}\n${line}`;
    else chunks.push(line);
  }
  let ok = true;
  for (const [i, content] of chunks.entries()) {
    if (i) await new Promise((r) => setTimeout(r, 400)); // webhooks allow a few posts per second
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, username: 'อูนิ' }) });
    if (!res.ok) { console.error('Discord push failed:', res.status, await res.text()); ok = false; }
  }
  return ok;
}
