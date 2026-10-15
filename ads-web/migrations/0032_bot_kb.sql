-- Answer bank for Meta's Business AI (agreed 2026-10-15): น้องจิบิ proposes fixes from the chats twice a week
-- (Mon/Thu), Benz/Max approve in Discord or on /botkb, Max pastes the approved ones into Business Suite once a
-- week and presses "ใส่บอทแล้ว" (Meta offers no API to change the bot).
CREATE TABLE bot_kb (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,            -- fix (the bot got something wrong) | faq (a common question + the admins' answer)
  question TEXT NOT NULL,
  answer TEXT NOT NULL,          -- what the bot should say, from the admins' real replies
  rule TEXT,                     -- an instruction for the bot ("never discount COD"), optional
  why TEXT,                      -- what went wrong / why it matters
  evidence TEXT,                 -- "ลูกค้า 3 (13:47 น.)"
  status TEXT NOT NULL,          -- proposed | approved | rejected | applied
  decided_by TEXT,
  decided_at TEXT,
  applied_at TEXT,
  message_id TEXT
);
CREATE INDEX bot_kb_status ON bot_kb (status, created_at);
