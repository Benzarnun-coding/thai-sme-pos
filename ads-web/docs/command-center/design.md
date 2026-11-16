# Benz Command Center (`/command`) · design spec

> Benz decided the open points on 15 Nov 2026; `spec.md` §0 wins where this file differs (order todo > business > team, no SiteNav, stale 25 min, team groups table B2, Page365 reminder only after 10:00, YTD bar vs the full-year 100M).

Job of the page (1 sentence): **เบ๊นเปิดจากมือถือแล้วรู้ใน 10 วินาทีว่าวันนี้ต้องทำอะไร และแต่ละธุรกิจกับทีมเป็นอย่างไร** (read-only this round).

Files: `mockup.html` (one file, no CDN/fonts; the page plus a "state อื่น" gallery underneath, the gallery is mockup-only), `mockup-390.png` (390 px render).
The mockup has no business numbers at all. Every value is a placeholder (`฿—,———`, `—`, `hh:mm`, `job-xxxx`, `[หัวข้อตัวอย่าง]`) or carries a dashed `ตัวอย่าง` tag. The only real values are worked out from the date: today's date, days until Focus Club opens, the share of the year gone (the "ควรถึง" line) and the number of days so far this year.

---

## 1. Layout (mobile-first, 390 px)

```
┌ header (sticky, 64px) ─────────────────────────┐
│ [BC] Benz Command Center        [รีเฟรช]        │
│      อ่านอย่างเดียว · อา. 15 พ.ย.                │
└────────────────────────────────────────────────┘
 วันนี้เบ๊นต้องทำ                         [N เรื่อง]
 ┌ list of link rows (≥56px each) ──────────────┐
 │ ● ตัดสิน job …                              › │
 │ ● อนุมัติหยุดแอด …                           › │
 │ ● ไฟล์ Page365 เมื่อวานยังไม่อัปโหลด (red dot) › │
 │ ที่มา: …                                      │
 └──────────────────────────────────────────────┘
 ธุรกิจ
 ┌ PK Jeans: 2 KPI · progress bar vs 100M · ที่มา ┐
 ┌ Focus Club: countdown · สมาชิก [ยังไม่เชื่อม]   ┐
 ┌ ClassRoom: [ยังไม่เชื่อม] block                 ┐
 ┌ benzarnun.com: 3 article rows (external)      ┐
 งานทีม                              ข้อมูลเมื่อ hh:mm
 ┌ 4 counters · latest ≤ 5 jobs · ที่มา             ┐
 ┌ Jarvis slot (disabled, "เร็วๆ นี้")            ┐
```

- Order: **"ต้องทำ" goes first**, then business, then team (Benz, 15 Nov: D2).
- One column, `max-width: 520px`, side padding 16 px, gap between sections 22 px, between cards 10 px. Wider screens just centre the column. No breakpoints needed beyond a bigger KPI size at ≥ 600 px.
- No team link bar (`SiteNav`) on this page (Benz, 15 Nov: Q1). The logo goes to `/`. Note: `GoSellApp` does render `SiteNav` today, so `/command` is *not* a copy of `/gosell` in that respect (see open question 2: CLAUDE.md says every page goes in SiteNav).
- One fetch (`/api/command/summary`) feeds every box; each tile carries its own `status`, so one box failing never blanks the page.

## 2. Tokens

Taken from Benz DNA (`benz-dna-mcp/server/src/admin.ts` `CSS`). Additions are marked +.

| token | value | use | contrast on #000 |
|---|---|---|---|
| `--bg` | `#000` | page | – |
| `--card` | `#0a0a0a` | card (DNA `.card`) | – |
| `--card-2` + | `#111` | counters, buttons | – |
| `--line` / `--line-2` | `#222` / `#333` | borders, dividers | decorative |
| `--text` | `#fff` | main text | 21:1 |
| `--muted` (DNA `--g`) | `#9a9a9a` | labels, ที่มา line, placeholders | 7.4:1 (≈6.9 on card) AA |
| `--y` | `#FFD400` | headings, links, "รอเบ๊น", stale, focus ring | 15:1 |
| `--r` | `#FF3B30` | "ติด", error, missing Page365 | 5.9:1 AA |
| `--y-bg` + | `#141000` | stale banner bg (DNA `.once`) | – |
| `--r-bg` + | `#1a0605` | error banner bg | – |
| `--radius` | 14px card / 12px inner / 99px pill | | |
| `--tap` + | 44px | min tap size | |
| font | `-apple-system,"Sukhumvit Set","Noto Sans Thai",system-ui,sans-serif` | | |
| mono | `ui-monospace,Menlo,monospace` | job_id only | |

