import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimNote, WAITING } from './autoFill.ts';
import { sqliteD1 } from './sqliteD1.ts';

test('a note is filled by one webhook delivery only: a re-sent delivery finds it taken or done', async () => {
  const { raw, d1 } = sqliteD1(`CREATE TABLE order_notes (mid TEXT PRIMARY KEY, psid TEXT, at TEXT, text TEXT, name_hash TEXT,
    filled_at TEXT, filled_by TEXT, fill_order_no INTEGER, fill_error TEXT)`);
  raw.exec(`INSERT INTO order_notes (mid, psid, at, text) VALUES ('m1', 'p', '2026-10-15T10:00:00Z', '501/1 32 cod 239'),
    ('m2', 'p', '2026-10-15T10:00:00Z', '009-1 30 โอน 189')`);
  assert.equal(await claimNote(d1, 'm1'), true);   // first delivery
  assert.equal(await claimNote(d1, 'm1'), false);  // Meta sends it again while it is being filled
  assert.equal((raw.prepare("SELECT fill_error FROM order_notes WHERE mid = 'm1'").get() as any).fill_error, WAITING); // the sweep retries it if cut short
  raw.exec(`UPDATE order_notes SET filled_at = '2026-10-15T10:01:00Z', fill_error = NULL WHERE mid = 'm2'`);
  assert.equal(await claimNote(d1, 'm2'), false);  // already filled
});
