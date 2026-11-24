import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addRounds, applyFill, askedSizeNotMade, draftHoldsNote, sizeStop, billName, isPiaBillSku, chatTotal, cleanStreet, pickColour, pickProduct, planFill, sizeLines, validAddress } from './p365fill.ts';

// A fake Page365 with the shapes its web app sees (read 15 Oct 2026): one draft for customer "u1".
function fakePage365() {
  const calls: string[] = [];
  const products: Record<string, { id: number; name: string; variants: any[] }> = {
    '501/1': { id: 1, name: '501/1 ยีนส์กระบอกเล็ก', variants: [{ id: 11, name: 'ไซส์ 30', code: '5011-PK-MD-30', price: 199, available: 5 }, { id: 12, name: 'ไซส์ 32', code: '5011-PK-MD-32', price: 199, available: 0 }, { id: 13, name: 'ไซส์ 34', code: '5011-PK-MD-34', price: 199, available: 5 }] },
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
      for (const pid of [...new Set<number>(b.product_ids)]) { const p = Object.values(products).find((x) => x.id === pid)!; order.items.push({ id: 5000 + order.items.length, name: p.name, note: null, price: p.variants[0].price, quantity: 1, variant: { ...p.variants[0], product_id: p.id } }); }
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
  assert.equal(billName(21234, '5011-PK-MD-30', 'อาทิตย์ วรรณสุทธิ์'), 'PK-1234 อาทิตย์ วรรณสุทธิ์', '501/1–3 are PK- too (GoSell dropped, idea #36)');
  assert.equal(billName(21234, '5011-PK-MD-30', 'อาทิตย์', true), 'PP-1234 อาทิตย์', 'in พี่เปีย stock → PP- (idea #38)');
  assert.equal(billName(21234, '5011-PK-MD-30', 'PK-1234 อาทิตย์', true), 'PP-1234 อาทิตย์', 'old prefix replaced');
  const plan = await planFill(env, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: '501/1 30\ncod 249' });
  assert.deepEqual(plan.problems, []);
  assert.match(plan.warnings.join(' '), /ANTHROPIC_API_KEY/);
  await assert.rejects(applyFill(env, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: '501/1 30\ncod 249' }), /ANTHROPIC_API_KEY/, '"fill all" skips it');
  const address = { name: 'สุพัตรา รัตนคช', phone: '085-814-1351', street: '22/6 ม.1', subdistrict: 'พรุดินนา', district: 'คลองท่อม', province: 'กระบี่', postal_code: '81120' };
  await applyFill(env, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: '501/1 30\ncod 249' }, { address });
  assert.equal(order.customer_name, 'PK-9400 สุพัตรา รัตนคช');
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

test('a colour name picks the colour product; team names that differ from Page365 are aliased', () => {
  const ps = ['980-33 กางเกงผ้ายืด Sports เหลือง', '980-32 กางเกงผ้ายืด Sports แดง', '980-31 กางเกงผ้ายืด Sports น้ำเงิน', '980-29 กางเกงผ้ายืด Sports เทา', '9801 อื่น'].map((name) => ({ name }));
  const pick = (c: string) => pickColour(ps, '980', c)?.name.split(' ')[0];
  assert.equal(pick('ดำกรม'), '980-31', 'team name for น้ำเงิน');
  assert.equal(pick('เทา'), '980-29');
  assert.equal(pick('แดง'), '980-32');
  assert.equal(pick('ชมพู'), undefined);
});

test('a size the customer asked for that is not made does not stop the bill', () => {
  const made = new Set(['28', '30', '32', '34', '36', '38']);
  assert.equal(askedSizeNotMade('โน้ต 34 แต่ลูกค้าขอ 33', ['34'], made), true);
  assert.equal(askedSizeNotMade('โน้ต 30 แต่ลูกค้าขอ 32', ['30'], made), false, '32 is made: a real mismatch');
  assert.equal(askedSizeNotMade('ลูกค้าแจ้งเอว 33 (ร้านแนะนำ 34)', ['34'], made), true);
});

