/**
 * AI Studio endpoints.
 *
 * The screen is a gallery of assistants; each opens as a builder (teach on the
 * left, chat on the right). These routes are the whole surface that screen needs:
 * read the catalogue, read/edit one assistant, talk to it, and grade a reply.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { ADDONS, AGENTS } from '../ai/catalog.js';
import { addFeedback, chat, feedbackSummary, getAgent, getMessages, listAgents, listThreads, resetAgent, updateAgent } from '../ai/agents.js';
import { aiMode, DEFAULT_MODEL } from '../ai/llm.js';

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
    agents: AGENTS.map(({ slug, name, emoji, role, starters }) => ({ slug, name, emoji, role, starters })),
    addons: ADDONS.map((a) => ({ ...a, available: a.phase <= CURRENT_PHASE })),
  }));

  app.get('/api/stores/:id/agents', async (req) => {
    const { id } = req.params as { id: string };
    return listAgents(db, id);
  });

  app.get('/api/stores/:id/agents/:slug', async (req, reply) => {
    const { id, slug } = req.params as { id: string; slug: string };
    const agent = await getAgent(db, id, slug);
    if (!agent) return reply.code(404).send({ error: 'ไม่พบผู้ช่วยตัวนี้' });
    return { agent, threads: await listThreads(db, id, slug), feedback: await feedbackSummary(db, id, slug) };
  });

  app.put('/api/stores/:id/agents/:slug', async (req, reply) => {
    const { id, slug } = req.params as { id: string; slug: string };
    const body = patchSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'ข้อมูลไม่ถูกต้อง', issues: body.error.issues });
    const { by, ...patch } = body.data;
    const agent = await updateAgent(db, id, slug, patch, by);
    if (!agent) return reply.code(404).send({ error: 'ไม่พบผู้ช่วยตัวนี้' });
    return agent;
  });

  app.post('/api/stores/:id/agents/:slug/reset', async (req, reply) => {
    const { id, slug } = req.params as { id: string; slug: string };
    const by = (req.body as { by?: string } | null)?.by;
    const agent = await resetAgent(db, id, slug, by);
    if (!agent) return reply.code(404).send({ error: 'ไม่พบผู้ช่วยตัวนี้' });
    return agent;
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
      if (!res) return reply.code(404).send({ error: 'ไม่พบผู้ช่วยตัวนี้' });
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
}
