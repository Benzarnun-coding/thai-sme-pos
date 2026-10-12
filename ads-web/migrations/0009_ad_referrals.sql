-- Who came from which ad: Meta's Messenger webhook tells us, at the moment a customer opens a chat from an
-- ad, the customer's page-scoped id and the ad id. Meta won't give this history through the API, so we keep
-- it ourselves from the day the webhook is switched on. Minimal personal data: no names, no message text.
CREATE TABLE ad_referrals (
  psid TEXT NOT NULL,          -- page-scoped customer id (only meaningful for this page)
  at TEXT NOT NULL,            -- ISO time of the event
  ad_id TEXT,
  campaign_id TEXT,            -- resolved from ad_id through the Marketing API (null until resolved)
  source TEXT,                 -- ADS, SHORTLINK, ...
  ref TEXT,                    -- the ad's ref parameter, if any
  kind TEXT NOT NULL,          -- referral | postback | message
  PRIMARY KEY (psid, at)
);
CREATE INDEX ad_referrals_at ON ad_referrals (at);
CREATE INDEX ad_referrals_campaign ON ad_referrals (campaign_id, at);

-- ad_id → campaign, looked up once per ad
CREATE TABLE ad_map (
  ad_id TEXT PRIMARY KEY,
  campaign_id TEXT,
  adset_id TEXT,
  name TEXT,
  fetched_at TEXT NOT NULL
);

-- Is the webhook alive? Counters the settings page shows.
CREATE TABLE webhook_status (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
