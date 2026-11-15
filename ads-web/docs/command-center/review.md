# Benz Command Center: review ของ spec + design (justice, 2026-11-15)

ขอบเขต: ตรวจเอกสาร `spec.md`, `design.md`, `mockup.html`, `mockup-390.png` เทียบ brief ของเบ๊น และเทียบโค้ดจริงใน worktree นี้ + worktree `pk-sales-target-100m` ยังไม่มีโค้ดให้รัน test ไม่ได้ทดสอบ Access จริง

## คำตัดสิน: Go with risks

courage เริ่ม S0 ถึง S4 (rebase, auth, migration + POST jobs, business tiles, RSS) ได้ทันที
S5 (team + todo) และ S6 (หน้าเว็บ) **ต้องรอ** ให้ wisdom/harmony แก้ B1 + B2 และเบ๊นตอบ D1 ถึง D3 ก่อน
ก่อน deploy ต้องผ่านด่าน B3 (ทดสอบพฤติกรรม Access จริง) ผลนี้ไม่ใช่สิทธิ์ deploy

## สิ่งที่ตรวจแล้วผ่าน

- brief ครบ: 3 กล่อง, auth, snapshot, การพึ่ง branch (spec §3 ระบุ `7602631` + parent `ce3c318` ถูก: ตรวจ git แล้ว `ce3c318` เป็น ancestor, ทั้งคู่ต่อจาก `e1d28a1`, ยังอยู่เฉพาะ branch `feat/pk-sales-target-100m-20261115`)
- ไม่มีตัวเลขธุรกิจจริงปลอมในดีไซน์/mockup: ทุกค่าเป็น placeholder หรือค่าที่คำนวณจากวันที่ (16 วัน, 318 วัน, 87.1% = 318/365) mockup มี tag "ตัวอย่าง" และสเปกบอกชัดว่าห้ามอยู่บน production ช่อง Jarvis ไม่มี `<input>`
- `focus_club_members` / `classroom_students` คืน `not_connected` + `data: null` ไม่ใช่ 0 (spec D4, §6.7, test §12.3.5 และ 12.3.6)
- grep secret ใน spec/design/mockup: ไม่พบ token, aud จริง, client id/secret, รหัสยาว มีแต่ชื่อตัวแปรและ placeholder `<จาก env ของสคริปต์>`
- spec §5.1 ตรงกับ `worker/auth.ts` จริง (RS256, JWKS cache 1 ชม., aud array, exp, iss, `email ?? 'unknown'`, dev bypass เฉพาะ localhost)
- โค้ด YTD ตรงกับ spec: `ytdRevenue()` (worker/index.ts บรรทัด ~1731 ใน branch เป้า 100M) เป็นฟังก์ชันภายในไม่ได้ export ตามที่ spec ว่า, `ytdStatus()` ใน goal.ts ส่ง field ครบตาม `PkYtd`, example JSON สอดคล้อง pace/gap/projected
- migration: ทุก branch/worktree บนเครื่องจบที่ 0054 ไม่มี 0055 (ยังต้องเช็ก remote ตอน build ตามที่ spec เขียนไว้)
- ตาราง/index ที่ spec อ้างมีจริง: `p365_uploads`, `p365_orders (date, campaign_id)`, `proposals_status`, `proposals.message_id`, `bkkDate`, `salesDigest`; `#sales` และ `#history` เป็น hash ของแท็บที่มีใน `App.tsx` จริง
- free plan: ไม่เรียก Meta, subrequest ~0 ถึง 2, D1 ~6 query, YTD มี cache ตามลายเซ็น upload, RSS อ่านแบบ stream หยุดที่ 3 item (ดูข้อ M7 สำหรับข้อสังเกต)

## ตารางประเด็น

ระดับ: blocker = ห้ามเริ่มชิ้นที่ระบุจนกว่าจะแก้ / major = ต้องแก้ก่อน merge / minor = แก้ได้ตอน build
ผู้ตัดสิน: **เบ๊น** = ต้องให้เบ๊นตัดสิน / **ทีม** = ทีมแก้เองได้

