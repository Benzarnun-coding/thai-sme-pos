import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb, resetDb, type Db } from '../src/db/client.js';
import { seed } from '../src/seed.js';
import { buildServer } from '../src/api/server.js';
import { runAgent } from '../src/ai/jobs.js';
import { notifyLine } from '../src/connectors/line.js';

describe('diff gate and LINE notifications', () => {
  let db: Db;
  let app: ReturnType<typeof buildServer>;
  const calls: { url: string; body: { to: string; messages: { text: string }[] } }[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.LOOPDESK_AI = 'demo'; delete process.env.ANTHROPIC_API_KEY;
    await resetDb(); db = await getDb();
    await seed(db, 'climax', { sales: true, facebookDemo: true });
    app = buildServer(db); await app.ready();
  });
  afterAll(async () => { await app.close(); await resetDb(); delete process.env.LOOPDESK_AI; delete process.env.LINE_CHANNEL_ACCESS_TOKEN; delete process.env.LINE_TO; });
  afterEach(() => { vi.unstubAllGlobals(); calls.length = 0; });

  it('a scheduled run with unchanged inputs is skipped; a manual run, a changed input, or new inbox work runs again', async () => {
    const first = await runAgent(db, { storeId: 'climax', slug: 'strategist', trigger: 'schedule', chain: false });
    expect(first?.status).toBe('ok');
    expect((first?.output as { fp: string }).fp).toMatch(/^[0-9a-f]{16}$/);
    const second = await runAgent(db, { storeId: 'climax', slug: 'strategist', trigger: 'schedule', chain: false });
    expect(second?.status).toBe('skipped'); expect(second?.summary).toContain('ข้อมูลไม่เปลี่ยน'); expect((second?.output as { gated: boolean }).gated).toBe(true);
    // by hand: always runs
    const manual = await runAgent(db, { storeId: 'climax', slug: 'strategist', trigger: 'manual', chain: false });
    expect(manual?.status).toBe('ok');
    // teach it something → inputs changed → scheduled run goes ahead
    await app.inject({ method: 'PUT', url: '/api/stores/climax/agents/strategist', payload: { instructions: 'ชูเซ็ตเสมอ', by: 'x' } });
    const changed = await runAgent(db, { storeId: 'climax', slug: 'strategist', trigger: 'schedule', chain: false });
    expect(changed?.status).toBe('ok');
    // the reporter is never gated (its job is the daily summary)
    await runAgent(db, { storeId: 'climax', slug: 'reporter', trigger: 'schedule' });
    const rep = await runAgent(db, { storeId: 'climax', slug: 'reporter', trigger: 'schedule' });
    expect(rep?.status).toBe('ok');
    // work in the inbox always runs the box
    await runAgent(db, { storeId: 'climax', slug: 'scout', trigger: 'manual', chain: false });   // leaves intel for the strategist
    const withInbox = await runAgent(db, { storeId: 'climax', slug: 'strategist', trigger: 'schedule', chain: false });
    expect(withInbox?.status).toBe('ok'); expect((withInbox?.output as { inbox: number }).inbox).toBe(1);
  });

  it('LINE is a no-op until configured, then pending items and the daily report are pushed', async () => {
    expect(await notifyLine('x')).toMatchObject({ sent: false });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok'; process.env.LINE_TO = 'U123'; process.env.APP_URL = 'https://loop.example.com';
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); }));
    expect(await notifyLine('hello')).toEqual({ sent: true });
    expect(calls[0].url).toBe('https://api.line.me/v2/bot/message/push'); expect(calls[0].body.to).toBe('U123');
    calls.length = 0;

    // a campaign run proposes an ad plan → one push naming it, with the queue link
    await runAgent(db, { storeId: 'climax', slug: 'campaign', trigger: 'manual' });
    expect(calls.length).toBe(1);
    expect(calls[0].body.messages[0].text).toMatch(/^✅ มี 1 งานรออนุมัติ\n• แผนแอด: /);
    expect(calls[0].body.messages[0].text).toContain('https://loop.example.com/#Approve');
    calls.length = 0;
    // the reporter pushes its report
    await runAgent(db, { storeId: 'climax', slug: 'reporter', trigger: 'manual' });
    expect(calls.length).toBe(1); expect(calls[0].body.messages[0].text).toMatch(/^📈 รายงานประจำวัน/);
    // a box that hands work to another box (not the owner) does not push
    calls.length = 0;
    await runAgent(db, { storeId: 'climax', slug: 'scout', trigger: 'manual', chain: false });
    expect(calls.length).toBe(0);
    delete process.env.APP_URL;
  });
});
