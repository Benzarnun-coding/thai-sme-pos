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
2. **Facebook**: สร้าง Meta App → ขอ token ของเพจที่มี `pages_read_engagement`, `read_insights` และ `ads_read` แล้วใส่ `.env` (ดู `.env.example`)
   `pnpm sync:facebook` หรือปล่อยให้ scheduler ดึงทุก 6 ชั่วโมง
3. **Postgres จริง**: ตั้ง `DATABASE_URL=postgres://...` ทุกอย่างเหมือนเดิม

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

- Project 2: Rules Engine + budget_ledger + LINE digest รายคืน
- Project 3: Copywriter/QA + คิวอนุมัติ + โพสต์ organic
- Project 4: Campaign manager + Strategist/Analyst (loop ปิด)
- Project 5: แชท/คอมเมนต์ + Audience