| # | ระดับ | ไฟล์ / หัวข้อ | ปัญหา | ข้อเสนอแก้ | ผู้ตัดสิน |
|---|---|---|---|---|---|
| B1 | blocker (S5, S6) | spec §6.4, §6.5 `job_needs_user` | spec ตั้งใจให้ "needs-user ทุกอายุ" ขึ้นใน todo และบอกว่ามี 2 รายการ แต่ของจริงใน `orca-pilot/docs/team/jobs` ตอนนี้ **13 ไฟล์ status needs-user** (ส่วนใหญ่ลงวันที่ 20 ถึง 23 ต.ค. และ 11 ถึง 13 พ.ย.) กล่อง "วันนี้ต้องทำ" จะมีงานค้างเก่า 13 แถวทันทีที่เปิด ขัดกับเป้า "รู้ใน 10 วินาที" และเบ๊นจะเลิกเชื่อกล่อง | (ก) todo แสดง needs-user ที่ `updated` ภายใน N วัน (เสนอ 7) ส่วนเก่ากว่านั้นรวมเป็นแถวเดียว "มีงานรอตัดสินเก่ากว่า 7 วันอีก X เรื่อง" ลิงก์ไปกล่องงานทีม (ข) เก็บเลข 13 ไว้ใน `counts` ตามเดิม (ค) แก้ตัวเลข "2" ใน spec และใน example ให้ตรงของจริง หรือเลิกอ้างเลข | เบ๊น (เลือก N และว่าจะให้ต้อง clear ของเก่าก่อนไหม) |
| B2 | blocker (S5, S6) | design §4 กล่องงานทีม vs spec §4.3, §6.4 | design กับ spec ไม่ตรงกัน 5 จุด: (1) design แสดง "4 counters เสร็จ / รอเบ๊น / ติด / กำลังทำ นับเฉพาะวันนี้" แต่ spec `counts` นับทุกวันแบบ status ดิบ และไม่มีการกรอง "วันนี้" (2) design ต้องการรายการล่าสุด ≤ 5 พร้อม chip "เสร็จ" แต่ spec `active` ไม่มี job ที่ done เลย (3) design ใช้ "กำลังทำ" แต่ไม่มี mapping จาก status จริง (`sent`? `working` ไม่อยู่ในรายการ status ที่ snapshot ส่ง) และ "ติด" = `failed` + `send-failed` หรือไม่ ไม่ได้กำหนด ในขณะที่ send-failed เก่ามี 97 รายการ (4) design ใช้ "ตัดสิน job: {หัวข้อ}" แต่ spec ไม่มี `title` (Q2 ยังไม่ตอบ) mockup ก็เขียน `[หัวข้อตัวอย่าง]` (5) stale ของ design = 30 นาที, spec = 25 นาที | กำหนดตาราง mapping เดียวใน spec: status ดิบ → กลุ่ม (เสร็จ / รอเบ๊น / ติด / กำลังทำ / อื่นๆ) แล้วให้ API ส่ง `groups` ที่คำนวณแล้ว (รวมนับ "วันนี้" ตามเวลาไทยจาก `updated`) และเพิ่ม `recent` (≤ 5 รายการล่าสุดทุก status) ถ้าไม่มี title ให้ design ใช้ "งาน {project} · {job_id}" แทน และแก้ mockup เป็นแบบเดียวกัน ตกลง stale = 25 นาทีและแก้ทั้งสองไฟล์ | ทีม (wisdom + harmony) ส่วน Q2 เบ๊นตอบ |
| B3 | blocker ก่อน deploy (ไม่บล็อก build) | spec §5.5, §12.6 | สเปกยืนยันกฎ Access 3 ข้อโดยไม่มีหลักฐานทดสอบ: (ก) path ไม่มี `*` ครอบ subpath และ `/command/` ที่ลงท้ายด้วย slash, (ข) app ที่ path เจาะจงกว่าชนะ, (ค) JWT ของ service token มี `common_name` + `sub: ''` และไม่มี email test §12.1 ข้อ 5 สร้าง JWT เองตามสมมติฐานนี้ ถ้าจริงต่างไป (เช่น service token มี field อื่น) endpoint `/jobs` จะ 401 ตลอดโดย test เขียวหมด | ต่อ §12.6 เพิ่ม: เปิด `/command/`, `/command/x`, `/api/command/summary`, `/api/command/jobs/x` ตอนไม่ล็อกอิน ต้องโดน Access ทุกตัว; ใช้ service token จริงยิง `/api/command/jobs` ด้วย Worker ที่ log เฉพาะ**ชื่อ** claim (ไม่ log ค่า) เพื่อยืนยันว่า `common_name`/`sub` ตรงสมมติฐาน ถ้า path ไม่ครอบ subpath ให้เพิ่ม destination `/command/*` และ `/api/command/*` เป็นตัวเพิ่ม | ทีม (ทดสอบตอนเบ๊นสร้าง app) |
| M1 | major | spec §5.5 vs การนำทาง | เบ๊นอยู่ใน 3 Access app บน hostname เดียวกัน (command, main, GoSell/assets) และ todo มีลิงก์ไป `/#sales`, `/#history` (อยู่ใน app หลัก) cookie `CF_Authorization` เป็นต่อ hostname spec ไม่ได้ทดสอบการกระโดดไป-กลับระหว่าง app (อาจเด้ง OTP ซ้ำ หรือ JS ใน `/assets` เด้ง 302 ทำหน้าขาว) §12.6 ข้อ 1 ตรวจแค่โหลดครั้งแรก | เพิ่มขั้นทดสอบ: login `/command` → กดลิงก์ไป `/#sales` → กลับ `/command` → กดรีเฟรช ทำทั้งบนมือถือและเดสก์ท็อป ถ้าเด้งซ้ำ ให้ลิงก์ในหน้า `/command` เปิดแท็บใหม่ หรือย้าย policy ให้ app หลักรับเบ๊นด้วย | ทีม; ถ้าต้องแก้ policy เบ๊นตัดสิน |
| M2 | major | spec §7.2 replay (`generated_at` ต้องใหม่กว่า, 409) | WSL บนเครื่องเบ๊นนาฬิกาเพี้ยนหลัง sleep เป็นเรื่องที่เกิดบ่อย ถ้าส่ง snapshot ที่เวลาล้ำไป 9 นาที (ผ่านเกณฑ์ 10 นาที) แล้วนาฬิกาถูกแก้ snapshot ทุกอันต่อไปจะโดน 409 นาน ~9 นาทีหรือนานกว่า และ spec ไม่ระบุว่าเทียบเวลาเป็น instant: `generated_at` เก็บเป็นสตริงมี offset `+07:00` ถ้าเทียบเป็นสตริงจะผิด นอกจากนี้การ "อ่านแล้วค่อยเขียน" ไม่ atomic: สอง POST พร้อมกันผ่านทั้งคู่ | (ก) normalize `generated_at` เป็น UTC ก่อนเก็บ/เทียบ (ข) ทำให้ atomic ด้วย `INSERT … ON CONFLICT DO UPDATE … WHERE excluded.generated_at > command_sources.generated_at` แล้วดู `meta.changes` (ค) ผ่อนกฎ: ปฏิเสธเฉพาะที่เก่ากว่าของเดิมเกิน 1 ชม. หรือใช้ลำดับ `received_at` แทน เพราะผู้โจมตีต้องมี service token อยู่แล้ว replay ไม่ได้เพิ่มความเสี่ยงมาก | ทีม |
| M3 | major | spec §6.5 `p365_missing` | โค้ดจะขึ้นรายการสีแดง "ยังไม่มีไฟล์ Page365 ของเมื่อวาน" ตั้งแต่ 00:00 เวลาไทย แต่พนักงาน (เคน) อัปโหลดช่วงเช้า และ Discord เตือนเวลา 10:00 เบ๊นจะเจอแดงทุกเช้าทั้งที่ยังไม่ใช่ความผิดใคร และเป็นงานของเคน ไม่ใช่เบ๊น | แสดง `p365_missing` ใน todo เฉพาะหลัง 10:00 เวลาไทย (ตรงกับเวลาเตือนใน Discord) ก่อนหน้านั้นให้ tile `pk_sales_yesterday` เป็น `missing` เฉยๆ ไม่เข้า todo | เบ๊น (ยืนยันว่าเรื่องนี้เป็นงานเบ๊นไหมและเวลาตัด) |
| M4 | major | spec §5.2 `commandIdentity`, `verifyAccess` | `certs()` throw เมื่อดึง JWKS ไม่ได้ `authenticate()` เดิมถูกครอบด้วย `.catch(() => null)` ใน index.ts แต่ spec ไม่บอกว่า `commandIdentity`/`commandRoute` ต้องทำเหมือนกัน ถ้าไม่ครอบจะได้ 500 แทน 401 (fail-open ไม่เกิด แต่ test §12.1 ข้อ 7 ไม่ครอบกรณีนี้) นอกจากนี้ `AccessClaims.type` ถูกประกาศแต่ไม่ถูกใช้ | เพิ่มข้อ 6.1 ใน spec: `verifyAccess` ที่ throw = null; เพิ่ม test "JWKS ดึงไม่ได้ → 401" และแนะนำให้ service ต้องมี `type === 'app'` ด้วยถ้า Access ส่งมาจริง (ยืนยันตอน B3) | ทีม |
| M5 | major | spec §4.1, §5.3 | ตารางสิทธิ์ไม่ครอบ method ผิด: `POST /summary`, `GET /jobs`, `PUT/DELETE`, `OPTIONS`, `HEAD` รวมถึง path แปลก (`/api/command/`, `/api/command/summary/`, `/api/command/%2e%2e/`, ตัวพิมพ์ใหญ่) test §12.1 ข้อ 10 พูดแค่ `/ask` และ "path แปลกๆ" | ระบุว่า method/path ที่ไม่ตรงทั้งหมด → 404 (หลังผ่านตัวตน) หรือ 405 และเพิ่ม test แบบตารางครบทุกคู่ method x path x ตัวตน | ทีม |
| M6 | major | spec §6.5 + design §4 | design บอกว่า todo มีเฉพาะ proposal ชนิด pause/dup/cap ส่วน spec รวม `move` ด้วย (และ migration comment ของ `proposals` ไม่ได้ระบุชนิด cap/dup แต่โค้ด discord.ts มี) นอกจากนี้ design ให้ลิงก์ proposal ไป `/` ขณะที่ spec ให้ไป Discord (ต้องมี `DISCORD_GUILD_ID` ซึ่งยังไม่มีในโค้ดเลย: เป็นตัวแปรใหม่และเป็นคำถาม Q4) | ตกลงชุดชนิดเดียวกัน (เสนอ: ทุกชนิดที่ `status = 'pending'`) แก้ design ให้ตรง และถ้าเบ๊นตอบ Q4 ว่าไม่ใส่ guild id ลิงก์ fallback ต้องไป `/#history` ตามที่ spec เขียน | ทีม; Q4 เบ๊น |
| M7 | major | spec §6.8, §9 CPU | CPU free plan = 10 ms ต่อ request: ทุกครั้งที่เปิดหน้า Worker parse JSON snapshot เต็มก้อน (178 job ~30 KB วันนี้ แต่เพดาน 1000 job ~170 KB และโตขึ้นเรื่อยๆ) แล้วกรอง/เรียงใหม่ ทั้งที่ข้อมูลเปลี่ยนแค่ทุก 10 นาที และ RSS ถูกทดสอบจากเครื่อง local เท่านั้น (ยังไม่ได้ลองจาก egress ของ Worker อาจโดน bot protection ของ benzarnun.com) | ตอน POST ให้คำนวณ `counts`/`active`/`recent` แล้วเก็บเป็นผลสรุปในแถวเดียวกัน (GET แค่ parse สรุปเล็กๆ) เพิ่ม test วัดเวลา parse/สรุป 1000 job เป็น regression และใส่ในแผน manual: เรียก summary จริง 1 ครั้งหลัง deploy ดู CPU time ใน dashboard, ดู `blog_latest` ว่าไม่เป็น `error` | ทีม |
| M8 | major | spec §6.3, §3 | ปีของ YTD = ปีของ "เมื่อวาน" ในวันที่ 1 ม.ค. tile จะแสดงยอดเต็มปีก่อนเทียบเป้า 100M ของปีก่อน (ถูกต้องตามตรรกะแต่เบ๊นอาจงง) และ label ในดีไซน์ฝังคำว่า "สะสมปีนี้" นอกจากนี้ R5 (วันที่ไม่มีไฟล์นับเป็น 0 ไฟล์เริ่ม ต.ค.) ทำให้ `pct` ต่ำมากจริง (ราว 45 วันจาก 318) ขณะที่ progress bar ในดีไซน์โชว์ `pct` เทียบ "ควรถึง" เต็มปี ผลคือบาร์แดง/ขาดทุกวันแม้ขายดี | ใช้ label ที่มีปี "สะสมปี 2026" ให้ดีไซน์เลือกว่าบาร์หลักเทียบ `pace` หรือ `pace_uploaded` (Q5) และเขียนบนการ์ดตรงๆ "นับ 45/318 วันที่มีไฟล์" ใน source เดิมอยู่แล้วแต่ดีไซน์ต้องให้เห็นใกล้ตัวเลข | เบ๊น (Q5) |
| m1 | minor | spec §4.4 example | ตัวเลขใน example ไม่สอดคล้องกันเอง: `needed_per_day` 2096190.6 ไม่ตรง (100,000,000 − 1,234,567) ÷ 47 = ~2,101,392; `counts` รวม 167 ไม่ตรง `total` 180; `uploaded_days 111` ขัดกับข้อเท็จจริงใน R5 ที่ไฟล์เริ่ม ต.ค. spec เตือนแล้วว่าห้ามใช้เป็น fixture แต่ courage/justice จะ copy ไปใช้ | แก้ตัวเลขให้คำนวณถูก หรือใช้ค่าที่เห็นชัดว่าสมมติ (เช่น 1,000,000) และ `uploaded_days` ที่สมเหตุสมผล | ทีม |
| m2 | minor | spec §4.2 | `as_of` เป็น null "เฉพาะ not_connected" แต่ไม่ได้กำหนดสำหรับ `error` (ไม่มีเวลาที่ข้อมูลเป็นจริง) test §12.3.6 ตรวจแค่ว่ามี key | กำหนด `as_of = generated_at` หรือ null สำหรับ `error` ให้ชัด | ทีม |
| m3 | minor | design §5, §8 vs spec | design เรียก state `connected:false` และให้แต่ละกล่อง fetch เอง (hook ต่อกล่อง) ส่วน spec ใช้ `status: 'not_connected'` และ endpoint เดียว (`ห้ามเรียก /api/* อื่น`) | แก้ design §8 ให้ใช้ `status` ของ spec และ hook เดียว + แยกแสดงผลต่อ tile | ทีม (harmony) |
| m4 | minor | design §1/§10 spec | ลำดับกล่อง 3 แบบ: brief = stat / ทีม / ต้องทำ, spec §10 = ธุรกิจ / ต้องทำ / ทีม, design = ต้องทำ / ธุรกิจ / ทีม (design ถามเป็นคำถามข้อ 1 แล้ว) และ SiteNav: design = ไม่มี, spec = มี SiteNav แต่ไม่ใส่ใน PAGES, CLAUDE.md = ทุกหน้าต้องอยู่ใน SiteNav | เบ๊นเลือกลำดับเดียว และตอบ Q1 เรื่อง SiteNav แล้วแก้ทั้งสองไฟล์ให้ตรง ถ้าไม่มี SiteNav ต้องมีข้อยกเว้นเขียนใน CLAUDE.md (บรรทัดเดียวใน S7) | เบ๊น |
| m5 | minor | design §5 vs spec §4.2 | design มี "PK ล่าสุดที่มี: d MMM ฿…" เมื่อไฟล์เมื่อวานยังไม่มา แต่ spec `missing` ให้ `data: null` ไม่มีค่านั้นให้แสดง | เพิ่ม `last_available { date, revenue }` ใน tile `pk_sales_yesterday` เมื่อ missing (เป็นข้อมูลจริงที่ไม่ใช่ 0) หรือตัดข้อความออกจาก design | ทีม |
| m6 | minor | spec §6.6 + design | countdown: design ระบุข้อความ "วันนี้" (1 ธ.ค.) กับ "เปิดแล้ว" (หลังจากนั้น) แต่ spec มีแค่ `passed` ที่เป็น true ตั้งแต่ 00:00 ของ 1 ธ.ค. ทำให้ไม่มีทางแยก "วันนี้" ออกจาก "เปิดแล้ว" | เพิ่ม `days_since` หรือให้หน้าจอคำนวณจาก `today` (มีใน response) | ทีม |
| m7 | minor | spec §3, §11 S0 | `json()` ใน index.ts ไม่ได้ export (บรรทัด ~2045) แต่ spec ให้ `command.ts` "ใช้ json() เดิม" และห้าม import จาก index.ts (วนกัน) `BadRequest` อยู่ validate.ts import ได้ | ให้ S1 ย้าย `json()` ไป `validate.ts` หรือไฟล์เล็กใหม่แล้ว export (ไม่เปลี่ยนพฤติกรรม) ใส่ใน S0/S1 | ทีม |
| m8 | minor | spec §13 | `COMMAND_ALLOWED_EMAILS` เป็น var ใน `wrangler.jsonc` ซึ่ง repo เป็น public (ของเดิม `OWNER_EMAILS` ก็ทำแบบนี้อยู่ จึงมีแบบอย่าง) แต่ spec ไม่ได้ตัดสินว่าอีเมลเบ๊นจะอยู่ใน repo | เลือกให้ชัดว่า secret หรือ var; ผมแนะนำ secret (`wrangler secret put`) เพราะ AUD ไม่ลับแต่อีเมลเป็นข้อมูลส่วนตัว | เบ๊น |
| m9 | minor | spec §12.3.1 | test "ไม่มีการเรียก fetch ใดๆ" ใช้ไม่ได้จริงเพราะ summary เดียวกันเรียก RSS เมื่อ cache หมด จะ test ล้มหรือซ่อนบั๊ก | ปรับเป็น: seed แถว rss ที่สด แล้ว assert ว่าไม่มี request ไป `graph.facebook.com`/`*.facebook.com` เลย | ทีม |
| m10 | minor | spec §6.2/§6.3 + design | ขอบเขตเวลา: ไม่มี test ช่วง 00:00 ถึง 07:00 ไทย (ซึ่งเป็นวัน UTC เดิม) สำหรับ `bkkDate(1)`, การเปลี่ยนปี, และ stale 25 นาทีที่ขอบ (24:59 / 25:01) | เพิ่มเคสด้วย `now` ฉีดเข้า (ฟังก์ชัน `bkkDate(offset, now)` รองรับอยู่แล้ว) | ทีม |

