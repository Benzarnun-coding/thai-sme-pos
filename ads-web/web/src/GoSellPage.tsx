// Bigseller order export → GoSell import file, entirely in the browser (customer names/phones/addresses never
// leave the page). Conversion rules live in gosell.ts.

import { useState } from 'react';
import templateUrl from './gosellTemplate.xlsx?url';
import { buildWorkbook, parseExport, REQUIRED_COLUMNS, toGoSell, type GoSellOrder, type SourceRow } from './gosell.ts';
import { baht, num } from './fmt.ts';
import { Icon, useUi } from './ui.tsx';
import { readFirstSheet } from './xlsx.ts';

interface Loaded { file: string; orders: GoSellOrder[]; skipped: { orderNo: string; reason: string }[]; items: number }

export function GoSellPage() {
  const { toast } = useUi();
  const [data, setData] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState('');
  const [includeProblems, setIncludeProblems] = useState(false);

  async function onFile(file: File) {
    setBusy('กำลังอ่านไฟล์…');
    try {
      let headers: string[], rows: SourceRow[];
      if (/\.xlsx$/i.test(file.name)) ({ headers, rows } = await readFirstSheet(file));
      else ({ headers, rows } = parseExport(new Uint8Array(await file.arrayBuffer())));
      const missing = REQUIRED_COLUMNS.filter((h) => !headers.includes(h) && !(h === 'No.' && headers.includes('Order no.')));
      if (missing.length) throw new Error(`ไฟล์ไม่มีคอลัมน์ ${missing.join(', ')}: ต้องเป็นไฟล์ export ออเดอร์จาก Bigseller (แถวละ 1 สินค้า)`);
      const { orders, skipped } = toGoSell(rows);
      if (!orders.length) throw new Error('ไม่พบออเดอร์ในไฟล์');
      setData({ file: file.name, orders, skipped, items: rows.length });
      setIncludeProblems(false);
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }

  const ready = data?.orders.filter((o) => !o.problems.length) ?? [];
  const problems = data?.orders.filter((o) => o.problems.length) ?? [];
  const exportList = includeProblems ? data?.orders ?? [] : ready;

  async function download() {
    if (!exportList.length) return;
    setBusy('กำลังสร้างไฟล์…');
    try {
      const template = new Uint8Array(await (await fetch(templateUrl)).arrayBuffer());
      const bytes = await buildWorkbook(template, exportList);
      const dates = exportList.map((o) => o.orderedAt.slice(0, 10)).filter(Boolean).sort();
      const span = dates.length ? (dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]}_${dates[dates.length - 1]}`) : 'orders';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = `GoSell-import-${span}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      toast(`สร้างไฟล์ ${exportList.length} ออเดอร์แล้ว`, 'ok');
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }

  return (
    <>
      <section className="card">
        <div className="table-card-head" style={{ padding: 0 }}>
          <div>
            <h2>แปลงออเดอร์ Bigseller → GoSell</h2>
            <p className="muted small">
              อัปโหลดไฟล์ export ออเดอร์จาก Bigseller (.csv หรือ .xlsx, แถวละ 1 สินค้า) → ได้ไฟล์นำเข้าคำสั่งซื้อของ GoSell
              · แปลงในเบราว์เซอร์นี้เท่านั้น ไม่ส่งชื่อ เบอร์ ที่อยู่ขึ้นเซิร์ฟเวอร์
            </p>
          </div>
          <label className={`button ${busy ? 'disabled' : ''}`} style={{ cursor: busy ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
            <Icon name="up" size={14} /> {busy || (data ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์ Bigseller')}
            <input type="file" accept=".csv,.tsv,.txt,.xlsx" style={{ display: 'none' }} disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
          </label>
        </div>
        {!data && (
          <ul className="notes muted small" style={{ marginTop: 12 }}>
            <li>รวมสินค้าในออเดอร์เดียวกันเป็น 1 แถว: <code>SKU (จำนวน), SKU (จำนวน)</code> ราคาต่อชิ้นคั่นด้วยลูกน้ำตามลำดับ SKU</li>
            <li>แยกที่อยู่เป็น ตำบล/อำเภอ/จังหวัด/รหัสไปรษณีย์ · cod → COD, อื่น ๆ → การโอนเงิน · Kerry → KEX</li>
            <li>ส่วนลด → ส่วนลดคำสั่งซื้อ · ค่าส่งในไฟล์ (50 บาทของ COD) → ค่าบริการเก็บเงินปลายทาง · ข้ามออเดอร์ที่ยกเลิก</li>
          </ul>
        )}
      </section>

      {data && (
        <>
          <div className="kpis">
            <div className="kpi"><span>ออเดอร์</span><b>{num(data.orders.length)}</b><small>{num(data.items)} แถวสินค้าใน {data.file}</small></div>
            <div className="kpi"><span>พร้อมนำเข้า</span><b className="good">{num(ready.length)}</b></div>
            <div className="kpi"><span>ต้องแก้</span><b className={problems.length ? 'bad' : ''}>{num(problems.length)}</b>{data.skipped.length > 0 && <small>ข้าม {data.skipped.length} (ยกเลิก)</small>}</div>
            <div className="kpi"><span>ยอดรวม</span><b>{baht(exportList.reduce((t, o) => t + o.total, 0))}</b><small>ของออเดอร์ที่จะส่งออก</small></div>
          </div>

          <section className="card">
            <div className="table-card-head" style={{ padding: 0 }}>
              <div>
                <h2>ส่งออกไฟล์ GoSell</h2>
                <p className="muted small">นำไฟล์ไปที่ GoSell → นำเข้าคำสั่งซื้อ (Import Orders) · SKU ต้องมีในระบบ GoSell</p>
              </div>
              <button className="primary" disabled={!!busy || !exportList.length} onClick={download}>
                <Icon name="down" size={14} /> ดาวน์โหลด .xlsx ({num(exportList.length)} ออเดอร์)
              </button>
            </div>
            {problems.length > 0 && (
              <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}>
                <input type="checkbox" checked={includeProblems} onChange={(e) => setIncludeProblems(e.target.checked)} />
                รวม {problems.length} ออเดอร์ที่ต้องแก้ด้วย (แก้ในไฟล์ Excel เองก่อนนำเข้า)
              </label>
            )}
          </section>

          {problems.length > 0 && <OrderTable title="ต้องแก้ก่อนนำเข้า" orders={problems} showProblems />}
          <OrderTable title="ตัวอย่างข้อมูลที่จะลง GoSell" orders={ready} />
        </>
      )}
    </>
  );
}

function OrderTable({ title, orders, showProblems }: { title: string; orders: GoSellOrder[]; showProblems?: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? orders : orders.slice(0, 20);
  if (!orders.length) return null;
  return (
    <section className="card table-card">
      <div className="table-card-head"><h2>{title} <span className="muted small">({num(orders.length)})</span></h2></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>เลขออเดอร์</th><th>ลูกค้า</th><th>ที่อยู่</th><th>ตำบล</th><th>อำเภอ</th><th>จังหวัด</th><th>รหัส ปณ.</th>
              <th>ชำระ / ขนส่ง</th><th>SKU (จำนวน)</th><th className="num">ราคา/ชิ้น</th><th className="num">ส่วนลด</th><th className="num">COD</th><th className="num">ยอด</th><th>วันที่</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <tr key={o.orderNo}>
                <td><b>{o.orderNo}</b>{showProblems && <div className="bad small">{o.problems.join(' · ')}</div>}</td>
                <td>{o.customer}<div className="muted small">{o.phone}</div></td>
                <td className="small">{o.address}</td>
                <td>{o.subdistrict}</td><td>{o.district}</td><td>{o.province}</td><td>{o.zip}</td>
                <td className="small">{o.payment}<div className="muted">{o.carrier || '—'}</div></td>
                <td className="small" style={{ whiteSpace: 'pre-line' }}>{o.skus.split(', ').join('\n')}</td>
                <td className="num small" style={{ whiteSpace: 'pre-line' }}>{o.prices.split(', ').join('\n')}</td>
                <td className="num">{num(o.orderDiscount)}</td>
                <td className="num">{num(o.codFee)}</td>
                <td className="num">{baht(o.total)}</td>
                <td className="small">{o.orderedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.length > 20 && <button className="ghost small" onClick={() => setAll(!all)}>{all ? 'ย่อ' : `ดูทั้งหมด ${orders.length} ออเดอร์`}</button>}
      </div>
    </section>
  );
}
