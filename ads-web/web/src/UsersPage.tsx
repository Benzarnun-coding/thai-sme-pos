// "ผู้ใช้": who can use the dashboard and what they may change. Owners only. Adding someone here also lets
// them log in when the Cloudflare Access sync is set up; otherwise the page says what to add by hand.

import { useEffect, useState } from 'react';
import { api, type Role, type UsersData } from './api.ts';
import { when } from './fmt.ts';
import { useUi } from './ui.tsx';

const ROLE_LABEL: Record<Role, string> = { owner: 'เจ้าของ', admin: 'ผู้ดูแล', costs: 'แก้ต้นทุน', viewer: 'ดูอย่างเดียว' };
const ROLE_HELP: Record<Role, string> = {
  owner: 'ทำได้ทุกอย่าง รวมถึงเพิ่ม/ลบผู้ใช้และปรับสิทธิ์',
  admin: 'เปิด/หยุดแอด ปรับงบ แก้กฎ ย้ายกลุ่ม ตั้งค่า ต้นทุน — ยกเว้นจัดการผู้ใช้',
  costs: 'ดูได้ทุกหน้า แก้ได้เฉพาะต้นทุน สินค้า/โปร ดึงชีต และอัปโหลดไฟล์ Page365',
  viewer: 'ดูได้อย่างเดียว',
};
const ROLES: Role[] = ['owner', 'admin', 'costs', 'viewer'];

