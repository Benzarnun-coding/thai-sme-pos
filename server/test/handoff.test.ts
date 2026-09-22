import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, resetDb, type Db } from '../src/db/client.js';
import { seed } from '../src/seed.js';
import { buildServer } from '../src/api/server.js';
import { cronMatches, nextFire, parseCron } from '../src/ai/cron.js';
import { decide, inboxFor, outcome, plan, verdictOf, type WorkItem } from '../src/ai/handoff.js';
import { listWork } from '../src/ai/work.js';
import { buildSystemPrompt } from '../src/ai/prompt.js';
import { loadKnowledge } from '../src/ai/context.js';

const item = (o: Partial<WorkItem>): WorkItem => ({
  id: 1, store_id: 'climax', kind: 'post', title: 't', body: 'b', status: 'open', from_slug: 'copywriter', to_slug: 'qa', parent_id: null, review: null, rounds: 1,
  run_id: null, directive_id: null, created_at: '', updated_at: '', decided_at: null, decided_by: null, decision_note: null, published_at: null, published_as: null, ...o,
});

describe('cron', () => {
  it('parses fields, steps, ranges and lists', () => {
    const c = parseCron('30 */6 * * 1-5');
    expect([...c.minute]).toEqual([30]); expect([...c.hour]).toEqual([0, 6, 12, 18]); expect([...c.dow]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseCron('0 7,21 * * *').hour]).toEqual([7, 21]);
    expect(() => parseCron('* * *')).toThrow();
  });
  it('matches in Bangkok time and finds the next fire', () => {
    const at = new Date('2026-09-22T23:00:00Z');            // 06:00 Bangkok, Wednesday
    expect(cronMatches('0 6 * * *', at)).toBe(true);
    expect(cronMatches('0 6 * * 0', at)).toBe(false);
    expect(nextFire('0 7 * * *', at)?.toISOString()).toBe('2026-09-23T00:00:00.000Z');
    expect(nextFire('0 20 * * 0', at)?.toISOString()).toBe('2026-09-27T13:00:00.000Z');   // next Sunday 20:00
    expect(nextFire('*/15 * * * *', new Date('2026-09-22T10:07:00Z'))?.toISOString()).toBe('2026-09-22T10:15:00.000Z');
  });
});

describe('hand-off rules (pure)', () => {
  it('each box picks up only what is addressed to it in the right state', () => {
    const items = [item({ id: 1, kind: 'brief', to_slug: 'copywriter', status: 'open' }), item({ id: 2, to_slug: 'qa', status: 'open' }),
      item({ id: 3, to_slug: 'copywriter', status: 'changes' }), item({ id: 4, to_slug: 'approval', status: 'pending' }), item({ id: 5, to_slug: 'publisher', status: 'approved' }), item({ id: 6, to_slug: 'qa', status: 'done' })];
    expect(inboxFor('copywriter', items).map((i) => i.id)).toEqual([1, 3]);
    expect(inboxFor('qa', items).map((i) => i.id)).toEqual([2]);
    expect(inboxFor('approval', items).map((i) => i.id)).toEqual([4]);
    expect(inboxFor('publisher', items).map((i) => i.id)).toEqual([5]);
  });
  it('the copywriter gets one task per brief or returned post; the reviewer one per post; others their routine', () => {
    const brief = item({ id: 1, kind: 'brief', to_slug: 'copywriter', body: '1. ยีนส์ A' });
    const back = item({ id: 2, to_slug: 'copywriter', status: 'changes', review: { pass: false, issues: ['ราคาผิด'] } });
    const t = plan('copywriter', 'routine', [brief, back]);
    expect(t).toHaveLength(2);
    expect(t[0].message).toContain('ยีนส์ A'); expect(t[1].message).toContain('ราคาผิด');
    expect(plan('copywriter', 'routine', [])).toEqual([{ items: [], message: 'routine' }]);
    expect(plan('qa', 'x', [])).toEqual([]);
    expect(plan('qa', 'x', [item({ id: 9 })])[0].message).toMatch(/^ตรวจโพสต์นี้/);
    expect(plan('strategist', 'p', [item({ kind: 'intel', body: 'ข่าว', to_slug: 'strategist' })])[0].message).toContain('ข่าว');
  });
  it('reads the reviewer verdict and routes: pass → queue, fail → back once, fail again → owner decides', () => {
    expect(verdictOf('ผ่าน ✅\n- ราคาตรง')).toBe(true);
    expect(verdictOf('ไม่ผ่าน ❌ พบ 2 จุด')).toBe(false);
    expect(verdictOf('เดี๋ยวขอดูก่อน')).toBe(null);
    const post = item({ id: 7, rounds: 1 });
    const fail = outcome('qa', { items: [post], message: '' }, 'ไม่ผ่าน ❌ พบ 1 จุด\n- ใช้คำต้องห้าม "ถูกที่สุด"');
    expect(fail.update[0].patch).toMatchObject({ status: 'changes', to_slug: 'copywriter', review: { pass: false, issues: ['ใช้คำต้องห้าม "ถูกที่สุด"'] } });
    const again = outcome('qa', { items: [item({ id: 7, rounds: 2 })], message: '' }, 'ไม่ผ่าน ❌');
    expect(again.update[0].patch).toMatchObject({ status: 'pending', to_slug: 'approval' });
    const pass = outcome('qa', { items: [post], message: '' }, 'ผ่าน ✅');
    expect(pass.update[0].patch).toMatchObject({ status: 'pending', to_slug: 'approval', review: { pass: true, issues: [] } });
    expect(pass.note).toBe('pass');
  });
  it('the copywriter rewrites a returned post in place and its round count grows', () => {
    const back = item({ id: 3, to_slug: 'copywriter', status: 'changes', rounds: 1 });
    const o = outcome('copywriter', { items: [back], message: '' }, 'โพสต์ฉบับแก้');
    expect(o.create).toEqual([]);
    expect(o.update[0].patch).toMatchObject({ body: 'โพสต์ฉบับแก้', status: 'open', to_slug: 'qa', rounds: 2 });
  });
  it('risky boxes only propose: their output waits for the owner, and rules never reach the publisher', () => {
    expect(outcome('campaign', { items: [], message: '' }, 'แผนแอด').create[0]).toMatchObject({ kind: 'ad_plan', status: 'pending', to_slug: 'approval' });
    expect(outcome('learner', { items: [], message: '' }, 'กฎ').create[0]).toMatchObject({ kind: 'rule', status: 'pending' });
    expect(decide(item({ status: 'pending', kind: 'post' }), 'approve')).toMatchObject({ status: 'approved', to_slug: 'publisher' });
    expect(decide(item({ status: 'pending', kind: 'rule' }), 'approve')).toMatchObject({ status: 'approved', to_slug: null });
    expect(decide(item({ status: 'pending' }), 'reject', 'ไม่ชอบ')).toMatchObject({ status: 'rejected', decision_note: 'ไม่ชอบ' });
    expect(decide(item({ status: 'approved' }), 'approve')).toBeNull();
  });
});

