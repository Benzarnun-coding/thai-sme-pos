// The accuracy of the order-note flow, measured on real bills (Benz 20 Oct). For each note's bill, once it has
// moved on in Page365 (sent/paid/shipped), is a week old, or is gone, its final items, total and payment are
// compared with the admin's note — the same comparison done by hand on 20 Oct (438 bills: 5 item edits, 3 total).
// Bills the system filled → ok / edited (and what). Bills it stopped → stopped_kept (the person ended with what the
// note said: the stop wasn't needed) / stopped_changed (the stop caught something). A few bills per webhook
// delivery (free-plan request limit); summary per day on the Log tab and at 09:15 in the problem channel.

import { postOrderChannel, type AutoEnv } from './autoFill.ts';
import { expandCode, parseOrderNote, skuPrefix } from './orderNotes.ts';
import { call, type P365Order } from './p365fill.ts';

const DAY = 86_400_000;
/** The flow's first day of real use. */
const AUDIT_FROM = '2026-10-15T00:00:00Z';

/** The stop reason's category, from the text the flow wrote ("ต้องให้คนดู: …"). */
export function stopReason(error: string): string {
  const e = error.replace(/^ต้องให้คนดู:\s*/, '');
  const cats: [RegExp, string][] = [
    [/ลูกค้าขอยกเลิก/, 'ลูกค้ายกเลิก'], [/สรุปซ้ำ/, 'สรุปซ้ำ'], [/อ่านไม่ออก/, 'อ่านสรุปไม่ออก'], [/ไม่พบ/, 'หารุ่นไม่เจอ'],
    [/ไม่มีไซส์|ไม่ได้ระบุไซส์/, 'ไซส์ไม่มี'], [/ไซส์ไม่ตรง/, 'ไซส์ไม่ตรงที่ลูกค้าขอ'], [/ในแชทตกลงยอด/, 'ยอดแชทไม่ตรง'],
    [/สูงกว่าราคา|เกิน 70%/, 'ยอดไม่เข้ากับสินค้า'], [/หลายไซส์/, 'รุ่นเดียวหลายไซส์'], [/มีสินค้าอยู่แล้ว/, 'ร่างมีของแล้ว'],
    [/เหลือ .* ไม่พอ/, 'ของไม่พอ'], [/ที่อยู่|เบอร์|รหัสไปรษณีย์/, 'ที่อยู่'], [/ร่างเป็น/, 'โอน/ปลายทางไม่ตรง'],
    [/ไม่เจอร่าง|เปิดร่าง/, 'เปิดร่างไม่ได้'], [/ใส่สินค้าแล้วได้|ใส่แล้วแต่ไม่ตรง|ไม่สำเร็จ/, 'ใส่ไม่สำเร็จ'],
  ];
  return cats.find(([re]) => re.test(e))?.[1] ?? 'อื่นๆ';
}

const norm = (prefix: string, size: string) => `${prefix.replace(/^[A-Z](?=\d)/, '')}-${size}`;

/** What the note says (model-size → qty), or null when it can't be compared (colour names, no size). */
export function expected(text: string): { items: Record<string, number>; total: number | null; cod: boolean } | null {
  const p = parseOrderNote(text);
  if (!p || p.unknown.length || p.items.some((i) => i.colour || !i.size)) return null;
  const items: Record<string, number> = {};
  for (const i of p.items) {
    const code = i.code.replace(/^[A-Z](?=\d+(?:[/-]\d+)*$)/, '');
    const k = norm(skuPrefix(expandCode(code)[0]), i.size === 'F' ? 'FE' : i.size);
    items[k] = (items[k] ?? 0) + i.qty;
  }
  return { items, total: p.total, cod: p.payment === 'cod' };
}

/** What the bill holds: model-size from each variant SKU ("5011-PK-MD-30" → 5011-30). */
export function actual(o: Pick<P365Order, 'items'>): Record<string, number> {
  const items: Record<string, number> = {};
  for (const i of o.items) {
    const parts = (i.variant?.code ?? '').toUpperCase().split('-');
    const k = parts.length >= 3 ? norm(parts[0], parts[parts.length - 1]) : `?${i.name.slice(0, 20)}`;
    items[k] = (items[k] ?? 0) + i.quantity;
  }
  return items;
}

/** The differences between the note and the final bill: items (other models), size, qty, total, payment. */
export function diff(want: NonNullable<ReturnType<typeof expected>>, o: Pick<P365Order, 'items' | 'total' | 'cod'>): string[] {
  const got = actual(o);
  const out: string[] = [];
  const key = (r: Record<string, number>) => JSON.stringify(Object.entries(r).sort());
  if (key(want.items) !== key(got)) {
    const models = (r: Record<string, number>) => key(Object.entries(r).reduce((m, [k, v]) => { const p = k.slice(0, k.lastIndexOf('-')); m[p] = (m[p] ?? 0) + v; return m; }, {} as Record<string, number>));
    const sum = (r: Record<string, number>) => Object.values(r).reduce((s, v) => s + v, 0);
    out.push(models(want.items) === models(got) ? 'size' : sum(want.items) === sum(got) ? 'items' : 'qty');
  }
  if (want.total != null && Math.abs(Number(o.total) - want.total) > 0.5) out.push('total');
  if (want.cod !== !!o.cod) out.push('payment');
  return out;
}

