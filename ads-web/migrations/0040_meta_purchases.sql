-- Purchases sent to Meta (Conversions API for Business Messaging) for Page365 orders from Messenger chats, so ads
-- get their conversions without admins tagging the sale in Meta's inbox. One row per Page365 order; the order
-- number is also the event_id, so Meta never counts one twice. No names, phones or addresses — only the PSID.
CREATE TABLE meta_purchases (
  order_id INTEGER PRIMARY KEY,   -- Page365 order id
  order_no INTEGER NOT NULL,
  psid TEXT,
  value REAL NOT NULL,
  cod INTEGER NOT NULL,
  stage TEXT NOT NULL,            -- Page365 stage when it was sent
  event_time TEXT NOT NULL,       -- ISO, the order's creation time
  status TEXT NOT NULL,           -- sent | test | error | skipped
  detail TEXT,                    -- error message / why skipped
  sent_at TEXT NOT NULL
);
CREATE INDEX meta_purchases_sent ON meta_purchases (sent_at);

-- Settings for the sender, edited on the settings page: mode (off | test | live), dataset id, test event code,
-- live_from (only orders created after this are sent for real), last_sync.
CREATE TABLE meta_capi (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
