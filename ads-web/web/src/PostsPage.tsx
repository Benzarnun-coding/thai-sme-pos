// /studio/posts — the foundation of the training room (docs/creative.md): every post that runs as an ad right now,
// read from Meta (read only) with its caption, picture and last-14-day numbers. The best ones feed the caption agent;
// any of them can become a liked/disliked example with one line of reason.

import { useEffect, useState } from 'react';
import { HomeLogo, SiteNav } from './SiteNav.tsx';
import { useUi } from './ui.tsx';
import { productPictures } from './imageResize.ts';
import { call } from './StudioPage.tsx';

interface MetaPost {
  key: string; story_id: string | null; message: string; image_url: string | null; permalink: string | null; post_read: number;
  ads: { ad_id: string; ad_name: string; campaign_id: string; campaign_name: string }[];
  spend: number; impressions: number; purchases: number; purchase_value: number; messages: number;
  code: string; active: number; has_image: number; first_seen: string; fetched_at: string; tags?: string | null;
}
interface TagRow { dim: string; value: string; label: string; posts: number; spend: number; roas: number | null; wins: number; losses: number }
type Dims = Record<string, { label: string; values: Record<string, string> }>;

interface Pending { id: number; text: string; findings: { point: string; evidence: string }[] }

const b = (x: number) => Math.round(x).toLocaleString('th-TH');
const roasOf = (p: MetaPost) => (p.spend > 0 ? p.purchase_value / p.spend : 0);

