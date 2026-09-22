# LoopDesk server · Project 1 (ฐานข้อมูล + ข้อมูลจริง ยังไม่มี AI)

สิ่งที่โปรเจกต์นี้ให้

- ฐานข้อมูลตามเอกสาร `docs/data-architecture.md` (store, connection, raw_event, audit_log, product/variant/stock_level/size_rule, fact_*, brand_doc)
- นำเข้าสินค้ารายไซส์จาก CSV ของ Bigseller / POS (SKU `[ประเภท]-[สถานที่]-[สี]-[ขนาด]`)
- ตัวเชื่อม Facebook **อ่านอย่างเดียว**: ผู้ติดตามเพจ โพสต์ + insights และผลแอดรายวัน ลง raw_event ก่อนแล้วค่อยแปลงเป็น facts
- Signal builder: ต่อสินค้า 1 แถว บอกยอด 7/30 วัน แนวโน้ม สต็อกรายไซส์ และ **ห้ามยิงแอดถ้าไซส์ขายดี (30/32/34) ขาด**
- Knowledge Base: brand voice, จุดขาย, คำต้องห้าม, ตารางไซส์ ใน `knowledge/climax/*.md`
- API สำหรับหน้า Marketing ในแอป POS

## รัน

```bash
cd server
pnpm install
pnpm seed          # สร้างตาราง + ร้าน climax + สินค้าตัวอย่าง 52 SKU + ยอดขาย 30 วัน (จำลอง) + brand docs
pnpm dev           # API ที่ http://localhost:3001  (ฐานข้อมูลฝังในตัว server/data/pglite)
pnpm test          # 22 tests
```

จากโฟลเดอร์หลัก: `pnpm server:seed`, `pnpm server:dev`, แล้ว `npm run dev` เปิดแอป POS → เมนู **MARKETING**

## ต่อข้อมูลจริง

0. **LOCATION_SKU.xlsx (แคตตาล็อกหลักบน PC Windows)**: `pnpm import:xlsx LOCATION_SKU.xlsx PK` (หรือ `all`)
   รองรับทั้งรูปแบบ LOCATION_SKU (tab ต่อสถานที่, header แถว 2) และไฟล์ "นำเข้าเพื่อสร้าง SPU" ของ Bigseller
   แถวที่สีเป็น `ZZ` หรือรุ่นขึ้นต้น `IT` จะนำเข้าพร้อมคำเตือน ไม่ข้าม
1. **สินค้า/สต็อกจริง (CSV)**: export จาก Bigseller เป็น CSV ที่มีคอลัมน์ `sku, name, category, price, qty` (หัวคอลัมน์ภาษาไทยก็ได้) แล้ว
   `pnpm import:sku path/to/file.csv` หรือ `POST /api/stores/climax/import/sku {csv}` ทุกครั้งที่นำเข้า = snapshot ใหม่ (ไม่ทับของเก่า)
2. **Facebook แบบกดเชื่อมต่อ**: สร้าง Meta App แล้วตั้ง `FB_APP_ID`, `FB_APP_SECRET`, `API_BASE_URL`, `PUBLIC_URL`, `TOKEN_ENC_KEY` (64 hex)
   ปุ่ม "เชื่อมต่อ Facebook" ในแอปจะเปิด Login ของ Facebook จริงแล้วให้เลือกเพจ/บัญชีโฆษณา · admin ของแอปใช้เพจตัวเองได้ทันทีในโหมด Development
   ร้านอื่นต้องผ่าน App Review ก่อน (ชุดยื่นอยู่ที่ `docs/meta-app-review.md` · หน้า `/privacy` และ `/data-deletion` มีให้แล้ว)
   `LOOPDESK_PHASE=4` เพื่อขอสิทธิ์โพสต์/แอดด้วย · หรือแบบเดิม: ใส่ token ใน `.env` แล้ว `pnpm sync:facebook`
3. **AI**: ใส่ `ANTHROPIC_API_KEY` → กล่อง AI ใช้ `claude-opus-5` (ไม่ใส่ = โหมดตัวอย่าง) · `LOOPDESK_THB_PER_USD` (ค่าเริ่มต้น 35) สำหรับมิเตอร์
   เพดานรายเดือนตั้งได้ในหน้าระบบหลังบ้าน (`PUT /api/stores/:id/settings/ai-cap`) ถึงเพดานแล้ว AI หยุด อัตโนมัติยังเดิน