test('Page365\'s own address without ตำบล is not taken as complete (the chat is read instead)', async () => {
  const { draftAddress } = await import('./p365fill.ts');
  const d = { customer_name: 'ก', customer_phone: '0812345678', structural_address: { street: '12 ม.3', subdistrict: 'พรุดินนา', district: 'คลองท่อม', province: 'กระบี่', postal_code: '81120' } } as Parameters<typeof draftAddress>[0];
  assert.equal(draftAddress(d)?.subdistrict, 'พรุดินนา');
  assert.equal(draftAddress({ ...d, structural_address: { ...d.structural_address!, subdistrict: '' } }), null);
  assert.equal(draftAddress({ ...d, structural_address: { ...d.structural_address!, subdistrict: null } }), null);
});

test('a repeated product goes in its own request (Page365 adds a product once per request, #30797)', () => {
  assert.deepEqual(addRounds([1, 1, 2, 1]), [[1, 2], [1], [1]]);
  assert.deepEqual(addRounds([1, 2]), [[1, 2]]);
});

test('apply: two sizes of one model both go in (#30797 got one item and no address)', async () => {
  const { calls, order } = fakePage365();
  const r = await applyFill(env, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: '501/1 30\n501/1 34\ncod 448' }, { allowWarnings: true });
  assert.deepEqual(order.items.map((i: any) => i.variant.code).sort(), ['5011-PK-MD-30', '5011-PK-MD-34']);
  assert.equal(r.order.total, 448);
  assert.equal(calls.filter((c) => c === 'POST order_items.json').length, 2);
});

test('the size check stops a bill only on a real difference (2–16 Nov: 121 of 132 stops were not needed)', () => {
  const made = new Set(['28', '30', '32', '34', '36', '38']);
  // The reader's own "it matches" — with or without the sizes it settled on.
  assert.equal(sizeStop('โน้ตร้านระบุไซส์ 32 ตรงกับที่ลูกค้าขอล่าสุด', ['32'], ['32'], made), false);
  assert.equal(sizeStop('โน้ตระบุไซส์ 34 ตรงกับที่ลูกค้าแจ้งล่าสุด', undefined, ['34'], made), false);
  assert.equal(sizeStop('ลูกค้าเลือกไซส์ 28 ตรงกับโน้ตร้าน แต่ในแชทก่อนหน้าระบุไซส์ 36 ก่อนเปลี่ยนเป็น 28', ['28', '28'], ['28', '28'], made), false, 'changed their mind earlier');
  assert.equal(sizeStop('', ['30'], ['32'], made), false, 'no remark, no stop');
  assert.equal(sizeStop('โน้ต 32 แต่ลูกค้าไม่ได้บอกไซส์', [], ['32'], made), false, 'the customer never said');
  // Real differences.
  assert.equal(sizeStop('โน้ตร้านระบุไซส์ 36 แต่ลูกค้าขอไซส์ 34', ['34', '34', '34'], ['36', '36', '36'], made), true);
  assert.equal(sizeStop('โน้ตระบุ sz28 แต่ลูกค้าสั่งไซส์ 28 จำนวน 2 ตัว และไซส์ 29 จำนวน 1 ตัว', ['28', '28', '30'], ['28', '28', '28'], made), true, 'one piece in another size');
  assert.equal(sizeStop('โน้ต 2XL แต่ลูกค้าขอ XL', ['XL'], ['2XL'], new Set(['M', 'L', 'XL', '2XL'])), true);
  assert.equal(sizeStop('โน้ต 34 แต่ลูกค้าขอ 32', undefined, ['34'], made), true, 'older answer without the list');
  // A size that isn't made: the admin's nearest size is right.
  assert.equal(sizeStop('โน้ต 34 แต่ลูกค้าขอ 33', ['33'], ['34'], made), false);
  assert.equal(sizeStop('เอว32 ตรงกัน', ['เอว 32'], ['32'], made), false, 'written with a prefix');
});

