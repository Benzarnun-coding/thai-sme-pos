# Back office (catalog, order sheets, sales, profit)

Standalone pages behind the main Cloudflare Access app (they call `/api`). Every page has the same link bar
(`web/src/SiteNav.tsx`): แอด · แคตตาล็อก · สั่งของ · ยอดขาย · กำไร · สต็อก · งานค้าง · GoSell. A new page goes in that bar.

Pages and the one job each does:

| Page | Job | Main files |
|---|---|---|
| `/catalog` แคตตาล็อก | find a product, its pictures, cost, selling price, supplier | `web/src/CatalogPage.tsx`, `web/src/catalog.ts`, `worker/catalog.ts` |
| `/catalog/orders` สั่งของ | Bigseller file → order sheets per supplier / warehouse; what we owe suppliers | `web/src/OrdersPage.tsx`, `web/src/purchase.ts`, `worker/purchase.ts` |
| `/catalog/sales` ยอดขาย | pieces sold per day and channel | `web/src/UnitsPage.tsx`, `web/src/sales.ts`, `worker/sales.ts` |
| `/catalog/profit` กำไร | money per channel and product; upload TikTok/Shopee money files | `web/src/ProfitPage.tsx`, `web/src/profit.ts`, `web/src/money.ts`, `worker/mpOrders.ts` |
| `/catalog/stock` สต็อก | our own stock: พี่เปีย's BB branch and GoSell's warehouse | `web/src/StockPage.tsx`, `worker/stock.ts` |
| `/catalog/todo` งานค้าง | missing data, most sold first, fixed inline | `web/src/TodoPage.tsx` |

Shared rule for every page: a cost or price typed on the website wins over the sheet; nothing here changes the ads
rules, the monthly goal or the sheet.

ทุน follows Page365 (Benz 27 Oct): after every Page365 upload, `worker/p365Costs.ts` solves Page365's cost per product ×
size band (≥ 38) from the last 14 days of whole-order costs (one-product orders directly, mixed ones by taking off the
known products; the orders must agree ±1 baht) and sets the website cost (`catalog_prices`, per size) wherever ours
differs or is empty — so order sheets, supplier amounts, profit and งานค้าง use it. Audited as `catalog.price.p365`
(SKU, before, after); preview `GET /api/p365/costs`, run now `POST`. Products Page365 sold that aren't in the catalog
are only reported (add them on งานค้าง). Baseline 13–26 Oct: 1,486 of 1,502 orders explained by our costs; differed:
1712/1713 BLD 155 → 200, R429/3 235 → 225, 205/1 38+ 218.88 → 215.88; empty: 801/1–3 and 501/1–3 BB 38+.

## Catalog `/catalog`

- Source: the `SKU+Price` sheet (id in setting `catalog_sheet_id`, falls back to `sheet_id`; kept separate because
  production `sheet_id` is empty (2026-10-13) and filling it would start the 07:30 cost sync feeding the live rules;
  owners/admins paste the link on the page). One tab per warehouse.
- Columns A–J by position (B SKU · C code · D description · H cost · I price · J image); ร้านค้า / รหัสแทน /
  ราคาร้านค้า / รหัสเก่า by header (they move per tab; only BB-style tabs have real suppliers).
- Sync is a button, done by the browser: tab gids from the sheet's `/htmlview`, each tab's raw
  `/export?format=csv&gid=` passed through the Worker (gviz blanks mixed-type cells and drops rows), parsed and diffed
  in the browser (`web/src/catalog.ts`, shared with the Worker); only changed rows are sent (position-only moves
  skipped). Rows load in pages cached by the browser per `catalog_version`.
- Tables: `catalog` (sheet copy, PK tab+sku), `catalog_tabs` (counts + gid), `catalog_web` (SKUs added on the page,
  never touched by syncs; the "เพิ่มจากเว็บ" tab copies them as TSV to paste into the sheet).
- Filters: chips per warehouse (names from คู่มือ); for tabs with a ร้านค้า column (BB, BBW, BLD) a supplier
  sub-filter (statuses like เลิกผลิต and "(ไม่ระบุร้าน)" last); "ไม่มีรูป".
- Pictures: column J (Shopee `_tn` thumbnails), or added on the page (`catalog_images`, per product = tab|SKU minus
  size: upload / photo / paste / drop, resized in the browser to ~400 px + ~1200 px JPEG, stored as D1 BLOBs, bytes
  checked server-side; or an https link), which wins over column J. Other sites' photos via
  `/api/catalog/image-proxy` (allowlisted hosts only).
