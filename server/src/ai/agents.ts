/**
 * Boxes as rows: defaults from the catalogue, edits from the owner,
 * conversations, corrections and runs alongside.
 *
 * Only the owner-editable fields live in the database. Kind, team, step,
 * schedule and rules come from the catalogue and are merged in on read, so a
 * catalogue change reaches every store without a migration.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client.js';
import { AGENTS, AGENT_BY_SLUG, ADDON_BY_ID, type AgentDef, type Autonomy } from './catalog.js';
import { knowledgeKeys, loadKnowledge } from './context.js';
import { activeDirectivesFor } from './trends.js';
import { answer, DEFAULT_MODEL, type Turn } from './llm.js';
import { buildSystemPrompt, describeInputs, type AgentConfig } from './prompt.js';

type Meta = Pick<AgentDef, 'kind' | 'team' | 'step' | 'schedule' | 'cron' | 'runPrompt' | 'rules' | 'starters'>;

export interface AgentRow extends AgentConfig, Meta {
  id: string;
  store_id: string;
  emoji: string | null;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  enabled: boolean;
  updated_by: string | null;
  updated_at: string;
  last_run: RunRow | null;
}

export interface RunRow {
  id: number; agent_id: string; trigger: string; status: 'ok' | 'skipped' | 'error';
  summary: string; output: Record<string, unknown> | null; started_at: string; finished_at: string | null; by: string | null;
}

export interface AgentPatch {
  instructions?: string;
  examples?: { ask: string; answer: string }[];
  addons?: { connections?: string[]; knowledge?: string[]; actions?: string[] };
  autonomy?: Autonomy;
  enabled?: boolean;
  effort?: AgentRow['effort'];
  model?: string;
}

const agentId = (storeId: string, slug: string) => `${storeId}-${slug}`;
const metaOf = (slug: string): Meta => {
  const d = AGENT_BY_SLUG[slug];
  return { kind: d.kind, team: d.team, step: d.step, schedule: d.schedule, cron: d.cron, runPrompt: d.runPrompt, rules: d.rules, starters: d.starters };
};

/**
 * Every store gets every catalogue box; existing rows are left alone. Boxes that
 * left the catalogue (the chat assistants, for instance) are removed with their
 * history, so the screen never shows a box the product no longer has.
 */
export async function ensureAgents(db: Db, storeId: string): Promise<void> {
  for (const a of AGENTS) {
    await db.query(
      `insert into agent(id, store_id, slug, name, emoji, role, instructions, examples, addons, autonomy, model, effort)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (id) do nothing`,
      [agentId(storeId, a.slug), storeId, a.slug, a.name, a.emoji, a.role, a.instructions,
        JSON.stringify(a.examples), JSON.stringify({ connections: [], ...a.addons }), a.autonomy, DEFAULT_MODEL, a.effort]);
  }
  const slugs = AGENTS.map((a) => a.slug);
  const stale = await db.query<{ id: string }>('select id from agent where store_id=$1 and not (slug = any($2))', [storeId, slugs]);
  for (const { id } of stale) {
    await db.query('delete from agent_feedback where agent_id=$1', [id]);
    await db.query('delete from agent_message where thread_id in (select id from agent_thread where agent_id=$1)', [id]);
    await db.query('delete from agent_thread where agent_id=$1', [id]);
    await db.query('delete from agent_run where agent_id=$1', [id]);
    await db.query('delete from agent where id=$1', [id]);
  }
}

const COLS = 'id, store_id, slug, name, emoji, role, instructions, examples, addons, autonomy, model, effort, enabled, updated_by, updated_at::text';

async function lastRuns(db: Db, storeId: string): Promise<Map<string, RunRow>> {
  const rows = await db.query<RunRow>(
    `select distinct on (agent_id) id, agent_id, trigger, status, summary, output, started_at::text, finished_at::text, by
       from agent_run where store_id=$1 order by agent_id, id desc`, [storeId]);
  return new Map(rows.map((r) => [r.agent_id, r]));
}

export async function listAgents(db: Db, storeId: string): Promise<AgentRow[]> {
  await ensureAgents(db, storeId);
  const rows = await db.query<Omit<AgentRow, keyof Meta | 'last_run'>>(`select ${COLS} from agent where store_id=$1`, [storeId]);
  const runs = await lastRuns(db, storeId);
  return rows
    .map((r) => ({ ...r, ...metaOf(r.slug), last_run: runs.get(r.id) ?? null }))
    .sort((a, b) => a.step - b.step);
}

