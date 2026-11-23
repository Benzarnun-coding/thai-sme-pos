// Pure logic for the "ทีม Agent" view of /command (design: docs/command-center/agents-design.md §2, §4). No React, no fetch.
// The data comes from GET /api/command/agents (behind the Command login); counters are always computed here from the
// rows, never stored with the data.

export type Status = 'active' | 'paused' | 'pk-auto' | 'vacant';
export const STATUS_ORDER: Status[] = ['active', 'pk-auto', 'paused', 'vacant'];
export const STATUS_TH: Record<Status, string> = { active: 'ใช้งาน', 'pk-auto': 'PK-auto', paused: 'พัก', vacant: 'ว่าง' };
/** Fixed order of the 7 SkillTree departments; any other department goes after, in Thai alphabetical order. */
export const DEPT_ORDER = ['sales', 'deals', 'marketing', 'operations', 'intelligence', 'customer', 'back-office'];
export const SCOPE_TH: Record<string, string> = {
  'draft-only': 'ทำได้แค่ร่าง ไม่ส่งออกเอง',
  'no-customer': 'ไม่ส่งอะไรถึงลูกค้า',
  'no-payment': 'ไม่จ่ายเงิน ไม่สั่งซื้อ',
};

export interface RawScope { draft_only?: boolean; sends_to_customers?: boolean; pays_money?: boolean; notes?: string | null }
export interface Proposal {
  /** The raw flag from the data. Never read it alone: ask `isApproved(p)`. */
  approved: boolean;
  approvedBy: string | null;
  approvedOn: string | null;
  /** Where the spec came from: 'suggested-from-title' = drafted from the position title only, anything else = evidence. */
  basis: string | null;
  kind: string | null;
  name: string;
  duty: string;
  businesses: string[];
  inputs: string[];
  outputs: string[];
  scope: string[];
  team: string | null;
  priority: number | null;
  priorityReason: string | null;
}
export interface Position {
  id: string;
  department: string;
  title: string;
  source: string;
  agent: string | null;
  team: string | null;
  status: Status;
  coverage: 'full' | 'partial' | null;
  pkAuto: boolean;
  businesses: string[];
  evidence: string | null;
  proposal: Proposal | null;
  haystack: string;
}
export interface Department { id: string; name: string; nameTh: string | null }
export interface Loaded { rows: Position[]; departments: Department[]; skipped: string[]; unknownStatus: string[] }

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const list = (v: unknown): string[] => (Array.isArray(v) ? v : v == null ? [] : [v]).map(str).filter((x): x is string => x !== null);

/** `proposal.scope` can be {draft_only, sends_to_customers, pays_money, notes}, a string or a string[]. */
export function scopeLines(scope: unknown): string[] {
  const known = (s: string) => SCOPE_TH[s] ?? s;
  if (scope && typeof scope === 'object' && !Array.isArray(scope)) {
    const o = scope as RawScope;
    const out: string[] = [];
    if (o.draft_only === true) out.push(SCOPE_TH['draft-only']);
    if (o.sends_to_customers === false) out.push(SCOPE_TH['no-customer']);
    if (o.pays_money === false) out.push(SCOPE_TH['no-payment']);
    // A flag that is true (or missing) means the limit does not hold: say so rather than hide it.
    if (o.draft_only !== true) out.push('ไม่ได้จำกัดแค่ร่าง');
    if (o.sends_to_customers !== false) out.push('อาจส่งถึงลูกค้า');
    if (o.pays_money !== false) out.push('อาจจ่ายเงิน');
    const n = str(o.notes);
    if (n) out.push(n);
    return out;
  }
  return list(scope).map(known);
}

function proposalOf(v: unknown): Proposal | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  return {
    approved: p.approved === true, // anything but a literal true is "waiting for Benz"
    approvedBy: str(p.approved_by),
    approvedOn: str(p.approved_on),
    basis: str(p.basis),
    kind: str(p.kind),
    name: str(p.name) ?? '',
    duty: str(p.duty) ?? '',
    businesses: list(p.businesses),
    inputs: list(p.inputs),
    outputs: list(p.outputs),
    scope: scopeLines(p.scope),
    team: str(p.team),
    priority: typeof p.priority === 'number' && Number.isFinite(p.priority) ? p.priority : null,
    priorityReason: str(p.priority_reason),
  };
}

export function normText(s: string): string { return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim(); }

/** Validate once at load: rows need id + title + status. Bad rows are skipped (listed), duplicate id keeps the first,
 *  an unknown status counts as 'paused' (never as vacant) and is listed. */
