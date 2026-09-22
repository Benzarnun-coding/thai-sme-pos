import { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import { studioApi, type Usage } from './api';

/**
 * The token meter: what the AI cost this month, per box, and the monthly cap
 * that stops AI runs (automation keeps going). In demo mode the numbers are
 * estimates from prompt length, labelled as such, so the owner still sees what a
 * day of runs would cost before putting a key in.
 */
const thb = (n: number) => '฿' + (n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString('th-TH'));
const k = (n: number) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n));

export default function UsageMeter({ store }: { store: string }) {
  const [u, setU] = useState<Usage | null>(null);
  const [cap, setCap] = useState('');
  const [saving, setSaving] = useState(false);
  const load = () => studioApi.usage(store).then((x) => { setU(x); setCap(x.cap_thb ? String(x.cap_thb) : ''); }).catch(() => undefined);
  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [store]);
  if (!u) return null;

  const pct = u.cap_thb ? Math.min(100, (u.month.cost_thb / u.cap_thb) * 100) : 0;
  const tone = !u.cap_thb ? 'var(--brand)' : pct >= 100 ? 'var(--crit)' : pct >= 80 ? 'var(--warn)' : 'var(--good)';
  const max = Math.max(1, ...u.by_day.map((d) => d.cost_thb));
  const save = async () => {
    setSaving(true);
    try { const r = await studioApi.setAiCap(store, cap.trim() ? Number(cap) : null); setU({ ...u, cap_thb: r.cap_thb }); } finally { setSaving(false); }
  };

  return (
    <section className="panel panel-pad">
      <div className="panel-head">
        <h3><Gauge size={16} /> มิเตอร์ Token เดือนนี้</h3>
        <span className="t-label">{u.estimated ? 'โหมดตัวอย่าง · ตัวเลขประเมินจากความยาว prompt' : `ราคาจริง · ${u.thb_per_usd} บาท/ดอลลาร์`}</span>
      </div>
      <div className="grid sm:grid-cols-4 gap-3">
        <div className="rounded-xl px-3 py-2" style={{ background: 'var(--panel-2)' }}>
          <div className="t-label">ใช้ไปเดือนนี้</div>
          <div className="t-num text-[22px]" style={{ color: tone }}>{thb(u.month.cost_thb)}</div>
          <div className="t-sub">{u.month.calls} ครั้ง · เข้า {k(u.month.tokens_in)} · ออก {k(u.month.tokens_out)} token</div>
        </div>
        <div className="rounded-xl px-3 py-2" style={{ background: 'var(--panel-2)' }}>
          <div className="t-label">Cache hit</div>
          <div className="t-num text-[22px]">{Math.round(u.month.cache_rate * 100)}%</div>
          <div className="t-sub">{u.month.cache_read ? `อ่านจาก cache ${k(u.month.cache_read)} token ที่ 1/10 ราคา` : u.mode === 'claude' ? 'ยังไม่มี cache hit — เช็คว่ารันติดกันภายใน 1 ชม.' : 'จะเห็นเมื่อใช้สมองจริง'}</div>
        </div>
        <div className="rounded-xl px-3 py-2 sm:col-span-2" style={{ background: 'var(--panel-2)' }}>
          <div className="t-label">เพดาน AI รายเดือน {u.cap_thb ? `· ใช้ไป ${Math.round(pct)}%` : '· ยังไม่ตั้ง'}</div>
          <div className="h-2 rounded-full mt-1.5 overflow-hidden" style={{ background: 'var(--line)' }}><div className="h-full" style={{ width: `${pct}%`, background: tone }} /></div>
          <div className="flex items-center gap-2 mt-2">
            <input className="field w-32" inputMode="numeric" placeholder="เช่น 1500" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d]/g, ''))} />
            <span className="t-sub">บาท/เดือน</span>
            <button className="btn btn-sm" disabled={saving} onClick={save}>{saving ? 'บันทึก…' : 'ตั้งเพดาน'}</button>
          </div>
          <div className="t-sub mt-1">ถึงเพดานแล้ว AI หยุดจนขึ้นเดือนใหม่ กล่องอัตโนมัติยังทำงาน{u.mode === 'demo' ? ' · ในโหมดตัวอย่างเพดานยังไม่บังคับ' : ''}</div>
        </div>
      </div>

      {u.by_day.length > 1 && (
        <div className="mt-3">
          <div className="t-label mb-1">รายวัน 30 วัน</div>
          <div className="flex items-end gap-[2px] h-12">
            {u.by_day.map((d) => <div key={d.day} title={`${d.day} · ${thb(d.cost_thb)} · ${d.calls} ครั้ง`} className="flex-1 rounded-t" style={{ height: `${Math.max(4, (d.cost_thb / max) * 100)}%`, background: 'var(--brand)', opacity: 0.75 }} />)}
          </div>
        </div>
      )}

      {u.by_box.length > 0 && (
        <table className="tbl mt-3 w-full text-sm">
          <thead><tr><th>กล่อง</th><th className="text-right">ครั้ง</th><th className="text-right">เข้า</th><th className="text-right">ออก</th><th className="text-right">cache</th><th className="text-right">บาท</th></tr></thead>
          <tbody>
            {u.by_box.map((b) => (
              <tr key={b.slug}>
                <td>{b.emoji} {b.name}</td>
                <td className="text-right t-num">{b.calls}</td>
                <td className="text-right t-num">{k(b.tokens_in)}</td>
                <td className="text-right t-num">{k(b.tokens_out)}</td>
                <td className="text-right t-num">{k(b.cache_read)}</td>
                <td className="text-right t-num">{thb(b.cost_thb)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="t-sub mt-2">ค่า output แพงกว่า input 5 เท่า กล่องที่ตอบยาวคือตัวกินจริง ลด effort หรือสั่งให้ตอบสั้นก่อนคิดเปลี่ยนรุ่น</p>
    </section>
  );
}
