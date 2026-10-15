import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkNotes, parseOrderNote, pickCatalog, withCatalog } from './orderNotes.ts';
import type { StoredOrder } from './p365.ts';
import { extractOrderNotes } from './webhook.ts';

const short = (t: string) => {
  const p = parseOrderNote(t);
  return p && { items: p.items.map((i) => `${i.prefix} ${i.size} ×${i.qty}`), payment: p.payment, total: p.total, unknown: p.unknown };
};

test('the admins\' notes as typed in Page365 chats on 15 Oct 2026', () => {
  assert.deepEqual(short('501/1  32\ncod  249'), { items: ['5011 32 ×1'], payment: 'cod', total: 249, unknown: [] });
  assert.deepEqual(short('ni9-3 32 1 cod 239')?.items, ['NI93 32 ×1']);
  assert.deepEqual(short('501/1 30 cod 239')?.items, ['5011 30 ×1']);
  assert.deepEqual(short('501/1/2/3  32\ncod  649')?.items, ['5011 32 ×1', '5012 32 ×1', '5013 32 ×1']);
  assert.deepEqual(short('Ni9-1-2-5  31\ncod  549')?.items, ['NI91 31 ×1', 'NI92 31 ×1', 'NI95 31 ×1']);
  assert.deepEqual(short('009-1-2  36\ncod  299')?.items, ['0091 36 ×1', '0092 36 ×1']);
  assert.deepEqual(short('801/3  36  3\ncod  849')?.items, ['8013 36 ×3']);
  assert.deepEqual(short('444/2  38  2\n555/3  38  2\ncod  1290')?.items, ['4442 38 ×2', '5553 38 ×2']);
  assert.deepEqual(short('D01 D02 34\ncod 448')?.items, ['D01 34 ×1', 'D02 34 ×1']);
  assert.deepEqual(short('200  200/2  30\ncod  448')?.items, ['200 30 ×1', '2002 30 ×1']);
  assert.deepEqual(short('200  36\n111  36\n222  36\n301/3  36\n301/1  36\ncod  1299')?.items.length, 5);
  assert.equal(short('009-1-2  30\ncod299')?.total, 299);
  assert.equal(short('301/1 34 1 โอน 199')?.payment, 'transfer');
  assert.deepEqual(short('D01 D02 sz30\ncod 448')?.items, ['D01 30 ×1', 'D02 30 ×1']);
  assert.deepEqual(short('501/1 เอว32\ncod 249')?.items, ['5011 32 ×1']);
  // Item lines it can't read: kept, all flagged, so the miss shows in the log.
  assert.deepEqual(short('501/1 ?? \ncod 249'), { items: [], payment: 'cod', total: 249, unknown: ['501/1 ??'] });
});

test('chat that is not just an order note is never taken (keeps addresses out of storage)', () => {
  assert.equal(parseOrderNote('สีดำครับ ไซส์30 อรรถพล 31 ม.8 ต.ท่าซุง 61000 สีดำ 1 ตัว'), null);
  assert.equal(parseOrderNote('โอน 319 ปลายทาง 369'), null);
  assert.equal(parseOrderNote('501/1 32\nบ้านเลขที่ 22/6 ม.1\ncod 249'), null);
  assert.equal(parseOrderNote('ขอบคุณค่ะ'), null);
  assert.equal(parseOrderNote('John Smith\n0812345678\ncod 249'), null);
  assert.equal(parseOrderNote('501/1 32\n10110\ncod 249'), null);
  assert.equal(parseOrderNote(''), null);
  assert.equal(parseOrderNote('501/1 32\n501 ดำ?\ncod 249'), null);
  // A line in codes the parser doesn't follow is kept but flagged, so the team can see what it misses.
  assert.deepEqual(short('501/1 32\n501/2 32 99\ncod 249')?.unknown, ['501/2 32 99']);
});

test('only the page\'s own messages that are notes are extracted from the webhook', () => {
  const notes = extractOrderNotes([{ messaging: [
    { sender: { id: 'page' }, recipient: { id: 'u1' }, timestamp: 1_791_500_000_000, message: { is_echo: true, mid: 'm1', text: '501/1  32\ncod  249' } },
    { sender: { id: 'page' }, recipient: { id: 'u2' }, timestamp: 1_791_500_000_000, message: { is_echo: true, mid: 'm2', text: 'ขอบคุณมากนะคะ' } },
    { sender: { id: 'u3' }, recipient: { id: 'page' }, timestamp: 1_791_500_000_000, message: { mid: 'm3', text: '501/1 32 cod 249' } },
  ] }]);
  assert.deepEqual(notes.map((n) => [n.mid, n.psid]), [['m1', 'u1']]);
});

const order = (no: string, at: string, total: number, items: [string, number][], name_hash: string | null = null): StoredOrder => ({
  order_no: no, date: at.slice(0, 10), created_at: at, total, subtotal: null, discount: null, shipping: null, cost: null, payment: 'cod', paid_at: null,
  units: items.reduce((n, [, q]) => n + q, 0), items: items.map(([sku, qty]) => ({ code: sku.split('-')[0], sku, name: '', qty, price: 0 })), name_hash, campaign_id: null, match: 'none',
});

