// Storage and validation of the "ทีม Agent" data (/command?view=agents). The file itself never lives in the repo:
// it is read from a path given to scripts/command-agents-sql.mjs and kept in D1 table command_sources (migration 0055),
// split over several rows because `wrangler d1 execute` refuses a single statement of ~100 KB and the file is ~200 KB.
//
//   source 'agents'          meta row:  { rev, total, parts: [{ source, count }], file: <everything but positions> }
//   source 'agents:<n>'      part row:  { rev, positions: [...] }   (n = 001, 002, ...)
//
// The reader only trusts a set whose meta and parts all carry the same `rev` and whose counts add up, so a load that
// stopped half-way (parts written first, meta last) shows "error", never a partial list or a wrong counter.
// Nothing here reads the database; command.ts does and passes the rows in.

import { approvalProblem, bkkToday, countRows, loadAgents, type Counts } from '../web/src/agents/agentsView.ts';

export const META_SOURCE = 'agents';
export const PART_PREFIX = 'agents:';
/** One part's JSON, in bytes. The whole INSERT statement (quotes, column names) must stay under STATEMENT_MAX_BYTES. */
export const PART_MAX_BYTES = 60_000;
export const STATEMENT_MAX_BYTES = 90_000;

const enc = new TextEncoder();
export const byteLength = (s: string) => enc.encode(s).length;

export interface AgentsData { positions: unknown[]; [k: string]: unknown }
export interface SourceRow { source: string; updated_at: string; data: string }

// ---------- validation ----------

export interface Validation { errors: string[]; warnings: string[]; counts: Counts | null; evidenced: number; draft: number }

/** One validator for the script and the tests. `errors` must be empty before anything is written. */
export function validateAgents(data: unknown, today: string = bkkToday()): Validation {
  const errors: string[] = [], warnings: string[] = [];
  const empty = (): Validation => ({ errors, warnings, counts: null, evidenced: 0, draft: 0 });
  if (!data || typeof data !== 'object' || Array.isArray(data)) { errors.push('file is not a JSON object'); return empty(); }
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.positions)) { errors.push('positions is not an array'); return empty(); }
  if (d.positions.length === 0) errors.push('positions is empty');
  const loaded = loadAgents(d);
  for (const id of loaded.skipped) errors.push(`row skipped (missing id/title/status, or duplicate id): ${id}`);
  for (const id of loaded.unknownStatus) errors.push(`unknown status: ${id}`);
  if (d.updated !== undefined && typeof d.updated !== 'string') errors.push('updated is not a string');

  const priorities = new Map<number, string>();
  const rawById = new Map<string, Record<string, unknown>>();
  for (const x of d.positions) if (x && typeof x === 'object') { const id = (x as any).id; if (typeof id === 'string' && !rawById.has(id)) rawById.set(id, x as Record<string, unknown>); }
  for (const r of loaded.rows) {
    const raw = rawById.get(r.id) ?? {};
    const p = r.proposal;
    if (r.status === 'vacant' && !p) errors.push(`vacant row without a proposal: ${r.id}`);
    if (!p) continue;
    const problem = approvalProblem(p, today);
    if (problem) errors.push(`${problem}: ${r.id}`);
    if (p.approved && !problem && raw.proposal && typeof (raw.proposal as any).approved !== 'boolean') errors.push(`approved is not a boolean: ${r.id}`);
    if (!p.basis) warnings.push(`proposal without basis: ${r.id}`);
    if (p.priority !== null) {
      const prev = priorities.get(p.priority);
      if (prev) errors.push(`priority ${p.priority} used twice: ${prev}, ${r.id}`);
      else priorities.set(p.priority, r.id);
    }
    const sc = (raw.proposal as any)?.scope;
    if (!sc || sc.draft_only !== true || sc.sends_to_customers !== false || sc.pays_money !== false) errors.push(`proposal scope is not draft-only / no customer / no payment: ${r.id}`);
  }
  // Optional per-department cross-check: skilltree_count in the file must equal the rows of that source.
  if (Array.isArray(d.departments)) for (const dep of d.departments as any[]) {
    if (dep && typeof dep.skilltree_count === 'number') {
      const n = loaded.rows.filter((r) => r.department === dep.id && r.source === 'skilltree').length;
      if (n !== dep.skilltree_count) errors.push(`department ${dep.id}: skilltree_count ${dep.skilltree_count} but ${n} rows`);
    }
  }
  const counts = countRows(loaded.rows, today);
  return { errors, warnings, counts, evidenced: counts.pendingEvidenced, draft: counts.pendingDraft };
}

