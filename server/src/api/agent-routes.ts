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
    const by = (req.body as { by?: string } | null)?.by;
    const run = await runAgent(db, { storeId: id, slug, trigger: 'manual', by });
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
}