Rules:
- **Never white text on red** (3.5:1, fails). Red chips use black text (`#000` on `#FF3B30` = 5.9:1). Yellow chips use black text.
- Status is never colour alone: there is always a word next to it (รอเบ๊น / ติด / ข้อมูลเก่า / ยังไม่เชื่อม).
- Type: body 16/1.6; card title 15/700; section h2 17/800 yellow; KPI 22–24/800 tabular-nums; meta 12.5–13. Thai needs line-height ≥ 1.45 even on small text (stacked vowels): don't go tighter.
- Scope all CSS under a root class (`.cc`). The dashboard's `styles.css` is a light theme with its own `--bg`, `--text` etc., so the page must not set them on `:root`.

## 3. Components

| component | anatomy | notes |
|---|---|---|
| Header | logo 44×44 yellow "BC" (link `/`) · title "**Benz** Command Center" · sub "อ่านอย่างเดียว · {date th-TH short}" · button รีเฟรช | sticky, `rgba(0,0,0,.92)`; รีเฟรช re-fetches every box; while running: `disabled` + text "กำลังโหลด…" |
| Section head | h2 yellow + right side meta (`N เรื่อง` pill or `ข้อมูลเมื่อ hh:mm`) | |
| Card | `--card`, 1px `--line`, radius 14, padding 14 | ends with the **ที่มา line** (required) |
| ที่มา line | 12.5px muted, top border, starts with "ที่มา:" | one line of content, it may wrap on narrow screens |
| KPI pair | 2-col grid `minmax(0,1fr)` · label / value / sub | `minmax(0,…)` stops long numbers forcing the page wider |
| Target bar | 14px track `#1c1c1c`; fill solid `--y` (real) or grey stripes (sample); white 3px "ควรถึง" marker + label under | `role="img"` + aria-label with both % in words |
| Not-connected block | dashed border, link-broken icon (muted), bold "X · ยังไม่เชื่อม" + one line why | no number, no 0, no skeleton |
| Not-connected tag | pill, `#161616` bg, white text, `--muted` border: "ยังไม่เชื่อม" | inline version for one field (Focus Club สมาชิก) |
| Sample tag | dashed pill "ตัวอย่าง" | mockup only. Must not exist in production |
| Link row | min-height 56 (todo 60), dot/none · title (2-line clamp) · small meta · chevron | whole row is the `<a>`; hover = title turns yellow; external link uses the ↗ icon + `target=_blank rel=noopener` |
| Team counters | 4 tiles: เสร็จ · **รอเบ๊น** (yellow border) · **ติด** (red border) · กำลังทำ | the order puts the two that need Benz in the middle, easiest to see |
| Status chip | done grey/black · fail red/black · need yellow/black · sent outline | words, not colour only |
| Banner | stale (yellow) / error (red) + optional ลองใหม่ button (min 40 h, sits inside a ≥44 row) | `role=status` for stale, `role=alert` for error |
| Empty | centred bold line + one muted sentence | |
| Skeleton | grey blocks the **same size** as the loaded content + shimmer | stops layout shift (CLS) |
| Jarvis slot | dashed border, striped bg, title "Jarvis" + yellow "เร็วๆ นี้" pill, text "ยังสั่งงานจากหน้านี้ไม่ได้ ตอนนี้หน้านี้อ่านอย่างเดียว", a grey box saying "ยังไม่เปิดใช้" | **no `<input>`/`<button>`**, not focusable, `aria-disabled`, no placeholder like "พิมพ์คำสั่ง…", no mic icon. It must not look usable |

Focus: 3px yellow `outline` + 2px offset on every focusable thing (`:focus-visible`). Tab order = visual order: header, todo rows, article links, (team rows are not links in v1), nothing in Jarvis.

## 4. Data per box and its ที่มา line

