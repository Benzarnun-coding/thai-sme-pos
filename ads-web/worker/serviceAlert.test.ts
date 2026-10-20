import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { closeCase, serviceAlerts, serviceMessage, serviceReason } from './serviceAlert.ts';
import { sqliteD1 } from './sqliteD1.ts';

test('complaints, refunds and wrong items are caught; questions before buying are not', () => {
  // Answer-bank fix #13: zip sent instead of buttons, and a refund.
  assert.equal(serviceReason('สั่งแบบกระดุมแต่ได้ซิปมาค่ะ ขอเปลี่ยนสินค้า หรือคืนเงินได้ไหมคะ'), 'ขอคืนเงิน');
  assert.equal(serviceReason('ได้ของแล้วแต่ไม่ตรงปกเลยค่ะ'), 'สินค้าไม่ตรงปก');
  assert.equal(serviceReason('ส่งผิดไซส์มาค่ะ สั่ง 32 ได้ 34'), 'ส่งผิด');
  assert.equal(serviceReason('ขอส่งของคืนได้ไหมคะ'), 'ขอคืน/เปลี่ยนสินค้า');
  assert.equal(serviceReason('โดนเก็บเงินซ้ำค่ะ'), 'ร้องเรียน');
  // Fix #14: leg length / hem width questions.
  assert.equal(serviceReason('ขายาวกี่นิ้วคะ'), 'ถามความยาว/ปลายขา');
  assert.equal(serviceReason('รุ่นนี้ความยาวเท่าไหร่ครับ'), 'ถามความยาว/ปลายขา');
  assert.equal(serviceReason('ปลายขากว้างกี่นิ้ว'), 'ถามความยาว/ปลายขา');
  assert.match(serviceMessage({ id: 1, at: '2026-10-20T07:40:00.000Z', reason: 'ถามความยาว/ปลายขา', text: 'ยาวกี่นิ้ว' }, null, '', true).content, /ห้ามเดาตัวเลข/);
  for (const t of ['อยากได้ขากว้างค่ะ', 'ขายาวไหม เอว 30 ใส่ไซส์ไหน']) assert.equal(serviceReason(t), null, t);
  for (const t of ['ตัวนี้ไม่ตรงปกไหมคะ', 'ขอเปลี่ยนเป็นไซส์ 32 นะคะ', 'เอา 3 ตัว 549 ค่ะ', 'ส่งฟรีไหม', null]) assert.equal(serviceReason(t), null, String(t));
});

test('the Discord message carries the name, the tag and the done button', () => {
  const m = serviceMessage({ id: 7, at: '2026-10-20T07:40:00.000Z', reason: 'ส่งผิด', text: 'ได้ซิปแทนกระดุม' }, 'Somchai Jaidee', '<@1179672160122458124>', true);
  assert.match(m.content, /service ลูกค้า #7/);
  assert.match(m.content, /Somchai Jaidee/);
  assert.match(m.content, /<@1179672160122458124>/);
  assert.match(m.content, /20\/10 14:40/);
  assert.equal((m.components as any)[0].components[0].custom_id, 'svcdone:7');
  assert.equal(serviceMessage({ id: 7, at: '2026-10-20T07:40:00.000Z', reason: 'x', text: null }, null, '', false).components, undefined);
});

test('one open case per customer; the bot posts in the webhook channel; done closes it', async () => {
  const { d1 } = sqliteD1(readFileSync(new URL('../migrations/0051_service_cases.sql', import.meta.url).pathname, 'utf8'));
  const calls: { url: string; body?: any }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: any, init?: any) => {
    const url = String(u);
    calls.push({ url, body: init?.body ? (typeof init.body === 'string' ? JSON.parse(init.body) : null) : undefined });
    const r = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.includes('me/accounts')) return r({ data: [{ id: 'pg', name: 'Page', access_token: 'PT' }] });
    if (url.includes('fields=name')) return r({ name: 'Somchai Jaidee' });
    if (url.startsWith('https://discord.com/api/webhooks/1/abc') && !init) return r({ channel_id: '555' });
    if (url.includes('/channels/555/messages')) return r({ id: 'm1' });
    return r({});
  }) as typeof fetch;
  try {
    const env = { DB: d1, META_ACCESS_TOKEN: 't', DISCORD_BOT_TOKEN: 'b', DISCORD_SERVICE_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc', DISCORD_SERVICE_IDS: '1179672160122458124' };
    const row = (mid: string, text: string, from_page = 0) => ({ mid, psid: 'p1', at: '2026-10-20T07:40:00.000Z', from_page, text, attachments: null, sender_app: null });
    assert.equal(await serviceAlerts(env, [row('a', 'ได้ของผิดแบบค่ะ'), row('b', 'ขอคืนเงินได้ไหม')]), 1);
    const post = calls.find((c) => c.url.includes('/channels/555/messages'))!;
    assert.match(post.body.content, /Somchai Jaidee/);
    assert.deepEqual(post.body.allowed_mentions, { users: ['1179672160122458124'] });
    // Same customer again while open, and the page's own words: nothing new.
    assert.equal(await serviceAlerts(env, [row('c', 'ทำไมส่งผิด'), row('d', 'คืนเงินให้นะคะ', 1)]), 0);
    assert.equal((await closeCase(d1, 1, 'Fear'))?.id, 1);
    assert.equal(await closeCase(d1, 1, 'Fear'), null);
    assert.equal(await serviceAlerts(env, [row('e', 'ยังไม่ได้เงินคืนเลยค่ะ')]), 1);
    // Switched off without the webhook secret.
    assert.equal(await serviceAlerts({ ...env, DISCORD_SERVICE_WEBHOOK_URL: undefined }, [row('f', 'ส่งผิด')]), 0);
  } finally {
    globalThis.fetch = real;
  }
});
