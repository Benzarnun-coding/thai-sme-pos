# ไอเดียเว็บ (feature requests from Discord)

Benz 2026-10-20: the team asks for website changes in Discord, and each request keeps a status Benz controls.

- `/ไอเดีย` (slash command, option หมวด) → a form (ชื่อเรื่อง, อยากได้อะไร) → row in `feature_requests` + a post in the
  forum channel `DISCORD_REQUEST_CHANNEL_ID` (title `💡 #id ชื่อ`, the forum tag whose name matches the หมวด if one exists).
- Status path, one button set per status on the post's first message:
  `💡 ไอเดียใหม่` →(ให้ทำ)→ `🔨 กำลังทำ` →(ทำเสร็จแล้ว)→ `🧪 รอตรวจ` →(ผ่าน)→ `✅ ผ่านแล้ว`;
  ไม่ทำ → `❌ ไม่ทำ`; ไม่ผ่าน asks for a reason and goes back to กำลังทำ.
- Who presses: ให้ทำ / ไม่ทำ / ผ่าน / ไม่ผ่าน = `DISCORD_REQUEST_DECIDER_IDS` (Benz; empty = `DISCORD_APPROVER_IDS`);
  ทำเสร็จแล้ว = those plus `DISCORD_APPROVER_IDS`. Benz is pinged at รอตรวจ, the
  person who asked is pinged at ผ่านแล้ว; then the post's title follows the status. Discord allows 2 renames per post per
  10 minutes, so after quick presses the title lags; the 3-hourly sweep (`syncTitles`) sets it again.
- Every press is a row in `feature_request_log` (who, from → to, reason). Page `/requests` (ไอเดียเว็บ) shows both.
- Off until `DISCORD_REQUEST_CHANNEL_ID` is set. Switching on: create a Forum channel, give the bot View Channel,
  Send Messages, Create Posts, Send Messages in Threads and Manage Threads there, put its id in `wrangler.jsonc`,
  deploy, then press "ลงทะเบียนคำสั่ง /ไอเดีย" on `/requests` (owner only; registers the global command once).
- Code: `worker/featureRequests.ts` (+ test), hooked first in `discordInteraction` in `worker/index.ts`; buttons are
  checked against the post they belong to, so they work outside the ads channel.
