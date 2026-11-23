# ทีม Agent (`/command?view=agents`) · design spec

> Benz, 16 Nov 2026: "อยากเปิดหน้า Agent เอาไว้ทั้งหมด... เอามา match กับเรา อันไหนขาดก็เติมเข้าไปใน Team ปีหน้าจะเอา 300 ตัว ใส่รายละเอียดเอาไว้เลย"
> Base design: `design.md` (Command Center). Where this file says nothing, `design.md` applies (tokens, focus, colour rules, Thai line-height).

The page's job in one sentence: **เบ๊นเปิดจากมือถือแล้วเห็นว่าแต่ละตำแหน่งในทีมมี agent ทำอยู่หรือยังว่าง และตำแหน่งว่างมีสเปกข้อเสนออะไรรอให้อนุมัติ** (read-only).

Files:
- `agents-mockup.html`: one file, no CDN or fonts. A bar at the top switches between 300 rows, 40 rows, no data and failed to load. The "state อื่น" gallery underneath is mockup only. **Every row is generated** (`[ตำแหน่งตัวอย่าง 001]`, `[agent-001]`, `[ทีม A]`). None of it is a real list.
- `agents-mockup-390.png`: 390 px render. The top is the list. The bottom is the detail of a vacant row that has a proposal.

---

## 0. Decision: one route `/command?view=agents`, data from an API behind the Command login

**Route.** The page is `/command?view=agents`. `CommandApp` in `CommandPage.tsx` looks at `view` and renders the page's entry (`AgentsShell.tsx`), which `lazy()`-loads `AgentsPage.tsx` as its own chunk. `main.tsx` is not touched (it is the shared router for every ads-web page). Why:

