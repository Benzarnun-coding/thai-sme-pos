import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPayload, postExtras, createRequest, mayPress, pickerMessage, modalValues, moveRequest, nextStatus, requestInteraction, requestMessage, threadName } from './featureRequests.ts';
import { sqliteD1 } from './sqliteD1.ts';

const schema = `CREATE TABLE feature_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, author TEXT NOT NULL, author_id TEXT,
  area TEXT NOT NULL, title TEXT NOT NULL, detail TEXT, status TEXT NOT NULL, thread_id TEXT, updated_at TEXT NOT NULL,
  run_url TEXT, run_at TEXT, runs INTEGER NOT NULL DEFAULT 0, pr_url TEXT, pr_at TEXT);
CREATE TABLE feature_request_log (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL, at TEXT NOT NULL, by TEXT NOT NULL,
  from_status TEXT, to_status TEXT NOT NULL, note TEXT);`;
const BENZ = '869116667945439323', MAX = '698435075422945301', STAFF = '1111111111';
const env = (db: D1Database) => ({ DB: db, DISCORD_REQUEST_CHANNEL_ID: '555555', DISCORD_REQUEST_DECIDER_IDS: BENZ, DISCORD_APPROVER_IDS: `${BENZ},${MAX}` });
const ctx = { waitUntil: () => {} };

test('statuses only move along the agreed path', () => {
  assert.equal(nextStatus('new', 'go'), 'doing');
  assert.equal(nextStatus('new', 'no'), 'dropped');
  assert.equal(nextStatus('doing', 'done'), 'review');
  assert.equal(nextStatus('review', 'pass'), 'passed');
  assert.equal(nextStatus('review', 'fail'), 'doing');
  assert.equal(nextStatus('new', 'pass'), null);
  assert.equal(nextStatus('passed', 'done'), null);
});

test('Benz decides; the approvers say it is built; the person who asked checks it (Benz may too)', () => {
  const e = env({} as D1Database);
  assert.ok(mayPress(e, 'go', BENZ, STAFF));
  assert.ok(!mayPress(e, 'go', MAX, STAFF));
  assert.ok(!mayPress(e, 'go', STAFF, STAFF), 'asking is not approving');
  assert.ok(mayPress(e, 'done', MAX, STAFF));
  assert.ok(!mayPress(e, 'done', STAFF, STAFF));
  assert.ok(mayPress(e, 'pass', STAFF, STAFF));
  assert.ok(mayPress(e, 'fail', STAFF, STAFF));
  assert.ok(mayPress(e, 'pass', BENZ, STAFF));
  assert.ok(!mayPress(e, 'pass', MAX, STAFF), 'someone else cannot check it');
});

test('a request walks new → doing → review → doing (fail, with reason) → review → passed, every press logged', async () => {
  const { d1 } = sqliteD1(schema);
  const r = await createRequest(d1, { author: 'เคน', author_id: STAFF, area: 'gosell', title: 'GoSell เลือกขนส่งได้', detail: 'อยากเลือก Flash' }, '2026-10-20T03:00:00Z');
  assert.equal(r.status, 'new');
  assert.equal(threadName(r), '💡 #1 GoSell เลือกขนส่งได้');
  assert.equal((await moveRequest(d1, r.id, 'go', 'Benz', null))!.r.status, 'doing');
  assert.equal(await moveRequest(d1, r.id, 'go', 'Benz', null), null, 'a second press of an old button changes nothing');
  await moveRequest(d1, r.id, 'done', 'Max', null);
  await moveRequest(d1, r.id, 'fail', 'Benz', 'ยังไม่มี Flash');
  await moveRequest(d1, r.id, 'done', 'Max', null);
  const end = (await moveRequest(d1, r.id, 'pass', 'Benz', null))!;
  assert.equal(end.r.status, 'passed');
  assert.deepEqual(end.log.map((l) => l.to_status), ['new', 'doing', 'review', 'doing', 'review', 'passed']);
  assert.equal(end.log[3].note, 'ยังไม่มี Flash');
  const m = requestMessage(end.r, end.log);
  assert.match(m.content, /✅ ผ่านแล้ว/);
  assert.deepEqual(m.components, [], 'no buttons once passed');
});

test('buttons fit the status', () => {
  const ids = (s: string) => (requestMessage({ id: 7, status: s, area: 'ads', author: 'x', detail: '' } as any, []).components[0] as any)?.components.map((c: any) => c.custom_id);
  assert.deepEqual(ids('new'), ['fr:go:7', 'fr:no:7']);
  assert.deepEqual(ids('doing'), ['fr:done:7']);
  assert.deepEqual(ids('review'), ['fr:pass:7', 'fr:fail:7']);
});

test('modal values are read from action rows', () => {
  assert.deepEqual(modalValues({ components: [{ type: 1, components: [{ custom_id: 'title', value: ' ก ' }] }, { type: 1, components: [{ custom_id: 'detail', value: 'ข' }] }] }), { title: 'ก', detail: 'ข' });
});

