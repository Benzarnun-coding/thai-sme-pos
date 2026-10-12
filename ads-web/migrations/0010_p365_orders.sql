-- Real orders from Page365's daily export, uploaded from the dashboard. Only what the numbers need: no customer
-- name, phone or address. The profile name is hashed on the way in (same salted hash as ad_referrals.name_hash)
-- so an order can be linked to the ad its customer came from without keeping who they are.
CREATE TABLE p365_orders (
  order_no TEXT PRIMARY KEY,
  date TEXT NOT NULL,            -- Bangkok day of created_at
  created_at TEXT NOT NULL,      -- ISO
  total REAL NOT NULL,           -- what the customer pays (goods − discount + shipping)
  subtotal REAL,
  discount REAL,
  shipping REAL,
  cost REAL,                     -- product cost as Page365 has it
  payment TEXT,                  -- cod | kbank | ...
  paid_at TEXT,
  units INTEGER NOT NULL,
  items TEXT NOT NULL,           -- JSON [{code, sku, name, qty, price}]
  name_hash TEXT,
  campaign_id TEXT,              -- the ad campaign this order is credited to, when one could be found
  match TEXT NOT NULL DEFAULT 'none',  -- customer | exact | approx | none
  uploaded_at TEXT NOT NULL
);
CREATE INDEX p365_orders_date ON p365_orders (date, campaign_id);

CREATE TABLE p365_uploads (
  date TEXT PRIMARY KEY,
  orders INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);

ALTER TABLE ad_referrals ADD COLUMN name_hash TEXT;
