// /studio — วัตถุดิบ of the training room (docs/creative.md): the playbook, style cards with reference pictures,
// caption examples the team likes/dislikes, and per-product selling points + promo. The room itself is /studio/train.

import { useEffect, useState } from 'react';
import { HomeLogo, SiteNav } from './SiteNav.tsx';
import { useUi } from './ui.tsx';
import { productPictures } from './imageResize.ts';

export interface StudioProduct { code: string; name: string; price_min: number | null; price_max: number | null; skus: number; selling_points: string; promo: string; image_key: string | null; image_url: string | null }
export interface StyleCard { id: number; name: string; note: string; created_by: string; refs: { id: number; note: string }[] }
interface Example { id: number; text: string; liked: number; reason: string; created_by: string }
interface Playbook { id: number | null; text: string; proposed_by: string; created_at: string }
export interface Materials { styles: StyleCard[]; examples: Example[]; playbook: Playbook; hooks: Record<string, string>; reasons: Record<string, string>; ai: boolean }

export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body instanceof FormData ? { method, body } : { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data: any = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

/** The product's picture: the catalog's uploaded one, else column J's link through the proxy. */
export function productPic(p: StudioProduct): string | null {
  if (p.image_key) return `/api/catalog/image?key=${encodeURIComponent(p.image_key)}`;
  if (p.image_url) return `/api/catalog/image-proxy?url=${encodeURIComponent(p.image_url)}`;
  return null;
}

export function StudioApp() {
  useEffect(() => { document.title = 'วัตถุดิบ — ห้องฝึก'; }, []);
  const { toast, confirm } = useUi();
  const [m, setM] = useState<Materials | null>(null);
  const [products, setProducts] = useState<StudioProduct[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);
  useEffect(() => { call<{ pending: { id: number } | null }>('GET', '/api/studio/playbook/pending').then((r) => setPendingId(r.pending?.id ?? null)).catch(() => null); }, []);
  const reload = () => call<Materials>('GET', '/api/studio/materials').then(setM).catch((e) => toast(e.message, 'bad'));
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => call<{ products: StudioProduct[] }>('GET', `/api/studio/products?q=${encodeURIComponent(q)}`).then((r) => setProducts(r.products)).catch((e) => toast(e.message, 'bad')), 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (f: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await f(); if (ok) toast(ok, 'ok'); await reload(); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  return (
    <div className="kb-page studio">
      <SiteNav current="/studio" />
      <header className="kb-head">
        <div className="row"><HomeLogo text="ST" /><h1>วัตถุดิบ — ห้องฝึก</h1></div>
        <p className="muted small">สิ่งที่สอน AI เขียนแคปชันและทำภาพ: คู่มือ · สไตล์ภาพที่ชอบ · แคปชันตัวอย่าง · จุดขายต่อสินค้า — ของทั้งหมดนี้ใช้ใน <a href="/studio/train">ห้องฝึก</a> เท่านั้น ไม่ไปถึง Meta</p>
        {m && !m.ai && <p className="small warn">ยังไม่ได้ตั้ง ANTHROPIC_API_KEY — สร้างแคปชันไม่ได้ อัปโหลดวัตถุดิบได้</p>}
      </header>

      {pendingId && <p className="card small">🧠 มีร่างคู่มือจาก AI ที่วิเคราะห์โพสต์จริงรออยู่ — <a href="/studio/posts">ดูและกดใช้ที่หน้าโพสต์ที่ยิงอยู่</a></p>}
      {m && <PlaybookCard playbook={m.playbook} busy={busy} onSave={(text) => run(() => call('PUT', '/api/studio/playbook', { text }), 'บันทึกคู่มือแล้ว')} />}

      <section className="card">
        <h2>สไตล์ภาพ</h2>
        <p className="muted small">ตั้งชื่อสไตล์ บอกว่าชอบตรงไหน 1–2 บรรทัด แล้วใส่รูปตัวอย่าง 3–5 รูป (ที่ไป gen ใน ChatGPT แล้วชอบ หรือโพสต์คู่แข่ง) ระบบย่อรูปในเครื่องก่อนส่ง</p>
        {m?.styles.map((s) => <StyleCardView key={s.id} card={s} busy={busy} onChange={reload} onDelete={async () => { if (await confirm({ title: `ลบสไตล์ "${s.name}"?`, body: 'รูปตัวอย่างทั้งหมดของสไตล์นี้จะหายไป' })) run(() => call('DELETE', `/api/studio/style/${s.id}`), 'ลบแล้ว'); }} />)}
        <NewStyle busy={busy} onAdd={(name, note) => run(() => call('POST', '/api/studio/style', { name, note }), 'เพิ่มสไตล์แล้ว')} />
      </section>

      <section className="card">
        <h2>แคปชันตัวอย่าง</h2>
        <p className="muted small">วางแคปชันที่ชอบหรือไม่ชอบ และ <b>ต้องบอกเหตุผล 1 บรรทัด</b> — ตัวอย่างเปล่าๆ สอนระบบไม่ได้</p>
        <NewExample busy={busy} onAdd={(text, liked, reason) => run(() => call('POST', '/api/studio/example', { text, liked, reason }), 'เพิ่มตัวอย่างแล้ว')} />
        <div className="kb-list">
          {m?.examples.map((e) => (
            <article key={e.id} className="kb-item example">
              <div className="row between"><span className={`badge ${e.liked ? 'ok' : 'warn'}`}>{e.liked ? '👍 ชอบ' : '👎 ไม่ชอบ'}</span><button className="ghost small" disabled={busy} onClick={() => run(() => call('DELETE', `/api/studio/example/${e.id}`))}>ลบ</button></div>
              <p className="pre">{e.text}</p>
              <p className="muted small">เพราะ: {e.reason} · {e.created_by}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>สินค้า: จุดขายและโปร</h2>
        <p className="muted small">รายชื่อจากแคตตาล็อก (รหัสสินค้า คอลัมน์ C) · AI ใช้ได้เฉพาะตัวเลขและจุดขายที่พิมพ์ไว้ตรงนี้ · รูปสินค้าหลายมุมจาก Google Drive จะมาต่อทีหลัง</p>
        <input placeholder="ค้นหารหัส/ชื่อสินค้า" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="kb-list">
          {products.map((p) => <ProductRow key={p.code} p={p} busy={busy} onSave={(selling_points, promo) => run(() => call('PUT', '/api/studio/product-note', { code: p.code, selling_points, promo }), `บันทึก ${p.code} แล้ว`).then(() => setQ((x) => x))} />)}
          {!products.length && <p className="muted">ไม่พบสินค้า{q ? ` "${q}"` : ' — ซิงก์แคตตาล็อกก่อน'}</p>}
        </div>
      </section>
    </div>
  );
}

function PlaybookCard({ playbook, busy, onSave }: { playbook: Playbook; busy: boolean; onSave: (text: string) => void }) {
  const [text, setText] = useState(playbook.text);
  useEffect(() => setText(playbook.text), [playbook.text]);
  return (
    <section className="card">
      <h2>คู่มือ (เสียงของร้าน · คำห้าม · ต้องมี)</h2>
      <p className="muted small">{playbook.id ? `เวอร์ชัน #${playbook.id} โดย ${playbook.proposed_by}` : 'ยังใช้ค่าตั้งต้น — แก้ได้เลย'} · ทุกครั้งที่บันทึกเป็นเวอร์ชันใหม่ ของเก่าเก็บไว้</p>
      <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row end"><button disabled={busy || text.trim() === playbook.text.trim()} onClick={() => onSave(text)}>บันทึกคู่มือ</button></div>
    </section>
  );
}

function StyleCardView({ card, busy, onChange, onDelete }: { card: StyleCard; busy: boolean; onChange: () => void; onDelete: () => void }) {
  const { toast } = useUi();
  const [up, setUp] = useState(false);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUp(true);
    try {
      for (const f of Array.from(files).slice(0, 6)) {
        const { thumb, full } = await productPictures(f);
        const fd = new FormData();
        fd.set('card_id', String(card.id)); fd.set('thumb', thumb, 'thumb.jpg'); fd.set('full', full, 'full.jpg');
        await call('POST', '/api/studio/style-ref', fd);
      }
      toast('เพิ่มรูปแล้ว', 'ok'); onChange();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setUp(false); }
  };
  return (
    <article className="kb-item style-card">
      <div className="row between"><b>{card.name}</b><button className="ghost small" disabled={busy} onClick={onDelete}>ลบ</button></div>
      {card.note && <p className="muted small">{card.note}</p>}
      <div className="row wrap">
        {card.refs.map((r) => (
          <a key={r.id} href={`/api/studio/picture/ref/${r.id}?size=full&v=2`} target="_blank" rel="noreferrer" className="thumb"><img src={`/api/studio/picture/ref/${r.id}?v=2`} alt="" loading="lazy" /></a>
        ))}
        <label className="thumb add">{up ? '…' : '+ รูป'}<input type="file" accept="image/*" multiple hidden disabled={up} onChange={(e) => upload(e.target.files)} /></label>
      </div>
    </article>
  );
}

function NewStyle({ busy, onAdd }: { busy: boolean; onAdd: (name: string, note: string) => void }) {
  const [name, setName] = useState(''); const [note, setNote] = useState('');
  return (
    <div className="row wrap new-style">
      <input placeholder="ชื่อสไตล์ เช่น สตรีทพื้นมืด" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="ชอบตรงไหน (1–2 บรรทัด)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1 }} />
      <button disabled={busy || !name.trim()} onClick={() => { onAdd(name.trim(), note.trim()); setName(''); setNote(''); }}>เพิ่มสไตล์</button>
    </div>
  );
}

function NewExample({ busy, onAdd }: { busy: boolean; onAdd: (text: string, liked: boolean, reason: string) => void }) {
  const [text, setText] = useState(''); const [reason, setReason] = useState(''); const [liked, setLiked] = useState(true);
  return (
    <div className="new-example">
      <textarea rows={3} placeholder="วางแคปชัน" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row wrap">
        <div className="segmented small"><button className={liked ? 'on' : ''} onClick={() => setLiked(true)}>👍 ชอบ</button><button className={!liked ? 'on' : ''} onClick={() => setLiked(false)}>👎 ไม่ชอบ</button></div>
        <input placeholder={liked ? 'ชอบเพราะ…' : 'ไม่ชอบเพราะ…'} value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1 }} />
        <button disabled={busy || !text.trim() || !reason.trim()} onClick={() => { onAdd(text.trim(), liked, reason.trim()); setText(''); setReason(''); }}>เพิ่ม</button>
      </div>
    </div>
  );
}

function ProductRow({ p, busy, onSave }: { p: StudioProduct; busy: boolean; onSave: (selling_points: string, promo: string) => void }) {
  const [open, setOpen] = useState(false);
  const [sp, setSp] = useState(p.selling_points); const [promo, setPromo] = useState(p.promo);
  const pic = productPic(p);
  const price = p.price_min === null ? '–' : p.price_min === p.price_max ? `${p.price_min}` : `${p.price_min}–${p.price_max}`;
  return (
    <article className="kb-item product-row">
      <div className="row between" onClick={() => setOpen((o) => !o)} role="button">
        <div className="row">{pic ? <img className="mini" src={pic} alt="" loading="lazy" /> : <span className="mini none" />}<div><b>{p.code}</b> <span className="muted">{p.name}</span><div className="muted small">฿{price} · {p.skus} SKU{p.promo ? ` · โปร: ${p.promo}` : ''}{p.selling_points ? ' · มีจุดขายแล้ว' : ''}</div></div></div>
        <span className="muted small">{open ? '▴' : '▾'}</span>
      </div>
      {open && (
        <div className="grid2">
          <label>โปร (ข้อความที่ให้ AI ใช้ได้ เช่น 1 ตัว 189 · 3 ตัว 549 ส่งฟรี)<input value={promo} onChange={(e) => setPromo(e.target.value)} /></label>
          <label>จุดขาย (ผ้า ทรง ไซส์ที่มี ใส่กับอะไร — เฉพาะที่จริง)<textarea rows={3} value={sp} onChange={(e) => setSp(e.target.value)} /></label>
          <div className="row end" style={{ gridColumn: '1 / -1' }}><button disabled={busy || (sp === p.selling_points && promo === p.promo)} onClick={() => onSave(sp, promo)}>บันทึก</button></div>
        </div>
      )}
    </article>
  );
}