export function loadAgents(data: unknown): Loaded {
  const d = (data && typeof data === 'object' ? data : {}) as { positions?: unknown; departments?: unknown };
  const positions = Array.isArray(d.positions) ? d.positions : [];
  const rows: Position[] = [], skipped: string[] = [], unknownStatus: string[] = [];
  const seen = new Set<string>();
  positions.forEach((raw, i) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const id = str(r.id), title = str(r.title);
    if (!id || !title || typeof r.status !== 'string' || seen.has(id)) { skipped.push(id ?? `#${i}`); return; }
    seen.add(id);
    let status = r.status as Status;
    if (!STATUS_ORDER.includes(status)) { unknownStatus.push(id); status = 'paused'; }
    const cov = r.coverage === 'full' || r.coverage === 'เต็ม' ? 'full' : r.coverage === 'partial' || r.coverage === 'บางส่วน' ? 'partial' : null;
    const proposal = proposalOf(r.proposal);
    const row: Position = {
      id, title, status,
      department: str(r.department) ?? 'other',
      source: str(r.source) ?? 'skilltree',
      agent: str(r.agent), team: str(r.team),
      coverage: cov, pkAuto: r.pk_auto === true,
      businesses: list(r.businesses), evidence: str(r.evidence), proposal, haystack: '',
    };
    row.haystack = normText([row.id, row.title, str(r.title_th), row.agent, row.team, row.department, row.source, ...row.businesses, proposal?.name, proposal?.duty].filter(Boolean).join(' '));
    rows.push(row);
  });
  const departments: Department[] = [];
  if (Array.isArray(d.departments)) for (const x of d.departments) {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const id = str(o.id);
    if (id && !departments.some((y) => y.id === id)) departments.push({ id, name: str(o.name) ?? id, nameTh: str(o.name_th) });
  }
  for (const r of rows) if (!departments.some((y) => y.id === r.department)) departments.push({ id: r.department, name: r.department, nameTh: null });
  departments.sort(compareDept);
  return { rows, departments, skipped, unknownStatus };
}

export function compareDept(a: Department, b: Department): number {
  const ia = DEPT_ORDER.indexOf(a.id), ib = DEPT_ORDER.indexOf(b.id);
  if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  return a.name.localeCompare(b.name, 'th');
}

export const BASIS_DRAFT = 'suggested-from-title';

/** Today as YYYY-MM-DD in Bangkok. */
export function bkkToday(now: number = Date.now()): string {
  return new Date(now + 7 * 3600_000).toISOString().slice(0, 10);
}

/** A real calendar date written YYYY-MM-DD (2026-02-30 is not). */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Why an `approved: true` is not accepted, or null when it is complete. The validator reports these as errors. */
export function approvalProblem(p: Pick<Proposal, 'approved' | 'approvedBy' | 'approvedOn'>, today: string = bkkToday()): string | null {
  if (p.approved !== true) return null;
  if (!p.approvedBy) return 'approved without approved_by';
  if (!isIsoDate(p.approvedOn)) return 'approved without a valid approved_on (YYYY-MM-DD)';
  if (p.approvedOn > today) return 'approved_on is in the future';
  return null;
}

/** The one place that decides "approved". Fail-closed: approved=true counts only with a name, and a real date not in the future. */
export const isApproved = (p: Proposal, today: string = bkkToday()): boolean => p.approved === true && approvalProblem(p, today) === null;
export const isDraftFromTitle = (p: Proposal) => p.basis === BASIS_DRAFT;
export const isEvidenced = (p: Proposal) => p.basis !== null && p.basis !== BASIS_DRAFT;

/** A row (any status) whose proposal is still waiting for Benz. */
export const awaitingApproval = (p: Position, today: string = bkkToday()) => p.proposal !== null && !isApproved(p.proposal, today);

export interface Counts { total: number; active: number; paused: number; pkAuto: number; vacant: number; staffed: number; pending: number; pendingVacant: number; pendingStaffed: number; pendingEvidenced: number; pendingDraft: number; approved: number; skilltree: number; other: number }
export function countRows(rows: Position[], today: string = bkkToday()): Counts {
  const c: Counts = { total: rows.length, active: 0, paused: 0, pkAuto: 0, vacant: 0, staffed: 0, pending: 0, pendingVacant: 0, pendingStaffed: 0, pendingEvidenced: 0, pendingDraft: 0, approved: 0, skilltree: 0, other: 0 };
  for (const r of rows) {
    if (r.status === 'active') c.active++; else if (r.status === 'paused') c.paused++; else if (r.status === 'pk-auto') c.pkAuto++; else c.vacant++;
    if (awaitingApproval(r, today)) {
      c.pending++; if (r.status === 'vacant') c.pendingVacant++; else c.pendingStaffed++;
      if (r.proposal && isDraftFromTitle(r.proposal)) c.pendingDraft++; else if (r.proposal && isEvidenced(r.proposal)) c.pendingEvidenced++;
    } else if (r.proposal) c.approved++;
    if (r.source === 'skilltree') c.skilltree++; else c.other++;
  }
  c.staffed = c.active + c.paused + c.pkAuto;
  return c;
}

