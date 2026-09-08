# thai-sme-pos + LoopDesk

แอป POS (React + Vite) และ **LoopDesk** ระบบการตลาดอัตโนมัติสำหรับร้านกางเกงยีนส์ Climax by PKjeans
ที่ต่อกับ Facebook / TikTok / Shopee แบบ full loop (ตอนนี้อยู่ที่ Project 1: ฐานข้อมูล + ข้อมูลจริง ยังไม่มี AI)

## เปิดเล่นในเครื่อง (คำสั่งเดียว)

ต้องมี Node.js 20+ (มี npm มาด้วย)

```bash
git clone https://github.com/Benzarnun-coding/thai-sme-pos.git
cd thai-sme-pos
git checkout claude/ai-automation-fbads-content-anvwrg
npm run demo
```

สคริปต์จะติดตั้ง dependencies, สร้างฐานข้อมูลตัวอย่าง (ร้าน climax, 52 SKU, ยอดขาย 30 วันจำลอง),
เปิด API ที่ `http://localhost:3001` และเปิดเบราว์เซอร์ที่ **http://localhost:5173/#Marketing** ให้เอง
กด Ctrl+C เพื่อหยุด

ถ้าอยากรันแยกเอง

```bash
pnpm server:seed      # ครั้งแรกครั้งเดียว
pnpm server:dev       # API :3001
npm run dev           # เว็บ :5173 → เมนู MARKETING
```

## เอกสาร

| ไฟล์ | เนื้อหา |
|---|---|
| `docs/ai-ads-automation-design.md` | ภาพรวม full loop, module map 15 โมดูล, ลำดับการสร้าง |
| `docs/data-architecture.md` | แยกงาน Automation / AI / คน, schema, events, guardrails |
| `docs/mockup/loopdesk.html` | mockup UI ทุกโมดูล (เปิดไฟล์ในเบราว์เซอร์ได้เลย) |
| `server/README.md` | API, การนำเข้า CSV จาก Bigseller, การต่อ Facebook |

## โครงสร้าง

```
src/                 แอป POS (React) + src/marketing/ หน้า MARKETING ที่อ่านจาก API
server/              LoopDesk API (Fastify + PGlite/Postgres)
docs/                เอกสารออกแบบและ mockup
scripts/demo.mjs     รันทุกอย่างด้วยคำสั่งเดียว
```

## ต่อข้อมูลจริง (ฐานข้อมูลจริงอยู่บน PC Windows)

แนะนำให้รันทั้งชุดบน PC Windows ที่มี Bigseller / แคตตาล็อกอยู่ เพราะข้อมูลจะได้อยู่เครื่องเดียวกัน
(ใช้ PowerShell คำสั่งเหมือนกันทุกอย่าง) แล้วเปิดจาก MacBook ผ่าน `http://<ip-ของ-pc>:5173` ในวง LAN เดียวกันได้

1. **แคตตาล็อกจริง** เอาไฟล์ `LOCATION_SKU.xlsx` (tab ต่อสถานที่ PK, CM, BB, AR, BT, AM, SP, MN, JW, MK) มาวางแล้ว

   ```bash
   cd server
   pnpm import:xlsx "C:\path\LOCATION_SKU.xlsx" PK      # ทีละสถานที่ หรือใส่ all
   ```

   ระบบขยาย "ไซส์ที่มี" เป็น SKU ต่อไซส์ แบ่งสต็อกรวมเท่า ๆ กัน และใช้ราคากลางของ "ราคา (ช่วง)" กฎเดียวกับสคริปต์ SPU import
   ไฟล์ export "นำเข้าเพื่อสร้าง SPU" จาก Bigseller ก็ใช้คำสั่งเดียวกันได้ (ตรวจรูปแบบให้เอง)
   ดูตัวอย่างรูปแบบไฟล์ได้ที่ `server/data/LOCATION_SKU.sample.xlsx`
2. **Facebook** ใส่ `FB_PAGE_ID`, `FB_PAGE_TOKEN` (และ `FB_AD_ACCOUNT_ID`) ใน `server/.env` → `pnpm sync:facebook`
3. **Postgres จริง** ตั้ง `DATABASE_URL` ใน `server/.env`

### ต่อข้อมูลจริง (สรุป)

1. **สินค้า/สต็อก** export CSV จาก Bigseller (คอลัมน์ sku, ชื่อสินค้า, ราคา, คงเหลือ) → `cd server && pnpm import:sku ไฟล์.csv`
2. **Facebook** ใส่ `FB_PAGE_ID`, `FB_PAGE_TOKEN` (และ `FB_AD_ACCOUNT_ID`) ใน `server/.env` → `pnpm sync:facebook`
3. **Postgres จริง** ตั้ง `DATABASE_URL` ใน `server/.env`
