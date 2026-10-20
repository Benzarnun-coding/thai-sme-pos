# Chats and Meta's Business AI

Agreed with Benz and Max on 2026-10-15. Page365 stays the app that owns the Messenger threads. Our app "Stat" only reads.

## Chat log (`worker/chatLog.ts`, migration 0030, 0031)

- The webhook (`/webhook/meta`) already gets every message as `messaging` or `standby` events. That includes the page's own replies as `message_echoes`. Each one is stored in `chat_messages`:
  - mid, psid, time
  - from_page: 1 = page, 0 = customer
  - text, attachment types
  - `sender_app`: the echo's `app_id`
- Kept for 30 days and purged at 07:30. The privacy policy (`worker/privacy.ts`) says so.
- Text is redacted before storage by `redactChat`:
  - An address-like message (address words + postcode, or two address words + a house number) becomes `[ที่อยู่]`.
  - E-mails become `[อีเมล]`.
  - Tracking codes and any run of 7+ digits become `[ตัวเลข]`. Phones become `[เบอร์]`.
  - Names the page or its bot use for the customer become `[ชื่อ]`. This covers names after คุณ, พี่, น้อง, ลูกค้า and สวัสดี, and Meta's "สวัสดี <name>!" follow-up.
  - Names typed any other way can still get through. If the rules change, `POST /api/chats/reredact` (owner only) re-applies them to stored rows.
- `sender_app`:
  - `237031236431724` = Page365. These are admins and are labelled "แอดมิน".
  - `263902037430900` = Meta's own app. Both the Business Suite inbox (a person) and Business AI (the bot) use it, so these lines stay "เพจ" and the AI tells them apart by wording.
  - The mapping lives in the vars `CHAT_HUMAN_APP_IDS` and `CHAT_BOT_APP_IDS`.

## Daily report in #meta-chat (07:30, for yesterday)

- **Numbers** (`chatDay` / `chatDayText`, webhook `DISCORD_CHAT_WEBHOOK_URL`):
  - customers, messages, addresses sent
  - median first reply and the slowest 10%, plus customers left unanswered, overall and by time band
  - per ad: chats → page answered → order note
- **AI read** (`worker/chatInsights.ts`):
  - One model call with the redacted transcript. Customers are numbered, with the time of their first message and their ad.
  - It writes: frequent questions, why people didn't buy, the 3-piece upsell, post ideas, Business AI facts, a "🤖 บอท Meta AI วันนี้" section, and chats to follow up.
  - It must not invent product facts; anything it can't take from the chat is marked "(ทีมต้องยืนยัน)".
  - The full text and token counts are logged in `audit` (`chat.insights`).
- On demand:
  - `POST /api/chats/report?scope=today|yesterday`
  - `POST /api/chats/insights?scope=today|yesterday`
  - `GET /api/chats/summary`
- AI billing:
  - Secret `ANTHROPIC_API_KEY`, org key from Benz's Console org "Benz (เบ้น)'s Individual Org", to move to a company account later.
  - Var `ANTHROPIC_WORKSPACE_ID` = workspace `pkjeans-ads`, with a $20/month spend limit.
  - Model `CHAT_AI_MODEL`, default `claude-haiku-5-5`, with thinking disabled. Thinking used up `max_tokens` and left an empty answer.

## Answer bank for Business AI (`worker/botKb.ts`, migration 0032, page `/botkb`)

Meta has no API for Business AI's settings, so a person pastes the answers in.

- **Mon/Thu 08:00** (after the rule run):
  - The AI reads the chats since the last round and proposes up to 8 fixes: where the bot was wrong, promised a discount, or should have handed over.
  - Each fix is posted by the bot in #meta-chat (`DISCORD_CHAT_CHANNEL_ID`) with ✅ / ❌ buttons (`kbok` / `kbno`). Only `DISCORD_APPROVER_IDS` (Benz, Max) can press them.
- **Mon 10:00** (and Tue 10:00 if still waiting), only when some answers are approved:
  - The bot tags Fear (`DISCORD_KB_UPDATER_IDS`) to copy them from /botkb into Meta Business Suite → Business AI and press "ใส่บอทแล้ว" (`kbapplied`; approvers + Fear can press).
  - That press marks them `applied` with the date, so later rounds can compare before and after.
- Endpoints:
  - `GET /api/botkb`
  - `POST /api/botkb/:id {status}`
  - `POST /api/botkb/applied`
  - `POST /api/botkb/generate?mode=fix|faq` (faq = the first bank from all stored chats; 12 made, 8 approved, 15 Oct)
  - `POST /api/botkb/remind-test`
- Statuses: proposed → approved/rejected → applied.

## Findings, 15 Oct

- Business AI was already answering customers. On the 15th it:
  - gave a COD discount the admins then didn't honour
  - invented "ผ้าคอตตอนสีไม่ตก"
  - answered a double-charge complaint with "ไม่สามารถช่วยได้"
- Its follow-up template ("สวัสดี X! เราต้องการติดตามผล…") went to 5 customers. All 5 replied and none ordered.
- These were sent to Max in the ads channel with suggested settings:
  - hand over complaints, refunds and parcel issues
  - no discounts
  - no product facts that aren't in the shop's info
  - clear shipping (transfer free / COD +50)

## service ลูกค้า (`worker/serviceAlert.ts`, migration 0051, Benz 2026-10-20)

After answer-bank fix #13: a customer said they got a zip instead of buttons and asked for a refund. The bot quoted a refund policy on its own and the customer got angrier.

- Every customer message the webhook stores is checked by `serviceReason`:
  - refund (คืนเงิน, เงินคืน, โอนคืน)
  - not as pictured (ไม่ตรงปก, ไม่ตรงกับรูป)
  - wrong item (ส่งผิด, ผิดแบบ/สี/ไซส์, "สั่ง… แต่ได้…")
  - return / exchange (คืน/เปลี่ยนสินค้า, ส่งคืน, เคลม)
  - complaint (ร้องเรียน, ไม่พอใจ, ชำรุด, เก็บเงินซ้ำ …)
  - a leg length / hem width question with a number word ("ขายาวกี่นิ้ว", "ปลายขากว้างเท่าไหร่"; fix #14, the bot made up "ยาว 16 นิ้วทุกไซส์")
  - "…ไหม" right after = a question before buying, so it is skipped.
- A match opens a case (one open case per customer) and the bot posts it at once to Discord "service ลูกค้า":
  - the customer's Facebook name, read live from Meta and never stored, so Fear can search the inbox
  - the time and the redacted text
  - a tag for `DISCORD_SERVICE_IDS` (Fear)
  - a **✅ จัดการจบแล้ว** button (`svcdone`; Fear + approvers), which closes the case and adds who closed it and when.
  - The next complaint from that customer after closing opens a new case.
- Switch: the secret `DISCORD_SERVICE_WEBHOOK_URL` (the channel's webhook). The bot posts in that webhook's channel so the button works. The bot must be able to see and send there; if it can't, the webhook posts without a button.
- Dry run: `GET /api/service/preview?days=7` lists what would have been posted from the stored chats.
