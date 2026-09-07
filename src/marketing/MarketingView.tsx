import { useEffect, useState } from 'react';

/**
 * Marketing (Project 1): reads real numbers from the LoopDesk server.
 * No AI yet — this screen exists so the owner sees POS sales, size-level stock
 * and the Facebook connection status in one place before any automation runs.
 */
interface Summary {
  sales_7d: number; qty_7d: number; sales_prev_7d: number;
  ad_spend_7d: number; conversations_7d: number; roas_7d: number | null; cost_per_conversation: number | null;
  daily: { date: string; revenue: number }[];
  followers: number | null; followers_date: string | null;
}
interface Signal {
  product_id: string; name: string; category: string | null; base_price: number | null;
  set_price: { qty: number; price: number } | null;
  sales_7d: number; trend_pct: number | null; stock_total: number;
  stock_by_size: Record<string, number>; missing_core_sizes: string[]; core_size_ok: boolean;
  days_of_cover: number | null; overstock: boolean; promotable: boolean; note: string;
}
interface Connection { channel: string; display_name: string; status: string; last_sync_at: string | null; last_error: string | null }

const STORE = 'climax';
const pixelBorder = 'border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]';
const retroFont = { fontFamily: "'VT323', monospace" };
const thb = (n: number) => '฿' + Math.round(n).toLocaleString('th-TH');

