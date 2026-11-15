# Benz Command Center: เช็กลิสต์ก่อนและหลัง deploy

สิ่งที่เบ๊นต้องทำเองใน Cloudflare (โค้ดทำแทนไม่ได้) และการทดสอบที่ต้องทำกับ Access จริง (review B3, M1)
ทำตามลำดับ ข้อไหนไม่ผ่านให้หยุด อย่า deploy ต่อ

> ในไฟล์นี้มีแค่**ชื่อ**ตัวแปร ห้ามเขียนอีเมล, AUD, client id หรือ secret จริงลงไฟล์นี้หรือที่ใดใน repo (repo เป็น public)

## 1. ก่อน merge

- [ ] PR เป้ายอดขาย 100M/ปี (`feat/pk-sales-target-100m-20261115`, commit `ce3c318` + `7602631`) **merge เข้า `ads-web` ก่อน** PR นี้ (branch นี้ rebase ต่อจากมัน) ถ้า branch นั้นถูกแก้หรือ rebase ใหม่ ต้อง rebase branch นี้ตาม
- [ ] เลข migration ยังว่าง: `cd ads-web && ls migrations` และ `npx wrangler d1 migrations list DB --remote` ต้องไม่มี `0055` ของงานอื่น ถ้าชน ให้เปลี่ยนชื่อไฟล์ `0055_command_sources.sql` เป็นเลขว่างถัดไป
- [ ] `npm test && npm run typecheck && npx vite build` ผ่านบน checkout สะอาดของ `origin/ads-web` หลัง merge

## 2. Cloudflare Zero Trust (เบ๊นทำใน dashboard)

1. [ ] **Service token**: Access → Service credentials → Service Tokens → สร้างชื่อ `orca-command-snapshot` อายุ 1 ปี (ตั้งเตือนตัวเองต่ออายุ) จด Client ID / Client Secret ทันที (secret เห็นครั้งเดียว)
   - เก็บในไฟล์ env ของสคริปต์บนเครื่อง (นอก git, `chmod 600`): `COMMAND_JOBS_URL`, `COMMAND_CF_ACCESS_CLIENT_ID`, `COMMAND_CF_ACCESS_CLIENT_SECRET`
2. [ ] **Policy `Command - Benz only`** (reusable): Action **Allow**, Include → Emails = อีเมลของเบ๊น อย่างเดียว, session duration **7 วัน** (Q3)
3. [ ] **Policy `Command - snapshot`** (reusable): Action **Service Auth** (ไม่ใช่ Allow ไม่งั้นสคริปต์โดนเด้งไปหน้า login), Include → Service Token = `orca-command-snapshot`
4. [ ] **Application `PkJeans Command`** (Self-hosted): ปลายทาง `pkjeans-ads.ads-web.workers.dev/command` และ `pkjeans-ads.ads-web.workers.dev/api/command` (ไม่ใส่ `*`), แนบ 2 policy ข้างบนเท่านั้น, login method One-time PIN อย่างเดียว, session 7 วัน **ห้ามแนบ policy "PkJeans team" หรือ account members**
5. [ ] คัดลอก **Application Audience (AUD) tag** ของ app นี้ → ใส่ใน `wrangler.jsonc` ที่ `"COMMAND_ACCESS_AUD"` (AUD ไม่ใช่ความลับ แบบเดียวกับ `ACCESS_AUD`) แล้ว commit
6. [ ] ตรวจว่า app bypass `/webhook` ไม่ครอบ `/command` หรือ `/api/command`
7. [ ] **ก่อน deploy: อีเมลเบ๊นผ่าน app `/gosell` + `/assets` ได้** หน้า `/command` โหลด JS/CSS จาก `/assets` ซึ่งเป็นอีก Access app ถ้าเบ๊นไม่อยู่ในนั้น หน้า `/command` จะขาวตอน M1
   - เปิด app ของ `/gosell` + `/assets` → Policies: อีเมลเบ๊นต้องอยู่ใน policy "PkJeans team" หรือเบ๊นเป็น Cloudflare account member (อย่าใส่เบ๊นใน "GoSell Only")
   - ลองจริง: incognito เปิด `https://pkjeans-ads.ads-web.workers.dev/gosell` ล็อกอินด้วยอีเมลเบ๊น ต้องเห็นหน้า GoSell ไม่ขาว ไม่ถูกปฏิเสธ
8. [ ] (ไม่บังคับ, Q4) ใส่ `"DISCORD_GUILD_ID"` ใน `wrangler.jsonc` (server id ของ Discord) เพื่อให้กดจากข้อเสนอไปที่ข้อความใน Discord ได้ ว่าง = ลิงก์ไป `/#history`