| box | shows | ที่มา (microcopy) |
|---|---|---|
| ต้องทำ | (a) jobs with status needs-user → "ตัดสิน job: {หัวข้อ}" · "{job_id} · {project} · รอเบ๊นตั้งแต่ hh:mm" (b) every open (`pending`) proposal: pause/move/dup/cap, linking to the Discord message (or `/#history`) → "อนุมัติหยุดแอด / คัดลอกแอด / เพิ่มเพดานงบ: {ชื่อ}" · "คำถามใน Discord ({type}) · เปิดค้างตั้งแต่ hh:mm · ไปที่แดชบอร์ด" (c) yesterday's Page365 file missing → red dot "ไฟล์ Page365 เมื่อวานยังไม่อัปโหลด" · "ยอดเมื่อวานและกฎแอดยังใช้ตัวเลขของ Meta อยู่ · ไปหน้าอัปโหลด" | "ที่มา: job ที่รอเบ๊น (snapshot งานทีม) · คำถามอนุมัติที่ยังเปิดใน Discord · ตารางอัปโหลด Page365" |
| PK | ยอดขายเมื่อวาน (Page365 real, by Created At) · ยอดสะสมปีนี้ · % of 100,000,000 · "ควรถึง" = target × days passed ÷ days in year (passed = up to yesterday) · "มีไฟล์ X จาก Y วัน" | "ที่มา: ไฟล์ Page365 ที่อัปโหลดแล้ว (ยอดจริงตาม Created At) · วันที่ไม่มีไฟล์ไม่นับ · "ควรถึง" = เป้า × วันที่ผ่านไป ÷ 365" |
| Focus Club | countdown to 1 ธ.ค. 2026 in Bangkok days ("อีก N วัน", "วันนี้", then "เปิดแล้ว") · สมาชิก = **ยังไม่เชื่อม** | "ที่มา: วันนับถอยหลังคำนวณจากวันที่วันนี้ · จำนวนสมาชิกจะมาจาก Google Sheet ที่กำลังตั้ง" |
| ClassRoom | จำนวนนักเรียน = **ยังไม่เชื่อม** | "ที่มา: ยังไม่ได้กำหนด" |
| benzarnun.com | latest 3 RSS items: title (2-line clamp), date "d MMM yyyy" th-TH | "ที่มา: RSS ของ benzarnun.com · เปิดในแท็บใหม่" |
| งานทีม | counters and rows per spec §0 table B2 + latest up to 5 (job_id, project, title, time, chip) · head "ข้อมูลเมื่อ hh:mm" | "ที่มา: snapshot งานทีม อัปเดตทุก 10 นาที · นับเฉพาะงานวันนี้" |

Number formatting: `฿` + `toLocaleString('th-TH')`, no decimals; % one decimal; times `HH:mm` Bangkok 24h; YTD on 390 px may need the short form "฿xx.x ล้าน" if the full number doesn't fit (it should fit at 22px; check).

## 5. States (every box)

| state | when | looks like | copy |
|---|---|---|---|
| **loading** | first fetch / refresh with no data yet | skeleton of the same height; ที่มา line already visible; `aria-busy=true` | (none) |
| **ยังไม่เชื่อม** | the source isn't wired (no config / endpoint returns `{connected:false}`) | not-connected block or tag. **No number, no 0, no skeleton, no error colour** | "{ชื่อ} · ยังไม่เชื่อม" + why: Focus Club "จะมาจาก Google Sheet ที่กำลังตั้ง"; ClassRoom "ยังไม่มีแหล่งข้อมูล เมื่อเลือกแหล่งได้แล้วตัวเลขจะขึ้นที่นี่"; งานทีม "ยังไม่มี snapshot งานทีมส่งมาที่หน้านี้ เมื่อเชื่อมแล้วจะอัปเดตทุก 10 นาที" |
| **ready** | data ok | as in the mockup's main part | |
| **ข้อมูลเก่า** | team snapshot older than **25 min**; PK yesterday's file missing; RSS served from cache after a failed fetch | yellow banner on top of the (dimmed 75%) data, or for PK "ยังไม่มีไฟล์" in yellow in place of yesterday's value (no "ล่าสุดที่มี" line: spec §0 m5) | "ข้อมูลเก่า · ล่าสุดเมื่อ hh:mm (N นาทีก่อน) ปกติอัปเดตทุก 10 นาที" |
| **error** | fetch failed with no cache | red banner + ลองใหม่ (only that box) | "โหลดไม่สำเร็จ" / "ดึง RSS ไม่ได้ กล่องอื่นยังใช้ได้ตามปกติ" |
| **error (all)** | every request failed / not logged in | one red banner at the top instead of the boxes | "โหลดข้อมูลไม่ได้ · เช็กอินเทอร์เน็ตแล้วกดลองใหม่ ถ้ายังไม่ได้ แปลว่าระบบหลังบ้านมีปัญหา" |
| **empty** | connected, ok, nothing to show | centred line | ต้องทำ: "วันนี้ไม่มีงานค้าง" + "ไม่มี job รอตัดสิน ไม่มีคำถามอนุมัติ และไฟล์ Page365 เมื่อวานมาแล้ว"; งานทีม: "วันนี้ยังไม่มีงานทีม" + "เมื่อมีงานใหม่จะขึ้นที่นี่ภายใน 10 นาที"; RSS: "ยังไม่มีบทความ"; PK with zero files this year: "ยังไม่มีไฟล์ Page365 ปีนี้" (not ฿0) |

