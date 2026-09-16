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

const CHANNEL_STYLE: Record<string, { label: string; color: string; mark: string }> = {
  facebook: { label: 'Facebook', color: 'var(--fb)', mark: 'f' },
  tiktok: { label: 'TikTok', color: 'var(--tiktok)', mark: '♪' },
  shopee: { label: 'Shopee', color: 'var(--shopee)', mark: 'S' },
  line: { label: 'LINE', color: 'var(--line-ch)', mark: 'L' },
  pos: { label: 'POS', color: 'var(--brand)', mark: 'P' },
};
/** Days until a token expires; module-level so Date.now() is not called during render. */
const daysLeft = (iso: string | null) => iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000) : null;
/** What the consent screen sent us back with, read once at mount. */
const returnParams = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '');

const CAP_LABEL: Record<string, string> = {
  insights: 'อ่านสถิติ', post: 'โพสต์ได้', ads: 'ยิงแอดได้', messages: 'ตอบแชทได้',
  import: 'นำเข้าสินค้า', listing: 'แก้รายการสินค้า', orders: 'อ่านออเดอร์', broadcast: 'ส่ง broadcast',
};

/** The channel's round mark, used in the list and on the connect buttons. */
function Mark({ channel, size = 36 }: { channel: string; size?: number }) {
  const st = CHANNEL_STYLE[channel] ?? { color: 'var(--muted)', mark: '?' };
  return (
    <span className="rounded-xl grid place-items-center flex-none font-medium"
      style={{ width: size, height: size, background: st.color, color: '#fff', fontSize: size * 0.45 }}>
      {st.mark}
    </span>
  );
}

