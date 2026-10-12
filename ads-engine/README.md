# ads-engine

ตัวคุม Meta Ads ด้วยกฎ ต่อ Marketing API ตรง ไม่ผ่านคนกลาง ไม่ใช้ LLM รันคำสั่งเดียว

```
fetch (campaigns, ad sets, insights) → evaluate rules.json → apply (ถ้าไม่ใช่ dry run) → logs/*.json → LINE (ถ้าตั้งไว้)
```

ไม่มี dependency ใช้ Node 22.6 ขึ้นไป (เครื่องนี้ Node 24)

## ตั้งค่าครั้งแรก

1. สร้าง access token
   - Meta Business Suite → Settings → Users → **System Users** → Add
   - ให้สิทธิ์ ad account ที่จะใช้ แล้ว Generate Token เลือกสิทธิ์ `ads_read` และ `ads_management`
   - token แบบ System User ไม่หมดอายุ 60 วันเหมือน token ธรรมดา
2. คัดลอกไฟล์ env แล้วกรอก

```bash
cp ads-engine/.env.example ads-engine/.env
```

3. แก้ `rules.json` ให้ตรงกับตัวเลขของร้าน ค่าเริ่มต้นเป็นแค่ตัวอย่าง

## รัน

โหมดปกติคือ dry run รายงานอย่างเดียว ไม่แตะ Meta

```bash
cd ads-engine && npm run run
```

ปรับจริง

```bash
cd ads-engine && npm run apply
```

หยุดทุกอย่างทันที: ตั้ง `KILL_SWITCH=true` ใน `.env`

## ตั้งเวลาให้รันเอง วันละ 2 รอบ

> ถ้าใช้ `ads-web` (Cloudflare) อยู่ ไม่ต้องตั้ง cron นี้ — ads-web รันตามเวลาให้แล้ว ถ้าตั้งทั้งสองที่ กฎจะทำงานซ้ำกับแคมเปญเดียวกัน

เปิด crontab

```bash
crontab -e
```

เพิ่มบรรทัด (08:00 และ 20:00 ทุกวัน)

```
0 8,20 * * * cd /Users/benzarnun/Desktop/thai-sme-pos/ads-engine && /usr/local/bin/node --env-file=.env src/run.ts >> logs/cron.log 2>&1
```

ตรวจ path ของ node ด้วย `which node` แล้วแก้ให้ตรง

## รูปแบบกฎ

หนึ่งกฎ = หนึ่ง object ใน `rules.json` เรียงตามความสำคัญ กฎแรกที่ตรงจะได้ทำ กฎถัดไปบน entity เดียวกันจะถูกข้าม

| field | ค่า |
|---|---|
| `level` | `adset` หรือ `campaign` |
| `window` | `today` `yesterday` `last_3d` `last_7d` `last_14d` `last_30d` |
| `metric` | `spend` `impressions` `clicks` `ctr` `cpc` `frequency` `purchases` `cpa` `roas` `messages` `cost_per_message` |
| `op` | `>` `>=` `<` `<=` |
| `min_spend` | ประเมินเฉพาะเมื่อใช้เงินในช่วงนั้นถึงเท่านี้ กันสัญญาณหลอก |
| `action.type` | `pause` `enable` `budget_pct` `notify` |
| `action.pct` | สำหรับ `budget_pct` เช่น `20` หรือ `-30` |
| `cooldown_hours` | ห้ามกฎเดิมทำซ้ำบน entity เดิมภายในกี่ชั่วโมง ค่าเริ่มต้น 24 |

`scope` จำกัดให้ทำเฉพาะแคมเปญที่ชื่อขึ้นต้นด้วยคำที่กำหนด หรือระบุ campaign id ตรง ๆ ว่างไว้ = ทุกแคมเปญ

`guardrails` ใช้กับทุกกฎ

- `max_change_pct_per_run` ปรับงบครั้งละไม่เกินกี่ %
- `min_daily_budget` / `max_daily_budget` งบต่อ ad set ห้ามต่ำหรือสูงกว่านี้
- `max_total_daily_budget` งบรวมทั้ง scope หลังปรับห้ามเกินนี้

`messages` คือ "การสนทนาผ่านข้อความที่เริ่มแล้ว" ตัวเดียวกับที่ Ads Manager โชว์ในแคมเปญ objective ข้อความ `cost_per_message` = spend ÷ messages ใช้กฎชุดนี้กับแอดทักแชท และใช้ `cpa` / `roas` กับแอดที่ปิดการขายบนเว็บผ่าน pixel

หมายเหตุ: `budget_pct` ใช้ได้กับ entity ที่ถืองบเอง ad set ใต้แคมเปญ CBO ไม่มีงบของตัวเอง ให้เขียนกฎ `level: campaign` แทน

## ไฟล์ที่ระบบสร้าง

- `logs/<เวลา>.json` ทุกการรัน มีทุก decision พร้อมเหตุผลที่ทำหรือข้าม
- `state.json` เวลาล่าสุดที่แต่ละกฎทำกับแต่ละ entity ใช้คิด cooldown เขียนเฉพาะโหมด apply

## ทดสอบ logic โดยไม่ต้องมี token

```bash
cd ads-engine && npm test
```
