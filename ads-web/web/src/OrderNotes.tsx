// "Log ออเดอร์แชท" tab: admins' order notes in the chat ("501/1/2 32 / cod 449") as the system reads them, as they
// come in, next to what Page365 holds for the same order once the day's export is uploaded. Phase 0 of filling Page365 orders automatically: if the
// two agree often enough, the system can later fill the orders itself.

import { useEffect, useState } from 'react';
import { api, type NoteCheck } from './api.ts';
import { thumb } from './catalog.ts';
import { baht, num } from './fmt.ts';

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
      <OrderNotesList date={date} dayLabel={date === todayBkk() ? 'วันนี้' : thaiDay(date)} refresh={tick} live={date === todayBkk()} />
    </>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });

export function OrderNotesList({ date, dayLabel, refresh = 0, live = false }: { date: string; dayLabel: string; refresh?: number; live?: boolean }) {
  const [res, setRes] = useState<Awaited<ReturnType<typeof api.orderNotes>> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { setRes(null); setError(''); }, [date]);
  useEffect(() => { api.orderNotes(date).then(setRes).catch((e) => setError(e.message)); }, [date, refresh]);
  // Newest first, like a log.
  const notes = [...(res?.notes ?? [])].reverse();
  const count = (v: NoteCheck['verdict']) => notes.filter((n) => n.verdict === v).length;
  const compared = notes.filter((n) => n.order_no).length;
  const noCatalog = notes.reduce((t, n) => t + n.items.filter((i) => !i.catalog).length, 0);

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
              {noCatalog > 0 && <> · <span className="warn">ไม่พบใน Catalog {num(noCatalog)} รายการ</span></>}
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
            <thead><tr><th>เวลา</th><th>แอดมินพิมพ์</th><th>ระบบอ่านได้</th><th>Page365</th><th>ผล</th></tr></thead>
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
                            ) : <div className="warn">ไม่พบใน Catalog</div>}
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
