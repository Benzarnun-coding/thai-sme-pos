// Purchases to Meta at the moment the admin types the order note (Benz 2026-10-15). The sale lands on the day
// and hour the customer agreed — the admins' own "Create order" in Meta's inbox happened at the same moment —
// instead of when the Page365 bill is sent (often the next afternoon). Value = the note's total. One sale per
// customer per 2 hours (a note typed again is not a second sale). Meta can't delete events, so this only runs
// with the sender in live mode and source "note" (settings page); the bill-based sender is then idle.

import { loadCapi, type CapiEnv } from './metaPurchases.ts';
import { parseOrderNote, type StoredNote } from './orderNotes.ts';

const PAGE_ID = (env: CapiEnv) => env.P365_PAGE_ID ?? '115748303500549';
const DEDUPE_MS = 2 * 3_600_000;

export async function captureSource(db: D1Database): Promise<'note' | 'bill'> {
  const r = await db.prepare("SELECT value FROM meta_capi WHERE key = 'source'").first<{ value: string }>().catch(() => null);
  return r?.value === 'bill' ? 'bill' : 'note';
}

export interface NotePlan { mid: string; at: string; value: number; send: boolean; why: string | null }

/** What would be sent for these notes: a total above 0, and no sale for the same customer in the 2 hours before. */
export async function planNotePurchases(db: D1Database, notes: StoredNote[]): Promise<NotePlan[]> {
  const out: NotePlan[] = [];
  const sorted = [...notes].sort((a, b) => a.at.localeCompare(b.at));
  for (const n of sorted) {
    const p = parseOrderNote(n.text);
    const value = p?.total ?? 0;
    if (!p || !(value > 0)) { out.push({ mid: n.mid, at: n.at, value, send: false, why: 'ไม่มียอดในบรรทัดสรุป' }); continue; }
    const t = Date.parse(n.at);
    const earlierHere = out.find((o) => o.send && sorted.find((x) => x.mid === o.mid)?.psid === n.psid && t - Date.parse(o.at) < DEDUPE_MS);
    const earlierSent = await db.prepare("SELECT at FROM note_purchases WHERE psid = ? AND status = 'sent' AND at < ? AND at >= ? AND mid != ?")
      .bind(n.psid, n.at, new Date(t - DEDUPE_MS).toISOString(), n.mid).first().catch(() => null);
    if (earlierHere || earlierSent) { out.push({ mid: n.mid, at: n.at, value, send: false, why: 'ลูกค้าคนนี้มีสรุปใน 2 ชม. ก่อนหน้าแล้ว' }); continue; }
    out.push({ mid: n.mid, at: n.at, value, send: true, why: null });
  }
  return out;
}

/** From the webhook, right after the note is stored: sends it when the sender is live with source "note". */
export async function sendNotePurchase(env: CapiEnv, note: StoredNote, opts: { force?: boolean } = {}): Promise<{ status: string; detail: string | null }> {
  const cfg = await loadCapi(env.DB);
  if (!opts.force && (cfg.mode !== 'live' || (await captureSource(env.DB)) !== 'note')) return { status: 'off', detail: null };
  if (!cfg.dataset_id || !env.META_ACCESS_TOKEN) return { status: 'off', detail: 'ไม่มี Dataset ID หรือ token' };
  const done = await env.DB.prepare('SELECT status FROM note_purchases WHERE mid = ?').bind(note.mid).first<{ status: string }>();
  if (done?.status === 'sent') return { status: 'sent', detail: 'ส่งไปแล้ว' };
  const [plan] = await planNotePurchases(env.DB, [note]);
  const now = new Date().toISOString();
  const save = (status: string, detail: string | null) => env.DB.prepare('INSERT OR REPLACE INTO note_purchases (mid, psid, at, value, status, detail, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(note.mid, note.psid, note.at, plan.value, status, detail, now).run();
  if (!plan.send) { await save('skipped', plan.why); return { status: 'skipped', detail: plan.why }; }
  const event = {
    event_name: 'Purchase', event_time: Math.floor(Date.parse(note.at) / 1000), event_id: `note-${note.mid}`,
    action_source: 'business_messaging', messaging_channel: 'messenger',
    user_data: { page_id: PAGE_ID(env), page_scoped_user_id: note.psid }, custom_data: { currency: 'THB', value: plan.value },
  };
  const r = await fetch(`https://graph.facebook.com/${env.META_API_VERSION ?? 'v21.0'}/${cfg.dataset_id}/events?access_token=${encodeURIComponent(env.META_ACCESS_TOKEN)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [event] }),
  });
  const b: any = await r.json().catch(() => ({}));
  if (!r.ok || b.error) { const msg = b?.error?.message ?? `Meta ${r.status}`; await save('error', msg); return { status: 'error', detail: msg }; }
  await save('sent', (b.messages ?? []).join(' · ') || null);
  return { status: 'sent', detail: null };
}
