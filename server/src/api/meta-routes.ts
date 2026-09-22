/**
 * Public pages and callbacks Meta needs before an app can go Live:
 *   GET  /privacy                 privacy policy (Thai + English)
 *   GET  /data-deletion           how to delete your data, and status lookup by code
 *   POST /api/meta/data-deletion  Data Deletion Request callback (signed_request)
 *   POST /api/meta/deauthorize    Deauthorize callback (signed_request)
 * The same URLs are what go into the app's settings in developers.facebook.com.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { deletionStatus, eraseUserData, parseSignedRequest } from '../auth/meta-compliance.js';

const APP_NAME = process.env.LOOPDESK_APP_NAME ?? 'LoopDesk';
const CONTACT = process.env.LOOPDESK_CONTACT_EMAIL ?? 'privacy@example.com';

function publicBase(req: FastifyRequest) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
  return `${proto}://${req.headers.host}`;
}

const page = (title: string, body: string) => `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · ${APP_NAME}</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.65;color:#1B2033}h1{font-size:26px}h2{font-size:18px;margin-top:28px}code{background:#EEF0F7;padding:1px 5px;border-radius:4px}.en{color:#4A5170}small{color:#6E7490}</style>
</head><body>${body}<hr><small>${APP_NAME} · ติดต่อ / contact: <a href="mailto:${CONTACT}">${CONTACT}</a></small></body></html>`;

export function registerMetaRoutes(app: FastifyInstance, db: Db) {
  app.get('/privacy', async (req, reply) => {
    const base = publicBase(req);
    reply.type('text/html; charset=utf-8');
    return page('นโยบายความเป็นส่วนตัว', `
<h1>นโยบายความเป็นส่วนตัว <span class="en">/ Privacy Policy</span></h1>
<p>${APP_NAME} เป็นระบบการตลาดอัตโนมัติสำหรับร้านค้า ใช้โดยเจ้าของร้านและทีมงานของร้านนั้นเท่านั้น ไม่ได้ให้บริการแก่ผู้บริโภคทั่วไป</p>
<p class="en">${APP_NAME} is a marketing automation system for a merchant. It is used by the shop owner and their team only; it is not a consumer service.</p>
<h2>ข้อมูลที่เราเก็บ <span class="en">/ What we collect</span></h2>
<ul>
<li><b>บัญชีที่คุณเชื่อมต่อ</b>: รหัสเพจ/บัญชีโฆษณา ชื่อ รูปโปรไฟล์ และ access token ที่คุณอนุญาตผ่านหน้า Login ของ Facebook — token ถูกเข้ารหัส (AES-256-GCM) ขณะจัดเก็บ และไม่แสดงในหน้าจอใด ๆ</li>
<li><b>ข้อมูลเพจและโฆษณา</b>: โพสต์ ยอด reach/engagement สถิติแอด (impressions, clicks, spend, conversations) เพื่อคำนวณผลลัพธ์และวางแผนคอนเทนต์</li>
<li><b>ชื่อของผู้ที่กดเชื่อมต่อ</b> เพื่อบันทึกว่าใครเป็นผู้อนุญาต</li>
</ul>
<p class="en">Connected accounts (Page / ad account ids, names, avatars and the access tokens you grant via Facebook Login — tokens are encrypted at rest with AES-256-GCM and never shown on screen); Page and ads data (posts, reach/engagement, ad insights such as impressions, clicks, spend, conversations) used to measure results and plan content; the name of the person who connected.</p>
<h2>สิ่งที่เราไม่ทำ <span class="en">/ What we do not do</span></h2>
<ul><li>ไม่ขายหรือแบ่งปันข้อมูลให้บุคคลที่สาม</li><li>ไม่อ่านหรือเก็บข้อความส่วนตัวของลูกค้า (ระบบไม่ขอสิทธิ์ข้อความ)</li><li>ไม่โพสต์หรือใช้เงินโฆษณาโดยไม่มีคนกดอนุมัติในคิวอนุมัติ</li></ul>
<p class="en">We do not sell or share data with third parties; we do not read or store private messages (no messaging permission is requested); nothing is posted and no ad spend happens without a person approving it in the approval queue.</p>
<h2>การเก็บรักษาและการลบ <span class="en">/ Retention and deletion</span></h2>
<p>ข้อมูลถูกเก็บไว้ตราบเท่าที่บัญชียังเชื่อมต่ออยู่ เมื่อกด "ยกเลิกการเชื่อมต่อ" ในระบบ หรือถอนสิทธิ์แอปใน Facebook token และข้อมูลส่วนบุคคลจะถูกลบทันที ดูวิธีขอลบข้อมูลได้ที่ <a href="${base}/data-deletion">${base}/data-deletion</a></p>
<p class="en">Data is kept while the account stays connected. Disconnecting in the app, or removing the app in your Facebook settings, deletes the token and personal data immediately. See <a href="${base}/data-deletion">${base}/data-deletion</a>.</p>
<h2>AI</h2>
<p>ระบบใช้โมเดลภาษา (Anthropic Claude) เพื่อร่างโพสต์และแผนโฆษณาจากข้อมูลของร้าน ข้อมูลที่ส่งไปคือสถิติเพจ/แอดและข้อมูลสินค้า ไม่มีข้อมูลส่วนบุคคลของลูกค้า</p>
<p class="en">The system uses a language model (Anthropic Claude) to draft posts and ad plans from the shop's own data — Page/ads statistics and product data, never customers' personal data.</p>`);
  });

  app.get('/data-deletion', async (req, reply) => {
    const q = req.query as { code?: string };
    const st = q.code ? await deletionStatus(db, q.code) : null;
    reply.type('text/html; charset=utf-8');
    return page('การลบข้อมูล', `
<h1>ขอลบข้อมูลของคุณ <span class="en">/ Data deletion</span></h1>
${q.code ? (st ? `<p><b>คำขอ <code>${st.code}</code></b>: ${st.status === 'done' ? 'ลบเรียบร้อยแล้ว' : 'ได้รับแล้ว กำลังดำเนินการ'} (${st.kind === 'deletion' ? 'ลบข้อมูล' : 'ถอนสิทธิ์'}) — token ${st.details?.grants ?? 0} รายการ และบัญชีที่เชื่อม ${st.details?.connections ?? 0} รายการ ถูกลบเมื่อ ${st.completed_at ?? st.requested_at}</p><p class="en">Request <code>${st.code}</code>: ${st.status === 'done' ? 'completed' : 'received'} — ${st.details?.grants ?? 0} token(s) and ${st.details?.connections ?? 0} connection(s) erased.</p>` : `<p>ไม่พบคำขอรหัส <code>${q.code}</code> <span class="en">/ No request with that code.</span></p>`) : ''}
<h2>วิธีที่ 1: ในระบบ <span class="en">/ In the app</span></h2>
<p>ไปที่ การตลาด → บัญชีที่เชื่อมต่อ → ยกเลิกการเชื่อมต่อ ระบบลบ token และข้อมูลส่วนบุคคลทันที</p>
<h2>วิธีที่ 2: จาก Facebook <span class="en">/ From Facebook</span></h2>
<p>Facebook → การตั้งค่า → แอปและเว็บไซต์ → ${APP_NAME} → ลบ Facebook จะแจ้งเรามาอัตโนมัติ และเราจะลบข้อมูลของคุณทันที คุณจะได้รหัสยืนยันสำหรับตรวจสอบสถานะที่หน้านี้</p>
<p class="en">Settings → Apps and Websites → ${APP_NAME} → Remove. Facebook notifies us automatically, we erase your data at once and you receive a confirmation code to check here.</p>
<h2>วิธีที่ 3: อีเมล <span class="en">/ Email</span></h2>
<p>ส่งอีเมลถึง <a href="mailto:${CONTACT}">${CONTACT}</a> พร้อมชื่อเพจหรือบัญชีโฆษณา เราจะลบให้ภายใน 7 วัน</p>
<form method="get" style="margin-top:24px"><label>ตรวจสอบสถานะด้วยรหัสยืนยัน / Check status by code: <input name="code" value="${q.code ?? ''}" placeholder="เช่น 3f9a1c2b4d5e"></label> <button>ตรวจสอบ</button></form>`);
  });

  /** Meta → us: the user asked Facebook to delete their data held by this app. */
  app.post('/api/meta/data-deletion', async (req, reply) => {
    const secret = process.env.FB_APP_SECRET;
    const body = (req.body ?? {}) as { signed_request?: string };
    if (!secret || !body.signed_request) return reply.code(400).send({ error: 'missing signed_request or app secret' });
    const payload = parseSignedRequest(body.signed_request, secret);
    if (!payload) return reply.code(400).send({ error: 'bad signature' });
    const r = await eraseUserData(db, 'facebook', payload.user_id, 'deletion');
    return { url: `${publicBase(req)}/data-deletion?code=${r.code}`, confirmation_code: r.code };
  });

  /** Meta → us: the user removed the app from their account. */
  app.post('/api/meta/deauthorize', async (req, reply) => {
    const secret = process.env.FB_APP_SECRET;
    const body = (req.body ?? {}) as { signed_request?: string };
    if (!secret || !body.signed_request) return reply.code(400).send({ error: 'missing signed_request or app secret' });
    const payload = parseSignedRequest(body.signed_request, secret);
    if (!payload) return reply.code(400).send({ error: 'bad signature' });
    const r = await eraseUserData(db, 'facebook', payload.user_id, 'deauthorize');
    return { ok: true, confirmation_code: r.code };
  });
}