- Product view: supplier (`catalog_suppliers`, per product, wins over the sheet; used for PK models bought from a BB
  supplier), and "แก้ทุน / ราคาขาย" (Benz 2026-10-15): every size, blank = sheet, "ทุกไซส์" fills all; saved per size
  (key tab|SKU) or once per product (tab|SPU) when every size is the same (`planPrices`), read by `overrideOf`
  (size > product > sheet). Cost → `catalog_prices` (the same cost the order page types; a cost typed there clears the
  product's per-size ones); selling price → `catalog_sell_prices` (migration 0032, `PUT /api/catalog/sell-price`),
  shown in the catalog only. "เว็บ" marks a typed value (sheet value on hover).
- SKU matching (2026-10-15): a SKU the catalog doesn't know (Lazada's own id, a typo, an old code) is matched once to
  one of ours ("จับคู่ SKU ของเรา" on ตรวจสอบ rows and on งานค้าง; `catalog_aliases`, `PUT /api/catalog/alias`, must
  point at a real catalog/web SKU). `makeLookup` reads it as ours on every page, but a SKU really in the catalog
  always wins. Suggestions: `suggestSkus`.
- Baseline 2026-10-13: 17,423 SKUs.

## Order sheets `/catalog/orders`

- Input: Bigseller's daily "Order-SKU-inprocess" export, .xlsx or .csv (CSV via `parseExport` in `gosell.ts`: UTF-16
  tabs, UTF-8 commas, or Thai Excel's Windows-874), read in the browser. Columns ร้านค้า BigSeller, SKU, ชื่อสินค้า,
  ชื่อตัวเลือก, จำนวน, หมายเลขคำสั่งซื้อ … or Bigseller's English names. It has no prices.
