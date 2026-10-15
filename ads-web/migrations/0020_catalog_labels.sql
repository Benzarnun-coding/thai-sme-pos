-- What a product is called on the order sheets, typed on the order page (e.g. the name a supplier knows it by).
-- Per product (tab|spu, every size), like catalog_prices; replaces our code + colour on screen, Excel and print.
CREATE TABLE catalog_labels (
  key TEXT PRIMARY KEY,
  tab TEXT NOT NULL,
  spu TEXT NOT NULL,
  label TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
