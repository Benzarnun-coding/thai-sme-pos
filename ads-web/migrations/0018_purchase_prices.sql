-- What we pay a supplier per piece, typed on the order page for products whose sheet row has no ราคาร้านค้า.
-- Per product (tab|spu, every size), like catalog_suppliers. Wins over the sheet: web price > ราคาร้านค้า (N) > ทุน (H).
CREATE TABLE catalog_prices (
  key TEXT PRIMARY KEY,
  tab TEXT NOT NULL,
  spu TEXT NOT NULL,
  price REAL NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The price each order-sheet line was costed at when the round was last saved (for checking what was paid).
ALTER TABLE purchase_lines ADD COLUMN price REAL;
ALTER TABLE purchase_lines ADD COLUMN price_source TEXT NOT NULL DEFAULT '';

-- Which sales store each order number of a line came from: JSON {orderNo: "TikTok · STM-SHOP"}.
ALTER TABLE purchase_lines ADD COLUMN stores TEXT NOT NULL DEFAULT '{}';
