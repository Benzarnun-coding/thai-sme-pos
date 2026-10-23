// /studio/train — ห้องฝึก (docs/creative.md): generate captions for a product, judge A/B pairs with a one-tap reason,
// edit the winner ("แก้แล้วผ่าน"), upload images made in ChatGPT from the room's prompt, and see what was learned.

import { useEffect, useState } from 'react';
import { HomeLogo, SiteNav } from './SiteNav.tsx';
import { useUi } from './ui.tsx';
import { productPictures } from './imageResize.ts';
import { call, productPic, type Materials, type StudioProduct } from './StudioPage.tsx';

interface Candidate { id: number; kind: 'caption' | 'image'; code: string; product_name: string; promo: string; hook: string; style_id: number | null; text: string | null; created_by: string; created_at: string; ai_check?: string | null }
interface ImageCheck { product_match: number; product_issues: string; text_readable: boolean | null; text_issues: string; style_match: number | null; looks_fake: number; verdict: 'pass' | 'check' | 'fail'; summary: string }
const VERDICT = { pass: '✅ ใช้ได้', check: '👀 ให้คนดู', fail: '❌ ไม่ผ่าน' } as const;

/** The AI's look at one image, in one block. */
function CheckView({ c }: { c: ImageCheck }) {
  return (
    <div className="small ai-check">
      <b>AI ตรวจ: {VERDICT[c.verdict]}</b> · สินค้าตรงของจริง {c.product_match}/10{c.style_match !== null ? ` · ตรงสไตล์ ${c.style_match}/10` : ''} · ดูปลอม {c.looks_fake}/10{c.text_readable === false ? ' · ข้อความมีปัญหา' : ''}
      <div className="muted">{c.summary}{c.product_issues ? ` · สินค้า: ${c.product_issues}` : ''}{c.text_issues ? ` · ข้อความ: ${c.text_issues}` : ''}</div>
    </div>
  );
}
interface Pair { a: Candidate; b: Candidate }
type Recommended = StudioProduct & { spend: number; posts: number };

/**
 * One product box: click it to see the products running as ads now (most spend first), type a code or part of the
 * name to search the catalog; each row shows the picture, code and name. Empty = all products.
 */
function ProductPicker({ value, onPick }: { value: StudioProduct | null; onPick: (p: StudioProduct | null) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<StudioProduct[]>([]);
  const [recommended, setRecommended] = useState<Recommended[] | null>(null);
  useEffect(() => { call<{ products: Recommended[] }>('GET', '/api/studio/products/recommended').then((r) => setRecommended(r.products)).catch(() => setRecommended([])); }, []);
  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(() => call<{ products: StudioProduct[] }>('GET', `/api/studio/products?q=${encodeURIComponent(q)}&limit=12`).then((r) => setHits(r.products)).catch(() => null), 200);
    return () => clearTimeout(t);
  }, [q]);
  const list: (StudioProduct & { spend?: number })[] = q.trim() ? hits : recommended ?? [];
  const pick = (p: StudioProduct | null) => { onPick(p); setQ(''); setOpen(false); };
  return (
    <div className="product-picker">
      {value && !open ? (
        <button type="button" className="ghost picked" onClick={() => setOpen(true)}>
          {productPic(value) && <img className="mini" src={productPic(value)!} alt="" />}
          <span><b>{value.code}</b> <span className="muted">{value.name.slice(0, 40)}</span></span>
          <span className="muted small">เปลี่ยน</span>
        </button>
      ) : (
        <input autoFocus={open} placeholder="① เลือกสินค้า: กดเพื่อดูที่แนะนำ หรือพิมพ์รหัส/ชื่อ" value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) pick(list[0]); if (e.key === 'Escape') setOpen(false); }} />
      )}
      {open && (
        <ul className="suggest">
          {!q.trim() && <li className="muted small head">{recommended === null ? 'กำลังโหลด…' : recommended.length ? 'แนะนำ: สินค้าที่ยิงแอดอยู่ (ค่าแอดมากสุดก่อน)' : 'ยังไม่มีสินค้าที่ยิงแอดอยู่ — พิมพ์รหัสหรือชื่อเพื่อค้นหา'}</li>}
          {list.map((p) => (
            <li key={p.code} onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
              {productPic(p) ? <img className="mini" src={productPic(p)!} alt="" /> : <span className="mini" />}
              <span><b>{p.code}</b> <span className="muted">{p.name.slice(0, 50)}</span>{p.spend ? <span className="muted small"> · ยิงอยู่ ฿{p.spend.toLocaleString()} / 14 วัน</span> : null}{p.selling_points ? <span className="small ok-text"> · มีจุดขาย</span> : null}</span>
            </li>
          ))}
          {q.trim() && !hits.length && <li className="muted small head">ไม่พบสินค้าในแคตตาล็อก</li>}
          {value && <li className="muted small" onMouseDown={(e) => { e.preventDefault(); pick(null); }}>✕ ไม่เลือก (ดูคู่ของทุกสินค้า)</li>}
        </ul>
      )}
    </div>
  );
}
interface Stats { ai_eye: { pairs: number; agreed: number }; vs_real_img: { pairs: number; ai_wins: number }; held: number; judged: number; today: number; open: { caption: number; image: number }; hooks: { hook: string; wins: number; losses: number }[]; reasons: { reason: string; n: number }[]; agreement: { pairs: number; agreed: number }; vs_real: { pairs: number; ai_wins: number }; judges: { judge: string; n: number }[] }

