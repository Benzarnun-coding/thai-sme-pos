import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normaliseRow } from '../web/src/catalog.ts';
import { dayOf, defaultExcluded, guessMap, money, parseMoney, platformOfOrderNo, tableFromGrid } from '../web/src/money.ts';
import { profit } from '../web/src/profit.ts';
import { makeLookup } from '../web/src/purchase.ts';
import type { ProfitData } from '../web/src/api.ts';

test('columns are guessed for TikTok order exports and Shopee income reports', () => {
  const tiktok = guessMap(['Order ID', 'Order Status', 'Seller SKU', 'Quantity', 'SKU Subtotal After Discount', 'Order Amount', 'Created Time', 'Buyer Username', 'Recipient']);
  assert.equal(tiktok.order, 'Order ID');
  assert.equal(tiktok.amount, 'Order Amount');
  assert.equal(tiktok.kind, 'gross');
  assert.equal(tiktok.sku, 'Seller SKU');
  assert.equal(tiktok.qty, 'Quantity');
  assert.equal(tiktok.itemAmount, 'SKU Subtotal After Discount');
  assert.equal(tiktok.date, 'Created Time');
  assert.equal(tiktok.status, 'Order Status');
  const shopee = guessMap(['หมายเลขคำสั่งซื้อ', 'วันที่ทำการสั่งซื้อ', 'ค่าคอมมิชชั่น', 'ค่าธรรมเนียมการทำธุรกรรม', 'ค่าบริการ', 'ค่าจัดส่งที่ชำระโดยผู้ซื้อ', 'จำนวนเงินที่โอน']);
  assert.equal(shopee.order, 'หมายเลขคำสั่งซื้อ');
  assert.equal(shopee.amount, 'จำนวนเงินที่โอน');
  assert.equal(shopee.kind, 'net', 'a payout amount already has fees off');
  assert.deepEqual(shopee.fees, []);
  const gross = guessMap(['หมายเลขคำสั่งซื้อ', 'ยอดรวมที่ผู้ซื้อชำระ', 'ค่าคอมมิชชั่น', 'ค่าธรรมเนียมการทำธุรกรรม', 'ส่วนลดค่าจัดส่ง']);
  assert.equal(gross.kind, 'gross');
  assert.deepEqual(gross.fees, ['ค่าคอมมิชชั่น', 'ค่าธรรมเนียมการทำธุรกรรม']);
});

test('the header can sit under title rows', () => {
  const t = tableFromGrid([
    ['Income report'], ['Shop: PK-JEANS'], [],
    ['หมายเลขคำสั่งซื้อ', 'จำนวนเงินที่โอน', ''],
    ['261011CB71A2KT', '1,234.50', 'x'],
    ['', '', ''],
  ]);
  assert.equal(t.headerRow, 3);
  assert.deepEqual(t.headers, ['หมายเลขคำสั่งซื้อ', 'จำนวนเงินที่โอน', 'คอลัมน์ 3']);
  assert.equal(t.rows.length, 1);
});

test('numbers, dates and platforms', () => {
  assert.equal(money('฿1,234.50'), 1234.5);
  assert.equal(money('(12.00)'), -12);
  assert.equal(money(''), null);
  assert.equal(dayOf('2026-10-13 10:27:00'), '2026-10-13');
  assert.equal(dayOf('13/10/2026 10:27'), '2026-10-13');
  assert.equal(dayOf('13/10/2569'), '2026-10-13');
  assert.equal(dayOf('46308.5'), '2026-10-13');
  assert.equal(platformOfOrderNo('586549691030078934'), 'TikTok');
  assert.equal(platformOfOrderNo('261011CB71A2KT'), 'Shopee');
});

