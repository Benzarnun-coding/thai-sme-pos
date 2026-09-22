import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, resetDb, type Db } from '../src/db/client.js';
import { seed } from '../src/seed.js';
import { buildServer } from '../src/api/server.js';
import { budgetOf, inboxFor, type WorkItem } from '../src/ai/handoff.js';
import { createWork, listWork } from '../src/ai/work.js';

describe('budget ledger and scheduled publishing', () => {
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

  it('reads the daily budget out of an ad plan', () => {
    expect(budgetOf('แผนแอด ยีนส์ · งบ ฿300/วัน · เป้าหมาย ทักแชท')).toBe(300);
    expect(budgetOf('แบ่งงบ ฿1,500/วัน ตามยอดขาย:\n- A ฿450/วัน (ขาย 10)\n- B ฿1,050/วัน')).toBe(1500);
    expect(budgetOf('- A ฿450/วัน\n- B ฿300/วัน')).toBe(750);
    expect(budgetOf('ไม่มีตัวเลข')).toBeNull();
  });

  it('the publisher skips an item scheduled for later, and picks it up once due', () => {
    const base = { id: 1, store_id: 'climax', kind: 'post', title: 't', body: 'b', status: 'approved', from_slug: 'qa', to_slug: 'publisher', parent_id: null, review: null, rounds: 1, run_id: null, directive_id: null, created_at: '', updated_at: '', decided_at: null, decided_by: null, decision_note: null, published_at: null, published_as: null, budget_thb: null } as const;
    const later = { ...base, publish_at: new Date(Date.now() + 3600_000).toISOString() } as WorkItem;
    const now = { ...base, id: 2, publish_at: null } as WorkItem;
    expect(inboxFor('publisher', [later, now]).map((i) => i.id)).toEqual([2]);
    expect(inboxFor('publisher', [later], Date.now() + 2 * 3600_000).map((i) => i.id)).toEqual([1]);
  });

  it('approving a post with a publish time holds it until then; approving without publishes now', async () => {
    const it1 = await createWork(db, 'climax', { kind: 'post', title: 'โพสต์เย็นนี้', body: 'x', status: 'pending', from_slug: 'qa', to_slug: 'approval' });
    const when = new Date(Date.now() + 2 * 3600_000).toISOString();
    const r = await post(`/api/stores/climax/work/${it1.id}/decide`, { decision: 'approve', publish_at: when, by: 'x' });
    expect(r.statusCode).toBe(200);
    expect(r.json().run).toBeNull();
    expect(r.json().item).toMatchObject({ status: 'approved', to_slug: 'publisher' });
    expect(new Date(r.json().item.publish_at).toISOString()).toBe(when);
    // a publisher run now leaves it alone
    const pub = (await post('/api/stores/climax/agents/publisher/run', { by: 'x' })).json().run;
    expect(pub.status).toBe('skipped');
    expect((await listWork(db, 'climax', { status: 'approved' })).map((w) => w.id)).toContain(it1.id);
    const bad = await post(`/api/stores/climax/work/${it1.id}/decide`, { decision: 'approve', publish_at: 'tonight' });
    expect(bad.statusCode).toBe(400);
  });

  it('an ad plan over the daily cap is held with a reason; within the cap it is published and written to the ledger', async () => {
    // seed caps: dailyCap 1500 (from seed). Today's real spend is whatever the demo facts hold for today.
    const { today } = await get('/api/stores/climax/budget');
    const cap = Math.round(today.spent + today.planned + 1000);   // exactly ฿1,000 of room today
    await db.query(`update store set settings = settings || $2::jsonb where id=$1`, ['climax', JSON.stringify({ dailyCap: cap })]);
    const big = await createWork(db, 'climax', { kind: 'ad_plan', title: 'แผนใหญ่', body: 'แผนแอด · งบ ฿1,500/วัน', status: 'pending', from_slug: 'campaign', to_slug: 'approval', budget_thb: 1500 });
    const r1 = (await post(`/api/stores/climax/work/${big.id}/decide`, { decision: 'approve', by: 'x' })).json();
    expect(r1.run.status).toBe('skipped'); expect(r1.run.summary).toContain('ติดเพดานงบ');
    expect(r1.item.status).toBe('approved'); expect(r1.item.decision_note).toMatch(/^รอเพดานวัน/);
    expect(r1.run.output.held).toHaveLength(1);

    const small = await createWork(db, 'climax', { kind: 'ad_plan', title: 'แผนเล็ก', body: 'แผนแอด · งบ ฿100/วัน', status: 'pending', from_slug: 'campaign', to_slug: 'approval', budget_thb: 100 });
    const r2 = (await post(`/api/stores/climax/work/${small.id}/decide`, { decision: 'approve', by: 'x' })).json();
    expect(r2.item).toMatchObject({ status: 'done', published_as: 'จำลอง' });
    expect(r2.run.output.held).toHaveLength(1);   // the big one is still held
    const b = await get('/api/stores/climax/budget');
    expect(b.daily_cap).toBe(cap);
    expect(b.today.planned).toBe(today.planned + 100);
    expect(b.ledger[0]).toMatchObject({ kind: 'planned', amount: 100, ref: String(small.id) });
  });
});
