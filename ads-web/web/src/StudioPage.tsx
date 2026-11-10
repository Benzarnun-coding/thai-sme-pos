// /studio — วัตถุดิบ of the training room (docs/creative.md): the playbook, style cards with reference pictures,
// caption examples the team likes/dislikes, and per-product selling points + promo. The room itself is /studio/train.

import { useEffect, useState } from 'react';
import { HomeLogo, SiteNav } from './SiteNav.tsx';
import { useUi } from './ui.tsx';
import { PostsPanel } from './PostsPage.tsx';
import { productPictures } from './imageResize.ts';

export interface StudioProduct { code: string; name: string; price_min: number | null; price_max: number | null; skus: number; selling_points: string; promo: string; image_key: string | null; image_url: string | null }
export interface StyleCard { id: number; name: string; note: string; created_by: string; refs: { id: number; note: string }[] }
interface Example { id: number; text: string; liked: number; reason: string; created_by: string }
interface Playbook { id: number | null; text: string; proposed_by: string; created_at: string }
/** A draft playbook being tested against the live one (worker/playbookTrial.ts). */
export interface Trial { id: number; text: string; proposed_by: string; created_at: string; pairs: number; wins: number; need: number; win_at: number; products: { code: string; draft: number; live: number }[]; ready: boolean }
/** The last settled trial: score and the judge's line per pair (what to fix in the next draft). */
export interface LastTrial { id: number; result: 'won' | 'lost'; pairs: number; wins: number; settled_at: string | null; proposed_by: string; rows: { code: string; winner: 'draft' | 'live'; reason: string; note: string | null; judge: string; draft: string; live: string }[] }
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
  // Two tabs: the posts running as ads (read from Meta) and what the team types in. /studio/posts opens the first.
  const [tab, setTab] = useState<'posts' | 'team'>(() => (/^\/studio\/posts/.test(location.pathname) || location.hash === '#posts' ? 'posts' : 'team'));
  const show = (t: 'posts' | 'team') => { setTab(t); history.replaceState(null, '', t === 'posts' ? '/studio#posts' : '/studio'); };
  const [m, setM] = useState<Materials | null>(null);
  const [products, setProducts] = useState<StudioProduct[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);
  useEffect(() => { call<{ pending: { id: number } | null }>('GET', '/api/studio/playbook/pending').then((r) => setPendingId(r.pending?.id ?? null)).catch(() => null); }, []);
  const [trial, setTrial] = useState<Trial | null>(null);
  const [last, setLast] = useState<LastTrial | null>(null);
  const [grok, setGrok] = useState<GrokResult[]>([]);
  const [brief, setBrief] = useState<Brief | null>(null);
  const reload = () => Promise.all([
    call<Materials>('GET', '/api/studio/materials').then(setM).catch((e) => toast(e.message, 'bad')),
    call<{ trial: Trial | null; last: LastTrial | null }>('GET', '/api/studio/trial').then((r) => { setTrial(r.trial); setLast(r.last); }).catch(() => null),
    call<{ rows: GrokResult[] }>('GET', '/api/studio/grok-results').then((r) => setGrok(r.rows)).catch(() => null),
    call<Brief>('GET', '/api/studio/brief').then(setBrief).catch(() => null),
  ]);
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
        <p className="muted small">สิ่งที่สอน AI เขียนแคปชันและทำภาพ: โพสต์ที่ยิงแอดอยู่ (ดึงจาก Meta) · คู่มือ · สไตล์ภาพที่ชอบ · แคปชันตัวอย่าง · จุดขายต่อสินค้า — ของทั้งหมดนี้ใช้ใน <a href="/studio/train">ห้องฝึก</a> เท่านั้น ไม่ไปถึง Meta · <a href="/studio-guide.pdf" target="_blank" rel="noreferrer">📖 คู่มือ (PDF)</a></p>
        {m && !m.ai && <p className="small warn">ยังไม่ได้ตั้ง ANTHROPIC_API_KEY — สร้างแคปชันไม่ได้ อัปโหลดวัตถุดิบได้</p>}
        <div className="segmented"><button className={tab === 'posts' ? 'on' : ''} onClick={() => show('posts')}>① โพสต์ที่ยิงอยู่ (จาก Meta)</button><button className={tab === 'team' ? 'on' : ''} onClick={() => show('team')}>② ที่ทีมใส่เอง: คู่มือ · สไตล์ · ตัวอย่าง · จุดขาย</button></div>
      </header>

      {tab === 'posts' ? <PostsPanel /> : <>
      {brief && <BriefCard b={brief} />}
      {pendingId && <p className="card small">🧠 มีร่างคู่มือจาก AI ที่วิเคราะห์โพสต์จริงรออยู่ — <button className="ghost small" onClick={() => show('posts')}>ดูและกดใช้ที่แท็บโพสต์ที่ยิงอยู่</button></p>}
      {m && <PlaybookCard playbook={m.playbook} trial={trial} busy={busy}
        onSave={async (text) => { if (!trial || await confirm({ title: 'บันทึกและใช้ทันที?', body: 'มีร่างกำลังทดสอบอยู่ บันทึกตรงจะหยุดการทดสอบนั้น' })) run(() => call('PUT', '/api/studio/playbook', { text }), 'บันทึกคู่มือแล้ว — ใช้ทันที'); }}
        onTrial={(text) => run(() => call('POST', '/api/studio/trial', { text }), 'บันทึกเป็นร่างแล้ว — ห้องฝึกจะให้ AI เขียนแคปชันจากทั้งสองฉบับ แล้วให้กรรมการตัดสิน')}
        onStop={async () => { if (await confirm({ title: 'หยุดทดสอบร่างนี้?', body: 'คู่มือที่ใช้อยู่ไม่เปลี่ยน' })) run(() => call('POST', '/api/studio/trial/stop'), 'หยุดทดสอบแล้ว'); }}
        onUndo={async () => { if (await confirm({ title: 'ย้อนกลับไปใช้คู่มือฉบับก่อนหน้า?', body: 'บันทึกเป็นเวอร์ชันใหม่ ฉบับปัจจุบันยังเก็บไว้' })) run(() => call('POST', '/api/studio/playbook/undo'), 'ย้อนกลับแล้ว'); }} />}
      {last && !trial && <LastTrialCard last={last} />}
      {grok.length > 0 && <GrokResultsCard rows={grok} />}

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
      </>}
    </div>
  );
}

