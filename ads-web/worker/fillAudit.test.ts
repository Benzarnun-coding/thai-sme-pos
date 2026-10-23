import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diff, expected, stopReason } from './fillAudit.ts';

const bill = (items: [string, number][], total: number, cod = true) => ({ items: items.map(([code, quantity]) => ({ id: 1, name: '', note: null, price: 0, quantity, variant: { id: 1, code, product_id: 1 } })), total, cod });

test('a bill as the note said is ok; what an admin changed is named', () => {
  const want = expected('501/1/2 32\ncod 448')!;
  assert.deepEqual(diff(want, bill([['5011-PK-MD-32', 1], ['5012-PK-NV-32', 1]], 448)), []);
  assert.deepEqual(diff(want, bill([['5011-PK-MD-34', 1], ['5012-PK-NV-34', 1]], 448)), ['size']);
  assert.deepEqual(diff(want, bill([['5011-PK-MD-32', 2]], 448)), ['items']);
  assert.deepEqual(diff(want, bill([['5011-PK-MD-32', 1]], 249)), ['qty', 'total']);
  assert.deepEqual(diff(want, bill([['5011-PK-MD-32', 1], ['5012-PK-NV-32', 1]], 448, false)), ['payment']);
  assert.deepEqual(diff(expected('D01 D02 34\ncod 448')!, bill([['D01-PK-NV-34', 1], ['D02-PK-MD-34', 1]], 448)), [], 'letter codes');
  assert.equal(expected('980 ดำกรม 1\ncod 149'), null, 'colour names: not compared');
});

test('stop reasons fall into a few groups', () => {
  assert.equal(stopReason('ต้องให้คนดู: ในแชทตกลงยอด 349 แต่สรุปไว้ 299 — เช็กกับลูกค้า/แอดมิน'), 'ยอดแชทไม่ตรง');
  assert.equal(stopReason('ต้องให้คนดู: NI9-2 ไม่มีไซส์ 29 — รุ่นนี้มี 28, 30'), 'ไซส์ไม่มี');
  assert.equal(stopReason('ต้องให้คนดู: ไม่พบรุ่น SK004 ใน Page365'), 'หารุ่นไม่เจอ');
  assert.equal(stopReason('ต้องให้คนดู: ลูกค้าขอยกเลิกในแชท (และยังไม่ได้สั่งใหม่)'), 'ลูกค้ายกเลิก');
});

test('#29981: a bill number Page365 reused is measured against its own customer\'s note, not the deleted draft\'s', async () => {
  const { auditStep } = await import('./fillAudit.ts');
  const { sqliteD1 } = await import('./sqliteD1.ts');
  const { raw, d1 } = sqliteD1(`CREATE TABLE order_notes (mid TEXT PRIMARY KEY, psid TEXT, at TEXT, text TEXT, name_hash TEXT, filled_at TEXT, filled_by TEXT, fill_order_no INTEGER, fill_error TEXT);
    CREATE TABLE meta_capi (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE fill_audit (no INTEGER PRIMARY KEY, mid TEXT NOT NULL, note_at TEXT NOT NULL, filled_by TEXT, outcome TEXT NOT NULL, reason TEXT, edits TEXT, address TEXT, final_stage TEXT, checked_at TEXT NOT NULL)`);
  const day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  raw.exec(`INSERT INTO order_notes VALUES
    ('l200', 'p298', '${day}T12:32:06Z', 'L200 sz30 1\ncod 509', NULL, '${day}T12:32:25Z', 'auto', 29981, NULL),
    ('r501', 'p371', '${day}T13:41:49Z', '501/3 sz31 2\ncod 448', NULL, '${day}T13:42:08Z', 'auto', 29981, NULL)`);
  globalThis.fetch = (async (url: string) => {
    const path = new URL(url).pathname.replace('/115748303500549/', '');
    if (path === 'orders.json') return new Response(JSON.stringify({ orders: [{ id: 5, no: 29981, stage: 'shipped' }] }));
    return new Response(JSON.stringify({ id: 5, no: 29981, stage: 'shipped', customer_fbid: 'p371', cod: true, total: 448, structural_address: null,
      items: [{ id: 1, name: '501/3', note: null, price: 738, quantity: 2, variant: { id: 1, code: '5013-PK-BL-31', product_id: 1 } }] }));
  }) as typeof fetch;
  // One note per step, as in production (the L200 note's step came first and wrote "edited: qty, total").
  assert.equal(await auditStep({ DB: d1, P365_COOKIE: 'x' } as any, { force: true, limit: 1 }), 1);
  assert.equal(await auditStep({ DB: d1, P365_COOKIE: 'x' } as any, { force: true, limit: 1 }), 0);
  const row = raw.prepare('SELECT * FROM fill_audit').get() as any;
  assert.deepEqual([row.no, row.mid, row.outcome, row.edits], [29981, 'r501', 'ok', '[]']);
});