## 3. Worker secrets (เบ๊นรันเอง พิมพ์ค่าเองตอนถูกถาม)

```sh
cd ads-web
npx wrangler secret put COMMAND_ALLOWED_EMAIL        # อีเมลของเบ๊น (คั่นด้วย comma ได้ถ้าจะเพิ่มทีหลัง)
npx wrangler secret put COMMAND_SERVICE_CLIENT_IDS   # Client ID ของ service token orca-command-snapshot
```

ไม่ตั้ง `COMMAND_ALLOWED_EMAIL` = ไม่มีใครเปิดหน้าได้ (fail closed) ไม่ตั้ง `COMMAND_SERVICE_CLIENT_IDS` = snapshot ส่งเข้าไม่ได้ (401)

## 4. Deploy

ตามขั้นตอนปกติของทีม (คนที่ได้รับมอบหมายเป็นคน deploy): checkout สะอาดของ `origin/ads-web` → `npm test && npm run typecheck` → `npm run deploy` (รัน migration remote ให้ด้วย)

## 5. ทดสอบหลัง deploy: B3 (Access จริงทำงานตามที่ spec สมมติไว้)

ทำจากเครื่องที่**ไม่ได้ล็อกอิน** (หรือ incognito / `curl` ไม่มี cookie) ทุก URL ต้องโดน Access (302 ไปหน้า `cloudflareaccess.com` หรือ 403) ต้อง**ไม่**เห็น JSON ของ Worker:

- [ ] `/command`
- [ ] `/command/`
- [ ] `/command/x`
- [ ] `/api/command`
- [ ] `/api/command/summary`
- [ ] `/api/command/jobs` (POST ไม่มี header)
- [ ] `/api/command/jobs/x`

ถ้าตัวไหนหลุดไปถึง Worker (ได้ JSON 401 จาก Worker แทนหน้า Access) แปลว่า path ไม่ครอบ subpath → เพิ่มปลายทาง `/command/*` และ `/api/command/*` ใน app แล้วทดสอบใหม่ (Worker ยังตอบ 401 อยู่ดี ไม่มีข้อมูลรั่ว แต่ต้องให้ Access กันก่อน)

Service token (ยืนยันสมมติฐาน claim `common_name` + `sub` ว่าง):

- [ ] `npx wrangler tail` เปิดค้างไว้ แล้วยิง snapshot ว่าง:
  ```sh
  curl -s -X POST "$COMMAND_JOBS_URL" -H "CF-Access-Client-Id: $COMMAND_CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $COMMAND_CF_ACCESS_CLIENT_SECRET" \
    -H 'Content-Type: application/json' -d "{\"schema\":1,\"source\":\"orca-pilot\",\"generated_at\":\"$(date -Iseconds)\",\"jobs\":[]}"
  ```
  ต้องได้ `{"ok":true,"stored":0,...}`
- [ ] ถ้าได้ 401: ดู log ใน tail บรรทัด `command auth: valid token, no allowlist match; claims present: …` (บอกแค่**ชื่อ** claim ไม่มีค่า) ถ้าไม่มี `common_name` หรือ `sub(empty)` แปลว่า Access ส่ง claim ต่างจากที่ spec สมมติ → ส่งชื่อ claim ที่เห็นให้ทีมแก้ `commandIdentity()` อย่าเดาเอง
- [ ] token เดียวกันยิง `GET /api/command/summary` → **403**
- [ ] หลังทดสอบเสร็จ หน้า `/command` กล่องงานทีมขึ้น "ทั้งหมด 0 งาน" จนกว่าสคริปต์จริงจะส่ง

## 6. ทดสอบหลัง deploy: M1 (กระโดดข้าม Access app บนโดเมนเดียวกัน)

ทำทั้งบนมือถือเบ๊นและเดสก์ท็อป:

- [ ] เปิด `/command` → OTP → เห็นสามกล่อง (JS/CSS โหลดได้ ไม่ขาว)
- [ ] กดรายการในกล่องต้องทำที่ลิงก์ไป `/#sales` หรือ `/#history` → เปิดได้โดยไม่ถาม OTP ซ้ำวนไม่จบ
- [ ] กด back กลับ `/command` → กดรีเฟรช → ข้อมูลขึ้น ไม่เด้ง login ซ้ำ ไม่ขาว
- [ ] ถ้าเด้ง OTP ซ้ำทุกครั้งหรือหน้าขาว: จดว่าเกิดตอนไหน ทางแก้มีสองทาง (เบ๊นเลือก) ให้ลิงก์ในหน้า `/command` เปิดแท็บใหม่ หรือแก้ policy ให้ app หลักรับเบ๊นด้วย

## 7. ทดสอบหลัง deploy: ที่เหลือจาก spec §12.6

