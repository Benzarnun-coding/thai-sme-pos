// Tests only: a D1 stand-in over node:sqlite, enough for prepare().bind().all()/first()/run().
import { DatabaseSync } from 'node:sqlite';

export function sqliteD1(schema: string): { raw: DatabaseSync; d1: D1Database } {
  const raw = new DatabaseSync(':memory:');
  raw.exec(schema);
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: raw.prepare(sql).all(...(args as any[])) }),
    first: async () => raw.prepare(sql).get(...(args as any[])) ?? null,
    run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...(args as any[])).changes) } }),
  });
  return { raw, d1: { prepare: (sql: string) => stmt(sql) } as unknown as D1Database };
}
