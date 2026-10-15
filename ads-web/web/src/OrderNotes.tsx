// "Log ออเดอร์แชท" tab: admins' order notes in the chat ("501/1/2 32 / cod 449") as the system reads them, as they
// come in, next to what Page365 holds for the same order once the day's export is uploaded. Phase 0 of filling Page365 orders automatically: if the
// two agree often enough, the system can later fill the orders itself.

import { useEffect, useState } from 'react';
import { api, type FillPlan, type NoteCheck } from './api.ts';
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
      <SessionBanner />
      <OrderNotesList date={date} dayLabel={date === todayBkk() ? 'วันนี้' : thaiDay(date)} refresh={tick} live={date === todayBkk()} />
    </>
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
function FillModal({ note, onClose, onDone }: { note: NoteCheck; onClose: () => void; onDone: () => void }) {
  const { toast } = useUi();
  const [plan, setPlan] = useState<FillPlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.fillPlan(note.mid).then(setPlan).catch((e) => setError(e.message)); }, [note.mid]);
  async function fill() {
    setBusy(true);
    try {
      const r = await api.fillNote(note.mid);
      toast(`ใส่สินค้าในร่าง #${r.order_no} แล้ว ยอด ${baht(r.total)} — เปิดใน Page365 แล้วกดบันทึกและส่งบิลได้เลย`, 'ok');
      onDone();
    } catch (e: any) { toast(e.message, 'bad'); setBusy(false); }
  }
  return (
    <Modal title="ใส่สินค้าในร่างบิล Page365" onClose={onClose}>
      <p className="small" style={{ whiteSpace: 'pre-line', fontFamily: 'ui-monospace, monospace' }}>{note.text}</p>
      {error ? <p className="error">{error}</p> : !plan ? <div className="skeleton" style={{ height: 120 }} /> : (
        <>
          <p className="small">{plan.order ? <>ร่าง <b>#{plan.order.no}</b> ของลูกค้าคนนี้</> : <span className="bad">ไม่เจอร่างบิล</span>}</p>
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
            {' '}({plan.payment === 'cod' ? 'ปลายทาง' : 'โอน'})
          </p>
          {plan.problems.length > 0 && <ul className="small bad">{plan.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
          {plan.said.length > 0 && (
            <div className="small">
              <div className="muted">ลูกค้าพิมพ์เรื่องไซส์ไว้ในแชท:</div>
              {plan.said.map((t, i) => <div key={i}>“{t}”</div>)}
            </div>
          )}
          <p className="muted small">ระบบใส่สินค้า ไซส์ จำนวน ค่าส่ง และส่วนลดลงในร่างเท่านั้น — บิลยังเป็นร่าง ยังไม่ส่งหาลูกค้า · เปิดบิลใน Page365 แล้วกด "บันทึกและส่ง" เองเหมือนเดิม</p>
          <div className="row gap">
            <button disabled={busy || plan.problems.length > 0 || !plan.order} onClick={fill}>{busy ? 'กำลังใส่…' : `ใส่สินค้าในร่าง${plan.order ? ` #${plan.order.no}` : ''}`}</button>
            <button className="ghost" onClick={onClose}>ปิด</button>
          </div>
        </>
      )}
    </Modal>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });

export function OrderNotesList({ date, dayLabel, refresh = 0, live = false }: { date: string; dayLabel: string; refresh?: number; live?: boolean }) {
  const [res, setRes] = useState<Awaited<ReturnType<typeof api.orderNotes>> | null>(null);
  const [error, setError] = useState('');
  const [filling, setFilling] = useState<NoteCheck | null>(null);
  const [again, setAgain] = useState(0);
  useEffect(() => { setRes(null); setError(''); }, [date]);
  useEffect(() => { api.orderNotes(date).then(setRes).catch((e) => setError(e.message)); }, [date, refresh, again]);
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
                          {n.fill.error && <div className="bad" title={n.fill.error}>ครั้งก่อนไม่สำเร็จ</div>}
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
