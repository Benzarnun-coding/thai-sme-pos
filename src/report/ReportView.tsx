import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { studioApi, clock, isToday, type Run } from '../studio/api';

/**
 * Report — the owner's one-minute read.
 *
 * Three numbers, then what needs a decision, then what the ads and posts did,
 * then what the system did today. The narrative at the top is written by the
 * reporter box (its latest run); the tables are the same data it read.
 */
const STORE = 'climax';
const thb = (n: number) => '฿' + Math.round(n).toLocaleString('th-TH');

interface Summary {
  sales_7d: number; qty_7d: number; sales_prev_7d: number;
  ad_spend_7d: number; conversations_7d: number; roas_7d: number | null; cost_per_conversation: number | null;
  daily: { date: string; revenue: number }[]; followers: number | null;
}
interface Signal { product_id: string; name: string; sales_7d: number; trend_pct: number | null; stock_total: number; promotable: boolean; overstock: boolean; note: string; days_of_cover: number | null }
interface Ad { external_ad_id: string; ad_name: string; campaign_name: string; spend: string | number; conversations: number; purchases: number; revenue: string | number }
interface Post { external_post_id: string; created_time: string; message: string | null; reach: number | null; engaged: number | null }

export default function ReportView() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => Promise.all([
    fetch(`/api/stores/${STORE}/summary`).then((x) => x.json()),
    fetch(`/api/stores/${STORE}/signals`).then((x) => x.json()),
    fetch(`/api/stores/${STORE}/ads`).then((x) => x.json()),
    fetch(`/api/stores/${STORE}/posts`).then((x) => x.json()),
    studioApi.runs(STORE, 60),
  ]).then(([s, g, a, p, r]) => { setSummary(s); setSignals(g); setAds(a); setPosts(p); setRuns(r); setError(null); })
    .catch((e) => setError((e as Error).message));
  useEffect(() => { load(); }, []);

  const writeNow = async () => {
    setBusy(true);
    try { await studioApi.run(STORE, 'reporter'); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  if (error) return <div className="p-6"><div className="panel panel-pad" style={{ background: 'var(--crit-soft)', color: 'var(--crit)' }}>{error}</div></div>;
  if (!summary) return <div className="p-10 text-center t-sub" style={{ color: 'var(--muted)' }}>กำลังโหลด…</div>;

  const report = runs.find((r) => r.slug === 'reporter' && r.status === 'ok');
  const narrative = (report?.output as { text?: string } | null)?.text ?? null;
  const growth = summary.sales_prev_7d > 0 ? Math.round(((summary.sales_7d - summary.sales_prev_7d) / summary.sales_prev_7d) * 100) : null;
  const blocked = signals.filter((s) => !s.promotable);
  const over = signals.filter((s) => s.overstock);
  const adRows = ads.map((a) => { const spend = Number(a.spend), rev = Number(a.revenue); return { ...a, spend, rev, roas: spend > 0 ? rev / spend : 0, cpc: a.conversations ? Math.round(spend / a.conversations) : null }; });
  const toScale = adRows.filter((a) => a.roas >= 3);
  const toPause = adRows.filter((a) => a.roas < 1.5 && !/ขายส่ง|inbox/i.test(a.campaign_name));
  const topPosts = [...posts].sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0)).slice(0, 3);
  const today = runs.filter((r) => isToday(r.started_at));
  const decisions = [
    ...blocked.map((b) => ({ tone: 'crit', text: `${b.name} ${b.note} — เติมไซส์ หรือถอดออกจากแอด` })),
    ...toPause.map((a) => ({ tone: 'warn', text: `พักแอด ${a.ad_name} (ROAS ${a.roas.toFixed(1)}x)` })),
    ...toScale.map((a) => ({ tone: 'good', text: `เพิ่มงบ ${a.ad_name} (ROAS ${a.roas.toFixed(1)}x · ฿${a.cpc}/ทัก)` })),
    ...over.map((o) => ({ tone: 'warn', text: `${o.name} เหลือ ${o.stock_total} ตัว ≈ ${o.days_of_cover} วัน — ทำโปรล้างสต็อก` })),
  ];

  return (
    <div className="flex-grow overflow-y-auto p-4 lg:p-6 space-y-5 no-scrollbar">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="t-head text-[22px]">รายงาน</h2>
          <p className="t-sub">อ่านจบใน 1 นาที · 7 วันล่าสุด · {report ? `นักรายงานเขียนเมื่อ ${clock(report.started_at)}` : 'นักรายงานยังไม่ได้เขียนวันนี้'}</p>
        </div>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={writeNow}><RefreshCw size={13} /> {busy ? 'กำลังเขียน…' : 'ให้นักรายงานเขียนตอนนี้'}</button>
      </div>

      {/* three numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile label="ยอดขาย 7 วัน" value={thb(summary.sales_7d)} sub={growth === null ? `${summary.qty_7d} ตัว` : `${growth >= 0 ? '+' : ''}${growth}% เทียบสัปดาห์ก่อน · ${summary.qty_7d} ตัว`} accent tone={growth === null ? undefined : growth >= 0 ? 'good' : 'crit'} />
        <Tile label="ค่าแอด 7 วัน" value={thb(summary.ad_spend_7d)} sub={summary.roas_7d === null ? 'ยังไม่มีข้อมูลแอด' : `ROAS ${summary.roas_7d}x`} tone={summary.roas_7d === null ? undefined : summary.roas_7d >= 3 ? 'good' : summary.roas_7d < 1.5 ? 'crit' : 'warn'} />
        <Tile label="ทักแชทจากแอด" value={String(summary.conversations_7d)} sub={summary.cost_per_conversation === null ? '—' : `฿${summary.cost_per_conversation} ต่อการทัก`} />
        <Tile label="ต้องตัดสินใจ" value={String(decisions.length)} sub={decisions.length ? `${blocked.length} สต็อก · ${toPause.length + toScale.length} แอด · ${over.length} โปร` : 'ไม่มีอะไรค้าง'} tone={decisions.length ? 'warn' : 'good'} />
      </div>

      <div className="grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-5">
        {/* narrative */}
        <section className="panel panel-pad">
          <div className="panel-head"><h3>📈 สรุปจากนักรายงาน</h3><span className="t-label">{report ? (report.output as { mode?: string } | null)?.mode === 'demo' ? 'ตัวอย่าง' : 'Claude' : ''}</span></div>
          {narrative
            ? <div className="text-sm whitespace-pre-line leading-relaxed">{narrative}</div>
            : <p className="t-sub" style={{ color: 'var(--muted)' }}>กด "ให้นักรายงานเขียนตอนนี้" หรือรอรอบ 21:00</p>}
        </section>

        {/* decisions */}
        <section className="panel panel-pad">
          <div className="panel-head"><h3>ต้องตัดสินใจ</h3><span className="t-label">{decisions.length} รายการ</span></div>
          {decisions.length === 0 ? <p className="t-sub" style={{ color: 'var(--good)' }}>✓ ไม่มีอะไรค้าง</p> : (
            <ul className="space-y-2">
              {decisions.map((d, i) => (
                <li key={i} className="text-sm flex gap-2 items-start">
                  <span className="w-2 h-2 rounded-full flex-none mt-2" style={{ background: `var(--${d.tone})` }} />
                  <span>{d.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <section className="panel panel-pad">
          <div className="panel-head"><h3>แอด</h3><span className="t-label">{ads.length} ตัว · เรียงตามที่ใช้ไป</span></div>
          <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>แอด</th><th className="text-right">ใช้ไป</th><th className="text-right">ทัก</th><th className="text-right">฿/ทัก</th><th className="text-right">ROAS</th></tr></thead>
            <tbody>{[...adRows].sort((a, b) => b.spend - a.spend).map((a) => (
              <tr key={a.external_ad_id}>
                <td><b className="font-medium">{a.ad_name}</b><div className="t-label">{a.campaign_name}</div></td>
                <td className="text-right t-num whitespace-nowrap">{thb(a.spend)}</td>
                <td className="text-right t-num">{a.conversations}</td>
                <td className="text-right t-num">{a.cpc ?? '—'}</td>
                <td className="text-right t-num" style={{ color: a.roas >= 3 ? 'var(--good)' : a.roas < 1.5 ? 'var(--crit)' : 'var(--warn)' }}>{a.roas ? a.roas.toFixed(1) + 'x' : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>

        <section className="panel panel-pad">
          <div className="panel-head"><h3>โพสต์ที่ไปได้ไกลสุด</h3><span className="t-label">reach สูงสุด 3 โพสต์</span></div>
          <ul className="flex flex-col">
            {topPosts.map((p, i) => (
              <li key={p.external_post_id} className="py-3" style={i ? { borderTop: '1px solid var(--line)' } : undefined}>
                <div className="flex items-center gap-2"><span className="chip chip-brand t-num">reach {(p.reach ?? 0).toLocaleString('th-TH')}</span><span className="t-label t-mono">{p.created_time?.slice(0, 10)}</span></div>
                <div className="text-sm whitespace-pre-line line-clamp-2 mt-1">{p.message}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="panel panel-pad">
        <div className="panel-head"><h3>ระบบทำอะไรวันนี้</h3><span className="t-label">{today.length} งาน · จากทุกกล่อง</span></div>
        {today.length === 0 ? <p className="t-sub" style={{ color: 'var(--muted)' }}>วันนี้ยังไม่มีกล่องไหนรัน — ไปที่ ระบบหลังบ้าน แล้วกด "รันทั้ง loop ตอนนี้"</p> : (
          <ul className="flex flex-col">
            {today.map((r, i) => (
              <li key={r.id} className="py-2 text-sm flex gap-3 items-start" style={i ? { borderTop: '1px solid var(--line)' } : undefined}>
                <span className="t-mono t-label w-12 flex-none">{clock(r.started_at)}</span>
                <span className="flex-none">{r.emoji}</span>
                <span className="min-w-0"><b className="font-medium">{r.name}</b> <span className={`chip ${r.status === 'ok' ? 'chip-good' : r.status === 'error' ? 'chip-crit' : ''}`}>{r.status === 'ok' ? 'สำเร็จ' : r.status === 'error' ? 'ผิดพลาด' : 'ข้าม'}</span><div className="t-sub line-clamp-2">{r.summary}</div></span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, sub, tone, accent }: { label: string; value: string; sub: string; tone?: 'good' | 'warn' | 'crit'; accent?: boolean }) {
  const toneColor = tone && { good: 'var(--good)', warn: 'var(--warn)', crit: 'var(--crit)' }[tone];
  return (
    <div className="panel panel-pad" style={accent ? { background: 'var(--brand)', borderColor: 'var(--brand)' } : undefined}>
      <div className="t-label" style={accent ? { color: 'rgba(255,255,255,.72)' } : undefined}>{label}</div>
      <div className="t-num text-[28px] leading-tight mt-0.5" style={accent ? { color: 'var(--brand-ink)' } : undefined}>{value}</div>
      <div className="text-xs mt-1.5" style={{ color: accent ? 'rgba(255,255,255,.8)' : toneColor || 'var(--ink-2)' }}>{sub}</div>
    </div>
  );
}
