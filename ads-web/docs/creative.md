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

## Starting with the team (Benz 2026-10-23)

State on 2026-10-23: everything in the build order below except the learned page is live, but nothing has been
judged yet (0 pairs). The Drive photo sync can wait: the image check uses the catalog photo. Captions first (cheap,
fast); images from week 2.

0. **Agree once with the team.** Judges 2–3 (include someone who talks to customers in the chat); 3–5 starting
   products that run as ads and sell (so real posts have something to play against); time: one-off 2–3 h of
   materials, then ~10 min/day per judge (≈20 caption pairs + 10 image pairs). Everyone reads the PDF manual in the
   training room's how-to box first. Benz decides: who judges, which products, who does step 1.
1. **Owner, ~30 min, `/studio/posts`.** "ดึงโพสต์จากเพจ" → fill missing product codes → "ให้ AI วิเคราะห์โพสต์ที่ยิงอยู่"
   → read/edit the draft playbook → "ใช้คู่มือนี้" → "ให้ AI ติดป้ายภาพ".
2. **Team, `/studio` วัตถุดิบ.** Selling points + promos of the chosen products (the agent may only use numbers from
   here); 3–5 liked and 3–5 disliked caption examples, each with a one-line reason; banned / required phrases; 1–2
   style cards with 3–5 reference images (needed only for the image room).
3. **Week 1, captions only.** "ให้ AI เขียนแคปชัน 6 แบบ" per product, judges every day. Watch "AI ชนะโพสต์จริง":
   target ≥ 50% over ≥ 40 pairs. Read it after a week, not after a day.
4. **Week 2, images.** The room writes the prompt → staff make it in ChatGPT Plus → upload → judges. Passed caption ×
   passed image → `/studio/sets` → approve.
