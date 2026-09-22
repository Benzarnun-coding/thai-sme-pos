# ชุดยื่น Meta App Review (และ partner registration ของ Shopee / TikTok)

เป้าหมาย: ให้ปุ่ม "เชื่อมต่อ Facebook" ใน LoopDesk ทำงานกับ **ร้านไหนก็ได้** แบบเดียวกับ BigSeller ไม่ใช่แค่เพจของ admin

ระบบมีสิ่งที่ Meta บังคับครบแล้ว (ในโค้ด):

| สิ่งที่ Meta ต้องการ | ที่อยู่ในระบบ | ใส่ในหน้า App Settings ที่ช่อง |
|---|---|---|
| Privacy Policy URL | `GET /privacy` (ไทย + อังกฤษ) | Basic → Privacy Policy URL |
| User data deletion | `GET /data-deletion` (วิธีลบ + ตรวจสถานะด้วยรหัส) และ `POST /api/meta/data-deletion` (callback แบบ `signed_request`) | Basic → User data deletion → Data deletion callback URL |
| Deauthorize callback | `POST /api/meta/deauthorize` | Facebook Login → Settings → Deauthorize callback URL |
| Valid OAuth redirect | `GET /api/oauth/facebook/callback` | Facebook Login → Settings → Valid OAuth Redirect URIs |
| Token ปลอดภัย | เข้ารหัส AES-256-GCM ขณะจัดเก็บ ไม่ส่งออกทาง API ยกเลิกแล้วลบทันที | (ตอบในแบบฟอร์ม Data Handling) |

ตั้งค่า env บนเซิร์ฟเวอร์จริง: `FB_APP_ID`, `FB_APP_SECRET`, `API_BASE_URL=https://api.yourdomain.com`, `PUBLIC_URL=https://api.yourdomain.com`, `LOOPDESK_CONTACT_EMAIL`, `LOOPDESK_APP_NAME`, `TOKEN_ENC_KEY` (64 hex)

## 1. ลำดับที่ Meta

1. **สร้าง Meta App** ที่ developers.facebook.com → Create App → Use case "Other" → Type "Business" → ผูกกับ Business Portfolio ของบริษัท
2. **เพิ่ม Facebook Login for Business** → ใส่ Redirect URI, Deauthorize URL, Data Deletion URL ตามตารางบน
3. **Business Verification** (Business Settings → Security Center) เอกสาร: หนังสือรับรองบริษัท (ไม่เกิน 6 เดือน), ที่อยู่ตรงกับเอกสาร, เบอร์โทร/อีเมลโดเมนบริษัท, เว็บไซต์ที่มีชื่อบริษัทและนโยบายความเป็นส่วนตัว — ใช้เวลา 1–5 วันทำการ
4. **ทดสอบใน Development mode** กับเพจ Climax (admin ได้ทุกสิทธิ์โดยไม่ต้อง review) อัดวิดีโอสาธิตระหว่างนี้
5. **ยื่น App Review** ทีละชุดสิทธิ์ (ดูข้อ 2) แนบวิดีโอ + คำอธิบาย + บัญชีทดสอบ
6. ผ่านแล้ว → **สลับ App Mode เป็น Live** → ร้านอื่นกดเชื่อมต่อได้ทันที

## 2. คำอธิบายรายสิทธิ์ (ภาษาอังกฤษ ใช้วางในฟอร์ม)

ยื่นเป็น 2 รอบ: รอบแรก "อ่าน" (เฟส 1–2) รอบสอง "โพสต์/แอด" (เฟส 3–4) จะผ่านง่ายกว่ายื่นทีเดียว

**pages_show_list** (ไม่ต้อง review)
> Lists the Pages the user manages so they can pick which Page to connect to LoopDesk during onboarding.

**pages_read_engagement**
> LoopDesk reads the connected Page's published posts and their engagement (reach, reactions, comments, shares) to show the merchant which content performed best and to let the AI writer learn the Page's writing style. Data is shown only to the Page's own admins inside the app. Shown in the video at 0:40–1:10 (Marketing → Posts table).

**read_insights**
> Reads Page-level insights (reach, followers) for the merchant's daily report. Used only for the connected Page and displayed to its admins. Video 1:10–1:30 (Report screen, "ผู้ติดตาม" tile).

**ads_read**
> Reads ad insights (impressions, clicks, spend, messaging conversations, purchases) for the merchant's own ad account to compute ROAS and cost per conversation, and to let the AI analyst propose which ads to scale or pause. Proposals are only proposals — a human approves them in the approval queue. Video 1:30–2:10.

