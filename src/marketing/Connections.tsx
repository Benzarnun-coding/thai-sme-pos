import { useCallback, useEffect, useState } from 'react';

/**
 * "Connect account" panel — the GitHub-style flow.
 *
 * Click Connect → consent screen → come back with ?grant=... → pick which Page
 * and ad account to attach → they show up as connected accounts with the exact
 * permissions that were granted.
 */
export interface Connection {
  id: string;
  channel: string;
  external_account_id: string | null;
  display_name: string | null;
  capabilities: Record<string, boolean>;
  status: string;
  token_source: string;
  scopes: string[] | null;
  avatar_url: string | null;
  connected_by: string | null;
  connected_at: string | null;
  token_expires_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
}
interface Provider {
  channel: string; name: string; implemented: boolean; configured: boolean; missing_env: string[];
  scopes: { scope: string; label: string; phase: number; needsReview: boolean; requested_now: boolean }[];
}
interface PickerAccount {
  kind: string; id: string; name: string; detail?: string; avatar_url?: string; capabilities: Record<string, boolean>;
}

const pixelBorder = 'border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]';
const retroFont = { fontFamily: "'VT323', monospace" };

const CHANNEL_STYLE: Record<string, { label: string; bg: string; mark: string }> = {
  facebook: { label: 'Facebook', bg: 'bg-[#1877F2]', mark: 'f' },
  tiktok: { label: 'TikTok', bg: 'bg-black', mark: '♪' },
  shopee: { label: 'Shopee', bg: 'bg-[#EE4D2D]', mark: 'S' },
  line: { label: 'LINE', bg: 'bg-[#06C755]', mark: 'L' },
  pos: { label: 'POS', bg: 'bg-[#4D96FF]', mark: 'P' },
};
const CAP_LABEL: Record<string, string> = {
  insights: 'อ่านสถิติ', post: 'โพสต์ได้', ads: 'ยิงแอดได้', messages: 'ตอบแชทได้',
  import: 'นำเข้าสินค้า', listing: 'แก้รายการสินค้า', orders: 'อ่านออเดอร์', broadcast: 'ส่ง broadcast',
};