export async function getAgent(db: Db, storeId: string, slug: string): Promise<AgentRow | null> {
  if (!AGENT_BY_SLUG[slug]) return null;
  await ensureAgents(db, storeId);
  const rows = await db.query<Omit<AgentRow, keyof Meta | 'last_run'>>(`select ${COLS} from agent where id=$1`, [agentId(storeId, slug)]);
  if (!rows[0]) return null;
  const runs = await lastRuns(db, storeId);
  return { ...rows[0], ...metaOf(slug), last_run: runs.get(rows[0].id) ?? null };
}

export async function updateAgent(db: Db, storeId: string, slug: string, patch: AgentPatch, by?: string): Promise<AgentRow | null> {
  const cur = await getAgent(db, storeId, slug);
  if (!cur) return null;
  // Unknown add-on ids are dropped rather than stored, so the catalogue stays the source of truth.
  const addons = patch.addons ? {
    connections: patch.addons.connections ?? cur.addons.connections ?? [],
    knowledge: (patch.addons.knowledge ?? cur.addons.knowledge ?? []).filter((k) => ADDON_BY_ID[k]?.kind === 'knowledge'),
    actions: (patch.addons.actions ?? cur.addons.actions ?? []).filter((k) => ADDON_BY_ID[k]?.kind === 'action'),
  } : cur.addons;
  await db.query(
    `update agent set instructions=$2, examples=$3, addons=$4, autonomy=$5, enabled=$6, effort=$7, model=$8, updated_by=$9, updated_at=now() where id=$1`,
    [cur.id, patch.instructions ?? cur.instructions, JSON.stringify(patch.examples ?? cur.examples), JSON.stringify(addons),
      patch.autonomy ?? cur.autonomy, patch.enabled ?? cur.enabled, patch.effort ?? cur.effort, patch.model ?? cur.model, by ?? null]);
  await db.query(
    `insert into audit_log(store_id, actor, actor_type, action, target, before, after) values ($1,$2,'human','agent.update',$3,$4,$5)`,
    [storeId, by ?? 'unknown', cur.id, JSON.stringify({ instructions: cur.instructions, addons: cur.addons, autonomy: cur.autonomy, enabled: cur.enabled }),
      JSON.stringify({ instructions: patch.instructions ?? cur.instructions, addons, autonomy: patch.autonomy ?? cur.autonomy, enabled: patch.enabled ?? cur.enabled })]);
  return getAgent(db, storeId, slug);
}

export async function resetAgent(db: Db, storeId: string, slug: string, by?: string): Promise<AgentRow | null> {
  const def = AGENT_BY_SLUG[slug];
  if (!def) return null;
  await ensureAgents(db, storeId);
  await db.query(
    `update agent set instructions=$2, examples=$3, addons=$4, autonomy=$5, effort=$6, updated_by=$7, updated_at=now() where id=$1`,
    [agentId(storeId, slug), def.instructions, JSON.stringify(def.examples), JSON.stringify({ connections: [], ...def.addons }), def.autonomy, def.effort, by ?? null]);
  return getAgent(db, storeId, slug);
}

/* ---------------- runs ---------------- */

export async function recordRun(db: Db, o: {
  storeId: string; slug: string; trigger: 'schedule' | 'manual' | 'event'; status: RunRow['status'];
  summary: string; output?: Record<string, unknown>; by?: string; startedAt?: Date;
}): Promise<RunRow> {
  const rows = await db.query<RunRow>(
    `insert into agent_run(agent_id, store_id, trigger, status, summary, output, started_at, finished_at, by)
     values ($1,$2,$3,$4,$5,$6,$7,now(),$8)
     returning id, agent_id, trigger, status, summary, output, started_at::text, finished_at::text, by`,
    [agentId(o.storeId, o.slug), o.storeId, o.trigger, o.status, o.summary, o.output ? JSON.stringify(o.output) : null, o.startedAt ?? new Date(), o.by ?? null]);
  return rows[0];
}

export async function listRuns(db: Db, storeId: string, o: { slug?: string; limit?: number } = {}): Promise<(RunRow & { slug: string; name: string; emoji: string | null })[]> {
  return db.query(
    `select r.id, r.agent_id, a.slug, a.name, a.emoji, r.trigger, r.status, r.summary, r.output, r.started_at::text, r.finished_at::text, r.by
       from agent_run r join agent a on a.id = r.agent_id
      where r.store_id=$1 and ($2::text is null or a.slug=$2)
      order by r.id desc limit $3`, [storeId, o.slug ?? null, o.limit ?? 50]);
}

/* ---------------- conversations ---------------- */

export interface MessageRow { id: number; thread_id: string; role: 'user' | 'assistant'; content: string; used: Record<string, unknown> | null; mode: string | null; created_at: string; verdict?: string | null }

export async function listThreads(db: Db, storeId: string, slug: string) {
  return db.query<{ id: string; title: string | null; created_at: string; messages: number }>(
    `select t.id, t.title, t.created_at::text, count(m.id)::int as messages
       from agent_thread t left join agent_message m on m.thread_id = t.id
      where t.agent_id=$1 group by t.id order by t.created_at desc limit 20`, [agentId(storeId, slug)]);
}

