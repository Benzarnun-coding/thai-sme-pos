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
  code: string; active: number; has_image: number; first_seen: string; fetched_at: string;
}

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

      {posts === null ? <div className="skeleton" style={{ height: 200 }} /> : posts.length === 0 ? (
        <p className="muted">ยังไม่มีข้อมูล — กด "ดึงโพสต์จากเพจ"</p>
      ) : (
        <div className="post-grid">
          {shown.map((p) => <PostCard key={p.key} p={p} onChanged={load} />)}
        </div>
      )}
    </div>
  );
}

function PostCard({ p, onChanged }: { p: MetaPost; onChanged: () => void }) {
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
      </div>
      <p className={`pre small ${more ? '' : 'clamp'}`} onClick={() => setMore((m) => !m)}>{p.message || <span className="muted">(ไม่มีข้อความ)</span>}</p>
      <p className="muted small">{campaigns.slice(0, 2).join(' · ')}{campaigns.length > 2 ? ` +${campaigns.length - 2}` : ''} · {p.ads.length} แอด{p.permalink ? <> · <a href={p.permalink} target="_blank" rel="noreferrer">เปิดโพสต์</a></> : ''}</p>
      <div className="row wrap small">
        <label className="row">รหัสสินค้า <input value={code} onChange={(e) => setCode(e.target.value)} onBlur={() => code !== p.code && call('PUT', '/api/studio/meta-posts/code', { key: p.key, code }).then(onChanged).catch((e) => toast(e.message, 'bad'))} style={{ width: 80 }} /></label>
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
