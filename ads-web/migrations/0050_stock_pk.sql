-- 2026-10-19 (Benz): a third stock place, our PK warehouse ('pk', cut by the order sheets' "PK" sheet), holding all our
-- own codes; stock items now say which place keeps them (stock_locs); 601/1–3 sold at พี่เปีย are cut from 501/1–3 of the
-- same size (stock_links); and a SKU can be replaced by one of ours even when it is in the catalog (catalog_aliases.force,
-- picked with "แก้" on the order page, e.g. 39-BB-MD-34 → 5011-PK-MD-34, so the two lines add up).

ALTER TABLE catalog_aliases ADD COLUMN force INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS stock_locs (
  loc TEXT NOT NULL,
  sku TEXT NOT NULL,
  PRIMARY KEY (loc, sku)
) WITHOUT ROWID;
INSERT OR IGNORE INTO stock_locs (loc, sku) SELECT 'pia', sku FROM stock_items;
INSERT OR IGNORE INTO stock_locs (loc, sku) SELECT 'gosell', sku FROM stock_items;

-- PK: every size of our codes in the PK tab of the catalog.
CREATE TABLE IF NOT EXISTS stock_pk_codes (code TEXT PRIMARY KEY, ord INTEGER NOT NULL);
INSERT OR IGNORE INTO stock_pk_codes (code, ord) VALUES
  ('200', 1),
  ('200/2', 2),
  ('200/3', 3),
  ('200/4', 4),
  ('200/5', 5),
  ('301/1', 6),
  ('301/2', 7),
  ('301/3', 8),
  ('301/4', 9),
  ('401/1', 10),
  ('401/2', 11),
  ('401/3', 12),
  ('501/1', 13),
  ('501/2', 14),
  ('501/3', 15),
  ('601/1', 16),
  ('601/2', 17),
  ('601/3', 18),
  ('601/4', 19),
  ('701/1', 20),
  ('701/2', 21),
  ('701/3', 22),
  ('801/1', 23),
  ('801/2', 24),
  ('801/3', 25),
  ('Ni8-1', 26),
  ('Ni8-2', 27),
  ('Ni8-3', 28),
  ('Ni8-4', 29),
  ('Ni8-5', 30),
  ('Ni9-1', 31),
  ('Ni9-2', 32),
  ('Ni9-3', 33),
  ('Ni9-4', 34),
  ('Ni9-5', 35),
  ('D01', 36),
  ('D02', 37),
  ('009/1', 38),
  ('009/2', 39);
INSERT OR IGNORE INTO stock_items (sku, code, size, sort)
  SELECT c.sku, c.code, c.size, 1000 + p.ord * 100 + CAST(c.size AS INTEGER) FROM catalog c JOIN stock_pk_codes p ON p.code = c.code WHERE c.tab = 'PK';
INSERT OR IGNORE INTO stock_locs (loc, sku)
  SELECT 'pk', c.sku FROM catalog c JOIN stock_pk_codes p ON p.code = c.code WHERE c.tab = 'PK';
DROP TABLE stock_pk_codes;

-- A sold SKU cut from another SKU's stock at one place.
CREATE TABLE IF NOT EXISTS stock_links (
  loc TEXT NOT NULL,
  sku TEXT NOT NULL,
  stock_sku TEXT NOT NULL,
  PRIMARY KEY (loc, sku)
) WITHOUT ROWID;
INSERT OR IGNORE INTO stock_links (loc, sku, stock_sku)
  SELECT 'pia', c.sku, s.sku FROM catalog c
  JOIN stock_items s ON s.code = replace(c.code, '601/', '501/') AND s.size = c.size
  JOIN stock_locs m ON m.loc = 'pia' AND m.sku = s.sku
  WHERE c.tab = 'PK' AND c.code IN ('601/1', '601/2', '601/3');
