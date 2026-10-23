// "Log ออเดอร์แชท" tab: admins' order notes in the chat ("501/1/2 32 / cod 449") as the system reads them, as they
// come in, next to what Page365 holds for the same order once the day's export is uploaded. Phase 0 of filling Page365 orders automatically: if the
// two agree often enough, the system can later fill the orders itself.

import { useEffect, useState } from 'react';
import { api, type FillPlan, type NoteCheck, type PlanAddress } from './api.ts';
import { thumb } from './catalog.ts';
import { baht, num, when } from './fmt.ts';
import { Modal, useUi } from './ui.tsx';

const VERDICT: Record<NoteCheck['verdict'], [string, string]> = {
  same: ['ตรงกัน', 'on'],
  diff_total: ['ของตรง ยอดต่าง', 'warn'],
  diff_items: ['สินค้าต่าง', 'bad'],
  unparsed: ['อ่านไม่ออกบางบรรทัด', 'warn'],
  no_order: ['ยังไม่เจอใน Page365', ''],
};

const todayBkk = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const thaiDay = (iso: string) => new Date(`${iso}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });

/** The tab: last 7 days to pick from (with how many notes each), today refreshed every minute. */
export function OrderNotesPage() {
  const [date, setDate] = useState(todayBkk);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [tick, setTick] = useState(0);
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${todayBkk()}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10));
  useEffect(() => { api.orderNoteDays().then((r) => setCounts(new Map(r.days.map((d) => [d.date, d.notes])))).catch(() => {}); }, [tick]);
  useEffect(() => {
    if (date !== todayBkk()) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [date]);
  return (
    <>
      <div className="segmented" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        {days.map((d) => (
          <button key={d} className={d === date ? 'on' : ''} onClick={() => setDate(d)}>
            {d === todayBkk() ? 'วันนี้' : thaiDay(d)} <span className="muted small">{num(counts.get(d) ?? 0)}</span>
          </button>
        ))}
      </div>
      <DaySales date={date} refresh={tick} />
      <SessionBanner />
      <Accuracy refresh={tick} />
      <AutoSwitch />
      <CleanupSwitch />
      <CorrectionSwitch />
      <NoteMisses refresh={tick} />
      <OrderNotesList date={date} dayLabel={date === todayBkk() ? 'วันนี้' : thaiDay(date)} refresh={tick} live={date === todayBkk()} />
    </>
  );
}

type Stage = 'draft' | 'unpaid' | 'transferred' | 'paid' | 'shipped' | 'expired' | 'voided' | 'none';
const STAGE_LABEL: Record<Stage, string> = { draft: 'ร่าง', unpaid: 'ส่งบิลแล้ว รอชำระ', transferred: 'โอนแล้ว', paid: 'เตรียมส่ง', shipped: 'ส่งแล้ว', expired: 'หมดอายุ', voided: 'ยกเลิก', none: 'ยังไม่มีบิล' };
const STAGE_TONE: Record<Stage, string> = { draft: 'warn', unpaid: '', transferred: 'on', paid: 'on', shipped: 'on', expired: 'bad', voided: 'bad', none: 'bad' };
interface DayRow { mid: string; at: string; text: string; customer: string | null; items: { code: string; size: string; qty: number }[]; pieces: number; total: number; payment: 'cod' | 'transfer' | null; bill: { id: number; no: number; stage: Stage; total: number } | null; meta: string | null; repeat: boolean }
interface Recon {
  log: number; file: number; matched: number; sales_log: number; sales_file: number;
  log_only: { mid: string; at: string; customer: string | null; text: string; total: number }[];
  file_only: { order_no: string; total: number; created_at: string }[];
  diff: { order_no: string; note_total: number; bill_total: number; customer: string | null }[];
}
interface DaySummary { orders: number; sales: number; pieces: number; cod: number; transfer: number; avg: number; by_stage: Record<string, { orders: number; sales: number }>; meta_sent: number }

/** Notes vs the uploaded Page365 file: what matched, notes without a bill, bills without a note, amounts that differ. */
function ReconLine({ r }: { r: Recon }) {
  const ok = !r.log_only.length && !r.file_only.length && !r.diff.length;
  return (
    <div className="small" style={{ margin: '6px 0' }}>
      <b>เทียบกับไฟล์ Page365:</b> สรุป {num(r.log)} · ไฟล์ {num(r.file)} · ตรงกัน {num(r.matched)}
      {' '}· ยอดสรุป {baht(r.sales_log)} · ยอดบิล {baht(r.sales_file)}{ok && <span className="good"> · ตรงทั้งหมด</span>}
      {r.log_only.length > 0 && (
        <details><summary className="warn">มีสรุปแต่ไม่มีบิลในไฟล์ {num(r.log_only.length)} (ยกเลิก / ไม่ได้เปิดบิล / เปิดบิลวันอื่น)</summary>
          {r.log_only.map((x) => <div key={x.mid}>{time(x.at)} · {x.customer ?? '–'} · {baht(x.total)} · “{x.text}”</div>)}
        </details>
      )}
      {r.file_only.length > 0 && (
        <details><summary className="warn">มีบิลแต่ไม่มีสรุป {num(r.file_only.length)} (แอดมินไม่ได้พิมพ์สรุป หรือระบบอ่านไม่ออก)</summary>
          {r.file_only.map((x) => <div key={x.order_no}>#{x.order_no} · {time(x.created_at)} · {baht(x.total)}</div>)}
        </details>
      )}
      {r.diff.length > 0 && (
        <details><summary className="warn">ยอดต่าง {num(r.diff.length)}</summary>
          {r.diff.map((x) => <div key={x.order_no}>#{x.order_no} · {x.customer ?? '–'} · สรุป {baht(x.note_total)} · บิล {baht(x.bill_total)}</div>)}
        </details>
      )}
    </div>
  );
}

/** The day's sales for Max: totals, then one row per order (customer, items, amount, Page365 bill + stage, Meta). */
function DaySales({ date, refresh }: { date: string; refresh: number }) {
  const [res, setRes] = useState<{ rows: DayRow[]; summary: DaySummary; page365: boolean; error: string | null; recon: Recon | null } | null>(null);
  const [filter, setFilter] = useState<Stage | 'all'>('all');
  const [failed, setFailed] = useState('');
  useEffect(() => { setRes(null); setFailed(''); }, [date]);
  // An error answer (bad date, expired login, D1/Page365 down) has no summary: show it instead of crashing the page.
  // `live`: a slower answer for a day no longer shown is dropped.
  useEffect(() => {
    let live = true;
    fetch(`/api/order-notes/sales?date=${date}`)
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok || !j.summary) throw new Error(j.error ?? `โหลดไม่ได้ (${r.status})`); return j; })
      .then((j) => { if (live) { setRes(j); setFailed(''); } })
      .catch((e) => { if (live) setFailed(e.message); });
    return () => { live = false; };
  }, [date, refresh]);
  if (failed && !res) return <section className="card"><p className="bad small">ยอดขายวันนี้โหลดไม่ได้: {failed}</p></section>;
  if (!res) return <section className="card"><div className="skeleton" style={{ height: 90 }} /></section>;
  const s = res.summary;
  const rows = res.rows.filter((r) => !r.repeat).reverse().filter((r) => filter === 'all' || (r.bill?.stage ?? 'none') === filter);
  const stages = Object.keys(s.by_stage) as Stage[];
  const pageUrl = (id: number) => `https://app.page365.net/115748303500549/orders/${id}`;
  return (
    <section className="card table-card">
      <div className="table-card-head">
        <div style={{ width: '100%' }}>
          <h2>ยอดขายตามที่แอดมินสรุป</h2>
          <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
            <div><div className="small muted">ออเดอร์</div><b style={{ fontSize: 22 }}>{num(s.orders)}</b></div>
            <div><div className="small muted">ยอดขาย</div><b style={{ fontSize: 22 }}>{baht(s.sales)}</b></div>
            <div><div className="small muted">ชิ้น</div><b style={{ fontSize: 22 }}>{num(s.pieces)}</b></div>
            <div><div className="small muted">เฉลี่ย/ออเดอร์</div><b style={{ fontSize: 22 }}>{baht(s.avg)}</b></div>
            <div><div className="small muted">ปลายทาง / โอน</div><b>{num(s.cod)} / {num(s.transfer)}</b></div>
            <div><div className="small muted">ส่งยอดให้ Meta แล้ว</div><b>{num(s.meta_sent)}</b></div>
          </div>
          <p className="muted small">ยอด = ยอดในบรรทัดสรุปของแอดมิน (ลูกค้าคนเดิมใน 2 ชม. นับครั้งเดียว) · ชื่อลูกค้าและสถานะบิลดึงสดจาก Page365{res.error ? ` — ดึงไม่ได้: ${res.error}` : ''} · กำไรจริงดูที่หน้ายอดขายรายวันหลังอัปโหลดไฟล์</p>
          {res.recon ? <ReconLine r={res.recon} /> : <p className="small muted">ยังไม่ได้อัปโหลดไฟล์ Page365 ของวันนี้ — อัปโหลดแล้วจะขึ้นการเทียบกับบิลจริง</p>}
          <div className="segmented" style={{ flexWrap: 'wrap', marginTop: 6 }}>
            <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>ทั้งหมด {num(s.orders)}</button>
            {stages.map((k) => (
              <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{STAGE_LABEL[k] ?? k} {num(s.by_stage[k].orders)} · {baht(s.by_stage[k].sales)}</button>
            ))}
          </div>
        </div>
      </div>
      {rows.length === 0 ? <p className="muted small" style={{ padding: '0 18px 12px' }}>ไม่มีออเดอร์</p> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>เวลา</th><th>ลูกค้า</th><th>สินค้า</th><th className="num">ยอด</th><th>บิล</th><th>Meta</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.mid}>
                  <td className="small">{time(r.at)}</td>
                  <td>{r.customer ?? <span className="muted">–</span>}</td>
                  <td className="small">{r.items.length ? r.items.map((i) => `${i.code} ${i.size}${i.qty > 1 ? ` ×${i.qty}` : ''}`).join(', ') : <span className="muted">{r.text}</span>}</td>
                  <td className="num"><b>{baht(r.total)}</b><div className="small muted">{r.payment === 'cod' ? 'ปลายทาง' : r.payment === 'transfer' ? 'โอน' : ''}</div></td>
                  <td className="small">{r.bill ? <><a href={pageUrl(r.bill.id)} target="_blank" rel="noreferrer">#{r.bill.no}</a> <span className={`tag ${STAGE_TONE[r.bill.stage] ?? ''}`}>{STAGE_LABEL[r.bill.stage] ?? r.bill.stage}</span></> : <span className="tag bad">{STAGE_LABEL.none}</span>}</td>
                  <td className="small">{r.meta === 'sent' ? '✅' : r.meta === 'error' ? <span className="bad">ส่งไม่ได้</span> : <span className="muted">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Owner switch: open + fill drafts by themselves the moment the admin types the note (problems → Discord). */
function AutoSwitch() {
  const { toast } = useUi();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { fetch('/api/order-notes/auto').then((r) => r.json()).then((j) => setOn(!!j.on)).catch(() => {}); }, []);
  async function flip() {
    const r = await fetch('/api/order-notes/auto', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: !on }) });
    const j = await r.json();
    if (!r.ok) { toast(j.error ?? 'เปลี่ยนไม่ได้', 'bad'); return; }
    setOn(j.on); toast(j.on ? 'เปิดอัตโนมัติแล้ว — บรรทัดสรุปใหม่จะถูกเปิดร่างและใส่บิลเอง' : 'ปิดอัตโนมัติแล้ว', 'ok');
  }
  if (on === null) return null;
  return (
    <div className={`banner ${on ? 'info' : ''}`} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
      <span>
        <b>ใส่บิลอัตโนมัติ: {on ? 'เปิด' : 'ปิด'}</b> — {on ? 'แอดมินพิมพ์สรุปแล้ว ระบบเปิดร่าง + ใส่สินค้า/ที่อยู่เองทันที ใบที่ติดปัญหาแจ้งใน Discord (ชื่อลูกค้า + เลขบิล) · บิลยังเป็นร่าง แอดมินกด "ส่งบิล" เอง' : 'ต้องกดปุ่ม "ใส่ใน Page365" / "ใส่ทุกใบที่ผ่าน" เอง'}
      </span>
      <button className="ghost small" onClick={flip}>{on ? 'ปิด' : 'เปิดอัตโนมัติ'}</button>
    </div>
  );
}

