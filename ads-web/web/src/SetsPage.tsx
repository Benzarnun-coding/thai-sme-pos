// /studio/sets — ห้องจับคู่ (docs/creative.md): a caption and an image the judges passed, of one product, put
// together as a post (Claude checks they agree), then approved or dropped. Approved sets are what the ads side may
// take later; that hand-off is off until Benz switches it on.

import { useEffect, useState } from 'react';
import { HomeLogo, SiteNav } from './SiteNav.tsx';
import { useUi } from './ui.tsx';
import { call } from './StudioPage.tsx';

interface Passed { id: number; code: string; text: string | null; hook: string; style_id: number | null; wins: number; losses: number; edited: boolean; ai_check: string | null }
interface CreativeSet { id: number; code: string; caption_id: number; image_id: number; caption_text: string; ai_note: string | null; status: string; created_by: string; created_at: string; decided_by: string | null }
interface Ready { code: string; captions: number; images: number }
interface PairCheck { match: boolean; issues: string; summary: string }

const pic = (id: number, full = false) => `/api/studio/picture/cand/${id}?v=2${full ? '&size=full' : ''}`;

export function SetsApp() {
  useEffect(() => { document.title = 'ห้องจับคู่'; }, []);
  const { toast } = useUi();
  const [sets, setSets] = useState<CreativeSet[]>([]);
  const [ready, setReady] = useState<Ready[] | null>(null);
  const [code, setCode] = useState('');
  const [passed, setPassed] = useState<{ captions: Passed[]; images: Passed[] } | null>(null);
  const [cap, setCap] = useState<Passed | null>(null);
  const [img, setImg] = useState<Passed | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => call<{ sets: CreativeSet[]; ready: Ready[] }>('GET', '/api/studio/sets').then((r) => { setSets(r.sets); setReady(r.ready); if (!code && r.ready[0]) setCode(r.ready[0].code); }).catch((e) => toast(e.message, 'bad'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setCap(null); setImg(null); setPassed(null);
    if (code) call<{ captions: Passed[]; images: Passed[] }>('GET', `/api/studio/passed?code=${encodeURIComponent(code)}`).then(setPassed).catch((e) => toast(e.message, 'bad'));
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setText(cap?.text ?? ''), [cap]);

  const save = async () => {
    if (!cap || !img) return;
    setBusy(true);
    try {
      const r = await call<{ set: CreativeSet }>('POST', '/api/studio/sets', { caption_id: cap.id, image_id: img.id, caption_text: text });
      const note = r.set.ai_note ? (JSON.parse(r.set.ai_note) as PairCheck) : null;
      toast(note ? (note.match ? `บันทึกชุดแล้ว · AI: เข้ากันดี — ${note.summary}` : `บันทึกชุดแล้ว แต่ AI เห็นว่าไม่เข้ากัน: ${note.issues}`) : 'บันทึกชุดแล้ว', note && !note.match ? 'bad' : 'ok');
      setCap(null); setImg(null); await load();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const decide = async (id: number, status: string) => {
    try { await call('PUT', `/api/studio/sets/${id}`, { status }); await load(); } catch (e: any) { toast(e.message, 'bad'); }
  };

  const drafts = sets.filter((s) => s.status === 'draft'), approved = sets.filter((s) => s.status === 'approved');

  return (
    <div className="kb-page studio">
      <SiteNav current="/studio/sets" />
      <header className="kb-head">
        <div className="row"><HomeLogo text="SE" /><h1>ห้องจับคู่</h1></div>
        <p className="muted small">เอาแคปชันกับภาพที่<b>ผ่านกรรมการ</b>ใน <a href="/studio/train">ห้องฝึก</a> ของสินค้าเดียวกันมาประกอบเป็นโพสต์ · ผ่าน = แคปชันชนะมากกว่าแพ้ หรือกรรมการแก้แล้วให้ผ่าน; ภาพชนะ ≥ 1 ครั้ง ไม่แพ้มากกว่าชนะ และ AI ไม่ได้ตัดตก · AI เช็กว่าภาพกับแคปชันพูดเรื่องเดียวกัน (สินค้า ราคา โปร) · ชุดที่อนุมัติแล้วยังไม่ไปถึง Meta จนกว่าเบ้นจะเปิดการส่งต่อ · <a href="/studio-guide.pdf" target="_blank" rel="noreferrer">📖 คู่มือ (PDF)</a></p>
        <p className="small">รออนุมัติ {drafts.length} ชุด · อนุมัติแล้ว {approved.length} ชุด</p>
      </header>

      <section className="card">
        <h2>ประกอบชุดใหม่</h2>
        {ready === null ? <div className="skeleton" style={{ height: 40 }} /> : ready.length === 0 ? (
          <p className="muted">ยังไม่มีแคปชันหรือภาพที่ผ่านกรรมการ — ไปตัดสินที่ห้องฝึกก่อน</p>
        ) : (
          <div className="row wrap">
            {ready.map((r) => (
              <button key={r.code} className={`small ${code === r.code ? '' : 'ghost'}`} onClick={() => setCode(r.code)}>{r.code} · ✍️{r.captions} 🖼{r.images}</button>
            ))}
          </div>
        )}
        {passed && (
          <div className="pair">
            <div>
              <b className="small">แคปชันที่ผ่าน ({passed.captions.length})</b>
              {passed.captions.length === 0 && <p className="muted small">ยังไม่มี</p>}
              <div className="pick-list">
                {passed.captions.map((c) => (
                  <article key={c.id} className={`card cand pick ${cap?.id === c.id ? 'on' : ''}`} onClick={() => setCap(c)}>
                    <span className="muted small">ชนะ {c.wins} แพ้ {c.losses}{c.edited ? ' · กรรมการแก้แล้ว ⭐' : ''}</span>
                    <p className="pre small clamp">{c.text}</p>
                  </article>
                ))}
              </div>
            </div>
            <div>
              <b className="small">ภาพที่ผ่าน ({passed.images.length})</b>
              {passed.images.length === 0 && <p className="muted small">ยังไม่มี</p>}
              <div className="pick-grid">
                {passed.images.map((c) => (
                  <button key={c.id} className={`pick-img ${img?.id === c.id ? 'on' : ''}`} onClick={() => setImg(c)} title={`ชนะ ${c.wins} แพ้ ${c.losses}`}><img src={pic(c.id)} alt="" /></button>
                ))}
              </div>
            </div>
          </div>
        )}
        {cap && img && (
          <div className="set-preview">
            <b className="small">ตัวอย่างโพสต์ (แก้แคปชันได้)</b>
            <div className="fb-post">
              <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
              <img src={pic(img.id, true)} alt="" />
            </div>
            <div className="row end"><button disabled={busy || !text.trim()} onClick={save}>{busy ? 'AI กำลังเช็ก…' : 'บันทึกเป็นชุดโพสต์'}</button></div>
          </div>
        )}
      </section>

      {[['รออนุมัติ', drafts], ['อนุมัติแล้ว (พร้อมส่งต่อเมื่อเปิด)', approved]].map(([title, list]) => (list as CreativeSet[]).length > 0 && (
        <section key={title as string} className="card">
          <h2>{title as string}</h2>
          <div className="post-grid">
            {(list as CreativeSet[]).map((s) => {
              const note = s.ai_note ? (JSON.parse(s.ai_note) as PairCheck) : null;
              return (
                <article key={s.id} className="card post-card">
                  <a href={pic(s.image_id, true)} target="_blank" rel="noreferrer"><img src={pic(s.image_id)} alt="" /></a>
                  <span className="badge">{s.code}</span>
                  <p className="pre small clamp">{s.caption_text}</p>
                  {note && <p className={`small ${note.match ? 'muted' : 'warn'}`}>AI: {note.match ? 'เข้ากันดี' : `ไม่เข้ากัน — ${note.issues}`}</p>}
                  <p className="muted small">{s.created_by}{s.decided_by ? ` · ${s.status === 'approved' ? 'อนุมัติ' : 'ตัดสิน'}โดย ${s.decided_by}` : ''}</p>
                  <div className="row wrap">
                    {s.status === 'draft' && <button className="small" onClick={() => decide(s.id, 'approved')}>อนุมัติ</button>}
                    {s.status === 'approved' && <button className="ghost small" onClick={() => decide(s.id, 'draft')}>ย้อนกลับเป็นรออนุมัติ</button>}
                    <button className="ghost small warn" onClick={() => decide(s.id, 'rejected')}>ไม่ใช้</button>
                    <button className="ghost small" onClick={() => navigator.clipboard.writeText(s.caption_text).then(() => toast('คัดลอกแคปชันแล้ว', 'ok'))}>คัดลอกแคปชัน</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
