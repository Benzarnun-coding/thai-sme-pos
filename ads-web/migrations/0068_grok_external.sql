-- "Grok …" campaigns made by hand in Ads Manager (Benz 2026-11-12: "ดูแลด้วย"): the room adopts them like its own
-- test ads — 14 days from Meta's created_time, then paused and reported. Budget and ads are never touched.
-- worker/grokAds.ts adoptExternal / stopExternal.
CREATE TABLE grok_external (
  campaign_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,          -- running | done
  created_at TEXT NOT NULL,      -- Meta created_time
  adopted_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  result TEXT                    -- JSON {spend, purchases, value, roas} at the end (Meta-tagged)
);
CREATE INDEX grok_external_status ON grok_external (status, ends_at);
