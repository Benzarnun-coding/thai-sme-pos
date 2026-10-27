# Meta App Review: pages_messaging (app "Stat")

Why: the ตำบล question (`worker/tambonAsk.ts`) was refused on its first real send (27 Oct 2026, bill #30847):
"Cannot message users who are not admins, developers or testers of the app until pages_messaging permission is
reviewed and the app is live." Until the review passes, a refused question goes to #ออเดอร์มีปัญหา for a person.

## Benz does in Meta (developers.facebook.com → app 1410718820800711)

1. Business Verification of the Business Manager that owns the app (company papers, phone/domain in the company's name). Skip if done.
2. App Settings → Basic: icon 1024×1024, category Business, contact e-mail, Privacy Policy URL and User Data Deletion URL = `https://pkjeans-ads.ads-web.workers.dev/webhook/privacy`.
3. App Review → Permissions and Features: request Advanced Access for `pages_messaging` (plus `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement` if it asks).
4. Data Handling Questions: processors = Cloudflare (hosting); chat text kept 30 days, addresses not stored; no data sold or shared.
5. Before submitting, switch the reviewer's test on (below); after the result, switch it off. Approved → switch the app to Live.

Testing before approval: add a person as a Tester (App Roles); questions to them are sent even in development mode.

## Reviewer test (ships off)

```bash
cd ads-web && npx wrangler d1 execute DB --remote --command "INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('tambon_test', 'on')"
```

Off again: same with `'off'`. While on, "test tambon <postcode>" in the page's chat sends the question for that
postcode and confirms the answer; no bill is touched. Audit action `tambon.test`.

## Text to paste

**How will this app use pages_messaging?**

> PkJeans sells jeans through its Facebook Page; customers order in Messenger and our staff write the order into
> our order system. When the shipping address the customer gave is missing its subdistrict (ตำบล/แขวง), the
> parcel cannot be delivered. The app then sends the customer one message in the same conversation, within 24
> hours of their last message (messaging_type RESPONSE), listing the subdistricts their district and postcode can
> be. When the customer replies with a number or a name, the app writes that subdistrict into the shipping bill.
> No promotional or unsolicited messages are sent; each order gets at most one question.

**Step-by-step instructions for the reviewer**

> 1. Open Messenger and send a message to the Page "กางเกงยีนส์ไทย แด่คนล่าฝัน" (https://www.facebook.com/115748303500549).
> 2. Because placing a real order needs our staff, a test phrase starts the same flow: send `test tambon 81120`.
> 3. The Page replies (in Thai) asking for the subdistrict of Khlong Thom district, Krabi 81120, with a numbered list.
> 4. Reply with a number, e.g. `3`.
> 5. The Page confirms the chosen subdistrict (ต.พรุดินนา). In a real order this is written into the shipping bill.
> The test messages end with "(Test mode — no real order is changed.)".

## Screencast script (1–2 min, English captions)

1. The Page's Messenger: a customer chat with an order and an address with no subdistrict.
2. The staff's order note in the chat → the bill in Page365 opens with the subdistrict empty (caption: "Address is missing its subdistrict").
3. The Page's question arrives in the customer's chat (caption: "The app asks once, within 24 hours").
4. The customer replies with a number.
5. Page365 bill refreshed: subdistrict filled (caption: "The answer is written into the shipping bill").
6. Optional: the `test tambon 81120` flow, as the reviewer will see it.

Record steps 1–5 with a Tester account as the customer (the question only reaches app roles until approval).
