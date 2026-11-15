# Benz Command Center: รีวิวโค้ดและ test (justice, 2026-11-15)

ขอบเขต: `git diff d793f80..HEAD` (HEAD = 27c3e3e) เทียบ spec §0 และ `review.md` รอบก่อน
สภาพแวดล้อมที่ตรวจ: local อย่างเดียว (worktree `.worktrees/command-center`, node v26.13.0, sqlite shim แทน D1, JWT เซ็นเองด้วย key ทดสอบ) ไม่ได้ตรวจ Production หรือ Access จริง

## คำตัดสิน: **Go with risks** สำหรับ "ส่ง draft ให้เบ๊นและเปิด PR"

- ไม่พบ blocker ไม่มีทางเลี่ยง auth, ไม่มีตัวเลขปลอม, ไม่มีข้อมูลรั่ว, ไม่มี secret/อีเมลจริงใน diff
- มี major 2 ข้อ (test ไม่ครอบจุดต่อใน `index.ts`, เช็กลิสต์ขาดข้อ rollback) และ minor 6 ข้อ ไม่ขวางการเปิด PR แต่ควรแก้ก่อนเบ๊นสั่ง deploy
- **ไม่ใช่สิทธิ์ deploy**: ต้องผ่าน `deploy-checklist.md` (B3 service token จริง, M1 มือถือจริง, CPU จริง) และเบ๊นอนุมัติ เพราะ Access กับ Production ยังไม่เคยถูกทดสอบเลย

## ผลที่รันจริง

| รายการ | ผล |
|---|---|
| `npm test` | 243/243 ผ่าน (ไฟล์ของงานนี้: `command.test.ts` + `auth.test.ts` = 38 test) |
| `npm run typecheck` | exit 0 |
| `git status` หลังทำ mutation ทั้งหมด | สะอาด (นอกจากไฟล์นี้) |
| อีเมลใน diff | `example.com` ทั้งหมด; hex 64 ตัวที่เจอคือ `ACCESS_AUD` เดิมของ app หลัก (อยู่ใน repo มาก่อน, ไม่ใช่ใหม่); `COMMAND_ACCESS_AUD` ว่าง |

## ตารางประเด็น

