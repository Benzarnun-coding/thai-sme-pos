import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, resetDb, type Db } from '../src/db/client.js';
import { seed } from '../src/seed.js';
import { normalizeAdInsight, normalizePost, syncFacebook } from '../src/connectors/facebook.js';

describe('normalizers', () => {
  it('normalizePost reads insights and summaries', () => {
    const n = normalizePost('climax', '2026-09-06', {
      id: '1_2', message: '👖 ยีนส์ผ้ายืด 4 ตัว 990', created_time: '2026-09-05T13:30:00+0000', permalink_url: 'https://fb.com/p',
      shares: { count: 12 }, comments: { summary: { total_count: 34 } }, reactions: { summary: { total_count: 210 } },
      insights: { data: [{ name: 'post_impressions_unique', values: [{ value: 8800 }] }, { name: 'post_engaged_users', values: [{ value: 640 }] }] },
    });
    expect(n.reach).toBe(8800); expect(n.engaged).toBe(640); expect(n.clicks).toBeNull();
    expect(n.comments).toBe(34); expect(n.shares).toBe(12); expect(n.reactions).toBe(210);
  });
  it('normalizeAdInsight sums messaging conversations and purchases', () => {
    const n = normalizeAdInsight('climax', {
      ad_id: '99', ad_name: '[AI][0903-01][A]', date_start: '2026-09-05', impressions: '38400', reach: '30100', clicks: '1210', spend: '612.5',
      actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '15' }, { action_type: 'purchase', value: '4' }, { action_type: 'link_click', value: '900' }],
      action_values: [{ action_type: 'purchase', value: '2200' }],
    });
    expect(n.conversations).toBe(15); expect(n.purchases).toBe(4); expect(n.revenue).toBe(2200); expect(n.spend).toBe(612.5);
  });
});

describe('syncFacebook (mocked Graph API)', () => {
  let db: Db;
  beforeAll(async () => { await resetDb(); db = await getDb(); await seed(db, 'climax', { sales: false }); });
  afterAll(async () => { await resetDb(); });

  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const p = url.pathname;
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (p.endsWith('/123')) return json({ id: '123', name: 'กางเกงยีนส์ชาย Climax by PKjeans', followers_count: 44000, fan_count: 43100, category: 'Shopping & retail' });
    if (p.endsWith('/123/posts')) return json({ data: [
      { id: '123_1', message: 'โพสต์ 1', created_time: '2026-09-05T13:30:00+0000', insights: { data: [{ name: 'post_impressions_unique', values: [{ value: 5000 }] }] } },
      { id: '123_2', message: 'โพสต์ 2', created_time: '2026-09-04T13:30:00+0000' },
    ] });
    if (p.endsWith('/act_555/insights')) return json({ data: [
      { ad_id: 'a1', ad_name: 'ad one', date_start: '2026-09-05', impressions: '1000', clicks: '50', spend: '120', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '3' }] },
      { ad_id: 'a1', ad_name: 'ad one', date_start: '2026-09-06', impressions: '1200', clicks: '61', spend: '130' },
    ] });
    return new Response(JSON.stringify({ error: { message: 'not found', code: 803 } }), { status: 404 });
  };

  it('lands raw events and fills facts', async () => {
    const r = await syncFacebook(db, { storeId: 'climax', pageId: '123', pageToken: 't', adAccountId: '555', fetchImpl, today: '2026-09-06' });
    expect(r).toMatchObject({ page: true, posts: 2, ads: 2, errors: [] });
    const raw = await db.query<{ kind: string }>(`select kind from raw_event where source='facebook' order by id`);
    expect(raw.map((x) => x.kind)).toEqual(['page', 'posts', 'ad_insights']);
    const [snap] = await db.query<{ followers: number }>(`select followers from page_snapshot where store_id='climax'`);
    expect(snap.followers).toBe(44000);
    const [ad] = await db.query<{ spend: string; conversations: number }>(`select sum(spend)::text as spend, sum(conversations)::int as conversations from fact_ad_insight_daily where external_ad_id='a1'`);
    expect(Number(ad.spend)).toBe(250); expect(ad.conversations).toBe(3);
    const [conn] = await db.query<{ status: string }>(`select status from connection where store_id='climax' and channel='facebook'`);
    expect(conn.status).toBe('connected');
  });

  it('records API errors without throwing and marks the connection', async () => {
    const r = await syncFacebook(db, { storeId: 'climax', pageId: '999', pageToken: 't', fetchImpl, today: '2026-09-06' });
    expect(r.errors.length).toBe(2);
    expect(r.errors[0]).toMatch(/code 803/);
    const [conn] = await db.query<{ status: string; last_error: string }>(`select status, last_error from connection where store_id='climax' and channel='facebook'`);
    expect(conn.status).toBe('error');
    expect(conn.last_error).toMatch(/not found/);
  });

  it('is idempotent: re-running the same day updates instead of duplicating', async () => {
    await syncFacebook(db, { storeId: 'climax', pageId: '123', pageToken: 't', adAccountId: '555', fetchImpl, today: '2026-09-06' });
    const [n] = await db.query<{ n: string }>(`select count(*)::text as n from fact_ad_insight_daily where external_ad_id='a1'`);
    expect(Number(n.n)).toBe(2);
  });
});
