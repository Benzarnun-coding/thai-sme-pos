-- Dashboard users and their roles (owner / admin / costs / viewer), managed on the ผู้ใช้ page by owners.
-- Logging in is still Cloudflare Access; this decides what a signed-in person may change.
CREATE TABLE users (
  email TEXT PRIMARY KEY,          -- lowercase
  role TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- People who already had rights: the cost editors from settings, and the one account given full rights by hand.
INSERT OR IGNORE INTO users (email, role, note, added_by, added_at, updated_at)
  SELECT lower(value), 'costs', 'ย้ายมาจากรายการแก้ต้นทุน', 'migration', datetime('now'), datetime('now')
  FROM json_each((SELECT value FROM settings WHERE key = 'cost_editors'));
INSERT OR IGNORE INTO users (email, role, note, added_by, added_at, updated_at)
  VALUES ('climaxonline5999@gmail.com', 'admin', '', 'migration', datetime('now'), datetime('now'));