1. **One page, one job.** `/command` answers "what do I do today". This page answers "who is in the team and what is missing". The list and its filters stay out of the 10-second page: it only has a link row, and the list code is a separate chunk that the dashboard never downloads.
2. **Access already covers it.** `/command` is the "PkJeans Command" Access app (Benz's email only, checked again in the Worker by `commandIdentity`). A query string is the same path, so there is nothing new to configure. **Don't** move it under `/agents`: that would fall under the main app.
3. **Back and deep links work.** The back arrow goes to `/command`. `/command?view=agents#<id>` opens a row's detail; the detail is a dialog with its own history entry (see §5), and closing it keeps `?view=agents`.
4. **The data is not in the bundle and not in git.** `GET /api/command/agents` (in `worker/command.ts`, same route table as `/api/command/summary`, `who: user | dev`) answers only after the same checks as the summary: no or wrong JWT → 401, service token → 403, a user outside the allowlist → 401. The response is `Cache-Control: private, no-store`. With nothing loaded it is 200 with `data: null`, `status: "missing"` and a note, and the page says "not loaded", never "0 positions". If the stored rows do not add up (a load stopped half way) it is `status: "error"`, `data: null`.

Way in: on `/command`, a link row after the "งานทีม" section and before the Jarvis slot: `cc-card` > `cc-list` > `a.cc-row-link` to `/command?view=agents`, title **"ทีม Agent"**, small line **"ดูทุกตำแหน่ง ตำแหน่งที่ว่าง และข้อเสนอที่รอเบ๊นอนุมัติ"**. No count on that row, because `/command` does not load the data. No SiteNav on the page (Benz, 15 Nov Q1).

**Where the data lives.** Table `command_sources` (migration 0055), several rows, because `wrangler d1 execute` refuses a statement of about 100 KB and the real file is about 200 KB: `agents` is a meta row (`rev`, total, list of parts, the file's top-level fields) and `agents:001`, `agents:002` ... hold the positions. Every row carries the same `rev`; the API only returns a set whose `rev` and counts agree. The summary reads `source IN ('jobs','rss','ytd')` and is not affected. Code: `worker/agentsStore.ts`.

**How it is loaded.** There is no write endpoint. `node scripts/command-agents-sql.mjs <agents.json>` reads the JSON from a path **outside the repo**, validates it (`validateAgents`), prints the counters, and writes SQL to `.wrangler/command-agents.sql` (git-ignored). It never runs wrangler. Local: `npx wrangler d1 execute DB --local --file .wrangler/command-agents.sql`. Remote: done by Benz or temperance after approval, not by the script. `--expect total=N,vacant=N,...` fails the run when a counter differs; `--check` validates only.

> Data and privacy: the repo is public, so the real positions file is **never committed** (not in any commit, not in test fixtures, not in screenshots). Tests use made-up rows (`worker/agentsFixture.ts`); the mockup rows are generated.

---

## 1. Layout (390 px)

```
┌ header sticky 64px ─────────────────────────────┐
│ [‹] ทีม Agent                                    │  ‹ = 44×44 link to /command
│     อ่านอย่างเดียว · อัปเดตข้อมูล 16 พ.ย. 2569      │
└─────────────────────────────────────────────────┘
 ภาพรวม                                N ตำแหน่ง
 ┌ card ───────────────────────────────────────────┐
 │ [ใช้งาน][PK-auto][พัก][ว่าง*]  ← 4 cc-stat       │  * yellow border
 │ มีคนทำ X จาก N ตำแหน่ง · ข้อเสนอรอเบ๊นอนุมัติ P     │
 │ ต่อแผนก (กดแถวเพื่อกรองรายการด้านล่าง)              │
 │ แผนก            มี   ว่าง   สัดส่วน                │
 │ Sales           ..   ..    ▇▇▇▁▁   ← button 44px   │
 │ … 7 departments, then other sources (PK JEANS)    │
 │ ที่มา: …                                          │
 └─────────────────────────────────────────────────┘
 ตำแหน่งทั้งหมด
 ค้นหา [ชื่อตำแหน่ง, agent, ทีม หรือธุรกิจ      ×]   48px
 แผนก  [ทุกแผนก (N)                          ▾]   48px native select
 สถานะ (ทั้งหมด n)(ใช้งาน n)(PK-auto n)(พัก n)(ว่าง n)  chips 44px, wrap
 ทั้งหมด N ตำแหน่ง                     [ล้างตัวกรอง]  aria-live
 ── Sales ─────────────── มี a · ว่าง b   ← sticky under header
 │ [ชื่อตำแหน่ง 2 บรรทัด]                [ใช้งาน] │
 │ agent · ทีม                                 ›  │  row = button ≥64px
 │ [ข้อเสนอ · รอเบ๊นอนุมัติ][นอก SkillTree · PK JEANS] ครอบคลุมบางส่วน
 ── Deals ──── …
 กลับขึ้นด้านบน      (only when ≥ 15 rows show)
 ที่มา: …
```

- One column, `max-width:520px`, padding 16, `cc-sec` gap 22 px. These are the same as `/command`.
- The counters sit above the list because they answer "what is missing" first. The list is for looking things up.

## 2. Data (from `GET /api/command/agents`; format in `web/src/agents/README.md`)

Fields this design uses: `id, department, title, source, agent, team, status (active|paused|pk-auto|vacant), coverage, businesses[], evidence, proposal{label, approved, name, duty, inputs, outputs, scope, team, priority}`.

Defensive reading (the file may arrive partly done):

| field | if missing / odd | shown as |
|---|---|---|
| `agent` null, status ≠ vacant | | "ยังไม่ระบุ agent" (muted) |
| `team`, `evidence`, `businesses` empty | | "ไม่ระบุ" (muted). Evidence on a vacant row: "ไม่มี (ตำแหน่งว่าง)" |
| `coverage` | `full`/`เต็ม` → "ครอบคลุมเต็ม", `partial`/`บางส่วน` → "ครอบคลุมบางส่วน", null → no tag on the row, "ไม่ระบุ" in the detail (vacant: "ยังไม่มี (ว่าง)") |
| `status` unknown value | | treat as `paused` and `console.warn` with the id (never crash, never count it as vacant) |
| `source` | `SkillTree` → no tag on the row. Anything else → source tag. The detail always shows "แหล่ง: {source}" |
| `department` | the 7 SkillTree departments in a fixed order, then the rest in Thai alphabetical order |
| `proposal.inputs/outputs/scope` | string or string[]. Accept both. String → one item |
| `proposal.scope` | map known codes: `draft-only` → "ทำได้แค่ร่าง ไม่ส่งออกเอง", `no-customer` → "ไม่ส่งอะไรถึงลูกค้า", `no-payment` → "ไม่จ่ายเงิน ไม่สั่งซื้อ". Other text shows as written |
| `proposal.priority` | number, 1 = do first ("อันดับ N"). Null → "ยังไม่จัดอันดับ", sorted last |
| `proposal` on a non-vacant row | ignore it on the row, and show it in the detail only if `approved === false` (rare). Don't count it |
| top-level date | if clarity adds `updated` (YYYY-MM-DD), the header shows "อัปเดตข้อมูล {d MMM yyyy th-TH}". Without it the header shows only "อ่านอย่างเดียว" (question Q3) |

Validate the shape once at load (an array of objects that have `id` + `title` + `status`). Skip bad rows, say how many in a muted line under the result count ("ข้ามไป N แถวที่ข้อมูลไม่ครบ"), and log their ids. Duplicate `id` keeps the first one.

## 3. Components and classes

### Reused from `command.css` without changes

`.cc` (root, tokens), `.cc-top`, `.cc-grow`, `.cc-btn`, `.cc-sec`, `.cc-sec-h` + `.cc-when`, `.cc-card`, `.cc-src` (ที่มา line), `.cc-tag` (business pills in the detail), `.cc-stats` / `.cc-stat` / `.cc-stat.cc-need` (four counters, ว่าง = `cc-need`), `.cc-small`, `.cc-jid` (the row id, mono), `.cc-st` + `.cc-done` (status "ใช้งาน"), `.cc-list`, `.cc-chev`, `.cc-empty`, `.cc-banner.cc-err`, `.cc-sk` (skeleton), and the reduced-motion block. Tokens: `--bg --card --card-2 --line --line-2 --text --muted --y --r --y-bg --r-bg --radius --tap --font --mono`. **No new tokens.**

Put the CSS in a new `web/src/agents.css` (imported by `AgentsPage.tsx`) with every selector under `.cc`, like `command.css`. `AgentsPage` also imports `./command.css` for the shared classes. Copy the `/* NEW */` block of the mockup. All new classes start with `cc-ag-`.

### New

| component | class | anatomy / rules |
|---|---|---|
| Back link | `a.cc-btn.cc-ag-back` | 44×44, chevron-left svg, `aria-label="กลับไป Command Center"`, href `/command`. It takes the logo's place, because this page has a parent |
| Department table | `table.cc-ag-depts`, `button.cc-ag-dept-btn` | each row is one `<button aria-pressed>` with a 4-column grid `minmax(0,1fr) 44px 44px 64px`: name · มี · ว่าง (yellow bold if > 0) · mini bar (`cc-ag-mini`, filled share in grey `#d8d8d8`, `aria-hidden`). Press = set that department filter (press again = clear) and scroll to "ตำแหน่งทั้งหมด". `aria-label`: "{แผนก} มี X ว่าง Y จาก N ตำแหน่ง กดเพื่อกรอง". The pressed row has `--y-bg` bg and a yellow name |
| Search | `.cc-ag-search input[type=search]` | 48 px high, 16 px font (iOS doesn't zoom). Visible label "ค้นหา". Placeholder "ชื่อตำแหน่ง, agent, ทีม หรือธุรกิจ". Clear button `.cc-ag-clear` 44×44, `aria-label="ล้างคำค้น"`, shown only when there is text. Hide the native cancel button. `enterkeyhint="search"` |
| Department select | `.cc-ag-field select` | native `<select>` with visible label "แผนก". Options: "ทุกแผนก (N)", then "{แผนก} ({n})" in department order. Native = good on phones and keyboards, and fine at 20+ departments |
| Status chips | `fieldset.cc-ag-seg` > `button.cc-ag-chip[aria-pressed]` | legend "สถานะ". ทั้งหมด · ใช้งาน · PK-auto · พัก · ว่าง, each with a count `<small>` that follows the department filter. Exactly one is pressed. Pressed = yellow bg, black text. 44 px, wraps to 2 lines at 390 |
| Result line | `.cc-ag-result` | `role="status"` (polite): "ทั้งหมด **N** ตำแหน่ง", or "แสดง **n** จาก N ตำแหน่ง" when anything filters, plus the text button "ล้างตัวกรอง" (clears search + department + status) |
| Group header | `.cc-ag-group` > `.cc-ag-gh` | h3 department + "มี a · ว่าง b" (whole department), then "· แสดง n" when filtered. `position:sticky; top:65px` (under the 64 px header + 1 px border), black bg |
| Row | `button.cc-ag-row` (inside `li`) | min-height 64. Left column: title (15/600, 2-line clamp), who-line (13 muted), tags. Right column: status chip + chevron. Who-line: filled = **agent** · team. Vacant + proposal = "ยังไม่มี agent · เสนอ: **{proposal.name}** · ความคุ้มอันดับ N". Vacant, no proposal = "ยังไม่มี agent · ยังไม่มีสเปกข้อเสนอ". A vacant title is `#cfcfcf` so filled rows read first, and it still passes AA. `aria-haspopup="dialog"` |
| Status chip | `.cc-st` + one of the classes below | words always: **ใช้งาน** `cc-done` (light grey bg, black text) · **PK-auto** `cc-ag-pk` (white outline) · **พัก** `cc-ag-paused` (grey outline, muted text) · **ว่าง** `cc-ag-vac` (dashed grey outline). No red: a vacant position is not a failure. No yellow: yellow means "waits for Benz", and that belongs to the proposal tag |
| Proposal tag | `.cc-ag-prop` | **"ข้อเสนอ · รอเบ๊นอนุมัติ"**: solid `--y` bg, black 800 text (15:1), square corners (4 px). Same meaning as "รอเบ๊น" on `/command`. After approval (`approved: true`): `.cc-ag-prop.cc-ag-ok` "เบ๊นอนุมัติแล้ว", white outline, no fill. The tag goes away only when the row stops being vacant. If `proposal.label` is set, ignore it for the wording: the two texts above are fixed, so a data typo can't make a proposal look approved |
| Source tag | `.cc-ag-srcl` | **"นอก SkillTree · {source}"** on rows (e.g. "นอก SkillTree · PK JEANS"). In the detail it reads "แหล่ง: {source}" for every row, SkillTree too. Square 4 px corners, `#1a1a1a` bg, `#555` border, white text, a small grey square before the text. The shape (square, not pill) and the words keep it apart from status chips and from the yellow proposal tag |
| Coverage | `.cc-ag-cov` | plain muted text "ครอบคลุมเต็ม" / "ครอบคลุมบางส่วน". Not a chip, because it is secondary |
| Detail dialog | `dialog.cc-ag-dlg` | see §5 |
| Proposal box | `section.cc-ag-propbox` | 1 px yellow border, 4 px yellow left edge, `#070600` bg. Heading "สเปกข้อเสนอ" + proposal tag, then one warning line in white: not approved = "นี่คือสเปกที่ทีมร่างไว้ **ยังไม่ใช่ agent จริง** และยังไม่ได้สร้าง จะเริ่มทำเมื่อเบ๊นอนุมัติ (บอก Marcus ในแชท หน้านี้อ่านอย่างเดียว)". Approved = "เบ๊นอนุมัติสเปกนี้แล้ว แต่ยังไม่มี agent ทำงานจริง สถานะจะเปลี่ยนเมื่อทีมสร้างเสร็จ". Then a `dl`: ชื่อที่เสนอ · หน้าที่ · รับอะไรเข้า (inputs list) · ส่งอะไรออก (outputs list) · ขอบเขต (`cc-ag-scope`, yellow square bullets) · ทีมที่จะดูแล · ความคุ้ม "อันดับ N (1 = ควรทำก่อน)". **No approve button** |
| Back to top | `a.cc-ag-link.cc-ag-top` href `#main` | "กลับขึ้นด้านบน", 44 px high, only when ≥ 15 rows show |

Do **not** use the mockup-only `.mk-sample` dashed "ตัวอย่าง" pill or `.mk-bar` in production.

## 4. Order and counting

**Counters** (summary card) always count the **whole file** and ignore the filters:
- ใช้งาน = `active`, PK-auto = `pk-auto`, พัก = `paused`, ว่าง = `vacant`.
- "มีคนทำ" = active + pk-auto + paused (the position has someone, even if resting). "ว่าง" = vacant.
- "ข้อเสนอรอเบ๊นอนุมัติ" = every row whose proposal is not `isApproved` (vacant rows and extra specs on staffed rows), shown as a yellow number with the split "มีหลักฐาน N · ร่างจากชื่อตำแหน่ง N" (computed from the data).
- The department table lists every department in the file: the 7 SkillTree ones first, others after.

**Default list order:** department (fixed order: Sales, Deals, Marketing, Operations, Intelligence, Customer, Back Office, then the rest in `localeCompare('th')` order) → status (ใช้งาน, PK-auto, พัก, ว่าง) → within vacant: `proposal.priority` ascending (no proposal / no priority last) → title `localeCompare('th')`.
When the status filter is **ว่าง**: department → priority → title. That is the "what should we fill next" view.
Search doesn't reorder the list (no relevance score). The order stays predictable.

**Search:** lowercase + `normalize('NFC')` + collapse spaces. Split the query on spaces, and **every** word must appear somewhere in id, title, agent, team, department, source, businesses, proposal.name or proposal.duty (substring, which works for Thai without word breaking). Build the haystack string once per row when the data loads.

## 5. Detail (open / close)

- Tapping a row opens a native `<dialog>` with `showModal()`. That gives the focus trap, Esc and inert background for free. At < 600 px it fills the screen (no margins). At ≥ 600 px it is a centred 520 px panel, `max-height 92vh`, radius 14.
- Sticky top bar inside the dialog: button **"ปิด"** (`cc-btn`, 44 px, gets focus on open) + h2 title (wraps, no clamp) + small line "{แผนก} · `{id}`".
- Body: status chip, proposal tag (if any), source tag "แหล่ง: …". Then a `dl` (`cc-ag-dl`, 112 px label column): agent ที่ทำอยู่ · ทีม · สถานะ (PK-auto gets a small line "ทำงานอัตโนมัติในระบบของ PK Jeans ไม่ใช่ agent ในทีม", wording to confirm Q4) · ความครอบคลุม · ธุรกิจที่ใช้ (`cc-tag` pills) · หลักฐาน. Then the proposal box (vacant + proposal) or the empty card "ยังไม่มีสเปกข้อเสนอ / ตำแหน่งนี้ว่าง และทีมยังไม่ได้ร่างว่าจะให้ agent ทำอะไร" (vacant, no proposal). Last, the ที่มา line.
- Evidence and every other field are **plain text** (React text nodes, never `dangerouslySetInnerHTML`). If evidence is a URL starting with `https://`, it may be a link (`target=_blank rel=noopener`, ↗ icon). Anything else stays text.
- History: opening calls `history.pushState({ag:id}, '', '#'+encodeURIComponent(id))`, so the phone's back button closes the dialog instead of leaving the page. `popstate` closes it. "ปิด" and Esc (`cancel` event, `preventDefault`) call `history.back()` when the state is ours. On load, a hash that matches an id opens that detail without pushing state. After closing, focus goes back to the row that opened it, so the list position and filters are kept.
- Filters are kept in component state only, not in the URL and not in localStorage (the same as the date picker rule in CLAUDE.md). Reload = defaults.

## 6. States and Thai copy

| state | when | looks like / copy |
|---|---|---|
| loading | only while the lazy chunk downloads (`Suspense` fallback) | header already rendered. Skeleton `cc-sk`: one 132 px block (summary) + three 64 px rows, `aria-busy="true"`. No text |
| load error | chunk import fails (offline, new deploy) | `cc-banner cc-err` `role="alert"`: **"โหลดรายการ agent ไม่ได้"** / "เช็กอินเทอร์เน็ตแล้วกดลองใหม่", button "ลองใหม่" = `location.reload()`. Use a small error boundary around `Suspense` |
| no data | file is `[]` or every row is invalid | summary card: `cc-empty` **"ยังไม่มีรายการตำแหน่ง"** / "เมื่อทีมโหลดข้อมูลตำแหน่งเข้าระบบแล้ว จะขึ้นที่นี่". The list section shows only the result line "ทั้งหมด 0 ตำแหน่ง". Hide the filters (nothing to filter) |
| ready | | as in the mockup |
| search finds nothing | text entered, 0 rows | card `cc-empty`: **"ไม่พบตำแหน่งที่ตรงกับ "{คำค้น}""** / "ลองคำอื่น หรือค้นด้วยชื่อทีมหรือธุรกิจ" + text button "ล้างคำค้น" (focus returns to the input). If a department or status filter is on too: "ในตัวกรองที่เลือกอยู่ ลองล้างตัวกรองหรือใช้คำอื่น" + "ล้างคำค้นและตัวกรอง" |
| filter empty | no text, 0 rows | **"แผนก {X} ไม่มีตำแหน่งที่ "{สถานะ}""** (no department filter: "ทุกแผนก ไม่มีตำแหน่งที่ "{สถานะ}"") / "ลองเลือกสถานะอื่น" + "ล้างตัวกรอง" |
| detail open | | §5 |
| vacant without proposal | in the detail | empty card above |

Every Thai string on the page, in one place:
- header: "ทีม Agent" (h1: `<b>ทีม</b> Agent`), "อ่านอย่างเดียว · อัปเดตข้อมูล {date}", back aria "กลับไป Command Center"
- sections: "ภาพรวม", "{N} ตำแหน่ง", "ตำแหน่งทั้งหมด"
- counters: "ใช้งาน", "PK-auto", "พัก", "ว่าง"; "มีคนทำ X จาก N ตำแหน่ง · ข้อเสนอรอเบ๊นอนุมัติ P"; caption "ต่อแผนก (กดแถวเพื่อกรองรายการด้านล่าง)"; head "แผนก / มี / ว่าง / สัดส่วน"
- filters: "ค้นหา", placeholder, "ล้างคำค้น", "แผนก", "ทุกแผนก (N)", "สถานะ", "ทั้งหมด"
- result: "ทั้งหมด N ตำแหน่ง", "แสดง n จาก N ตำแหน่ง", "ล้างตัวกรอง", "ข้ามไป N แถวที่ข้อมูลไม่ครบ", "กลับขึ้นด้านบน"
- rows: "ยังไม่มี agent", "เสนอ:", "ความคุ้มอันดับ N", "ยังไม่มีสเปกข้อเสนอ", "ยังไม่ระบุ agent", "ครอบคลุมเต็ม", "ครอบคลุมบางส่วน", "ข้อเสนอ · รอเบ๊นอนุมัติ", "เบ๊นอนุมัติแล้ว", "นอก SkillTree · {source}"
- detail: "ปิด", "แหล่ง: {source}", "agent ที่ทำอยู่", "ทีม", "สถานะ", "ความครอบคลุม", "ธุรกิจที่ใช้", "หลักฐาน", "ไม่ระบุ", "ว่าง ยังไม่มี agent", "ยังไม่มี (ว่าง)", "ไม่มี (ตำแหน่งว่าง)", "ยังไม่มีหลักฐาน", "สเปกข้อเสนอ", "ชื่อที่เสนอ", "หน้าที่", "รับอะไรเข้า", "ส่งอะไรออก", "ขอบเขต", "ทีมที่จะดูแล", "ความคุ้ม", "อันดับ N (1 = ควรทำก่อน)", "ยังไม่จัดอันดับ", the two warning lines in §3

### ที่มา lines (one per box, required)

- Summary card: **"ที่มา: นับจากข้อมูลตำแหน่งทั้งชุด (ไม่ขึ้นกับตัวกรอง) · "มี" = ใช้งาน + PK-auto + พัก · "ว่าง" = ยังไม่มี agent"**
- List section (after the list): **"ที่มา: ข้อมูลตำแหน่งที่ทีมบันทึกเองและโหลดเข้าระบบ (ไม่ได้ดึงสด) · ตำแหน่งจาก SkillTree 7 แผนก และตำแหน่งนอก SkillTree ติดป้ายแหล่งที่มา · "ข้อเสนอ" คือสเปกที่ทีมร่าง ยังไม่ใช่ agent จริงจนกว่าเบ๊นอนุมัติ"**
- Detail: **"ที่มา: ไฟล์ตำแหน่งของทีม แถว `{id}` · ทีมบันทึกเอง ไม่ได้ดึงสถานะสดจากระบบ"**

The target "300 ตำแหน่งปีหน้า" is shown in the mockup with a ตัวอย่าง tag only. Put it in production only if Benz says yes (Q2). If yes: "เป้าปีหน้า 300 ตำแหน่ง" as plain text in the same line, no progress bar.

## 7. 300 rows (and more)

- Render every row (no virtual list): 300 buttons with no images is light, and a native find-in-page and screen readers then see everything. Each department `section.cc-ag-group` gets `content-visibility:auto; contain-intrinsic-size:auto 900px`, so groups off screen skip layout. This cuts the first render. `auto` remembers each group's real height, so the scrollbar stops jumping after the first pass.
- Filter with `useDeferredValue(query)` and `useMemo` over the pre-built haystack. No debounce timer is needed at this size, and typing stays smooth (INP).
- The department select and the counts come from the data, so a 21st department or a new source needs no code change.
- Long Thai titles: 2-line clamp on rows, full title in the detail. `overflow-wrap:anywhere` everywhere text comes from data. All grids use `minmax(0,…)`, so 320 px never scrolls sideways.
- Sticky group headers keep the department visible on a long scroll. "กลับขึ้นด้านบน" sits at the end.
- No pagination, no "load more": both hide gaps, and the job here is to see the gaps.

## 8. Motion

- None for content. The dialog opens without animation (instant is clearer on a phone, and it costs no INP).
- Department-row press → `scrollIntoView({behavior: reduced ? 'auto' : 'smooth'})` to the list heading, so Benz sees where the filtered list starts. That is the only motion.
- `prefers-reduced-motion: reduce`: no smooth scroll, no skeleton shimmer (already in `command.css`).
- CLS: the lazy chunk's skeleton has the summary's size. Fonts are system fonts.

## 9. Accessibility checklist (courage self-checks, justice verifies)

- [ ] One `h1` ("ทีม Agent"). Sections have `h2`, department groups `h3`, and the dialog has its own `h2` (`aria-labelledby`).
- [ ] Every tap target ≥ 44×44: back link, department rows, search clear, chips, ล้างตัวกรอง, rows (64), ปิด. The 48 px search and select are fine.
- [ ] Keyboard: Tab follows the visual order (back → department rows → search → clear → select → chips → ล้างตัวกรอง → rows → back to top). Enter/Space opens a row. Esc closes the dialog. Focus returns to the row.
- [ ] Focus ring: `.cc :focus-visible` 3 px yellow. The department rows and list rows use `all:unset`, so they set their own `:focus-visible` (in the mockup CSS).
- [ ] Chips and department rows use `aria-pressed`. The result line is `role="status"`, so a screen reader hears "แสดง 23 จาก 300 ตำแหน่ง" after typing.
- [ ] Status is always a word, never colour only. Proposal = words + yellow. Source = words + square shape.
- [ ] Contrast: muted `#9a9a9a` only on `#000/#0a0a0a/#111`; vacant title `#cfcfcf` on `#000` (≈13:1); black on yellow 15:1; black on `#d8d8d8` ≈14:1. No white on red anywhere.
- [ ] 200% text zoom: rows grow and the chips wrap. Nothing is cut off except the 2-line title clamp (the full title is in the detail).
- [ ] No emoji, no `ตัวอย่าง` pill, no generated rows in production.

## 9b. Update 23 Nov: "ข้อเสนอ" label, source badges, filters

- The "ข้อเสนอ · รอเบ๊นอนุมัติ" tag is neutral (`#2b2b2b` bg, white text, grey border), not yellow and not green. A second dashed badge says where the spec came from: **"ร่างจากชื่อตำแหน่ง"** (`basis = suggested-from-title`) or **"มีหลักฐาน"** (any other basis). The source badge stays after approval.
- Approved = `isApproved(p)`: `approved === true` and a non-empty `approved_by` and `approved_on` a real YYYY-MM-DD date not in the future (Bangkok). Anything else is a proposal (fail-closed). The detail then reads "อนุมัติโดย {approved_by} เมื่อ {approved_on}". The validator reports an incomplete `approved: true` as an error.
- Two more chip groups under the status chips: **ข้อเสนอ** (ทั้งหมด · ข้อเสนอรออนุมัติ · อนุมัติแล้ว) and **ที่มาของข้อเสนอ** (ทั้งหมด · มีหลักฐาน · ร่างจากชื่อตำแหน่ง). Their counts follow the department, search and status filters; each group ignores itself.
- The summary line reads "ข้อเสนอรอเบ๊นอนุมัติ N (มีหลักฐาน N · ร่างจากชื่อตำแหน่ง N)". No number is written in the code.

## 10. Notes for courage

- Files: `web/src/AgentsPage.tsx` (default export `AgentsApp`, fetches the API), `web/src/AgentsShell.tsx` (lazy entry), `web/src/agents.css`, `web/src/agents/agentsView.ts` (pure logic), `worker/agentsStore.ts` (validate, split, assemble, SQL), `scripts/command-agents-sql.mjs`. `CommandPage.tsx`: the `view` switch and one link row. No data file under `web/src`.
- Wrap the page in `<div className="cc">`. Same header markup as `CommandPage` (`header.cc-top`), with the back link in place of the logo.
- Keep `STATUS_TH`, `SCOPE_TH`, `DEPT_ORDER`, the sort and the search as pure functions in `web/src/agents/agentsView.ts`, and test them (sort order, vacant-priority order, multi-word Thai search, unknown status → paused, proposal on an approved row, counts ignore filters).
- One GET to `/api/command/agents`, nothing written anywhere. The page is read-only, with no approve button or edit field. "Approved" is decided in one place, `isApproved` (approved=true and a non-empty `approved_by` and a real `approved_on` date not in the future); anything else shows as "ข้อเสนอ", and the validator reports it as an error.
- QA screenshots at 390 px: headless Edge renders ≥ 496 px, so use an iframe wrapper (as for `mockup-390.png`) or DevTools device mode.

## Open questions (for Benz)

- **Q1** (answered 23 Nov: the list must be behind the login, so it is served by the API above.)
- **Q2** Show "เป้าปีหน้า 300 ตำแหน่ง" on the page?
- **Q3** Does the data carry a top-level `updated` date (`{updated, departments, positions}`), so the header can say how old the list is?
- **Q4** What exactly is "PK-auto"? (Current wording: "ทำงานอัตโนมัติในระบบของ PK Jeans ไม่ใช่ agent ในทีม".)
