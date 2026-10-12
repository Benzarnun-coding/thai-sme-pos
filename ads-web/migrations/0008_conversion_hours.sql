-- Purchases per campaign per hour per day (Meta's finest breakdown), kept so every page can cost revenue order
-- by order without asking Meta for 30 days of hourly data on each view. Refreshed for recent days each morning.
CREATE TABLE conversion_hours (
  date TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  hour TEXT NOT NULL,
  purchases REAL NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (date, campaign_id, hour)
);
CREATE TABLE conversion_days (
  date TEXT PRIMARY KEY,       -- a day whose hours have been fetched (even if it had no purchases)
  fetched_at TEXT NOT NULL
);
