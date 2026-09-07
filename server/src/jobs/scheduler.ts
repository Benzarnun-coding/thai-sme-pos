/**
 * In-process scheduler for project 1 (single VPS). Moves to BullMQ + Redis in
 * project 2 when the rules engine needs retries and per-connection rate limits.
 */
import cron from 'node-cron';
import type { Db } from '../db/client.js';
import { facebookOptionsFromEnv, syncFacebook } from '../connectors/facebook.js';

export function startScheduler(db: Db, storeId: string) {
  const every = process.env.FB_SYNC_CRON ?? '5 */6 * * *'; // 5 minutes past every 6 hours
  const o = facebookOptionsFromEnv(storeId);
  if (!o.pageId && !o.adAccountId) {
    console.log('[scheduler] facebook not configured, skipping sync job');
    return;
  }
  cron.schedule(every, async () => {
    const r = await syncFacebook(db, o);
    console.log('[scheduler] facebook sync', JSON.stringify(r));
  }, { timezone: 'Asia/Bangkok' });
  console.log(`[scheduler] facebook sync scheduled: ${every} (Asia/Bangkok)`);
}
