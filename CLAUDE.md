# LoopDesk (thai-sme-pos) — project map for Claude

Thai jeans shop "Climax by PKjeans". A POS app (React + Vite, `src/`) plus **LoopDesk**, an AI marketing loop for
content + ads (Fastify + PGlite/Postgres, `server/`). Everything user-facing is Thai. No customer-chat features — scope is
build content → approve → post → run ads → measure → learn.

## Commands
- `pnpm dev` web :5173 · `pnpm server:dev` API :3001 · `pnpm server:seed` (first run) · `npm run demo` (all in one)
- Checks: `pnpm typecheck` (web) · `npx eslint src` · `cd server && pnpm exec tsc --noEmit -p . && pnpm exec vitest run`
  (one pre-existing lint error in `src/test/setup.ts` is not ours)
- Demo file: `pnpm build:artifact` → `docs/mockup/demo.html` (snapshot + offline fetch shim; publish to the existing
  artifact URL, never a new one). Playwright is at `/opt/pw-browsers`, import from `/opt/node22/lib/node_modules/playwright/index.mjs`.
- If the dev server misbehaves after a kill: `rm -rf server/data/pglite` and reseed. Kill with `pkill -f "[t]sx src/index.ts"`.

## Design rules (decided — do not redesign)
- Theme **Soft Denim**: tokens in `src/index.css`; classes `.panel .panel-pad .panel-head .btn .btn-primary .btn-sm .chip
  .chip-good/warn/crit/brand .field .t-head .t-sub .t-label .t-mono .t-num`. Fonts Mitr / IBM Plex Sans Thai / Plex Mono.
- Views (nav order): ขายหน้าร้าน · ภาพรวม · สต็อก · การตลาด · เทรนด์ (`src/trend`) · คิวอนุมัติ (`src/approve`) ·
  ออฟฟิศ (`src/office`, 8-bit canvas) · ระบบหลังบ้าน (`src/studio`) · รายงาน (`src/report`). Hash routing `#View?agent=slug`.
- Non-tech owner teaches by typing Thai: instructions, examples, 👎+note (corrections), add-on toggles, directives from trends.
- React Compiler lint: no `Math.random()/Date.now()` in render, no setState in effects (use lazy init / promise chains).

## The loop (server/src/ai)
- `catalog.ts` 13 boxes (kind ai|automation|human, team, step, cron, runPrompt, add-ons). `AGENT_BY_SLUG`.
- `prompt.ts` system prompt: identity → immutable rules → owner instructions → examples → corrections → directives →
  approved rules → brand docs → volatile data (signals, ads, posts, competitors, runs). Keep stable-first for caching.
- `llm.ts` Claude via `@anthropic-ai/sdk` (`claude-opus-5`, per-box `effort`, cached system prompt, fallback
  `claude-opus-4-8`). No key or `LOOPDESK_AI=demo` → `demo-brain.js` (plain JS, grounded in shop data, inlined in the demo).
- `handoff.js` (plain JS, shared with the demo): work items intel → brief → post → review → approval → publish; risky boxes
  only propose. `work.ts` DB layer. `jobs.ts` runAgent: inbox → tasks → outcome → chain next non-human box (event).
- `trends.ts` trends + directives. `cron.js` matcher. `jobs/scheduler.ts` node-cron per box, Asia/Bangkok,
  `LOOPDESK_SCHEDULER=off` to disable. Migrations in `server/src/db/migrations/00N_*.sql`.
- Tests `server/test/*.test.ts` (vitest, in-memory PGlite, demo mode). Add a test with every behaviour change.

## Security invariants
Tokens AES-256-GCM at rest, never returned by the API; disconnect destroys secrets; OAuth state single-use;
customer/post text is data not instructions; AI only proposes in propose mode; stock guard blocks ads on products with
missing core sizes.

## Working style
One feature per session with a 3–5 line spec; verify with tests first, screenshots last; rebuild + publish the demo once
at the end; commit with the attribution lines the session provides. Phase gates: real posting needs Meta App Review
(`pages_manage_posts`), real ads need `ads_management` + Business Verification; app admins can use their own page in
Development mode without review.
