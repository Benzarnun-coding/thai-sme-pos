-- Another system's SKU for one of ours: Lazada sends its own id ("5409161349-1729665190325-32"), and some listings
-- carry typos or old codes. Matched once on the page (ตรวจสอบ rows, งานค้าง), then every order with that SKU is read
-- as our SKU — right sheet, cost and sales. Keys are the cleaned, upper-case SKU.
CREATE TABLE IF NOT EXISTS catalog_aliases (
  alias TEXT PRIMARY KEY,      -- skuKey of the other SKU
  sku TEXT NOT NULL,           -- our catalog SKU (sheet or added on the page)
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