export async function getMessages(db: Db, threadId: string): Promise<MessageRow[]> {
  return db.query<MessageRow>(
    `select m.id, m.thread_id, m.role, m.content, m.used, m.mode, m.created_at::text,
            (select verdict from agent_feedback f where f.message_id = m.id order by f.id desc limit 1) as verdict
       from agent_message m where m.thread_id=$1 order by m.id`, [threadId]);
}

async function corrections(db: Db, agentIdValue: string) {
  return db.query<{ note: string; created_at: string }>(
    `select note, created_at::text from agent_feedback where agent_id=$1 and verdict='down' and note is not null and note <> '' order by id`, [agentIdValue]);
}

export interface ChatResult {
  thread_id: string; message_id: number; reply: string; mode: 'claude' | 'demo';
  used: Record<string, unknown>; refused: boolean;
}

export async function chat(db: Db, o: { storeId: string; slug: string; threadId?: string; message: string; by?: string }): Promise<ChatResult | { error: string } | null> {
  const agent = await getAgent(db, o.storeId, o.slug);
  if (!agent) return null;
  if (agent.kind !== 'ai') return { error: `${agent.name} ไม่ใช่กล่อง AI — ทำงานตามกฎ ไม่มีแชท` };
  const store = (await db.query<{ name: string }>('select name from store where id=$1', [o.storeId]))[0] ?? { name: o.storeId };

  let threadId = o.threadId;
  if (threadId) {
    const t = await db.query<{ id: string }>('select id from agent_thread where id=$1 and agent_id=$2', [threadId, agent.id]);
    if (!t.length) threadId = undefined;
  }
  if (!threadId) {
    threadId = randomUUID();
    await db.query('insert into agent_thread(id, agent_id, store_id, title) values ($1,$2,$3,$4)', [threadId, agent.id, o.storeId, o.message.slice(0, 60)]);
  }

  const fixes = await corrections(db, agent.id);
  const knowledge = await loadKnowledge(db, o.storeId, agent.addons.knowledge ?? []);
  knowledge.directives = await activeDirectivesFor(db, o.storeId, o.slug);
  const system = buildSystemPrompt(agent, store, knowledge, fixes);
  const history: Turn[] = (await getMessages(db, threadId)).slice(-20).map((m) => ({ role: m.role, content: m.content }));

  const result = await answer({ agent, system, knowledge, history, message: o.message });
  const used = { ...describeInputs(agent, knowledge, fixes), knowledge: knowledgeKeys(knowledge), mode: result.mode, model: result.mode === 'claude' ? agent.model : 'demo' };

  await db.query(`insert into agent_message(thread_id, role, content, mode) values ($1,'user',$2,$3)`, [threadId, o.message, result.mode]);
  const saved = await db.query<{ id: number }>(
    `insert into agent_message(thread_id, role, content, used, mode, tokens_in, tokens_out) values ($1,'assistant',$2,$3,$4,$5,$6) returning id`,
    [threadId, result.text, JSON.stringify(used), result.mode, result.tokensIn ?? null, result.tokensOut ?? null]);

  return { thread_id: threadId, message_id: saved[0].id, reply: result.text, mode: result.mode, used, refused: result.refused ?? false };
}

export async function addFeedback(db: Db, o: { storeId: string; slug: string; messageId: number; verdict: 'up' | 'down'; note?: string; by?: string }) {
  const id = agentId(o.storeId, o.slug);
  const owned = await db.query<{ id: number }>(
    'select m.id from agent_message m join agent_thread t on t.id = m.thread_id where m.id=$1 and t.agent_id=$2', [o.messageId, id]);
  if (!owned.length) return null;
  const rows = await db.query<{ id: number }>(
    `insert into agent_feedback(agent_id, message_id, verdict, note, created_by) values ($1,$2,$3,$4,$5) returning id`,
    [id, o.messageId, o.verdict, o.note?.trim() || null, o.by ?? null]);
  const learned = (await corrections(db, id)).length;
  return { id: rows[0].id, corrections: learned };
}

export async function feedbackSummary(db: Db, storeId: string, slug: string) {
  const rows = await db.query<{ verdict: string; n: number }>(
    'select verdict, count(*)::int as n from agent_feedback where agent_id=$1 group by verdict', [agentId(storeId, slug)]);
  const notes = await corrections(db, agentId(storeId, slug));
  return {
    up: rows.find((r) => r.verdict === 'up')?.n ?? 0,
    down: rows.find((r) => r.verdict === 'down')?.n ?? 0,
    corrections: notes,
  };
}