- [ ] บัญชีทีม (ไม่ใช่เบ๊น) เปิด `/command` และ `/api/command/summary` → Access ปฏิเสธ
- [ ] หน้าเดิม `/`, `/gosell`, `/webhook/privacy` ยังทำงานเหมือนเดิม
- [ ] เรียก summary จริง 1 ครั้ง แล้วดู CPU time ของ request ใน Workers dashboard (free plan 10 ms) (M7)
- [ ] กล่อง benzarnun.com ไม่เป็น "โหลดไม่สำเร็จ" (ทดสอบว่า egress ของ Worker ไม่โดน bot protection ของเว็บ) ถ้าโดน ให้ดู `note` ในกล่อง
- [ ] เปิดหน้าตอนก่อน 10:00 และหลัง 10:00 วันที่ยังไม่มีไฟล์ Page365 เมื่อวาน: ก่อน 10:00 ไม่มีรายการสีแดงในกล่องต้องทำ หลัง 10:00 มี

## 8. ถ้าพัง: rollback

ใช้เมื่อ B3/M1 ไม่ผ่าน, หน้าเดิม (`/`, `/gosell`, `/webhook/*`) เสีย, หรือ CPU เกิน free plan หลัง deploy ทำตามลำดับ หยุดได้ทันทีที่ปัญหาหาย

1. [ ] **ปิดหน้าทันที (ไม่ต้อง deploy)**: Zero Trust → Access → Applications → `PkJeans Command` → ถอด policy `Command - Benz only` ออก (หรือลบ app) ทุกคนจะถูก Access ปฏิเสธที่ `/command` และ `/api/command` ถ้าลบ app ทั้งตัว Worker ยังตอบ 401 เองเพราะ JWT ของ app หลักไม่ผ่าน `COMMAND_ACCESS_AUD` (มี test ใน `worker/command.test.ts` "worker entry") จึงไม่มีข้อมูลรั่ว
2. [ ] **ปิด route ฝั่ง Worker (ไม่ต้อง deploy โค้ด; ลบ secret แล้ว Cloudflare ใช้ทันที)**: `npx wrangler secret delete COMMAND_ALLOWED_EMAIL` และ `npx wrangler secret delete COMMAND_SERVICE_CLIENT_IDS` = ทุกคน 401 (fail closed) ส่วน secret ทิ้งไว้ก็ได้ถ้าจะลองใหม่เร็วๆ ไม่มีผลกับหน้าอื่น
3. [ ] **ย้อนโค้ด Worker** (ถ้าหน้าเดิมเสีย): `npx wrangler deployments list` หา version ก่อนหน้า แล้ว `npx wrangler rollback <version-id>` (ย้อนทั้งโค้ดและไฟล์ static ใน version นั้น แต่**ไม่**ย้อน D1 และ secret) ทางถาวร: `git revert` commit ของ Command Center บน `ads-web` → push → deploy จาก checkout สะอาดตามขั้นตอนปกติ (หรือ deploy จาก commit ก่อน merge)
4. [ ] **migration 0055**: **ทิ้งไว้** ไม่ต้อง drop เป็นตารางใหม่ล้วน (`command_sources`) ไม่แตะตารางเดิม โค้ดเก่าไม่อ่านมัน และ wrangler จดว่า apply แล้ว ถ้า drop เองแล้ว deploy ใหม่ ตารางจะไม่ถูกสร้างคืน (migration ไม่รันซ้ำ) ถ้าจะลบจริงหลังเลิกใช้ถาวร ให้ทำเป็น migration ใหม่เลขถัดไป (`DROP TABLE IF EXISTS command_sources;`) ห้ามแก้หรือลบไฟล์ 0055 และห้าม `DROP` มือบน `--remote`
5. [ ] **service token**: ถ้าสงสัยว่ารั่ว Access → Service Tokens → `orca-command-snapshot` → Revoke แล้วหยุดสคริปต์บนเครื่อง
6. [ ] จด**ว่าพังที่ข้อไหน เวลาเท่าไร** ส่งให้ทีมก่อนลองใหม่

## 9. สคริปต์ snapshot (งานแยกใน orca-pilot ยังไม่ได้ทำ)

contract อยู่ใน `spec.md` §7: ส่งทุก 10 นาที, อ่าน frontmatter เท่านั้น, ส่ง 7 key (`job_id, project, title, status, created, updated, from`) ห้ามเนื้องาน ห้าม `reason:`, `title` ≤ 120 ตัวอักษรไม่มีขึ้นบรรทัดใหม่, ไม่ใช่ 2xx ให้ log แล้วรอรอบถัดไป ก่อนสคริปต์เสร็จ กล่องงานทีมจะขึ้น "ยังไม่เชื่อม"
