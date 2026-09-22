import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, resetDb, type Db } from '../src/db/client.js';
import { seed } from '../src/seed.js';
import { buildServer } from '../src/api/server.js';
import { capReached, costUsd, monthSpendThb, setAiCap } from '../src/ai/usage.js';

describe('token meter and monthly cap', () => {
  let db: Db;
  let app: ReturnType<typeof buildServer>;
  const get = async (url: string) => (await app.inject({ method: 'GET', url })).json();

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.LOOPDESK_AI = 'demo'; delete process.env.ANTHROPIC_API_KEY;
    await resetDb(); db = await getDb();
    await seed(db, 'climax', { sales: true, facebookDemo: true });
    app = buildServer(db); await app.ready();
  });
  afterAll(async () => { await app.close(); await resetDb(); delete process.env.LOOPDESK_AI; });

  it('prices a call from its token counts, cache reads at a tenth', () => {
    expect(costUsd('claude-opus-5', { tokens_in: 1_000_000 })).toBe(5);
    expect(costUsd('claude-opus-5', { cache_read: 1_000_000 })).toBe(0.5);
    expect(costUsd('claude-sonnet-5', { tokens_out: 100_000 })).toBe(1);
    expect(costUsd('demo:claude-opus-5', { tokens_in: 1_000_000 })).toBe(5);   // demo estimates use the model's price
    expect(costUsd(null, { tokens_in: 1_000_000 })).toBe(5);
  });

  it('every assistant reply stores its token counts and the report adds them up per box', async () => {
    await app.inject({ method: 'POST', url: '/api/stores/climax/agents/copywriter/chat', payload: { message: 'ร่างโพสต์ 2 แบบ', by: 'เจ้าของร้าน' } });
    await app.inject({ method: 'POST', url: '/api/stores/climax/agents/strategist/run', payload: { by: 'เจ้าของร้าน', chain: false } });
    const m = await db.query<{ tokens_in: number; tokens_out: number; model: string }>(`select tokens_in, tokens_out, model from agent_message where role='assistant' order by id desc limit 1`);
    expect(m[0].tokens_in).toBeGreaterThan(100);
    expect(m[0].tokens_out).toBeGreaterThan(10);
    expect(m[0].model).toBe('demo:claude-opus-5');
    const u = await get('/api/stores/climax/usage');
    expect(u.mode).toBe('demo'); expect(u.estimated).toBe(true); expect(u.cap_thb).toBeNull();
    expect(u.month.calls).toBe(2);
    expect(u.month.cost_thb).toBeGreaterThan(0);
    expect(u.by_box.map((b: { slug: string }) => b.slug).sort()).toEqual(['copywriter', 'strategist']);
    expect(u.by_day.length).toBe(1);
    // the "why" panel carries the counts too
    const chat = (await app.inject({ method: 'POST', url: '/api/stores/climax/agents/qa/chat', payload: { message: 'ตรวจ: ยีนส์ 199 บาท', by: 'x' } })).json();
    expect(chat.used.tokens.in).toBeGreaterThan(0);
  });

  it('the cap only bites with a real model; demo estimates never block', async () => {
    const r = await app.inject({ method: 'PUT', url: '/api/stores/climax/settings/ai-cap', payload: { cap_thb: 1 } });
    expect(r.json().cap_thb).toBe(1);
    expect(await capReached(db, 'climax')).toBeNull();            // demo mode: nothing counts toward the cap
    expect(await monthSpendThb(db, 'climax')).toBe(0);

    // pretend one expensive Claude call happened this month
    delete process.env.LOOPDESK_AI; process.env.ANTHROPIC_API_KEY = 'sk-test-not-real';   // real mode, but the cap stops every call before the SDK is touched
    await db.query(`update agent_message set mode='claude', model='claude-opus-5', tokens_in=1000000 where id = (select max(id) from agent_message)`);
    const msg = await capReached(db, 'climax');
    expect(msg).toMatch(/^ถึงเพดาน AI รายเดือน ฿1/);
    const run = (await app.inject({ method: 'POST', url: '/api/stores/climax/agents/copywriter/run', payload: { by: 'x' } })).json().run;
    expect(run.status).toBe('skipped'); expect(run.summary).toContain('ถึงเพดาน'); expect(run.output.capped).toBe(true);
    const chat = await app.inject({ method: 'POST', url: '/api/stores/climax/agents/copywriter/chat', payload: { message: 'สวัสดี', by: 'x' } });
    expect(chat.statusCode).toBe(400); expect(chat.json().error).toContain('ถึงเพดาน');
    // automation still runs
    const auto = (await app.inject({ method: 'POST', url: '/api/stores/climax/agents/stock_guard/run', payload: { by: 'x' } })).json().run;
    expect(auto.status).toBe('ok');
    // raise the cap → back to work
    await setAiCap(db, 'climax', 100000);
    expect(await capReached(db, 'climax')).toBeNull();
    delete process.env.ANTHROPIC_API_KEY; process.env.LOOPDESK_AI = 'demo';
    await setAiCap(db, 'climax', null);
  });
});
