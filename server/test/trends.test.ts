import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, resetDb, type Db } from '../src/db/client.js';
import { seed } from '../src/seed.js';
import { buildServer } from '../src/api/server.js';
import { competitorTrends, productTrends, seasonTrends, type Trend } from '../src/ai/trends.js';
import { buildSystemPrompt } from '../src/ai/prompt.js';
import { loadKnowledge } from '../src/ai/context.js';
import { demoReply } from '../src/ai/demo-brain.js';

describe('Trends → directives', () => {
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

  it('reads trends off the shop data: rising products, competitor angles, shopping days, each with a Thai suggestion', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/stores/climax/trends' });
    const { trends, directives } = r.json() as { trends: Trend[]; directives: unknown[] };
    expect(directives).toEqual([]);
    const kinds = new Set(trends.map((t) => t.kind));
    expect(kinds.has('rising')).toBe(true);
    expect(kinds.has('competitor')).toBe(true);
    for (const t of trends) {
      expect(t.suggestion.length).toBeGreaterThan(20);
      expect(t.targets.length).toBeGreaterThan(0);
      expect(t.title).not.toMatch(/undefined|NaN/);
    }
    // sorted by score
    expect(trends.map((t) => t.score)).toEqual([...trends.map((t) => t.score)].sort((a, b) => b - a));
  });

  it('season trends only look 14 days ahead and name the double day and pay day', () => {
    const t = seasonTrends(new Date(2026, 9, 3));   // 3 Oct 2026 → 10.10 in 7 days, pay day 25th in 22 days (skipped)
    expect(t.map((x) => x.id)).toContain('dd-10');
    expect(t.find((x) => x.id === 'dd-10')?.title).toBe('แคมเปญ 10.10 อีก 7 วัน');
    expect(t.map((x) => x.id)).not.toContain('payday');
    const late = seasonTrends(new Date(2026, 9, 20));
    expect(late.map((x) => x.id)).toContain('payday');
  });

  it('product trends respect the stock guard: a rising but blocked product is not sent to the ad manager', () => {
    const base = { product_id: 'p', category: null, sku_group: 'g', base_price: 199, set_price: null, sales_30d: 100, stock_by_size: {}, stock_by_color_size: {}, core_sizes: [], missing_core_sizes: ['32'], core_size_ok: false, days_of_cover: 20, overstock: false } as const;
    const t = productTrends([
      { ...base, product_id: 'a', name: 'ยีนส์ A', sales_7d: 40, sales_prev_7d: 20, trend_pct: 100, stock_total: 50, promotable: true, note: '' },
      { ...base, product_id: 'b', name: 'ยีนส์ B', sales_7d: 40, sales_prev_7d: 20, trend_pct: 100, stock_total: 50, promotable: false, note: 'ไซส์ 32 หมด' },
      { ...base, product_id: 'c', name: 'ยีนส์ C', sales_7d: 5, sales_prev_7d: 30, trend_pct: -83, stock_total: 50, promotable: true, note: '' },
    ]);
    expect(t.find((x) => x.id === 'rising-a')?.targets).toContain('campaign');
    expect(t.find((x) => x.id === 'rising-b')?.targets).toEqual(['strategist']);
    expect(t.find((x) => x.id === 'rising-b')?.suggestion).toContain('ห้ามโฆษณา');
    expect(t.find((x) => x.id === 'falling-c')?.kind).toBe('falling');
  });

  it('competitor trends flag a price war across pages', () => {
    const today = new Date('2026-09-17');
    const t = competitorTrends([
      { page_name: 'A', hook: 'bogo', first_seen: '2026-09-15', price_hint: null },
      { page_name: 'B', hook: 'single_price', first_seen: '2026-09-12', price_hint: 99 },
      { page_name: 'C', hook: 'story', first_seen: '2026-09-10', price_hint: null },   // one page, not a trend
      { page_name: 'D', hook: 'bogo', first_seen: '2026-06-01', price_hint: null },     // too old
    ], today);
    expect(t.map((x) => x.id).sort()).toEqual(['comp-bogo', 'comp-single_price']);
    expect(t.find((x) => x.id === 'comp-single_price')?.suggestion).toContain('99.-');
    expect(t.find((x) => x.id === 'comp-single_price')?.suggestion).toContain('อย่าสู้ราคาเดี่ยว');
  });

  it('a saved directive rides in the prompt of every targeted box, and only those, until it is done', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/stores/climax/directives', payload: {
      title: 'ดันชิโน่สไตล์เกาหลี', text: 'สัปดาห์นี้ดันชิโน่สไตล์เกาหลี ชูเซ็ต 3 ตัว 550', source: 'trend', targets: ['copywriter', 'campaign', 'sense'], days: 7, by: 'เจ้าของร้าน',
    } });
    expect(create.statusCode).toBe(200);
    const d = create.json() as { id: number; targets: string[]; expires_at: string | null; status: string };
    expect(d.targets).toEqual(['copywriter', 'campaign']);   // sense is not an AI box
    expect(d.expires_at).toBeTruthy();
    expect(d.status).toBe('active');

    // the copywriter's prompt carries it; the QA box's does not
    const agentOf = async (slug: string) => (await app.inject({ method: 'GET', url: `/api/stores/climax/agents/${slug}` })).json().agent;
    const k = await loadKnowledge(db, 'climax', ['signals']);
    const { activeDirectivesFor } = await import('../src/ai/trends.js');
    const forWriter = await activeDirectivesFor(db, 'climax', 'copywriter');
    expect(forWriter.map((x) => x.id)).toEqual([d.id]);
    expect(await activeDirectivesFor(db, 'climax', 'qa')).toEqual([]);
    const prompt = buildSystemPrompt(await agentOf('copywriter'), { name: 'Climax' }, { ...k, directives: forWriter }, []);
    expect(prompt).toContain('คำสั่งพิเศษจากเจ้าของตอนนี้');
    expect(prompt).toContain('ดันชิโน่สไตล์เกาหลี');
    expect(prompt.indexOf('คำสั่งพิเศษ')).toBeLessThan(prompt.indexOf('## สินค้า สต็อก'));

    // the demo brain follows it: the copywriter writes about the directed product when the ask names none
    const reply = demoReply(await agentOf('copywriter'), { ...k, directives: forWriter }, 'ร่างโพสต์ให้หน่อย');
    expect(reply).toContain('ชิโน่สไตล์เกาหลี');
    expect(reply).toContain('ตามคำสั่ง');

    // through the real chat path the "why" panel counts it
    const chat = await app.inject({ method: 'POST', url: '/api/stores/climax/agents/copywriter/chat', payload: { message: 'ร่างโพสต์ให้หน่อย', by: 'เจ้าของร้าน' } });
    expect(chat.json().used.directives).toBe(1);
    expect(chat.json().used.knowledge).toContain('directives');

    // run the directive: both targets run in loop order, as 'event' runs
    const run = await app.inject({ method: 'POST', url: `/api/stores/climax/directives/${d.id}/run`, payload: { by: 'เจ้าของร้าน' } });
    const { runs } = run.json() as { runs: { agent_id: string; trigger: string; status: string; summary: string }[] };
    expect(runs.map((r) => r.agent_id)).toEqual(['climax-copywriter', 'climax-campaign']);
    expect(runs.every((r) => r.trigger === 'event' && r.status === 'ok')).toBe(true);
    expect(runs[1].summary).toContain('ชิโน่');

    // mark done → gone from prompts and from the active list
    const done = await app.inject({ method: 'PATCH', url: `/api/stores/climax/directives/${d.id}`, payload: { status: 'done' } });
    expect(done.json().status).toBe('done');
    expect(await activeDirectivesFor(db, 'climax', 'copywriter')).toEqual([]);
    const active = await app.inject({ method: 'GET', url: '/api/stores/climax/directives?status=active' });
    expect(active.json()).toEqual([]);
  });

  it('rejects a directive that targets no AI box', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/stores/climax/directives', payload: { title: 'x', text: 'y', targets: ['sense', 'publisher'] } });
    expect(r.statusCode).toBe(400);
  });
});
