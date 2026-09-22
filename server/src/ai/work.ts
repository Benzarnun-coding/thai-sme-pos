/**
 * Work items in the database. The rules of the hand-off live in handoff.js;
 * this file only reads and writes rows.
 */
import type { Db } from '../db/client.js';
import { inboxFor, type NewItem, type WorkItem, type WorkStatus } from './handoff.js';

const COLS = `id, store_id, kind, title, body, status, from_slug, to_slug, parent_id, review, rounds, run_id, directive_id,
  created_at::text, updated_at::text, decided_at::text, decided_by, decision_note, published_at::text, published_as, publish_at::text, budget_thb::float8 as budget_thb`;

export async function listWork(db: Db, storeId: string, o: { status?: WorkStatus | WorkStatus[]; kind?: string; to?: string; limit?: number } = {}): Promise<WorkItem[]> {
  const statuses = o.status ? (Array.isArray(o.status) ? o.status : [o.status]) : null;
  return db.query<WorkItem>(
    `select ${COLS} from work_item where store_id=$1
       and ($2::jsonb is null or status = any(select jsonb_array_elements_text($2)))
       and ($3::text is null or kind=$3) and ($4::text is null or to_slug=$4)
     order by id desc limit $5`, [storeId, statuses ? JSON.stringify(statuses) : null, o.kind ?? null, o.to ?? null, o.limit ?? 200]);
}

export async function getWork(db: Db, storeId: string, id: number): Promise<WorkItem | null> {
  const rows = await db.query<WorkItem>(`select ${COLS} from work_item where store_id=$1 and id=$2`, [storeId, id]);
  return rows[0] ?? null;
}

/** What a box would pick up right now. */
export async function inboxOf(db: Db, storeId: string, slug: string): Promise<WorkItem[]> {
  const live = await listWork(db, storeId, { status: ['open', 'changes', 'pending', 'approved'], to: slug });
  return inboxFor(slug, live);
}

/** Pending counts per box, for cards and badges. */
export async function inboxCounts(db: Db, storeId: string): Promise<Record<string, number>> {
  const rows = await db.query<{ to_slug: string; status: string; n: number }>(
    `select to_slug, status, count(*)::int as n from work_item where store_id=$1 and to_slug is not null and status in ('open','changes','pending','approved') group by to_slug, status`, [storeId]);
  const out: Record<string, number> = {};
  for (const r of rows) {
    const ok = r.to_slug === 'approval' ? r.status === 'pending' : r.to_slug === 'publisher' ? r.status === 'approved' : r.status === 'open' || r.status === 'changes';
    if (ok) out[r.to_slug] = (out[r.to_slug] ?? 0) + r.n;
  }
  return out;
}

export async function createWork(db: Db, storeId: string, item: NewItem, o: { runId?: number | null; directiveId?: number | null } = {}): Promise<WorkItem> {
  if (item.replaces) {
    await db.query(
      `update work_item set status='done', to_slug=null, decision_note='ถูกแทนด้วยฉบับใหม่', updated_at=now()
        where store_id=$1 and kind=$2 and from_slug=$3 and status in ('open','pending')`, [storeId, item.replaces, item.from_slug]);
  }
  const rows = await db.query<WorkItem>(
    `insert into work_item(store_id, kind, title, body, status, from_slug, to_slug, parent_id, rounds, run_id, directive_id, budget_thb)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning ${COLS}`,
    [storeId, item.kind, item.title, item.body, item.status, item.from_slug, item.to_slug, item.parent_id ?? null, item.rounds ?? 0, o.runId ?? null, o.directiveId ?? null, item.budget_thb ?? null]);
  return rows[0];
}

export async function updateWork(db: Db, storeId: string, id: number, patch: Partial<WorkItem>): Promise<WorkItem | null> {
  const sets: string[] = ['updated_at=now()'];
  const vals: unknown[] = [storeId, id];
  const put = (col: string, v: unknown) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'review') put('review', v === null ? null : JSON.stringify(v));
    else if (['body', 'title', 'status', 'to_slug', 'from_slug', 'rounds', 'run_id', 'decided_by', 'decision_note', 'published_as'].includes(k)) put(k, v);
    else if (k === 'published_at' || k === 'decided_at' || k === 'publish_at' || k === 'budget_thb') put(k, v);
  }
  const rows = await db.query<WorkItem>(`update work_item set ${sets.join(', ')} where store_id=$1 and id=$2 returning ${COLS}`, vals);
  return rows[0] ?? null;
}

export async function stampRun(db: Db, ids: number[], runId: number) {
  if (ids.length) await db.query('update work_item set run_id=$1 where id = any($2) and run_id is null', [runId, ids]);
}

/* ---------- budget ledger ---------- */

export async function todaySpend(db: Db, storeId: string): Promise<{ spent: number; planned: number }> {
  const [ads, led] = await Promise.all([
    db.query<{ s: number }>(`select coalesce(sum(spend),0)::float8 as s from fact_ad_insight_daily where store_id=$1 and date = current_date`, [storeId]),
    db.query<{ s: number }>(`select coalesce(sum(amount),0)::float8 as s from budget_ledger where store_id=$1 and date = current_date and kind='planned'`, [storeId]),
  ]);
  return { spent: ads[0].s, planned: led[0].s };
}

export async function monthSpend(db: Db, storeId: string): Promise<number> {
  const [ads, led] = await Promise.all([
    db.query<{ s: number }>(`select coalesce(sum(spend),0)::float8 as s from fact_ad_insight_daily where store_id=$1 and date >= date_trunc('month', current_date)`, [storeId]),
    db.query<{ s: number }>(`select coalesce(sum(amount),0)::float8 as s from budget_ledger where store_id=$1 and date >= date_trunc('month', current_date) and kind='planned'`, [storeId]),
  ]);
  return ads[0].s + led[0].s;
}

export async function addLedger(db: Db, storeId: string, e: { kind: 'planned' | 'spend'; ref: string; amount: number; note?: string }) {
  await db.query(`insert into budget_ledger(store_id, date, kind, ref, amount, note) values ($1, current_date, $2, $3, $4, $5)`, [storeId, e.kind, e.ref, e.amount, e.note ?? null]);
}

export async function ledger(db: Db, storeId: string, days = 30) {
  return db.query<{ id: number; date: string; kind: string; ref: string | null; amount: number; note: string | null; created_at: string }>(
    `select id, date::text, kind, ref, amount::float8 as amount, note, created_at::text from budget_ledger where store_id=$1 and date >= current_date - $2::int order by id desc`, [storeId, days]);
}

/** Approved rules become knowledge for every AI box. */
export async function approvedRules(db: Db, storeId: string): Promise<{ title: string; body: string }[]> {
  return db.query<{ title: string; body: string }>(`select title, body from work_item where store_id=$1 and kind='rule' and status='approved' order by id desc limit 10`, [storeId]);
}