The "ต้องทำ" box has one more case: if a *source* of it is not connected or failed (e.g. snapshot not ready), it lists what it could read and adds a muted line "ยังเช็ก job ที่รอเบ๊นไม่ได้ (ยังไม่เชื่อม)". It must **not** say "วันนี้ไม่มีงานค้าง" unless all three sources answered.

### Rule "ยังไม่เชื่อม" (hard)

1. Unknown is never shown as 0, `—` with a currency sign, or a skeleton that never ends.
2. Not connected is grey, not red: it's a fact, not a failure. Red is only for something that broke or needs Benz now.
3. The not-connected text says where the number will come from, so Benz knows what is missing.
4. The ที่มา line stays even when the box is not connected.

## 6. Interaction and motion

- Read-only: the only controls are รีเฟรช, ลองใหม่ and links. No auto-polling in v1 beyond one refetch on `visibilitychange` when the tab comes back after > 5 min (optional, see Q5).
- Links: job → (target TBD, Q3); proposals → dashboard `/` (or its proposals view if there is one); Page365 missing → the upload page; RSS → article, new tab.
- Motion has a reason only: skeleton shimmer (shows "loading", 1.4 s loop); target bar fill may grow 0→value once on first data (`transform: scaleX`, 400 ms ease-out, shows "progress so far"); no other animation. `prefers-reduced-motion: reduce` → no shimmer, no grow.
- Performance: skeleton = final size (CLS 0); fonts are system fonts (no font load, nothing delays LCP); animate `transform`/`opacity` only.

## 7. Accessibility checklist (for courage to verify)

- [ ] Each box is a `<section>`/`<article>` with a heading; page has one `<h1>`.
- [ ] Every tap target ≥ 44×44 (rows 56+, buttons 44, logo 44).
- [ ] Focus ring visible on all focusable items; keyboard reaches every link; Jarvis slot not reachable.
- [ ] No white-on-red text; muted text only on `#000`/`#0a0a0a`/`#111`.
- [ ] Status words present next to every colour.
- [ ] Bar has an aria-label with real % and "ควรถึง" %.
- [ ] 320 px width: nothing scrolls sideways (grids use `minmax(0,1fr)`, long titles clamp, job_id mono can wrap).
- [ ] 200% text zoom: KPI values wrap rather than overflow.
- [ ] Reduced motion honoured.
- [ ] No `ตัวอย่าง` tags or placeholders left in production; unconnected boxes show ยังไม่เชื่อม.
- [ ] No emoji in UI.

## 8. Notes for courage (implementation)

- Mount like the other standalone pages in `web/src/main.tsx` (`/^\/command\/?$/` → `<CommandApp />`) but without `SiteNav` (unless Q2 says otherwise).
- Wrap in `<div className="cc">` and keep the CSS scoped; don't touch `styles.css` globals.
- One hook for the summary; each tile is rendered from its `status` (`ok`/`stale`/`missing`/`not_connected`/`error`), so "not connected" is never inferred from an error.
- Dates: compute "today", "yesterday", day-of-year and the countdown in `Asia/Bangkok`, not the phone's zone or UTC (the Worker runs in UTC).
- Headless Edge renders at ≥ 496 px wide, so `mockup-390.png` was taken through a 390 px iframe; for QA screenshots use the same trick or DevTools device mode.