| # | ระดับ | ที่ไหน | ประเด็น | ข้อเสนอแก้ |
|---|---|---|---|---|
| MJ1 | major | `worker/index.ts:160` (+ ไม่มีไฟล์ test) | จุดต่อ `commandRoute` ก่อน `authenticate()` **ไม่มี test ใดครอบ** (mutation M18: ลบบรรทัดนี้ ผล 243/243 ยังผ่านเหมือนเดิม) test ทั้งหมดเรียก `commandRoute` ตรงๆ ถ้าใครย้ายหรือลบบรรทัดนี้ `/api/command/*` จะตกไปทาง auth หลัก (ไม่รั่ว แต่ฟีเจอร์ตายเงียบๆ และ JWT ผิด aud) | เพิ่ม test เรียก `default.fetch` ของ `index.ts` กับ `/api/command/summary` ด้วย JWT ของ command app ต้องได้ 200 และกับ JWT ของ app หลักต้องได้ 401 จาก `commandRoute` (ข้อความ error ของ Command ต่างจากของเดิม) ถ้า import `index.ts` ใน test หนักเกินไป อย่างน้อย test แบบอ่านซอร์สยืนยันว่าบรรทัดนี้อยู่ก่อน `authenticate(` |
| MJ2 | major | `docs/command-center/deploy-checklist.md` | ไม่มีข้อ rollback: ถ้า M1 ล้มเหลวหรือ service token ใช้ไม่ได้หลัง deploy ไม่มีบอกว่าทำอย่างไร (ย้อน Worker, ลบ/ปิด Access app `PkJeans Command`, secrets `COMMAND_*` ทิ้งไว้ได้ไหม) และไม่บอกให้เช็กว่าอีเมลเบ๊นอยู่ใน policy ที่ผ่าน app `/gosell` + `/assets` (หน้า `/command` โหลด JS จากที่นั่น) ก่อนเริ่ม ไม่ใช่รอให้หน้าขาวตอน M1 | เพิ่มหัวข้อ "ถ้าพัง": ย้อน deploy ล่าสุดด้วย `wrangler rollback`, ปิด app `PkJeans Command` ใน Access (migration 0055 ไม่ต้องย้อน เพราะแค่ตารางใหม่ ไม่มีใครอ่าน) และใส่ข้อ "ยืนยันว่าอีเมลเบ๊นอยู่ใน PkJeans team หรือ account members ก่อน" ในหัวข้อ 2 ข้อ 6 |
| m1 | minor | `migrations/0055_command_sources.sql:3` | `CREATE TABLE command_sources` ไม่มี `IF NOT EXISTS` (Marcus ขอตรวจข้อนี้) migration เดิมของ repo เช่น 0010 ก็ไม่ใส่ และ wrangler จด migration ที่ apply แล้วไว้ จึงไม่พังในการใช้งานปกติ แต่ถ้า apply ค้างครึ่งทางแล้วรันซ้ำจะชน ไม่กระทบตารางเดิม (ตารางใหม่ล้วน ไม่มี ALTER) และเลข 0055 ว่างใน branch นี้ (ยังไม่ได้เช็ก `--remote` ตามข้อห้าม) | ใส่ `IF NOT EXISTS` (ไม่เสียอะไร) |
| m2 | minor | `worker/command.ts:257-259` | tile `error` ใส่ `note: short(e)` คือข้อความ exception ดิบ (ตัดที่ 200 ตัว) ไปถึงหน้าเบ๊น ปลอดภัยเพราะผู้ดูคือเบ๊นคนเดียว แต่อาจโชว์ชื่อตาราง/คอลัมน์จาก D1 | ยอมรับได้; ถ้าจะเข้ม ให้ใส่ข้อความกลางๆ แล้วเก็บของจริงใน `console.error` (มีอยู่แล้ว) |
| m3 | minor | `worker/command.ts:422` | RSS refresh ใน `waitUntil` ไม่มี lock: เปิดหน้าซ้ำหลายครั้งในช่วงที่ fetch ยังไม่เสร็จ จะยิง refresh ซ้อนกัน (ผลคือ request ออก feed หลายครั้ง ไม่เสียหาย, subrequest ยังต่ำกว่าเพดาน free plan มาก) | ไม่ต้องแก้ตอนนี้ ถ้าจะแก้ ให้เขียน `generated_at` ก่อน fetch |
| m4 | minor | `web/src/CommandPage.tsx:47-52,300` | session Access (7 วัน) หมดอายุตอนเปิดแท็บค้างไว้: `fetch` ถูก redirect ไปหน้า login ข้ามโดเมน ได้ `TypeError: Failed to fetch` ข้อความที่แสดง "เช็กอินเทอร์เน็ต แล้วกดลองใหม่" ซึ่งกดซ้ำก็ไม่หาย ต้องโหลดหน้าใหม่เพื่อ login | เพิ่มประโยค "ถ้ายังไม่ได้ ให้โหลดหน้านี้ใหม่เพื่อล็อกอินอีกครั้ง" ในแบนเนอร์ |
| m5 | minor | `worker/command.ts:231` | กฎ 409 ยอมให้ snapshot เก่ากว่าที่เก็บไว้ไม่เกิน 15 นาทีเขียนทับ จึง replay snapshot เก่าภายใน 15 นาทีได้ (ตั้งใจตาม spec M2, ผู้ส่งต้องมี service token, ข้อมูลเป็น metadata สร้างใหม่ได้ทุก 10 นาที) | บันทึกเป็นความเสี่ยงที่ยอมรับ ไม่ต้องแก้ |
| m6 | minor | `worker/command.ts:310-315` + `web/src/CommandPage.tsx:243` | ไม่ใช่บั๊ก: `days_left` นับจากวันที่ไทย ส่วน `seconds_left` ใช้เวลาจริง หน้าเว็บคำนวณชั่วโมง/นาทีเองจาก `generated_at` ถ้าเปิดแท็บค้างหลายชั่วโมงแล้วไม่ refresh ตัวเลข "อีกกี่วัน" จะไม่ขยับจนกว่าจะรีเฟรช (ภายใน 48 ชม. ก่อนเปิดขยับตามนาฬิกา) | ยอมรับได้ (มี visibilitychange refresh ทุก 5 นาทีที่ซ่อน) |

