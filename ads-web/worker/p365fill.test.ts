import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyFill, billName, chatTotal, cleanStreet, pickProduct, planFill, sizeLines, validAddress } from './p365fill.ts';

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
      for (const k of ['customer_name', 'customer_phone', 'customer_address']) if (b.order[k] !== undefined) order[k] = b.order[k];
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
  // out of stock, size not made, COD mismatch — the total isn't judged while a line is missing
  assert.equal(plan.problems.length, 3, plan.problems.join(' | '));
  const none = await planFill(env, { psid: 'nobody', at: '2026-10-15T05:01:00.000Z', text: '501/1 30\ncod 249' });
  assert.equal(none.order, null);
});

test('apply: adds the products, sets sizes, shipping and discount, and checks the total read back', async () => {
  const { calls, order } = fakePage365();
  const r = await applyFill(env, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: '501/1 30 2\ncod 349' }, { allowWarnings: true });
  assert.equal(r.order.total, 349);
  assert.equal(order.stage, 'draft', 'stays a draft — a person sends the bill');
  assert.deepEqual(order.items.map((i: any) => [i.variant.code, i.quantity]), [['5011-PK-MD-30', 2]]);
  assert.equal(order.discount, 99);
  assert.ok(calls.includes('POST order_items.json') && calls.includes('PUT orders/900.json'));
  assert.ok(!calls.some((c) => /advance|change_stage/.test(c)), 'never moves the stage');
  await assert.rejects(applyFill(env, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: '501/1 30\ncod 249' }, { allowWarnings: true }), /มีสินค้าอยู่แล้ว/);
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

test('the bill name and the address the team writes; a missing address is a warning, not a stop', async () => {
  const { order } = fakePage365();
  assert.equal(billName(29349, 'D01-PK-NV-32', 'สมชาย ใจดี'), 'PK-9349 สมชาย ใจดี');
  assert.equal(billName(29287, 'KZ071-CN-KH-XL', 'สุธน'), 'C-9287 สุธน');
  assert.equal(billName(29296, 'NI93-PK-BR-32', 'PK-9296 สุพัตรา'), 'PK-9296 สุพัตรา', 'no double prefix');
  assert.equal(billName(21234, '5011-PK-MD-30', 'อาทิตย์ วรรณสุทธิ์', ['501/1', '501/3']), 'GS-1234 อาทิตย์ วรรณสุทธิ์', '501/1–3 go through GoSell');
  assert.equal(billName(21234, '5011-PK-MD-30', 'อาทิตย์', ['501/1', 'NI9-3']), 'PK-1234 อาทิตย์', 'mixed: warehouse as usual');
  const plan = await planFill(env, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: '501/1 30\ncod 249' });
  assert.deepEqual(plan.problems, []);
  assert.match(plan.warnings.join(' '), /ANTHROPIC_API_KEY/);
  await assert.rejects(applyFill(env, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: '501/1 30\ncod 249' }), /ANTHROPIC_API_KEY/, '"fill all" skips it');
  const address = { name: 'สุพัตรา รัตนคช', phone: '085-814-1351', street: '22/6 ม.1', subdistrict: 'พรุดินนา', district: 'คลองท่อม', province: 'กระบี่', postal_code: '81120' };
  await applyFill(env, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: '501/1 30\ncod 249' }, { address });
  assert.equal(order.customer_name, 'GS-9400 สุพัตรา รัตนคช');
  assert.equal(order.customer_address, '22/6 ม.1 ต.พรุดินนา อ.คลองท่อม จ.กระบี่ 81120');
  assert.equal(order.customer_phone, '0858141351');
  assert.equal(validAddress({ ...address, postal_code: '8112' }), null);
});

