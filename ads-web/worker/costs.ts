// Pull product costs from the Google Sheet (Master Catalog) into D1.
// Uses the sheet's CSV export, which works while the sheet is shared as "anyone with the link can view".
// Google takes 5–15 s per tab on this workbook, so tabs are fetched in parallel and each fetch has a timeout.

import { replaceCosts, type Settings } from './db.ts';
import { COST_QUERY, parseCostQuery, parseCsv } from './model.ts';

export interface TabResult {
  tab: string;
  codes: number;
  error?: string;
}

const FETCH_TIMEOUT_MS = 25_000;
/** Workers allow 6 simultaneous outbound connections per invocation. */
const CONCURRENCY = 6;

export async function syncCosts(db: D1Database, settings: Settings, tabs = settings.sheet_tabs): Promise<TabResult[]> {
  const queue = [...tabs];
  const out: TabResult[] = [];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let tab = queue.shift(); tab !== undefined; tab = queue.shift()) out.push(await syncTab(db, settings.sheet_id, tab));
  }));
  return tabs.map((t) => out.find((r) => r.tab === t)!);
}

async function syncTab(db: D1Database, sheetId: string, tab: string): Promise<TabResult> {
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv`
    + `&sheet=${encodeURIComponent(tab)}&tq=${encodeURIComponent(COST_QUERY)}`;
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('csv')) {
      // A private sheet answers with a Google sign-in page instead of CSV.
      return { tab, codes: 0, error: `อ่านแท็บไม่ได้ (HTTP ${res.status}) — ชีตต้องแชร์แบบ "ทุกคนที่มีลิงก์ดูได้" และชื่อแท็บต้องตรง` };
    }
    const rows = parseCostQuery(tab, parseCsv(await res.text()));
    if (rows.length === 0) {
      // Keep the previous cache rather than wiping a tab because of a transient empty export.
      return { tab, codes: 0, error: 'ไม่พบแถวที่มีต้นทุน (คอลัมน์ H) — ไม่ลบของเดิม' };
    }
    await replaceCosts(db, tab, rows);
    return { tab, codes: rows.length };
  } catch (err: any) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { tab, codes: 0, error: timeout ? `Google ตอบช้าเกิน ${FETCH_TIMEOUT_MS / 1000} วินาที — ลองใหม่` : (err?.message ?? String(err)) };
  }
}
