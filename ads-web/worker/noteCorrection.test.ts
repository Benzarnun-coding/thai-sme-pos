import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoFillNote } from './autoFill.ts';
import { decide, rewriteBill, correctionApplies } from './noteCorrection.ts';
import { sqliteD1 } from './sqliteD1.ts';

const H = 3_600_000;
// A bill as the earlier note filled it: item names start with the code, SKUs end with the size (as in Page365).
const bill = (items: [string, string, number][], total: number, cod = true) => ({
  items: items.map(([code, size, qty], k) => ({ id: k, name: `${code} ยีนส์`, note: null, price: 0, quantity: qty, variant: { id: k, code: `${code.replace(/[/-]/g, '')}-PK-MD-${size}`, product_id: k } })),
  total, cod,
});

test('which notes are corrections — the real repeats of 16–23 Oct', () => {
  const d = (noteText: string, b: ReturnType<typeof bill>, gapMs = 30 * 60_000, stage = 'draft', billAgeMs = gapMs) => decide({ gapMs, billAgeMs, stage, noteText, bill: b });
  // #29526 12:14 → 12:37: another model → rewrite the draft
  assert.equal(d('cod249\nD02 36', bill([['E200', '36', 1]], 249)), 'rewrite');
  // #29639: size 32 → 36 six minutes later
  assert.equal(d('D02 sz36 1\ncod 199', bill([['D02', '32', 1]], 199), 6 * 60_000), 'rewrite');
  // #29915: COD 449 → transfer 399, same items
  assert.equal(d('โอน399kb\n301/1 36\n301/3 36', bill([['301/1', '36', 1], ['301/3', '36', 1]], 449)), 'rewrite');
  // #29773: the same summary again → nothing to do
  assert.equal(d('cod797\n501/1 32\n501/3 32\n201/1 32', bill([['501/1', '32', 1], ['501/3', '32', 1], ['201/1', '32', 1]], 797), 100 * 60_000), 'same');
  // #30041: "2ตัว ปลายทาง428" names no item → a person, as before
  assert.equal(d('2ตัว ปลายทาง428', bill([['501/1', '34', 1], ['501/2', '34', 1]], 428), 7 * 60_000), 'unclear');
  // sent and unpaid → rewritten too; any later stage → never touched
  assert.equal(d('D02 sz36 1\ncod 199', bill([['D02', '32', 1]], 199), 20 * 60_000, 'unpaid'), 'rewrite');
  for (const s of ['transferred', 'paid', 'shipped', 'voided']) assert.equal(d('D02 sz36 1\ncod 199', bill([['D02', '32', 1]], 199), 20 * 60_000, s), 'locked', s);
  // after 2 h: the same model in another size or colour → ask; another model → a new order
  assert.equal(d('cod249\n501/1 34', bill([['501/1', '32', 1]], 249), 3 * H, 'paid'), 'ask');
  assert.equal(d('cod249\n301/4 34', bill([['301/1', '34', 1]], 249), 3 * H, 'unpaid'), 'ask');
  assert.equal(d('cod249\n801/1 32', bill([['501/1', '32', 1]], 249), 3 * H, 'paid'), 'new');
  // …but not once the parcel is sent, nor for a bill days old
  assert.equal(d('cod249\n501/1 34', bill([['501/1', '32', 1]], 249), 3 * H, 'shipped'), 'new');
  assert.equal(d('cod249\n501/1 34', bill([['501/1', '32', 1]], 249), 3 * H, 'paid', 4 * 24 * H), 'new');
  // the same items again after 2 h (a repeat order, #29937 → #29964) stays a new order
  assert.equal(d('cod199\n501/1 31', bill([['501/1', '31', 1]], 249), 4 * H, 'paid'), 'new');
});

