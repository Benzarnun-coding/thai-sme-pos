// Usage: FB_PAGE_ID=... FB_PAGE_TOKEN=... [FB_AD_ACCOUNT_ID=...] pnpm sync:facebook [storeId=climax]
import { getDb } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { facebookOptionsFromEnv, syncFacebook } from './facebook.js';

const storeId = process.argv[2] ?? 'climax';
const db = await getDb();
await migrate(db);
const o = facebookOptionsFromEnv(storeId);
if (!o.pageId && !o.adAccountId) {
  console.error('set FB_PAGE_ID + FB_PAGE_TOKEN and/or FB_AD_ACCOUNT_ID + FB_ADS_TOKEN');
  process.exit(1);
}
console.log(JSON.stringify(await syncFacebook(db, o), null, 2));
await db.close();
