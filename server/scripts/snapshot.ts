/**
 * Freeze the demo API into a JSON file.
 *
 * The published demo is a single HTML page with no server behind it, so every
 * GET the app makes has to be answered from a snapshot taken here. Run against
 * an in-memory database so the snapshot is reproducible and never touches the
 * local dev data.
 *
 *   pnpm --dir server exec tsx scripts/snapshot.ts <out.json>
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../src/db/client.js';
import { seed } from '../src/seed.js';
import { buildServer } from '../src/api/server.js';

process.env.PGLITE_MEMORY = '1';
process.env.LOOPDESK_AI = 'demo';   // the published demo has no model behind it
delete process.env.FB_APP_ID;      // force the connect flow into demo mode
delete process.env.FB_APP_SECRET;

const STORE = 'climax';
const out = process.argv[2] ?? path.resolve('snapshot.json');

const db = await getDb();
await seed(db, STORE, { sales: true, facebookDemo: true });
const app = buildServer(db);
await app.ready();

const get = async (url: string) => (await app.inject({ method: 'GET', url })).json();

const snapshot: Record<string, unknown> = {
  stores: await get('/api/stores'),
  providers: await get('/api/providers'),
  summary: await get(`/api/stores/${STORE}/summary`),
  signals: await get(`/api/stores/${STORE}/signals`),
  products: await get(`/api/stores/${STORE}/products`),
  brand: await get(`/api/stores/${STORE}/brand`),
  competitors: await db.query('select page_name, ad_text, hook, price_hint, format, first_seen::text from competitor_ad where store_id=$1 and active order by first_seen desc', [STORE]),
  posts: await get(`/api/stores/${STORE}/posts`),
  ads: await get(`/api/stores/${STORE}/ads`),
  audit: await get(`/api/stores/${STORE}/audit`),
  connections: await get(`/api/stores/${STORE}/connections`),
  catalog: await get('/api/studio/catalog'),
  trends: (await get(`/api/stores/${STORE}/trends`) as { trends: unknown[] }).trends,
};
// Run the whole loop once, in order, so every card shows a last run and the
// report has something to read. Same code path the scheduler uses.
for (const a of (snapshot.catalog as { agents: { slug: string }[] }).agents) {
  await app.inject({ method: 'POST', url: `/api/stores/${STORE}/agents/${a.slug}/run`, payload: { by: 'ตัวตั้งเวลา' } });
}
const asScheduled = <T extends { trigger: string; by: string | null }>(r: T): T => ({ ...r, trigger: 'schedule', by: null });
snapshot.agents = (await get(`/api/stores/${STORE}/agents`) as { last_run: { trigger: string; by: string | null } | null }[])
  .map((a) => ({ ...a, last_run: a.last_run ? asScheduled(a.last_run) : null }));
snapshot.runs = (await get(`/api/stores/${STORE}/runs?limit=100`) as { trigger: string; by: string | null }[]).map(asScheduled);

// Walk the connect flow once so the page can replay the account picker offline.
const start = (await app.inject({ method: 'POST', url: `/api/stores/${STORE}/connect/facebook`, payload: { by: 'เจ้าของร้าน' } })).json() as { grant_id: string; note: string };
snapshot.connect = {
  note: start.note,
  picker: await get(`/api/stores/${STORE}/connect/facebook/accounts?grant=${start.grant_id}`),
};

await app.close();
fs.writeFileSync(out, JSON.stringify(snapshot));
console.log(`✔ snapshot → ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
process.exit(0);
