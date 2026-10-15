-- Stock we hold ourselves (Benz 2026-10-15): พี่เปีย's branch at BB ('pia', cut by the order sheets: rows in the
-- "พี่เปีย" group, each order + SKU once) and the GoSell fulfillment warehouse ('gosell', cut by a button after a GoSell
-- file). Balance = Σ stock_moves.qty. The old out-of-stock sheet "พี่เปีย" is renamed "เก็บตกแทน".

-- The products kept in stock: 5 models × sizes 28–36 (our PK SKUs; 38+ come from BB suppliers).
CREATE TABLE IF NOT EXISTS stock_items (
  sku TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  size TEXT NOT NULL,
  sort INTEGER NOT NULL
);
INSERT OR IGNORE INTO stock_items (sku, code, size, sort) VALUES
  ('5011-PK-MD-28', '501/1', '28', 1),
  ('5011-PK-MD-29', '501/1', '29', 2),
  ('5011-PK-MD-30', '501/1', '30', 3),
  ('5011-PK-MD-31', '501/1', '31', 4),
  ('5011-PK-MD-32', '501/1', '32', 5),
  ('5011-PK-MD-34', '501/1', '34', 6),
  ('5011-PK-MD-36', '501/1', '36', 7),
  ('5012-PK-NV-28', '501/2', '28', 8),
  ('5012-PK-NV-29', '501/2', '29', 9),
  ('5012-PK-NV-30', '501/2', '30', 10),
  ('5012-PK-NV-31', '501/2', '31', 11),
  ('5012-PK-NV-32', '501/2', '32', 12),
  ('5012-PK-NV-34', '501/2', '34', 13),
  ('5012-PK-NV-36', '501/2', '36', 14),
  ('5013-PK-BL-28', '501/3', '28', 15),
  ('5013-PK-BL-29', '501/3', '29', 16),
  ('5013-PK-BL-30', '501/3', '30', 17),
  ('5013-PK-BL-31', '501/3', '31', 18),
  ('5013-PK-BL-32', '501/3', '32', 19),
  ('5013-PK-BL-34', '501/3', '34', 20),
  ('5013-PK-BL-36', '501/3', '36', 21),
  ('7011-PK-MD-28', '701/1', '28', 22),
  ('7011-PK-MD-29', '701/1', '29', 23),
  ('7011-PK-MD-30', '701/1', '30', 24),
  ('7011-PK-MD-31', '701/1', '31', 25),
  ('7011-PK-MD-32', '701/1', '32', 26),
  ('7011-PK-MD-34', '701/1', '34', 27),
  ('7011-PK-MD-36', '701/1', '36', 28),
  ('7012-PK-NV-28', '701/2', '28', 29),
  ('7012-PK-NV-29', '701/2', '29', 30),
  ('7012-PK-NV-30', '701/2', '30', 31),
  ('7012-PK-NV-31', '701/2', '31', 32),
  ('7012-PK-NV-32', '701/2', '32', 33),
  ('7012-PK-NV-34', '701/2', '34', 34),
  ('7012-PK-NV-36', '701/2', '36', 35);

-- Every change: open (starting balance), in (received), out (orders), adjust (count correction). qty is signed.
CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loc TEXT NOT NULL,               -- pia | gosell
  sku TEXT NOT NULL,
  qty INTEGER NOT NULL,
  kind TEXT NOT NULL,              -- open | in | out | adjust
  ref TEXT NOT NULL DEFAULT '',    -- order-sheet round id, GoSell file, or a note's source
  date TEXT NOT NULL,              -- Bangkok day it counts for
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stock_moves_loc_date ON stock_moves (loc, date);
CREATE INDEX IF NOT EXISTS stock_moves_ref ON stock_moves (ref);

-- Which order + SKU was already cut, and by which round / file, so an order that comes back in a later round (still
-- in process) or a GoSell file uploaded twice is not cut again.
CREATE TABLE IF NOT EXISTS stock_orders (
  loc TEXT NOT NULL,
  order_no TEXT NOT NULL,
  sku TEXT NOT NULL,
  ref TEXT NOT NULL,
  qty INTEGER NOT NULL,
  PRIMARY KEY (loc, order_no, sku)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS stock_orders_ref ON stock_orders (ref);

-- "พี่เปีย" now means our stock branch: rows the team moved there are our own stock (no supplier to pay).
UPDATE purchase_lines SET kind = 'warehouse' WHERE grp = 'พี่เปีย';
-- The out-of-stock sheet's payments keep their meaning under the new name.
UPDATE purchase_payments SET grp = 'เก็บตกแทน' WHERE grp = 'พี่เปีย';
