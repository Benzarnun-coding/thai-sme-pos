import assert from 'node:assert/strict';
import { test } from 'node:test';
import { friendlyD1Error, loadMetaData } from './metadata.ts';
import { sqliteD1 } from './sqliteD1.ts';

// Since ~13 Oct 2026 Meta's one-call daily report (time_increment=1) comes back almost empty while the plain
// report is fine; the daily rows are then rebuilt one day at a time.
test('daily spend falls back to one-day reports when the daily report misses most of the window', async () => {
  const { d1 } = sqliteD1('CREATE TABLE meta_cache (key TEXT PRIMARY KEY, fetched_at TEXT, data TEXT); CREATE TABLE budget_changes (id INTEGER PRIMARY KEY)');
  const m = (spend: number) => ({ spend, impressions: 1, clicks: 1, ctr: 0, cpc: 0, frequency: 0, purchases: 2, purchase_value: 400, cpa: 1, roas: 1, messages: 0, cost_per_message: 1 });
  const asked: string[] = [];
  const meta: any = {
    accountName: async () => 'PkJeans (THB)',
    listEntities: async () => [],
    dailyCampaignInsights: async () => [{ campaign_id: 'c1', date: '2026-10-14', spend: 5, impressions: 0, clicks: 0, purchases: 0, purchase_value: 0 }],
    insights: async (_level: string, window: string) => {
      asked.push(window);
      return window.startsWith('range:') ? new Map([['c1', m(1000)], ['c2', m(500)]]) : new Map([['c1', m(9000)]]);
    },
  };
  const data = await loadMetaData(d1, meta, false);
  const rows = await data.dailyAll('range:2026-10-13:2026-10-14' as any);
  assert.deepEqual(rows.map((r) => `${r.date}:${r.campaign_id}:${r.spend}`), ['2026-10-13:c1:1000', '2026-10-13:c2:500', '2026-10-14:c1:1000', '2026-10-14:c2:500']);
  assert.ok(asked.includes('range:2026-10-13:2026-10-13'));

  // A daily report that holds the window's spend is used as it is.
  meta.dailyCampaignInsights = async () => [{ campaign_id: 'c1', date: '2026-10-15', spend: 9000, impressions: 0, clicks: 0, purchases: 0, purchase_value: 0 }];
  const ok = await (await loadMetaData(d1, meta, false)).dailyAll('range:2026-10-15:2026-10-15' as any);
  assert.equal(ok.length, 1);
});

test('friendlyD1Error explains the daily row-read quota in Thai and passes other errors through', () => {
  const quota = new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan");
  assert.match(friendlyD1Error(quota), /โควตา/);
  assert.equal(friendlyD1Error(new Error('boom')), 'boom');
});
