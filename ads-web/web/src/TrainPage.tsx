// /studio/train — ห้องฝึก (docs/creative.md): generate captions for a product, judge A/B pairs with a one-tap reason,
// edit the winner ("แก้แล้วผ่าน"), upload images made in ChatGPT from the room's prompt, and see what was learned.

import { useEffect, useState } from 'react';
import { HomeLogo, SiteNav } from './SiteNav.tsx';
import { useUi } from './ui.tsx';
import { productPictures } from './imageResize.ts';
import { call, productPic, type Materials, type StudioProduct } from './StudioPage.tsx';

interface Candidate { id: number; kind: 'caption' | 'image'; code: string; product_name: string; promo: string; hook: string; style_id: number | null; text: string | null; created_by: string; created_at: string }
interface Pair { a: Candidate; b: Candidate }
interface Stats { judged: number; today: number; open: { caption: number; image: number }; hooks: { hook: string; wins: number; losses: number }[]; reasons: { reason: string; n: number }[]; agreement: { pairs: number; agreed: number }; judges: { judge: string; n: number }[] }

const CAPTION_REASONS = ['wrong_fact', 'boring', 'too_long', 'not_our_voice', 'claim', 'better'];
const IMAGE_REASONS = ['product_wrong', 'unreadable', 'style_off', 'fake', 'better'];