test('one order over several item rows: order amount taken once, item amounts summed; cancelled left out', () => {
  const map = { ...guessMap(['Order ID', 'Order Status', 'Seller SKU', 'Quantity', 'SKU Subtotal After Discount', 'Order Amount', 'Created Time']) };
  const rows: Record<string, string>[] = [
    { 'Order ID': 'Platform unique order ID.', 'Order Amount': '' },
    { 'Order ID': '586549691030078934', 'Order Status': 'Completed', 'Seller SKU': '5011-PK-MD-30', Quantity: '2', 'SKU Subtotal After Discount': '398', 'Order Amount': '448', 'Created Time': '13/10/2026 10:00:00' },
    { 'Order ID': '586549691030078934', 'Order Status': 'Completed', 'Seller SKU': '5011-PK-MD-32', Quantity: '1', 'SKU Subtotal After Discount': '199', 'Order Amount': '448', 'Created Time': '13/10/2026 10:00:00' },
    { 'Order ID': '586549691030078999', 'Order Status': 'Cancelled', 'Seller SKU': '5011-PK-MD-30', Quantity: '1', 'SKU Subtotal After Discount': '199', 'Order Amount': '199', 'Created Time': '13/10/2026 11:00:00' },
  ];
  const ex = defaultExcluded(rows, map.status);
  assert.deepEqual([...ex], ['Cancelled']);
  const p = parseMoney(rows, map, 'auto', ex);
  assert.equal(p.skipped, 1);
  assert.equal(p.orders.length, 1);
  const o = p.orders[0];
  assert.equal(o.amount, 448);
  assert.equal(o.platform, 'TikTok');
  assert.equal(o.date, '2026-10-13');
  assert.deepEqual(o.items, [{ sku: '5011-PK-MD-30', qty: 2, amount: 398 }, { sku: '5011-PK-MD-32', qty: 1, amount: 199 }]);
  assert.deepEqual(p.statuses.map((s) => [s.status, s.orders, s.excluded]), [['Completed', 1, false], ['Cancelled', 1, true]]);
});

const ROWS = [
  normaliseRow({ tab: 'PK', sku: '5011-PK-MD-30', code: '501/1', color: 'MD', size: '30', cost: '150', price: '199' }),
  normaliseRow({ tab: 'PK', sku: '2003-PK-MR-32', code: '200/3', color: 'MR', size: '32', cost: '100', price: '299' }),
];

test('profit: channels add up, products add up to the channels, order money split by item value', () => {
  const d: ProfitData = {
    from: '2026-10-13', to: '2026-10-13',
    page365: [{ order_no: 'P1', date: '2026-10-13', total: 549, fee: 60, items: [{ sku: '5011-PK-MD-30', name: '501', qty: 3, price: 199 }] }],
    marketplace: [
      { order_no: '586549691030078934', platform: 'TikTok', date: '2026-10-13', amount: 448, kind: 'gross', fees: 48, status: '', items: null, file: 'a.xlsx' },
      { order_no: '261011CB71A2KT', platform: 'Shopee', date: '2026-10-13', amount: 250, kind: 'net', fees: null, status: '', items: null, file: 'b.xlsx' },
    ],
    sheetItems: [
      { order_no: '586549691030078934', date: '2026-10-13', store: 'TikTok · STM-SHOP', sku: '5011-PK-MD-30', qty: 1 },
      { order_no: '586549691030078934', date: '2026-10-13', store: 'TikTok · STM-SHOP', sku: '2003-PK-MR-32', qty: 1 },
      { order_no: '261011CB71A2KT', date: '2026-10-13', store: 'Shopee · PK-JEANS', sku: '2003-PK-MR-32', qty: 1 },
      { order_no: '261011ZZZZZZZZ', date: '2026-10-13', store: 'Shopee · PK-JEANS', sku: '5011-PK-MD-30', qty: 1 },
    ],
    spend: [{ date: '2026-10-13', spend: 100 }], spendError: null, page365Days: ['2026-10-13'], mpFiles: [],
  };
  const r = profit(d, makeLookup(ROWS, new Map()), new Map());
  const fb = r.channels.find((c) => c.channel === 'Facebook')!;
  assert.deepEqual([fb.orders, fb.pieces, fb.revenue, fb.fees, fb.cost, fb.ads, fb.profit], [1, 3, 549, 60, 450, 100, -61]);
  const tt = r.channels.find((c) => c.channel === 'TikTok')!;
  assert.deepEqual([tt.revenue, tt.fees, tt.cost, tt.profit], [448, 48, 250, 150]);
  const sp = r.channels.find((c) => c.channel === 'Shopee')!;
  assert.deepEqual([sp.orders, sp.revenue, sp.fees, sp.cost, sp.noMoney, sp.netFiles], [1, 250, 0, 100, 1, true]);
  assert.equal(r.total.profit, fb.profit + tt.profit + sp.profit);
  // TikTok's 448 split 199 : 299 by the catalog's selling price
  const p200 = r.products.find((p) => p.spu === '2003-PK-MR')!;
  assert.equal(Math.round(p200.revenue * 100) / 100, Math.round((448 * 299 / 498 + 250) * 100) / 100);
  const sum = r.products.reduce((t, p) => t + p.revenue, 0);
  assert.equal(Math.round(sum), Math.round(r.total.revenue));
});
