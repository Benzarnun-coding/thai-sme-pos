# Benz Stoic Lab — ทีมซอฟต์แวร์ของ Benz

ทีม agent สำหรับ Claude Code มีหัวหน้า 1 คน (Marcus) ที่รับงานซอฟต์แวร์แล้วแยกงานให้ลูกทีม 7 คน
ตั้งชื่อตามนักปรัชญาสโตอิกและคุณธรรมที่แต่ละบทบาทต้องมี

**ใครอยู่ตรงไหน:** Hermes เป็นผู้ช่วยกลางของทุกธุรกิจ ส่งงานซอฟต์แวร์ให้ Marcus และรับรายงานกลับ · Notion เก็บ Benz DNA และบันทึกงานกลาง · `docs/team/` และ `BOARD.md` เก็บรายละเอียดงานซอฟต์แวร์ (ยังไม่ได้เชื่อม Hermes: ตอนนี้สั่ง Marcus ตรงจาก terminal)

| ชื่อ | บทบาท | ทำไมชื่อนี้ | Model | Skill |
|---|---|---|---|---|
| **marcus** | CEO / หัวหน้าทีมซอฟต์แวร์ (Orchestrator) | Marcus Aurelius นำด้วยเหตุผลและหน้าที่ | opus | — |
| **seneca** | Strategy & Product | Seneca คิดเรื่องเวลาและสิ่งที่ควรทำก่อน (what & why) | opus | `/prd` |
| **clarity** | Business Analyst | ทำทุกอย่างให้ชัด ไม่เหลือความกำกวม | sonnet | `/stories` |
| **wisdom** | Solution Architect | รู้ว่าอะไรเปลี่ยนทีหลังได้ยาก แล้วตัดสินให้ถูก | opus | `/tech-spec` |
| **harmony** | UX/UI Designer | ทุกส่วนบนหน้าจอทำงานไปทางเดียวกัน | opus | `/design-spec` |
| **courage** | Developer | ลงมือทำของจริง และบอกตรงๆ ว่าอะไรยังไม่เสร็จ | opus | — |
| **justice** | QA | ตัดสินตามหลักฐาน ไม่เอนตามคนเขียนโค้ด | sonnet | `/test-plan` |
| **temperance** | DevOps | ปล่อยของทีละน้อย ไม่เร่งเกินเหตุ | opus | `/release` |

ใช้ Opus กับตำแหน่งที่ตัดสินผิดแล้วแพง (scope, โครงสร้าง, โค้ด, production, design) และ Sonnet กับตำแหน่งที่อ่าน/เขียนเยอะ (requirements, testing)
model ในไฟล์เป็น alias ของ Claude (`opus`, `sonnet`) เลยใช้ได้ทั้งตอนรันใน terminal และตอนถูกเรียกเป็น subagent ไม่ต้องพึ่ง proxy

## ติดตั้ง (บน Mac ครั้งเดียว)

```bash
git clone -b claude/gracious-goldberg-39nskx https://github.com/Benzarnun-coding/thai-sme-pos.git /tmp/team
bash /tmp/team/dev-team-kit/install.sh
```

ไฟล์จะไปอยู่ที่ `~/.claude/agents/` และ `~/.claude/skills/` ใช้ได้กับทุกโปรเจกต์
ถ้ามีไฟล์ชื่อซ้ำ (เช่น skill `prd`, `tech-spec`, `test-plan` ของชุดเดิม) script จะย้ายของเดิมไปไว้ที่ `~/.claude/backup-<เวลา>/` ก่อน ไม่ลบทิ้ง

## ใช้งาน

### แบบปกติ: สั่ง Marcus ตัวเดียว

เปิด terminal ในโปรเจกต์ (ใน Orca เลือก worktree แล้วเปิด terminal) แล้วรัน:

```bash
claude --agent marcus
```

จากนั้นสั่งเป็นภาษาธรรมดา เช่น
- "อยากให้ร้านค้าดูยอดขายรายวันได้จากมือถือ"
- "หน้า checkout กดจ่ายแล้วค้าง ช่วยดูหน่อย"
- "deploy เวอร์ชันล่าสุดขึ้น production"

Marcus จะจัดประเภทงาน เลือกคนทำ ส่งงานผ่าน subagent แล้วรายงานกลับ ใน Orca ลูกทีมแต่ละคนจะขึ้นเป็นแถวลูกใต้ terminal ของ Marcus
ถ้าอยากเรียกใครตรงๆ ก็พิมพ์ชื่อได้ เช่น "ให้ justice ตรวจ PR นี้"

### Orca mode: งานยาว หรืออยากได้หลายทางคู่ขนาน

Marcus สั่ง Orca CLI เปิด worktree + terminal แยกให้ลูกทีม (`orca worktree create`, `orca terminal create --command "claude --agent courage"`, `terminal send / wait / read`) แล้วเก็บผลกลับมาเอง
ใช้เมื่อ: implement ชิ้นใหญ่ที่ควรมี worktree ของตัวเอง, ให้ courage 2–3 ตัวลองคนละวิธีแล้วเลือก, หรือสั่งเองว่า "ใช้ Orca"
ถ้าเครื่องไม่มี `orca` Marcus จะกลับไปใช้ subagent

### เรียกลูกทีมตัวเดียวโดยไม่ผ่าน Marcus

```bash
claude --agent courage       # คุยกับ dev ตรงๆ
```

หรือใน session ปกติ พิมพ์ `@courage ...` หรือใช้ skill ตรงๆ เช่น `/prd`, `/test-plan`

## ความจำของทีม

ทีมส่งงานกันผ่านไฟล์ ไม่ใช่ผ่านความจำของ session:

```
docs/team/BOARD.md     กระดานงาน (Marcus แก้คนเดียว) ← เปิด session ใหม่แล้วทำต่อได้จากไฟล์นี้
docs/team/prd/  stories/  specs/  adr/  design/  qa/  ops/  DEPLOY-LOG.md
```

ข้อดีเมื่อเทียบกับแบบ 7 pane ค้างไว้: restart เครื่องแล้วไม่ต้อง resume session ทีละ pane แค่เปิด `claude --agent marcus` ใหม่ มันอ่าน BOARD.md แล้วทำต่อ

## กฎกลาง (อยู่ในไฟล์ของทุกคนแล้ว)

- แตะ production, ลบข้อมูล, rotate secret, ส่งข้อความหาลูกค้า หรือใช้เงิน: Marcus ถามคุณก่อนทุกครั้ง
- ของที่เขียนออกนอกระบบ ship แบบปิดไว้ + มี dry run ให้ดูก่อน คุณเป็นคนเปิด
- ห้ามรายงานว่าเสร็จถ้ายังไม่ได้รันจริง ห้ามแต่งตัวเลข
- CLAUDE.md ของโปรเจกต์ชนะกฎของทีมเสมอ

## ปรับแต่ง

แก้ไฟล์ใน `~/.claude/agents/<ชื่อ>.md` ได้เลย: `description` คือสิ่งที่ Marcus ใช้ตัดสินว่าจะส่งงานให้ใคร, `model` เปลี่ยนเป็น `opus` / `sonnet` / `haiku` ได้, `tools` คือเครื่องมือที่คนนั้นใช้ได้
เพิ่มลูกทีมใหม่: สร้างไฟล์ใหม่ใน `agents/` แล้วเพิ่มชื่อในตารางลูกทีมของ `marcus.md`
