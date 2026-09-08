import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, resetDb, type Db } from '../src/db/client.js';
import { seed } from '../src/seed.js';
import { buildProductSignals, storeSummary } from '../src/signals/build.js';
import { importRows } from '../src/catalog/import.js';

let db: Db;
const today = new Date('2026-09-06T12:00:00Z');

beforeAll(async () => {
  await resetDb();
  db = await getDb();
  await seed(db, 'climax', { today });
});
afterAll(async () => { await resetDb(); });

describe('buildProductSignals', () => {
  it('flags the stretch jeans as missing core sizes 30 and 32', async () => {
    const s = await buildProductSignals(db, 'climax', today);
    const st = s.find((x) => x.sku_group === 'ST')!;
    expect(st.missing_core_sizes).toEqual(['30', '32']);
    expect(st.core_size_ok).toBe(false);
    expect(st.promotable).toBe(false);
    expect(st.note).toBe('ขาดไซส์ 30, 32');
  });
  it('marks the black straight-leg jeans as promotable with all core sizes', async () => {
    const s = await buildProductSignals(db, 'climax', today);
    const kb = s.find((x) => x.sku_group === 'KB')!;
    expect(kb.core_size_ok).toBe(true);
    expect(kb.promotable).toBe(true);
    expect(kb.stock_by_size['32']).toBe(31 + 22); // both colours
    expect(kb.stock_by_color_size['BK']['44']).toBe(4);
    expect(kb.sales_7d).toBeGreaterThan(0);
  });
  it('uses the category-specific rule for women\'s jeans', async () => {
    const s = await buildProductSignals(db, 'climax', today);
    const df = s.find((x) => x.sku_group === 'DF')!;
    expect(df.core_sizes).toEqual(['28', '30', '32']);
    expect(df.core_size_ok).toBe(true);
  });
  it('recomputes after a new stock snapshot (append-only)', async () => {
    await importRows(db, 'climax', [{ sku: 'ST-PK-MW-30', name: 'ยีนส์ผ้ายืด ใส่สบาย', qty: 20 }, { sku: 'ST-PK-MW-32', name: 'ยีนส์ผ้ายืด ใส่สบาย', qty: 20 }], 'test');
    const s = await buildProductSignals(db, 'climax', today);
    const st = s.find((x) => x.sku_group === 'ST')!;
    expect(st.core_size_ok).toBe(true);
    const snapshots = await db.query<{ n: string }>(`select count(*)::text as n from stock_level l join variant v on v.id=l.variant_id where v.sku='ST-PK-MW-30'`);
    expect(Number(snapshots[0].n)).toBe(2);
  });
});

describe('storeSummary', () => {
  it('can seed without demo facebook data', async () => {
    await resetDb(); const fresh = await getDb();
    await seed(fresh, 'climax', { today, facebookDemo: false });
    const sum = await storeSummary(fresh, 'climax', today);
    expect(sum.ad_spend_7d).toBe(0); expect(sum.roas_7d).toBeNull(); expect(sum.followers).toBeNull();
    await resetDb(); db = await getDb(); await seed(db, 'climax', { today });
  });
  it('returns 7-day sales and a 14-day daily series', async () => {
    const sum = await storeSummary(db, 'climax', today);
    expect(sum.sales_7d).toBeGreaterThan(0);
    expect(sum.daily.length).toBe(14);
    expect(sum.ad_spend_7d).toBeGreaterThan(0);      // demo ads seeded
    expect(sum.roas_7d).toBeGreaterThan(0);
    expect(sum.followers).toBe(44000);
  });
});
