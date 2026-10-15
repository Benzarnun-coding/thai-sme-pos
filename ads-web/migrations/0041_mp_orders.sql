-- Marketplace money (TikTok / Shopee / Lazada) from the platforms' own exports, read in the browser (web/src/money.ts):
-- Bigseller's in-process file has no prices. One row per order; no customer details. `date` NULL = the day the order
-- first appeared in an order-sheet round. kind 'gross' = what the customer paid (fees separate, NULL = not in the file),
-- 'net' = what the platform pays us (fees already off).
CREATE TABLE IF NOT EXISTS mp_orders (
  order_no TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  date TEXT,
  amount REAL NOT NULL,
  kind TEXT NOT NULL,
  fees REAL,
  status TEXT NOT NULL DEFAULT '',
  items TEXT,                      -- JSON [{sku, qty, amount}] when the file has SKUs
  file TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mp_orders_date ON mp_orders (date);

-- Which columns of an export mean what, per header layout (shared by the team; picked once on the profit page).
CREATE TABLE IF NOT EXISTS mp_import_maps (
  signature TEXT PRIMARY KEY,
  map TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'auto',
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
