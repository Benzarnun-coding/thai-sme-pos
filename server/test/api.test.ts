import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, resetDb, type Db } from '../src/db/client.js';
import { seed } from '../src/seed.js';
import { buildServer } from '../src/api/server.js';

let db: Db;
let app: ReturnType<typeof buildServer>;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  await resetDb(); db = await getDb();
  await seed(db, 'climax', { today: new Date('2026-09-06T12:00:00Z') });
  app = buildServer(db); await app.ready();
});
afterAll(async () => { await app.close(); await resetDb(); });

describe('API', () => {
  it('GET /api/health', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect(r.json()).toEqual({ ok: true, db: 'pglite' });
  });
  it('GET /api/stores/climax/signals returns one row per product', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/stores/climax/signals' });
    const rows = r.json() as { sku_group: string; promotable: boolean }[];
    expect(rows.length).toBe(6);
    expect(rows.find((x) => x.sku_group === 'ST')?.promotable).toBe(false);
  });
  it('GET /api/stores/climax/brand returns the seeded docs', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/stores/climax/brand' });
    expect((r.json() as { key: string }[]).map((x) => x.key)).toEqual(['forbidden', 'sizes', 'usp', 'voice']);
  });
  it('POST /api/stores/climax/import/sku accepts csv', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/stores/climax/import/sku', payload: { csv: 'sku,name,qty\nKB-PK-BK-46,ยีนส์ทรงกระบอกเล็ก สีดำ,7\n' } });
    expect(r.json()).toMatchObject({ products: 0, variants: 1, stockRows: 1, errors: [] });
  });
  it('POST /api/stores/climax/sync/facebook fails clearly when not configured', async () => {
    delete process.env.FB_PAGE_ID; delete process.env.FB_AD_ACCOUNT_ID;
    const r = await app.inject({ method: 'POST', url: '/api/stores/climax/sync/facebook' });
    expect(r.statusCode).toBe(400);
  });
});
