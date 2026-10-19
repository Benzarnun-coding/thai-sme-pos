---
name: stories
description: แตก PRD หรือคำขอเป็น user stories พร้อม acceptance criteria แบบ Gherkin, flow และ edge cases ที่ dev สร้างได้และ QA เขียน test ได้โดยไม่ต้องถามกลับ
---

# /stories

## 6 ขั้น

1. **วาด flow** ด้วย Mermaid จาก PRD หรือจากโค้ดเดิม (ถ้าแตก behavior เดิม ต้องอ่านโค้ดก่อน)
2. **แตก story** ตาม step ของ flow, ตาม role, ตามชนิดข้อมูล หรือแยก happy path กับ edge ชิ้นที่ทำไม่จบในรอบเดียวให้แตกต่อ
3. **เขียน story** ตาม template ด้านล่าง
4. **ไล่ edge case**: ว่าง · ค่าขอบ · ทำพร้อมกัน · ระบบภายนอกล่ม · สิทธิ์ไม่พอ · ข้อมูลผิดรูปแบบ
5. **เช็คระบบ**: ใครเห็นได้ (role/ร้าน), ลิมิตแพ็กเกจ, log/audit, ช่วงชีวิตข้อมูล (ทดลอง, ลดแพ็กเกจ, ยกเลิก, ลบ), migration
6. **ตารางสรุป** `ID | ชื่อ | Priority | Size | ขึ้นกับ` เรียงตามลำดับที่ build ได้โดยไม่ติดกัน

## Template

```markdown
### S-01 <ชื่อ>
**ในฐานะ** <ใคร> **ฉันต้องการ** <อะไร> **เพื่อ** <ได้อะไร>

บริบท: <ทำไม / ตอนนี้ระบบทำอะไรอยู่>
Scope: ทำ ... / ไม่ทำ ...
Business rules:
- BR-1 ...
ข้อมูล: <field, ชนิด, ที่มา>

Acceptance criteria:
  Scenario: <behavior เดียว>
    Given ...
    When ...
    Then ...

Non-functional: <ความเร็ว, มือถือ, ภาษา>
ขึ้นกับ: S-xx
คำถามค้าง: <ค่าแนะนำ — ยังไม่ได้ยืนยัน>
ขนาดโดยประมาณ: S / M / L
```

## กฎ

- 1 scenario = 1 behavior ถ้ามีหลาย `When` ให้แยก
- ห้ามแต่ง business rule ใส่เป็นคำถามค้างพร้อมค่าแนะนำ
- บันทึกที่ `docs/team/stories/<slug>.md`