function addressFlags(o: P365Order): string[] {
  const f: string[] = [];
  const digits = (s: string) => s.replace(/[\s-]/g, '');
  const street = `${o.structural_address?.street ?? ''} ${o.customer_address ?? ''}`;
  const name = (o.customer_name ?? '').replace(/^[A-Z]{1,3}-\d{4}\s+/, '').split(/\s+/)[0] ?? '';
  if (/0\d{8,9}/.test(digits(street))) f.push('phone_in_street');
  if (name.length > 2 && street.includes(name)) f.push('name_in_street');
  if (!/^0\d{8,9}$/.test(digits(o.customer_phone ?? ''))) f.push('no_phone');
  if (!/^\d{5}$/.test(o.structural_address?.postal_code ?? '')) f.push('no_zip');
  return f;
}

/**
 * One step: up to `limit` bills from notes at least 20 h old that have no final audit yet. Returns how many were
 * written. Throttled to every 10 minutes unless forced.
 */
export async function auditStep(env: AutoEnv, opts: { force?: boolean; limit?: number } = {}): Promise<number> {
  const last = await env.DB.prepare("SELECT value FROM meta_capi WHERE key = 'audit_at'").first<{ value: string }>().catch(() => null);
  if (!opts.force && last && Date.now() - Date.parse(last.value) < 10 * 60_000) return 0;
  await env.DB.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('audit_at', ?)").bind(new Date().toISOString()).run();
  const now = Date.now();
  const { results: notes } = await env.DB.prepare(
    `SELECT n.mid, n.at, n.text, n.fill_order_no AS no, n.filled_at, n.filled_by, n.fill_error
       FROM order_notes n LEFT JOIN fill_audit a ON a.no = n.fill_order_no
      WHERE n.fill_order_no IS NOT NULL AND n.at >= ? AND n.at <= ?
        AND (a.no IS NULL OR (a.outcome = 'open' AND a.checked_at <= ?))
      ORDER BY n.at LIMIT ?`,
  ).bind(new Date(Math.max(now - 30 * DAY, Date.parse(AUDIT_FROM))).toISOString(), new Date(now - 20 * 3_600_000).toISOString(),
    new Date(now - 12 * 3_600_000).toISOString(), opts.limit ?? 10).all<{ mid: string; at: string; text: string; no: number; filled_at: string | null; filled_by: string | null; fill_error: string | null }>();
  let written = 0;
  for (const n of notes) {
    const list = await call<{ orders: { id: number; no: number; stage: string }[] }>(env, `orders.json?page=1&search=${n.no}`).catch(() => null);
    if (!list) break; // Page365 not reachable: try again next time
    const hit = list.orders.find((o) => o.no === n.no);
    const stopped = !n.filled_at && (n.fill_error ?? '').startsWith('ต้องให้คนดู');
    const row = { no: n.no, mid: n.mid, note_at: n.at, filled_by: n.filled_at ? n.filled_by : null, reason: stopped ? stopReason(n.fill_error!) : null, edits: null as string | null, address: null as string | null, final_stage: null as string | null, outcome: 'deleted' };
    if (hit) {
      const o = await call<P365Order>(env, `orders/${hit.id}.json`);
      row.final_stage = o.stage;
      const final = o.stage !== 'draft' || now - Date.parse(n.at) > 7 * DAY;
      const want = expected(n.text);
      const d = want ? diff(want, o) : ['n/a'];
      row.edits = JSON.stringify(d);
      row.address = JSON.stringify(addressFlags(o));
      row.outcome = !final ? 'open' : stopped ? (d.length ? 'stopped_changed' : 'stopped_kept') : d.length ? 'edited' : 'ok';
    }
    await env.DB.prepare(`INSERT OR REPLACE INTO fill_audit (no, mid, note_at, filled_by, outcome, reason, edits, address, final_stage, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.no, row.mid, row.note_at, row.filled_by, row.outcome, row.reason, row.edits, row.address, row.final_stage, new Date().toISOString()).run();
    written++;
  }
  return written;
}

export interface AccuracyDay {
  date: string; notes: number; bills: number; checked: number; auto: number; ok: number; edited: number;
  stopped: number; stopped_kept: number; stopped_changed: number; deleted: number; open: number; misses: number;
  edits: Record<string, number>; reasons: Record<string, { n: number; kept: number }>; address: Record<string, number>;
}

/** Per Bangkok day, newest first: what the system did with the notes and how the bills ended. */
export async function accuracy(db: D1Database, days = 7): Promise<{ days: AccuracyDay[]; edited: { no: number; date: string; edits: string[] }[] }> {
  const from = new Date(Date.now() - days * DAY).toISOString();
  const [{ results: notes }, { results: audits }, { results: misses }] = await Promise.all([
    db.prepare(`SELECT date(at, '+7 hours') AS d, COUNT(*) AS n, COUNT(DISTINCT fill_order_no) AS bills FROM order_notes WHERE at >= ? GROUP BY 1`).bind(from).all<{ d: string; n: number; bills: number }>(),
    db.prepare(`SELECT date(note_at, '+7 hours') AS d, no, filled_by, outcome, reason, edits, address FROM fill_audit WHERE note_at >= ?`).bind(from).all<{ d: string; no: number; filled_by: string | null; outcome: string; reason: string | null; edits: string | null; address: string | null }>(),
    db.prepare(`SELECT date(at, '+7 hours') AS d, COUNT(*) AS n FROM note_misses WHERE at >= ? GROUP BY 1`).bind(from).all<{ d: string; n: number }>(),
  ]);
  const byDay = new Map<string, AccuracyDay>();
  const day = (d: string) => byDay.get(d) ?? (byDay.set(d, { date: d, notes: 0, bills: 0, checked: 0, auto: 0, ok: 0, edited: 0, stopped: 0, stopped_kept: 0, stopped_changed: 0, deleted: 0, open: 0, misses: 0, edits: {}, reasons: {}, address: {} }), byDay.get(d)!);
  for (const r of notes) { const x = day(r.d); x.notes = r.n; x.bills = r.bills; }
  for (const r of misses) day(r.d).misses = r.n;
  const edited: { no: number; date: string; edits: string[] }[] = [];
  for (const a of audits) {
    const x = day(a.d);
    x.checked++;
    if (a.filled_by === 'auto') x.auto++;
    const e: string[] = a.edits ? JSON.parse(a.edits) : [];
    if (a.outcome === 'ok') x.ok++;
    else if (a.outcome === 'edited') { x.edited++; for (const k of e) x.edits[k] = (x.edits[k] ?? 0) + 1; edited.push({ no: a.no, date: a.d, edits: e }); }
    else if (a.outcome === 'deleted') x.deleted++;
    else if (a.outcome === 'open') x.open++;
    else {
      x.stopped++;
      if (a.outcome === 'stopped_kept') x.stopped_kept++; else x.stopped_changed++;
      const k = a.reason ?? 'อื่นๆ';
      x.reasons[k] = x.reasons[k] ?? { n: 0, kept: 0 };
      x.reasons[k].n++;
      if (a.outcome === 'stopped_kept') x.reasons[k].kept++;
    }
    for (const f of a.address ? JSON.parse(a.address) as string[] : []) if (a.filled_by === 'auto' && (f === 'phone_in_street' || f === 'name_in_street')) x.address[f] = (x.address[f] ?? 0) + 1;
  }
  return { days: [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date)), edited: edited.sort((a, b) => b.no - a.no).slice(0, 30) };
}

/** One message for the problem channel: yesterday in numbers, and the stop reason to fix next. */
export async function accuracyPost(env: AutoEnv): Promise<string | null> {
  const { days } = await accuracy(env.DB, 3);
  const y = days.find((d) => d.date === new Date(Date.now() + 7 * 3_600_000 - DAY).toISOString().slice(0, 10));
  if (!y || !y.checked) return null;
  const done = y.ok + y.edited;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const top = Object.entries(y.reasons).sort((a, b) => b[1].n - a[1].n).slice(0, 3);
  const lines = [
    `📊 ความแม่นยำใส่บิล เมื่อวาน (${y.date}) — ตรวจแล้ว ${y.checked} ใบ จาก ${y.bills}`,
    `• ระบบใส่ ${done} ใบ: ไม่ต้องแก้ ${y.ok} (${pct(y.ok, done)}%) · แอดมินแก้ ${y.edited}${Object.keys(y.edits).length ? ` (${Object.entries(y.edits).map(([k, v]) => `${({ size: 'ไซส์', items: 'รุ่น', qty: 'จำนวน', total: 'ยอด', payment: 'โอน/ปลายทาง' } as Record<string, string>)[k] ?? k} ${v}`).join(', ')})` : ''}`,
    `• ระบบหยุดให้คนดู ${y.stopped} ใบ — หยุดโดยไม่จำเป็น (แอดมินใช้ตามสรุป) ${y.stopped_kept}`,
    ...top.map(([k, v]) => `   - ${k} ${v.n} ใบ (ไม่จำเป็น ${v.kept})`),
    `• สรุปที่อ่านไม่ออก ${y.misses} · บิลถูกลบ ${y.deleted}`,
  ];
  await postOrderChannel(env, () => lines.join('\n')).catch(() => null);
  return lines.join('\n');
}