test('a draft an admin already filled exactly as the note says is not sent to a person', () => {
  const item = (code: string, quantity = 1) => ({ id: 1, name: '', note: null, price: 199, quantity, variant: { id: 1, code, product_id: 1 } });
  const draft = { total: 649, items: [item('5011-PK-MD-32'), item('5012-PK-DB-32'), item('5013-PK-BK-32')] };
  assert.equal(draftHoldsNote('501/1/2/3 32\ncod 649', draft), true);
  assert.equal(draftHoldsNote('501/1/2/3 34\ncod 649', draft), false, 'another size');
  assert.equal(draftHoldsNote('501/1/2/3 32\ncod 549', draft), false, 'another total');
  assert.equal(draftHoldsNote('501/1/2 32\ncod 649', draft), false, 'fewer items');
  assert.equal(draftHoldsNote('cod199\nE200 34', { total: 199, items: [item('200-PK-MD-34')] }), true, 'stray letter');
  assert.equal(draftHoldsNote('501/1 32 2\ncod 448', { total: 448, items: [item('5011-PK-MD-32', 2)] }), true);
  assert.equal(draftHoldsNote('501/1 32\ncod 249', { total: 249, items: [] }), false, 'an empty draft is filled as usual');
});

test('ตัวแทน: note says 801/1, bill gets 501/1 at 801/1\'s price, named PK-', async () => {
  const { calls } = fakePage365();
  // 801/1 is sold out but still listed in Page365 at its own price.
  const pg: any = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/products.json') && /^801[/-]1$/.test(u.searchParams.get('search') ?? '')) return new Response(JSON.stringify({ products: [{ id: 8, name: '801/1 ยีนส์ขาตรง' }] }));
    if (u.pathname.endsWith('/products/8.json')) return new Response(JSON.stringify({ id: 8, variants: [{ id: 81, name: 'ไซส์ 30', code: '8011-PK-BL-30', price: 259, available: 0 }, { id: 82, name: 'ไซส์ 34', code: '8011-PK-BL-34', price: 259, available: 0 }] }));
    return pg(url, init);
  }) as typeof fetch;
  const substitutes = new Map([['801/1', '501/1']]);
  const plan = await planFill(env, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: '801-1 34\ncod 299' }, { readAddress: false, substitutes });
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.lines[0].sku, '5011-PK-MD-34', 'the substitute ships');
  assert.equal(plan.lines[0].sold_as, '801-1');
  assert.equal(plan.lines[0].price, 259, 'price of the model the customer bought');
  assert.equal(plan.discount, 259 + 50 - 299);
  assert.match(plan.bill_name ?? '', /^PK-9400 /, 'bill name: warehouse prefix, never GS-');
  assert.ok(plan.notes?.some((n) => n.includes('ตัวแทน 501/1')));
  assert.ok(calls.some((c) => c.includes('products.json')));

  // Not in Page365 any more: the substitute's own price, said so.
  const plan2 = await planFill(env, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: '777/1 30\ncod 249' }, { readAddress: false, substitutes: new Map([['777/1', '501/1']]) });
  assert.equal(plan2.lines[0].price, 199);
  assert.ok(plan2.notes?.some((n) => n.includes('ไม่พบราคา 777/1')));

  // No substitute set: 801/1 itself (out of stock → stopped as before).
  const plain = await planFill(env, { psid: 'u1', at: '2026-10-15T05:01:00.000Z', text: '801/1 30\ncod 299' }, { readAddress: false, substitutes: new Map() });
  assert.equal(plain.lines[0].sku, '8011-PK-BL-30');
  assert.ok(plain.problems.some((p) => p.includes('ไม่พอ')));
});

test('ตัวแทน: an admin-filled draft with the substitute counts as holding the note', () => {
  const draft = { total: 299, items: [{ id: 1, name: '501/1', note: null, price: 259, quantity: 1, variant: { id: 11, code: '5011-PK-MD-30', product_id: 1 } }] };
  assert.equal(draftHoldsNote('801/1 30\ncod 299', draft), false);
  assert.equal(draftHoldsNote('801/1 30\ncod 299', draft, new Map([['801/1', '501/1']])), true);
});

test('PP- bill name: only D01, D02, 009/1, 009/2 SKUs (idea #38)', () => {
  for (const s of ['D01-PK-NV-32', 'd02-pk-md-30', '0091-PK-NV-34', '0092-PK-MD-28']) assert.equal(isPiaBillSku(s), true, s);
  for (const s of ['5011-PK-MD-30', 'D01-PK-BK-32', '0093-PK-NV-30']) assert.equal(isPiaBillSku(s), false, s);
});