/** Per-department counters over the whole file (the filters never change them). */
export function deptCounts(rows: Position[], departments: Department[]) {
  return departments.map((d) => {
    const c = countRows(rows.filter((r) => r.department === d.id));
    return { dept: d, total: c.total, staffed: c.staffed, vacant: c.vacant, counts: c };
  });
}

export type PropFilter = 'pending' | 'approved';
export type BasisFilter = 'evidenced' | 'draft';
export interface Filter { query: string; department: string | null; status: Status | null; prop?: PropFilter | null; basis?: BasisFilter | null }
export const NO_FILTER: Filter = { query: '', department: null, status: null, prop: null, basis: null };

export function matchesQuery(r: Position, query: string): boolean {
  const words = normText(query).split(' ').filter(Boolean);
  return words.every((w) => r.haystack.includes(w));
}

/** `ignore` leaves one chip group out, so that group's chips can show counts for the other filters. */
export function filterRows(rows: Position[], f: Filter, ignore?: 'status' | 'prop' | 'basis', today: string = bkkToday()): Position[] {
  return rows.filter((r) =>
    (!f.department || r.department === f.department) &&
    (ignore === 'status' || !f.status || r.status === f.status) &&
    (ignore === 'prop' || !f.prop || (r.proposal !== null && (f.prop === 'pending') === !isApproved(r.proposal, today))) &&
    (ignore === 'basis' || !f.basis || (r.proposal !== null && (f.basis === 'draft' ? isDraftFromTitle(r.proposal) : isEvidenced(r.proposal)))) &&
    (!f.query.trim() || matchesQuery(r, f.query)));
}

/** Default order: department → status → (vacant) proposal priority → title. When the status filter is 'vacant' the
 *  status step drops out, which gives the "what to fill next" view. */
export function sortRows(rows: Position[], depts: Department[]): Position[] {
  const di = new Map(depts.map((d, i) => [d.id, i]));
  const prio = (r: Position) => r.proposal?.priority ?? Number.POSITIVE_INFINITY;
  return [...rows].sort((a, b) =>
    (di.get(a.department) ?? 999) - (di.get(b.department) ?? 999) ||
    STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
    (a.status === 'vacant' && b.status === 'vacant' ? (prio(a) === prio(b) ? 0 : prio(a) < prio(b) ? -1 : 1) : 0) ||
    a.title.localeCompare(b.title, 'th'));
}

/** Rows to show for a filter: filtered, then sorted. */
export function visibleRows(rows: Position[], depts: Department[], f: Filter): Position[] {
  return sortRows(filterRows(rows, f), depts);
}

/** Status chip counts follow the department + search filter but not the status chip itself. */
export function statusChipCounts(rows: Position[], f: Filter): Record<Status | 'all', number> {
  const base = filterRows(rows, f, 'status');
  const out = { all: base.length, active: 0, 'pk-auto': 0, paused: 0, vacant: 0 };
  for (const r of base) out[r.status]++;
  return out;
}

/** Counts for the proposal chips (state and source). They follow department, search and status, and each group ignores itself. */
export function proposalChipCounts(rows: Position[], f: Filter, today: string = bkkToday()) {
  const state = filterRows(rows, f, 'prop', today);
  const src = filterRows(rows, f, 'basis', today);
  const has = (r: Position) => r.proposal !== null;
  return {
    pending: state.filter((r) => has(r) && !isApproved(r.proposal!, today)).length,
    approved: state.filter((r) => has(r) && isApproved(r.proposal!, today)).length,
    evidenced: src.filter((r) => has(r) && isEvidenced(r.proposal!)).length,
    draft: src.filter((r) => has(r) && isDraftFromTitle(r.proposal!)).length,
  };
}

export interface Group { dept: Department; rows: Position[]; total: number; staffed: number; vacant: number }
export function groupByDept(shown: Position[], all: Position[], depts: Department[]): Group[] {
  return depts.map((d) => {
    const c = countRows(all.filter((r) => r.department === d.id));
    return { dept: d, rows: shown.filter((r) => r.department === d.id), total: c.total, staffed: c.staffed, vacant: c.vacant };
  }).filter((g) => g.rows.length > 0);
}

/** "d MMM yyyy" in Thai Buddhist calendar for an ISO date (YYYY-MM-DD), or null when it is not one. */
export function thaiDate(iso: unknown): string | null {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' });
}