describe('the loop end to end', () => {
  let db: Db;
  let app: ReturnType<typeof buildServer>;
  const get = async (url: string) => (await app.inject({ method: 'GET', url })).json();
  const post = async (url: string, payload: Record<string, unknown> = {}) => app.inject({ method: 'POST', url, payload });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.LOOPDESK_AI = 'demo'; delete process.env.ANTHROPIC_API_KEY;
    await resetDb(); db = await getDb();
    await seed(db, 'climax', { sales: true, facebookDemo: true });
    app = buildServer(db); await app.ready();
  });
  afterAll(async () => { await app.close(); await resetDb(); delete process.env.LOOPDESK_AI; });

  it('scout → strategist → copywriter → reviewer chain on one run, and stops at the human', async () => {
    const r = await post('/api/stores/climax/agents/scout/run', { by: 'เจ้าของร้าน' });
    expect(r.json().run.status).toBe('ok');
    const runs = (await get('/api/stores/climax/runs?limit=20')) as { slug: string; trigger: string; status: string; summary: string }[];
    // newest first: qa, copywriter, strategist (events) then scout (manual)
    expect(runs.slice(0, 4).map((x) => x.slug)).toEqual(['qa', 'copywriter', 'strategist', 'scout']);
    expect(runs.slice(0, 3).every((x) => x.trigger === 'event')).toBe(true);
    expect(runs.find((x) => x.slug === 'qa')?.summary).toMatch(/^ตรวจ 1 โพสต์/);

    const { items } = await get('/api/stores/climax/work') as { items: WorkItem[] };
    const intel = items.find((i) => i.kind === 'intel'); const brief = items.find((i) => i.kind === 'brief'); const postItem = items.find((i) => i.kind === 'post');
    expect(intel).toMatchObject({ status: 'done', from_slug: 'scout' });
    expect(brief).toMatchObject({ status: 'done', from_slug: 'strategist' });
    expect(postItem).toMatchObject({ status: 'pending', to_slug: 'approval', from_slug: 'qa', rounds: 1, parent_id: brief!.id });
    expect(postItem!.review?.pass).toBe(true);
    expect(postItem!.run_id).toBeTruthy();

    // the approval box reports the queue; the agent list shows it as inbox
    const ap = await post('/api/stores/climax/agents/approval/run', { by: 'เจ้าของร้าน' });
    expect(ap.json().run.summary).toMatch(/^รออนุมัติ 1 งาน: โพสต์ 1/);
    const agents = (await get('/api/stores/climax/agents')) as { slug: string; inbox: number; next_run: string | null }[];
    expect(agents.find((a) => a.slug === 'approval')?.inbox).toBe(1);
    expect(agents.find((a) => a.slug === 'copywriter')?.inbox).toBe(0);
    expect(agents.find((a) => a.slug === 'strategist')?.next_run).toBeTruthy();
    expect(agents.find((a) => a.slug === 'qa')?.next_run).toBeNull();
  });

  it('approving a post runs the publisher at once; rejecting leaves a note; nothing can be decided twice', async () => {
    const { items } = await get('/api/stores/climax/work?status=pending') as { items: WorkItem[] };
    const postItem = items.find((i) => i.kind === 'post')!;
    const ok = await post(`/api/stores/climax/work/${postItem.id}/decide`, { decision: 'approve', by: 'เจ้าของร้าน' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().item).toMatchObject({ status: 'done', published_as: 'จำลอง' });
    expect(ok.json().item.published_at).toBeTruthy();
    expect(ok.json().run).toMatchObject({ trigger: 'event', status: 'ok' });
    expect(ok.json().run.summary).toContain('จำลอง');
    const twice = await post(`/api/stores/climax/work/${postItem.id}/decide`, { decision: 'reject' });
    expect(twice.statusCode).toBe(409);

    // a campaign run proposes an ad plan → reject it
    await post('/api/stores/climax/agents/campaign/run', { by: 'เจ้าของร้าน' });
    const pend = (await get('/api/stores/climax/work?status=pending')).items as WorkItem[];
    const plan = pend.find((i) => i.kind === 'ad_plan')!;
    expect(plan.from_slug).toBe('campaign');
    const no = await post(`/api/stores/climax/work/${plan.id}/decide`, { decision: 'reject', note: 'งบยังไม่พร้อม', by: 'เจ้าของร้าน' });
    expect(no.json().item).toMatchObject({ status: 'rejected', decision_note: 'งบยังไม่พร้อม', to_slug: null });
    expect(no.json().run).toBeNull();
    // a second campaign run replaces nothing pending (the old one was rejected) and adds a fresh proposal
    await post('/api/stores/climax/agents/campaign/run', { by: 'เจ้าของร้าน' });
    const plans = (await listWork(db, 'climax', { kind: 'ad_plan' }));
    expect(plans.map((p) => p.status).sort()).toEqual(['pending', 'rejected']);
  });

  it('an approved learned rule shows up in every AI box prompt', async () => {
    await post('/api/stores/climax/agents/learner/run', { by: 'เจ้าของร้าน' });
    const rule = (await get('/api/stores/climax/work?status=pending&kind=rule')).items[0] as WorkItem;
    expect(rule.title.length).toBeGreaterThan(5);
    await post(`/api/stores/climax/work/${rule.id}/decide`, { decision: 'approve', by: 'เจ้าของร้าน' });
    const agent = (await get('/api/stores/climax/agents/copywriter')).agent;
    const k = await loadKnowledge(db, 'climax', ['signals']);
    const { approvedRules } = await import('../src/ai/work.js');
    k.rules = await approvedRules(db, 'climax');
    expect(k.rules).toHaveLength(1);
    const prompt = buildSystemPrompt(agent, { name: 'Climax' }, k, []);
    expect(prompt).toContain('กฎที่ระบบเรียนรู้และเจ้าของอนุมัติแล้ว');
    expect(prompt).toContain(rule.title);
    const chat = await post('/api/stores/climax/agents/copywriter/chat', { message: 'ร่างโพสต์', by: 'เจ้าของร้าน' });
    expect(chat.json().used.knowledge).toContain('rules');
  });

  it('a new brief supersedes the open one, and chaining can be switched off per run', async () => {
    const before = (await listWork(db, 'climax', { kind: 'brief' })).length;
    await post('/api/stores/climax/agents/strategist/run', { by: 'เจ้าของร้าน', chain: false });
    const briefs = await listWork(db, 'climax', { kind: 'brief' });
    expect(briefs.length).toBe(before + 1);
    expect(briefs[0]).toMatchObject({ status: 'open', to_slug: 'copywriter' });
    await post('/api/stores/climax/agents/strategist/run', { by: 'เจ้าของร้าน', chain: false });
    const after = await listWork(db, 'climax', { kind: 'brief' });
    expect(after.filter((b) => b.status === 'open')).toHaveLength(1);
    expect(after.find((b) => b.id === briefs[0].id)).toMatchObject({ status: 'done', decision_note: 'ถูกแทนด้วยฉบับใหม่' });
    const runs = (await get('/api/stores/climax/runs?limit=3')) as { slug: string }[];
    expect(runs[0].slug).toBe('strategist');   // no copywriter run chained
  });

  it('reports the scheduler state and next fire per box', async () => {
    const s = await get('/api/studio/scheduler') as { enabled: boolean; timezone: string; boxes: { slug: string; next: string | null }[] };
    expect(s.timezone).toBe('Asia/Bangkok');
    expect(s.boxes.map((b) => b.slug)).toContain('strategist');
    expect(s.boxes.every((b) => b.next)).toBe(true);
  });
});
