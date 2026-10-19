# ทีม Helm — ทีมพัฒนาของ Benz

ทีม agent สำหรับ Claude Code มีหัวหน้า 1 คน (Helm) ที่รับคำสั่งแล้วแยกงานให้ลูกทีม 7 คน
ตั้งชื่อตามส่วนของเรือ เพื่อให้จำบทบาทได้จากชื่อ

| ชื่อ | บทบาท | ทำไมชื่อนี้ | Model | Skill |
|---|---|---|---|---|
| **helm** | หัวหน้าทีม / Orchestrator | พวงมาลัยเรือ คนสั่งทั้งลำ | opus | — |
| **compass** | Product Owner | เข็มทิศ ชี้ว่าไปทางไหน (what & why) | opus | `/prd` |
| **sonar** | Business Analyst | ส่องหาสิ่งที่ซ่อนใต้น้ำ (กำกวม, edge case) | sonnet | `/stories` |
| **keel** | Solution Architect | กระดูกงู โครงที่เปลี่ยนทีหลังไม่ได้ | opus | `/tech-spec` |
| **sail** | UX/UI Designer | ใบเรือ ส่วนที่คนเห็นและพาเรือไป | opus | `/design-spec` |
| **hull** | Developer | ตัวเรือ ของจริงที่ต้องลอยน้ำได้ | opus | — |
| **lookout** | QA | คนเฝ้ายอดเสา เห็นหินก่อนเรือชน | sonnet | `/test-plan` |
| **harbor** | DevOps | ท่าเรือ ปล่อยของออกและรับกลับได้ปลอดภัย | opus | `/release` |

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

### แบบปกติ: สั่ง Helm ตัวเดียว

เปิด terminal ในโปรเจกต์ (ใน Orca เลือก worktree แล้วเปิด terminal) แล้วรัน:

```bash
claude --agent helm
```

จากนั้นสั่งเป็นภาษาธรรมดา เช่น
- "อยากให้ร้านค้าดูยอดขายรายวันได้จากมือถือ"
- "หน้า checkout กดจ่ายแล้วค้าง ช่วยดูหน่อย"
- "deploy เวอร์ชันล่าสุดขึ้น production"

Helm จะจัดประเภทงาน เลือกคนทำ ส่งงานผ่าน subagent แล้วรายงานกลับ ใน Orca ลูกทีมแต่ละคนจะขึ้นเป็นแถวลูกใต้ terminal ของ Helm
ถ้าอยากเรียกใครตรงๆ ก็พิมพ์ชื่อได้ เช่น "ให้ lookout ตรวจ PR นี้"

### Orca mode: งานยาว หรืออยากได้หลายทางคู่ขนาน

Helm สั่ง Orca CLI เปิด worktree + terminal แยกให้ลูกทีม (`orca worktree create`, `orca terminal create --command "claude --agent hull"`, `terminal send / wait / read`) แล้วเก็บผลกลับมาเอง
ใช้เมื่อ: implement ชิ้นใหญ่ที่ควรมี worktree ของตัวเอง, ให้ hull 2–3 ตัวลองคนละวิธีแล้วเลือก, หรือสั่งเองว่า "ใช้ Orca"
ถ้าเครื่องไม่มี `orca` Helm จะกลับไปใช้ subagent

### เรียกลูกทีมตัวเดียวโดยไม่ผ่าน Helm

```bash
claude --agent hull       # คุยกับ dev ตรงๆ
```

หรือใน session ปกติ พิมพ์ `@hull ...` หรือใช้ skill ตรงๆ เช่น `/prd`, `/test-plan`

## ความจำของทีม

ทีมส่งงานกันผ่านไฟล์ ไม่ใช่ผ่านความจำของ session:

```
docs/team/BOARD.md     กระดานงาน (Helm แก้คนเดียว) ← เปิด session ใหม่แล้วทำต่อได้จากไฟล์นี้
docs/team/prd/  stories/  specs/  adr/  design/  qa/  ops/  DEPLOY-LOG.md
```

ข้อดีเมื่อเทียบกับแบบ 7 pane ค้างไว้: restart เครื่องแล้วไม่ต้อง resume session ทีละ pane แค่เปิด `claude --agent helm` ใหม่ มันอ่าน BOARD.md แล้วทำต่อ

## กฎกลาง (อยู่ในไฟล์ของทุกคนแล้ว)

- แตะ production, ลบข้อมูล, rotate secret, ส่งข้อความหาลูกค้า หรือใช้เงิน: Helm ถามคุณก่อนทุกครั้ง
- ของที่เขียนออกนอกระบบ ship แบบปิดไว้ + มี dry run ให้ดูก่อน คุณเป็นคนเปิด
- ห้ามรายงานว่าเสร็จถ้ายังไม่ได้รันจริง ห้ามแต่งตัวเลข
- CLAUDE.md ของโปรเจกต์ชนะกฎของทีมเสมอ

## ปรับแต่ง

แก้ไฟล์ใน `~/.claude/agents/<ชื่อ>.md` ได้เลย: `description` คือสิ่งที่ Helm ใช้ตัดสินว่าจะส่งงานให้ใคร, `model` เปลี่ยนเป็น `opus` / `sonnet` / `haiku` ได้, `tools` คือเครื่องมือที่คนนั้นใช้ได้
เพิ่มลูกทีมใหม่: สร้างไฟล์ใหม่ใน `agents/` แล้วเพิ่มชื่อในตารางลูกทีมของ `helm.md`