export function UsersPage() {
  const { toast, confirm } = useUi();
  const [data, setData] = useState<UsersData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: '', role: 'admin' as Role, note: '' });

  const load = () => api.users().then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function run(label: string, fn: () => Promise<{ sync?: { ok: boolean; error?: string } | null }>) {
    setBusy(true);
    try {
      const r = await fn();
      toast(r.sync === null || r.sync === undefined ? label : r.sync.ok ? `${label} · ซิงก์ Cloudflare Access แล้ว` : `${label} · ซิงก์ Cloudflare ไม่สำเร็จ: ${r.sync.error}`, r.sync && !r.sync.ok ? 'bad' : 'ok');
      await load();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }

  const access = data?.access ?? null;
  return (
    <div className="users">
      <div className="ideas-intro">
        <div>
          <h2>ผู้ใช้และสิทธิ์</h2>
          <p className="muted small">ใครเข้าเว็บนี้ได้และแก้อะไรได้บ้าง · เฉพาะเจ้าของเท่านั้นที่เห็นหน้านี้ · การเข้าเว็บต้องผ่าน Cloudflare Access (อีเมล + รหัสครั้งเดียว) {access?.configured ? '— รายชื่อใน Access ซิงก์จากหน้านี้ให้อัตโนมัติ' : '— ตอนนี้ต้องเพิ่มอีเมลใน Cloudflare Access เองด้วย (ดูด้านล่าง)'}</p>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {!data && !error && <div className="skeleton" style={{ height: 240 }} />}
      {data && (
        <>
          <section className="card">
            <h2>เพิ่มผู้ใช้</h2>
            <div className="row gap wrap" style={{ alignItems: 'flex-end' }}>
              <label style={{ flex: '2 1 240px' }}>อีเมล<input type="email" value={form.email} placeholder="name@example.com" onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label style={{ flex: '1 1 160px' }}>สิทธิ์
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </label>
              <label style={{ flex: '2 1 200px' }}>ชื่อ/หมายเหตุ<input value={form.note} placeholder="เช่น แอดมินเพจ" onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
              <button className="primary" disabled={busy || !form.email.trim()} onClick={() => run(`เพิ่ม ${form.email.trim()} แล้ว`, async () => { const r = await api.addUser({ email: form.email.trim(), role: form.role, note: form.note }); setForm({ email: '', role: 'admin', note: '' }); return r; })}>เพิ่ม</button>
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>{ROLE_HELP[form.role]}</p>
          </section>

          <section className="card table-card">
            <div className="table-card-head"><h2>ผู้ใช้ทั้งหมด <span className="muted small">{data.owners.length + data.users.length} คน</span></h2></div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>อีเมล</th><th>สิทธิ์</th><th>ชื่อ/หมายเหตุ</th><th>เพิ่มเมื่อ</th><th /></tr></thead>
                <tbody>
                  {data.owners.map((e) => (
                    <tr key={e}>
                      <td><b>{e}</b>{e === data.me && <span className="muted small"> (คุณ)</span>}</td>
                      <td><span className="badge ok-badge">เจ้าของ</span> <span className="muted small">ตั้งไว้ในระบบ</span></td>
                      <td className="muted small">เจ้าของหลัก แก้จากหน้านี้ไม่ได้</td>
                      <td />
                      <td />
                    </tr>
                  ))}
                  {data.users.map((u) => (
                    <tr key={u.email}>
                      <td><b>{u.email}</b>{u.email === data.me && <span className="muted small"> (คุณ)</span>}</td>
                      <td>
                        <select value={u.role} disabled={busy} title={ROLE_HELP[u.role]} onChange={(e) => run(`เปลี่ยนสิทธิ์ ${u.email} เป็น ${ROLE_LABEL[e.target.value as Role]}`, () => api.updateUser(u.email, { role: e.target.value as Role }))}>
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                      </td>
                      <td className="small">{u.note || <span className="muted">–</span>}</td>
                      <td className="small muted">{when(u.added_at)} · {u.added_by}</td>
                      <td className="num">
                        <button className="ghost small danger" disabled={busy || u.email === data.me} onClick={async () => {
                          if (!(await confirm({ title: `ลบ ${u.email}?`, body: access?.configured ? 'จะถูกลบออกจาก Cloudflare Access ด้วย เข้าเว็บไม่ได้อีก' : 'สิทธิ์ในเว็บจะหายไป (ยังต้องลบอีเมลใน Cloudflare Access เองเพื่อกันไม่ให้ล็อกอิน)', confirmLabel: 'ลบ', tone: 'danger' }))) return;
                          run(`ลบ ${u.email} แล้ว`, () => api.removeUser(u.email));
                        }}>ลบ</button>
                      </td>
                    </tr>
                  ))}
                  {!data.users.length && <tr><td colSpan={5} className="muted small">ยังไม่มีผู้ใช้อื่นนอกจากเจ้าของ</td></tr>}
                </tbody>
              </table>
            </div>
            {data.legacy_cost_editors.length > 0 && <p className="muted small" style={{ padding: '0 18px 12px' }}>รายการ "แก้ได้เฉพาะต้นทุน" เดิมในหน้าตั้งค่า: {data.legacy_cost_editors.join(', ')} — ยังใช้ได้ แต่ควรเพิ่มในหน้านี้แทน</p>}
          </section>

          <section className="card">
            <h2>Cloudflare Access (ใครล็อกอินได้)</h2>
            {!access?.configured ? (
              <>
                <p className="muted small">ยังไม่ได้ต่อกับ Cloudflare: การเพิ่ม/ลบผู้ใช้ที่นี่คุมแค่สิทธิ์ในเว็บ ส่วนการล็อกอินต้องไปเพิ่ม/ลบอีเมลในนโยบาย "PkJeans team" ของ Zero Trust เอง</p>
                <p className="muted small">ให้ซิงก์อัตโนมัติ: สร้าง API token ใน Cloudflare (My Profile → API Tokens → Create Token → Custom: Account · Access: Apps and Policies · Edit) แล้วรัน <code>npx wrangler secret put CF_API_TOKEN</code> และใส่ <code>CF_ACCESS_POLICY_ID</code> ใน wrangler.jsonc</p>
              </>
            ) : access.error ? <p className="small warn">{access.error}</p> : (
              <>
                <p className="muted small">นโยบาย "{access.policy_name}" มี {access.in_access.length} อีเมล{access.missing.length || access.extra.length ? '' : ' · ตรงกับรายชื่อในเว็บแล้ว'}</p>
                {access.missing.length > 0 && <p className="small warn">อยู่ในเว็บแต่ยังล็อกอินไม่ได้: {access.missing.join(', ')}</p>}
                {access.extra.length > 0 && <p className="small warn">ล็อกอินได้แต่ไม่อยู่ในเว็บ (กดซิงก์เพื่อเอาออก): {access.extra.join(', ')}</p>}
                <button className="ghost" disabled={busy || (!access.missing.length && !access.extra.length)} onClick={() => run('ซิงก์รายชื่อไป Cloudflare Access แล้ว', async () => { await api.syncAccess(); return { sync: null }; })}>ซิงก์ไป Cloudflare Access ตอนนี้</button>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
