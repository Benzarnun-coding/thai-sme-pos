/**
 * Back-office endpoints.
 *
 * The screen is the whole loop as boxes; each opens as a page (teach + chat for
 * AI boxes, rules + runs for the rest). These routes are the surface that screen
 * needs: the catalogue, read/edit one box, run it, talk to it, grade a reply.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { ADDONS, AGENTS, TEAM_LABEL, TEAM_ORDER } from '../ai/catalog.js';
import { addFeedback, chat, feedbackSummary, getAgent, getMessages, listAgents, listRuns, listThreads, resetAgent, updateAgent } from '../ai/agents.js';
import { runAgent } from '../ai/jobs.js';
import { aiMode, DEFAULT_MODEL } from '../ai/llm.js';
import { buildTrends, createDirective, listDirectives, runDirective, setDirectiveStatus } from '../ai/trends.js';
import { getWork, ledger, listWork, monthSpend, todaySpend, updateWork } from '../ai/work.js';
import { decide, KIND_LABEL as WORK_KIND_LABEL, STATUS_LABEL as WORK_STATUS_LABEL, type WorkStatus } from '../ai/handoff.js';
import { schedulerStatus } from '../jobs/scheduler.js';
import { setAiCap, usageReport } from '../ai/usage.js';
import { lineConfigured } from '../connectors/line.js';

const CURRENT_PHASE = Number(process.env.LOOPDESK_PHASE ?? 1);

const patchSchema = z.object({
  instructions: z.string().max(8000).optional(),
  examples: z.array(z.object({ ask: z.string().max(2000), answer: z.string().max(4000) })).max(20).optional(),
  addons: z.object({
    connections: z.array(z.string()).optional(),
    knowledge: z.array(z.string()).optional(),
    actions: z.array(z.string()).optional(),
  }).optional(),
  autonomy: z.enum(['propose', 'auto']).optional(),
  enabled: z.boolean().optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  model: z.string().max(80).optional(),
  by: z.string().max(120).optional(),
});

export function registerAgentRoutes(app: FastifyInstance, db: Db) {
  /** What exists and how the AI is running (Claude or demo). */
  app.get('/api/studio/catalog', async () => ({
    mode: aiMode(),
    model: DEFAULT_MODEL,
    phase: CURRENT_PHASE,
    line: lineConfigured(),
    teams: TEAM_ORDER.map((id) => ({ id, label: TEAM_LABEL[id] })),
    agents: AGENTS.map(({ slug, kind, team, step, name, emoji, role, schedule, starters, rules }) => ({ slug, kind, team, step, name, emoji, role, schedule, starters, rules })),
    addons: ADDONS.map((a) => ({ ...a, available: a.phase <= CURRENT_PHASE })),
  }));

  app.get('/api/stores/:id/agents', async (req) => {
    const { id } = req.params as { id: string };
    return listAgents(db, id);
  });

  /** Runs across every box, newest first — the "what the system did" timeline. */
  app.get('/api/stores/:id/runs', async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { slug?: string; limit?: string };
    return listRuns(db, id, { slug: q.slug, limit: q.limit ? Math.min(200, Number(q.limit)) : 50 });
  });

  app.get('/api/stores/:id/agents/:slug', async (req, reply) => {
    const { id, slug } = req.params as { id: string; slug: string };
    const agent = await getAgent(db, id, slug);
    if (!agent) return reply.code(404).send({ error: 'ไม่พบกล่องนี้' });
    return {
      agent,
      threads: agent.kind === 'ai' ? await listThreads(db, id, slug) : [],
      feedback: agent.kind === 'ai' ? await feedbackSummary(db, id, slug) : { up: 0, down: 0, corrections: [] },
      runs: await listRuns(db, id, { slug, limit: 10 }),
    };
  });

  app.put('/api/stores/:id/agents/:slug', async (req, reply) => {
    const { id, slug } = req.params as { id: string; slug: string };
    const body = patchSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'ข้อมูลไม่ถูกต้อง', issues: body.error.issues });
    const { by, ...patch } = body.data;
    const agent = await updateAgent(db, id, slug, patch, by);
    if (!agent) return reply.code(404).send({ error: 'ไม่พบกล่องนี้' });
    return agent;
  });

  app.post('/api/stores/:id/agents/:slug/reset', async (req, reply) => {
    const { id, slug } = req.params as { id: string; slug: string };
    const by = (req.body as { by?: string } | null)?.by;
    const agent = await resetAgent(db, id, slug, by);
    if (!agent) return reply.code(404).send({ error: 'ไม่พบกล่องนี้' });
    return agent;
  });

  /** Run a box now, as the scheduler would. */
  app.post('/api/stores/:id/agents/:slug/run', async (req, reply) => {
    const { id, slug } = req.params as { id: string; slug: string };
    const body = (req.body as { by?: string; chain?: boolean } | null) ?? {};
    const run = await runAgent(db, { storeId: id, slug, trigger: 'manual', by: body.by, chain: body.chain !== false });
    if (!run) return reply.code(404).send({ error: 'ไม่พบกล่องนี้' });
    return { run, agent: await getAgent(db, id, slug) };
  });

  app.get('/api/stores/:id/agents/:slug/threads/:tid', async (req, reply) => {
    const { id, slug, tid } = req.params as { id: string; slug: string; tid: string };
    const owned = await db.query<{ id: string }>('select id from agent_thread where id=$1 and agent_id=$2', [tid, `${id}-${slug}`]);
    if (!owned.length) return reply.code(404).send({ error: 'ไม่พบบทสนทนานี้' });
    return { thread_id: tid, messages: await getMessages(db, tid) };
  });

  app.post('/api/stores/:id/agents/:slug/chat', async (req, reply) => {
    const { id, slug } = req.params as { id: string; slug: string };
    const body = z.object({ message: z.string().min(1).max(4000), thread_id: z.string().optional(), by: z.string().max(120).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'ต้องมีข้อความ' });
    try {
      const res = await chat(db, { storeId: id, slug, threadId: body.data.thread_id, message: body.data.message, by: body.data.by });
      if (!res) return reply.code(404).send({ error: 'ไม่พบกล่องนี้' });
      if ('error' in res) return reply.code(400).send({ error: res.error });
      return res;
    } catch (e) {
      req.log.error(e);
      return reply.code(502).send({ error: `ผู้ช่วยตอบไม่ได้ตอนนี้: ${(e as Error).message}` });
    }
  });

  app.post('/api/stores/:id/agents/:slug/feedback', async (req, reply) => {
    const { id, slug } = req.params as { id: string; slug: string };
    const body = z.object({ message_id: z.number().int(), verdict: z.enum(['up', 'down']), note: z.string().max(2000).optional(), by: z.string().max(120).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'ต้องระบุ message_id และ verdict' });
    const res = await addFeedback(db, { storeId: id, slug, messageId: body.data.message_id, verdict: body.data.verdict, note: body.data.note, by: body.data.by });
    if (!res) return reply.code(404).send({ error: 'ไม่พบข้อความนี้' });
    return res;
  });

  /* ---------- Trends → directives ---------- */

  /** What is happening now, each with a ready-to-send Thai instruction. */
  app.get('/api/stores/:id/trends', async (req) => {
    const { id } = req.params as { id: string };
    return { trends: await buildTrends(db, id), directives: await listDirectives(db, id, 'active') };
  });

  app.get('/api/stores/:id/directives', async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { status?: 'active' | 'done' | 'archived' };
    return listDirectives(db, id, q.status);
  });

  app.post('/api/stores/:id/directives', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      title: z.string().min(1).max(120), text: z.string().min(1).max(2000),
      source: z.enum(['trend', 'competitor', 'season', 'post', 'manual']).optional(),
      targets: z.array(z.string()).min(1).max(10), days: z.number().int().min(1).max(90).optional(), by: z.string().max(120).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'ต้องมีหัวข้อ ข้อความ และกล่องที่จะสั่งอย่างน้อย 1 กล่อง' });
    const d = await createDirective(db, { storeId: id, ...body.data });
    if (!d.targets.length) return reply.code(400).send({ error: 'สั่งได้เฉพาะกล่อง AI' });
    return d;
  });

  app.patch('/api/stores/:id/directives/:did', async (req, reply) => {
    const { id, did } = req.params as { id: string; did: string };
    const body = z.object({ status: z.enum(['active', 'done', 'archived']) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'ต้องระบุสถานะ' });
    const d = await setDirectiveStatus(db, id, Number(did), body.data.status);
    if (!d) return reply.code(404).send({ error: 'ไม่พบคำสั่งนี้' });
    return d;
  });

  /** Run every targeted box now, in loop order. */
  app.post('/api/stores/:id/directives/:did/run', async (req, reply) => {
    const { id, did } = req.params as { id: string; did: string };
    const by = (req.body as { by?: string } | null)?.by;
    const res = await runDirective(db, id, Number(did), by);
    if (!res) return reply.code(404).send({ error: 'ไม่พบคำสั่งนี้' });
    return res;
  });

  /* ---------- Token meter ---------- */
  app.get('/api/stores/:id/usage', async (req) => usageReport(db, (req.params as { id: string }).id));
  app.put('/api/stores/:id/settings/ai-cap', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ cap_thb: z.number().min(0).max(10_000_000).nullable() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'ต้องระบุ cap_thb เป็นตัวเลข หรือ null' });
    return { cap_thb: await setAiCap(db, id, body.data.cap_thb && body.data.cap_thb > 0 ? body.data.cap_thb : null) };
  });

  /* ---------- Work items: what moves between boxes, and the approval queue ---------- */

  app.get('/api/studio/scheduler', async () => schedulerStatus());

  app.get('/api/stores/:id/work', async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { status?: string; kind?: string; to?: string; limit?: string };
    const status = q.status ? (q.status.split(',') as WorkStatus[]) : undefined;
    const items = await listWork(db, id, { status, kind: q.kind, to: q.to, limit: q.limit ? Math.min(500, Number(q.limit)) : 200 });
    return { items, labels: { kind: WORK_KIND_LABEL, status: WORK_STATUS_LABEL } };
  });

  /** The owner decides on a pending item. Approving a post or ad plan runs the publisher right away. */
  app.post('/api/stores/:id/work/:wid/decide', async (req, reply) => {
    const { id, wid } = req.params as { id: string; wid: string };
    const body = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().max(1000).optional(), by: z.string().max(120).optional(), publish_at: z.string().datetime({ offset: true }).nullable().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'ต้องระบุ approve หรือ reject (publish_at ถ้ามีต้องเป็นเวลา ISO)' });
    const item = await getWork(db, id, Number(wid));
    if (!item) return reply.code(404).send({ error: 'ไม่พบงานนี้' });
    const patch = decide(item, body.data.decision, body.data.note, body.data.publish_at ?? null);
    if (!patch) return reply.code(409).send({ error: `งานนี้${WORK_STATUS_LABEL[item.status]}แล้ว ตัดสินซ้ำไม่ได้` });
    const updated = await updateWork(db, id, item.id, { ...patch, decided_by: body.data.by ?? null, decided_at: new Date().toISOString() });
    await db.query(`insert into audit_log(store_id, actor, actor_type, action, target, before, after) values ($1,$2,'human',$3,$4,$5,$6)`,
      [id, body.data.by ?? 'unknown', `work.${body.data.decision}`, String(item.id), JSON.stringify({ status: item.status }), JSON.stringify({ status: updated?.status, note: body.data.note ?? null })]);
    const dueNow = updated?.to_slug === 'publisher' && (!updated.publish_at || new Date(updated.publish_at).getTime() <= Date.now());
    const run = dueNow ? await runAgent(db, { storeId: id, slug: 'publisher', trigger: 'event', by: body.data.by }) : null;
    return { item: run ? await getWork(db, id, item.id) : updated, run };
  });

  /** The money side: caps, today's and this month's spend, and the ledger. */
  app.get('/api/stores/:id/budget', async (req) => {
    const { id } = req.params as { id: string };
    const store = await db.query<{ settings: { dailyCap?: number; monthlyCap?: number } | null }>('select settings from store where id=$1', [id]);
    const [today, month, rows] = await Promise.all([todaySpend(db, id), monthSpend(db, id), ledger(db, id, 30)]);
    return { daily_cap: store[0]?.settings?.dailyCap ?? null, monthly_cap: store[0]?.settings?.monthlyCap ?? null, today, month_total: month, ledger: rows };
  });
}
