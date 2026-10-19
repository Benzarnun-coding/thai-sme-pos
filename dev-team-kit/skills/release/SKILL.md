---
name: release
description: งาน DevOps 3 แบบ — ตั้ง pipeline (setup), เช็คลิสต์ก่อนปล่อยขึ้น production (release) และรับมือระบบล่ม (incident) ทุกอย่างที่แตะ production ต้องได้อนุมัติจากผู้ใช้ก่อน
---

# /release

บอกก่อนเริ่มว่าใช้แบบไหน: **A setup · B release · C incident**

## A — Setup pipeline

ทำตามลำดับ และบอกว่าข้อไหนมีอยู่แล้ว/ข้าม: container หรือ runtime · CI · environment (dev/staging/prod) · migration ใน deploy · secrets · observability · alert · backup (ต้องลอง restore จริง) · ค่าใช้จ่าย/ลิมิตของ plan

## B — Release checklist

- [ ] CI เขียวบน commit ที่จะ deploy, deploy จาก checkout ที่สะอาด
- [ ] lookout ให้ Go (หรือ Go with risks ที่ผู้ใช้รับรู้แล้ว)
- [ ] migration ทดสอบกับข้อมูลรูปแบบจริง และเข้ากับเวอร์ชันก่อนหน้าได้
- [ ] ของใหม่ที่เขียนออกนอกระบบปิดไว้เป็นค่าเริ่มต้น
- [ ] รู้เวอร์ชันและคำสั่ง rollback
- [ ] config / secret ครบ
- [ ] smoke test + health check พร้อม
- [ ] **ผู้ใช้อนุมัติ deploy ครั้งนี้แล้ว** (ยกคำอนุมัติมาใส่ DEPLOY-LOG)

หลัง deploy: health check → บันทึก `docs/team/DEPLOY-LOG.md` (วันที่, sha, เวอร์ชัน, คนอนุมัติ, ผล, วิธี rollback)

## C — Incident

1. **ทำให้นิ่ง** — rollback หรือปิดฟีเจอร์ก่อนสืบ (ถ้าต้องแตะ production ขออนุมัติแบบสั้นที่สุด)
2. **สื่อสาร** — เกิดอะไร, กระทบใคร, ตอนนี้ทำอะไรอยู่
3. **วินิจฉัย** — จากหลักฐาน (log, metric, diff) ไม่ใช่จากการเดา
4. **Postmortem** — ไม่โทษคน: timeline, สาเหตุ, ทำไม check ไม่จับ, สิ่งที่จะแก้ ลง `docs/team/ops/`

## ห้าม

แตะ production / ลบข้อมูล / rotate secret / ใช้เงิน โดยไม่มีอนุมัติสำหรับงานนั้น · commit secret · ปิด check เพื่อให้ผ่าน
