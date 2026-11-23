// Benz Command Center (/command): Benz's read-only phone page. One call to /api/command/summary (its own Access app,
// so no other /api call works from here). Not in SiteNav (Benz, 15 Nov). Spec + design: docs/command-center/.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import './command.css';
import { AgentsEntry } from './AgentsShell.tsx';
import { SESSION_EXPIRED, summaryError, thrownError } from './commandErrors.ts';

type TileStatus = 'ok' | 'stale' | 'missing' | 'not_connected' | 'error';
interface Tile<T> { id: string; label: string; status: TileStatus; source: string; as_of: string | null; data: T | null; link?: string; note?: string }
interface PkYesterday { date: string; revenue: number; orders: number; units: number; uploaded_at: string }
interface PkYtd { year: string; target: number; revenue: number; pct: number; pace: number; uploaded_days: number; days_elapsed: number }
interface Countdown { days_left: number; seconds_left: number; passed: boolean }
interface Post { title: string; url: string; published_at: string }
interface JobMeta { job_id: string; project: string | null; title: string | null; status: string; updated: string }
interface TeamJobs {
  generated_at: string; total: number;
  groups: { done_today: number; needs_user: number; needs_user_old: number; stuck: number; working: number; send_failed: number; cancelled: number; other: number };
  rows: JobMeta[];
}
interface TodoItem { kind: 'p365_missing' | 'proposal' | 'job_needs_user'; ref: string; title: string; since: string | null; link: string }
interface Summary {
  version: 1; generated_at: string; today: string;
  business: { tiles: Tile<unknown>[] };
  team: Tile<TeamJobs>;
  todo: { source: string; parts: { jobs: TileStatus; proposals: 'ok' | 'error'; p365: 'ok' | 'error' }; items: TodoItem[]; more: number; older_needs_user: number | null };
  local_dev?: true;
}

const TZ = 'Asia/Bangkok';
const baht = (n: number) => `฿${Math.round(n).toLocaleString('th-TH')}`;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const dayShort = (d: string) => new Date(`${d}T00:00:00+07:00`).toLocaleDateString('th-TH', { timeZone: TZ, day: 'numeric', month: 'short' });
const dayLong = (iso: string) => new Date(iso).toLocaleDateString('th-TH', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
/** "hh:mm" today, else "d MMM hh:mm" (Bangkok) */
function when(iso: string | null, today: string): string {
  if (!iso) return '';
  const d = new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 10);
  return d === today ? hhmm(iso) : `${dayShort(d)} ${hhmm(iso)}`;
}
const REFRESH_AFTER_HIDDEN = 5 * 60_000;