interface AccDay { date: string; notes: number; bills: number; checked: number; ok: number; edited: number; stopped: number; stopped_kept: number; deleted: number; open: number; misses: number; edits: Record<string, number>; reasons: Record<string, { n: number; kept: number }>; address: Record<string, number> }
const EDIT_TH: Record<string, string> = { size: 'ไซส์', items: 'รุ่น', qty: 'จำนวน', total: 'ยอด', payment: 'โอน/ปลายทาง', 'n/a': 'เทียบไม่ได้' };

/** How the bills behind the notes ended up in Page365 (worker/fillAudit.ts), per day. */
function Accuracy({ refresh }: { refresh: number }) {
  const [d, setD] = useState<{ days: AccDay[]; edited: { no: number; date: string; edits: string[] }[] } | null>(null);
  useEffect(() => { fetch('/api/order-notes/accuracy?days=7').then((r) => r.json()).then(setD).catch(() => {}); }, [refresh]);
  if (!d || !d.days.some((x) => x.checked)) return null;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');
  const reasons: Record<string, { n: number; kept: number }> = {};
  for (const x of d.days) for (const [k, v] of Object.entries(x.reasons)) { reasons[k] = reasons[k] ?? { n: 0, kept: 0 }; reasons[k].n += v.n; reasons[k].kept += v.kept; }
  return (
    <details className="card" style={{ marginBottom: 12 }} open>
      <summary><strong>ความแม่นยำใส่บิล (7 วัน)</strong> <span className="muted small">เทียบบิลจริงใน Page365 หลังส่งแล้ว กับบรรทัดสรุปของแอดมิน · ตรวจบิลที่อายุเกิน 20 ชม. ทีละไม่กี่ใบ</span></summary>
      <table className="table small">
        <thead><tr><th>วัน</th><th>สรุป</th><th>ตรวจแล้ว</th><th>ระบบใส่ ไม่ต้องแก้</th><th>แอดมินแก้</th><th>ระบบหยุด (ไม่จำเป็น)</th><th>อ่านไม่ออก</th><th>ถูกลบ</th></tr></thead>
        <tbody>
          {d.days.map((x) => (
            <tr key={x.date}>
              <td>{thaiDay(x.date)}</td><td>{x.notes}</td><td>{x.checked}{x.open ? <span className="muted"> (+{x.open} ยังไม่ส่ง)</span> : null}</td>
              <td className="good">{x.ok} <span className="muted">{pct(x.ok, x.ok + x.edited)}</span></td>
              <td>{x.edited ? `${x.edited} (${Object.entries(x.edits).map(([k, v]) => `${EDIT_TH[k] ?? k} ${v}`).join(', ')})` : 0}</td>
              <td>{x.stopped} {x.stopped ? <span className="muted">({x.stopped_kept})</span> : null}</td>
              <td>{x.misses}</td><td>{x.deleted}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {Object.keys(reasons).length > 0 && (
        <p className="small"><b>ระบบหยุดเพราะ:</b> {Object.entries(reasons).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `${k} ${v.n}${v.kept ? ` (ไม่จำเป็น ${v.kept})` : ''}`).join(' · ')}</p>
      )}
      {d.edited.length > 0 && <p className="small muted">บิลที่แอดมินแก้: {d.edited.map((e) => `#${e.no} ${e.edits.map((k) => EDIT_TH[k] ?? k).join('+')}`).join(' · ')}</p>}
    </details>
  );
}

/** Deleting drafts nobody will send (worker/draftCleanup.ts): off until Benz switches it on, with a preview. */
function CleanupSwitch() {
  const { toast } = useUi();
  const [st, setSt] = useState<{ on: boolean; preview: { no: number; reason: string; action: string }[] } | null>(null);
  const [open, setOpen] = useState(false);
  const load = () => fetch('/api/order-notes/cleanup').then((r) => r.json()).then(setSt).catch(() => {});
  useEffect(() => { load(); }, []);
  async function flip() {
    const r = await fetch('/api/order-notes/cleanup', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: !st?.on }) });
    const j = await r.json();
    if (!r.ok) { toast(j.error ?? 'เปลี่ยนไม่ได้', 'bad'); return; }
    toast(j.on ? 'เปิดลบร่างอัตโนมัติแล้ว' : 'ปิดลบร่างอัตโนมัติแล้ว', 'ok'); load();
  }
  if (!st) return null;
  const label = { delete: 'จะลบ', warn: 'จะเตือน (อีก 2 วันลบ)', keep: 'ยังไม่ถึงเวลา' } as Record<string, string>;
  return (
    <div className={`banner ${st.on ? 'info' : ''}`}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <span><b>ลบร่างที่ไม่มีใครส่ง: {st.on ? 'เปิด' : 'ปิด'}</b> — ไม่ได้ส่งภายใน 7 วัน (เตือนวันที่ 5) ถ้าลูกค้าอาจยกเลิก / ไม่มีเบอร์หรือรหัสไปรษณีย์ / ร่างว่าง · สรุปแก้ภายใน 2 ชม. แทนร่างเดิม — เฉพาะร่าง ไม่แตะบิลที่ส่งแล้ว</span>
        <span style={{ display: 'flex', gap: 6 }}>
          <button className="ghost small" onClick={() => setOpen(!open)}>ดูรายการ ({st.preview.length})</button>
          <button className="ghost small" onClick={flip}>{st.on ? 'ปิด' : 'เปิด'}</button>
        </span>
      </div>
      {open && (st.preview.length ? <ul className="small">{st.preview.map((p) => <li key={p.no}>#{p.no} — {p.reason} · <b>{label[p.action] ?? p.action}</b></li>)}</ul> : <p className="small muted">ตอนนี้ไม่มีร่างที่เข้าเงื่อนไข</p>)}
    </div>
  );
}

interface CorrectionRow {
  note: { mid: string; at: string; text: string; result: string | null; order_no: number | null };
  earlier: { at: string; text: string };
  bill: number; gap_min: number; stage: string; decision: string; change: string | null;
  total: [number | null, number | null]; payment: [string | null, string | null];
  final: { stage: string; items: string[]; total: number } | null; matches: boolean | null;
}

const DECISION_TH: Record<string, string> = {
  rewrite: 'แก้บิลเดิมให้', locked: 'ไม่แตะ แจ้งคน (บิลเลยรอชำระ)', ask: 'ไม่เปิดบิลที่สอง ถามคน', same: 'บิลตรงอยู่แล้ว ไม่ทำอะไร', new: 'ออเดอร์ใหม่ (เหมือนเดิม)', unclear: 'อ่านสรุปไม่ออก ให้คนดู',
};
const bkkTime = (iso: string) => new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(5, 16).replace('T', ' ');

/** A corrected summary changes the bill already made (worker/noteCorrection.ts): off until Benz switches it on, with a replay of recent notes. */
function CorrectionSwitch() {
  const { toast } = useUi();
  const [on, setOn] = useState<boolean | null>(null);
  const [rows, setRows] = useState<CorrectionRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch('/api/order-notes/correction?limit=0').then((r) => r.json()).then((j) => setOn(j.on)).catch(() => {}); }, []);
  async function more() {
    setBusy(true);
    try {
      const j = await fetch(`/api/order-notes/correction?offset=${rows?.length ?? 0}&limit=10`).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      setRows([...(rows ?? []), ...j.preview]);
    } catch (e: any) { toast(e.message, 'bad'); }
    setBusy(false);
  }
  async function flip() {
    const r = await fetch('/api/order-notes/correction', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: !on }) });
    const j = await r.json();
    if (!r.ok) { toast(j.error ?? 'เปลี่ยนไม่ได้', 'bad'); return; }
    setOn(j.on); toast(j.on ? 'เปิดแก้บิลตามสรุปใหม่แล้ว' : 'ปิดแก้บิลตามสรุปใหม่แล้ว', 'ok');
  }
  if (on === null) return null;
  return (
    <div className={`banner ${on ? 'info' : ''}`}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <span><b>แก้บิลตามสรุปใหม่: {on ? 'เปิด' : 'ปิด'}</b> — สรุปใหม่ภายใน 2 ชม.: แก้ในบิลเดิม ถ้ายังเป็นร่างหรือรอชำระ (บิลที่ส่งแล้วแจ้ง #ออเดอร์มีปัญหา) · เลยรอชำระ: ไม่แตะ แจ้งคน · หลัง 2 ชม. รุ่นเดิมแต่ไซส์/สีต่าง: ไม่เปิดบิลที่สอง ถามคน</span>
        <span style={{ display: 'flex', gap: 6 }}>
          <button className="ghost small" disabled={busy} onClick={more}>{rows ? 'ดูเพิ่ม' : 'ดูว่าจะทำอะไรกับสรุปจริง 10 วัน'}</button>
          <button className="ghost small" onClick={flip}>{on ? 'ปิด' : 'เปิด'}</button>
        </span>
      </div>
      {rows && (rows.length ? (
        <ul className="small">{rows.map((r) => (
          <li key={r.note.mid}>
            #{r.bill} · {bkkTime(r.earlier.at)} → {bkkTime(r.note.at)} ({r.gap_min} นาที, {r.stage}) · <b>{DECISION_TH[r.decision] ?? r.decision}</b>
            {r.change && <> · {r.change}</>}
            {r.payment[0] !== r.payment[1] && <> · {r.payment[0]} → {r.payment[1]}</>}
            {r.total[0] !== r.total[1] && <> · ยอด {r.total[0]} → {r.total[1]}</>}
            {r.final && <span className="muted"> · บิลจบที่ {r.final.items.join(', ')} ยอด {r.final.total} ({r.final.stage}){r.matches === true ? ' ✓ ตรงกับสรุปใหม่' : r.matches === false ? ' ✗ ไม่ตรงสรุปใหม่' : ''}</span>}
          </li>
        ))}</ul>
      ) : <p className="small muted">ไม่มีสรุปซ้ำของลูกค้าเดิมใน 10 วัน</p>)}
    </div>
  );
}