function PlaybookCard({ playbook, trial, busy, onSave, onTrial, onStop, onUndo }: { playbook: Playbook; trial: Trial | null; busy: boolean; onSave: (text: string) => void; onTrial: (text: string) => void; onStop: () => void; onUndo: () => void }) {
  const [text, setText] = useState(playbook.text);
  useEffect(() => setText(playbook.text), [playbook.text]);
  const changed = text.trim() !== playbook.text.trim();
  const pct = (w: number, n: number) => (n ? Math.round((w / n) * 100) : 0);
  return (
    <section className="card">
      <h2>คู่มือ (เสียงของร้าน · คำห้าม · ต้องมี)</h2>
      <p className="muted small">{playbook.id ? `เวอร์ชัน #${playbook.id} โดย ${playbook.proposed_by}` : 'ยังใช้ค่าตั้งต้น — แก้ได้เลย'} · ทุกครั้งที่บันทึกเป็นเวอร์ชันใหม่ ของเก่าเก็บไว้</p>
      {trial && (
        <div className="card small trial-box">
          <b>🧪 กำลังทดสอบร่าง #{trial.id}</b> (โดย {trial.proposed_by}) กับคู่มือที่ใช้อยู่ · ตัดสินแล้ว <b>{trial.pairs}/{trial.need}</b> คู่
          {trial.pairs ? <> · ร่างชนะ <b>{trial.wins}</b> ({pct(trial.wins, trial.pairs)}%)</> : null} · ครบ {trial.need} คู่ ถ้าร่างชนะ ≥ {Math.round(trial.win_at * 100)}% ระบบใช้ร่างเอง ถ้าไม่ถึงใช้ฉบับเดิมต่อ
          <div className="muted">{trial.ready ? <>แคปชันพร้อมแล้ว — AI กรรมการตัดสินเองแบบปิดตา (เปิด <a href="/studio/train">ห้องฝึก</a> ให้เร็วขึ้น หรือรอรอบอัตโนมัติทุก 3 ชม.)</> : <>กำลังเตรียมแคปชัน — เปิด <a href="/studio/train">ห้องฝึก</a> แล้วระบบเขียนให้เอง (หรือรอรอบอัตโนมัติทุก 3 ชม.)</>}</div>
          <details><summary>ดูร่าง</summary><pre className="trial-text">{trial.text}</pre></details>
          <div className="row end"><button className="ghost small" disabled={busy} onClick={onStop}>หยุดทดสอบ</button></div>
        </div>
      )}
      <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row wrap end">
        {playbook.id !== null && <button className="ghost small" disabled={busy} onClick={onUndo}>ย้อนกลับฉบับก่อน</button>}
        <button className="ghost" disabled={busy || !changed} onClick={() => onSave(text)}>บันทึกและใช้ทันที</button>
        <button disabled={busy || !changed || !!trial} title={trial ? 'มีร่างกำลังทดสอบอยู่' : ''} onClick={() => onTrial(text)}>ทดสอบก่อนใช้ (แนะนำ)</button>
      </div>
      <p className="muted small">"ทดสอบก่อนใช้" = บันทึกเป็นร่าง AI เขียนแคปชันจากทั้งร่างและฉบับเดิม AI กรรมการตัดสินแบบปิดตา (ไม่เห็นคู่มือ เทียบกับโพสต์ที่ขายดีจริง) ครบ 20 คู่ถ้าร่างชนะ ≥ 55% ระบบสลับให้เองและแจ้งใน Discord</p>
    </section>
  );
}