const CAPTION_REASONS = ['wrong_fact', 'boring', 'too_long', 'not_our_voice', 'claim', 'better'];
const IMAGE_REASONS = ['product_wrong', 'unreadable', 'style_off', 'fake', 'better'];

export function TrainApp() {
  useEffect(() => { document.title = 'ห้องฝึก'; }, []);
  const { toast } = useUi();
  const [m, setM] = useState<Materials | null>(null);
  const [kind, setKind] = useState<'caption' | 'image'>('caption');
  const [product, setProduct] = useState<StudioProduct | null>(null);
  const code = product?.code ?? '';
  const [pair, setPair] = useState<Pair | null | undefined>(undefined);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ id: number; text: string } | null>(null);
  const [styleId, setStyleId] = useState<number | ''>('');
  const [prompt, setPrompt] = useState('');
  const [trying, setTrying] = useState('');
  const [released, setReleased] = useState<Set<number>>(new Set());
  const [uploaded, setUploaded] = useState<{ id: number; check: ImageCheck | { error: string } | null }[]>([]);

  const loadStats = () => call<Stats>('GET', '/api/studio/stats').then(setStats).catch(() => null);
  const loadPair = (k = kind, c = code) => call<{ pair: Pair | null }>('GET', `/api/studio/pair?kind=${k}&code=${encodeURIComponent(c)}`).then((r) => { setPair(r.pair); setEdit(null); }).catch((e) => toast(e.message, 'bad'));
  useEffect(() => { call<Materials>('GET', '/api/studio/materials').then(setM).catch((e) => toast(e.message, 'bad')); loadStats(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadPair(); }, [kind, code]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // Revealed only after the vote: which one was the real post running as an ad.
      const real = [pair.a, pair.b].find((c) => c.hook === 'real');
      if (pair.a.kind === 'image') {
        const [ca, cb] = [pair.a, pair.b].map((c) => (c.ai_check ? (JSON.parse(c.ai_check) as ImageCheck) : null));
        if (ca && cb) toast(`AI ให้คะแนนสินค้าตรงของจริง A ${ca.product_match}/10 · B ${cb.product_match}/10 (${VERDICT[ca.verdict]} / ${VERDICT[cb.verdict]})`, 'info');
      }
      if (real) toast(winner === null ? `เฉลย: ${real === pair.a ? 'A' : 'B'} คือโพสต์จริงที่ยิงอยู่` : winner === real.id ? `เฉลย: อันที่เลือกคือโพสต์จริงที่ยิงอยู่ (AI ยังแพ้)` : `เฉลย: อันที่เลือกคือของ AI — ชนะโพสต์จริง 🎉`, 'info');
      await loadPair(); await loadStats();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  const getPrompt = async () => {
    if (!code || !styleId) return toast('เลือกสินค้าและสไตล์ก่อน', 'bad');
    setBusy(true);
    try {
      const r = await call<{ prompt: string; learned: boolean; trying: string }>('GET', `/api/studio/image-prompt?code=${encodeURIComponent(code)}&style_id=${styleId}`);
      setPrompt(r.prompt); setTrying(r.learned ? r.trying : '');
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
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
        const r = await call<{ id: number; check: ImageCheck | { error: string } | null }>('POST', '/api/studio/image', fd);
        setUploaded((u) => [r, ...u].slice(0, 20));
      }
      toast('เพิ่มภาพเข้าห้องแล้ว — ดูผลที่ AI ตรวจด้านล่าง', 'ok'); await loadPair('image', code); await loadStats();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  const reasons = (kind === 'caption' ? CAPTION_REASONS : IMAGE_REASONS).map((k) => [k, m?.reasons[k] ?? k] as const);

  return (
    <div className="kb-page studio">
      <SiteNav current="/studio/train" />
      <header className="kb-head">
        <div className="row"><HomeLogo text="TR" /><h1>ห้องฝึก</h1></div>
        <p className="muted small">แคปชันในคู่อาจเป็นของ AI หรือโพสต์จริงที่ยิงแอดอยู่ (จาก <a href="/studio#posts">วัตถุดิบ › โพสต์ที่ยิงอยู่</a>) — ไม่บอกว่าอันไหนจนกว่าจะเลือก · AI เขียนแคปชันจาก <a href="/studio">วัตถุดิบ</a> · คนตัดสินทีละคู่ว่าอันไหนดีกว่า แล้วบอกเหตุผล 1 ปุ่ม · แก้ข้อความของตัวที่ชนะได้ (กลายเป็นตัวอย่างทอง) · ยังไม่มีอะไรไปถึง Meta</p>
        <details className="card small howto">
          <summary>วิธีใช้ (อ่านครั้งแรก) · <a href="/studio-guide.pdf" target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>📖 คู่มือฉบับเต็ม (PDF)</a></summary>
          <ol>
            <li><b>แคปชัน:</b> เลือกสินค้า → "ให้ AI เขียนแคปชัน 6 แบบ" → ตัดสินคู่ด้านล่างทีละคู่</li>
            <li><b>ภาพ:</b> กด "🖼 ฝึกภาพ" → เลือกสินค้า → (ไม่บังคับ) เลือกสไตล์ + "ขอ prompt สำหรับ ChatGPT" → คัดลอกไปวางใน ChatGPT พร้อมแนบรูปสินค้าจริง → ได้ภาพแล้วกด "③ อัปโหลดรูป" → ดูผลที่ AI ตรวจ</li>
            <li><b>ตัดสิน:</b> กด "A ดีกว่า / B ดีกว่า" ถ้าตัวที่แพ้มีปัญหาชัด ๆ กดเหตุผลแทน (เช่น สินค้าเพี้ยน: A แพ้) · แคปชันที่เกือบดีให้กด "✏️ แก้แล้วให้ผ่าน"</li>
            <li>บางคู่มีของจริงที่ยิงแอดอยู่ปนมา — เลือกตามที่คิดว่าดีจริง ๆ ระบบเฉลยหลังกด</li>
            <li>ทำวันละ ~10 นาที (แคปชัน ~20 คู่ ภาพ ~10 คู่) · ของที่ผ่านไปประกอบเป็นโพสต์ที่ <a href="/studio/sets">ห้องจับคู่</a></li>
          </ol>
        </details>
        {stats && <p className="small">วันนี้ตัดสินแล้ว <b>{stats.today}</b> คู่ · รวม {stats.judged} · รอตัดสิน แคปชัน {stats.open.caption} / ภาพ {stats.open.image}{stats.agreement.pairs ? ` · กรรมการเห็นตรงกัน ${Math.round((stats.agreement.agreed / stats.agreement.pairs) * 100)}% (${stats.agreement.pairs} คู่)` : ''}</p>}
        {stats && <p className="small"><b>AI เทียบโพสต์จริงแบบปิดตา:</b> {stats.vs_real.pairs ? `AI ชนะ ${stats.vs_real.ai_wins}/${stats.vs_real.pairs} คู่ (${Math.round((stats.vs_real.ai_wins / stats.vs_real.pairs) * 100)}%)` : 'ยังไม่มี'} · คู่ที่มีโพสต์จริงจะถูกส่งมาก่อน ไม่บอกว่าอันไหนคือของจริงจนกว่าจะกดเลือก · เป้าก่อนให้ AI ทำงานจริง: ชนะ ≥ 50% จาก ≥ 40 คู่</p>}
        {stats && kind === 'image' && <p className="small"><b>ภาพใหม่เทียบภาพโพสต์จริงแบบปิดตา:</b> {stats.vs_real_img.pairs ? `ชนะ ${stats.vs_real_img.ai_wins}/${stats.vs_real_img.pairs} คู่ (${Math.round((stats.vs_real_img.ai_wins / stats.vs_real_img.pairs) * 100)}%)` : 'ยังไม่มี'} · เป้า ≥ 50% จาก ≥ 30 คู่{stats.held ? ` · กันไว้เพราะสินค้าเพี้ยน ${stats.held} ภาพ` : ''}</p>}
        {stats && stats.ai_eye.pairs > 0 && <p className="small"><b>AI ตรวจภาพเห็นตรงกับกรรมการ:</b> {stats.ai_eye.agreed}/{stats.ai_eye.pairs} คู่ ({Math.round((stats.ai_eye.agreed / stats.ai_eye.pairs) * 100)}%) · ถ้าสูงพอ AI จะช่วยกรองภาพแทนคนได้</p>}
      </header>

      <section className="card">
        <div className="row wrap">
          <div className="segmented"><button className={kind === 'caption' ? 'on' : ''} onClick={() => setKind('caption')}>✍️ ฝึกแคปชัน</button><button className={kind === 'image' ? 'on' : ''} onClick={() => setKind('image')}>🖼 ฝึกภาพ (อัปโหลดรูป)</button></div>
          <ProductPicker value={product} onPick={setProduct} />
        </div>
        {product && (
          <div className="row" style={{ marginTop: 8 }}>
            {productPic(product) && <img className="mini" src={productPic(product)!} alt="" />}
            <div className="small"><b>{product.code}</b> {product.name} · ฿{product.price_min ?? '–'}{product.price_max !== product.price_min ? `–${product.price_max}` : ''}{product.promo ? ` · โปร: ${product.promo}` : ''}<br /><span className="muted">{product.selling_points || 'ยังไม่มีจุดขาย — AI จะใช้แค่ชื่อกับราคา (ใส่ได้ที่หน้าวัตถุดิบ)'}</span></div>
          </div>
        )}
        {kind === 'caption' ? (
          <div className="row gap"><button disabled={busy || !code || !m?.ai} onClick={generate}>{busy ? 'กำลังเขียน…' : '② ให้ AI เขียนแคปชัน 6 แบบ'}</button>{!code && <span className="small muted">เลือกสินค้าในช่อง ① ก่อน ปุ่มนี้จึงกดได้</span>}{!m?.ai && <span className="small warn">ยังไม่ได้ตั้ง ANTHROPIC_API_KEY</span>}</div>
        ) : (
          <div className="image-tools">
            {!code && <p className="small warn">เลือกสินค้าในช่อง ① ก่อน ปุ่มขอ prompt และอัปโหลดรูปจึงกดได้ (รูปทุกรูปต้องรู้ว่าเป็นสินค้าตัวไหน)</p>}
            <div className="row wrap">
              <span className="small muted">② ไม่บังคับ:</span>
              <select value={styleId} onChange={(e) => setStyleId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">{m?.styles.length ? 'เลือกสไตล์' : 'ยังไม่มีสไตล์ (เพิ่มที่หน้าวัตถุดิบ)'}</option>
                {m?.styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button className="ghost" disabled={!code || !styleId} onClick={getPrompt}>ขอ prompt สำหรับ ChatGPT</button>
            </div>
            <div className="row wrap">
              <label className={`button ${busy || !code ? 'disabled' : ''}`}>③ อัปโหลดรูป (เลือกได้หลายรูป)<input type="file" accept="image/*" multiple hidden disabled={busy || !code} onChange={(e) => { uploadImages(e.target.files); e.target.value = ''; }} /></label>
              <span className="small muted">รูปจาก ChatGPT หรือรูปที่ทำเอง · ต้องมีอย่างน้อย 2 รูปของสินค้าเดียวกันจึงขึ้นเป็นคู่ให้ตัดสิน</span>
            </div>
            {uploaded.length > 0 && (
              <div className="uploaded">
                {uploaded.map((u) => (
                  <div key={u.id} className="row uploaded-row">
                    <img className="mini big" src={`/api/studio/picture/cand/${u.id}?v=2`} alt="" />
                    <div style={{ flex: 1 }}>
                      {u.check && 'verdict' in u.check && u.check.product_match <= 4 && !released.has(u.id) && (
                        <div className="small warn">⛔ กันไว้ ไม่ส่งให้กรรมการ (AI ว่าสินค้าไม่ตรงของจริง) <button className="ghost small" onClick={async () => { try { await call('POST', `/api/studio/candidate/${u.id}/release`); setReleased((s) => new Set(s).add(u.id)); await loadPair(); } catch (e: any) { toast(e.message, 'bad'); } }}>ส่งให้กรรมการอยู่ดี</button></div>
                      )}
                      {u.check && 'verdict' in u.check ? <CheckView c={u.check} /> : <span className="small warn">{u.check && 'error' in u.check ? `AI ตรวจไม่ได้: ${u.check.error}` : 'ยังไม่ได้ตรวจ (ไม่มี ANTHROPIC_API_KEY)'}</span>}
                      <div className="row">
                        <button className="ghost small" disabled={busy} onClick={async () => { try { const r = await call<{ check: ImageCheck }>('POST', `/api/studio/check-image/${u.id}`); setUploaded((l) => l.map((x) => (x.id === u.id ? { ...x, check: r.check } : x))); } catch (e: any) { toast(e.message, 'bad'); } }}>ตรวจใหม่</button>
                        <button className="ghost small warn" disabled={busy} onClick={async () => { try { await call('DELETE', `/api/studio/candidate/${u.id}`); setUploaded((l) => l.filter((x) => x.id !== u.id)); await loadPair(); } catch (e: any) { toast(e.message, 'bad'); } }}>เอาออกจากห้อง</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {prompt && trying && <p className="small">🧪 รอบนี้ลองของใหม่: <b>{trying}</b> (prompt เขียนจากภาพแบบที่ขายได้ + ภาพที่ชนะในห้อง)</p>}
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
                  <div className="row between"><span className="badge">{i === 0 ? 'A' : 'B'}{c.kind === 'image' && c.style_id ? ` · ${m?.styles.find((s) => s.id === c.style_id)?.name ?? 'สไตล์'}` : ''}</span></div>
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
