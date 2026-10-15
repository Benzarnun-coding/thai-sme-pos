-- Bigseller rows of a saved round, one per order + SKU (quantity and sales store), for the units-sold page: an order
-- can come back in a later round or day (still "in process"), so each order + SKU is counted once, where it first
-- appeared. Written when a round is saved from a file; a round reopened from history keeps its rows.
CREATE TABLE purchase_items (
  upload_id TEXT NOT NULL,
  order_no TEXT NOT NULL,         -- marketplace order number ("?upload#n" when the file had none)
  sku TEXT NOT NULL,              -- catalog SKU, or what Bigseller had
  qty INTEGER NOT NULL,
  store TEXT NOT NULL DEFAULT '', -- "TikTok · STM-SHOP"
  PRIMARY KEY (upload_id, order_no, sku)
) WITHOUT ROWID;
