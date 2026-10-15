import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyFill, planFill, sizeLines } from './p365fill.ts';

// A fake Page365 with the shapes its web app sees (read 15 Oct 2026): one draft for customer "u1".
function fakePage365() {
  const calls: string[] = [];
  const products: Record<string, { id: number; name: string; variants: any[] }> = {
    '501/1': { id: 1, name: '501/1 ยีนส์กระบอกเล็ก', variants: [{ id: 11, name: 'ไซส์ 30', code: '5011-PK-MD-30', price: 199, available: 5 }, { id: 12, name: 'ไซส์ 32', code: '5011-PK-MD-32', price: 199, available: 0 }] },
    '501/2': { id: 2, name: '501/2 ยีนส์กระบอกเล็ก', variants: [{ id: 21, name: 'ไซส์ 30', code: '5012-PK-NV-30', price: 199, available: 9 }] },
  };
  const order: any = { id: 900, no: 29400, stage: 'draft', customer_fbid: 'u1', created_at: '2026-10-15T12:00:00.000+07:00', cod: true, subtotal: 0, total: 0, shipping_cost: null, discount: null, items: [] };
  const variantById = (id: number) => Object.values(products).flatMap((p) => p.variants.map((v) => ({ ...v, product_id: p.id }))).find((v) => v.id === id)!;
  globalThis.fetch = (async (url: string, init: any = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace('/115748303500549/', '');
    calls.push(`${init.method ?? 'GET'} ${path}`);
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (path === 'orders.json') return ok({ orders: [{ id: 900, no: 29400, stage: 'draft', created_at: order.created_at }, { id: 901, no: 29401, stage: 'draft', created_at: order.created_at }] });
    if (path === 'orders/901.json') return ok({ ...order, id: 901, customer_fbid: 'someone else' });
    if (path === 'orders/900.json' && init.method === 'PUT') {
      const b = JSON.parse(init.body);
      order.items = b.order_items.map((i: any) => ({ ...order.items.find((x: any) => x.id === i.id), price: i.price, quantity: i.quantity, variant: { ...variantById(i.product_id) } }));
      order.shipping_cost = b.order.shipping_cost; order.discount = b.order.discount;
      order.subtotal = order.items.reduce((t: number, i: any) => t + i.price * i.quantity, 0);
      order.total = order.subtotal + order.shipping_cost - order.discount;
      return ok(order);
    }
    if (path === 'orders/900.json') return ok(order);
    if (path === 'order_items.json') {
      const b = JSON.parse(init.body);
      for (const pid of b.product_ids) { const p = Object.values(products).find((x) => x.id === pid)!; order.items.push({ id: 5000 + order.items.length, name: p.name, note: null, price: p.variants[0].price, quantity: 1, variant: { ...p.variants[0], product_id: p.id } }); }
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

test('plan: finds the customer\'s draft, prices from Page365, the promo gap as discount', async () => {
  fakePage365();
  const plan = await planFill(env, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: '501/1/2 30\ncod 448' });
  assert.equal(plan.order?.no, 29400);
  assert.deepEqual(plan.lines.map((l) => [l.sku, l.price, l.qty]), [['5011-PK-MD-30', 199, 1], ['5012-PK-NV-30', 199, 1]]);
  assert.deepEqual([plan.subtotal, plan.shipping, plan.discount, plan.total], [398, 50, 0, 448]);
  assert.deepEqual(plan.problems, []);
});

test('plan: out of stock, unknown size, a total above list price and a transfer note on a COD draft all stop it', async () => {
  fakePage365();
  const plan = await planFill(env, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: '501/1 32\n501/2 36\nโอน 999' });
  assert.equal(plan.problems.length, 4, plan.problems.join(' | '));
  const none = await planFill(env, { psid: 'nobody', at: '2026-10-15T05:01:00.000Z', text: '501/1 30\ncod 249' });
  assert.equal(none.order, null);
});

test('apply: adds the products, sets sizes, shipping and discount, and checks the total read back', async () => {
  const { calls, order } = fakePage365();
  const r = await applyFill(env, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: '501/1 30 2\ncod 349' });
  assert.equal(r.order.total, 349);
  assert.equal(order.stage, 'draft', 'stays a draft — a person sends the bill');
  assert.deepEqual(order.items.map((i: any) => [i.variant.code, i.quantity]), [['5011-PK-MD-30', 2]]);
  assert.equal(order.discount, 99);
  assert.ok(calls.includes('POST order_items.json') && calls.includes('PUT orders/900.json'));
  assert.ok(!calls.some((c) => /advance|change_stage/.test(c)), 'never moves the stage');
  await assert.rejects(applyFill(env, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: '501/1 30\ncod 249' }), /มีสินค้าอยู่แล้ว/);
});

test('no stored login → a clear message, no calls', async () => {
  await assert.rejects(planFill({}, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: '501/1 30\ncod 249' }), /P365_COOKIE/);
});

test('a size that isn\'t made lists the sizes there are, and the customer\'s own words about size', async () => {
  fakePage365();
  const plan = await planFill(env, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: '501/2 31\ncod 249' });
  assert.match(plan.problems.join(' '), /ไม่มีไซส์ 31 — รุ่นนี้มี 30/);
  assert.deepEqual(sizeLines([
    { own: false, message: 'ดำ1ตัว กรม1ตัว เทา1ตัว เอว31ทุกตัวนะค่ะ' },
    { own: true, message: 'สรุป เอว 31 ทั้ง 3 ตัว' },
    { own: false, message: 'นาง ก 114 ม.5 เลย 42150 โทร 0928040924' },
    { own: false, message: 'เก็บปลายทาง' },
  ]), ['ดำ1ตัว กรม1ตัว เทา1ตัว เอว31ทุกตัวนะค่ะ']);
});
