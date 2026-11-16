-- Website feature requests from Discord (Benz 2026-10-20): anyone types /ไอเดีย → the bot opens a post in the forum
-- DISCORD_REQUEST_CHANNEL_ID; Benz presses ให้ทำ / ไม่ทำ, whoever builds it presses ทำเสร็จแล้ว, Benz presses
-- ผ่าน / ไม่ผ่าน. Every press is a row in feature_request_log. Page: /requests.
CREATE TABLE feature_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  author TEXT NOT NULL,          -- Discord display name
  author_id TEXT,
  area TEXT NOT NULL,            -- ads | backoffice | gosell | orders | bug | other
  title TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL,          -- new | doing | review | passed | dropped
  thread_id TEXT,                -- the forum post (its starter message has the same id)
  updated_at TEXT NOT NULL
);
CREATE INDEX feature_requests_status ON feature_requests (status);

CREATE TABLE feature_request_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  at TEXT NOT NULL,
  by TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT
);
CREATE INDEX feature_request_log_req ON feature_request_log (request_id);
