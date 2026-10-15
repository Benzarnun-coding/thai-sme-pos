-- Which supplier a product is ordered from, set on the page. Wins over the sheet's ร้านค้า column; lets PK models be
-- ordered from a โบ๊เบ๊ supplier (J.BIG …). key = `${tab}|${spu}` like catalog_images.
CREATE TABLE catalog_suppliers (
  key TEXT PRIMARY KEY,
  tab TEXT NOT NULL,
  spu TEXT NOT NULL,
  shop TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Order sheets made from Bigseller's daily "Order-SKU-inprocess" export: one upload per day + round. Only what the
-- sheets need is kept (SKU, quantity, supplier) — no order or tracking numbers. Lines per SKU and supplier group.
CREATE TABLE purchase_uploads (
  id TEXT PRIMARY KEY,           -- `${date}#${round}`
  date TEXT NOT NULL,
  round INTEGER NOT NULL,
  file TEXT NOT NULL,
  pieces INTEGER NOT NULL,
  review INTEGER NOT NULL,       -- pieces that matched no supplier/warehouse ("ตรวจสอบ")
  groups TEXT NOT NULL,          -- JSON [{name, kind, pieces}]
  saved_by TEXT NOT NULL,
  saved_at TEXT NOT NULL
);

CREATE TABLE purchase_lines (
  upload_id TEXT NOT NULL,
  grp TEXT NOT NULL,             -- supplier / warehouse / "ตรวจสอบ"
  kind TEXT NOT NULL,            -- supplier | warehouse | unassigned | review
  sku TEXT NOT NULL,
  tab TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL,           -- what the sheet calls it (supplier code or code + colour)
  size TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (upload_id, grp, sku)
) WITHOUT ROWID;