export function PostsApp() {
  useEffect(() => { document.title = 'โพสต์ที่ยิงอยู่ — ห้องฝึก'; }, []);
  const { toast } = useUi();
  const [posts, setPosts] = useState<MetaPost[] | null>(null);
  const [busy, setBusy] = useState('');
  const [sort, setSort] = useState<'spend' | 'roas'>('spend');
  const [showOld, setShowOld] = useState(false);
  const load = () => call<{ posts: MetaPost[] }>('GET', '/api/studio/meta-posts').then((r) => { setPosts(r.posts); return r.posts; });
  useEffect(() => { load().catch((e) => toast(e.message, 'bad')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Pictures the browser still has to fetch (Meta's links expire, so do it right after an import). */
  const fetchPictures = async (list: MetaPost[]) => {
    const todo = list.filter((p) => !p.has_image && p.image_url);
    let ok = 0;
    for (const [i, p] of todo.entries()) {
      setBusy(`กำลังเก็บรูป ${i + 1}/${todo.length}`);
      try {
        const res = await fetch(`/api/catalog/image-proxy?url=${encodeURIComponent(p.image_url!)}`);
        if (!res.ok) continue;
        const { thumb, full } = await productPictures(await res.blob());
        const fd = new FormData();
        fd.set('key', p.key); fd.set('thumb', thumb, 'thumb.jpg'); fd.set('full', full, 'full.jpg');
        await call('POST', '/api/studio/meta-posts/image', fd);
        ok++;
      } catch { /* one bad picture doesn't stop the rest */ }
    }
    return { ok, of: todo.length };
  };

  const [pending, setPending] = useState<Pending | null>(null);
  // Every product code with its name, for the code boxes' suggestions (one shared list; read once).
  const [codes, setCodes] = useState<{ code: string; name: string }[]>([]);
  const [dims, setDims] = useState<Dims>({});
  useEffect(() => { call<{ dims: Dims }>('GET', '/api/studio/image-tags').then((r) => setDims(r.dims)).catch(() => null); }, []);
  useEffect(() => { call<{ products: { code: string; name: string }[] }>('GET', '/api/studio/products?limit=5000').then((r) => setCodes(r.products)).catch(() => null); }, []);
  useEffect(() => { call<{ pending: Pending | null }>('GET', '/api/studio/playbook/pending').then((r) => setPending(r.pending)).catch(() => null); }, []);
  const analyze = async () => {
    setBusy('AI กำลังอ่านโพสต์ทั้งหมด (ประมาณ 1–2 นาที)…');
    try {
      const r = await call<{ playbook_id: number; playbook: string; findings: { point: string; evidence: string }[] }>('POST', '/api/studio/analyze-posts');
      setPending({ id: r.playbook_id, text: r.playbook, findings: r.findings });
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  };

  const importNow = async () => {
    setBusy('กำลังอ่านโพสต์จาก Meta…');
    try {
      const r = await call<{ posts: number; ads: number; unread: number; new_posts: number; post_error: string | null }>('POST', '/api/studio/meta-posts/import');
      const list = await load();
      const pics = await fetchPictures(list);
      toast(`ได้ ${r.posts} โพสต์จาก ${r.ads} แอดที่เปิดอยู่ (ใหม่ ${r.new_posts}) · เก็บรูป ${pics.ok}/${pics.of}${r.unread ? ` · อ่านตัวโพสต์ไม่ได้ ${r.unread} (ใช้ข้อความจากแอดแทน)${r.post_error ? ` — Meta ตอบ: ${r.post_error.slice(0, 200)}` : ''}` : ''}`, 'ok');
      await load();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  };

  const shown = (posts ?? []).filter((p) => showOld || p.active).sort((x, y) => (sort === 'roas' ? roasOf(y) - roasOf(x) : y.spend - x.spend));
  const active = (posts ?? []).filter((p) => p.active);
  const total = active.reduce((t, p) => t + p.spend, 0);

  return (
    <div className="kb-page studio">
      <SiteNav current="/studio/posts" />
      <header className="kb-head">
        <div className="row"><HomeLogo text="PO" /><h1>โพสต์ที่ยิงแอดอยู่</h1></div>
        <p className="muted small">ฐานข้อมูลตั้งต้นของ <a href="/studio/train">ห้องฝึก</a>: ทุกโพสต์ที่แอดเปิดอยู่ตอนนี้ ดึงจาก Meta แบบอ่านอย่างเดียว (ไม่แก้อะไรบนเพจ) · ตัวเลขคือค่าแอด / ยอดแท็ก Meta 14 วันของทุกแอดที่ใช้โพสต์นั้น (ยอดจริงมักต่ำกว่า ~11–14%) · โพสต์ที่ใช้เงิน ≥ 1,000 และ ROAS ดีสุด 6 อันถูกส่งให้ AI เป็นตัวอย่างแรกเวลาเขียนแคปชัน</p>
        <div className="row wrap">
          <button disabled={!!busy} onClick={importNow}>{busy || 'ดึงโพสต์จากเพจ'}</button>
          {posts && posts.some((p) => !p.has_image && p.image_url) && !busy && <button className="ghost" onClick={async () => { const r = await fetchPictures(posts); setBusy(''); toast(`เก็บรูป ${r.ok}/${r.of}`, 'ok'); load(); }}>เก็บรูปที่ยังขาด</button>}
          <div className="segmented small"><button className={sort === 'spend' ? 'on' : ''} onClick={() => setSort('spend')}>เรียงตามค่าแอด</button><button className={sort === 'roas' ? 'on' : ''} onClick={() => setSort('roas')}>เรียงตาม ROAS</button></div>
          <label className="small row"><input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> แสดงโพสต์ที่ไม่ได้ยิงแล้ว</label>
        </div>
        {posts && <p className="small">{active.length} โพสต์ที่ยิงอยู่ · ค่าแอด 14 วัน ฿{b(total)}{posts[0] ? ` · ดึงล่าสุด ${new Date(posts[0].fetched_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })}` : ''}</p>}
      </header>

      <ImageTags posts={posts} onTagged={load} />

      <section className="card">
        <h2>AI สรุปสูตรจากโพสต์จริง</h2>
        <p className="muted small">AI อ่านแคปชัน + ตัวเลขของทุกโพสต์ที่ใช้เงิน ≥ 300 และรูปของตัวดีสุด 8 / แย่สุด 6 แล้วบอกว่าโพสต์ที่ขายดีทำอะไรต่างจากตัวที่ขายไม่ดี พร้อมร่างคู่มือให้ AI เขียนแคปชัน · คู่มือจะใช้ก็ต่อเมื่อกด "ใช้คู่มือนี้"</p>
        {!pending && <button disabled={!!busy || !posts?.length} onClick={analyze}>ให้ AI วิเคราะห์โพสต์ที่ยิงอยู่</button>}
        {pending && <PendingPlaybook p={pending} onDone={() => setPending(null)} onAgain={analyze} busy={!!busy} />}
      </section>

      {posts === null ? <div className="skeleton" style={{ height: 200 }} /> : posts.length === 0 ? (
        <p className="muted">ยังไม่มีข้อมูล — กด "ดึงโพสต์จากเพจ"</p>
      ) : (
        <div className="post-grid">
          {shown.map((p) => <PostCard key={p.key} p={p} onChanged={load} codes={codes} dims={dims} />)}
        </div>
      )}
    </div>
  );
}

function PostCard({ p, onChanged, codes, dims }: { p: MetaPost; onChanged: () => void; codes: { code: string; name: string }[]; dims: Dims }) {
  const { toast } = useUi();
  const [code, setCode] = useState(p.code);
  const [ex, setEx] = useState<null | boolean>(null);
  const [reason, setReason] = useState('');
  const [more, setMore] = useState(false);
  const roas = roasOf(p);
  // has_image is the stored size: a new picture gets a new address, so a broken one the browser cached is never reused.
  const pic = `/api/studio/meta-posts/picture?key=${encodeURIComponent(p.key)}&v=${p.has_image}`;
  const [broken, setBroken] = useState<string | null>(null);
  const why = async () => {
    const r = await fetch(pic, { cache: 'no-store' }).catch(() => null);
    setBroken(r ? `รูปเสีย (${r.status} ${r.headers.get('content-type') ?? ''} ${r.headers.get('content-length') ?? ''})` : 'โหลดรูปไม่ได้');
  };
  const campaigns = [...new Map(p.ads.map((a) => [a.campaign_id, a.campaign_name])).values()];
  const addExample = async () => {
    try { await call('POST', '/api/studio/example', { text: p.message, liked: ex, reason: `${reason} (โพสต์จริง ROAS ${roas.toFixed(1)} ค่าแอด ${b(p.spend)})` }); toast('เพิ่มเป็นตัวอย่างแล้ว', 'ok'); setEx(null); setReason(''); }
    catch (e: any) { toast(e.message, 'bad'); }
  };
  return (
    <article className={`card post-card ${p.active ? '' : 'old'}`}>
      {p.has_image && !broken ? <a href={`${pic}&size=full`} target="_blank" rel="noreferrer"><img src={pic} alt="" loading="lazy" onError={why} /></a> : <div className="no-pic muted small">{broken ?? 'ไม่มีรูป'}</div>}
      <div className="row wrap small">
        <span className={`badge ${roas >= 3 ? 'ok' : roas < 2.3 && p.spend >= 500 ? 'warn' : ''}`}>ROAS {p.spend ? roas.toFixed(2) : '–'}</span>
        <span className="badge">฿{b(p.spend)}</span>
        <span className="badge">{Math.round(p.purchases)} ออเดอร์</span>
        {p.messages > 0 && <span className="badge">{b(p.messages)} แชท</span>}
        {!p.active && <span className="badge warn">ไม่ได้ยิงแล้ว</span>}
        {!p.post_read && <span className="badge warn" title="อ่านตัวโพสต์ไม่ได้ ใช้ข้อความ/รูปจากแอดแทน">จากแอด</span>}
        {p.tags && Object.values(JSON.parse(p.tags) as Record<string, string>).length > 0 && <span className="badge plain" title="ป้ายภาพจาก AI">🏷 {Object.entries(JSON.parse(p.tags) as Record<string, string>).filter(([d]) => d === 'subject' || d === 'text' || d === 'background').map(([d, v]) => dims[d]?.values[v] ?? v).join(' · ')}</span>}
      </div>
      <p className={`pre small ${more ? '' : 'clamp'}`} onClick={() => setMore((m) => !m)}>{p.message || <span className="muted">(ไม่มีข้อความ)</span>}</p>
      <p className="muted small">{campaigns.slice(0, 2).join(' · ')}{campaigns.length > 2 ? ` +${campaigns.length - 2}` : ''} · {p.ads.length} แอด{p.permalink ? <> · <a href={p.permalink} target="_blank" rel="noreferrer">เปิดโพสต์</a></> : ''}</p>
      <div className="row wrap small">
        <CodePicker value={code} codes={codes} onChange={setCode} onPick={(c) => c !== p.code && call('PUT', '/api/studio/meta-posts/code', { key: p.key, code: c }).then(() => { toast(`ตั้งรหัส ${c || '(ว่าง)'} แล้ว`, 'ok'); onChanged(); }).catch((e) => toast(e.message, 'bad'))} />
        {p.message && ex === null && <><button className="ghost small" onClick={() => setEx(true)}>👍 ตัวอย่างที่ชอบ</button><button className="ghost small" onClick={() => setEx(false)}>👎 ไม่ชอบ</button></>}
      </div>
      {ex !== null && (
        <div className="row wrap small">
          <input placeholder={ex ? 'ชอบเพราะ…' : 'ไม่ชอบเพราะ…'} value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1 }} autoFocus />
          <button className="small" disabled={!reason.trim()} onClick={addExample}>เพิ่ม</button>
          <button className="ghost small" onClick={() => setEx(null)}>ยกเลิก</button>
        </div>
      )}
    </article>
  );
}

function PendingPlaybook({ p, onDone, onAgain, busy }: { p: Pending; onDone: () => void; onAgain: () => void; busy: boolean }) {
  const { toast } = useUi();
  const [text, setText] = useState(p.text);
  useEffect(() => setText(p.text), [p.text]);
  return (
    <div className="pending-playbook">
      <b className="small">สิ่งที่ AI เห็น</b>
      <ol className="small">{p.findings.map((f, i) => <li key={i}>{f.point} <span className="muted">— {f.evidence}</span></li>)}</ol>
      <b className="small">ร่างคู่มือ (แก้ได้ก่อนกดใช้)</b>
      <textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row wrap end">
        <button className="ghost" disabled={busy} onClick={onAgain}>วิเคราะห์ใหม่</button>
        <button disabled={busy} onClick={async () => {
          try { await call('POST', `/api/studio/playbook/${p.id}/approve`, { text }); toast('ใช้คู่มือนี้แล้ว — แคปชันรอบถัดไปจะเขียนตามนี้', 'ok'); onDone(); }
          catch (e: any) { toast(e.message, 'bad'); }
        }}>ใช้คู่มือนี้</button>
      </div>
    </div>
  );
}

/** Product code box: type a code or part of the name, pick from the suggestions (code · name). */
function CodePicker({ value, codes, onChange, onPick }: { value: string; codes: { code: string; name: string }[]; onChange: (v: string) => void; onPick: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const hits = q ? codes.filter((c) => c.code.toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q)).sort((a, b) => Number(!a.code.toLowerCase().startsWith(q)) - Number(!b.code.toLowerCase().startsWith(q)) || a.code.length - b.code.length).slice(0, 8) : [];
  const current = codes.find((c) => c.code === value);
  return (
    <div className="code-picker">
      <label className="row">รหัสสินค้า
        <input value={value} placeholder="พิมพ์รหัสหรือชื่อ" onFocus={() => setOpen(true)} onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onBlur={() => setTimeout(() => { setOpen(false); const v = value.trim(); if (!v || codes.some((c) => c.code === v)) onPick(v); }, 150)}
          onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) { onChange(hits[0].code); setOpen(false); onPick(hits[0].code); (e.target as HTMLInputElement).blur(); } if (e.key === 'Escape') setOpen(false); }} />
      </label>
      {current && !open && <span className="muted small">{current.name.slice(0, 40)}</span>}
      {open && hits.length > 0 && (
        <ul className="suggest">
          {hits.map((h) => <li key={h.code} onMouseDown={(e) => { e.preventDefault(); onChange(h.code); setOpen(false); onPick(h.code); }}><b>{h.code}</b> <span className="muted">{h.name.slice(0, 50)}</span></li>)}
        </ul>
      )}
      {open && q && !hits.length && <div className="suggest muted small">ไม่พบสินค้าในแคตตาล็อก</div>}
    </div>
  );
}

/**
 * "ภาพแบบไหนขายดี": the AI tags every post's picture (who wears it, text, background …), then ROAS per tag value
 * across the posts running as ads, plus wins/losses of that kind of picture in the room.
 */
function ImageTags({ posts, onTagged }: { posts: MetaPost[] | null; onTagged: () => void }) {
  const { toast } = useUi();
  const [rows, setRows] = useState<TagRow[] | null>(null);
  const [dims, setDims] = useState<Dims>({});
  const [busy, setBusy] = useState('');
  const load = () => call<{ tags: TagRow[]; dims: Dims }>('GET', '/api/studio/image-tags').then((r) => { setRows(r.tags); setDims(r.dims); }).catch(() => null);
  useEffect(() => { load(); }, []);
  const untagged = (posts ?? []).filter((p) => p.has_image && !p.tags).length;
  const tagAll = async (force: boolean) => {
    try {
      let first = force;
      for (let i = 0; i < 40; i++) {
        const r = await call<{ tagged: number; left: number }>('POST', `/api/studio/meta-posts/tag${first ? '?force=1' : ''}`);
        first = false;
        setBusy(`AI กำลังดูภาพ… เหลือ ${r.left}`);
        if (!r.left || !r.tagged) break;
      }
      toast('ติดป้ายภาพครบแล้ว', 'ok'); await load(); onTagged();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  };
  const byDim = new Map<string, TagRow[]>();
  for (const r of rows ?? []) byDim.set(r.dim, [...(byDim.get(r.dim) ?? []), r]);
  return (
    <section className="card">
      <h2>ภาพแบบไหนขายดี</h2>
      <p className="muted small">AI ดูภาพของทุกโพสต์แล้วติดป้าย (ตัวสินค้า · ข้อความบนภาพ · พื้นหลัง · หน้าคน · จำนวนสี · ความรู้สึก) · ROAS = ยอดแท็ก Meta ÷ ค่าแอด 14 วันของโพสต์ที่มีป้ายนั้นรวมกัน (คุ้มทุน ~2.9) · ชนะ/แพ้ = ในห้องฝึก เมื่อภาพสองภาพต่างกันที่ป้ายนั้น · ใช้เขียน prompt ภาพรอบถัดไป</p>
      <div className="row wrap">
        <button disabled={!!busy || !posts?.length} onClick={() => tagAll(false)}>{busy || (untagged ? `ให้ AI ติดป้ายภาพ (${untagged} ภาพ)` : 'ติดป้ายภาพใหม่ที่ยังไม่มี')}</button>
        {!busy && rows && rows.length > 0 && <button className="ghost small" onClick={() => tagAll(true)}>ติดป้ายใหม่ทั้งหมด</button>}
      </div>
      {rows && rows.length > 0 && (
        <div className="tag-tables">
          {[...byDim.entries()].map(([dim, list]) => (
            <table key={dim} className="small tag-table">
              <thead><tr><th>{dims[dim]?.label ?? dim}</th><th>โพสต์</th><th>ค่าแอด</th><th>ROAS</th><th>ห้องฝึก ชนะ/แพ้</th></tr></thead>
              <tbody>{list.map((r) => (
                <tr key={r.value}><td>{r.label}</td><td>{r.posts}</td><td>฿{b(r.spend)}</td><td className={r.roas === null ? '' : r.roas >= 3.5 ? 'ok' : r.roas < 2.9 ? 'warn' : ''}>{r.roas === null ? '–' : r.roas.toFixed(2)}</td><td>{r.wins + r.losses ? `${r.wins}/${r.losses}` : '–'}</td></tr>
              ))}</tbody>
            </table>
          ))}
        </div>
      )}
    </section>
  );
}
