---
name: design-spec
description: ออกแบบหน้าจอก่อน implement: page spec, design tokens, component states, motion spec, prototype HTML ไฟล์เดียว และ checklist ไว้ตรวจงาน UI หลัง dev ทำเสร็จ
---

# /design-spec

## ก่อนออกแบบ

- อ่าน story/AC ที่เกี่ยวข้อง และดู UI/design system ที่มีอยู่ในโปรเจกต์ ใช้ของเดิมก่อน
- เขียนงานของแต่ละหน้าใน 1 ประโยค ถ้าเขียนไม่ได้ ให้แยกหน้า

## ผลงาน (ใน `docs/team/design/<slug>/`)

1. **page-spec.md** — ต่อหน้า: งาน 1 ประโยค, ลำดับสิ่งที่ตาเห็น, ข้อมูลที่แสดงและที่มา, action หลัก 1 อย่าง, ข้อความ (ภาษาไทยจริง ไม่ใช่ lorem)
2. **tokens** — สี (light + dark), ตัวอักษร (รองรับไทย), ระยะห่าง, มุมโค้ง, เงา — ใช้ชื่อตามบทบาท (`--surface`, `--text-muted`) ไม่ใช่ตามสี
3. **states** — ทุก component: ปกติ · hover · focus · disabled · loading · ว่าง · error
4. **motion.md** — ทุก animation: สื่ออะไร, duration, easing, ทางเลือกเมื่อ `prefers-reduced-motion`
5. **prototype.html** — ไฟล์เดียว HTML/CSS/JS ไม่มี build step เปิดในเบราว์เซอร์ได้ทันที ใช้ได้ที่ความกว้าง 360px
6. **qa-checklist.md** — สิ่งที่จะตรวจในงานของ dev: ระยะ, สี, states ครบ, คีย์บอร์ด, contrast AA, มือถือ, ข้อความไทยยาวไม่ล้น

## ห้าม

emoji ใน UI · gradient blob · badge "AI-powered" · ตัวเลข/รีวิว/โลโก้ปลอม · เปลี่ยน functionality ระหว่าง redesign
