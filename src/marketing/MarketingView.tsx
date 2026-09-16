import { useEffect, useState } from 'react';
import Connections, { type Connection } from './Connections';

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
interface Post { external_post_id: string; created_time: string; message: string | null; reach: number | null; engaged: number | null; comments: number | null; shares: number | null; reactions: number | null }
interface Ad { external_ad_id: string; ad_name: string; campaign_name: string; first_date: string; last_date: string; impressions: number; clicks: number; spend: string | number; conversations: number; purchases: number; revenue: string | number }

const STORE = 'climax';
const thb = (n: number) => '฿' + Math.round(n).toLocaleString('th-TH');

export default function MarketingView() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [conns, setConns] = useState<Connection[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [s, g, c, p, a] = await Promise.all([
          fetch(`/api/stores/${STORE}/summary`).then((r) => r.json()),
          fetch(`/api/stores/${STORE}/signals`).then((r) => r.json()),
          fetch(`/api/stores/${STORE}/connections`).then((r) => r.json()),
          fetch(`/api/stores/${STORE}/posts`).then((r) => r.json()),
          fetch(`/api/stores/${STORE}/ads`).then((r) => r.json()),
        ]);
        setSummary(s); setSignals(g); setConns(c); setPosts(p); setAds(a); setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    };
    load();
  }, []);

  if (error) {
    return (
      <div className="p-6">
        <div className="panel panel-pad" style={{ background: 'var(--crit-soft)', borderColor: 'var(--crit)' }}>
          <h3 className="t-head text-[16px]" style={{ color: 'var(--crit)' }}>ต่อเซิร์ฟเวอร์ไม่ได้</h3>
          <p className="t-sub mt-1">
            รัน <code className="t-mono">pnpm server:seed</code> แล้ว <code className="t-mono">pnpm server:dev</code> ก่อน (พอร์ต 3001) · {error}
          </p>
        </div>
      </div>
    );
  }
  if (!summary) return <div className="p-10 text-center t-sub" style={{ color: 'var(--muted)' }}>กำลังโหลด…</div>;

  const growth = summary.sales_prev_7d > 0 ? Math.round(((summary.sales_7d - summary.sales_prev_7d) / summary.sales_prev_7d) * 100) : null;
  const max = Math.max(1, ...summary.daily.map((d) => d.revenue));
  const blocked = signals.filter((s) => !s.promotable);

  return (
    <div className="flex-grow overflow-y-auto p-4 lg:p-6 space-y-5 no-scrollbar">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile label="ยอดขาย 7 วัน" value={thb(summary.sales_7d)} accent
          sub={growth === null ? `${summary.qty_7d} ตัว` : `${growth >= 0 ? '+' : ''}${growth}% เทียบสัปดาห์ก่อน · ${summary.qty_7d} ตัว`}
          tone={growth === null ? undefined : growth >= 0 ? 'good' : 'crit'} />
        <Tile label="งบแอด 7 วัน" value={thb(summary.ad_spend_7d)}
          sub={summary.roas_7d === null ? 'ยังไม่มีข้อมูลแอด' : `ROAS ${summary.roas_7d}x`}
          tone={summary.roas_7d === null ? undefined : summary.roas_7d >= 3 ? 'good' : summary.roas_7d < 1.5 ? 'crit' : 'warn'} />
        <Tile label="ทักแชทจากแอด" value={String(summary.conversations_7d)}
          sub={summary.cost_per_conversation === null ? '—' : `฿${summary.cost_per_conversation} ต่อการทัก`} />
        <Tile label="ผู้ติดตามเพจ" value={summary.followers === null ? '—' : summary.followers.toLocaleString('th-TH')}
          sub={summary.followers_date ? `ณ ${summary.followers_date}` : 'ยังไม่ได้ sync Facebook'} />
      </div>

      <section className="panel panel-pad">
        <div className="panel-head">
          <h3>ยอดขายรายวัน</h3>
          <span className="t-label">14 วันล่าสุด · สูงสุด {thb(max)}</span>
        </div>
        <div className="flex gap-1.5 items-end">
          {summary.daily.map((d) => (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-1.5" title={`${d.date}: ${thb(d.revenue)}`}>
              <div className="h-28 w-full flex items-end">
                <div className="w-full rounded-md transition-all"
                  style={{ height: `${Math.max(3, (d.revenue / max) * 100)}%`, background: 'var(--brand)', opacity: 0.85 }} />
              </div>
              <span className="t-label t-mono text-[11px]">{d.date.slice(8)}</span>
            </div>
          ))}
        </div>
      </section>

      <Connections storeId={STORE} connections={conns} onChange={setConns} />

      <section className="panel panel-pad">
        <div className="panel-head">
          <h3>สินค้าและสต็อกรายไซส์</h3>
          <span className={blocked.length ? 'chip chip-crit' : 'chip chip-good'}>
            {blocked.length ? `${blocked.length} รายการห้ามยิงแอด (ไซส์ขายดีขาด)` : 'ทุกรายการโฆษณาได้'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr>
              <th>สินค้า</th><th className="text-right">ราคา</th><th className="text-right">ขาย 7 วัน</th>
              <th className="text-right">แนวโน้ม</th><th>สต็อกรายไซส์</th><th>สถานะ</th>
            </tr></thead>
            <tbody>
              {signals.map((s) => (
                <tr key={s.product_id}>
                  <td><b className="font-medium">{s.name}</b><div className="t-label">{s.category}</div></td>
                  <td className="text-right whitespace-nowrap">
                    <span className="t-num">{s.base_price ?? '—'}</span>
                    {s.set_price && <div className="t-label">{s.set_price.qty} ตัว {s.set_price.price}</div>}
                  </td>
                  <td className="text-right t-num">{s.sales_7d}</td>
                  <td className="text-right t-num" style={{ color: s.trend_pct !== null && s.trend_pct < 0 ? 'var(--crit)' : 'var(--good)' }}>
                    {s.trend_pct === null ? '—' : `${s.trend_pct >= 0 ? '+' : ''}${s.trend_pct}%`}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(s.stock_by_size).map(([size, qty]) => (
                        <span key={size} title={`ไซส์ ${size}: ${qty} ตัว`}
                          className={`chip t-mono ${qty === 0 ? 'chip-crit' : qty < 6 ? 'chip-warn' : 'chip-good'}`}
                          style={s.missing_core_sizes.includes(size) ? { outline: '1.5px solid var(--crit)' } : undefined}>
                          {`${size}:${qty}`}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="whitespace-nowrap">
                    <span className={`chip ${!s.core_size_ok ? 'chip-crit' : s.overstock ? 'chip-warn' : 'chip-good'}`}>{s.note}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-5">
        <section className="panel panel-pad">
          <div className="panel-head"><h3>แอดที่รันอยู่</h3><span className="t-label">Facebook</span></div>
          {ads.length === 0 ? <p className="t-sub" style={{ color: 'var(--muted)' }}>ยังไม่มีข้อมูลแอด</p> : (
            <div className="overflow-x-auto"><table className="tbl">
              <thead><tr>
                <th>แอด</th><th className="text-right">ใช้ไป</th><th className="text-right">CTR</th>
                <th className="text-right">ทักแชท</th><th className="text-right">฿/ทัก</th><th className="text-right">ROAS</th>
              </tr></thead>
              <tbody>{ads.map((a) => {
                const spend = Number(a.spend), rev = Number(a.revenue);
                const roas = spend > 0 ? rev / spend : 0;
                return (<tr key={a.external_ad_id}>
                  <td><b className="font-medium">{a.ad_name}</b><div className="t-label">{a.campaign_name} · {a.first_date} → {a.last_date}</div></td>
                  <td className="text-right t-num whitespace-nowrap">{thb(spend)}</td>
                  <td className="text-right t-num">{a.impressions ? ((a.clicks / a.impressions) * 100).toFixed(2) : '0.00'}%</td>
                  <td className="text-right t-num">{a.conversations}</td>
                  <td className="text-right t-num">{a.conversations ? Math.round(spend / a.conversations) : '—'}</td>
                  <td className="text-right t-num" style={{ color: roas >= 3 ? 'var(--good)' : roas < 1.5 ? 'var(--crit)' : 'var(--warn)' }}>
                    {roas ? roas.toFixed(1) + 'x' : '—'}
                  </td>
                </tr>);
              })}</tbody>
            </table></div>
          )}
        </section>

        <section className="panel panel-pad">
          <div className="panel-head"><h3>โพสต์ล่าสุด</h3><span className="t-label">Facebook</span></div>
          {posts.length === 0 ? <p className="t-sub" style={{ color: 'var(--muted)' }}>ยังไม่มีข้อมูลโพสต์</p> : (
            <ul className="flex flex-col">{posts.slice(0, 6).map((p, i) => (
              <li key={p.external_post_id} className="py-3" style={i ? { borderTop: '1px solid var(--line)' } : undefined}>
                <div className="t-label t-mono">{p.created_time?.slice(0, 10)}</div>
                <div className="text-sm whitespace-pre-line line-clamp-2 mt-0.5">{p.message}</div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <span className="chip">reach <b className="t-num">{(p.reach ?? 0).toLocaleString('th-TH')}</b></span>
                  <span className="chip">engaged <b className="t-num">{p.engaged ?? 0}</b></span>
                  <span className="chip">คอมเมนต์ <b className="t-num">{p.comments ?? 0}</b></span>
                  <span className="chip">แชร์ <b className="t-num">{p.shares ?? 0}</b></span>
                </div>
              </li>
            ))}</ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, tone, accent }: {
  label: string; value: string; sub: string; tone?: 'good' | 'warn' | 'crit'; accent?: boolean;
}) {
  const toneColor = tone && { good: 'var(--good)', warn: 'var(--warn)', crit: 'var(--crit)' }[tone];
  return (
    <div className="panel panel-pad" style={accent ? { background: 'var(--brand)', borderColor: 'var(--brand)' } : undefined}>
      <div className="t-label" style={accent ? { color: 'rgba(255,255,255,.72)' } : undefined}>{label}</div>
      <div className="t-num text-[28px] leading-tight mt-0.5" style={accent ? { color: 'var(--brand-ink)' } : undefined}>{value}</div>
      <div className="text-xs mt-1.5" style={{ color: accent ? 'rgba(255,255,255,.8)' : toneColor || 'var(--ink-2)' }}>{sub}</div>
    </div>
  );
}
