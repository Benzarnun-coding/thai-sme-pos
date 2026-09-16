import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, resetDb, type Db } from '../src/db/client.js';
import { seed } from '../src/seed.js';
import { buildServer } from '../src/api/server.js';
import { AGENTS, ADDONS } from '../src/ai/catalog.js';
import { buildSystemPrompt } from '../src/ai/prompt.js';
import { loadKnowledge } from '../src/ai/context.js';
import { demoReply } from '../src/ai/demo-brain.js';

describe('AI Studio', () => {
  let db: Db;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOOPDESK_AI = 'demo';
    delete process.env.ANTHROPIC_API_KEY;
    await resetDb(); db = await getDb();
    await seed(db, 'climax', { sales: true, facebookDemo: true });
    app = buildServer(db); await app.ready();
  });
  afterAll(async () => { await app.close(); await resetDb(); delete process.env.LOOPDESK_AI; });

  it('seeds the six default assistants for a store', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/stores/climax/agents' });
    const agents = r.json() as { slug: string; name: string; addons: { knowledge: string[] } }[];
    expect(agents.map((a) => a.slug)).toEqual(AGENTS.map((a) => a.slug));
    expect(agents[1].addons.knowledge).toContain('voice');
  });

  it('exposes the catalogue with phase gating', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/studio/catalog' });
    const c = r.json() as { mode: string; addons: { id: string; available: boolean; phase: number }[] };
    expect(c.mode).toBe('demo');
    expect(c.addons.find((a) => a.id === 'signals')?.available).toBe(true);
    expect(c.addons.find((a) => a.id === 'reply_chat')?.available).toBe(false);
    expect(c.addons.length).toBe(ADDONS.length);
  });

  it('assembles the owner teaching and only the ticked knowledge into the prompt', async () => {
    const k = await loadKnowledge(db, 'climax', ['voice', 'signals']);
    expect(Object.keys(k.brand)).toEqual(['voice']);
    expect(k.ads).toBeUndefined();
    const sys = buildSystemPrompt(
      { slug: 'copywriter', name: 'นักเขียน', role: 'เขียนโพสต์', instructions: 'ห้ามใช้คำว่า ถูกที่สุด', examples: [], addons: { knowledge: ['voice', 'signals'], actions: ['draft_post'] }, autonomy: 'propose' },
      { name: 'Climax' }, k, [{ note: 'ราคาเซ็ตต้องมาก่อนราคาเดี่ยว' }]);
    expect(sys).toContain('ห้ามใช้คำว่า ถูกที่สุด');
    expect(sys).toContain('ราคาเซ็ตต้องมาก่อนราคาเดี่ยว');
    expect(sys).toContain('เสียงของแบรนด์');
    expect(sys).toContain('ยีนส์ทรงกระบอกเล็ก');
    expect(sys).not.toContain('ผลแอดล่าสุด');
    // the identity comes before the data, so the cached prefix survives a stock change
    expect(sys.indexOf('สิ่งที่เจ้าของร้านสอนไว้')).toBeLessThan(sys.indexOf('สินค้า สต็อก และยอดขาย'));
  });

  it('the demo brain never advertises a product that is missing core sizes', async () => {
    const k = await loadKnowledge(db, 'climax', ['signals', 'usp', 'forbidden']);
    const blocked = k.signals!.find((s) => !s.promotable)!;
    const agent = { slug: 'copywriter', name: 'นักเขียน', instructions: '', autonomy: 'propose' as const, addons: {} };
    const reply = demoReply(agent, k, `เขียนโพสต์ ${blocked.name}`);
    expect(reply).toContain(blocked.note);
    expect(reply).toContain('ยังไม่ควรโพสต์ขาย');
  });

  it('the demo QA catches forbidden words and wrong prices', async () => {
    const k = await loadKnowledge(db, 'climax', ['signals', 'forbidden']);
    const agent = { slug: 'qa', name: 'ผู้ตรวจ', instructions: '', autonomy: 'auto' as const, addons: {} };
    const bad = demoReply(agent, k, 'ตรวจโพสต์: ยีนส์ทรงกระบอกเล็ก สีดำ ของแท้ 100% ราคา 159.- ถูกที่สุดในไทย');
    expect(bad).toContain('ไม่ผ่าน');
    expect(bad).toContain('ของแท้ 100%');
    expect(bad).toContain('159');
    const good = demoReply(agent, k, 'ตรวจโพสต์: ยีนส์ทรงกระบอกเล็ก สีดำ 199.- เซ็ต 3 ตัว 550.- ไซส์ 28-44 เก็บเงินปลายทาง ทักแชทสั่งได้เลย');
    expect(good).toContain('ผ่าน ✅');
  });

  it('walks teach → chat → correct → the correction reaches the next prompt', async () => {
    // 1. teach by typing
    const put = await app.inject({ method: 'PUT', url: '/api/stores/climax/agents/chat',
      payload: { instructions: 'ลงท้ายด้วย ค่ะ เสมอ', addons: { knowledge: ['sizes', 'signals'], actions: ['reply_chat', 'not-a-real-addon'] }, by: 'เบนซ์' } });
    expect(put.statusCode).toBe(200);
    const agent = put.json() as { instructions: string; addons: { actions: string[]; knowledge: string[] } };
    expect(agent.instructions).toBe('ลงท้ายด้วย ค่ะ เสมอ');
    expect(agent.addons.actions).toEqual(['reply_chat']);   // unknown add-on dropped

    // 2. chat — demo mode, polite particle follows the teaching
    const c1 = await app.inject({ method: 'POST', url: '/api/stores/climax/agents/chat/chat', payload: { message: 'สูง 175 หนัก 70 ใส่ไซส์ไหน', by: 'เบนซ์' } });
    expect(c1.statusCode).toBe(200);
    const r1 = c1.json() as { thread_id: string; message_id: number; reply: string; mode: string; used: { knowledge: string[]; corrections: number } };
    expect(r1.mode).toBe('demo');
    expect(r1.reply).toContain('ไซส์ 34');
    expect(r1.reply).toContain('ค่ะ');
    expect(r1.used.knowledge).toEqual(expect.arrayContaining(['sizes', 'signals']));
    expect(r1.used.corrections).toBe(0);

    // 3. correct with 👎 + a note
    const fb = await app.inject({ method: 'POST', url: '/api/stores/climax/agents/chat/feedback',
      payload: { message_id: r1.message_id, verdict: 'down', note: 'อย่าถามซ้ำว่าสนใจทรงไหน ถ้าลูกค้าบอกทรงมาแล้ว', by: 'เบนซ์' } });
    expect(fb.statusCode).toBe(200);
    expect((fb.json() as { corrections: number }).corrections).toBe(1);

    // 4. the next turn in the same thread sees the correction
    const c2 = await app.inject({ method: 'POST', url: '/api/stores/climax/agents/chat/chat', payload: { thread_id: r1.thread_id, message: 'เก็บเงินปลายทางได้ไหม' } });
    const r2 = c2.json() as { thread_id: string; used: { corrections: number } };
    expect(r2.thread_id).toBe(r1.thread_id);
    expect(r2.used.corrections).toBe(1);

    // 5. the thread reads back with the verdict attached
    const t = await app.inject({ method: 'GET', url: `/api/stores/climax/agents/chat/threads/${r1.thread_id}` });
    const msgs = (t.json() as { messages: { role: string; verdict: string | null }[] }).messages;
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(msgs[1].verdict).toBe('down');

    // 6. the agent page shows the correction as something it learned
    const page = await app.inject({ method: 'GET', url: '/api/stores/climax/agents/chat' });
    const body = page.json() as { feedback: { down: number; corrections: { note: string }[] }; threads: { id: string }[] };
    expect(body.feedback.down).toBe(1);
    expect(body.feedback.corrections[0].note).toContain('อย่าถามซ้ำ');
    expect(body.threads[0].id).toBe(r1.thread_id);
  });

  it('refuses feedback on a message that belongs to another assistant', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/stores/climax/agents/qa/chat', payload: { message: 'คำไหนใช้ไม่ได้บ้าง' } });
    const { message_id } = c.json() as { message_id: number };
    const r = await app.inject({ method: 'POST', url: '/api/stores/climax/agents/copywriter/feedback', payload: { message_id, verdict: 'up' } });
    expect(r.statusCode).toBe(404);
  });

  it('reset puts the catalogue defaults back', async () => {
    await app.inject({ method: 'PUT', url: '/api/stores/climax/agents/strategist', payload: { instructions: 'x', autonomy: 'auto' } });
    const r = await app.inject({ method: 'POST', url: '/api/stores/climax/agents/strategist/reset', payload: {} });
    const a = r.json() as { instructions: string; autonomy: string };
    expect(a.autonomy).toBe('propose');
    expect(a.instructions).toBe(AGENTS[0].instructions);
  });

  it('every assistant answers its own starter questions in demo mode', async () => {
    for (const def of AGENTS) {
      for (const q of def.starters) {
        const r = await app.inject({ method: 'POST', url: `/api/stores/climax/agents/${def.slug}/chat`, payload: { message: q } });
        expect(r.statusCode, `${def.slug}: ${q}`).toBe(200);
        expect((r.json() as { reply: string }).reply.length, `${def.slug}: ${q}`).toBeGreaterThan(20);
      }
    }
  });
});