4. **ตัวตั้งเวลา**: เปิดอัตโนมัติเมื่อรันเซิร์ฟเวอร์ (Asia/Bangkok) `LOOPDESK_SCHEDULER=off` เพื่อปิด · รอบเช้า 05:45–06:20 · รอบเย็น 18:15 / 21:00 · ตัวโพสต์เช็คคิวทุก 5 นาที
   รอบตามเวลาจะข้ามกล่อง AI ที่ข้อมูลไม่เปลี่ยนจากรอบก่อน (diff gate) ยกเว้นนักรายงาน
5. **LINE**: `LINE_CHANNEL_ACCESS_TOKEN` + `LINE_TO` (user/group id) + `APP_URL` → งานรออนุมัติและรายงานประจำวันถูกส่งเข้า LINE
6. **Postgres จริง**: ตั้ง `DATABASE_URL=postgres://...` ทุกอย่างเหมือนเดิม

## Endpoints

| Method | Path | ใช้ทำอะไร |
|---|---|---|
| GET | `/api/health` | สถานะ + ชนิดฐานข้อมูล |
| GET | `/api/stores/:id/summary` | ยอด 7 วัน งบแอด ROAS ผู้ติดตาม ยอดรายวัน 14 วัน |
| GET | `/api/stores/:id/signals` | สัญญาณต่อสินค้า (ยอด แนวโน้ม สต็อกรายไซส์ promotable) |
| GET | `/api/stores/:id/products` · `/products/:pid/stock` | สินค้าและสต็อกรายไซส์ |
| GET | `/api/stores/:id/connections` | ช่องทางที่เชื่อม สถานะ sync ล่าสุด error |
| GET | `/api/stores/:id/posts` · `/ads` | โพสต์และแอดจาก Facebook (หลัง sync) |
| GET | `/api/stores/:id/brand` | brand docs |
| GET | `/api/stores/:id/audit` | audit log 50 รายการล่าสุด |
| POST | `/api/stores/:id/import/sku` | นำเข้า CSV |
| POST | `/api/stores/:id/sync/facebook` | ดึงข้อมูล Facebook ตอนนี้ |
| GET | `/api/studio/catalog` · `/api/studio/scheduler` | กล่องทั้ง 13 · เวลารันถัดไป |
| GET/PUT/POST | `/api/stores/:id/agents/:slug` · `/run` · `/chat` · `/feedback` · `/reset` | สอน รัน คุย ให้คะแนน กล่อง |
| GET | `/api/stores/:id/runs` · `/work` · `/trends` · `/usage` | ผลรัน · งานที่ส่งต่อกัน/คิวอนุมัติ · เทรนด์ · มิเตอร์ token |
| POST | `/api/stores/:id/work/:wid/decide` · `/directives` · `/directives/:id/run` | อนุมัติ/ไม่อนุมัติ · สั่งงานจากเทรนด์ |
| PUT | `/api/stores/:id/settings/ai-cap` | เพดาน AI รายเดือน |
| GET | `/api/stores/:id/budget` | เพดานงบแอด ใช้ไปวันนี้/เดือนนี้ และ ledger |
| GET | `/privacy` · `/data-deletion` | หน้าสาธารณะสำหรับ Meta |
| POST | `/api/meta/data-deletion` · `/api/meta/deauthorize` | callback จาก Meta (`signed_request`) |

## โครงสร้าง

```
server/
  src/db/            client (pg หรือ PGlite) · migrate · migrations/*.sql
  src/catalog/       sku parser · CSV import
  src/connectors/    facebook (read-only) · normalizers ทดสอบได้โดยไม่ต้องต่อเน็ต
  src/signals/       product signals · store summary
  src/knowledge/     brand docs loader
  src/api/           Fastify routes
  src/jobs/          scheduler (node-cron)
  knowledge/climax/  voice · usp · forbidden · sizes
  data/sample-sku.csv
  test/              vitest (in-memory PGlite)
```

## ยังไม่ทำในโปรเจกต์นี้ (ตามลำดับที่ออกแบบ)

- โพสต์/ตั้งแอดจริง (ตอนนี้ตัวโพสต์ "จำลอง" จนกว่าจะได้สิทธิ์ `pages_manage_posts` / `ads_management`)
- Batch API สำหรับรอบกลางคืน (ลดราคาครึ่งหนึ่ง) · connector Shopee / TikTok หลังได้เป็น partner
- แชท/คอมเมนต์: ตัดออกจากขอบเขต