test('the total the chat agreed on: the shop\'s last "ยอด…", not the order note, not after the note', () => {
  const msgs = [
    { own: true, message: 'โปร 3 ตัว **499.-**', created_at: '2026-10-15T02:10:00Z' },
    { own: true, message: 'ยืนยันอีกครั้ง ยอดรวม **549 บาท** เก็บเงินปลายทาง', created_at: '2026-10-15T02:12:00Z' },
    { own: true, message: 'Ni9-1-2-5 31 cod 549', created_at: '2026-10-15T02:17:00Z' },
    { own: true, auto: true, message: 'คอนเฟิร์มออเดอร์ ยอดรวม 239.00 บาท', created_at: '2026-10-15T02:18:00Z' },
    { own: true, message: 'ยอดรวม 999', created_at: '2026-10-16T02:18:00Z' },
  ];
  assert.equal(chatTotal(msgs, '2026-10-15T02:17:00Z'), 549);
  assert.equal(chatTotal([{ own: true, message: 'รวม 3 ตัว ราคาโปร' }]), null);
  assert.equal(chatTotal([{ own: true, message: 'ยอดรวม 239 บาท' }, { own: true, message: 'ยอดสั่งเกิน 15000 ส่งฟรี' }]), 239);
});

test('a draft passed in is used as is (the auto path looks it up once)', async () => {
  const { calls } = fakePage365();
  const plan = await planFill(env, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: '501/1 30\ncod 249' }, { draft: null });
  assert.equal(plan.order, null);
  assert.ok(!calls.some((c) => c.startsWith('GET orders.json')), 'no draft search');
});

test('"E200" is read as model 200 when Page365 has no E200', async () => {
  fakePage365();
  const plan = await planFill(env, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: 'cod249\nE501/1 30' });
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.notes, ['อ่าน E501/1 เป็น 501/1']);
});

test('a repeat customer: the earlier order\'s total is not this order\'s price', () => {
  const msgs = [
    { own: true, message: 'ยอดรวม 398 บาท ปลายทาง', created_at: '2026-10-15T01:50:00Z' },
    { own: true, message: 'Ni9-1-2 32\ncod 398', created_at: '2026-10-15T01:55:00Z' },
    { own: true, message: 'รับทราบค่ะ ตัวนี้ 199 ส่งฟรีนะคะ', created_at: '2026-10-15T09:05:00Z' },
    { own: true, message: '301/1 32 1\nCod 199', created_at: '2026-10-15T09:09:53Z' },
  ];
  assert.equal(chatTotal(msgs, '2026-10-15T09:09:53Z'), null, 'no "ยอด" since the last order: nothing to compare');
  assert.equal(chatTotal([...msgs.slice(0, 2), { own: true, message: 'ยอดรวม 199 บาท', created_at: '2026-10-15T09:06:00Z' }, msgs[3]], '2026-10-15T09:09:53Z'), 199);
  assert.equal(chatTotal([{ own: true, message: 'ยอดรวม 398', created_at: '2026-10-12T01:00:00Z' }], '2026-10-15T09:09:53Z'), null, 'older than 2 days');
});

test('the product a code means: same code, other separators, the only colour — never a different model', () => {
  const ps = ['C20-4 กางเกงคาร์โก้', '20-4 ขาสั้นชิโน่', '204/1 ยีนส์ยืด', '205/1 ยีนส์ยืด', 'SK-004 สแล็ค', '009-1 ขาสั้น', '009-2 ขาสั้น', '1009 ขาสั้น', '200 ยีนส์', '2002 ยีนส์'].map((name) => ({ name }));
  const pick = (c: string) => pickProduct(ps, c)?.name.split(' ')[0];
  assert.equal(pick('009/1'), '009-1');
  assert.equal(pick('SK004'), 'SK-004');
  assert.equal(pick('204'), '204/1', 'not 20-4');
  assert.equal(pick('205'), '205/1');
  assert.equal(pick('200'), '200');
  assert.equal(pick('009'), undefined, 'two colours: not guessed');
});

test('name and phone are taken out of the house-number line', () => {
  assert.equal(cleanStreet('สมชาย ใจดี 0812345678 99/9 ม.9', ['PK-1234 สมชาย ใจดี'], '0812345678'), '99/9 ม.9');
  assert.equal(cleanStreet('ชื่อ สมชาย เบอร์ 081-234-5678 บ้านเลขที่ 12 ซ.3', ['สมชาย'], ''), 'บ้านเลขที่ 12 ซ.3');
  assert.equal(cleanStreet('99/9 ม.9 ถ.สุขุมวิท', ['สมหญิง'], '0899999999'), '99/9 ม.9 ถ.สุขุมวิท');
});
