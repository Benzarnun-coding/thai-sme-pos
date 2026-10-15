-- Selling price typed in the catalog's product view (fills or corrects ราคาขาย, sheet column I). Shown in the catalog
-- only; the ads system keeps reading its own cost sheet. Key tab|SPU (every size) or tab|SKU (one size), like catalog_prices,
-- which can now also hold one size (tab|SKU wins over tab|SPU).
CREATE TABLE IF NOT EXISTS catalog_sell_prices (
  key TEXT PRIMARY KEY,
  tab TEXT NOT NULL,
  spu TEXT NOT NULL,
  price REAL NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
