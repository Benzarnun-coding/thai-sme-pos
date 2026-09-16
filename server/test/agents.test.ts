import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, resetDb, type Db } from '../src/db/client.js';
import { seed } from '../src/seed.js';
import { buildServer } from '../src/api/server.js';
import { AGENTS, ADDONS, AI_AGENTS } from '../src/ai/catalog.js';
import { buildSystemPrompt } from '../src/ai/prompt.js';
import { loadKnowledge } from '../src/ai/context.js';
import { demoReply } from '../src/ai/demo-brain.js';

describe('Back office (AI Studio)', () => {
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

  it('seeds every box in loop order, with kind, team and schedule merged in', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/stores/climax/agents' });
    const agents = r.json() as { slug: string; kind: string; team: string; step: number; schedule: string; last_run: unknown }[];
    expect(agents.map((a) => a.slug)).toEqual(AGENTS.map((a) => a.slug));
    expect(agents.map((a) => a.step)).toEqual([...agents.map((a) => a.step)].sort((x, y) => x - y));
    expect(agents.find((a) => a.slug === 'sense')).toMatchObject({ kind: 'automation', team: 'sense', schedule: 'ทุก 6 ชั่วโมง', last_run: null });
    expect(agents.find((a) => a.slug === 'approval')?.kind).toBe('human');
    expect(agents.filter((a) => a.kind === 'ai').length).toBe(AI_AGENTS.length);
    // chat is out of scope: no chat assistants, no messaging add-ons
    expect(agents.some((a) => a.slug === 'chat' || a.slug === 'wholesale')).toBe(false);
    expect(ADDONS.some((a) => a.id === 'reply_chat' || a.id === 'open_order')).toBe(false);
  });

  it('removes boxes that left the catalogue, with their history', async () => {
    await db.query(`insert into agent(id, store_id, slug, name, role) values ('climax-chat','climax','chat','แอดมินแชท','x')`);
    await db.query(`insert into agent_thread(id, agent_id, store_id) values ('t-old','climax-chat','climax')`);
    await db.query(`insert into agent_message(thread_id, role, content) values ('t-old','user','hi')`);
    const r = await app.inject({ method: 'GET', url: '/api/stores/climax/agents' });
    expect((r.json() as { slug: string }[]).some((a) => a.slug === 'chat')).toBe(false);
    expect((await db.query('select 1 from agent where id=$1', ['climax-chat'])).length).toBe(0);
    expect((await db.query('select 1 from agent_thread where id=$1', ['t-old'])).length).toBe(0);
  });

  it('exposes the catalogue with teams and phase gating', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/studio/catalog' });
    const c = r.json() as { mode: string; teams: { id: string; label: string }[]; addons: { id: string; available: boolean }[] };
    expect(c.mode).toBe('demo');
    expect(c.teams.map((t) => t.id)).toEqual(['sense', 'content', 'approve', 'ads', 'learn']);
    expect(c.addons.find((a) => a.id === 'competitors')?.available).toBe(true);
    expect(c.addons.find((a) => a.id === 'create_ad')?.available).toBe(false);
  });

  it('assembles the owner teaching and only the ticked knowledge into the prompt', async () => {
    const k = await loadKnowledge(db, 'climax', ['voice', 'signals', 'competitors']);
    expect(Object.keys(k.brand)).toEqual(['voice']);
    expect(k.ads).toBeUndefined();
    expect(k.competitors!.length).toBeGreaterThan(3);
    const sys = buildSystemPrompt(
      { slug: 'copywriter', name: 'นักเขียน', role: 'เขียนโพสต์', instructions: 'ห้ามใช้คำว่า ถูกที่สุด', examples: [], addons: { knowledge: ['voice', 'signals', 'competitors'], actions: ['draft_post'] }, autonomy: 'propose' },
      { name: 'Climax' }, k, [{ note: 'ราคาเซ็ตต้องมาก่อนราคาเดี่ยว' }]);
    expect(sys).toContain('ห้ามใช้คำว่า ถูกที่สุด');
    expect(sys).toContain('ราคาเซ็ตต้องมาก่อนราคาเดี่ยว');
    expect(sys).toContain('แอดของคู่แข่ง');
    expect(sys).not.toContain('ผลแอดล่าสุด');
    expect(sys.indexOf('สิ่งที่เจ้าของร้านสอนไว้')).toBeLessThan(sys.indexOf('สินค้า สต็อก และยอดขาย'));
  });

  it('the demo copywriter never advertises a product that is missing core sizes', async () => {
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

  it('the demo campaign manager refuses a blocked product and splits budget under the cap', async () => {
    const k = await loadKnowledge(db, 'climax', ['signals', 'ads']);
    const blocked = k.signals!.find((s) => !s.promotable)!;
    const agent = { slug: 'campaign', name: 'ผู้จัดการแอด', instructions: '', autonomy: 'propose' as const, addons: {} };
    expect(demoReply(agent, k, `ตั้งแอดให้ ${blocked.name} งบ 300/วัน`)).toContain('ต้องเติมไซส์ก่อน');
    const plan = demoReply(agent, k, 'แบ่งงบ 1,500/วัน ให้ 3 ตัวยังไงดี');
    const budgets = [...plan.matchAll(/^- .*?฿([\d,]+)\/วัน/gm)].map((m) => Number(m[1].replace(/,/g, '')));
    expect(budgets.length).toBeGreaterThan(0);
    expect(budgets.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1500);
    expect(plan).not.toContain(`- ${blocked.name} ฿`);
  });

  it('the demo scout compares prices as numbers and proposes two counter angles', async () => {
    const k = await loadKnowledge(db, 'climax', ['competitors', 'signals', 'usp']);
    const agent = { slug: 'scout', name: 'สอดแนมคู่แข่ง', instructions: '', autonomy: 'propose' as const, addons: {} };
    const r = demoReply(agent, k, 'คู่แข่งเล่นอะไรอยู่ตอนนี้');
    expect(r).toContain('มุมโต้ที่แนะนำ');
    expect(r).toMatch(/1\. .+\n2\. /);
    const price = demoReply(agent, k, 'ราคาเราเทียบคู่แข่งเป็นยังไง');
    expect(price).toMatch(/\d+\.- \(/);   // the competitor price, as a number
  });

  it('walks teach → chat → correct → the correction reaches the next prompt', async () => {
    const put = await app.inject({ method: 'PUT', url: '/api/stores/climax/agents/copywriter',
      payload: { instructions: 'ทุกโพสต์ต้องมีคำว่า พร้อมส่ง', addons: { knowledge: ['voice', 'signals'], actions: ['draft_post', 'not-a-real-addon'] }, by: 'เบนซ์' } });
    expect(put.statusCode).toBe(200);
    const agent = put.json() as { instructions: string; addons: { actions: string[] }; kind: string };
    expect(agent.instructions).toBe('ทุกโพสต์ต้องมีคำว่า พร้อมส่ง');
    expect(agent.addons.actions).toEqual(['draft_post']);
    expect(agent.kind).toBe('ai');

    const c1 = await app.inject({ method: 'POST', url: '/api/stores/climax/agents/copywriter/chat', payload: { message: 'เขียนโพสต์ขาสั้นผ้าสี', by: 'เบนซ์' } });
    expect(c1.statusCode).toBe(200);
    const r1 = c1.json() as { thread_id: string; message_id: number; reply: string; mode: string; used: { knowledge: string[]; corrections: number } };
    expect(r1.mode).toBe('demo');
    expect(r1.reply).toContain('ขาสั้นผ้าสี');
    expect(r1.used.knowledge).toEqual(expect.arrayContaining(['voice', 'signals']));
    expect(r1.used.corrections).toBe(0);

    const fb = await app.inject({ method: 'POST', url: '/api/stores/climax/agents/copywriter/feedback',
      payload: { message_id: r1.message_id, verdict: 'down', note: 'ราคาเซ็ตต้องอยู่บรรทัดแรก', by: 'เบนซ์' } });
    expect((fb.json() as { corrections: number }).corrections).toBe(1);

    const c2 = await app.inject({ method: 'POST', url: '/api/stores/climax/agents/copywriter/chat', payload: { thread_id: r1.thread_id, message: 'อีกแบบ' } });
    const r2 = c2.json() as { thread_id: string; used: { corrections: number } };
    expect(r2.thread_id).toBe(r1.thread_id);
    expect(r2.used.corrections).toBe(1);

    const page = await app.inject({ method: 'GET', url: '/api/stores/climax/agents/copywriter' });
    const body = page.json() as { feedback: { down: number; corrections: { note: string }[] }; threads: { id: string }[] };
    expect(body.feedback.down).toBe(1);
    expect(body.feedback.corrections[0].note).toContain('บรรทัดแรก');
    expect(body.threads[0].id).toBe(r1.thread_id);
  });

  it('a non-AI box has no chat', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/stores/climax/agents/stock_guard/chat', payload: { message: 'สวัสดี' } });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: string }).error).toContain('ไม่ใช่กล่อง AI');
  });

  it('runs every box by hand and each leaves one run with a summary', async () => {
    for (const def of AGENTS) {
      const r = await app.inject({ method: 'POST', url: `/api/stores/climax/agents/${def.slug}/run`, payload: { by: 'เบนซ์' } });
      expect(r.statusCode, def.slug).toBe(200);
      const { run, agent } = r.json() as { run: { status: string; summary: string; trigger: string }; agent: { last_run: { summary: string } | null } };
      expect(run.trigger).toBe('manual');
      expect(['ok', 'skipped']).toContain(run.status);
      expect(run.summary.length, `${def.slug}: ${run.summary}`).toBeGreaterThan(8);
      expect(agent.last_run?.summary).toBe(run.summary);
    }
    // the guard names the blocked product; the reporter sees what ran today
    const runs = (await app.inject({ method: 'GET', url: '/api/stores/climax/runs?limit=100' })).json() as { slug: string; summary: string }[];
    expect(runs.length).toBeGreaterThanOrEqual(AGENTS.length);
    expect(runs.find((r) => r.slug === 'stock_guard')!.summary).toContain('ห้ามโฆษณา');
    expect(runs.find((r) => r.slug === 'reporter')!.summary).toContain('ขาย 7 วัน');
    const k = await loadKnowledge(db, 'climax', ['runs']);
    expect(k.runs!.length).toBeGreaterThan(5);
  });

  it('a disabled box is skipped, not run', async () => {
    await app.inject({ method: 'PUT', url: '/api/stores/climax/agents/learner', payload: { enabled: false } });
    const r = await app.inject({ method: 'POST', url: '/api/stores/climax/agents/learner/run', payload: {} });
    expect((r.json() as { run: { status: string } }).run.status).toBe('skipped');
    await app.inject({ method: 'PUT', url: '/api/stores/climax/agents/learner', payload: { enabled: true } });
  });

  it('refuses feedback on a message that belongs to another box', async () => {
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
    expect(a.instructions).toBe(AGENTS.find((x) => x.slug === 'strategist')!.instructions);
  });

  it('every AI box answers its own starter questions in demo mode', async () => {
    for (const def of AI_AGENTS) {
      for (const q of def.starters) {
        const r = await app.inject({ method: 'POST', url: `/api/stores/climax/agents/${def.slug}/chat`, payload: { message: q } });
        expect(r.statusCode, `${def.slug}: ${q}`).toBe(200);
        expect((r.json() as { reply: string }).reply.length, `${def.slug}: ${q}`).toBeGreaterThan(20);
      }
    }
  });
});
