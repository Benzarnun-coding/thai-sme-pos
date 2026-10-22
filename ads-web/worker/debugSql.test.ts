import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOnlySql } from './index.ts';

test('debug SQL: one SELECT/WITH, nothing that writes, capped at 500 rows', () => {
  assert.equal(readOnlySql('SELECT 1;'), 'SELECT * FROM (SELECT 1) LIMIT 500');
  assert.ok(readOnlySql("SELECT * FROM meta_posts WHERE message LIKE '%delete%'"));
  for (const bad of ['', 'DELETE FROM x', 'SELECT 1; DROP TABLE x', 'WITH a AS (SELECT 1) DELETE FROM x', 'PRAGMA table_info(x)', 'UPDATE x SET a = 1']) {
    assert.throws(() => readOnlySql(bad), Error, bad);
  }
});