export default function Connections({ storeId, connections, onChange }: {
  storeId: string; connections: Connection[]; onChange: (next: Connection[]) => void;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [picker, setPicker] = useState<{ channel: string; grant: string; demo: boolean; accounts: PickerAccount[] } | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'error' | 'ok'; text: string } | null>(() => {
    const err = returnParams().get('connect_error');
    return err ? { kind: 'error', text: err } : null;
  });

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
    const q = returnParams();
    const grant = q.get('grant');
    // Syncing with the URL we were redirected back to; the picker opens once, on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (grant) openPicker(q.get('channel') ?? 'facebook', grant);
    if (grant || q.get('connect_error')) window.history.replaceState(null, '', '#Marketing');
  }, [openPicker]);

  const startConnect = async (channel: string) => {
    setBusy(channel); setBanner(null);
    try {
      const r = await fetch(`/api/stores/${storeId}/connect/${channel}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ by: 'เจ้าของร้าน' }),
      });
      const body = await r.json();
      if (!r.ok) { setBanner({ kind: 'error', text: body.error ?? 'เชื่อมต่อไม่สำเร็จ' }); return; }
      if (body.mode === 'oauth') { window.location.assign(body.url); return; }
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

  const connected = connections.filter((c) => c.status === 'connected');

  return (
    <section className="panel panel-pad">
      <div className="panel-head">
        <h3>บัญชีที่เชื่อมต่อ</h3>
        <span className="t-label">{connected.length} บัญชี · token เก็บแบบเข้ารหัส ไม่แสดงบนหน้าจอ</span>
      </div>

      {banner && (
        <div className="panel-pad !py-2.5 !px-3.5 mb-4 text-sm"
          style={{
            borderRadius: 'var(--r-sm)',
            background: banner.kind === 'error' ? 'var(--crit-soft)' : 'var(--good-soft)',
            color: banner.kind === 'error' ? 'var(--crit)' : 'var(--good)',
          }}>
          {banner.text}
        </div>
      )}

      <ul className="grid md:grid-cols-2 gap-x-6 gap-y-1 mb-4">
        {connected.map((c) => {
          const st = CHANNEL_STYLE[c.channel] ?? { label: c.channel, color: 'var(--muted)', mark: '?' };
          const left = daysLeft(c.token_expires_at);
          return (
            <li key={c.id} className="flex items-start gap-3 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
              <Mark channel={c.channel} />
              <div className="flex-grow min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <b className="text-sm font-medium truncate">{c.display_name}</b>
                  {c.token_source === 'demo' && <span className="chip chip-warn">ตัวอย่าง</span>}
                </div>
                <div className="t-label t-mono truncate">{st.label}{c.external_account_id ? ` · ${c.external_account_id}` : ''}</div>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {Object.entries(c.capabilities ?? {}).sort(([, a], [, b]) => Number(b) - Number(a)).map(([k, on]) => (
                    <span key={k} className={`chip ${on ? 'chip-good' : 'chip-off'}`}>{CAP_LABEL[k] ?? k}</span>
                  ))}
                </div>
                {c.last_error && <div className="text-xs mt-1.5" style={{ color: 'var(--crit)' }}>{c.last_error}</div>}
                {left !== null && left <= 14 && (
                  <div className="text-xs mt-1.5" style={{ color: left <= 3 ? 'var(--crit)' : 'var(--warn)', fontWeight: 500 }}>
                    สิทธิ์หมดอายุใน {left} วัน · ต้องกดเชื่อมต่อใหม่
                  </div>
                )}
              </div>
              <button onClick={() => remove(c)} disabled={busy === c.id} className="btn btn-sm btn-danger-hover flex-none">
                ยกเลิก
              </button>
            </li>
          );
        })}
        {connected.length === 0 && (
          <li className="t-sub md:col-span-2 py-2" style={{ color: 'var(--muted)' }}>
            ยังไม่มีบัญชีที่เชื่อมต่อ กดปุ่มด้านล่างเพื่อเริ่ม
          </li>
        )}
      </ul>

      <div className="flex flex-wrap gap-2">
        {providers.map((p) => {
          const st = CHANNEL_STYLE[p.channel] ?? { label: p.name, color: 'var(--muted)', mark: '?' };
          const has = connected.some((c) => c.channel === p.channel);
          return (
            <button key={p.channel} onClick={() => startConnect(p.channel)} disabled={!p.implemented || busy === p.channel}
              title={!p.implemented ? 'ยังไม่เปิดให้เชื่อมต่อในเวอร์ชันนี้' : !p.configured ? `ยังไม่ได้ตั้งค่า ${p.missing_env.join(', ')} — จะแสดงเป็นตัวอย่าง` : ''}
              className="btn">
              {p.implemented ? <Mark channel={p.channel} size={22} />
                : <span className="rounded-md grid place-items-center flex-none"
                    style={{ width: 22, height: 22, background: 'var(--line-2)', color: 'var(--muted)', fontSize: 11 }}>{st.mark}</span>}
              {busy === p.channel ? 'กำลังเปิด…' : has ? `เพิ่มบัญชี ${st.label}` : `เชื่อมต่อ ${st.label}`}
              {p.implemented && !p.configured && <span className="chip chip-warn">ตัวอย่าง</span>}
            </button>
          );
        })}
      </div>

      {picker && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: 'rgba(11,14,24,.6)' }} onClick={() => setPicker(null)}>
          <div className="panel w-full max-w-lg max-h-[85vh] overflow-y-auto no-scrollbar" onClick={(e) => e.stopPropagation()}>
            <div className="panel-pad flex items-start justify-between gap-3" style={{ borderBottom: '1px solid var(--line)' }}>
              <div>
                <h4 className="t-head text-[17px]">เลือกบัญชีที่จะเชื่อม</h4>
                <p className="t-label">เลือกได้มากกว่าหนึ่ง · เปลี่ยนภายหลังได้</p>
              </div>
              {picker.demo && <span className="chip chip-warn flex-none">ตัวอย่าง</span>}
            </div>

            <ul className="p-4 flex flex-col gap-2">
              {picker.accounts.map((a) => {
                const on = chosen.has(a.id);
                return (
                  <li key={a.id}>
                    <label className="flex items-start gap-3 p-3 cursor-pointer transition-colors"
                      style={{
                        borderRadius: 'var(--r-sm)',
                        border: `1px solid ${on ? 'var(--brand)' : 'var(--line)'}`,
                        background: on ? 'var(--brand-soft)' : 'transparent',
                      }}>
                      <input type="checkbox" checked={on} className="mt-1 flex-none"
                        onChange={() => setChosen((prev) => {
                          const next = new Set(prev);
                          if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                          return next;
                        })} />
                      <span className="flex-grow min-w-0">
                        <span className="flex items-center gap-2 flex-wrap">
                          <b className="text-sm font-medium">{a.name}</b>
                          <span className="chip">{a.kind === 'page' ? 'เพจ' : a.kind === 'ad_account' ? 'บัญชีโฆษณา' : a.kind}</span>
                        </span>
                        {a.detail && <span className="block t-label">{a.detail}</span>}
                        <span className="flex flex-wrap gap-1 mt-1.5">
                          {Object.entries(a.capabilities).filter(([, v]) => v).map(([k]) => (
                            <span key={k} className="chip chip-good">{CAP_LABEL[k] ?? k}</span>
                          ))}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <div className="panel-pad flex gap-2 justify-end" style={{ borderTop: '1px solid var(--line)' }}>
              <button onClick={() => setPicker(null)} className="btn">ยกเลิก</button>
              <button onClick={attach} disabled={chosen.size === 0 || busy === 'attach'} className="btn btn-primary">
                {busy === 'attach' ? 'กำลังบันทึก…' : `เชื่อมต่อ ${chosen.size} บัญชี`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
