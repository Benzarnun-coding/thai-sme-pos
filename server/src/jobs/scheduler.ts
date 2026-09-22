/**
 * In-process scheduler (single VPS). Every enabled box runs on its own cron in
 * Asia/Bangkok time, one at a time, through the same runAgent the Studio's
 * "รันตอนนี้" uses; boxes that received work run right after (event chain).
 * Moves to BullMQ + Redis when there are many stores and retries matter.
 *
 * LOOPDESK_SCHEDULER=off disables it (tests, one-off scripts).
 */
import cron from 'node-cron';
import type { Db } from '../db/client.js';
import { facebookOptionsFromEnv, syncFacebook } from '../connectors/facebook.js';
import { AGENTS } from '../ai/catalog.js';
import { runAgent } from '../ai/jobs.js';
import { nextFire } from '../ai/cron.js';

const TZ = 'Asia/Bangkok';
const state = { enabled: false, storeId: '', started_at: null as string | null, last: {} as Record<string, { at: string; status: string; summary: string }> };
let queue: Promise<unknown> = Promise.resolve();

export function startScheduler(db: Db, storeId: string) {
  const o = facebookOptionsFromEnv(storeId);
  if (o.pageId || o.adAccountId) {
    const every = process.env.FB_SYNC_CRON ?? '5 */6 * * *';
    cron.schedule(every, async () => {
      const r = await syncFacebook(db, o);
      console.log('[scheduler] facebook sync', JSON.stringify(r));
    }, { timezone: TZ });
    console.log(`[scheduler] facebook sync scheduled: ${every} (${TZ})`);
  } else {
    console.log('[scheduler] facebook not configured, skipping sync job');
  }

  if (process.env.LOOPDESK_SCHEDULER === 'off') { console.log('[scheduler] boxes: off (LOOPDESK_SCHEDULER=off)'); return; }
  state.enabled = true; state.storeId = storeId; state.started_at = new Date().toISOString();
  for (const a of AGENTS) {
    if (!a.cron) continue;
    cron.schedule(a.cron, () => {
      // one box at a time, so hand-offs happen in order and the model is not hammered
      queue = queue.then(async () => {
        const r = await runAgent(db, { storeId, slug: a.slug, trigger: 'schedule', by: 'ตัวตั้งเวลา' });
        if (r) { state.last[a.slug] = { at: r.started_at, status: r.status, summary: r.summary }; console.log(`[scheduler] ${a.slug}: ${r.status} — ${r.summary}`); }
      }).catch((e) => console.error('[scheduler]', a.slug, e));
    }, { timezone: TZ });
  }
  console.log(`[scheduler] ${AGENTS.filter((a) => a.cron).length} boxes scheduled (${TZ})`);
}

/** For the Studio header: is it on, and when does each box run next. */
export function schedulerStatus() {
  const now = new Date();
  return {
    enabled: state.enabled, timezone: TZ, started_at: state.started_at,
    boxes: AGENTS.filter((a) => a.cron).map((a) => ({ slug: a.slug, name: a.name, cron: a.cron, next: nextFire(a.cron!, now)?.toISOString() ?? null, last: state.last[a.slug] ?? null }))
      .sort((x, y) => (x.next ?? '').localeCompare(y.next ?? '')),
  };
}
