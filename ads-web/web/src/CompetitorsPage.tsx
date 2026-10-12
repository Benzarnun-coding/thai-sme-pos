// "คู่แข่ง": the team's competitor watch. Pages are opened in Meta's public Ad Library, worth-studying ads are
// typed in, and the analysis above is plain formulas over what was saved — no AI, no paid service.

import { useEffect, useMemo, useState } from 'react';
import { api, sectionName, type AdFormat, type Competitor, type CompetitorAd, type CompetitorData, type Overview } from './api.ts';
import { ANGLES, adLibraryUrl, angleCounts, daysRunning, formatMix, ourPricePerPiece, pricePerPiece, today, trend } from './competitorAnalysis.ts';
import { baht, num, when } from './fmt.ts';
import { Icon, useUi } from './ui.tsx';

const FORMAT_LABEL: Record<AdFormat, string> = { '': 'ไม่ระบุ', video: 'วิดีโอ', image: 'รูปเดียว', carousel: 'หลายรูป' };

export function CompetitorsPage({ data }: { data: Overview }) {
  const { toast } = useUi();
  const [cd, setCd] = useState<CompetitorData | null>(null);
  const [adding, setAdding] = useState(false);
  const load = () => api.competitors().then(setCd).catch((e) => toast(e.message, 'bad'));
  useEffect(() => { load(); }, []);

  if (!cd) return <p className="muted">กำลังโหลด…</p>;
  return (
    <div className="competitors">
      <div className="ideas-intro">
        <div>
          <h2>วิเคราะห์คู่แข่ง</h2>
          <p className="muted small">
            เปิดดูแอดคู่แข่งใน Ad Library ของ Meta (ข้อมูลสาธารณะ) แล้วบันทึกแอดที่น่าสนใจไว้ที่นี่ ระบบวิเคราะห์ด้วยสูตร ไม่ใช้ AI ไม่มีค่าใช้จ่าย
            · เรียนสูตร (โปร, ประโยคเปิด, รูปแบบ) อย่าใช้รูป/คลิปเขาตรงๆ
          </p>
        </div>
        {!adding && <button className="primary" onClick={() => setAdding(true)}>+ เพิ่มคู่แข่ง</button>}
      </div>

      {adding && <CompetitorForm onSaved={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}

      {cd.competitors.length === 0 && !adding && (
        <div className="empty card">
          <p>ยังไม่มีคู่แข่งในรายการ</p>
          <p className="muted small">กด "+ เพิ่มคู่แข่ง" ใส่ชื่อเพจ (และลิงก์เพจถ้ามี) แล้วกด "เปิด Ad Library" เพื่อดูแอดที่เขากำลังวิ่ง</p>
        </div>
      )}

      {cd.ads.length > 0 && <Insights cd={cd} data={data} />}

      {cd.competitors.map((c) => (
        <CompetitorCard key={c.id} c={c} cd={cd} data={data} onChanged={load} />
      ))}
    </div>
  );
}

// ---------- analysis ----------

function Insights({ cd, data }: { cd: CompetitorData; data: Overview }) {
  const nameOf = (id: string) => cd.competitors.find((c) => c.id === id)?.name ?? '–';
  const now = today();
  const longest = useMemo(() => cd.ads
    .filter((a) => a.status === 'active' && daysRunning(a, now) !== null)
    .sort((a, b) => daysRunning(b, now)! - daysRunning(a, now)!)
    .slice(0, 5), [cd.ads, now]);
  const prices = cd.ads
    .filter((a) => a.section_id && pricePerPiece(a.promo) !== null)
    .map((a) => ({ a, theirs: pricePerPiece(a.promo)!, ours: ourPricePerPiece(data, a.section_id!) }))
    .sort((x, y) => (x.ours ? x.theirs / x.ours : 9) - (y.ours ? y.theirs / y.ours : 9));
  const angles = angleCounts(cd.ads);
  const ourNames = data.campaigns.filter((c) => c.status === 'ACTIVE').map((c) => c.name);
  const ourShare = (label: string) => {
    const re = ANGLES.find(([l]) => l === label)![1];
    return ourNames.length ? ourNames.filter((n) => re.test(n)).length / ourNames.length : 0;
  };
  const formats = formatMix(cd.ads);
  const moves = cd.competitors.map((c) => ({ c, t: trend(cd.checks, c.id) })).filter((x) => x.t);

  return (
    <div className="insight-grid">
      <section className="card insight">
        <h3>แอดที่วิ่งนานสุด <span className="muted small">— น่าจะทำเงิน ไม่มีใครปล่อยแอดขาดทุนวิ่งเป็นเดือน</span></h3>
        {longest.length === 0 ? <p className="muted small">ใส่ "วันที่เริ่มวิ่ง" ของแอด (ดูใน Ad Library: เริ่มแสดงเมื่อ) เพื่อจัดอันดับ</p> : (
          <ol className="rank">
            {longest.map((a) => (
              <li key={a.id}>
                <b className="days">{daysRunning(a, now)} วัน</b>
                <div>
                  <span><b>{nameOf(a.competitor_id)}</b>{a.promo && <> · {a.promo}</>}</span>
                  {a.hook && <span className="muted small clip-wrap">“{a.hook}”</span>}
                </div>
                {a.library_url && <a className="small" href={a.library_url} target="_blank" rel="noreferrer noopener">ดูแอด</a>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="card insight">
        <h3>ราคาต่อตัว: เขา vs เรา</h3>
        {prices.length === 0 ? <p className="muted small">ผูกแอดคู่แข่งกับ "สินค้าของเรา" และเขียนโปรแบบ "3 ตัว 499" เพื่อเทียบราคา</p> : (
          <table className="compare">
            <thead><tr><th>คู่แข่ง · โปร</th><th>เขา/ตัว</th><th>เรา/ตัว</th><th /></tr></thead>
            <tbody>
              {prices.map(({ a, theirs, ours }) => {
                const diff = ours ? (theirs / ours - 1) * 100 : null;
                const sec = data.sections.find((s) => s.id === a.section_id);
                return (
                  <tr key={a.id}>
                    <td className="clip-wrap"><b>{nameOf(a.competitor_id)}</b> · {a.promo}<br /><span className="muted small">เทียบกับ {sec ? sectionName(sec) : '–'}</span></td>
                    <td className="num">{baht(theirs)}</td>
                    <td className="num">{ours === null ? '–' : baht(ours)}</td>
                    <td className={`num ${diff === null ? '' : diff < -3 ? 'bad' : diff > 3 ? 'good' : ''}`}>
                      {diff === null ? 'ยังไม่มีราคาเรา' : Math.abs(diff) <= 3 ? 'พอๆ กัน' : diff < 0 ? `เขาถูกกว่า ${num(-diff)}%` : `เราถูกกว่า ${num(diff)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="card insight">
        <h3>มุมขายที่คู่แข่งใช้ <span className="muted small">เทียบกับชื่อแคมเปญที่เราเปิดอยู่</span></h3>
        {angles.length === 0 ? <p className="muted small">ใส่โปรและประโยคเปิดของแอดคู่แข่ง ระบบจะนับคำอย่าง ส่งฟรี, ปลายทาง, แถม, รีวิว</p> : (
          <div className="bars">
            {angles.map((x) => {
              const theirs = x.count / cd.ads.length;
              const ours = ourShare(x.label);
              return (
                <div key={x.label} className="bar-row">
                  <span className="bar-label">{x.label}</span>
                  <span className="bar-track"><i style={{ width: `${theirs * 100}%` }} /></span>
                  <span className="small num">{num(theirs * 100)}%</span>
                  <span className={`small ${ours + 0.2 < theirs ? 'warn' : 'muted'}`}>เรา {num(ours * 100)}%</span>
                </div>
              );
            })}
          </div>
        )}
        {formats.length > 0 && <p className="small muted">รูปแบบแอด: {formats.map((f) => `${f.format} ${f.count}`).join(' · ')}</p>}
      </section>

      <section className="card insight">
        <h3>ความเคลื่อนไหว <span className="muted small">จำนวนแอดที่วิ่งอยู่ จากการเช็กแต่ละครั้ง</span></h3>
        {moves.length === 0 ? <p className="muted small">กด "บันทึกการเช็ก" ที่คู่แข่งแต่ละราย ใส่จำนวนแอดที่เห็นใน Ad Library สัปดาห์ละครั้ง</p> : (
          <ul className="plain-list">
            {moves.map(({ c, t }) => {
              const d = t!.before ? t!.now.active_ads - t!.before.active_ads : null;
              return (
                <li key={c.id} className="move-row">
                  <b>{c.name}</b>
                  <span>{t!.now.active_ads} แอด</span>
                  <span className={`small ${d === null ? 'muted' : d > 0 ? 'warn' : d < 0 ? 'good' : 'muted'}`}>
                    {d === null ? 'เช็กครั้งแรก' : d > 0 ? `+${d} กำลังทดลอง/ขยาย` : d < 0 ? `${d} ลดแอด` : 'เท่าเดิม'}
                  </span>
                  <span className="small muted">{when(t!.now.checked_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------- competitor card ----------

function CompetitorCard({ c, cd, data, onChanged }: { c: Competitor; cd: CompetitorData; data: Overview; onChanged: () => void }) {
  const { confirm, toast } = useUi();
  const [editing, setEditing] = useState(false);
  const [addingAd, setAddingAd] = useState(false);
  const [editAd, setEditAd] = useState<string | null>(null);
  const [count, setCount] = useState('');
  const ads = cd.ads.filter((a) => a.competitor_id === c.id);
  const t = trend(cd.checks, c.id);
  const now = today();

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (count === '') return;
    try { await api.addCompetitorCheck(c.id, Number(count), ''); setCount(''); toast('บันทึกการเช็กแล้ว', 'ok'); onChanged(); } catch (err: any) { toast(err.message, 'bad'); }
  }
  async function remove() {
    if (!(await confirm({ title: `ลบคู่แข่ง "${c.name}"?`, body: <p className="muted">แอดที่บันทึกไว้ {ads.length} ตัวและประวัติการเช็กจะถูกลบด้วย</p>, confirmLabel: 'ลบ', tone: 'danger' }))) return;
    try { await api.deleteCompetitor(c.id); onChanged(); } catch (err: any) { toast(err.message, 'bad'); }
  }
  async function setAd(a: CompetitorAd, patch: Partial<CompetitorAd>, ok: string) {
    try { await api.saveCompetitorAd({ ...a, ...patch }); toast(ok, 'ok'); onChanged(); } catch (err: any) { toast(err.message, 'bad'); }
  }
  async function removeAd(a: CompetitorAd) {
    if (!(await confirm({ title: 'ลบแอดนี้?', body: <p className="clip-wrap">{a.promo || a.hook || a.library_url}</p>, confirmLabel: 'ลบ', tone: 'danger' }))) return;
    try { await api.deleteCompetitorAd(a.id); onChanged(); } catch (err: any) { toast(err.message, 'bad'); }
  }

  if (editing) return <CompetitorForm initial={c} onSaved={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />;

  return (
    <section className="card competitor">
      <header className="competitor-head">
        <div>
          <h2>{c.name}</h2>
          <p className="muted small">
            {c.page_url && <><a href={c.page_url} target="_blank" rel="noreferrer noopener">เพจ</a> · </>}
            {t ? <>เช็กล่าสุด {when(t.now.checked_at)}: {t.now.active_ads} แอดที่วิ่งอยู่</> : 'ยังไม่เคยเช็ก'}
            {c.notes && <> · {c.notes}</>}
          </p>
        </div>
        <div className="row wrap">
          <a className="button primary" href={adLibraryUrl(c)} target="_blank" rel="noreferrer noopener">เปิด Ad Library <Icon name="chevron" size={14} /></a>
          <form className="check-form" onSubmit={check}>
            <input type="number" min={0} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} placeholder="จำนวนแอด" aria-label="จำนวนแอดที่วิ่งอยู่" />
            <button disabled={count === ''}>บันทึกการเช็ก</button>
          </form>
          <button className="ghost small" onClick={() => setEditing(true)}>แก้</button>
          <button className="ghost small danger" onClick={remove}>ลบ</button>
        </div>
      </header>
      <PageStats ads={ads} checks={cd.checks} competitorId={c.id} />
      {!c.page_id && <p className="small muted">ใส่ลิงก์เพจแบบ profile.php?id=… หรือ Page ID จะเปิด Ad Library ตรงเพจ (ตอนนี้ค้นด้วยชื่อ)</p>}

      <div className="comp-ads">
        {ads.map((a) => editAd === a.id ? (
          <AdForm key={a.id} competitorId={c.id} initial={a} data={data} onSaved={() => { setEditAd(null); onChanged(); }} onCancel={() => setEditAd(null)} />
        ) : (
          <div key={a.id} className={`comp-ad ${a.status === 'stopped' ? 'stopped' : ''}`}>
            <div className="comp-ad-main">
              <div className="row wrap">
                {a.promo && <b>{a.promo}</b>}
                {a.format && <span className="badge">{FORMAT_LABEL[a.format]}</span>}
                {daysRunning(a, now) !== null && <span className={`badge ${daysRunning(a, now)! >= 30 ? 'next' : ''}`}>วิ่ง {daysRunning(a, now)} วัน{a.status === 'stopped' ? ' (หยุดแล้ว)' : ''}</span>}
                {a.section_id && <span className="badge plain">เทียบ {sectionName(data.sections.find((s) => s.id === a.section_id) ?? { id: '', name: '–' })}</span>}
              </div>
              {a.hook && <p className="clip-wrap">“{a.hook}”</p>}
              {a.notes && <p className="small muted clip-wrap">{a.notes}</p>}
            </div>
            <div className="comp-ad-actions">
              {a.library_url && <a className="small" href={a.library_url} target="_blank" rel="noreferrer noopener">ดูแอด</a>}
              {a.status === 'active'
                ? <>
                    <button className="small" onClick={() => setAd(a, { last_seen: now }, 'บันทึกว่ายังวิ่งอยู่')} title="เห็นว่ายังวิ่งอยู่วันนี้">ยังวิ่ง ✓</button>
                    <button className="ghost small" onClick={() => setAd(a, { status: 'stopped', last_seen: now }, 'บันทึกว่าหยุดแล้ว')}>หยุดแล้ว</button>
                  </>
                : <button className="ghost small" onClick={() => setAd(a, { status: 'active', last_seen: now }, 'กลับมาวิ่ง')}>กลับมาวิ่ง</button>}
              <button className="ghost small" onClick={() => setEditAd(a.id)}>แก้</button>
              <button className="ghost small danger" onClick={() => removeAd(a)}>ลบ</button>
            </div>
          </div>
        ))}
        {addingAd
          ? <AdForm competitorId={c.id} data={data} onSaved={() => { setAddingAd(false); onChanged(); }} onCancel={() => setAddingAd(false)} />
          : <button className="ghost add-ad" onClick={() => setAddingAd(true)}>+ บันทึกแอดของ {c.name}</button>}
      </div>
    </section>
  );
}

/** Stats strip for one page, from what the team saved. Empty cells say what to fill in. */
function PageStats({ ads, checks, competitorId }: { ads: CompetitorAd[]; checks: CompetitorData['checks']; competitorId: string }) {
  const now = today();
  const t = trend(checks, competitorId);
  const d = t?.before ? t.now.active_ads - t.before.active_ads : null;
  const active = ads.filter((a) => a.status === 'active');
  const longest = Math.max(-1, ...ads.map((a) => daysRunning(a, now) ?? -1));
  const prices = ads.map((a) => pricePerPiece(a.promo)).filter((x): x is number => x !== null);
  const angle = angleCounts(ads)[0];
  const format = formatMix(ads.filter((a) => a.format))[0];
  const cell = (label: string, value: React.ReactNode, sub: React.ReactNode, empty: boolean) => (
    <div className={empty ? 'empty-stat' : ''}><span>{label}</span><b>{value}</b><small>{sub}</small></div>
  );
  return (
    <div className="page-stats">
      {cell('แอดที่วิ่งอยู่', t ? t.now.active_ads : '–',
        t ? (d === null ? 'เช็กครั้งแรก' : d === 0 ? 'เท่าครั้งก่อน' : <span className={d > 0 ? 'warn' : 'good'}>{d > 0 ? `+${d}` : d} จากครั้งก่อน</span>) : 'ดูใน Ad Library แล้วกด "บันทึกการเช็ก"', !t)}
      {cell('แอดที่บันทึกไว้', ads.length, ads.length ? `วิ่งอยู่ ${active.length} · หยุด ${ads.length - active.length}` : 'กด "+ บันทึกแอด"', !ads.length)}
      {cell('วิ่งนานสุด', longest >= 0 ? `${longest} วัน` : '–', longest >= 30 ? 'น่าจะเป็นแอดทำเงิน' : longest >= 0 ? 'ยังไม่ถึงเดือน' : 'ใส่ "เริ่มวิ่ง" ของแอด', longest < 0)}
      {cell('ราคาต่ำสุด/ตัว', prices.length ? baht(Math.min(...prices)) : '–', prices.length ? `จาก ${prices.length} โปร` : 'เขียนโปรแบบ "3 ตัว 499"', !prices.length)}
      {cell('มุมขายหลัก', angle ? angle.label : '–', angle ? `${angle.count} จาก ${ads.length} แอด` : 'ใส่โปร/ประโยคเปิด', !angle)}
      {cell('รูปแบบหลัก', format ? format.format : '–', format ? `${format.count} แอด` : 'เลือกรูปแบบของแอด', !format)}
    </div>
  );
}

// ---------- forms ----------

function CompetitorForm({ initial, onSaved, onCancel }: { initial?: Competitor; onSaved: () => void; onCancel: () => void }) {
  const { toast } = useUi();
  const [f, setF] = useState({ name: initial?.name ?? '', page_url: initial?.page_url ?? '', page_id: initial?.page_id ?? '', notes: initial?.notes ?? '' });
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await api.saveCompetitor({ ...initial, ...f }); toast('บันทึกแล้ว', 'ok'); onSaved(); } catch (err: any) { toast(err.message, 'bad'); } finally { setBusy(false); }
  }
  return (
    <form className="card comp-form" onSubmit={save}>
      <h3>{initial ? `แก้ ${initial.name}` : 'เพิ่มคู่แข่ง'}</h3>
      <div className="grid2">
        <label>ชื่อเพจ<input value={f.name} autoFocus onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="เช่น ร้านยีนส์ ABC" /></label>
        <label>ลิงก์เพจ<input value={f.page_url} onChange={(e) => setF({ ...f, page_url: e.target.value })} placeholder="https://www.facebook.com/…" /></label>
        <label>Page ID (ถ้ารู้)<input value={f.page_id} inputMode="numeric" onChange={(e) => setF({ ...f, page_id: e.target.value })} placeholder="ตัวเลข" /><small>หาได้จาก Ad Library: เปิดแอดของเพจ → ลิงก์จะมี view_all_page_id=…</small></label>
        <label>หมายเหตุ<input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="เช่น ขายรุ่นคล้าย 801, ราคาถูกกว่า" /></label>
      </div>
      <div className="row end">
        <button type="button" className="ghost" onClick={onCancel}>ยกเลิก</button>
        <button className="primary" disabled={busy || !f.name.trim()}>บันทึก</button>
      </div>
    </form>
  );
}

function AdForm({ competitorId, initial, data, onSaved, onCancel }: {
  competitorId: string; initial?: CompetitorAd; data: Overview; onSaved: () => void; onCancel: () => void;
}) {
  const { toast } = useUi();
  const [f, setF] = useState({
    library_url: initial?.library_url ?? '', started_at: initial?.started_at ?? '', format: initial?.format ?? ('' as AdFormat),
    promo: initial?.promo ?? '', hook: initial?.hook ?? '', notes: initial?.notes ?? '', section_id: initial?.section_id ?? '',
  });
  const [busy, setBusy] = useState(false);
  const ppp = pricePerPiece(f.promo);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.saveCompetitorAd({ ...initial, ...f, competitor_id: competitorId, started_at: f.started_at || null, section_id: f.section_id || null });
      toast('บันทึกแอดแล้ว', 'ok');
      onSaved();
    } catch (err: any) { toast(err.message, 'bad'); } finally { setBusy(false); }
  }
  return (
    <form className="comp-ad-form" onSubmit={save}>
      <label className="span2">โปร / ราคา
        <input value={f.promo} autoFocus onChange={(e) => setF({ ...f, promo: e.target.value })} placeholder="เช่น 3 ตัว 499 ส่งฟรี" />
        <small>{ppp !== null ? `= ${baht(ppp)}/ตัว` : 'เขียนแบบ "3 ตัว 499" หรือ "ตัวละ 199" ระบบจะคิดราคาต่อตัวให้'}</small>
      </label>
      <label className="span2">ประโยคเปิด (hook)
        <input value={f.hook} onChange={(e) => setF({ ...f, hook: e.target.value })} placeholder="ข้อความบรรทัดแรก หรือคำพูดช่วง 3 วิแรกของคลิป" />
      </label>
      <label>เริ่มวิ่ง<input type="date" value={f.started_at} max={today()} onChange={(e) => setF({ ...f, started_at: e.target.value })} /><small>Ad Library: "เริ่มแสดงเมื่อ"</small></label>
      <label>รูปแบบ
        <select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value as AdFormat })}>
          {(Object.keys(FORMAT_LABEL) as AdFormat[]).map((k) => <option key={k} value={k}>{FORMAT_LABEL[k]}</option>)}
        </select>
      </label>
      <label>เทียบกับสินค้าเรา
        <select value={f.section_id} onChange={(e) => setF({ ...f, section_id: e.target.value })}>
          <option value="">— ไม่เทียบ —</option>
          {data.sections.filter((s) => s.id !== 'default').map((s) => <option key={s.id} value={s.id}>{sectionName(s)}</option>)}
        </select>
      </label>
      <label>ลิงก์แอด<input value={f.library_url} onChange={(e) => setF({ ...f, library_url: e.target.value })} placeholder="https://www.facebook.com/ads/library/?id=…" /></label>
      <label className="span2">หมายเหตุ / สิ่งที่น่าขโมย
        <input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="เช่น ใช้นางแบบหุ่นจริง, ถ่ายหน้ากระจก, ปิดท้ายด้วยรีวิวแชท" />
      </label>
      <div className="row end span2">
        <button type="button" className="ghost" onClick={onCancel}>ยกเลิก</button>
        <button className="primary" disabled={busy || !(f.promo.trim() || f.hook.trim() || f.library_url.trim())}>บันทึกแอด</button>
      </div>
    </form>
  );
}
