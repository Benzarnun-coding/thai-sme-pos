/** Types and fetch helpers for the back-office screens. */

export type Kind = 'ai' | 'automation' | 'human';
export type Team = 'sense' | 'content' | 'approve' | 'ads' | 'learn';

export interface AddonDef {
  id: string; kind: 'knowledge' | 'action'; label: string; hint: string; phase: number; risky?: boolean; available: boolean;
}
export interface CatalogAgent { slug: string; kind: Kind; team: Team; step: number; name: string; emoji: string; role: string; schedule: string; starters: string[]; rules?: string[] }
export interface Catalog { mode: 'claude' | 'demo'; model: string; phase: number; teams: { id: Team; label: string }[]; agents: CatalogAgent[]; addons: AddonDef[] }

export interface Run {
  id: number; agent_id: string; slug?: string; name?: string; emoji?: string | null;
  trigger: string; status: 'ok' | 'skipped' | 'error'; summary: string;
  output: Record<string, unknown> | null; started_at: string; finished_at: string | null; by: string | null;
}

export interface Agent {
  id: string; slug: string; kind: Kind; team: Team; step: number;
  name: string; emoji: string | null; role: string;
  schedule: string; cron: string | null; runPrompt?: string; rules?: string[]; starters: string[];
  instructions: string;
  examples: { ask: string; answer: string }[];
  addons: { connections?: string[]; knowledge?: string[]; actions?: string[] };
  autonomy: 'propose' | 'auto';
  model: string; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  enabled: boolean; updated_at: string;
  last_run: Run | null;
}
export interface AgentPatch {
  instructions?: string; examples?: Agent['examples']; addons?: Agent['addons'];
  autonomy?: Agent['autonomy']; enabled?: boolean; effort?: Agent['effort'];
}
export interface Thread { id: string; title: string | null; created_at: string; messages: number }
export interface Message {
  id: number; role: 'user' | 'assistant'; content: string; mode: string | null; created_at: string;
  used: { knowledge?: string[]; actions?: string[]; corrections?: number; model?: string } | null;
  verdict?: string | null;
  /** client-only: a note the owner just attached */
  note?: string;
}
export interface Feedback { up: number; down: number; corrections: { note: string; created_at: string }[] }
export interface AgentPage { agent: Agent; threads: Thread[]; feedback: Feedback; runs: Run[] }
export interface ChatResult { thread_id: string; message_id: number; reply: string; mode: string; used: Message['used']; refused: boolean }

export const KIND_LABEL: Record<Kind, string> = { ai: 'AI', automation: 'อัตโนมัติ', human: 'คน' };

const BY = 'เจ้าของร้าน';

async function j<T>(r: Response): Promise<T> {
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body as T;
}
const post = (url: string, body: unknown, method = 'POST') =>
  fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const studioApi = {
  catalog: () => fetch('/api/studio/catalog').then((r) => j<Catalog>(r)),
  agents: (store: string) => fetch(`/api/stores/${store}/agents`).then((r) => j<Agent[]>(r)),
  runs: (store: string, limit = 50) => fetch(`/api/stores/${store}/runs?limit=${limit}`).then((r) => j<Run[]>(r)),
  agent: (store: string, slug: string) => fetch(`/api/stores/${store}/agents/${slug}`).then((r) => j<AgentPage>(r)),
  update: (store: string, slug: string, patch: AgentPatch) => post(`/api/stores/${store}/agents/${slug}`, { ...patch, by: BY }, 'PUT').then((r) => j<Agent>(r)),
  reset: (store: string, slug: string) => post(`/api/stores/${store}/agents/${slug}/reset`, { by: BY }).then((r) => j<Agent>(r)),
  run: (store: string, slug: string) => post(`/api/stores/${store}/agents/${slug}/run`, { by: BY }).then((r) => j<{ run: Run; agent: Agent }>(r)),
  thread: (store: string, slug: string, tid: string) => fetch(`/api/stores/${store}/agents/${slug}/threads/${tid}`).then((r) => j<{ messages: Message[] }>(r)),
  chat: (store: string, slug: string, message: string, thread_id?: string) =>
    post(`/api/stores/${store}/agents/${slug}/chat`, { message, thread_id, by: BY }).then((r) => j<ChatResult>(r)),
  feedback: (store: string, slug: string, message_id: number, verdict: 'up' | 'down', note?: string) =>
    post(`/api/stores/${store}/agents/${slug}/feedback`, { message_id, verdict, note, by: BY }).then((r) => j<{ id: number; corrections: number }>(r)),
};

/** Postgres prints "2026-09-16 05:12:03.1+00"; browsers want "2026-09-16T05:12:03.1+00:00". */
export const parseTs = (ts: string | null | undefined): Date | null => {
  if (!ts) return null;
  const d = new Date(ts.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
  return Number.isNaN(d.getTime()) ? null : d;
};
/** "12:05" from an ISO/pg timestamp, or "—". */
export const clock = (iso: string | null | undefined) => {
  const d = parseTs(iso);
  return d ? d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '—';
};
export const isToday = (iso: string | null | undefined) => {
  const d = parseTs(iso);
  return !!d && d.toDateString() === new Date().toDateString();
};
