-- "(Grok)" test ads (Benz 2026-11-09): an approved post set from the training room becomes its own campaign, a copy
-- of the product's best running campaign with one ad set and one new ad, 100/day for 14 days, then paused and
-- reported. Nothing is created until Max (or Benz) presses ✅ on the proposal in #studio-training (worker/grokAds.ts).
CREATE TABLE grok_ads (
  set_id INTEGER PRIMARY KEY,          -- creative_sets.id
  code TEXT NOT NULL,
  status TEXT NOT NULL,                -- proposed | working | running | done | failed | declined
  message_id TEXT,                     -- the proposal in #studio-training
  decided_by TEXT,
  template_ad_id TEXT,
  campaign_id TEXT,
  adset_id TEXT,
  ad_id TEXT,
  budget REAL,
  error TEXT,
  announced_at TEXT,
  launched_at TEXT,
  ends_at TEXT,
  result TEXT                          -- JSON {spend, purchases, value, roas} at the end
);
CREATE INDEX grok_ads_status ON grok_ads (status, ends_at);
