// Meta data for the dashboard, cached piece by piece in D1.
// The Stat app is on Meta's development access tier (few Marketing API calls allowed), so the entity list,
// each (level, window) insights call and each campaign's daily series are cached separately and shared by
// every page. "รีเฟรช" shortens the TTL to one minute; a rate-limited Meta falls back to the last answer.

import type { DailyRow } from '../../ads-engine/src/meta.ts';
import type { Entity, Level, Metrics, Window } from '../../ads-engine/src/types.ts';
import { MockMeta } from './mock.ts';
import type { MetaLike } from './run.ts';

const TTL_MS: Record<string, number> = { entities: 10 * 60_000, insights: 5 * 60_000, daily: 30 * 60_000 };
const MIN_REFRESH_MS = 60_000;

export interface MetaData {
  account: string;
  entities: Entity[];
  insights(level: Level, window: Window): Promise<Map<string, Metrics>>;
  daily(campaignId: string, window: Window): Promise<DailyRow[]>;
  /** Oldest fetch time among the pieces used so far */
  fetchedAt(): string;
  /** Set when Meta refused and older data is shown */
  warning(): string | null;
}

export function friendlyMetaError(err: any): string {
  const msg: string = err?.message ?? String(err);
  if (/request limit|rate limit|too many calls/i.test(msg)) {
    return 'Meta จำกัดจำนวนคำขอชั่วคราว (แอป Stat ยังอยู่ระดับ development) — รอประมาณ 5 นาทีแล้วกดรีเฟรช';
  }
  return msg;
}

/** JSON has no Infinity: cost-per metrics come back as null and are restored here. */
function revive(data: string): any {
  return JSON.parse(data, (k, v) => ((k === 'cpa' || k === 'cost_per_message') && v === null ? Infinity : v));
}

export class MetaCacheError extends Error {}

export async function loadMetaData(db: D1Database, meta: MetaLike, fresh: boolean): Promise<MetaData> {
  const cacheable = !(meta instanceof MockMeta);
  const times: string[] = [];
  let warning: string | null = null;

  async function cached<T>(key: string, kind: keyof typeof TTL_MS, load: () => Promise<T>): Promise<T> {
    if (!cacheable) return load();
    const row = await db.prepare('SELECT fetched_at, data FROM meta_cache WHERE key = ?').bind(key).first<{ fetched_at: string; data: string }>();
    const age = row ? Date.now() - Date.parse(row.fetched_at) : Infinity;
    if (row && age < (fresh ? MIN_REFRESH_MS : TTL_MS[kind])) {
      times.push(row.fetched_at);
      return revive(row.data) as T;
    }
    try {
      const value = await load();
      const at = new Date().toISOString();
      if (key === 'entities' && row) await recordBudgetChanges(db, (revive(row.data) as { entities: Entity[] }).entities, (value as { entities: Entity[] }).entities, at);
      await db.prepare('INSERT INTO meta_cache (key, fetched_at, data) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data')
        .bind(key, at, JSON.stringify(value)).run();
      times.push(at);
      return value;
    } catch (err) {
      if (!row) throw new MetaCacheError(friendlyMetaError(err));
      warning = friendlyMetaError(err);
      times.push(row.fetched_at);
      return revive(row.data) as T;
    }
  }

  const base = await cached('entities', 'entities', async () => ({ account: await meta.accountName(), entities: await meta.listEntities() }));

  return {
    account: base.account,
    entities: base.entities,
    insights: async (level, window) =>
      new Map(Object.entries(await cached(`ins:${level}:${window}`, 'insights', async () => Object.fromEntries(await meta.insights(level, window))))),
    daily: (campaignId, window) => cached(`daily:${campaignId}:${window}`, 'daily', () => meta.dailyInsights(campaignId, window)),
    fetchedAt: () => (times.length ? times.reduce((a, b) => (a < b ? a : b)) : new Date().toISOString()),
    warning: () => warning,
  };
}

/** After a manual change on Meta, update the cached entity list so the dashboard shows it without another Meta call. */
export async function patchCachedEntity(db: D1Database, id: string, patch: Partial<Pick<Entity, 'status' | 'daily_budget'>>): Promise<void> {
  const row = await db.prepare("SELECT data FROM meta_cache WHERE key = 'entities'").first<{ data: string }>();
  if (!row) return;
  const base = revive(row.data) as { account: string; entities: Entity[] };
  for (const e of base.entities) if (e.id === id) Object.assign(e, patch);
  await db.prepare("UPDATE meta_cache SET data = ? WHERE key = 'entities'").bind(JSON.stringify(base)).run();
}

/** Budgets that differ between the previous and the new entity list were changed outside this dashboard. */
async function recordBudgetChanges(db: D1Database, before: Entity[], after: Entity[], at: string): Promise<void> {
  const old = new Map(before.map((e) => [e.id, e.daily_budget]));
  const changes = after
    .filter((e) => old.has(e.id) && old.get(e.id) !== e.daily_budget)
    .map((e) => ({ entity_id: e.id, name: e.name, from: old.get(e.id) ?? null, to: e.daily_budget }));
  if (changes.length) await insertBudgetChanges(db, changes, 'meta', at);
}

export async function insertBudgetChanges(
  db: D1Database, changes: { entity_id: string; name: string; from: number | null; to: number | null }[], source: 'dashboard' | 'meta', at = new Date().toISOString(),
): Promise<void> {
  if (!changes.length) return;
  await db.prepare(
    `INSERT INTO budget_changes (entity_id, name, at, from_budget, to_budget, source)
     SELECT value ->> '$.entity_id', value ->> '$.name', ?1, value ->> '$.from', value ->> '$.to', ?2 FROM json_each(?3)`,
  ).bind(at, source, JSON.stringify(changes)).run();
}

/** Latest budget change per entity within the last `days`. */
export async function recentBudgetChanges(db: D1Database, days = 3): Promise<Map<string, { at: string; from: number | null; to: number | null; source: string }>> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { results } = await db.prepare('SELECT entity_id, at, from_budget, to_budget, source FROM budget_changes WHERE at >= ? ORDER BY at')
    .bind(since).all<{ entity_id: string; at: string; from_budget: number | null; to_budget: number | null; source: string }>();
  return new Map(results.map((r) => [r.entity_id, { at: r.at, from: r.from_budget, to: r.to_budget, source: r.source }]));
}