/** Whether the Worker can reach Page365 with its stored login (needed for the fill button). */
function SessionBanner() {
  const [st, setSt] = useState<{ ok: boolean; error: string | null } | null>(null);
  useEffect(() => { api.p365Session().then(setSt).catch(() => setSt(null)); }, []);
  if (!st || st.ok) return null;
  return <div className="banner">ปุ่ม "ใส่ใน Page365" ยังใช้ไม่ได้: {st.error}</div>;
}

/** The plan for one note (looked up live in Page365) and the button that puts the items into the draft. */
const ADDRESS_FIELDS: [keyof PlanAddress, string][] = [['name', 'ชื่อผู้รับ'], ['phone', 'เบอร์'], ['street', 'บ้านเลขที่ / หมู่ / ซอย / ถนน'], ['subdistrict', 'ตำบล/แขวง'], ['district', 'อำเภอ/เขต'], ['province', 'จังหวัด'], ['postal_code', 'รหัสไปรษณีย์']];
const EMPTY_ADDRESS: PlanAddress = { name: '', phone: '', street: '', subdistrict: '', district: '', province: '', postal_code: '', from_image: false, source: 'chat' };

/** The plan for one note (looked up live in Page365, address read from the chat) and the button that fills the draft. */
function FillModal({ note, onClose, onDone }: { note: NoteCheck; onClose: () => void; onDone: () => void }) {
  const { toast } = useUi();
  const [plan, setPlan] = useState<FillPlan | null>(null);
  const [address, setAddress] = useState<PlanAddress | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.fillPlan(note.mid).then((p) => { setPlan(p); setAddress(p.address); }).catch((e) => setError(e.message)); }, [note.mid]);
  const addressOk = !!address && /^\d{5}$/.test(address.postal_code) && /^0\d{8,9}$/.test(address.phone.replace(/\D/g, '')) && !!address.province && !!address.district && !!address.street;
  async function fill() {
    setBusy(true);
    try {
      const r = await api.fillNote(note.mid, { address: addressOk ? address : null, allow_warnings: true });
      toast(`ใส่ร่าง #${r.order_no} แล้ว ยอด ${baht(r.total)} — เปิดใน Page365 แล้วกดส่งบิลได้เลย`, 'ok');
      onDone();
    } catch (e: any) { toast(e.message, 'bad'); setBusy(false); }
  }
  const set = (k: keyof PlanAddress, v: string) => setAddress((a) => ({ ...(a ?? EMPTY_ADDRESS), [k]: v, source: 'chat' }));
  return (
    <Modal title="ใส่บิลใน Page365" onClose={onClose}>
      <p className="small" style={{ whiteSpace: 'pre-line', fontFamily: 'ui-monospace, monospace' }}>{note.text}</p>
      {error ? <p className="error">{error}</p> : !plan ? <><div className="skeleton" style={{ height: 120 }} /><p className="muted small">กำลังดูใน Page365 และอ่านที่อยู่จากแชท…</p></> : (
        <>
          <p className="small">{plan.order ? <>ร่าง <b>#{plan.order.no}</b> · ชื่อบิล <b>{plan.bill_name}</b></> : <span className="bad">ไม่เจอร่างบิล</span>}</p>
          <table className="data-table small">
            <thead><tr><th>Page365</th><th className="num">ราคา</th><th className="num">จำนวน</th><th className="num">เหลือ</th></tr></thead>
            <tbody>
              {plan.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.sku ?? <span className="bad">{l.code} ไซส์ {l.size} — ไม่พบ</span>}</td>
                  <td className="num">{l.price != null ? baht(l.price) : '–'}</td>
                  <td className="num">{l.qty}</td>
                  <td className="num">{l.available != null ? num(l.available) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small">
            สินค้า {baht(plan.subtotal)} + ค่าส่ง {baht(plan.shipping)} − ส่วนลดโปร {baht(plan.discount)} = <b>{plan.total != null ? baht(plan.total) : '–'}</b>
            {' '}({plan.payment === 'cod' ? 'ปลายทาง' : 'โอน'}){plan.chat_total != null && <span className="muted"> · ในแชทตกลง {baht(plan.chat_total)}</span>}
          </p>
          {(plan.notes ?? []).length > 0 && <p className="small muted">{plan.notes!.join(' · ')}</p>}
          {plan.problems.length > 0 && <ul className="small bad">{plan.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
          {plan.warnings.length > 0 && <ul className="small warn">{plan.warnings.map((p, i) => <li key={i}>{p}</li>)}</ul>}
          {plan.said.length > 0 && (
            <div className="small">
              <div className="muted">ลูกค้าพิมพ์เรื่องไซส์ไว้ในแชท:</div>
              {plan.said.map((t, i) => <div key={i}>“{t}”</div>)}
            </div>
          )}
          {plan.order && plan.problems.length === 0 && (
            <div className="small" style={{ margin: '8px 0' }}>
              <div className="muted">
                ที่อยู่จัดส่ง {address?.source === 'page365' ? '(มีในร่างอยู่แล้ว)' : address?.from_image ? '(อ่านจากรูปในแชท — เช็กให้ดี)' : address ? '(อ่านจากแชท)' : '(ยังไม่มี — กรอกเองได้)'}
              </div>
              <div className="grid2">
                {ADDRESS_FIELDS.map(([k, label]) => (
                  <label key={k} className="small">{label}
                    <input value={String(address?.[k] ?? '')} onChange={(e) => set(k, e.target.value)} disabled={busy} />
                  </label>
                ))}
              </div>
              {!addressOk && <div className="warn">ที่อยู่ยังไม่ครบ — จะใส่แค่สินค้า แอดมินกรอกที่อยู่ใน Page365 เอง</div>}
            </div>
          )}
          <p className="muted small">ระบบใส่สินค้า ไซส์ จำนวน ค่าส่ง ส่วนลด ชื่อบิล และที่อยู่ลงในร่าง — บิลยังเป็นร่าง ยังไม่ส่งหาลูกค้า · เปิดบิลใน Page365 แล้วกด "ส่งบิล" เองเหมือนเดิม</p>
          <div className="row gap">
            <button disabled={busy || plan.problems.length > 0 || !plan.order} onClick={fill}>{busy ? 'กำลังใส่…' : `ใส่ร่าง${plan.order ? ` #${plan.order.no}` : ''}`}</button>
            <button className="ghost" onClick={onClose}>ปิด</button>
          </div>
        </>
      )}
    </Modal>
  );
}

/**
 * "Fill all that pass": every note of the day not yet filled, one by one — plan (live in Page365), and fill only
 * when there is no problem and no warning (complete address, chat price agrees, …). The rest stay for a person.
 */
function FillAll({ notes, onDone }: { notes: NoteCheck[]; onDone: () => void }) {
  const { toast, confirm } = useUi();
  const [run, setRun] = useState<{ i: number; n: number; done: number[]; skipped: { text: string; why: string }[] } | null>(null);
  const todo = notes.filter((n) => !n.fill.at && n.verdict !== 'unparsed' && n.items.every((i) => i.catalog || !i.sizes.length));
  async function go() {
    if (!(await confirm({ title: `ใส่บิลใน Page365 ${todo.length} ใบ?`, body: 'ใส่เฉพาะใบที่ผ่านทุกข้อ (สินค้า ไซส์ สต็อก ยอดตรงกับแชท ที่อยู่ครบ) — ใบที่มีปัญหาหรือคำเตือนจะข้ามไว้ให้คนดู · บิลยังเป็นร่าง ยังไม่ส่งหาลูกค้า', confirmLabel: 'ใส่เลย' }))) return;
    const st = { i: 0, n: todo.length, done: [] as number[], skipped: [] as { text: string; why: string }[] };
    setRun({ ...st });
    for (const n of todo) {
      st.i++;
      try {
        const p = await api.fillPlan(n.mid);
        const why = [...p.problems, ...p.warnings];
        if (why.length || !p.order) st.skipped.push({ text: n.text.replace(/\s+/g, ' '), why: why.join(' · ') || 'ไม่เจอร่าง' });
        else { const r = await api.fillNote(n.mid, { address: p.address }); st.done.push(r.order_no); }
      } catch (e: any) { st.skipped.push({ text: n.text.replace(/\s+/g, ' '), why: e.message }); }
      setRun({ ...st, done: [...st.done], skipped: [...st.skipped] });
    }
    toast(`ใส่แล้ว ${st.done.length} ใบ · ข้าม ${st.skipped.length} ใบ`, 'ok');
    onDone();
  }
  return (
    <div style={{ padding: '0 18px 12px' }}>
      <button disabled={!todo.length || (run !== null && run.i < run.n)} onClick={go}>
        {run && run.i < run.n ? `กำลังใส่… ${run.i}/${run.n}` : `ใส่ทุกใบที่ผ่าน (${todo.length})`}
      </button>
      {run && (
        <div className="small" style={{ marginTop: 6 }}>
          {run.done.length > 0 && <div className="good">ใส่แล้ว: {run.done.map((no) => `#${no}`).join(', ')}</div>}
          {run.skipped.map((s, i) => <div key={i} className="warn">ข้าม “{s.text}” — {s.why}</div>)}
        </div>
      )}
    </div>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });

/** Shop messages that look like a note but weren't read: each is a format to add (worker/noteFormats.test.ts). */
function NoteMisses({ refresh }: { refresh: number }) {
  const [misses, setMisses] = useState<{ mid: string; at: string; text: string; resolved_at: string | null }[]>([]);
  useEffect(() => { api.orderNoteMisses().then((r) => setMisses(r.misses)).catch(() => {}); }, [refresh]);
  const open = misses.filter((m) => !m.resolved_at);
  if (!misses.length) return null;
  return (
    <details className="card" style={{ marginBottom: 12 }} open={open.length > 0}>
      <summary><strong>สรุปที่ระบบอ่านไม่ออก</strong> <span className="muted small">{open.length} รอเพิ่มรูปแบบ · {misses.length - open.length} อ่านได้แล้ว (14 วัน)</span></summary>
      <p className="muted small">ข้อความของร้านที่มี cod/โอน + ยอด + รหัส แต่ระบบอ่านไม่ได้ — แจ้งห้องออเดอร์มีปัญหาแล้ว ส่งให้ Claude เพิ่มเข้าชุดรูปแบบ แล้วระบบจะกลับมาอ่านเองในรอบตรวจ (ทุก 3 ชม.)</p>
      <table className="table small">
        <tbody>
          {misses.map((m) => (
            <tr key={m.mid}>
              <td className="muted">{when(m.at)}</td>
              <td><code style={{ whiteSpace: 'pre-wrap' }}>{m.text}</code></td>
              <td>{m.resolved_at ? <span className="good">อ่านได้แล้ว</span> : <span className="bad">รอเพิ่มรูปแบบ</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function OrderNotesList({ date, dayLabel, refresh = 0, live = false }: { date: string; dayLabel: string; refresh?: number; live?: boolean }) {
  const [res, setRes] = useState<Awaited<ReturnType<typeof api.orderNotes>> | null>(null);
  const [error, setError] = useState('');
  const [filling, setFilling] = useState<NoteCheck | null>(null);
  const [again, setAgain] = useState(0);
  useEffect(() => { setRes(null); setError(''); }, [date]);
  useEffect(() => {
    let live = true;
    api.orderNotes(date).then((r) => { if (live) setRes(r); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [date, refresh, again]);
  // Newest first, like a log.
  const notes = [...(res?.notes ?? [])].reverse();
  const count = (v: NoteCheck['verdict']) => notes.filter((n) => n.verdict === v).length;
  const compared = notes.filter((n) => n.order_no).length;
  const noCatalog = notes.reduce((t, n) => t + n.items.filter((i) => !i.catalog).length, 0);
  const noSize = notes.reduce((t, n) => t + n.items.filter((i) => !i.catalog && i.sizes.length).length, 0);

  return (
    <section className="card table-card">
      <div className="table-card-head">
        <div>
          <h2>สรุปออเดอร์ในแชท vs Page365 {dayLabel} <span className="muted small">ทดลอง · ยังไม่แตะ Page365{live ? ' · อัปเดตเองทุก 1 นาที' : ''}</span></h2>
          <p className="muted small">
            ระบบอ่านบรรทัดที่แอดมินพิมพ์สรุปในแชท (เช่น "501/1/2 32 / cod 449") แล้วเทียบกับสินค้าที่เปิดบิลใน Page365 จริง (จากไฟล์ที่อัปโหลด)
            · ถ้าตรงกันเกือบทุกใบ ขั้นต่อไประบบจะเปิดบิลให้เอง
          </p>
          {res && notes.length > 0 && (
            <p className="small">
              อ่านได้ <b>{num(notes.length)}</b> ใบ · เทียบได้ {num(compared)}
              {compared > 0 && <> · <span className="good">ตรงกัน {num(count('same'))} ({num((count('same') / compared) * 100)}%)</span></>}
              {count('diff_items') > 0 && <> · <span className="bad">สินค้าต่าง {num(count('diff_items'))}</span></>}
              {count('diff_total') > 0 && <> · <span className="warn">ยอดต่าง {num(count('diff_total'))}</span></>}
              {count('unparsed') > 0 && <> · <span className="warn">อ่านไม่ออก {num(count('unparsed'))}</span></>}
              {noSize > 0 && <> · <span className="bad">ไซส์ไม่มีขาย {num(noSize)} รายการ</span></>}
              {noCatalog - noSize > 0 && <> · <span className="warn">ไม่พบใน Catalog {num(noCatalog - noSize)} รายการ</span></>}
              {res.uploaded ? <> · ออเดอร์ Page365 ที่ไม่มีสรุปในแชท {num(res.orders_without_note)} จาก {num(res.orders)}</> : <span className="muted"> · ยังไม่ได้อัปโหลดไฟล์ Page365 ของวันนี้</span>}
            </p>
          )}
        </div>
      </div>
      {res && res.notes.length > 0 && <FillAll notes={res.notes} onDone={() => setAgain((x) => x + 1)} />}
      {error ? <p className="error" style={{ margin: '0 18px 12px' }}>{error}</p> : !res ? <div className="skeleton" style={{ height: 80, margin: '0 18px 12px' }} /> : notes.length === 0 ? (
        <p className="muted small" style={{ padding: '0 18px 12px' }}>ยังไม่มีบรรทัดสรุปของ{dayLabel} — เก็บตั้งแต่กด "เชื่อมต่อใหม่" ที่การ์ด Messenger webhook ในหน้าตั้งค่า (15 ต.ค.)</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>เวลา</th><th>แอดมินพิมพ์</th><th>ระบบอ่านได้</th><th>Page365</th><th>ผล</th><th>เปิดบิล</th></tr></thead>
            <tbody>
              {notes.map((n, i) => {
                const [label, tone] = n.verdict === 'no_order' && !res.uploaded ? ['รอไฟล์ Page365', ''] : VERDICT[n.verdict];
                return (
                  <tr key={i}>
                    <td className="small">{time(n.at)}</td>
                    <td className="small" style={{ whiteSpace: 'pre-line', fontFamily: 'ui-monospace, monospace' }}>{n.text}</td>
                    <td className="small">
                      {n.items.map((it, j) => (
                        <div key={j} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                          {it.catalog?.image ? <img src={thumb(it.catalog.image)} alt="" width={32} height={32} style={{ objectFit: 'cover', borderRadius: 4, flex: 'none' }} loading="lazy" /> : <span style={{ width: 32, flex: 'none' }} />}
                          <div>
                            <b>{it.catalog?.sku ?? `${it.code} ${it.size}`}</b> × {it.qty}
                            {it.catalog ? (
                              <div className="muted">{it.catalog.name}{it.catalog.others.length > 0 && ` · มีที่ ${it.catalog.others.join(', ')} ด้วย`}</div>
                            ) : it.sizes.length ? (
                              <div className="bad">ไม่มีไซส์ {it.size} — รุ่นนี้มี {it.sizes.join(', ')} · ต้องถามลูกค้าใหม่</div>
                            ) : <div className="warn">ไม่พบรุ่นนี้ใน Catalog</div>}
                          </div>
                        </div>
                      ))}
                      {n.unknown.map((u, j) => <div key={`u${j}`} className="warn">? {u}</div>)}
                      <div className="muted">{n.payment === 'cod' ? 'ปลายทาง' : 'โอน'} {n.total != null ? baht(n.total) : ''}</div>
                    </td>
                    <td className="small">
                      {n.order_no ? (
                        <>
                          <div>#{n.order_no}{n.linked_by === 'total' && <span className="muted"> (จับจากยอด+เวลา)</span>}</div>
                          {n.order_items.map((it, j) => <div key={j}>{it.sku} × {it.qty}</div>)}
                          <div className="muted">{n.order_total != null ? baht(n.order_total) : ''}</div>
                        </>
                      ) : <span className="muted">–</span>}
                    </td>
                    <td className="small">
                      <span className={`tag ${tone}`}>{label}</span>
                      {n.missing.length > 0 && <div className="bad">ในแชทแต่ไม่อยู่ในบิล: {n.missing.join(', ')}</div>}
                      {n.extra.length > 0 && <div className="bad">ในบิลแต่ไม่อยู่ในแชท: {n.extra.join(', ')}</div>}
                    </td>
                    <td className="small">
                      {n.fill.at ? <span className="good">ใส่แล้ว #{n.fill.order_no}<div className="muted">{n.fill.by} · {when(n.fill.at)}</div></span>
                        : <>
                          <button className="ghost small" onClick={() => setFilling(n)}>ใส่ใน Page365</button>
                          {n.fill.error && <div className="bad">{/^(ต้องให้คนดู|เปิดร่างแล้ว|รอเปิดร่าง)/.test(n.fill.error) ? n.fill.error : `ครั้งก่อนไม่สำเร็จ: ${n.fill.error}`}{n.fill.order_no ? ` (บิล #${n.fill.order_no})` : ''}</div>}
                        </>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {filling && <FillModal note={filling} onClose={() => setFilling(null)} onDone={() => { setFilling(null); setAgain((x) => x + 1); }} />}
    </section>
  );
}
