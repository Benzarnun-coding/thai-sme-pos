import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { buildProductSignals, storeSummary } from '../signals/build.js';
import { importRows, parseCsv } from '../catalog/import.js';
import { getBrandDocs } from '../knowledge/brand.js';
import { facebookOptionsFromEnv, syncFacebook } from '../connectors/facebook.js';

export function buildServer(db: Db) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  app.register(cors, { origin: true });

  app.get('/api/health', async () => ({ ok: true, db: db.kind }));

  app.get('/api/stores', async () => db.query('select id, name, type, timezone from store order by name'));

  app.get('/api/stores/:id/summary', async (req) => {
    const { id } = req.params as { id: string };
    return storeSummary(db, id);
  });

  app.get('/api/stores/:id/signals', async (req) => {
    const { id } = req.params as { id: string };
    return buildProductSignals(db, id);
  });

  app.get('/api/stores/:id/products', async (req) => {
    const { id } = req.params as { id: string };
    return db.query(
      `select p.id, p.name, p.category, p.sku_group, p.base_price, p.set_price, p.is_promotable,
              count(v.id)::int as variants
         from product p left join variant v on v.product_id = p.id
        where p.store_id=$1 group by p.id order by p.name`, [id]);
  });

  app.get('/api/stores/:id/products/:pid/stock', async (req) => {
    const { id, pid } = req.params as { id: string; pid: string };
    return db.query(
      `select v.sku, v.color, v.size, v.location, v.price, l.qty, l.snapshot_at
         from variant v join product p on p.id=v.product_id
         left join v_stock_latest l on l.variant_id=v.id
        where p.store_id=$1 and v.product_id=$2 order by v.color, v.size`, [id, pid]);
  });

  app.get('/api/stores/:id/connections', async (req) => {
    const { id } = req.params as { id: string };
    return db.query('select id, channel, external_account_id, display_name, capabilities, status, last_sync_at, last_error, token_expires_at from connection where store_id=$1 order by channel', [id]);
  });

  app.get('/api/stores/:id/brand', async (req) => {
    const { id } = req.params as { id: string };
    return getBrandDocs(db, id);
  });

  app.get('/api/stores/:id/posts', async (req) => {
    const { id } = req.params as { id: string };
    return db.query(
      `select distinct on (external_post_id) external_post_id, created_time, message, permalink, reach, engaged, clicks, comments, shares, reactions, date
         from fact_post_insight_daily where store_id=$1 order by external_post_id, date desc`, [id])
      .then((rows) => rows.sort((a, b) => String(b.created_time).localeCompare(String(a.created_time))));
  });

  app.get('/api/stores/:id/ads', async (req) => {
    const { id } = req.params as { id: string };
    return db.query(
      `select external_ad_id, max(ad_name) as ad_name, max(campaign_name) as campaign_name, min(date)::text as first_date, max(date)::text as last_date,
              sum(impressions)::int as impressions, sum(clicks)::int as clicks, sum(spend)::numeric(12,2) as spend,
              sum(conversations)::int as conversations, sum(purchases)::int as purchases, sum(revenue)::numeric(12,2) as revenue
         from fact_ad_insight_daily where store_id=$1 group by external_ad_id order by max(date) desc, spend desc`, [id]);
  });

  app.post('/api/stores/:id/import/sku', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ csv: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'body must be {csv: string}' });
    const rows = parseCsv(body.data.csv);
    return importRows(db, id, rows, 'api');
  });

  app.post('/api/stores/:id/sync/facebook', async (req, reply) => {
    const { id } = req.params as { id: string };
    const o = facebookOptionsFromEnv(id);
    if (!o.pageId && !o.adAccountId) return reply.code(400).send({ error: 'FB_PAGE_ID / FB_AD_ACCOUNT_ID not configured' });
    return syncFacebook(db, o);
  });

  app.get('/api/stores/:id/audit', async (req) => {
    const { id } = req.params as { id: string };
    return db.query('select actor, actor_type, action, target, after, at from audit_log where store_id=$1 order by at desc limit 50', [id]);
  });

  return app;
}