- Other sources on the same round (Benz 2026-10-16): **Facebook orders** — Page365's per-item export (UTF-16 tabs; `No.`,
  `SKU`, `Item Qty`…; `isFacebookExport`, `readFacebookItems`), picked with the same file button or "+ เพิ่มไฟล์ Facebook",
  before or after the Bigseller file (on its own it is the day's "รอบ Facebook" = round 0, `FB_ROUND`/`roundLabel`; Bigseller rounds are 1–9); read in the browser, only order no. + SKU + qty + item name kept; cancelled
  orders left out. Facebook items of products in GoSell's stock go to the "GoSell" sheet while GoSell's balance lasts
  (GoSell ships them; cut by the GoSell page's button, not here); the rest go where any row goes. **Typed lines** —
  "+ เพิ่มรายการเอง": SKU (search by code/colour/size) + qty, or text the catalog doesn't know (→ ตรวจสอบ). Both are
  saved with the round (`purchase_uploads.extra`, migration 0049) and come back when the same Bigseller file is
  uploaded again; neither goes into `purchase_items` (Facebook units are counted from the Page365 upload; typed lines
  are not sales). A SKU split over groups (พี่เปีย / GoSell / PK) is not turned into a "move" when a round reopens.
- "รหัสของเรา" (Benz 2026-10-19): "แก้" on a row (not PK's own) also offers our codes (the PK tab); picking one
  saves a forced match (`catalog_aliases.force`, migration 0050) from the row's SKU to that code's same size, e.g.
  39-BB-MD-34 → 5011-PK-MD-34. From then on every page reads it as ours, so the two rows add up; the merged row says
  "รวม 39-BB-MD-34 · แยก" to undo. Ordinary matches (unknown SKUs) never override a catalog SKU; forced ones do.
- "+ เพิ่มสินค้าร้านนี้" (idea #15, มอส): on each supplier / warehouse card, searches only that shop's products (`groupOf` = this card) and adds a typed line to the open round — same storage as "+ เพิ่มรายการเอง"; not on history views.
- Where a row goes (`groupOf`): supplier set on the page > sheet ร้านค้า (statuses like เลิกผลิต ignored) >
  "BB · ยังไม่ระบุร้าน" (only BB must have a supplier, `SUPPLIER_TABS`) > the warehouse itself (PK, CM, CN, BBW …;
  BBW products with นอร์ท still go to นอร์ท). Unknown SKUs → "ตรวจสอบ" (match, or add via `/catalog?q=SKU&add=1`);
  their size comes from the SKU's last part, or Bigseller's option text after the last comma (`optionParts`).
- Moves: any row, any group, also in a reopened round, can go to any supplier/warehouse for that round only
  (`applyMoves`, keyed by group + SKU (`moveKey`) so a SKU split between พี่เปีย and a shop moves one row at a time (QA B1 2026-10-21), rows meeting in one group merge; "ย้อนกลับไป …" undoes; whole group at once, or only the rows ticked in the group's first column — idea #6); "จำไว้ทุกวัน" also sets the product's
  supplier. A reopened round saves itself after each change.
- Label: a name typed on the page (`catalog_labels`, per product, every size, or with "เฉพาะไซส์ …" ticked for one size under key tab|SKU, which wins; saving for every size clears the per-size ones; rows not in the catalog: that round
  only), else our code + colour name, plus the supplier's code from column M in brackets only when it looks like a code
  (`supplierCodeOf`). BB's column M is mostly notes ("มีทุกร้าน", "ร้าน ส.") shown on screen as "หมายเหตุชีต", never
  printed. Labels are recomputed when a saved round is reopened.
- Order numbers + sales store (`storeLabel`: platform from the shipping name + Bigseller store → "TikTok · STM-SHOP")
  on screen, Excel, print and pictures. Bigseller has TikTok/Shopee only; Facebook orders come from Page365.
  Search order numbers in the round and in saved rounds; copy all order numbers of a group.
- Output: Excel (`web/src/xlsxWrite.ts`), print/PDF (A4, one table per sheet, header repeated), and "รูปภาพ" PNG pages
  1080 px wide (`web/src/pictureSheet.ts`): per order by default (Bigseller picking-list layout, text as in Bigseller,
  no translation; order/tracking numbers only drawn, never saved) or per product (the only choice for history).
  Highlighted for CN, which packs each order itself.
- History: downloading / printing / ticking saves the round per date+round (`purchase_uploads`, `purchase_lines`:
  SKU, qty, group, order numbers, `missing`, price; tracking numbers never saved) and `purchase_items` (order + SKU +
  qty + store, for units sold). Uploading the same file again (by file name) reopens that round and fills in what's new.
- Out of stock: tick "ของไม่มี" (all or N pieces; `PUT /api/purchase/missing`, kept across re-saves) → the round's
  "เก็บตกแทน" sheet (`missingGroup`, `MISSING_GROUP`), picked up elsewhere instead. It was called "พี่เปีย" until
  2026-10-15; that name is now the stock branch below (payments recorded under the old name were renamed).
- Order page: the "พี่เปีย" and "GoSell" group tables have a "คงเหลือ" column = current stock balance (same numbers as `/catalog/stock`, read-only; idea #13).
- พี่เปีย stock: rows of stock products (`stock_items`) go to the "พี่เปีย" group (`STOCK_GROUP`, kind warehouse, no
  supplier to pay) while the balance lasts, first come first served (`stockPlacer`); orders already cut stay there; the
  rest stay on their usual sheet with a notice. Rows can also be moved there by hand. Saving / ticking / deleting a
  round re-cuts its stock (`syncRoundStock`).
- What we pay (internal, never on supplier sheets): ทุน = sheet column H only (Benz 2026-10-15; ราคาร้านค้า N not used),
  or a cost typed on the page; amount = (qty − out of stock) × price. "ยอดจ่ายร้าน" card per supplier + internal
  Excel "สรุปจ่ายร้าน (ภายใน)" (`paymentWorkbook`). Payments: amount, "จ่ายแล้ว" tick (no amount = the amount owed),
  note (`purchase_payments`, `PUT /api/purchase/payments`). "ยอดค้างจ่ายร้าน" = last 60 days of rounds not ticked
  paid (`GET /api/purchase/ledger`).
- Baseline 2026-10-13: today's Bigseller file 304/335 pieces matched.

## Units sold `/catalog/sales`

- `GET /api/sales?from&to` (≤ 62 days). Bigseller from `purchase_items`: each order + SKU counted once, on the day of
  the round where it first appeared (in-process orders come back in later rounds). Page365 (Facebook) from
  `p365_orders` by the order's date.
- Daily chart + table by channel with which source had a file that day; tabs by sales store / product / warehouse.
  "ต้นทุนของเรา" = cost of what was sold, labelled as not sales. Revenue here is Facebook only; money for every
  channel is on the profit page. Rounds saved before 2026-10-15 have no order rows (upload the file again).

## Profit `/catalog/profit`

- Per channel and per product: revenue − fees − catalog cost − ads (`GET /api/profit`).
- Facebook: Page365 orders with `settings.order_fees`; ads = Meta spend only on days that have a Page365 file.
- TikTok / Shopee / Lazada: the platform's own order or income export, uploaded on this page. Read in the browser
  (`web/src/money.ts`): header row found under title rows; columns guessed (order no., amount gross or net of fees,
  fee columns, date, status, SKU / qty / item amount), picked once and saved per header layout (`mp_import_maps`);
  cancelled / unpaid / returned left out by default; only order no., date, status, amounts, fees and SKUs are sent →
  `mp_orders` (migration 0041, upsert by order no.; no date = the day the order first appeared on an order sheet).
- Items come from the file or the order-sheet rounds; an order's money and fees are split over its items by value, so
  products add up to channels. Cost = catalog ทุน (the same raw cost as Page365's, kept equal on upload) + the one set of `order_fees`, as on every page.
- No real TikTok/Shopee export has been tried yet: check the guessed columns on the first upload.

## Stock `/catalog/stock` (Benz 2026-10-15; replaces the "Stock BB" sheet)

- Products: `stock_items`; which place keeps which: `stock_locs` (migration 0050). พี่เปีย and GoSell = 501/1, 501/2,
  501/3, 701/1, 701/2 × sizes 28–36; PK = every size of our 39 codes in the PK tab (200 … 009/2, Ni8/Ni9, D01/D02).
  `stock_links`: 601/1–3 sold at พี่เปีย are cut from 501/1–3 of the same size. Balance = Σ `stock_moves.qty`
  (open / in / out / adjust):
  - PK (`pk`, our PK warehouse, 2026-10-19): cut by the order sheets' "PK" sheet, like พี่เปีย, including the round's
    Facebook orders and typed lines. Starts once its starting balance is set ("ตั้งยอดเริ่ม", owner/admin).
  - พี่เปีย (`pia`, our branch at BB, the sheet's tab BB): cut by the order sheets — what is in a saved round's
    "พี่เปีย" group, each order + SKU once (`stock_orders`, so in-process orders that come back are not cut again),
    less pieces ticked "ของไม่มี". Only rounds dated after the starting balance count.
  - GoSell (`gosell`, the fulfillment warehouse, the sheet's tab Fulfillment): cut by "ตัดสต็อก GoSell…" on the GoSell
    page after a file — it hands the file's order + SKU + qty to this page (localStorage, same browser; the GoSell page's
    own Access app can't call `/api`), which shows what would be cut and cuts on confirm (`POST /api/stock/gosell`),
    each order + SKU once.
- Page: tabs พี่เปีย / GoSell, model × size grid (≤ 5 orange, ≤ 0 red), "รับของเข้า" (received), "ปรับยอด (นับจริง)"
  (counted → only the difference is saved), 45 days of history (typed entries can be deleted). Team members add stock
  themselves; a starting balance is owner/admin only.
- รับของเข้า at พี่เปีย (idea #16, มอส): the same SKUs are also cut from PK's stock (`out`, ref `pia-in:…`, once PK has a starting
  balance; SKUs PK doesn't keep are left alone); deleting the typed receipt deletes that cut too (`cutPkForPia`).
- Starting balance: the sheet's "Stock คงเหลือ" on 2026-10-15 after the noon round (pia 540, gosell 811; sizes at 0
  left out), loaded once; cutting from the order sheets starts with rounds of 2026-10-16. The sheet is retired after that.
- Forecast (`web/src/forecast.ts`, Benz 2026-10-15 "ตาม trend"): each cell shows how many days the balance lasts, and a
  card lists per model the last-7-day sales, trend vs the 7 days before, tomorrow's forecast, and the sizes that won't
  last the chosen 7/14/21/30 days with how much to add. Demand: พี่เปีย = TikTok/Shopee pieces from the order-sheet
  rounds, GoSell = Facebook pieces from Page365; last 28 days with data, today left out. Per model: ≥ 7 data days → a
  weighted straight line (recent days count more, 0.9 per day back), kept between ¼ and 3× the average; fewer → the
  average. Split over sizes by their share of the model's pieces (+½ piece per size). พี่เปีย has little history until
  the order rounds build up (only rounds saved with order rows count).
- 07:30 #report lists sizes at ≤ 5 pieces.

## งานค้าง `/catalog/todo`

From units sold in the last 7/14/30 days, most sold first: unknown SKUs (match / add), products without a cost (type
it), BB products the order sheets would put in "ยังไม่ระบุร้าน" (same `groupOf` rule; set supplier), products without
a picture, web SKUs not yet in the sheet. Linked from the order page's "ต้องตรวจสอบ" box.

## Morning report in #report

07:30 Discord "หลังบ้าน" (`worker/opsDigest.ts`; secret `DISCORD_REPORT_WEBHOOK_URL`, else `DISCORD_WEBHOOK_URL`;
preview `GET /api/ops-digest?date=`, post now with `POST` as owner/admin): yesterday's order-sheet rounds (pieces per
round; per supplier from the latest round, since later rounds repeat in-process orders), pieces sold per channel,
marketplace orders with / without money, owed to suppliers (60-day ledger, suppliers + พี่เปีย), SKUs sold in 7 days
that the catalog doesn't know.

## Stock — more places (idea #12, มอส; not built yet, waiting for answers in the PR)

Asked: one stock sheet per shop, each cut by the order-sheet groups of its suppliers: AR ← AR · BB ← เจ๊ศรี, ส.ประสาน,
NBG, แพลนเนท, KM, J.Big, ป.ไพรศาล, พี่เปีย · BBW ← นอร์ท · BT ← BT · GG ← GG · CM ← CM · CN ← CYD โกดังจีน; and a return
("ตีกลับ") scanned/keyed puts the product back into stock.
