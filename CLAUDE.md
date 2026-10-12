# thai-sme-pos

Direction: e-commerce system for Thai SMEs. The React app in `src/` is an early cafe-POS prototype; the active work is `ads-engine/` and `ads-web/`.

## ads-web (dashboard + scheduler on Cloudflare, free plan)

- Worker + D1 + React (`ads-web/README.md` has deploy steps). Imports ads-engine's `rules.ts`, `apply.ts`, `meta.ts`, `notify.ts` directly — change rule logic there, not in a copy.
- Two axes per campaign. **Stage** (`stages` table, fixed four: experiment / testing / winning / retest) is set by Benz and carries the rules; no stage = never automated. **Product section** (keyword in campaign name, or pinned) links sheet product codes → break-even ROAS; rules use `value_mode: "x_breakeven"` so one stage rule set fits every product. Engine groups by stage × section.
- Profit is counted per piece, not per order: one ad sells several promos (1 for 189, 3 for 549) and Meta only reports orders + value. Pieces ≈ value ÷ price per piece (promos in the campaign name, e.g. "1 ตัว 189 (3ตัว549)", plus section `tiers`; else manual price; else cost column I); sheet cost is all-in (shipping + returns), so no per-order extra by default. Pieces/profit are a range; rules use the conservative end. COD +50: not added (counted only if admins include it in the tagged value).
- Stages are seeded with no rules and every campaign starts unassigned: Benz wants view-only until he sets rules himself. Suggested sets are in `ads-web/web/src/stageTemplates.ts` (opt-in button) — don't seed them.
- Rule action `move` (campaign level, `min_days_in_stage`, usually `min_purchases`) changes the stage in D1 only; evaluated separately from Meta actions and applied only outside dry-run. A campaign can also use its own rules (`custom`) or none (`off`).
- Owns the daily schedule (08:00/20:00 BKK). The GitHub Actions workflow is manual-only so the two never both act.
- Free-plan limits shape the code: cost sheet is aggregated by Google (`COST_QUERY`), D1 bulk writes via `json_each`, ≤25 changes per run. Google takes 5–15 s per tab on this workbook.
- Production: https://pkjeans-ads.ads-web.workers.dev (Cloudflare free plan, D1 `pkjeans-ads` in APAC). Behind Cloudflare Access (Zero Trust Free, team `broad-cell-d05a`): Cloudflare-account members + reusable policy "PkJeans team" (emails, one-time PIN). Adding a person = edit that policy's email list. Meta token is a Worker secret. Deploy: `cd ads-web && npm run deploy`.
- Meta app "Stat" (1410718820800711, System User Ads_ai) is on development access tier: few API calls, so the dashboard caches Meta data 5 min (`meta_cache`).
- Local: `cd ads-web && npm run dev` (`.dev.vars` holds the real token + auth bypass; local D1 is separate from production — edit stages/rules on the production site), `npm test`, `npm run typecheck`.
- Per-campaign costs override all of the above: the team's sheet "FB คำนวณค่า ADS" (id in dashboard settings, not git), tab `รวมต้นทุน ที่เปิด ADS ` (trailing space), one block per Meta campaign name with "ราคาขาย N ตัว P" + all-in cost per order (col D). Synced to `campaign_costs` at 07:30 / on demand, matched by whitespace-collapsed lowercase name, else by the same name minus budget (฿200, -50฿) and version (V3, #1) — costliest block if several. Two promos → mix solved exactly from orders + value; otherwise a range from cost÷price. Rules engine still uses product-level break-even.
- Profit on every page is costed order by order: Meta's hourly purchases per campaign (`conversion_hours`, synced 07:30 for the last 3 days + 5 older missing days, 30 kept; today live) are split into orders and matched to the campaign's promos (`worker/transactions.ts`: ≤3 sets per order, ±COD 50); matched orders use the promo cost, others a conservative cost ÷ price share. The window's cost ÷ revenue from those orders is applied to Meta's window revenue. Days without stored hours fall back to the daily-total estimate. Promo/cost per campaign come from `worker/costing.ts`.
- Which ad each customer came from: Meta's API refuses this after the fact (page labels `ad_id.*` exist but can't be read per user), so the Messenger webhook (`worker/webhook.ts`, `/webhook/meta`, signed with the app secret) stores psid + ad + time into `ad_referrals` from the day it was connected (2026-10-09); `ad_map` resolves ad → campaign. Cloudflare Access has a second application that bypasses `/webhook` (everything else stays behind login); `/webhook/privacy` is the app's privacy policy page. Secrets: `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`; var `META_APP_ID`. Settings page has status + one-click connect. Page365 has no public API — order matching needs a sheet/CSV export.
- Page365 is the order book (no public API): staff upload its daily order export (.xlsx, parsed in the browser by `web/src/xlsx.ts`, only numeric columns + item SKUs sent; profile name hashed with the webhook verify token as salt, never stored) → `p365_orders` (`worker/p365.ts`). Each order is credited to a campaign: by customer (name hash ↔ `ad_referrals.name_hash`, chat ≤14 days before) else by hour + value against `conversion_hours` (admins tag the sale into Meta when they open the order, so Meta's hourly purchases per campaign ≈ the orders created that hour; ±50 COD fee per order tolerated; next-hour matches are `approx`). Uploaded days use real revenue / Page365 cost (+ shipping collected) / pieces on the sales page (`calc.method = 'actual'`); orders no campaign fits show as "ไม่ทราบแอด". Upload also fills `actual_sales`. Re-credited for the last 3 days each 07:30. Baseline 2026-10-08: 74 orders, Meta tagged 68 (92%); 64 credited by time+value.
- Costs can also be typed in the dashboard (Products page, or inside a product editor): stored in `costs` under pseudo tab `WEB`, never touched by sheet syncs; `WEB` is refused as a sheet tab name.
- `/gosell` (standalone page, own header, not a dashboard tab; same Cloudflare Access login): order export, either Bigseller CSV (UTF-16 TSV, one row per item) or the per-order .xlsx (`Order no.` + `Item Detail` "(SKU) (SKU) xN THB line-total") → GoSell "Import Orders" xlsx, entirely in the browser (customer PII never sent). Logic in `web/src/gosell.ts`; fills `web/src/gosellTemplate.xlsx` (GoSell's blank template) from row 9 via `web/src/zip.ts`. Agreed mapping: one row per order, `SKU (qty), …` + per-SKU prices comma-separated, Discount → ส่วนลดคำสั่งซื้อ, export's Shipping Cost (the COD 50) → ค่าบริการเก็บเงินปลายทาง (R), ค่าส่ง 0, customer name kept as-is (with PK-xxxx prefix), Kerry → KEX. `Gosell/` (real exports) is gitignored.
- Cost sheet: `SKU+Price` (id kept out of git — the repo is public and the sheet is link-shared; it's entered in the dashboard's settings), one tab per warehouse, B SKU · C product code · D description · H cost · I price. Shared "anyone with link" — that's how ads-web reads it.

## ads-engine (Meta Ads, rule-based)

- Zero-dependency Node 24 TypeScript. `cd ads-engine && npm run run` = dry run, `npm run apply` = change budgets for real, `npm test` = rule logic tests.
- Talks to the Meta Marketing API directly with a System User token in `ads-engine/.env` (gitignored). No LLM in the daily loop — keep it that way.
- Rules are data in `ads-engine/rules.json`. Guardrails there cap budget moves; `KILL_SWITCH=true` in `.env` stops everything.
- `.github/workflows/ads-engine.yml` runs it manually (schedule moved to ads-web).

Division of labour: ads-engine runs the if/then rules; Claude (via the `meta-ads` MCP) is for ad-hoc questions, reading `ads-engine/logs/`, and proposing edits to `rules.json`. Any change that can start spend (ENABLED status, budget increases) needs explicit approval from Benz.

## Meta access

- `meta-ads` MCP = Meta's official Ads MCP (https://mcp.facebook.com/ads), added at user scope and signed in. Supermetrics trial expired 2026-09-18 — don't use it.
- Main account: PkJeans `act_2149666808519411`. Others: PKjeans2 `act_822911542923398`, PKJeans3 `act_3743524862582232`, Climax by มนต์รักยีนส์ `act_752083272582459`.

## PkJeans baseline (21–27 Sep 2026)

Full tables in `ads-engine/reports/2026-09-21_to_27_pkjeans_7d.md` (gitignored). Re-run the current rules against it with `node ads-engine/reports/simulate-from-report.ts ads-engine/reports`.

- Spend 108,991 THB · 823 onsite purchases · ROAS 3.01 · CPA 132 · AOV 399 · frequency 2.7
- 59 of 61 ad sets are under CBO campaigns → budget rules act at campaign level
- Objective OUTCOME_ENGAGEMENT optimising MESSAGING_PURCHASE_CONVERSION; purchases are admin-tagged chat orders; no messaging-conversation metric available
- Open questions: gross margin / break-even ROAS (not given yet); 21 Sep had 235 purchases vs ~100 other days; ads are unnamed ("โฆษณาการมีส่วนร่วมใหม่") so ads can't be mapped to SKUs yet