test('notes are paired with their Page365 order and compared', () => {
  const orders = [
    order('29296', '2026-10-14T13:07:00.000Z', 239, [['NI93-PK-BR-32', 1]], 'h1'),
    order('29290', '2026-10-14T13:20:00.000Z', 239, [['5011-PK-MD-30', 1]], 'h2'),   // customer asked for black NI9
    order('29280', '2026-10-14T14:00:00.000Z', 649, [['5011-PK-MD-32', 1], ['5012-PK-BL-32', 1], ['5013-PK-BK-32', 1]]),
    order('29281', '2026-10-14T14:05:00.000Z', 300, [['3011-PK-MD-34', 1]], 'h4'),
  ];
  const checks = checkNotes([
    { mid: 'a', psid: 'u1', at: '2026-10-14T13:00:00.000Z', text: 'ni9-3 32 1 cod 239', name_hash: 'h1' },
    { mid: 'b', psid: 'u2', at: '2026-10-14T13:15:00.000Z', text: 'Ni9-1 30\ncod 239', name_hash: 'h2' },
    { mid: 'c', psid: 'u3', at: '2026-10-14T14:01:00.000Z', text: '501/1/2/3 32\ncod 649', name_hash: null },
    { mid: 'd', psid: 'u4', at: '2026-10-14T14:02:00.000Z', text: '301/1 34 cod 299', name_hash: 'h4' },
    { mid: 'e', psid: 'u5', at: '2026-10-14T15:00:00.000Z', text: '801/1 30 cod 239', name_hash: 'h9' },
  ], orders);
  assert.deepEqual(checks.map((c) => [c.order_no, c.verdict, c.linked_by]), [
    ['29296', 'same', 'customer'],
    ['29290', 'diff_items', 'customer'],
    ['29280', 'same', 'total'],
    ['29281', 'diff_total', 'customer'],
    [null, 'no_order', null],
  ]);
  assert.deepEqual(checks[1].missing, ['NI91 30 ×1']);
  assert.deepEqual(checks[1].extra, ['5011 30 ×1']);
});

test('each line is matched to a catalog product by code and size, the PK warehouse first', () => {
  const hit = (tab: string, sku: string) => ({ tab, sku, name: '', color: '', price: null, image: '' });
  const cat = new Map([['NI9-3|32', [hit('PK', 'Ni93-PK-BR-32')]], ['501/1|38', [hit('BB', '5011-BB-MD-38'), hit('PK', '5011-PK-MD-38')]]]);
  const [n] = withCatalog([{ items: parseOrderNote('ni9-3 32\n501/1 38\nD99 30\ncod 600')!.items }], cat);
  assert.deepEqual(n.items.map((i) => i.catalog && [i.catalog.sku, i.catalog.others]), [['Ni93-PK-BR-32', []], ['5011-PK-MD-38', ['BB']], null]);
  assert.equal(pickCatalog([]), null);
});

test('list style: "- สีเทา (16-10) 1 ตัว" lines with the size on its own line (15 Oct)', () => {
  const p = parseOrderNote('- สีเทา (16-10) 1 ตัว\n- สีเทาเข้ม (16-12) 1 ตัว\n- สีกากี (16-9) 1 ตัว\n- สีดำ (16-4) 1 ตัว\nsz34 \ncod 1048');
  assert.deepEqual(p?.items.map((i) => `${i.code} ${i.size} ×${i.qty}`), ['16-10 34 ×1', '16-12 34 ×1', '16-9 34 ×1', '16-4 34 ×1']);
  assert.equal(p?.total, 1048);
  assert.deepEqual(parseOrderNote('• ดำ (501/3) 2 ตัว sz32\ncod 449')?.items.map((i) => `${i.code} ${i.size} ×${i.qty}`), ['501/3 32 ×2']);
  assert.deepEqual(parseOrderNote('- เทา (16-10) 1 ตัว\ncod 299')?.unknown.length, 1, 'no size anywhere: kept, flagged');
  assert.equal(parseOrderNote('- คุณสมชาย บ้านเลขที่ 12 ม.3\ncod 299'), null, 'an address is still dropped');
});

test('payment and total first, on their own line (15 Oct)', () => {
  assert.deepEqual(parseOrderNote('cod249\n501/3 34')?.items.map((i) => `${i.code} ${i.size}`), ['501/3 34']);
  assert.equal(parseOrderNote('cod199\nE200 34')?.total, 199);
  assert.equal(parseOrderNote('cod 249 ขอบคุณค่ะ'), null);
});

test('a bank after a transfer total and "2ตัว" quantities are read', () => {
  const n = parseOrderNote('โอน349kb\n301/1 sz34  2ตัว');
  assert.deepEqual(n?.items, [{ code: '301/1', prefix: '3011', size: '34', qty: 2 }]);
  assert.equal(n?.payment, 'transfer');
  assert.equal(n?.total, 349);
  assert.equal(parseOrderNote('501/1 32 x3\ncod 549 บาท')?.items[0].qty, 3);
  assert.equal(parseOrderNote('501/1 32 2 ชิ้น\nโอน 399 กสิกร')?.total, 399);
});
