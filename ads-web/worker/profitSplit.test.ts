import assert from 'node:assert/strict';
import { test } from 'node:test';
import { profit } from '../web/src/profit.ts';
import { makeLookup } from '../web/src/purchase.ts';

test('/catalog/profit splits a Page365 order by line totals ("x3 THB 1107" is the line, not the piece)', () => {
  const r = profit({
    from: '2026-10-14', to: '2026-10-14', marketplace: [], sheetItems: [], spend: [], spendError: null, page365Days: ['2026-10-14'], mpFiles: [],
    page365: [{ order_no: '1', date: '2026-10-14', total: 1296, fee: 0, items: [
      { sku: 'A-PK-BK-30', name: 'A', qty: 1, price: 189 },
      { sku: 'B-PK-BK-32', name: 'B', qty: 3, price: 1107 },
    ] }],
  } as any, makeLookup([], new Map()), new Map());
  const rev = Object.fromEntries(r.products.map((p) => [p.label, Math.round(p.revenue)]));
  assert.deepEqual(rev, { A: 189, B: 1107 });
});