// A fake Page365: customer u1 with one bill (#29400) the earlier note filled with 501/1 size 30.
function fakePage365(stage: string) {
  const calls: string[] = [];
  const products: Record<string, { id: number; name: string; variants: any[] }> = {
    '501/1': { id: 1, name: '501/1 ยีนส์กระบอกเล็ก', variants: [{ id: 11, name: 'ไซส์ 30', code: '5011-PK-MD-30', price: 199, available: 5 }, { id: 12, name: 'ไซส์ 32', code: '5011-PK-MD-32', price: 199, available: 4 }] },
    '501/2': { id: 2, name: '501/2 ยีนส์กระบอกเล็ก', variants: [{ id: 21, name: 'ไซส์ 30', code: '5012-PK-NV-30', price: 199, available: 9 }] },
  };
  const variantById = (id: number) => Object.values(products).flatMap((p) => p.variants.map((v) => ({ ...v, product_id: p.id }))).find((v) => v.id === id)!;
  const order: any = {
    id: 900, no: 29400, stage, customer_fbid: 'u1', conversation_id: null, created_at: '2026-10-23T03:00:00.000Z', cod: true, customer_name: 'PK-9400 สมชาย',
    shipping_id: 37429, shipping_options: [{ id: 37429, name: 'Kerry Express (COD)', cod: true }, { id: 37437, name: 'Kerry Express (แบบโอน)', cod: false }],
    subtotal: 199, total: 199, shipping_cost: 50, discount: 50, items: [{ id: 7001, name: '501/1 ยีนส์กระบอกเล็ก', note: null, price: 199, quantity: 1, variant: variantById(11) }],
  };
  globalThis.fetch = (async (url: string, init: any = {}) => {
    const u = new URL(url);
    if (u.hostname === 'discord.test') { calls.push(`DISCORD ${JSON.parse(init.body).content}`); return new Response(null, { status: 204 }); }
    const path = u.pathname.replace('/115748303500549/', '');
    calls.push(`${init.method ?? 'GET'} ${path}`);
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (path === 'conversations.json') return ok({ conversations: [{ id: 5, customer: { id: 77, fbid: 'u1', name: 'สมชาย', last_order_id: 900 } }] });
    if (path === 'orders.json') return ok({ orders: [] });
    if (path === 'orders/900.json' && init.method === 'PUT') {
      const b = JSON.parse(init.body);
      order.items = b.order_items.map((i: any) => ({ ...order.items.find((x: any) => x.id === i.id), price: i.price, quantity: i.quantity, variant: { ...variantById(i.product_id) } }));
      Object.assign(order, { stage: b.order.stage, shipping_cost: b.order.shipping_cost, discount: b.order.discount, customer_name: b.order.customer_name });
      if (b.order.shipping_id) { order.shipping_id = b.order.shipping_id; order.cod = order.shipping_options.find((o: any) => o.id === b.order.shipping_id).cod; }
      order.subtotal = order.items.reduce((t: number, i: any) => t + i.price * i.quantity, 0);
      order.total = order.subtotal + order.shipping_cost - order.discount;
      return ok(order);
    }
    if (path === 'orders/900.json') return ok(order);
    if (path === 'order_items.json') {
      const b = JSON.parse(init.body);
      for (const pid of b.product_ids) { const p = Object.values(products).find((x) => x.id === pid)!; order.items.push({ id: 8000 + order.items.length, name: p.name, note: null, price: p.variants[0].price, quantity: 1, variant: { ...p.variants[0], product_id: p.id } }); }
      return ok(order);
    }
    if (path === 'products.json') { const q = u.searchParams.get('search')!; return ok({ products: Object.values(products).filter((p) => p.name.startsWith(q)).map(({ id, name }) => ({ id, name })) }); }
    const m = path.match(/^products\/(\d+)\.json$/);
    if (m) return ok(Object.values(products).find((p) => p.id === Number(m[1])));
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  return { calls, order };
}

const env = { P365_COOKIE: 'session=x' };

test('rewrite: a size change keeps the item and the bill\'s stage; a model change swaps the item', async () => {
  const { calls, order } = fakePage365('unpaid');
  await rewriteBill(env, { psid: 'u1', at: '2026-10-23T03:30:00Z', text: '501/1 32\ncod 199' }, structuredClone(order));
  assert.deepEqual(order.items.map((i: any) => [i.id, i.variant.code, i.quantity]), [[7001, '5011-PK-MD-32', 1]]);
  assert.equal(order.stage, 'unpaid', 'saved in its own stage');
  assert.equal(order.total, 199);
  assert.ok(!calls.some((c) => /order_items|advance|change_stage/.test(c)), calls.join(' | '));

  await rewriteBill(env, { psid: 'u1', at: '2026-10-23T03:40:00Z', text: '501/2 30 2\ncod 349' }, structuredClone(order));
  assert.deepEqual(order.items.map((i: any) => [i.variant.code, i.quantity]), [['5012-PK-NV-30', 2]], 'the old model is gone');
  assert.equal(order.total, 349);
  assert.ok(calls.includes('POST order_items.json'));
});

test('rewrite refuses a bill that has moved past unpaid, before writing anything', async () => {
  const { calls, order } = fakePage365('unpaid');
  const seen = structuredClone(order);
  order.stage = 'paid'; // an admin moved it on after we looked
  await assert.rejects(rewriteBill(env, { psid: 'u1', at: '2026-10-23T03:30:00Z', text: '501/1 32\ncod 199' }, seen), /ชำระแล้ว/);
  assert.ok(!calls.some((c) => c.startsWith('PUT') || c.startsWith('POST')));
});

const schema = `CREATE TABLE order_notes (mid TEXT PRIMARY KEY, psid TEXT, at TEXT, text TEXT, name_hash TEXT, filled_at TEXT, filled_by TEXT, fill_order_no INTEGER, fill_error TEXT);
  CREATE TABLE meta_capi (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE audit (id INTEGER PRIMARY KEY, at TEXT, actor TEXT, action TEXT, target TEXT, detail TEXT);
  INSERT INTO meta_capi VALUES ('auto_fill', 'on');
  INSERT INTO order_notes VALUES ('m1', 'u1', '2026-10-23T03:00:00Z', '501/1 30\ncod 199', NULL, '2026-10-23T03:01:00Z', 'auto', 29400, NULL);`;

async function run(stage: string, text: string, at: string, on: boolean) {
  const page = fakePage365(stage);
  const { raw, d1 } = sqliteD1(schema);
  if (on) raw.exec("INSERT INTO meta_capi VALUES ('note_correction', 'on')");
  const note = { mid: 'm2', psid: 'u1', at, text, name_hash: null };
  raw.prepare('INSERT INTO order_notes (mid, psid, at, text) VALUES (?, ?, ?, ?)').run(note.mid, note.psid, note.at, note.text);
  const r = await autoFillNote({ ...env, DB: d1, DISCORD_ORDER_WEBHOOK_URL: 'https://discord.test/hook' } as any, note);
  return { r, ...page, row: raw.prepare("SELECT * FROM order_notes WHERE mid = 'm2'").get() as any };
}

test('auto: a corrected summary rewrites a sent, unpaid bill and tells the problem channel what changed', async () => {
  const { r, order, calls, row } = await run('unpaid', '501/1 32\ncod 249', '2026-10-23T03:40:00Z', true);
  assert.equal(r.status, 'filled', r.reasons.join(' | '));
  assert.equal(order.items[0].variant.code, '5011-PK-MD-32');
  assert.equal(row.fill_order_no, 29400);
  const msg = calls.find((c) => c.startsWith('DISCORD'))!;
  assert.match(msg, /แก้บิล \[#29400\]/);
  assert.match(msg, /501\/1 30 → 501\/1 32/);
  assert.match(msg, /ยอด 199 → 249 — ยอดขายที่ส่งให้ Meta ไปแล้ว \(199\) แก้\/ลบไม่ได้/);
});

test('auto: switched off, the same note changes nothing (as before)', async () => {
  const { r, order, calls } = await run('unpaid', '501/1 32\ncod 249', '2026-10-23T03:40:00Z', false);
  assert.equal(r.status, 'filled');
  assert.equal(order.items[0].variant.code, '5011-PK-MD-30');
  assert.ok(!calls.some((c) => c.startsWith('PUT') || c.startsWith('POST') || c.startsWith('DISCORD')));
});

test('auto: a paid bill is never touched — a person is told at once', async () => {
  const { r, order, calls } = await run('paid', '501/1 32\ncod 199', '2026-10-23T03:40:00Z', true);
  assert.equal(r.status, 'needs_person');
  assert.equal(order.items[0].variant.code, '5011-PK-MD-30');
  assert.ok(!calls.some((c) => c.startsWith('PUT') || c.startsWith('POST')));
  assert.match(calls.find((c) => c.startsWith('DISCORD'))!, /ชำระแล้ว.*ระบบไม่แก้บิลที่เลยรอชำระ.*501\/1 30 → 501\/1 32/s);
});

test('auto: hours later, the same model in another size → no second bill, a person is asked', async () => {
  const { r, calls, row } = await run('paid', '501/1 32\ncod 199', '2026-10-23T08:00:00Z', true);
  assert.equal(r.status, 'needs_person');
  assert.ok(!calls.some((c) => c.includes('customers/77/orders.json')), 'no new draft opened');
  assert.match(row.fill_error, /รุ่นเดียวกับบิล #29400/);
});

test('auto: a corrected summary on a draft is rewritten in place — no delete, no second draft, no message', async () => {
  const { r, order, calls } = await run('draft', 'โอน 199\n501/1 32', '2026-10-23T03:20:00Z', true);
  assert.equal(r.status, 'filled', r.reasons.join(' | '));
  assert.equal(order.items[0].variant.code, '5011-PK-MD-32');
  assert.deepEqual([order.cod, order.total], [false, 199], 'COD → transfer follows the note');
  assert.ok(!calls.some((c) => c.startsWith('DELETE') || c.includes('customers/77/orders.json') || c.startsWith('DISCORD')), calls.join(' | '));
});

test('auto: the same summary again changes nothing and asks nobody', async () => {
  const { r, calls } = await run('draft', '501/1 30\ncod 199', '2026-10-23T03:20:00Z', true);
  assert.equal(r.status, 'filled');
  assert.ok(!calls.some((c) => c.startsWith('PUT') || c.startsWith('POST') || c.startsWith('DISCORD')));
});

test('auto: a summary typed seconds after one still being filled waits for it (no second bill, no double items)', async () => {
  const page = fakePage365('draft');
  const { raw, d1 } = sqliteD1(schema);
  raw.exec("INSERT INTO meta_capi VALUES ('note_correction', 'on'); UPDATE order_notes SET filled_at = NULL, fill_error = 'รอเปิดร่าง' WHERE mid = 'm1'");
  const note = { mid: 'm2', psid: 'u1', at: '2026-10-23T03:00:11Z', text: '501/1 30\ncod 249', name_hash: null };
  raw.prepare('INSERT INTO order_notes (mid, psid, at, text) VALUES (?, ?, ?, ?)').run(note.mid, note.psid, note.at, note.text);
  const r = await autoFillNote({ ...env, DB: d1 } as any, note);
  assert.equal(r.status, 'waiting');
  assert.deepEqual(page.calls, [], 'Page365 not touched');
  assert.match((raw.prepare("SELECT fill_error FROM order_notes WHERE mid = 'm2'").get() as any).fill_error, /^รอเปิดร่าง/, 'the sweep retries it');
});

test('switched on "from now on": only notes typed after the switch correct a bill', () => {
  assert.equal(correctionApplies('on:2026-10-23T10:00:00.000Z', '2026-10-23T10:05:00Z'), true);
  assert.equal(correctionApplies('on:2026-10-23T10:00:00.000Z', '2026-10-23T09:59:00Z'), false);
  assert.equal(correctionApplies('on:2026-10-23T10:00:00.000Z'), true);
  assert.equal(correctionApplies('on', '2026-01-01T00:00:00Z'), true);
  assert.equal(correctionApplies('off', '2026-10-23T10:05:00Z'), false);
  assert.equal(correctionApplies(undefined), false);
});
