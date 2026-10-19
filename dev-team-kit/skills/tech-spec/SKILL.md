---
name: tech-spec
description: ออกแบบ how ก่อนเขียนโค้ด (data model, API, การแยกข้อมูล, failure modes, migration, ทางเลือก) และเขียน ADR สำหรับการตัดสินใจระยะยาว
---

# /tech-spec

## ก่อนเขียน

- อ่านโค้ดจริงในส่วนที่เกี่ยวข้อง และ CLAUDE.md ของโปรเจกต์ (ข้อจำกัดของ platform อยู่ในนั้นบ่อย)
- ขอตัวเลขโหลดจริง (ผู้ใช้, request/วัน, ขนาดข้อมูล) ถ้าไม่มีให้เขียน ASSUMPTION

## โครง (16 หัวข้อ)

1. สรุป (3 บรรทัด)
2. เป้าหมาย / ไม่ใช่เป้าหมาย
3. ตอนนี้ระบบเป็นยังไง (อ้าง path ไฟล์จริง)
4. Design (Mermaid)
5. Data model — DDL + วิธีแยกข้อมูลของแต่ละตาราง
6. API — endpoint, input, output, error
7. สิทธิ์ — จุดบังคับเดียว + ตาราง role × action
8. Security
9. Failure modes — อะไรพังได้ แล้วระบบทำอะไร
10. Performance — cache และการล้าง cache, queue
11. Observability — log, metric, alert อะไร
12. Migration & rollout — ต้องเข้ากับแอปเวอร์ชันก่อนหน้าได้, ปิด/เปิดยังไง
13. ทางเลือกอื่น (ห้ามว่าง)
14. Tradeoffs
15. คำถามค้าง
16. Work breakdown — ชิ้นงานแบบ vertical slice เรียงลำดับ พร้อมไฟล์ที่น่าจะแตะ

## ADR

การตัดสินใจที่ย้อนยาก เขียน `docs/team/adr/NNNN-slug.md` (เลขถัดไปที่ว่าง):
Context · Decision · Alternatives · Consequences (ดี / เสีย — ฝั่งเสียห้ามว่าง) · ต้นทุนการย้อนกลับ

บันทึก spec ที่ `docs/team/specs/<slug>.md`
