export type WorkKind = 'intel' | 'brief' | 'post' | 'ad_plan' | 'adjust' | 'rule';
export type WorkStatus = 'open' | 'changes' | 'pending' | 'approved' | 'rejected' | 'done';
export interface Review { pass: boolean | null; issues: string[] }
export interface WorkItem {
  id: number; store_id: string; kind: WorkKind; title: string; body: string; status: WorkStatus;
  from_slug: string; to_slug: string | null; parent_id: number | null; review: Review | null; rounds: number;
  run_id: number | null; directive_id: number | null; created_at: string; updated_at: string;
  decided_at: string | null; decided_by: string | null; decision_note: string | null; published_at: string | null; published_as: string | null;
}
export interface NewItem { kind: WorkKind; title: string; body: string; status: WorkStatus; from_slug: string; to_slug: string | null; parent_id?: number | null; rounds?: number; replaces?: WorkKind }
export interface Task { items: WorkItem[]; message: string }
export interface Outcome { create: NewItem[]; update: { id: number; patch: Partial<WorkItem> }[]; note?: string }
export const KIND_LABEL: Record<WorkKind, string>;
export const STATUS_LABEL: Record<WorkStatus, string>;
export function inboxFor(slug: string, items: WorkItem[]): WorkItem[];
export function plan(slug: string, runPrompt: string, inbox: WorkItem[]): Task[];
export function verdictOf(reply: string): boolean | null;
export function outcome(slug: string, task: Task, reply: string): Outcome;
export function decide(item: WorkItem, decision: 'approve' | 'reject', note?: string): Partial<WorkItem> | null;
export function publish(inbox: WorkItem[], live: boolean): { id: number; patch: Partial<WorkItem> }[];
export function summarize(slug: string, results: { note?: string; live?: boolean }[], inbox: WorkItem[]): string | null;
