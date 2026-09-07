/**
 * Database client.
 *
 * - DATABASE_URL set   → real PostgreSQL via `pg` (production).
 * - otherwise          → PGlite (embedded Postgres) stored under server/data/pglite,
 *                        or fully in-memory when PGLITE_MEMORY=1 (tests).
 *
 * Both expose the same tiny interface so the rest of the code never cares.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  kind: 'pg' | 'pglite';
}

let instance: Db | null = null;

export async function getDb(): Promise<Db> {
  if (instance) return instance;
  instance = process.env.DATABASE_URL ? await openPg(process.env.DATABASE_URL) : await openPglite();
  return instance;
}

/** For tests: throw away the shared instance so each suite starts clean. */
export async function resetDb(): Promise<void> {
  if (instance) await instance.close();
  instance = null;
}

async function openPg(url: string): Promise<Db> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url });
  return {
    kind: 'pg',
    async query(sql, params = []) {
      const r = await pool.query(sql, params);
      return r.rows;
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
  };
}

async function openPglite(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_MEMORY
    ? undefined
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/pglite');
  const db = dir ? new PGlite(dir) : new PGlite();
  await db.waitReady;
  return {
    kind: 'pglite',
    async query(sql, params = []) {
      const r = await db.query(sql, params as never[]);
      return r.rows as never[];
    },
    async exec(sql) {
      await db.exec(sql);
    },
    async close() {
      await db.close();
    },
  };
}