interface Brief { lines: string[]; images_now: number; month: string | null; voice: string; products: { code: string; name: string; spend: number; promo: string; waiting: number; testing: number }[] }

/** What to make today, worked back from the month's goal (worker/grokLoop.ts brief). */
function BriefCard({ b }: { b: Brief }) {
  return (
    <section className="card">
      <h2>งานวันนี้ของ Grok</h2>
      <p className="muted small">คิดย้อนจากเป้ากำไรของเดือน (หน้าภาพรวม: ยอดจริง Page365 − ต้นทุน − ค่าธรรมเนียม − ค่าแอด) · จำนวนแอดทดสอบจากห้องจับคู่ · สินค้าเรียงตามค่าแอด 14 วันของโพสต์ที่ยิงอยู่ ตัวที่ยังมีชุดทดสอบน้อยขึ้นก่อน</p>
      <ul className="small trial-rows">{b.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      {b.images_now > 0 && b.products.length > 0 && <>
        <b className="small">ทำภาพของสินค้าไหน (ขอ prompt ได้ที่ห้องฝึก)</b>
        <ul className="small trial-rows">{b.products.slice(0, Math.max(3, b.images_now)).map((p) => (
          <li key={p.code}><b>{p.code}</b> {p.name} · ค่าแอด 14 วัน {p.spend.toLocaleString('th-TH')}{p.promo ? ` · โปร ${p.promo}` : ''} · <span className="muted">ภาพรอ {p.waiting} · กำลังทดสอบ {p.testing}</span></li>))}</ul>
      </>}
      {b.voice && <details><summary className="small">ลูกค้าถามอะไร / ทำไมยังไม่ซื้อ (จากแชท 3 วันล่าสุด — ใช้เป็นมุมภาพและแคปชัน ตัวเขียนแคปชันได้รับชุดเดียวกันนี้)</summary><pre className="trial-text small">{b.voice}</pre></details>}
    </section>
  );
}

interface GrokRes { spend: number; purchases: number; value: number; roas: number; real_orders?: number; real_value?: number; real_roas?: number }
interface GrokResult { set_id: number; code: string; status: 'running' | 'done' | 'graduated'; launched_at: string | null; ends_at: string | null; result: string | null; review: string | null; caption_text: string; image_id: number; old_picture: number }

/** "(Grok)" test ads with their real result (Meta, 14 days): what to repeat and what to drop in the next round. */
function GrokResultsCard({ rows }: { rows: GrokResult[] }) {
  const d = (x: string | null) => (x ? new Date(x).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' }) : '');
  const score = (x: GrokRes) => x.real_roas ?? x.roas;
  const done = rows.filter((r) => r.status !== 'running' && r.result).map((r) => ({ ...r, res: JSON.parse(r.result!) as GrokRes }))
    .sort((a, b) => score(b.res) - score(a.res));
  const resLine = (r: GrokResult, x: GrokRes) => `${r.status === 'graduated' ? '🎓 ผ่าน ย้ายเข้ากลุ่มทดสอบ · ' : ''}${x.real_roas !== undefined ? `ROAS จริง ${x.real_roas} (${x.real_orders} ออเดอร์ ${x.real_value} บาท) · ` : ''}Meta ROAS ${x.roas} · ค่าแอด ${x.spend} · แท็ก ${x.purchases} ออเดอร์`;
  const review = (r: GrokResult) => { try { const v = r.review ? JSON.parse(r.review) as { action: string; why: string; dry: boolean } : null; return v ? ` · ${v.action === 'graduate' ? '🎓' : v.action === 'stop' ? '✂️' : '⏳'} ${v.why}${v.dry && v.action !== 'wait' ? ' (ยังไม่ทำจริง — สวิตช์อยู่ที่ห้องจับคู่)' : ''}` : ''; } catch { return ''; } };
  const running = rows.filter((r) => r.status === 'running');
  const Row = ({ r, line }: { r: GrokResult; line: string }) => (
    <li className="grok-row">
      <img className="mini" src={`/api/studio/picture/cand/${r.image_id}?size=thumb`} alt="" loading="lazy" />
      <div><b>{r.code}</b> ชุด#{r.set_id} · {line}{r.old_picture ? <span className="muted"> · ภาพแอดเดิม</span> : null}
        <details><summary className="muted small">แคปชัน</summary><pre className="trial-text small">{r.caption_text}</pre></details></div>
    </li>
  );
  return (
    <section className="card">
      <h2>ผลแอดทดสอบ (Grok)</h2>
      <p className="muted small">แอดที่ห้องฝึกสร้างเอง · ROAS จริง = ออเดอร์ Page365 ที่จับคู่กับแคมนี้ ÷ ค่าแอดจาก Meta (วันที่ยังไม่อัปโหลดไฟล์นับแต่ค่าแอด จึงไม่สูงเกินจริง) · ยอดแท็ก Meta ไว้เทียบ · ดีสุดก่อน · ตัวที่กำลังยิงถูกตรวจทุก 3 ชม.</p>
      {done.length > 0 && <ul className="trial-rows">{done.map((r) => <Row key={r.set_id} r={r} line={resLine(r, r.res)} />)}</ul>}
      {running.length > 0 && <><b className="small">กำลังยิง</b><ul className="trial-rows">{running.map((r) => <Row key={r.set_id} r={r} line={`${d(r.launched_at)} – ${d(r.ends_at)}${review(r)}`} />)}</ul></>}
    </section>
  );
}

/** Result of the last playbook trial with the judge's one-line reason per pair, draft wins first. */
function LastTrialCard({ last }: { last: LastTrial }) {
  const when = last.settled_at ? new Date(last.settled_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '';
  const group = (w: 'draft' | 'live') => last.rows.filter((r) => r.winner === w);
  const Rows = ({ rows }: { rows: LastTrial['rows'] }) => (
    <ul className="small trial-rows">{rows.map((r, i) => (
      <li key={i}><b>{r.code}</b> · {r.note || r.reason}{r.judge !== 'ai-judge' ? <span className="muted"> ({r.judge})</span> : null}
        <details><summary className="muted">ดูแคปชันทั้งสอง</summary><div className="trial-pair"><div><b>ร่าง</b><pre className="trial-text">{r.draft}</pre></div><div><b>ฉบับเดิม</b><pre className="trial-text">{r.live}</pre></div></div></details>
      </li>))}</ul>
  );
  return (
    <section className="card">
      <h2>ผลทดสอบล่าสุด: ร่าง #{last.id} {last.result === 'won' ? 'ชนะ ✅ ใช้แล้ว' : 'แพ้ — ใช้ฉบับเดิมต่อ'}</h2>
      <p className="muted small">ร่างชนะ {last.wins}/{last.pairs} คู่ ({last.pairs ? Math.round((last.wins / last.pairs) * 100) : 0}%, ต้อง ≥ 55%) · โดย {last.proposed_by}{when ? ` · จบ ${when}` : ''} · เหตุผลแต่ละคู่จาก AI กรรมการ (ตัดสินแบบปิดตา) ใช้แก้ร่างรอบหน้า</p>
      <b className="small">ร่างชนะ ({group('draft').length})</b><Rows rows={group('draft')} />
      <b className="small">ฉบับเดิมชนะ ({group('live').length})</b><Rows rows={group('live')} />
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