export default function Connections({ storeId, connections, onChange }: {
  storeId: string; connections: Connection[]; onChange: (next: Connection[]) => void;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [picker, setPicker] = useState<{ channel: string; grant: string; demo: boolean; accounts: PickerAccount[] } | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  useEffect(() => { fetch('/api/providers').then((r) => r.json()).then(setProviders).catch(() => {}); }, []);

  const openPicker = useCallback(async (channel: string, grant: string) => {
    const r = await fetch(`/api/stores/${storeId}/connect/${channel}/accounts?grant=${encodeURIComponent(grant)}`);
    const body = await r.json();
    if (!r.ok) { setBanner({ kind: 'error', text: body.error ?? 'เปิดรายการบัญชีไม่สำเร็จ' }); return; }
    setPicker({ channel, grant, demo: body.demo, accounts: body.accounts });
    setChosen(new Set(body.accounts.map((a: PickerAccount) => a.id)));
  }, [storeId]);

  // Coming back from the consent screen: #Marketing?grant=... or ?connect_error=...
  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    const grant = q.get('grant'); const err = q.get('connect_error');
    if (err) setBanner({ kind: 'error', text: err });
    if (grant) openPicker(q.get('channel') ?? 'facebook', grant);
    if (grant || err) window.history.replaceState(null, '', '#Marketing');
  }, [openPicker]);

  const startConnect = async (channel: string) => {
    setBusy(channel); setBanner(null);
    try {
      const r = await fetch(`/api/stores/${storeId}/connect/${channel}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ by: 'เจ้าของร้าน' }),
      });
      const body = await r.json();
      if (!r.ok) { setBanner({ kind: 'error', text: body.error ?? 'เชื่อมต่อไม่สำเร็จ' }); return; }
      if (body.mode === 'oauth') { window.location.href = body.url; return; }
      setBanner({ kind: 'ok', text: body.note });
      await openPicker(channel, body.grant_id);
    } catch (e) {
      setBanner({ kind: 'error', text: (e as Error).message });
    } finally { setBusy(null); }
  };

  const attach = async () => {
    if (!picker || chosen.size === 0) return;
    setBusy('attach');
    try {
      const r = await fetch(`/api/stores/${storeId}/connect/${picker.channel}/attach`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant: picker.grant, account_ids: [...chosen], by: 'เจ้าของร้าน' }),
      });
      const body = await r.json();
      if (!r.ok) { setBanner({ kind: 'error', text: body.error ?? 'บันทึกบัญชีไม่สำเร็จ' }); return; }
      onChange(body.connections);
      setBanner({ kind: 'ok', text: `เชื่อมต่อแล้ว ${body.attached.length} บัญชี` });
      setPicker(null);
    } finally { setBusy(null); }
  };

  const remove = async (c: Connection) => {
    if (!confirm(`ยกเลิกการเชื่อมต่อ ${c.display_name}?\nระบบจะลบ token ทิ้งทันที และหยุดดึงข้อมูลจากบัญชีนี้`)) return;
    setBusy(c.id);
    try {
      const r = await fetch(`/api/stores/${storeId}/connections/${encodeURIComponent(c.id)}?by=เจ้าของร้าน`, { method: 'DELETE' });
      const body = await r.json();
      if (r.ok) { onChange(body.connections); setBanner({ kind: 'ok', text: 'ยกเลิกการเชื่อมต่อแล้ว' }); }
    } finally { setBusy(null); }
  };

  const daysLeft = (iso: string | null) => iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000) : null;
  const connected = connections.filter((c) => c.status === 'connected');

  return (
    <section className={`${pixelBorder} bg-white p-4`}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 style={retroFont} className="text-2xl">บัญชีที่เชื่อมต่อ</h3>
        <span className="text-xs text-gray-600">{connected.length} บัญชี · token เก็บแบบเข้ารหัส ไม่แสดงบนหน้าจอ</span>
      </div>

      {banner && (
        <div className={`mb-3 p-2 text-sm border-2 border-black ${banner.kind === 'error' ? 'bg-[#FF6B6B] text-white' : 'bg-[#6BCB77]'}`}>
          {banner.text}
        </div>
      )}

      <ul className="grid md:grid-cols-2 gap-x-6 gap-y-2 mb-4">
        {connected.map((c) => {
          const st = CHANNEL_STYLE[c.channel] ?? { label: c.channel, bg: 'bg-gray-500', mark: '?' };
          const left = daysLeft(c.token_expires_at);
          return (
            <li key={c.id} className="flex items-start gap-3 border-b-2 border-dashed border-gray-200 pb-2">
              <div className={`w-10 h-10 flex-none ${st.bg} text-white border-2 border-black flex items-center justify-center font-bold`}>{st.mark}</div>
              <div className="flex-grow min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <b className="text-sm">{c.display_name}</b>
                  {c.token_source === 'demo' && <span className="text-[10px] px-1 bg-[#FFD93D] border border-black">DEMO</span>}
                </div>
                <div className="text-xs text-gray-500">{st.label}{c.external_account_id ? ` · ${c.external_account_id}` : ''}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {Object.entries(c.capabilities ?? {}).map(([k, on]) => (
                    <span key={k} className={`text-[10px] px-1.5 border border-black ${on ? 'bg-[#6BCB77]' : 'bg-gray-100 text-gray-400 line-through'}`}>
                      {CAP_LABEL[k] ?? k}
                    </span>
                  ))}
                </div>
                {c.last_error && <div className="text-red-600 text-xs mt-1">{c.last_error}</div>}
                {left !== null && left <= 14 && (
                  <div className={`text-xs mt-1 ${left <= 3 ? 'text-red-600 font-bold' : 'text-[#FF8400]'}`}>
                    ⚠ สิทธิ์หมดอายุใน {left} วัน ต้องกดเชื่อมต่อใหม่
                  </div>
                )}
              </div>
              <button onClick={() => remove(c)} disabled={busy === c.id}
                className="flex-none text-xs px-2 py-1 border-2 border-black bg-white hover:bg-[#FF6B6B] hover:text-white disabled:opacity-50">
                ยกเลิก
              </button>
            </li>
          );
        })}
        {connected.length === 0 && <li className="text-sm text-gray-500 md:col-span-2">ยังไม่มีบัญชีที่เชื่อมต่อ กดปุ่มด้านล่างเพื่อเริ่ม</li>}
      </ul>

      <div className="flex flex-wrap gap-2">
        {providers.map((p) => {
          const st = CHANNEL_STYLE[p.channel] ?? { label: p.name, bg: 'bg-gray-500', mark: '?' };
          const has = connected.some((c) => c.channel === p.channel);
          return (
            <button key={p.channel} onClick={() => startConnect(p.channel)} disabled={!p.implemented || busy === p.channel}
              title={!p.implemented ? 'ยังไม่เปิดให้เชื่อมต่อในเวอร์ชันนี้' : !p.configured ? `ยังไม่ได้ตั้งค่า ${p.missing_env.join(', ')} — จะแสดงเป็นตัวอย่าง` : ''}
              className={`flex items-center gap-2 px-3 py-2 text-sm border-2 border-black ${p.implemented ? 'bg-white hover:bg-[#FFD93D]' : 'bg-gray-100 text-gray-400'} disabled:cursor-not-allowed`}>
              <span className={`w-6 h-6 ${p.implemented ? st.bg : 'bg-gray-400'} text-white flex items-center justify-center text-xs font-bold`}>{st.mark}</span>
              {busy === p.channel ? 'กำลังเปิด...' : has ? `เพิ่มบัญชี ${st.label}` : `เชื่อมต่อ ${st.label}`}
              {p.implemented && !p.configured && <span className="text-[10px] px-1 bg-[#FFD93D] border border-black">DEMO</span>}
            </button>
          );
        })}
      </div>

      {picker && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4" onClick={() => setPicker(null)}>
          <div className={`${pixelBorder} bg-white max-w-lg w-full max-h-[85vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b-4 border-black flex items-center justify-between">
              <div>
                <h4 style={retroFont} className="text-2xl">เลือกบัญชีที่จะเชื่อม</h4>
                <p className="text-xs text-gray-600">เลือกได้มากกว่าหนึ่ง · เปลี่ยนภายหลังได้</p>
              </div>
              {picker.demo && <span className="text-xs px-2 py-1 bg-[#FFD93D] border-2 border-black">ตัวอย่าง</span>}
            </div>
            <ul className="p-4 space-y-2">
              {picker.accounts.map((a) => {
                const on = chosen.has(a.id);
                return (
                  <li key={a.id}>
                    <label className={`flex items-start gap-3 p-3 border-2 cursor-pointer ${on ? 'border-black bg-[#FFFBEA]' : 'border-gray-200'}`}>
                      <input type="checkbox" checked={on} className="mt-1"
                        onChange={() => setChosen((prev) => {
                          const next = new Set(prev);
                          if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                          return next;
                        })} />
                      <span className="flex-grow min-w-0">
                        <span className="flex items-center gap-2 flex-wrap">
                          <b className="text-sm">{a.name}</b>
                          <span className="text-[10px] px-1 border border-black bg-gray-100">
                            {a.kind === 'page' ? 'เพจ' : a.kind === 'ad_account' ? 'บัญชีโฆษณา' : a.kind}
                          </span>
                        </span>
                        {a.detail && <span className="block text-xs text-gray-500">{a.detail}</span>}
                        <span className="flex flex-wrap gap-1 mt-1">
                          {Object.entries(a.capabilities).filter(([, v]) => v).map(([k]) => (
                            <span key={k} className="text-[10px] px-1.5 border border-black bg-[#6BCB77]">{CAP_LABEL[k] ?? k}</span>
                          ))}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="p-4 border-t-4 border-black flex gap-2 justify-end">
              <button onClick={() => setPicker(null)} className="px-4 py-2 text-sm border-2 border-black bg-white">ยกเลิก</button>
              <button onClick={attach} disabled={chosen.size === 0 || busy === 'attach'}
                className="px-4 py-2 text-sm border-2 border-black bg-[#6BCB77] font-bold disabled:opacity-50">
                {busy === 'attach' ? 'กำลังบันทึก...' : `เชื่อมต่อ ${chosen.size} บัญชี`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