**pages_manage_posts** (รอบสอง)
> Publishes a post to the connected Page **only after** a human clicks Approve in the approval queue. The video shows the full path: AI drafts → reviewer checks prices/sizes → owner approves → post appears on the Page. No post is ever published automatically. Video 2:10–3:00.

**ads_management** (รอบสอง)
> Creates an ad from an approved post and adjusts daily budgets within a cap the merchant sets. Every creation or budget change is a proposal that a human approves; the app enforces a daily and monthly spend ceiling. Video 3:00–3:40.

**business_management** (รอบสอง ถ้าต้องอ่านบัญชีโฆษณาผ่าน Business)
> Needed to list the ad accounts inside the merchant's Business portfolio so they can choose which account to connect.

## 3. สคริปต์วิดีโอสาธิต (3–4 นาที, บันทึกหน้าจอ, ไม่ต้องมีเสียงแต่ควรมี caption อังกฤษ)

| เวลา | ฉาก | สิ่งที่ต้องเห็นชัด |
|---|---|---|
| 0:00 | เปิด LoopDesk หน้า การตลาด → บัญชีที่เชื่อมต่อ | ยังไม่มีบัญชี |
| 0:10 | กด "เชื่อมต่อ Facebook" → หน้า Login ของ Facebook → หน้า permissions | รายการสิทธิ์ที่ขอ ตรงกับที่ยื่น |
| 0:30 | กลับมาที่ระบบ → "เลือกบัญชีที่จะเชื่อม" → ติ๊กเพจ + บัญชีโฆษณา → เชื่อมต่อ | ชื่อเพจปรากฏในรายการ |
| 0:40 | โพสต์ที่ผ่านมา + engagement (pages_read_engagement) | ตารางโพสต์มี reach/engaged |
| 1:10 | หน้ารายงาน: ผู้ติดตาม/reach (read_insights) | tile ผู้ติดตาม |
| 1:30 | ตารางแอด ROAS ฿/ทัก (ads_read) และนักวิเคราะห์เสนอ "ควรพัก/เพิ่มงบ" → ไปคิวอนุมัติ | มีปุ่มอนุมัติ/ไม่อนุมัติ |
| 2:10 | นักเขียนร่างโพสต์ → ผู้ตรวจ "ผ่าน" → คิวอนุมัติ → กดอนุมัติ → โพสต์ขึ้นเพจจริง (pages_manage_posts) | เปิดเพจให้เห็นโพสต์ใหม่ |
| 3:00 | อนุมัติแผนแอด → แอดถูกสร้างใน Ads Manager ภายในเพดานงบ (ads_management) | เปิด Ads Manager ให้เห็นแอด |
| 3:40 | ยกเลิกการเชื่อมต่อ → token ถูกลบ · เปิด /data-deletion | จบ |

เตรียม **บัญชีทดสอบ** ให้ผู้ตรวจ: สร้าง Test User ใน App Roles หรือให้ login ของระบบ (URL + user/pass) ที่เข้าแล้วเห็นเพจทดสอบที่เชื่อมไว้แล้ว

## 4. เอกสารที่ต้องเตรียม (ทุกแพลตฟอร์ม)

| | Meta Business Verification | Shopee Open Platform (partner) | TikTok Shop Partner Center / TikTok for Business |
|---|---|---|---|
| นิติบุคคล | หนังสือรับรอง ≤ 6 เดือน | หนังสือรับรอง + ภ.พ.20 | หนังสือรับรอง + บัตรกรรมการ |
| ตัวตนผู้ยื่น | บัตรประชาชนกรรมการ (บางกรณี) | บัตรประชาชน | บัตรประชาชน |
| เว็บไซต์ | โดเมนบริษัท + privacy policy | เว็บไซต์/แอปที่อธิบายบริการ | เว็บไซต์ + privacy policy |
| อีเมล | อีเมลโดเมนบริษัท | อีเมลบริษัท | อีเมลบริษัท |
| อธิบายแอป | use case + วิดีโอ | ประเภทแอป ERP/Marketing + คำอธิบาย | use case + วิดีโอ + รายการ API ที่ใช้ |
| เวลารอ | 1–5 วัน (BV) + 2–10 วัน/รอบ (review) | 1–3 สัปดาห์ | 2–4 สัปดาห์ |

หลังผ่าน: Shopee ให้ partner_id + partner_key → ร้านกด authorize ผ่าน URL ของ Shopee · TikTok ให้ app_key + app_secret → ร้าน authorize ผ่าน Partner Center ทั้งสองอย่างเสียบเข้า `server/src/auth/providers.ts` ที่เตรียมช่องไว้แล้ว (`implemented: false` → `true`)
