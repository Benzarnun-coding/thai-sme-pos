import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planNotePurchases } from './notePurchases.ts';

// D1 stand-in: no earlier sales stored.
const db = { prepare: () => ({ bind: () => ({ first: async () => null }) }) } as unknown as D1Database;
const note = (mid: string, psid: string, at: string, text: string) => ({ mid, psid, at, text, name_hash: null });

test('each note is one sale at its own time; the same customer again within 2 hours is not', async () => {
  const plan = await planNotePurchases(db, [
    note('a', 'u1', '2026-10-15T10:00:00.000Z', '501/1 32\ncod 249'),
    note('b', 'u1', '2026-10-15T10:30:00.000Z', '501/1 32\ncod 249'),
    note('c', 'u1', '2026-10-15T13:00:00.000Z', '501/2 32\ncod 249'),
    note('d', 'u2', '2026-10-15T10:05:00.000Z', 'D01 D02 sz30\ncod 448'),
  ]);
  assert.deepEqual(plan.map((p) => [p.mid, p.send, p.value]), [['a', true, 249], ['d', true, 448], ['b', false, 249], ['c', true, 249]]);
});