ไม่มี blocker จึงไม่มีรายการ "ไฟล์:บรรทัด + ข้อเสนอ" ของ blocker

## คำตอบตามข้อที่ Marcus ขอตรวจ

1. **Auth/security**: ผ่าน
   - `index.ts:160` ส่ง `/api/command` และ `/api/command/*` ไป `commandRoute` ก่อน `authenticate()` เดิม; `authenticate()` เหมือนเดิม (แค่ย้ายส่วนตรวจ JWT ไป `verifyAccess` ที่รับ aud เป็นพารามิเตอร์ และ test เดิมยังผ่าน + มี test เพิ่ม)
   - email JWT: อ่าน summary ได้อย่างเดียว (`ROUTES` + 403 บน POST /jobs), service token: POST /jobs ได้อย่างเดียว (403 บน GET /summary) ถูกจับด้วย mutation M2, M3, M16
   - `COMMAND_ACCESS_AUD` ว่าง = ทุกคน 401 (เช็กซ้อน 3 ชั้น: `commandIdentity`, `verifyAccess` `!aud`, และ `auds.includes` ไม่ตรง) ผล: ปิดชั้นเดียวหรือสองชั้นแล้ว test ยังผ่านเพราะชั้นที่สามยังกัน (equivalent mutant ไม่ใช่ช่องโหว่)
   - `DEV_BYPASS_AUTH`: `devBypass()` ต้องเป็น `'true'` **และ** host เป็น localhost/127.0.0.1 `wrangler.jsonc` ไม่มี `DEV_BYPASS_AUTH` ใน vars (grep แล้ว) `.dev.vars` ไม่ได้อยู่ใน git (`git ls-files` ไม่เจอ) ใช้กับ /api/command ได้เฉพาะ localhost และ summary ใส่ `local_dev: true` mutation M5 (ถอดเช็ก localhost) ถูกจับ 2 test
   - Origin: เช็กเฉพาะ non-GET, ปฏิเสธ cross-origin (M8 ถูกจับ); ไม่มี Origin = ผ่าน (จำเป็นสำหรับสคริปต์ curl) ยอมรับได้เพราะต้องมี service token
   - ข้อมูลรั่ว: test "tiles 8" ตรวจ key ทั้งก้อนไม่มี `uploaded_by`/อีเมล; `grep uploaded_by worker/command.ts` = 0; summary ส่ง `title` ของ job (ตามคำตัดสิน Q2) เฉพาะให้อีเมลเบ๊น; snapshot รับได้แค่ 7 key