test('interactions: command opens the form; a button from another channel or person is refused; others are not ours', async () => {
  const { d1 } = sqliteD1(schema);
  const e = env(d1);
  const cmd = await (await requestInteraction({ type: 2, data: { name: 'ไอเดีย', options: [{ name: 'หมวด', value: 'bug' }] } }, e, ctx))!.json() as any;
  assert.equal(cmd.type, 9);
  assert.equal(cmd.data.custom_id, 'frnew:bug');
  const elsewhere = await (await requestInteraction({ type: 2, channel_id: '42', data: { name: 'ไอเดีย' } }, { ...e, DISCORD_REQUEST_COMMAND_CHANNEL_ID: '777' }, ctx))!.json() as any;
  assert.match(elsewhere.data.content, /<#777>/);
  const inRoom = await (await requestInteraction({ type: 2, channel_id: '777', data: { name: 'ไอเดีย' } }, { ...e, DISCORD_REQUEST_COMMAND_CHANNEL_ID: '777' }, ctx))!.json() as any;
  assert.equal(inRoom.type, 9);
  const pick = await (await requestInteraction({ type: 3, channel_id: '777', data: { custom_id: 'frpick:gosell' } }, e, ctx))!.json() as any;
  assert.equal(pick.type, 9, 'a หมวด button opens the same form');
  assert.equal(pick.data.custom_id, 'frnew:gosell');
  assert.deepEqual((pickerMessage().components as any[]).flatMap((r) => r.components.map((c: any) => c.custom_id)), ['frpick:ads', 'frpick:backoffice', 'frpick:gosell', 'frpick:orders', 'frpick:bug', 'frpick:other']);
  assert.ok(pickerMessage().content.length <= 2000, 'fits one Discord message');
  const off = await (await requestInteraction({ type: 2, data: { name: 'ไอเดีย' } }, { ...e, DISCORD_REQUEST_CHANNEL_ID: '' }, ctx))!.json() as any;
  assert.match(off.data.content, /ยังไม่เปิดใช้/);
  const r = await createRequest(d1, { author: 'เคน', author_id: STAFF, area: 'bug', title: 't', detail: '' });
  await d1.prepare('UPDATE feature_requests SET thread_id = ? WHERE id = ?').bind('999', r.id).run();
  const wrongChannel = await (await requestInteraction({ type: 3, channel_id: '123', member: { user: { id: BENZ } }, data: { custom_id: `fr:go:${r.id}` } }, e, ctx))!.json() as any;
  assert.match(wrongChannel.data.content, /ไม่พบ/);
  const notBenz = await (await requestInteraction({ type: 3, channel_id: '999', member: { user: { id: STAFF } }, data: { custom_id: `fr:go:${r.id}` } }, e, ctx))!.json() as any;
  assert.match(notBenz.data.content, /คุณเบ้น/);
  const ok = await (await requestInteraction({ type: 3, channel_id: '999', member: { user: { id: BENZ, username: 'benz' } }, data: { custom_id: `fr:go:${r.id}` } }, e, ctx))!.json() as any;
  assert.equal(ok.type, 7);
  assert.match(ok.data.content, /🔨 กำลังทำ/);
  assert.equal(await requestInteraction({ type: 3, data: { custom_id: 'approve:abc' } }, e, ctx), null);
});

test('the build payload carries the request, its branch and every "ไม่ผ่าน" reason', async () => {
  const { d1 } = sqliteD1(schema);
  const r = await createRequest(d1, { author: 'Max', author_id: MAX, area: 'ads', title: 'กรองกำไรตามรุ่น', detail: 'อยากดูเฉพาะ 501' });
  await moveRequest(d1, r.id, 'go', 'Benz', null);
  await moveRequest(d1, r.id, 'done', 'Benz', null);
  const back = (await moveRequest(d1, r.id, 'fail', 'Max', 'ยังไม่มีปุ่มกรอง'))!;
  const t = buildPayload({ ...back.r, runs: 1 }, back.log);
  assert.match(t, /ไอเดีย #1: กรองกำไรตามรุ่น/);
  assert.match(t, /claude\/idea-1/);
  assert.match(t, /deploy\/idea-1-r2/);
  assert.match(t, /รอบที่: 2/);
  assert.match(t, /อยากดูเฉพาะ 501/);
  assert.match(t, /- ยังไม่มีปุ่มกรอง/);
});

test('pictures and later messages in the post reach Claude; bot messages and non-images are left out', () => {
  const msgs = [ // Discord returns newest first
    { type: 0, author: { id: '9', username: 'max' }, content: 'ปุ่มอยู่มุมขวา', attachments: [{ url: 'https://cdn.discordapp.com/a.png', content_type: 'image/png' }, { url: 'https://cdn.discordapp.com/b.pdf', content_type: 'application/pdf' }] },
    { type: 0, author: { id: 'BOT', bot: true }, content: 'มีไอเดียใหม่ค่ะ', attachments: [] },
    { type: 0, author: { id: '9', global_name: 'Max' }, content: 'แบบนี้', attachments: [] },
  ];
  const ex = postExtras(msgs, 'BOT');
  assert.deepEqual(ex.map((x) => x.text), ['แบบนี้', 'ปุ่มอยู่มุมขวา']);
  const t = buildPayload({ id: 7, title: 't', area: 'ads', author: 'Max', detail: 'd', runs: 0 } as any, [], ex);
  assert.match(t, /- Max: แบบนี้/);
  assert.match(t, /https:\/\/cdn.discordapp.com\/a.png/);
  assert.doesNotMatch(t, /b\.pdf/);
});
