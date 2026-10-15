import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendNoteSale } from './autoFill.ts';
import { sqliteD1 } from './sqliteD1.ts';

test('a sale Meta refuses is told to the problem channel, at most once per 15 minutes', async () => {
  const { raw, d1 } = sqliteD1(`CREATE TABLE meta_capi (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE note_purchases (mid TEXT PRIMARY KEY, psid TEXT NOT NULL, at TEXT NOT NULL, value REAL NOT NULL, status TEXT NOT NULL, detail TEXT, sent_at TEXT NOT NULL)`);
  raw.exec(`INSERT INTO meta_capi VALUES ('mode', 'live'), ('dataset_id', '123456789'), ('source', 'note')`);
  const posts: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: any) => {
    if (String(url).startsWith('https://graph.facebook.com')) return new Response(JSON.stringify({ error: { message: 'Invalid dataset' } }), { status: 400 });
    if (String(url).startsWith('https://discord.test')) { posts.push(JSON.parse(init.body).content); return new Response(null, { status: 204 }); }
    return new Response('{}', { status: 200 }); // Page365: no conversation found → no name
  }) as any;
  try {
    const env = { DB: d1, META_ACCESS_TOKEN: 't', DISCORD_ORDER_WEBHOOK_URL: 'https://discord.test/hook', DISCORD_ORDER_OWNER_IDS: '42', P365_COOKIE: 'c' } as any;
    const note = (mid: string, psid: string) => ({ mid, psid, at: new Date().toISOString(), text: '501/1 32 cod 239', name_hash: null });
    assert.equal((await sendNoteSale(env, note('m1', 'p1'))).status, 'error');
    assert.equal((await sendNoteSale(env, note('m2', 'p2'))).status, 'error');
    assert.equal(posts.length, 1);
    assert.match(posts[0], /ส่งยอดขายให้ Meta ไม่สำเร็จ <@42>/);
    assert.match(posts[0], /Invalid dataset/);
    assert.match(posts[0], /Create order/);
    assert.equal((raw.prepare("SELECT status FROM note_purchases WHERE mid = 'm2'").get() as any).status, 'error');
  } finally {
    globalThis.fetch = realFetch;
  }
});