2. **ไม่มีตัวเลขปลอม**: ผ่าน ไฟล์เมื่อวานหาย → `missing` + `data:null` (M11 ถูกจับ), Focus Club สมาชิกและ ClassRoom → `not_connected` + `data:null` (M12 ถูกจับ), วันที่อัปโหลดแล้วแต่ 0 ออเดอร์ = `ok` ยอด 0 (ของจริง แยกจากไม่มีไฟล์ มี test)
3. **ไม่เรียก Meta / free plan**: ผ่าน ไม่มี import Meta ใน `command.ts`; test m9 ยืนยันไม่มี request ออกเมื่อ RSS cache สด; D1 ต่อ request ประมาณ 5 query (sources, เมื่อวาน, นับไฟล์ปี, settings, proposals) ใช้ index `p365_orders_date`; YTD cache ด้วย signature (M13 ถูกจับ) จึงไม่ join ทั้งปีทุกครั้ง; RSS ตัดที่ item ที่ 3 หรือ 256 KB และ timeout 4 วินาที; ค่า CPU จริงยังไม่ได้วัด (ต้องดูหลัง deploy ตามเช็กลิสต์ §7)
4. **Snapshot validation**: ผ่าน body ≤ 256 KB (ตรวจทั้ง Content-Length และอ่านจริงแบบจำกัด), jobs ≤ 1000, title 1–120 ไม่มีอักขระควบคุม, key นอกรายการ = 400 ทั้งก้อน (M10 ถูกจับ), generated_at ล้ำอนาคต > 10 นาที = 400, 409 เมื่อเก่ากว่า 15 นาที (M9 ถูกจับ), upsert เดียวแบบ atomic ตรวจ `meta.changes` ยกเว้นสิ่งเดียวคือ SQL `strftime` กับค่า ISO มี `Z`/มิลลิวินาที ทำงานถูกใน sqlite ที่ test ใช้ และ D1 คือ SQLite เดียวกัน
5. **Migration 0055**: ตารางใหม่ล้วน ไม่แตะตารางเดิม ดู m1 เรื่อง `IF NOT EXISTS`
6. **คุณภาพ test**: ดูผล mutation ด้านล่าง ดี ยกเว้น MJ1
7. **Secret/อีเมลจริง**: ไม่พบ (อีเมลทดสอบทั้งหมด `@example.com`; `benzarnun.com@evil.tld` เป็นเคสโจมตีใน test)
8. **หน้าเว็บ**: ผ่านตามคำตัดสิน ลำดับ todo > ธุรกิจ > ทีม ตรง D2; ทุกกล่องมี "ที่มา:" (`Src`); state ครบ: loading skeleton, error ก่อนมีข้อมูล, รีเฟรชไม่สำเร็จแต่ยังมีข้อมูลเก่า, ยังไม่เชื่อม, stale, missing, empty, ไม่มีงานทีมใน 7 วัน; ไม่มี `SiteNav` ใน `CommandPage.tsx` และไม่อยู่ใน `PAGES`; `/command` ถูก route ใน `main.tsx`; CLAUDE.md มี 1 บรรทัดตามกฎ ตรวจจาก preview 390 px (sample) แล้วอ่านออก ไม่ล้น แต่ยังไม่ได้ดู 320 px, zoom 200%, reduced motion จริง (มี CSS รองรับ `prefers-reduced-motion`)
9. **deploy-checklist**: ครบเรื่อง Access app, policy Service Auth, secrets, B3, M1, CPU ขาด rollback (MJ2)

## ผล mutation (แก้โค้ดจริง รัน `command.test.ts` + `auth.test.ts` แล้ว `git checkout` กลับทุกครั้ง)

ฐาน: 38 pass / 0 fail