## การโจมตี auth ที่ลองคิดแล้ว (เชิงเอกสาร)

| สถานการณ์ | ผล |
|---|---|
| คนทีม PkJeans เปิด `/api/command/summary` | โดน Access ที่ edge (app ใหม่ไม่มี policy ทีม) และถ้าหลุด: aud ไม่ตรง หรืออีเมลไม่อยู่ใน allowlist → 401 ดี |
| JWT ของ app หลัก/GoSell ไป `/api/command/*` | aud ไม่ตรง → 401 ดี |
| JWT ของ command app ไป `/api/*` อื่น | `authenticate()` ใช้ `ACCESS_AUD` เดิม → 401 ดี (ต้องไม่แก้พฤติกรรมเดิม: spec ทำเป็น wrapper บางๆ และมี test 12.1 ข้อ 11) หมายเหตุเดิม: `authenticate()` คืน `'unknown'` เมื่อ JWT ไม่มี email ถ้า service token เคยได้รับอนุญาตใน app หลักจะผ่านเป็น viewer แต่ตอนนี้ไม่มี policy แบบนั้น ไม่ใช่ช่องโหว่ใหม่ |
| service token ที่รั่วอ่าน summary | 403 ตามตาราง (ต้องมี test ข้อ 12.1.5 ซึ่งมีแล้ว) ผลเสียสูงสุด = ส่งรายการงานปลอม (metadata เท่านั้น) |
| user (เบ๊น) POST `/jobs` ด้วย cookie | 403 + ตรวจ Origin ดี |
| `DEV_BYPASS_AUTH` บน production | เงื่อนไข host เดิม ผลลัพธ์ปลอดภัย |
| route ข้ามตัวตรวจ | จุดต่อใน index.ts วางก่อน `authenticate()` แต่ `commandRoute` ต้องจับ path ทั้งหมดที่ขึ้นต้น `/api/command` รวมถึง `/api/command` เปล่า spec ทำแล้ว และไม่ fallthrough ไป `route()` เดิม (ต้องมี test M5) |
| `/assets` อยู่ใต้ app GoSell | เป็น R3 ที่ spec ยอมรับ, ต้องตรวจใน M1 |
| payload ใหญ่/แปลก | 413/400 ตามตาราง ข้อสังเกต: ตรวจ `Content-Length` อย่างเดียวไม่พอถ้าใช้ chunked ซึ่ง spec ครอบด้วย "ความยาวจริง" แล้ว |
| XSS จากชื่อ RSS | React text + ตรวจ prefix URL แต่ควรตรวจ `https://benzarnun.com/` ด้วยการ parse URL (hostname เท่ากับ) เพื่อกัน `https://benzarnun.com.evil.tld/` ที่ prefix ตรง: ตัวอย่าง `https://benzarnun.com/` มี `/` ท้ายจึงปลอดภัย แต่ test 12.4.5 ควรมีเคส `@` และ `\\` |

