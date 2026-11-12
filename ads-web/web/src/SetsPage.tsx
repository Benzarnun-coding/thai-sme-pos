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

interface GrokAd { set_id: number; code: string; status: string; campaign_id: string | null; ad_id: string | null; budget: number | null; error: string | null; decided_by: string | null; announced_at: string | null; launched_at: string | null; ends_at: string | null; result: string | null }
type GrokCfg = { budget: number; days: number; max_active: number; review: 'off' | 'dry' | 'on' };
const GROK_STATUS: Record<string, string> = { graduated: '🎓 ผ่าน — อยู่กลุ่มทดสอบแล้ว', proposed: '⏳ รอแม็กซ์กดอนุมัติใน Discord', working: '⚙️ กำลังสร้าง', running: '🟢 กำลังยิง', done: '🏁 ครบกำหนด', failed: '❌ ลงไม่สำเร็จ', declined: '🚫 ไม่ลง', withdrawn: '↩️ ถอนแล้ว' };

/** "(Grok)" test ads: what was proposed in #studio-training, what runs, what ended (worker/grokAds.ts). */
type GateReject = { id: number; code: string; why: string };
type ExternalGrok = { campaign_id: string; name: string; status: 'running' | 'done'; created_at: string; ends_at: string; result: string | null };
function GrokAds({ rows, cfg, onRun, onSave, rejects = [], external = [] }: { rows: GrokAd[]; cfg: GrokCfg | null; onRun: () => void; onSave: (c: GrokCfg) => void; rejects?: GateReject[]; external?: ExternalGrok[] }) {
  const [edit, setEdit] = useState<GrokCfg | null>(null);
  useEffect(() => setEdit(cfg), [cfg]);
  const d = (x: string | null) => (x ? new Date(x).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' }) : '');
  return (
    <section className="card">
      <div className="row between"><h2>แอดทดสอบ (Grok)</h2><button className="ghost small" onClick={onRun}>ตรวจ/เสนอตอนนี้</button></div>
      <p className="muted small">ระบบทำเองทุก 3 ชม.: AI ตัดสินภาพ → จับคู่ภาพ+แคปชันที่ผ่าน → เสนอในห้อง Discord studio-training พร้อมภาพ แม็กซ์กด ✅ แล้วจึงสร้างแคมใหม่ชื่อลงท้าย "(Grok)" งบ {cfg?.budget ?? 100} บาท/วัน {cfg?.days ?? 14} วัน แล้วหยุดเอง (เปิดพร้อมกันไม่เกิน {cfg?.max_active ?? 3} แคม) · ผล: ออเดอร์จริงจาก Page365 ที่จับคู่กับแคม เทียบกับยอดแท็ก Meta</p>
      {edit && <details><summary className="small">ตั้งค่า (เฉพาะเจ้าของ) — ตรวจแอดที่ยิงอยู่: {edit.review === 'on' ? 'ทำจริง' : edit.review === 'dry' ? 'แสดงอย่างเดียว' : 'ปิด'}</summary>
        <div className="row small" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <label>งบชุดใหม่ บาท/วัน<input type="number" min={50} max={500} value={edit.budget} onChange={(e) => setEdit({ ...edit, budget: Number(e.target.value) })} /></label>
          <label>จำนวนวัน<input type="number" min={3} max={30} value={edit.days} onChange={(e) => setEdit({ ...edit, days: Number(e.target.value) })} /></label>
          <label>เปิดพร้อมกันไม่เกิน<input type="number" min={1} max={10} value={edit.max_active} onChange={(e) => setEdit({ ...edit, max_active: Number(e.target.value) })} /></label>
          <label>ตรวจแอดที่ยิงอยู่ทุก 3 ชม.<select value={edit.review} onChange={(e) => setEdit({ ...edit, review: e.target.value as GrokCfg['review'] })}>
            <option value="off">ปิด</option><option value="dry">แสดงอย่างเดียว (ยังไม่แตะ Meta)</option><option value="on">ทำจริง</option></select></label>
          <button className="small" onClick={() => onSave(edit)}>บันทึก</button>
        </div>
        <p className="muted small">"ทำจริง" = ตัวที่ค่าแอด ≥ 500, ออเดอร์จริง ≥ 3, ROAS จริง ≥ 1.5× จุดคุ้มทุนร้าน ถูกย้ายเข้ากลุ่มทดสอบ (กฎงบของกลุ่มนั้นเพิ่ม/ลดงบต่อเอง) · ตัวที่ครบ 5 วัน ค่าแอด ≥ 300 ไม่มีออเดอร์เลยถูกหยุดก่อนกำหนด · งบใหม่ใช้กับชุดที่เสนอหลังจากนี้ ชุดที่เปิดแล้วไม่เปลี่ยน</p>
      </details>}
      {!rows.length ? <p className="muted small">ยังไม่มี — ต้องมีแคปชันและภาพที่ผ่านของสินค้าเดียวกันก่อน</p> : (
        <table className="small"><thead><tr><th>ชุด</th><th>สินค้า</th><th>สถานะ</th><th>ช่วง</th><th>ผล / หมายเหตุ</th></tr></thead><tbody>
          {rows.map((g) => { const r = g.result ? JSON.parse(g.result) : null; return (
            <tr key={g.set_id}><td>#{g.set_id}</td><td>{g.code}</td><td>{GROK_STATUS[g.status] ?? g.status}{g.decided_by ? ` · ${g.decided_by}` : ''}</td>
              <td>{g.launched_at ? `${d(g.launched_at)} – ${d(g.ends_at)}` : d(g.announced_at)}</td>
              <td>{r ? `ค่าแอด ${r.spend} · ${r.real_roas !== undefined ? `จริง ${r.real_orders} ออเดอร์ ROAS ${r.real_roas} · ` : ''}Meta ${r.purchases} ออเดอร์ ROAS ${r.roas}` : g.error ?? (g.campaign_id ? `แคม ${g.campaign_id}` : '')}</td></tr>); })}
        </tbody></table>
      )}
      {external.length > 0 && <>
        <b className="small">แคม "Grok …" ที่สร้างเองใน Ads Manager — ระบบดูแลให้ ({external.filter((e) => e.status === 'running').length} ยิงอยู่)</b>
        <p className="muted small">นับ 14 วันจากวันที่สร้างใน Meta แล้วหยุดเองและสรุปผลในห้อง studio-training · ระบบไม่แก้งบหรือแอดข้างใน</p>
        <table className="small"><thead><tr><th>แคม</th><th>สถานะ</th><th>ช่วง</th><th>ผล</th></tr></thead><tbody>
          {external.map((e) => { const r = e.result ? JSON.parse(e.result) : null; const d = (x: string) => new Date(x).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' }); return (
            <tr key={e.campaign_id}><td>{e.name}</td><td>{e.status === 'running' ? '🟢 ยิงอยู่' : '🏁 ครบกำหนด'}</td><td>{d(e.created_at)} – {d(e.ends_at)}</td><td>{r ? `ค่าแอด ${r.spend} · ซื้อ ${r.purchases} · ROAS ${r.roas}` : ''}</td></tr>); })}
        </tbody></table>
      </>}
      {rejects.length > 0 && <>
        <b className="small">ภาพใหม่ที่ตัวคัดไม่ให้ผ่าน (ไม่ถูกเสนอ)</b>
        <ul className="trial-rows small">{rejects.map((r) => <li key={r.id} className="grok-row"><img className="mini" src={`/api/studio/picture/cand/${r.id}?size=thumb`} alt="" /><span><b>{r.code}</b> ภาพ#{r.id} · {r.why}</span></li>)}</ul>
      </>}
    </section>
  );
}

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

  const [grok, setGrok] = useState<GrokAd[]>([]);
  const [rejects, setRejects] = useState<GateReject[]>([]);
  const [external, setExternal] = useState<ExternalGrok[]>([]);
  const [cfg, setCfg] = useState<GrokCfg | null>(null);
  const load = () => call<{ sets: CreativeSet[]; ready: Ready[]; grok_ads: GrokAd[]; grok_cfg: GrokCfg; gate_rejects?: GateReject[]; grok_external?: ExternalGrok[] }>('GET', '/api/studio/sets').then((r) => { setExternal(r.grok_external ?? []); setSets(r.sets); setReady(r.ready); setGrok(r.grok_ads ?? []); setCfg(r.grok_cfg ?? null); setRejects(r.gate_rejects ?? []); if (!code && r.ready[0]) setCode(r.ready[0].code); }).catch((e) => toast(e.message, 'bad'));
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
        <p className="muted small">เอาแคปชันกับภาพที่<b>ผ่านกรรมการ</b>ใน <a href="/studio/train">ห้องฝึก</a> ของสินค้าเดียวกันมาประกอบเป็นโพสต์ · ผ่าน = แคปชันชนะมากกว่าแพ้ หรือกรรมการแก้แล้วให้ผ่าน; ภาพชนะ ≥ 1 ครั้ง ไม่แพ้มากกว่าชนะ และ AI ไม่ได้ตัดตก · AI เช็กว่าภาพกับแคปชันพูดเรื่องเดียวกัน (สินค้า ราคา โปร) · ชุดที่อนุมัติแล้วจะถูกเสนอในห้อง Discord studio-training ให้แม็กซ์กดลงแอดทดสอบ (Grok) ไม่มีอะไรไปถึง Meta ถ้าไม่มีคนกด · <a href="/studio-guide.pdf" target="_blank" rel="noreferrer">📖 คู่มือ (PDF)</a></p>
        <p className="small">รออนุมัติ {drafts.length} ชุด · อนุมัติแล้ว {approved.length} ชุด</p>
      </header>
      <GrokAds rows={grok} cfg={cfg} rejects={rejects} external={external} onSave={(c) => call<{ grok_cfg: GrokCfg }>('POST', '/api/studio/ads-settings', c).then((r) => { setCfg(r.grok_cfg); toast('บันทึกแล้ว', 'ok'); }).catch((e) => toast(e.message, 'bad'))} onRun={() => { toast('กำลังตรวจ… (1–2 นาที)', 'info'); call('POST', '/api/studio/sets/run').then(() => { toast('ตรวจเสร็จ — ถ้ามีชุดผ่าน ข้อเสนอเด้งในห้อง studio-training แล้ว', 'ok'); load(); }).catch((e) => toast(e.message, 'bad')); }} />

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
