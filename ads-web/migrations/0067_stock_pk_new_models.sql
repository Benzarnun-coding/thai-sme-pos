-- ไอเดีย #26 (Moss): 5 new models in the PK warehouse stock page. Sizes come from the PK tab of the catalog (all sizes
-- the catalog has for the code / SKU); balance starts at 0 (no stock_moves rows) — Moss adds the counts on the page.
CREATE TEMP TABLE new_pk_models (code TEXT, sku_prefix TEXT, ord INTEGER);
INSERT INTO new_pk_models (code, sku_prefix, ord) VALUES
  ('2003', '2003-BB-MD', 40),
  ('2003/1', '20031-BB-NV', 41),
  ('2003/2', '20032-PK-BL', 42),
  ('L68-1', 'L681-PK-MD', 43),
  ('L68-2', 'L682-PK-NV', 44);
INSERT OR IGNORE INTO stock_items (sku, code, size, sort)
  SELECT c.sku, c.code, c.size, 1000 + n.ord * 100 + CAST(c.size AS INTEGER)
  FROM catalog c JOIN new_pk_models n ON c.code = n.code OR c.sku LIKE n.sku_prefix || '-%'
  WHERE c.tab = 'PK';
INSERT OR IGNORE INTO stock_locs (loc, sku)
  SELECT 'pk', c.sku FROM catalog c JOIN new_pk_models n ON c.code = n.code OR c.sku LIKE n.sku_prefix || '-%'
  WHERE c.tab = 'PK';
DROP TABLE new_pk_models;
