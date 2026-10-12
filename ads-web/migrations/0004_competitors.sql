-- Competitor watch (typed in by the team, no scraping): pages to watch, their ads worth studying, and
-- periodic checks of how many ads each page is running.
CREATE TABLE competitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  page_url TEXT NOT NULL DEFAULT '',
  page_id TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE competitor_ads (
  id TEXT PRIMARY KEY,
  competitor_id TEXT NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  library_url TEXT NOT NULL DEFAULT '',
  started_at TEXT,                       -- YYYY-MM-DD, "เริ่มแสดงเมื่อ" in the Ad Library
  last_seen TEXT,                        -- YYYY-MM-DD, last time someone saw it still running
  status TEXT NOT NULL DEFAULT 'active', -- active | stopped
  format TEXT NOT NULL DEFAULT '',       -- video | image | carousel | ''
  promo TEXT NOT NULL DEFAULT '',
  hook TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  section_id TEXT,                       -- our product line it competes with
  created_at TEXT NOT NULL
);

CREATE TABLE competitor_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competitor_id TEXT NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL,
  active_ads INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX competitor_ads_by_competitor ON competitor_ads(competitor_id);
CREATE INDEX competitor_checks_by_competitor ON competitor_checks(competitor_id, checked_at);