5. **Not now.** Drive photo sync (when the image room gets serious; the folder must be "anyone with the link can
   view", for `GOOGLE_API_KEY`). Hand-off to the ads side stays off until the room's pick matches the judges ≥ 70%
   for two weeks, and Benz switches it on.

## Foundation: posts running as ads (`/studio/posts`, Benz 2026-10-22)

"ดึงโพสต์จากเพจ" reads every ACTIVE ad from Meta (read only: `activeAdPosts` in ads-engine/meta.ts — ads list, the
posts' `message,full_picture,permalink_url` 50 per call, ad-level last-14-day insights), groups ads by post
(`groupPosts`: numbers summed, product code guessed from the campaign name with `nameHasFamily`, longest code first,
editable; a name with only the model ("801", "Ni9", "SH004") gets its biggest sub-model ("801/1", "Ni9-1", "SH-004"), `modelOf`) into `meta_posts` (migration 0056). Posts no longer running stay, marked inactive. Pictures: Meta's links
expire, so right after the import the browser fetches each through `/api/catalog/image-proxy` (fbcdn is allowed),
resizes and stores it. Numbers are Meta-tagged (real runs ~11–14% lower). The 6 posts with ≥ 1,000 spend and the best
ROAS go into the caption agent's prompt first; any post can become a liked/disliked caption example with a reason.

### AI read of the posts + blind test against them (Benz 2026-10-22)

- "ให้ AI วิเคราะห์โพสต์ที่ยิงอยู่" (`analyzePosts`): Claude reads every active post with ≥ 300 spend (caption +
  numbers, pictures of the best 8 and worst 6) and returns 5–8 findings with evidence + a draft playbook, saved as a
  proposal (`playbook_versions.approved_by` NULL, findings in `note`, migration 0057). Used only after "ใช้คู่มือนี้"
  (editable first). `/studio` shows a banner while a proposal waits.
- Real posts in the A/B (`seedRealCaptions`, after every import and before every generation): posts with ≥ 500
  spend, a caption and a product code become caption candidates with hook `real`, once each. `nextPair` serves an AI
  vs real pair first, A/B order random; labels are hidden while judging, the answer is revealed after the vote. The
  room shows "AI ชนะโพสต์จริง x/y" — readiness target ≥ 50% over ≥ 40 pairs. The agent is told not to copy sentences.

### The AI looks at images (Benz 2026-10-22)

Every uploaded image is checked by Claude on upload (`checkImage`; again with "ตรวจใหม่"): compared with the real
product photo (catalog upload, else column J) and up to 3 style references → JSON product_match / text_readable /
style_match / looks_fake / verdict pass·check·fail + summary, stored in `creative_candidates.ai_check` (migration
0058). Staff see it right after upload and can take an image out of the room ("เอาออกจากห้อง" = status rejected).
While judging the AI's scores stay hidden; after the vote they're shown. The room shows how often the AI's
better-scored image was the judges' pick (`stats.ai_eye`) — high enough, and the AI can screen images instead of people.
Product-code boxes on `/studio/posts` suggest codes + names as you type (`CodePicker`, list read once).
The staff manual is `web/public/studio-guide.pdf` (exported from the Claude Docs doc "คู่มือห้องฝึกโพสต์ PK Jeans", https://claude.ai/artifact/ByLU5Q73xjT6KrXDTmFXAA), linked from the training room's how-to box; re-export and replace it when the doc changes.

### ห้องจับคู่ (`/studio/sets`, Benz 2026-10-22)

`passedFor(code)`: captions (not real posts) that won more than they lost or that a judge edited (the edit is the
text), and images with ≥ 1 win, no more losses than wins and no AI "fail". Products with something passed are listed
(`readyProducts`). Pick one of each → preview as a post (caption editable) → "บันทึกเป็นชุดโพสต์": Claude checks the
picture and caption agree (same product, same price/promo) → `creative_sets` (migration 0059) as draft → อนุมัติ /
ไม่ใช้. Approved sets are what the ads side may take later; nothing is sent to Meta from here.

### The image room learns (Benz 2026-10-22)

1. **Tags.** A fixed list (`IMAGE_TAGS`: subject worn/flat lay/…, text on it, background, face, colours, look;
   migration 0060). "ให้ AI ติดป้ายภาพ" on `/studio/posts` tags the posts' pictures 6 per Claude call (`tagMetaPosts`,
   the page loops); every uploaded image gets tags in the same call as its check. "ภาพแบบไหนขายดี" (`imageTagStats`):
   per tag value, posts, spend, combined Meta-tagged ROAS, and room wins/losses where two judged images differ on it.
2. **Real pictures in the A/B** (`seedRealImages`, ≥ 500 spend, a code and a stored picture; after import and after
   tagging), hook `real`, blind like the captions; "ภาพใหม่ชนะภาพโพสต์จริง x/y" (target ≥ 50% over ≥ 30 pairs).
3. **Prompt that learns** (`learnedImagePrompt`): Claude rewrites the template from the tag table, the prompts of
   images that won and the reasons images lost, keeps the "don't change the product" rule (else the template is
   used), and names one thing to try this round from a tag with little data. **Gate**: an image whose product scores
   ≤ `HOLD_BELOW` (4) is `held`, not shown to judges, until staff press "ส่งให้กรรมการอยู่ดี". **Checker lessons**
   (`checkerLessons`): images the AI passed but judges turned down for product/text/fake/style go into the next
   check's prompt (latest 6).

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

1. ✅ 2026-10-22: `/studio` (playbook, style cards + reference pictures, caption examples, per-product จุดขาย/โปร) and `/studio/train` (Claude writes 6 captions per product, A/B pairs with one-tap reasons, edit-and-pass, ChatGPT image prompt + upload, a short learned block). Routes `/api/studio/*` in `worker/studio.ts`; everyone who can log in may write there, viewers included (Benz 2026-10-22). Drive photo sync parked (Benz 2026-10-22: "เอาไว้ก่อน"); the image check uses the catalog photo until then.
2. Image room (prompt writer + upload of ChatGPT results); `OPENAI_API_KEY` optional later.
3. Pairing + learned page + weekly playbook proposal.
4. Hand-off to the ads side (off until Benz switches it on).
