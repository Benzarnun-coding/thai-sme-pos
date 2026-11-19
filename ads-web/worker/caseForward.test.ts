import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billCase, caseForwardStatus, forwardCase, HEADER_FILLED, HEADER_PERSON, setCaseForward } from './caseForward.ts';
import { sqliteD1 } from './sqliteD1.ts';

const db = () => sqliteD1('CREATE TABLE meta_capi (key TEXT PRIMARY KEY, value TEXT)');
const sample = () => billCase({ billNo: 33605, name: 'สมชาย', noteText: '501/1 31\ncod  249', reasons: ['ไม่มีไซส์ 31'], filled: false, at: '2026-11-19T03:00:00.000Z' });
const SECRETS = { UNI_CASE_WEBHOOK_URL: 'https://example.test/hook', UNI_CASE_WEBHOOK_KEY: 'k' };

test('a bill case carries what the Discord message says', () => {
  assert.deepEqual(sample(), {
    bill_no: 33605, customer_name: 'สมชาย', admin_summary: '501/1 31 cod 249', status_header: HEADER_PERSON,
    issues: ['ไม่มีไซส์ 31'], posted_at: '2026-11-19T03:00:00.000Z', discord_message_url: null,
  });
  assert.equal(billCase({ billNo: null, name: '', noteText: '-', reasons: [], filled: true }).status_header, HEADER_FILLED);
  assert.equal(billCase({ billNo: null, name: '', noteText: '-', reasons: [], filled: true }).customer_name, 'ไม่ทราบชื่อ');
});

test('switched off (the way it ships): nothing leaves, even with both secrets set', async () => {
  const { d1 } = db();
  let calls = 0;
  const r = await forwardCase({ DB: d1, ...SECRETS }, sample(), (async () => { calls++; return new Response('ok'); }) as any);
  assert.equal(r, 'off');
  assert.equal(calls, 0);
  assert.equal((await caseForwardStatus({ DB: d1, ...SECRETS })).last, null);
});

test('switched on without the secrets, or with a non-https URL: nothing leaves', async () => {
  const { d1 } = db();
  await setCaseForward(d1, true);
  let calls = 0;
  const f = (async () => { calls++; return new Response('ok'); }) as any;
  assert.equal(await forwardCase({ DB: d1 }, sample(), f), 'not_set');
  assert.equal(await forwardCase({ DB: d1, UNI_CASE_WEBHOOK_URL: 'http://example.test', UNI_CASE_WEBHOOK_KEY: 'k' }, sample(), f), 'not_set');
  assert.equal(calls, 0);
});

test('switched on with both secrets: one JSON POST with the key in a header; the last result keeps no customer name', async () => {
  const { d1 } = db();
  await setCaseForward(d1, true);
  const seen: { url: string; init: any }[] = [];
  const r = await forwardCase({ DB: d1, ...SECRETS }, sample(), (async (url: string, init: any) => { seen.push({ url, init }); return new Response('ok'); }) as any);
  assert.equal(r, 'sent');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, SECRETS.UNI_CASE_WEBHOOK_URL);
  assert.equal(seen[0].init.headers['X-Sender-Key'], 'k');
  assert.deepEqual(JSON.parse(seen[0].init.body), sample());
  const st = await caseForwardStatus({ DB: d1, ...SECRETS });
  assert.equal(st.on, true);
  assert.equal(st.ready, true);
  assert.equal(st.last?.result, 'sent');
  assert.equal(st.last?.bill_no, 33605);
  assert.ok(!JSON.stringify(st.last).includes('สมชาย'));
});

test('a webhook that is down or refuses never throws', async () => {
  const { d1 } = db();
  await setCaseForward(d1, true);
  assert.equal(await forwardCase({ DB: d1, ...SECRETS }, sample(), (async () => { throw new Error('down'); }) as any), 'failed');
  assert.equal(await forwardCase({ DB: d1, ...SECRETS }, sample(), (async () => new Response('no', { status: 401 })) as any), 'failed');
  assert.equal((await caseForwardStatus({ DB: d1, ...SECRETS })).last?.http, 401);
});