/** Pairs like `total=10,active=2` from --expect; every key must equal the computed counter. */
export function checkExpected(v: Validation, expect: Record<string, number>): string[] {
  const c = v.counts;
  if (!c) return ['no counters (file did not validate)'];
  const have: Record<string, number> = { ...c, proposals: c.pending + c.approved, evidenced: v.evidenced, draft: v.draft };
  return Object.entries(expect).filter(([k, n]) => have[k] !== n).map(([k, n]) => `${k}: expected ${n}, got ${have[k] ?? 'unknown key'}`);
}

// ---------- split / assemble ----------

export interface Split { meta: { source: string; data: string }; parts: { source: string; data: string; count: number }[] }

/** Cut the positions into parts of at most `maxBytes` of JSON each. Throws when one row alone is bigger than that. */
export function splitAgents(data: AgentsData, rev: string, maxBytes: number = PART_MAX_BYTES): Split {
  const { positions, ...file } = data;
  const chunks: unknown[][] = [];
  const base = byteLength(JSON.stringify({ rev, positions: [] }));
  let cur: unknown[] = [], size = base;
  for (const p of positions) {
    const n = byteLength(JSON.stringify(p)) + 1;
    if (base + n > maxBytes) throw new Error(`one row is bigger than ${maxBytes} bytes`);
    if (cur.length && size + n > maxBytes) { chunks.push(cur); cur = []; size = base; }
    cur.push(p); size += n;
  }
  if (cur.length) chunks.push(cur);
  const parts = chunks.map((positions, i) => ({ source: `${PART_PREFIX}${String(i + 1).padStart(3, '0')}`, data: JSON.stringify({ rev, positions }), count: positions.length }));
  const meta = { rev, total: positions.length, parts: parts.map((p) => ({ source: p.source, count: p.count })), file };
  return { meta: { source: META_SOURCE, data: JSON.stringify(meta) }, parts };
}

export type Assembled = { ok: true; data: AgentsData; as_of: string } | { ok: false; missing: true } | { ok: false; missing: false; reason: string };

/** Put the rows of `command_sources` (source = 'agents' or 'agents:%') back together. */
export function assembleAgents(rows: SourceRow[]): Assembled {
  const metaRow = rows.find((r) => r.source === META_SOURCE);
  if (!metaRow) return { ok: false, missing: true };
  const fail = (reason: string): Assembled => ({ ok: false, missing: false, reason });
  let meta: any;
  try { meta = JSON.parse(metaRow.data); } catch { return fail('meta row is not JSON'); }
  if (!meta || typeof meta.rev !== 'string' || typeof meta.total !== 'number' || !Array.isArray(meta.parts) || !meta.file || typeof meta.file !== 'object') return fail('meta row has the wrong shape');
  const positions: unknown[] = [];
  for (const want of meta.parts) {
    const row = rows.find((r) => r.source === want?.source);
    if (!row) return fail(`part ${want?.source} is missing (load did not finish?)`);
    let part: any;
    try { part = JSON.parse(row.data); } catch { return fail(`part ${want.source} is not JSON`); }
    if (part?.rev !== meta.rev) return fail(`part ${want.source} is from another load`);
    if (!Array.isArray(part.positions) || part.positions.length !== want.count) return fail(`part ${want.source} has the wrong row count`);
    positions.push(...part.positions);
  }
  if (positions.length !== meta.total) return fail('row count does not match the meta row');
  return { ok: true, data: { ...meta.file, positions }, as_of: metaRow.updated_at };
}

// ---------- SQL for the loader script ----------

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const upsert = (source: string, at: string, data: string) =>
  `INSERT INTO command_sources (source, updated_at, generated_at, data, error) VALUES (${q(source)}, ${q(at)}, NULL, ${q(data)}, NULL)\n`
  + 'ON CONFLICT(source) DO UPDATE SET updated_at = excluded.updated_at, generated_at = NULL, data = excluded.data, error = NULL;';

/** Statements in order: parts first, meta last (so the reader switches to the new load only when it is complete),
 *  then old parts that the new load no longer uses. Throws when a statement is too big for wrangler. */
export function buildSql(split: Split, at: string): string[] {
  const keep = split.parts.map((p) => q(p.source)).join(', ');
  const stmts = [
    ...split.parts.map((p) => upsert(p.source, at, p.data)),
    upsert(split.meta.source, at, split.meta.data),
    `DELETE FROM command_sources WHERE source LIKE 'agents:%' AND source NOT IN (${keep});`,
  ];
  for (const s of stmts) if (byteLength(s) >= STATEMENT_MAX_BYTES) throw new Error(`a statement is ${byteLength(s)} bytes (limit ${STATEMENT_MAX_BYTES})`);
  return stmts;
}