export function TrainApp() {
  useEffect(() => { document.title = 'ห้องฝึก'; }, []);
  const { toast } = useUi();
  const [m, setM] = useState<Materials | null>(null);
  const [kind, setKind] = useState<'caption' | 'image'>('caption');
  const [products, setProducts] = useState<StudioProduct[]>([]);
  const [q, setQ] = useState('');
  const [code, setCode] = useState('');
  const [pair, setPair] = useState<Pair | null | undefined>(undefined);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ id: number; text: string } | null>(null);
  const [styleId, setStyleId] = useState<number | ''>('');
  const [prompt, setPrompt] = useState('');

  const loadStats = () => call<Stats>('GET', '/api/studio/stats').then(setStats).catch(() => null);
  const loadPair = (k = kind, c = code) => call<{ pair: Pair | null }>('GET', `/api/studio/pair?kind=${k}&code=${encodeURIComponent(c)}`).then((r) => { setPair(r.pair); setEdit(null); }).catch((e) => toast(e.message, 'bad'));
  useEffect(() => { call<Materials>('GET', '/api/studio/materials').then(setM).catch((e) => toast(e.message, 'bad')); loadStats(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadPair(); }, [kind, code]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => call<{ products: StudioProduct[] }>('GET', `/api/studio/products?q=${encodeURIComponent(q)}`).then((r) => setProducts(r.products)).catch(() => null), 250);
    return () => clearTimeout(t);
  }, [q]);
  const product = products.find((p) => p.code === code) ?? null;

  const generate = async () => {
    if (!code) return toast('เลือกสินค้าก่อน', 'bad');
    setBusy(true);
    try {
      const r = await call<{ candidates: Candidate[]; tokens: { input: number; output: number } }>('POST', '/api/studio/generate', { code, n: 6 });
      toast(`ได้แคปชัน ${r.candidates.length} แบบ`, 'ok');
      await loadPair('caption', code); await loadStats();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  const decide = async (winner: number | null, reason: string) => {
    if (!pair) return;
    setBusy(true);
    try {
      await call('POST', '/api/studio/judge', { a_id: pair.a.id, b_id: pair.b.id, winner_id: winner, reason, edited_text: edit && edit.id === winner ? edit.text : undefined });
      await loadPair(); await loadStats();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  const getPrompt = async () => {
    if (!code || !styleId) return toast('เลือกสินค้าและสไตล์ก่อน', 'bad');
    try { setPrompt((await call<{ prompt: string }>('GET', `/api/studio/image-prompt?code=${encodeURIComponent(code)}&style_id=${styleId}`)).prompt); } catch (e: any) { toast(e.message, 'bad'); }
  };
  const uploadImages = async (files: FileList | null) => {
    if (!files?.length || !code) return;
    setBusy(true);
    try {
      for (const f of Array.from(files).slice(0, 10)) {
        const { thumb, full } = await productPictures(f);
        const fd = new FormData();
        fd.set('code', code); fd.set('product_name', product?.name ?? ''); fd.set('style_id', String(styleId || '')); fd.set('prompt', prompt);
        fd.set('thumb', thumb, 'thumb.jpg'); fd.set('full', full, 'full.jpg');
        await call('POST', '/api/studio/image', fd);
      }
      toast('เพิ่มภาพเข้าห้องแล้ว', 'ok'); await loadPair('image', code); await loadStats();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  const reasons = (kind === 'caption' ? CAPTION_REASONS : IMAGE_REASONS).map((k) => [k, m?.reasons[k] ?? k] as const);

  return (
    <div className="kb-page studio">
      <SiteNav current="/studio/train" />
      <header className="kb-head">
        <div className="row"><HomeLogo text="TR" /><h1>ห้องฝึก</h1></div>
        <p className="muted small">AI เขียนแคปชันจาก <a href="/studio">วัตถุดิบ</a> · คนตัดสินทีละคู่ว่าอันไหนดีกว่า แล้วบอกเหตุผล 1 ปุ่ม · แก้ข้อความของตัวที่ชนะได้ (กลายเป็นตัวอย่างทอง) · ยังไม่มีอะไรไปถึง Meta</p>
        {stats && <p className="small">วันนี้ตัดสินแล้ว <b>{stats.today}</b> คู่ · รวม {stats.judged} · รอตัดสิน แคปชัน {stats.open.caption} / ภาพ {stats.open.image}{stats.agreement.pairs ? ` · กรรมการเห็นตรงกัน ${Math.round((stats.agreement.agreed / stats.agreement.pairs) * 100)}% (${stats.agreement.pairs} คู่)` : ''}</p>}
      </header>

      <section className="card">
        <div className="row wrap">
          <div className="segmented"><button className={kind === 'caption' ? 'on' : ''} onClick={() => setKind('caption')}>✍️ แคปชัน</button><button className={kind === 'image' ? 'on' : ''} onClick={() => setKind('image')}>🖼 ภาพ</button></div>
          <input placeholder="ค้นหาสินค้า (ว่าง = ทุกสินค้า)" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
          <select value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">ทุกสินค้า</option>
            {products.map((p) => <option key={p.code} value={p.code}>{p.code} {p.name.slice(0, 40)}</option>)}
          </select>
        </div>
        {product && (
          <div className="row" style={{ marginTop: 8 }}>
            {productPic(product) && <img className="mini" src={productPic(product)!} alt="" />}
            <div className="small"><b>{product.code}</b> {product.name} · ฿{product.price_min ?? '–'}{product.price_max !== product.price_min ? `–${product.price_max}` : ''}{product.promo ? ` · โปร: ${product.promo}` : ''}<br /><span className="muted">{product.selling_points || 'ยังไม่มีจุดขาย — AI จะใช้แค่ชื่อกับราคา (ใส่ได้ที่หน้าวัตถุดิบ)'}</span></div>
          </div>
        )}
        {kind === 'caption' ? (
          <div className="row gap"><button disabled={busy || !code || !m?.ai} onClick={generate}>{busy ? 'กำลังเขียน…' : 'ให้ AI เขียนแคปชัน 6 แบบ'}</button>{!m?.ai && <span className="small warn">ยังไม่ได้ตั้ง ANTHROPIC_API_KEY</span>}</div>
        ) : (
          <div className="image-tools">
            <div className="row wrap">
              <select value={styleId} onChange={(e) => setStyleId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">เลือกสไตล์</option>
                {m?.styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button className="ghost" disabled={!code || !styleId} onClick={getPrompt}>ขอ prompt สำหรับ ChatGPT</button>
              <label className={`button ${busy || !code ? 'disabled' : ''}`}>อัปโหลดภาพที่ได้<input type="file" accept="image/*" multiple hidden disabled={busy || !code} onChange={(e) => uploadImages(e.target.files)} /></label>
            </div>
            {prompt && <div className="kb-paste"><textarea readOnly rows={6} value={prompt} onFocus={(e) => e.target.select()} /><p className="muted small">คัดลอกไปวางใน ChatGPT พร้อมแนบรูปสินค้าจริง{m?.styles.find((s) => s.id === styleId)?.refs.length ? ' และรูปตัวอย่างสไตล์' : ''} แล้วอัปโหลดผลกลับมาที่ปุ่มด้านบน</p></div>}
          </div>
        )}
      </section>

      <section className="card">
        <h2>คู่ไหนดีกว่า?</h2>
        {pair === undefined ? <div className="skeleton" style={{ height: 160 }} /> : pair === null ? (
          <p className="muted">ไม่มีคู่ให้ตัดสินแล้ว{code ? ' สำหรับสินค้านี้' : ''} — {kind === 'caption' ? 'กดให้ AI เขียนเพิ่ม' : 'อัปโหลดภาพเพิ่ม (ต้องมีอย่างน้อย 2 ภาพของสินค้าเดียวกัน)'}</p>
        ) : (
          <>
            <div className="pair">
              {[pair.a, pair.b].map((c, i) => (
                <article key={c.id} className="card cand">
                  <div className="row between"><span className="badge">{i === 0 ? 'A' : 'B'}{c.hook ? ` · ${m?.hooks[c.hook] ?? c.hook}` : ''}{c.style_id ? ` · ${m?.styles.find((s) => s.id === c.style_id)?.name ?? 'สไตล์'}` : ''}</span><span className="muted small">#{c.id}</span></div>
                  {c.kind === 'image' ? <a href={`/api/studio/picture/cand/${c.id}?size=full&v=2`} target="_blank" rel="noreferrer"><img className="cand-img" src={`/api/studio/picture/cand/${c.id}?size=full&v=2`} alt="" /></a>
                    : edit?.id === c.id ? <textarea rows={6} value={edit.text} onChange={(e) => setEdit({ id: c.id, text: e.target.value })} /> : <p className="pre">{c.text}</p>}
                  {c.kind === 'caption' && (edit?.id === c.id ? <button className="ghost small" onClick={() => setEdit(null)}>ยกเลิกแก้</button> : <button className="ghost small" onClick={() => setEdit({ id: c.id, text: c.text ?? '' })}>✏️ แก้แล้วให้ผ่าน</button>)}
                  <button disabled={busy} onClick={() => decide(c.id, 'better')}>{edit?.id === c.id ? 'ผ่านฉบับที่แก้' : `${i === 0 ? 'A' : 'B'} ดีกว่า`}</button>
                </article>
              ))}
            </div>
            <p className="muted small">ถ้าแพ้เพราะอะไรชัดๆ กดเหตุผลของ<b>ตัวที่แพ้</b>แทนปุ่มด้านบน:</p>
            <div className="row wrap">
              {reasons.filter(([k]) => k !== 'better').map(([k, label]) => (
                <span key={k} className="row"><span className="muted small">{label}:</span><button className="ghost small" disabled={busy} onClick={() => decide(pair.b.id, k)}>A แพ้</button><button className="ghost small" disabled={busy} onClick={() => decide(pair.a.id, k)}>B แพ้</button></span>
              ))}
              <button className="ghost small warn" disabled={busy} onClick={() => decide(null, 'better')}>แย่ทั้งคู่</button>
            </div>
          </>
        )}
      </section>

      {stats && (stats.hooks.length > 0 || stats.reasons.length > 0) && (
        <section className="card">
          <h2>สิ่งที่เรียนได้ (ย่อ)</h2>
          <p className="muted small">จากการตัดสินทั้งหมด · hook = สิ่งที่แคปชันเปิดด้วย · ตัวเลขเริ่มมีความหมายเมื่อแต่ละ hook มี ≥ 10 ครั้ง</p>
          <div className="grid2">
            <div>
              <b className="small">hook ชนะ / แพ้</b>
              <ul className="small">{stats.hooks.map((h) => <li key={h.hook}>{m?.hooks[h.hook] ?? h.hook}: {h.wins} / {h.losses}{h.wins + h.losses >= 4 ? ` (${Math.round((h.wins / (h.wins + h.losses)) * 100)}%)` : ''}</li>)}</ul>
            </div>
            <div>
              <b className="small">เหตุผลที่แพ้</b>
              <ul className="small">{stats.reasons.map((r) => <li key={r.reason}>{m?.reasons[r.reason] ?? r.reason}: {r.n}</li>)}</ul>
              <b className="small">กรรมการ</b>
              <ul className="small">{stats.judges.map((j) => <li key={j.judge}>{j.judge}: {j.n}</li>)}</ul>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