export default function MarketingView() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [conns, setConns] = useState<Connection[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [s, g, c] = await Promise.all([
          fetch(`/api/stores/${STORE}/summary`).then((r) => r.json()),
          fetch(`/api/stores/${STORE}/signals`).then((r) => r.json()),
          fetch(`/api/stores/${STORE}/connections`).then((r) => r.json()),
        ]);
        setSummary(s); setSignals(g); setConns(c); setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    };
    load();
  }, []);

  if (error) {
    return (
      <div className="p-6">
        <div className={`${pixelBorder} bg-[#FF6B6B] text-white p-4`}>
          <p style={retroFont} className="text-2xl">SERVER OFFLINE</p>
          <p className="text-sm mt-1">รัน <code>pnpm server:seed</code> แล้ว <code>pnpm server:dev</code> ก่อน (พอร์ต 3001) · {error}</p>
        </div>
      </div>
    );
  }
  if (!summary) return <div className="p-10 text-center"><p style={retroFont} className="text-3xl text-gray-400">LOADING...</p></div>;

  const growth = summary.sales_prev_7d > 0 ? Math.round(((summary.sales_7d - summary.sales_prev_7d) / summary.sales_prev_7d) * 100) : null;
  const max = Math.max(1, ...summary.daily.map((d) => d.revenue));
  const blocked = signals.filter((s) => !s.promotable);

  return (
    <div className="flex-grow overflow-y-auto p-4 lg:p-6 space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile label="ยอดขาย 7 วัน" value={thb(summary.sales_7d)} sub={growth === null ? `${summary.qty_7d} ตัว` : `${growth >= 0 ? '+' : ''}${growth}% vs สัปดาห์ก่อน · ${summary.qty_7d} ตัว`} color="bg-[#FFD93D]" />
        <Tile label="งบแอด 7 วัน" value={thb(summary.ad_spend_7d)} sub={summary.roas_7d === null ? 'ยังไม่มีข้อมูลแอด (ต่อ FB Ads ก่อน)' : `ROAS ${summary.roas_7d}x`} color="bg-[#4D96FF] text-white" />
        <Tile label="ทักแชทจากแอด" value={String(summary.conversations_7d)} sub={summary.cost_per_conversation === null ? '—' : `฿${summary.cost_per_conversation} / ทัก`} color="bg-white" />
        <Tile label="ผู้ติดตามเพจ" value={summary.followers === null ? '—' : summary.followers.toLocaleString('th-TH')} sub={summary.followers_date ? `ณ ${summary.followers_date}` : 'ยังไม่ได้ sync Facebook'} color="bg-white" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className={`${pixelBorder} bg-white p-4 lg:col-span-2`}>
          <h3 style={retroFont} className="text-2xl mb-2">ยอดขายรายวัน (14 วัน)</h3>
          <div className="flex items-end gap-1 h-40">
            {summary.daily.map((d) => (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${thb(d.revenue)}`}>
                <div className="w-full bg-[#4D96FF] border-2 border-black" style={{ height: `${(d.revenue / max) * 100}%` }} />
                <span style={retroFont} className="text-sm text-gray-500">{d.date.slice(8)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className={`${pixelBorder} bg-white p-4`}>
          <h3 style={retroFont} className="text-2xl mb-2">การเชื่อมต่อ</h3>
          <ul className="space-y-2 text-sm">
            {conns.map((c) => (
              <li key={c.channel} className="flex items-start justify-between gap-2 border-b-2 border-dashed border-gray-200 pb-2">
                <div><b className="uppercase">{c.channel}</b><div className="text-gray-500 text-xs">{c.display_name}</div>{c.last_error && <div className="text-red-600 text-xs">{c.last_error}</div>}</div>
                <span className={`px-2 border-2 border-black text-xs ${c.status === 'connected' ? 'bg-[#6BCB77]' : c.status === 'error' ? 'bg-[#FF6B6B] text-white' : 'bg-gray-200'}`}>{c.status}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className={`${pixelBorder} bg-white p-4`}>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h3 style={retroFont} className="text-2xl">สินค้าและสต็อกรายไซส์</h3>
          <span className="text-xs text-gray-600">{blocked.length ? `${blocked.length} รายการห้ามยิงแอด (ไซส์ขายดีขาด)` : 'ทุกรายการโฆษณาได้'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b-4 border-black" style={retroFont}>
              <th className="p-2 text-lg">สินค้า</th><th className="p-2 text-lg text-right">ราคา</th><th className="p-2 text-lg text-right">ขาย 7 วัน</th><th className="p-2 text-lg text-right">แนวโน้ม</th><th className="p-2 text-lg">สต็อกรายไซส์</th><th className="p-2 text-lg">สถานะ</th>
            </tr></thead>
            <tbody>
              {signals.map((s) => (
                <tr key={s.product_id} className="border-b-2 border-gray-100 align-top">
                  <td className="p-2"><b>{s.name}</b><div className="text-xs text-gray-500">{s.category}</div></td>
                  <td className="p-2 text-right whitespace-nowrap">{s.base_price ?? '—'}{s.set_price && <div className="text-xs text-gray-500">{s.set_price.qty} ตัว {s.set_price.price}</div>}</td>
                  <td className="p-2 text-right">{s.sales_7d}</td>
                  <td className={`p-2 text-right ${s.trend_pct !== null && s.trend_pct < 0 ? 'text-red-600' : 'text-green-700'}`}>{s.trend_pct === null ? '—' : `${s.trend_pct >= 0 ? '+' : ''}${s.trend_pct}%`}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(s.stock_by_size).map(([size, qty]) => (
                        <span key={size} className={`px-1.5 border-2 border-black text-xs ${qty === 0 ? 'bg-[#FF6B6B] text-white' : qty < 6 ? 'bg-[#FFD93D]' : 'bg-[#6BCB77]'} ${s.missing_core_sizes.includes(size) ? 'ring-2 ring-red-600' : ''}`} title={`ไซส์ ${size}: ${qty} ตัว`}>{size}<span className="opacity-70">:{qty}</span></span>
                      ))}
                    </div>
                  </td>
                  <td className="p-2 whitespace-nowrap"><span className={`px-2 border-2 border-black text-xs ${!s.core_size_ok ? 'bg-[#FF6B6B] text-white' : s.overstock ? 'bg-[#FFD93D]' : 'bg-[#6BCB77]'}`}>{s.note}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className={`${pixelBorder} ${color} p-4`}>
      <div className="text-xs uppercase tracking-wider opacity-70">{label}</div>
      <div style={retroFont} className="text-4xl leading-none mt-1">{value}</div>
      <div className="text-xs mt-2 opacity-80">{sub}</div>
    </div>
  );
}