## test plan พอให้ justice ใช้ตอน build ไหม

พอเป็นฐาน (auth 11 ข้อ, snapshot 6 ข้อ, tiles 7 ข้อ, RSS 5 ข้อ, team 5 ข้อ, manual 5 ข้อ) แต่ต้องเพิ่ม:
1. ตาราง method x path x ตัวตน (M5), JWKS ล่ม (M4)
2. snapshot: เทียบเวลาข้าม offset, POST พร้อมกัน, นาฬิกาเพี้ยน (M2)
3. todo ที่มี needs-user เก่า 13 รายการ (B1) และ p365 ก่อน/หลัง 10:00 (M3)
4. ผลลัพธ์ summary ต้องไม่มี `uploaded_by`, อีเมล, หรือ field นอก schema (test แบบ snapshot ของ key ทั้งหมด)
5. หน้าเว็บ: ไม่มี test อัตโนมัติใน spec เลย S6 วัดผลแค่ "เปิดได้บน dev" ให้ justice ตรวจเองตาม checklist design §7 ที่ 390 px, 320 px, zoom 200%, reduced motion และทุก state (loading / ยังไม่เชื่อม / stale / error / empty) ด้วย fixture ที่มีป้าย "fixture" ใน dev เท่านั้น
6. manual §12.6 เพิ่ม M1 และ B3

