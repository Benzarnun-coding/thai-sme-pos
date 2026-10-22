# ห้องฝึก (creative training room)

Benz 2026-10-22: before any AI-made post reaches Meta, two agents (captions, images) are trained in a closed room
where staff judge their output. Nothing here touches Meta, Page365 or customers. Decisions so far:

- Judges: 2–3 staff (people who talk to customers, not only graphics). Judging is **A/B pairs** (two candidates, pick
  one, one-tap reason), plus "แก้แล้วผ่าน": a judge may edit a caption, and the edited text becomes a gold example.
- Two rooms first (captions are cheap and fast, images slow and costly, and they fail for different reasons), then a
  third step **จับคู่** that pairs an approved caption with an approved image of the same product into a "ชุดโพสต์".
  Only approved sets can ever be handed to the ads side (through the existing `proposals` buttons, later).
- Images in v1 are made by staff in ChatGPT Plus from a prompt the room writes (a Plus subscription has no API; the
  OpenAI image API needs a platform key with prepaid credit — switch later by setting `OPENAI_API_KEY`). The room
  still records the prompt, style card and product behind every uploaded image, so the learning is the same.
- Product photos come from a Google Drive folder, synced by name to the catalog (below).

## Foundation: posts running as ads (`/studio/posts`, Benz 2026-10-22)

"ดึงโพสต์จากเพจ" reads every ACTIVE ad from Meta (read only: `activeAdPosts` in ads-engine/meta.ts — ads list, the
posts' `message,full_picture,permalink_url` 50 per call, ad-level last-14-day insights), groups ads by post
(`groupPosts`: numbers summed, product code guessed from the campaign name with `nameHasFamily`, longest code first,
editable) into `meta_posts` (migration 0056). Posts no longer running stay, marked inactive. Pictures: Meta's links
expire, so right after the import the browser fetches each through `/api/catalog/image-proxy` (fbcdn is allowed),
resizes and stores it. Numbers are Meta-tagged (real runs ~11–14% lower). The 6 posts with ≥ 1,000 spend and the best
ROAS go into the caption agent's prompt first; any post can become a liked/disliked caption example with a reason.

## Materials (`/studio` วัตถุดิบ)

| Material | Where it lives | Notes |
|---|---|---|
| Product photos, several angles per model | Drive folder, file name `<code>_<angle>.jpg` (e.g. `801_front.jpg`, `801_model1.jpg`); `<code>` = catalog product code (column C) | Synced by a button (and 07:30): public folder read with a Drive API key (`GOOGLE_API_KEY`, var), file ids stored in `creative_assets`, bytes fetched on demand and cached — not copied into D1 |
| Style cards | `/studio`: name, 1–2 lines "what we like about it", 3–5 reference images (uploaded, or Drive `styles/<name>/`) | Reference images = staff's own ChatGPT results they liked, competitors' posts |
| Caption examples, liked and disliked, each with a one-line reason | `/studio` | The reason is required: a bare example teaches nothing |
| Product facts: price, promos, sizes, fabric, selling points | catalog + `campaign_costs` already; a free-text "จุดขาย" per product on `/studio` | Agents may only use numbers that come from here |
| Banned / required phrases | `/studio` | e.g. no body claims; "ส่งฟรี" when the promo has it |

## Rooms (`/studio/train`)

- **Captions**: pick a product + promo → Claude writes 6 captions, each tagged with its hook (price / durability / big
  sizes / review / scarcity / promo math …). Judges see pairs. Model `claude-opus-5-5` via the existing
  `ANTHROPIC_API_KEY`; the playbook + gold examples are the cached system prompt.
- **Images**: pick a product + style card → the room writes the ChatGPT prompt (product photo attached by the staff,
  "do not change the product") → staff paste the result back. Judges see pairs. Tagged with style + layout.
- **Pairing**: approved caption × approved image of the same product → one more A/B or approve → `creative_sets`.
- Every candidate stores its inputs (product, promo, style, playbook version, prompt) → "which styles were already tried
  for this product" is a query, no Meta sync needed.

## What it learns (`/studio/learned`)

- Gold examples (approved / edited) → few-shot in the next generation (immediate).
- One-tap reasons → the weekly "3 bullet" playbook proposal: Claude drafts ≤ 3 changes with the judgement rows behind
  each; applied only on a button press; every version kept (`playbook_versions`).
- Win rate per hook / style from A/B pairs → the planner's prior before any Meta result exists.
- Agreement: a share of pairs goes to two judges; the page shows how often they agree. Below ~70% the team talks
  before the room is trusted.
- Graduation: when the room's own pick matches the judges' ≥ 70% for two weeks, the ads side may start taking
  approved sets (that step ships off; Benz switches it on).

## Tables

`creative_assets` (kind photo/style_ref/caption_example, product key, drive id or blob ref, note, by/at) ·
`style_cards` · `creative_candidates` (kind caption/image, product, promo, hook/style tags, text or image ref,
prompt, playbook_version, created_by agent/staff) · `creative_judgements` (pair a/b, winner, reason, edited_text,
judge, at) · `creative_sets` (caption id + image id, status) · `playbook_versions` (version, text, proposed_by,
approved_by, at).

## Costs

Captions: well under 100 THB/month. Images via staff's ChatGPT Plus: 0 extra. Image API later: ~1,000–1,500 THB/month at
50 images/week. Staff time: a one-off 2–3 h of uploads, then ~10 min/day of judging (≈20 caption pairs + 10 image pairs).

## Build order

1. ✅ 2026-10-22: `/studio` (playbook, style cards + reference pictures, caption examples, per-product จุดขาย/โปร) and `/studio/train` (Claude writes 6 captions per product, A/B pairs with one-tap reasons, edit-and-pass, ChatGPT image prompt + upload, a short learned block). Routes `/api/studio/*` in `worker/studio.ts`; everyone who can log in may write there, viewers included (Benz 2026-10-22). Still to do: Drive photo sync (needs the folder + `GOOGLE_API_KEY`).
2. Image room (prompt writer + upload of ChatGPT results); `OPENAI_API_KEY` optional later.
3. Pairing + learned page + weekly playbook proposal.
4. Hand-off to the ads side (off until Benz switches it on).