function useSummary() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const last = useRef(0);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/command/summary', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      const body = await res.json().catch(() => null);
      const failed = summaryError(res, body);
      if (failed) throw new Error(failed);
      setData(body); setError(null); last.current = Date.now();
    } catch (e: any) {
      setError(thrownError(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
    const onVis = () => { if (document.visibilityState === 'visible' && Date.now() - last.current >= REFRESH_AFTER_HIDDEN) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);
  return { data, error, loading, load };
}

const Chev = ({ external }: { external?: boolean }) => external
  ? <svg className="cc-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M7 17 17 7" /><path d="M8 7h9v9" /></svg>
  : <svg className="cc-chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>;
const LinkOff = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9a9a9a" strokeWidth="2" aria-hidden="true"><path d="M9 15 15 9" /><path d="M11 6.5 13 4.5a4 4 0 0 1 6.5 6.5l-2 2" /><path d="m13 17.5-2 2A4 4 0 0 1 4.5 13l2-2" /></svg>;

function Src({ children, asOf, today, status }: { children: ReactNode; asOf?: string | null; today: string; status?: TileStatus }) {
  return (
    <p className="cc-src">ที่มา: {children}{asOf ? <span className="cc-at"> · ข้อมูลเมื่อ {when(asOf, today)}</span> : null}
      {status === 'stale' && <> <span className="cc-tag cc-stale">ข้อมูลเก่า</span></>}
      {status === 'error' && <> <span className="cc-tag cc-err">โหลดไม่สำเร็จ</span></>}
    </p>
  );
}

function ErrorBanner({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="cc-banner cc-err" role="alert">
      <span><b>โหลดไม่สำเร็จ</b><br />{text}</span>
      <button className="cc-btn" type="button" onClick={onRetry}>ลองใหม่</button>
    </div>
  );
}

function NotConnected({ title, why }: { title: string; why: string }) {
  return <div className="cc-nc"><LinkOff /><div><b>{title} · ยังไม่เชื่อม</b><p>{why}</p></div></div>;
}

// ---------- todo ----------

function TodoSection({ s }: { s: Summary }) {
  const { items, more, parts, older_needs_user } = s.todo;
  const allAnswered = parts.jobs !== 'not_connected' && parts.jobs !== 'error' && parts.proposals === 'ok' && parts.p365 === 'ok';
  const n = items.length + more;
  const sub = (i: TodoItem) => i.kind === 'p365_missing' ? 'ยอดเมื่อวานและกฎแอดยังใช้ตัวเลขของ Meta อยู่ · ไปหน้าอัปโหลด'
    : i.kind === 'proposal' ? `คำถามอนุมัติ · เปิดค้างตั้งแต่ ${when(i.since, s.today)} · ${i.link.startsWith('https://discord.com') ? 'เปิดใน Discord' : 'ไปที่ประวัติ'}`
    : `${i.ref} · รอเบ๊นตั้งแต่ ${when(i.since, s.today)}`;
  return (
    <section className="cc-sec" aria-labelledby="h-todo">
      <div className="cc-sec-h"><h2 id="h-todo">วันนี้เบ๊นต้องทำ</h2><span className={`cc-todo-count${n ? '' : ' cc-zero'}`}>{n} เรื่อง</span></div>
      <div className="cc-card cc-todo">
        {items.length ? (
          <ul className="cc-list">
            {items.map((i) => {
              const ext = i.link.startsWith('http');
              return (
                <li key={`${i.kind}-${i.ref}`}>
                  <a className="cc-row-link" href={i.link} {...(ext ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                    <span className={`cc-dot${i.kind === 'p365_missing' ? ' cc-r' : ''}`} aria-hidden="true" />
                    <span className="cc-t"><b>{i.title}</b><small>{sub(i)}</small></span>
                    <Chev external={ext} />
                  </a>
                </li>
              );
            })}
          </ul>
        ) : allAnswered ? (
          <div className="cc-empty"><b>วันนี้ไม่มีงานค้าง</b>ไม่มี job รอตัดสิน ไม่มีคำถามอนุมัติ และไฟล์ Page365 เมื่อวานไม่ได้ค้าง</div>
        ) : null}
        {more > 0 && <p className="cc-note">และอีก {more} เรื่อง</p>}
        {older_needs_user ? <p className="cc-note"><a href="#team">มีงานรอเบ๊นที่เก่ากว่า 7 วันอีก {older_needs_user} เรื่อง</a> (ไม่แสดงเป็นรายการ)</p> : null}
        {parts.jobs === 'not_connected' && <p className="cc-note">ยังไม่ได้เชื่อมงานทีม จึงยังเช็ก job ที่รอเบ๊นไม่ได้</p>}
        {parts.jobs === 'error' && <p className="cc-note">อ่าน snapshot งานทีมไม่สำเร็จ ยังเช็ก job ที่รอเบ๊นไม่ได้</p>}
        {parts.proposals === 'error' && <p className="cc-note">อ่านคำถามอนุมัติไม่สำเร็จ</p>}
        {parts.p365 === 'error' && <p className="cc-note">อ่านตารางอัปโหลด Page365 ไม่สำเร็จ</p>}
        <Src today={s.today}>{s.todo.source}</Src>
      </div>
    </section>
  );
}

// ---------- business ----------

function PkCard({ s, y, ytd }: { s: Summary; y: Tile<PkYesterday>; ytd: Tile<PkYtd> }) {
  const d = ytd.data;
  const pct = d ? Math.min(100, Math.max(0, d.pct)) : 0;
  const should = d && d.target ? Math.min(100, (d.pace / d.target) * 100) : 0;
  return (
    <article className="cc-card" aria-labelledby="h-pk">
      <h3 id="h-pk">PK Jeans</h3>
      <div className="cc-kpi">
        <div>
          <div className="cc-lab">ยอดขายเมื่อวาน</div>
          {y.status === 'ok' && y.data ? <>
            <div className="cc-val">{baht(y.data.revenue)}</div>
            <div className="cc-sub">{dayShort(y.data.date)} · {y.data.orders.toLocaleString('th-TH')} ออเดอร์ · {y.data.units.toLocaleString('th-TH')} ตัว</div>
          </> : y.status === 'missing' ? <>
            <div className="cc-val cc-word">ยังไม่มีไฟล์</div>
            <div className="cc-sub"><a href={y.link ?? '/#sales'}>ไปหน้าอัปโหลด</a></div>
          </> : <><div className="cc-val cc-grey">โหลดไม่สำเร็จ</div><div className="cc-sub">{y.note}</div></>}
        </div>
        <div>
          <div className="cc-lab">{d ? `ยอดสะสมปี ${d.year}` : 'ยอดสะสมปีนี้'}</div>
          {d ? <>
            <div className="cc-val">{baht(d.revenue)}</div>
            <div className="cc-sub">{d.pct.toFixed(1)}% ของเป้าทั้งปี</div>
          </> : ytd.status === 'missing' ? <><div className="cc-val cc-word">ยังไม่มีไฟล์</div><div className="cc-sub">ยังไม่มีไฟล์ Page365 ปีนี้</div></>
            : <><div className="cc-val cc-grey">โหลดไม่สำเร็จ</div><div className="cc-sub">{ytd.note}</div></>}
        </div>
      </div>
      {d && (
        <div className="cc-prog">
          <div className="cc-prog-row"><span>เทียบเป้า <b>{baht(d.target)}</b> / ปี</span><span>ถึงแล้ว <b>{d.pct.toFixed(1)}%</b></span></div>
          <div className="cc-bar" role="img" aria-label={`ยอดสะสมถึง ${d.pct.toFixed(1)} เปอร์เซ็นต์ของเป้าทั้งปี ตามเวลาที่ผ่านไปควรถึง ${should.toFixed(1)} เปอร์เซ็นต์`}>
            <div className="cc-fill" style={{ width: `${pct}%` }} />
            <div className={`cc-should${should > 80 ? ' cc-late' : ''}`} style={{ left: `${should}%` }}><span>ควรถึง {should.toFixed(1)}%</span></div>
          </div>
          <div className="cc-prog-row"><span>มีไฟล์ <b>{d.uploaded_days}</b> จาก <b>{d.days_elapsed}</b> วัน</span><span>วันที่ไม่มีไฟล์นับเป็น 0</span></div>
        </div>
      )}
      <Src today={s.today} asOf={y.status === 'ok' ? y.as_of : null}>{y.status === 'ok' ? y.source : 'ไฟล์ Page365 ที่อัปโหลดแล้ว ไม่ใช้ยอด Meta'} · {ytd.source} · "ควรถึง" = เป้า × วันที่ผ่านไป ÷ วันทั้งปี</Src>
    </article>
  );
}

function useNow(everyMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(t); }, [everyMs]);
  return now;
}

function FocusCard({ s, cd, members }: { s: Summary; cd: Tile<Countdown>; members: Tile<unknown> }) {
  const now = useNow(60_000);
  const c = cd.data;
  const left = c ? Math.max(0, c.seconds_left - Math.floor((now - Date.parse(s.generated_at)) / 1000)) : 0;
  const big = !c ? '–' : s.today === '2026-12-01' ? 'วันนี้' : c.passed || left === 0 ? 'เปิดแล้ว' : String(c.days_left);
  return (
    <article className="cc-card" aria-labelledby="h-fc">
      <h3 id="h-fc">Focus Club</h3>
      <div className="cc-kpi">
        <div className="cc-count">
          {big === 'วันนี้' || big === 'เปิดแล้ว' ? <b>{big}</b> : <>อีก<b>{big}</b>วันถึงวันเปิด</>}
          <br /><span style={{ fontSize: '12.5px' }}>1 ธ.ค. 2026{c && left > 0 && left < 48 * 3600 ? ` · อีก ${Math.floor(left / 3600)} ชม. ${Math.floor((left % 3600) / 60)} นาที` : ''}</span>
        </div>
        <div>
          <div className="cc-lab">สมาชิก</div>
          <div style={{ marginTop: 6 }}>{members.status === 'not_connected' ? <span className="cc-tag cc-off">ยังไม่เชื่อม</span> : <span className="cc-tag">{members.status}</span>}</div>
        </div>
      </div>
      <Src today={s.today}>{cd.source} · สมาชิก: {members.source}</Src>
    </article>
  );
}

function ClassRoomCard({ s, t }: { s: Summary; t: Tile<unknown> }) {
  return (
    <article className="cc-card" aria-labelledby="h-cr">
      <h3 id="h-cr">ClassRoom</h3>
      <NotConnected title="จำนวนนักเรียน" why="ยังไม่มีแหล่งข้อมูล เมื่อเลือกแหล่งได้แล้วตัวเลขจะขึ้นที่นี่" />
      <Src today={s.today}>{t.source}</Src>
    </article>
  );
}

function BlogCard({ s, t, onRetry }: { s: Summary; t: Tile<{ posts: Post[] }>; onRetry: () => void }) {
  const posts = t.data?.posts ?? [];
  return (
    <article className="cc-card" aria-labelledby="h-blog">
      <h3 id="h-blog">benzarnun.com · บทความล่าสุด</h3>
      {t.status === 'error' && <ErrorBanner text={`ดึง RSS ไม่ได้ กล่องอื่นยังใช้ได้ตามปกติ${t.note ? ` (${t.note})` : ''}`} onRetry={onRetry} />}
      {t.status === 'stale' && <div className="cc-banner cc-stale" role="status"><span><b>ข้อมูลเก่า</b> · ดึง RSS ใหม่ไม่ได้ แสดงที่เก็บไว้เมื่อ {when(t.as_of, s.today)}</span></div>}
      {(t.status === 'ok' || t.status === 'stale') && (posts.length ? (
        <ul className={`cc-list${t.status === 'stale' ? ' cc-dim' : ''}`}>
          {posts.map((p) => (
            <li key={p.url}><a className="cc-row-link" href={p.url} target="_blank" rel="noopener noreferrer"><span className="cc-t"><b>{p.title}</b><small>{dayLong(p.published_at)}</small></span><Chev external /></a></li>
          ))}
        </ul>
      ) : <div className="cc-empty"><b>ยังไม่มีบทความ</b>feed ตอบมาแต่ไม่มีบทความ</div>)}
      <Src today={s.today} asOf={t.as_of} status={t.status}>{t.source} · เปิดในแท็บใหม่</Src>
    </article>
  );
}

function BusinessSection({ s, onRetry }: { s: Summary; onRetry: () => void }) {
  const t = (id: string) => s.business.tiles.find((x) => x.id === id)!;
  return (
    <section className="cc-sec" aria-labelledby="h-biz">
      <div className="cc-sec-h"><h2 id="h-biz">ธุรกิจ</h2></div>
      <PkCard s={s} y={t('pk_sales_yesterday') as Tile<PkYesterday>} ytd={t('pk_ytd') as Tile<PkYtd>} />
      <FocusCard s={s} cd={t('focus_club_countdown') as Tile<Countdown>} members={t('focus_club_members')} />
      <ClassRoomCard s={s} t={t('classroom_students')} />
      <BlogCard s={s} t={t('blog_latest') as Tile<{ posts: Post[] }>} onRetry={onRetry} />
    </section>
  );
}

// ---------- team ----------

const CHIP: Record<string, [string, string]> = { 'needs-user': ['cc-need', 'รอเบ๊น'], failed: ['cc-fail', 'ติด'], sent: ['cc-sent', 'กำลังทำ'], done: ['cc-done', 'เสร็จ'] };

function TeamSection({ s, onRetry }: { s: Summary; onRetry: () => void }) {
  const t = s.team, d = t.data;
  const mins = t.as_of ? Math.round((Date.parse(s.generated_at) - Date.parse(t.as_of)) / 60_000) : 0;
  const g = d?.groups;
  const hidden = g ? [g.send_failed ? `ส่งไม่ออก ${g.send_failed}` : '', g.cancelled ? `ยกเลิก ${g.cancelled}` : '', g.other ? `อื่นๆ ${g.other}` : ''].filter(Boolean) : [];
  return (
    <section className="cc-sec" id="team" aria-labelledby="h-team">
      <div className="cc-sec-h"><h2 id="h-team">งานทีม</h2>{t.as_of && <span className="cc-when">ข้อมูลเมื่อ {when(t.as_of, s.today)}</span>}</div>
      <div className="cc-card">
        {t.status === 'not_connected' && <NotConnected title="งานทีม" why="ยังไม่มี snapshot งานทีมส่งมาที่หน้านี้ เมื่อเชื่อมแล้วจะอัปเดตทุก 10 นาที" />}
        {t.status === 'error' && <ErrorBanner text={`อ่าน snapshot งานทีมไม่สำเร็จ${t.note ? ` (${t.note})` : ''}`} onRetry={onRetry} />}
        {t.status === 'stale' && <div className="cc-banner cc-stale" role="status"><span><b>ข้อมูลเก่า</b> · ล่าสุดเมื่อ {when(t.as_of, s.today)} ({mins} นาทีก่อน) ปกติอัปเดตทุก 10 นาที</span></div>}
        {g && d && <div className={t.status === 'stale' ? 'cc-dim' : ''}>
          <div className="cc-stats" aria-label="จำนวนงานตามกลุ่ม">
            <div className="cc-stat"><b>{g.done_today}</b><span>เสร็จวันนี้</span></div>
            <div className="cc-stat cc-need"><b>{g.needs_user}</b><span>รอเบ๊น</span></div>
            <div className="cc-stat cc-fail"><b>{g.stuck}</b><span>ติด (7 วัน)</span></div>
            <div className="cc-stat"><b>{g.working}</b><span>กำลังทำ</span></div>
          </div>
          {(g.needs_user_old > 0 || hidden.length > 0) && <p className="cc-small">{g.needs_user_old > 0 ? `รอเบ๊นเก่ากว่า 7 วันอีก ${g.needs_user_old}` : ''}{g.needs_user_old > 0 && hidden.length ? ' · ' : ''}{hidden.length ? `ไม่แสดง: ${hidden.join(' · ')}` : ''}</p>}
          {d.rows.length ? (
            <ul className="cc-list">
              {d.rows.map((j) => {
                const [cls, word] = CHIP[j.status] ?? ['cc-sent', j.status];
                return (
                  <li key={j.job_id} id={`job-${j.job_id}`}>
                    <div className="cc-row-link">
                      <span className="cc-t"><b>{j.title ?? `งาน ${j.project ?? 'ไม่ระบุโปรเจกต์'}`}</b><small><span className="cc-jid">{j.job_id}</span>{j.project ? ` · ${j.project}` : ''} · {when(j.updated, s.today)}</small></span>
                      <span className={`cc-st ${cls}`}>{word}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <div className="cc-empty"><b>7 วันนี้ยังไม่มีงานทีม</b>เมื่อมีงานใหม่จะขึ้นที่นี่ภายใน 10 นาที</div>}
        </div>}
        <Src today={s.today} status={t.status}>{t.source}{d ? ` · ทั้งหมด ${d.total} งาน · เสร็จนับเฉพาะวันนี้ ติดนับ 7 วัน` : ''}</Src>
      </div>
    </section>
  );
}

// ---------- page ----------

function Skeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div className="cc-sec" key={i} aria-busy="true" aria-label="กำลังโหลด">
          <div className="cc-sk" style={{ height: 20, width: '40%', marginBottom: 10 }} />
          <div className="cc-card">
            <div className="cc-kpi">
              <div><div className="cc-sk" style={{ height: 12, width: '70%' }} /><div className="cc-sk" style={{ height: 28, width: '90%', marginTop: 6 }} /></div>
              <div><div className="cc-sk" style={{ height: 12, width: '70%' }} /><div className="cc-sk" style={{ height: 28, width: '90%', marginTop: 6 }} /></div>
            </div>
            <p className="cc-src">ที่มา: กำลังโหลด</p>
          </div>
        </div>
      ))}
    </>
  );
}

/** /command is the dashboard; /command?view=agents is the team's positions (own chunk, own fetch). One route, so main.tsx is untouched. */
export function CommandApp() {
  return new URLSearchParams(location.search).get('view') === 'agents' ? <AgentsEntry /> : <CommandHome />;
}

function CommandHome() {
  const { data, error, loading, load } = useSummary();
  useEffect(() => {
    document.title = 'Benz Command Center';
    const prev = document.body.style.background;
    document.body.style.background = '#000';
    return () => { document.body.style.background = prev; };
  }, []);
  // After the data arrives, honour a #job-… / #team link.
  useEffect(() => { if (data && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView(); }, [data]);
  const todayLabel = new Date().toLocaleDateString('th-TH', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <div className="cc">
      <header className="cc-top">
        <a className="cc-logo" href="/" aria-label="กลับหน้าแดชบอร์ด">BC</a>
        <div className="cc-grow">
          <h1><b>Benz</b> Command Center</h1>
          <p>อ่านอย่างเดียว · {todayLabel}</p>
        </div>
        <button className="cc-btn" type="button" onClick={load} disabled={loading} aria-label="โหลดข้อมูลใหม่">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
          {loading ? 'กำลังโหลด…' : 'รีเฟรช'}
        </button>
      </header>
      <main>
        {data?.local_dev && <p className="cc-local" role="note">ข้อมูลทดสอบในเครื่อง<span>เปิดผ่าน dev บน localhost (D1 ในเครื่อง) ไม่ใช่ข้อมูลจริงของ production</span></p>}
        {error && !data && <div style={{ marginTop: 16 }}><ErrorBanner text={error.startsWith(SESSION_EXPIRED) ? error : `โหลดข้อมูลไม่ได้ · เช็กอินเทอร์เน็ตแล้วกดลองใหม่ ถ้ายังไม่ได้ ให้โหลดหน้านี้ใหม่เพื่อล็อกอินอีกครั้ง (${error})`} onRetry={load} /></div>}
        {error && data && <div style={{ marginTop: 16 }}><div className="cc-banner cc-stale" role="status"><span><b>รีเฟรชไม่สำเร็จ</b> · แสดงข้อมูลเมื่อ {when(data.generated_at, data.today)} ({error})</span></div></div>}
        {!data && !error && <Skeleton />}
        {data && <>
          <TodoSection s={data} />
          <BusinessSection s={data} onRetry={load} />
          <TeamSection s={data} onRetry={load} />
        </>}
        <section className="cc-sec" aria-label="ทีม Agent">
          <div className="cc-card">
            <ul className="cc-list">
              <li>
                <a className="cc-row-link" href="/command?view=agents">
                  <span className="cc-t"><b>ทีม Agent</b><small>ดูทุกตำแหน่ง ตำแหน่งที่ว่าง และข้อเสนอที่รอเบ๊นอนุมัติ</small></span>
                  <Chev />
                </a>
              </li>
            </ul>
          </div>
        </section>
        <section className="cc-jarvis" aria-label="ช่องสั่งงาน Jarvis ยังไม่เปิดใช้" aria-disabled="true">
          <h3>Jarvis <span className="cc-tag cc-soon">เร็วๆ นี้</span></h3>
          <p>ยังสั่งงานจากหน้านี้ไม่ได้ ตอนนี้หน้านี้อ่านอย่างเดียว</p>
          <div className="cc-fake" aria-hidden="true">ยังไม่เปิดใช้</div>
        </section>
      </main>
    </div>
  );
}
