/**
 * Demo seed: store "climax", size rules, sample SKU catalog with stock,
 * 30 days of synthetic POS sales, brand docs, and connection placeholders.
 * Real Facebook data arrives via `pnpm sync:facebook` once tokens are set.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, type Db } from './db/client.js';
import { migrate } from './db/migrate.js';
import { importRows, parseCsv } from './catalog/import.js';
import { loadBrandFolder } from './knowledge/brand.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function seed(db: Db, storeId = 'climax', opts: { sales?: boolean; today?: Date } = {}) {
  await migrate(db);
  await db.query(
    `insert into store(id, name, type, settings) values ($1,$2,$3,$4)
     on conflict (id) do update set name=excluded.name, type=excluded.type`,
    [storeId, 'กางเกงยีนส์ชาย Climax by PKjeans', 'กางเกงยีนส์ชาย · ปลีก + ขายส่ง', JSON.stringify({ dailyCap: 1500, monthlyCap: 30000 })],
  );
  await db.query(
    `insert into size_rule(store_id, category, core_sizes, min_qty_per_size) values ($1,'*',$2,6)
     on conflict (store_id, category) do update set core_sizes=excluded.core_sizes, min_qty_per_size=excluded.min_qty_per_size`,
    [storeId, ['30', '32', '34']],
  );
  await db.query(
    `insert into size_rule(store_id, category, core_sizes, min_qty_per_size) values ($1,'ผู้หญิง ขายาว',$2,6)
     on conflict (store_id, category) do update set core_sizes=excluded.core_sizes`,
    [storeId, ['28', '30', '32']],
  );
  await db.query(
    `insert into size_rule(store_id, category, core_sizes, min_qty_per_size) values ($1,'ยูนิเซ็กซ์ ขายาว',$2,6)
     on conflict (store_id, category) do update set core_sizes=excluded.core_sizes`,
    [storeId, ['FS']],
  );

  const csv = fs.readFileSync(path.join(here, '../data/sample-sku.csv'), 'utf8');
  const imported = await importRows(db, storeId, parseCsv(csv), 'seed:sample-sku.csv');

  for (const [channel, name, ext] of [
    ['facebook', 'กางเกงยีนส์ชาย Climax by PKjeans', process.env.FB_PAGE_ID ?? null],
    ['pos', 'Bigseller / POS (CSV import)', null],
  ] as const) {
    await db.query(
      `insert into connection(id, store_id, channel, external_account_id, display_name, capabilities, token_ref, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (store_id, channel, external_account_id) do update set display_name=excluded.display_name`,
      [`${storeId}-${channel}`, storeId, channel, ext, name,
        JSON.stringify(channel === 'facebook' ? { insights: true, post: false, ads: false } : { import: true }),
        channel === 'facebook' ? 'FB_PAGE_TOKEN' : null,
        channel === 'facebook' && process.env.FB_PAGE_TOKEN ? 'connected' : channel === 'pos' ? 'connected' : 'disconnected'],
    );
  }

  const keys = await loadBrandFolder(db, storeId, path.join(here, '../knowledge/climax'));

  let salesRows = 0;
  if (opts.sales !== false) salesRows = await seedSales(db, storeId, opts.today ?? new Date());
  return { imported, brandKeys: keys, salesRows };
}

/** Deterministic pseudo-random 30-day sales so the dashboard has a curve. */
async function seedSales(db: Db, storeId: string, today: Date) {
  const variants = await db.query<{ id: string; price: string; size: string; sku_group: string }>(
    `select v.id, coalesce(v.price, p.base_price)::text as price, v.size, p.sku_group from variant v join product p on p.id=v.product_id where p.store_id=$1`, [storeId]);
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const weight = (v: { size: string; sku_group: string }) => {
    const core = ['30', '32', '34', 'FS'].includes(v.size) ? 1.8 : 1;
    const hot: Record<string, number> = { KB: 2.2, ST: 1.6, SH: 1.9, SP: 1.4, CH: 1.1, DF: 0.8 };
    return core * (hot[v.sku_group] ?? 1);
  };
  let rows = 0;
  for (let back = 29; back >= 0; back--) {
    const d = new Date(today); d.setUTCDate(d.getUTCDate() - back);
    const date = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    const dayFactor = (dow === 0 || dow === 6 ? 1.35 : 1) * (1 + (29 - back) * 0.012); // weekends + gentle growth
    for (const v of variants) {
      const expected = 0.35 * weight(v) * dayFactor;
      const qty = Math.round(expected * (0.4 + rnd() * 1.4));
      if (qty <= 0) continue;
      const channel = rnd() < 0.55 ? 'facebook_chat' : rnd() < 0.5 ? 'pos' : 'shopee';
      await db.query(
        `insert into fact_sales_daily(store_id, date, variant_id, channel, qty, revenue) values ($1,$2,$3,$4,$5,$6)
         on conflict (store_id, date, variant_id, channel) do update set qty=excluded.qty, revenue=excluded.revenue`,
        [storeId, date, v.id, channel, qty, qty * Number(v.price)],
      );
      rows++;
    }
  }
  return rows;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = await getDb();
  const r = await seed(db, process.env.STORE_ID ?? 'climax');
  console.log(JSON.stringify(r, null, 2));
  await db.close();
}