## ต้องให้เบ๊นตัดสิน

- D1 (B1): needs-user เก่าเกินกี่วันถึงไม่ขึ้นใน "วันนี้ต้องทำ" (เสนอ 7 วัน) และจะเคลียร์ 13 งานค้างเดิมไหม
- D2 (M3, m4): ลำดับกล่อง (brief / design / spec ไม่ตรงกัน) และ p365 ขาดเป็นงานของเบ๊นไหม ขึ้นหลังกี่โมง
- D3 (M8 = Q5): บาร์ YTD เทียบเต็มปี หรือเทียบ `pace_uploaded`
- Q1 ถึง Q4 ใน spec §15 (SiteNav, title ของ job, อายุ session, `DISCORD_GUILD_ID`) และ m8 (อีเมลเป็น secret หรือ var)

ที่เหลือทีมแก้เองได้ (B2, B3, M1, M2, M4 ถึง M7, m1 ถึง m3, m5 ถึง m7, m9, m10)

## สิ่งที่ไม่ได้ตรวจ

- พฤติกรรม Access จริง (path matching, cookie ข้าม app, claim ของ service token) ไม่มี URL/สิทธิ์ ไม่ได้แตะ
- ไม่ได้รัน `npm test`/typecheck, ไม่ได้รัน remote migration list (`wrangler d1 migrations list --remote` ถูกห้าม), จึงยืนยัน 0055 ว่างได้แค่ใน repo ทุก branch บนเครื่อง
- ไม่ได้ดึง RSS จริงจาก Worker และไม่ได้วัด CPU จริง
- mockup ตรวจจาก HTML + PNG 390 px เท่านั้น ไม่ได้เปิดที่ 320 px หรือ zoom 200% หรือวัด contrast เอง (ใช้ตัวเลขใน design.md)
- ไม่ได้อ่าน `.env`/`.dev.vars`/secret ตามข้อห้าม ค่า var ใน wrangler.jsonc ไม่ได้คัดลอกมาที่นี่