| # | จุดที่แก้ | ผล | จับได้ไหม |
|---|---|---|---|
| M1 | ปิดเช็ก `auds.includes(aud)` ใน `auth.ts` | 35 pass / 3 fail | จับได้ |
| M2 | ให้ `user` POST /jobs ได้ | 37 / 1 | จับได้ |
| M3 | ให้ `service` GET /summary ได้ | 37 / 1 | จับได้ |
| M4 | ปิดรายชื่ออีเมลที่อนุญาต | 35 / 3 | จับได้ |
| M5 | ปิดเช็ก localhost ใน `devBypass` | 36 / 2 | จับได้ |
| M6 | ปิดการ์ด `!COMMAND_ACCESS_AUD` ใน `commandIdentity` | 38 / 0 | ไม่จับ: ซ้ำซ้อนกับ `verifyAccess` (ปลอดภัย) |
| M7 | ปิดการ์ด `!aud` ใน `verifyAccess` | 38 / 0 | ไม่จับ: ซ้ำซ้อน (ปลอดภัย) |
| M6+M7 | ปิดทั้งสองการ์ด | 38 / 0 | ไม่จับ: ชั้นที่สาม `auds.includes(undefined)` ยังกัน (ยืนยันว่า aud ว่างยังถูกปฏิเสธ) |
| M8 | ปิดเช็ก Origin | 37 / 1 | จับได้ |
| M9 | ปิดกฎ 409 "เก่ากว่า 15 นาที" | 37 / 1 | จับได้ |
| M10 | อนุญาต key แปลกใน job | 37 / 1 | จับได้ |
| M11 | ไม่มีไฟล์ Page365 → คืนตัวเลข 0 | 37 / 1 | จับได้ |
| M12 | Focus Club สมาชิก → คืน 0 | 37 / 1 | จับได้ |
| M13 | cache YTD ไม่สนใจการอัปโหลดใหม่ | 37 / 1 | จับได้ |
| M14 | ปิดเช็ก hostname ใน `blogUrl` | 38 / 0 | ไม่จับ: ซ้ำซ้อนกับเช็ก prefix |
| M14b | ปิดเช็ก prefix ใน `blogUrl` | 38 / 0 | ไม่จับ: ซ้ำซ้อนกับ hostname |
| M14c | ปิดทั้งสองเช็ก URL | 33 pass / 1 fail (รันเฉพาะ command.test) | จับได้ |
| M16 | ปิดตารางสิทธิ์ `r.who.includes` | 36 / 2 | จับได้ |
| M17 | ปิดเช็ก `sub === ''` ของ service token | 37 / 1 | จับได้ |
| **M18** | **ลบจุดต่อ `commandRoute` ใน `index.ts`** (รัน `npm test` เต็ม) | **243 pass / 0 fail** | **ไม่จับ → MJ1** |

สรุป: mutation ที่ทำให้พฤติกรรมเปลี่ยนจริง 15 ข้อ จับได้ 14 ข้อ (ที่ไม่จับคือ M18) อีก 5 ข้อที่ไม่จับ (M6, M7, M6+M7, M14, M14b) เป็นการ์ดซ้อนกันที่ปิดทีละชั้นแล้วยังปลอดภัย (ปิดทุกชั้นแล้ว test จับได้ใน M14c; ส่วน M6+M7 ปิดสองชั้นแล้วยังมีชั้นที่สาม) ทั้งหมดถูก revert แล้ว `git status` สะอาด

## ติดตามผลรอบก่อน (`review.md`)

| ข้อ | สถานะ |
|---|---|
| B1 (needs-user เก่า), B2 (ตารางสถานะ) | ทำแล้ว: test "team 3 + D1" ใช้รูปร่างจริง 13 needs-user / 97 send-failed |
| M2 (นาฬิกา/atomic), M4 (JWKS ล่ม → 401), M5 (เมทริกซ์ method×path×ตัวตน 18 เคส), M6 (proposal ทุกชนิด), M7 (digest 1000 job) | ทำแล้ว มี test ทุกข้อ |
| m9, m10 (เวลา 00:30 ไทย, 1 ม.ค., stale 24:59/25:01) | ทำแล้ว |
| B3, M1 | อยู่ในเช็กลิสต์ ต้องทดสอบกับ Access จริง ยังไม่ได้ทำ |

## สิ่งที่ไม่ได้ตรวจ

- Access จริง (path precedence, ชื่อ claim ของ service token, OTP, session 7 วัน), Production URL, `wrangler d1 migrations list --remote` (ถูกห้าม), CPU time จริงบน free plan, RSS จาก egress ของ Worker
- D1 จริง (test ใช้ sqlite shim; query ใช้ คอลัมน์ ที่มีอยู่ใน migration 0010/0013 ตรงกัน)
- หน้าเว็บ: ไม่มี test อัตโนมัติ ดูแค่ preview 390 px; ไม่ได้ลอง 320 px, zoom 200%, คีย์บอร์ด, เน็ตช้า, ภาษาไทยยาวมาก ใน browser จริง; `vite build` เชื่อผลของ Marcus
- ไม่ได้ตรวจสคริปต์ snapshot ฝั่ง orca-pilot (ยังไม่มี) หรือการรวมกับ branch เป้า 100M ที่ยังไม่ merge
