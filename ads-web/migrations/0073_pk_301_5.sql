-- Idea #31 (Moss): new model 301/5 black (SKU 3015-PK-BL, sizes 28,30,32,34,36) in the PK warehouse stock page.
-- Listed directly like 0072. No pieces are added (0 for now): Moss types the counts on /catalog/stock.
INSERT OR IGNORE INTO stock_items (sku, code, size, sort) VALUES
  ('3015-PK-BL-28', '301/5', '28', 6528),
  ('3015-PK-BL-30', '301/5', '30', 6530),
  ('3015-PK-BL-32', '301/5', '32', 6532),
  ('3015-PK-BL-34', '301/5', '34', 6534),
  ('3015-PK-BL-36', '301/5', '36', 6536);
INSERT OR IGNORE INTO stock_locs (loc, sku) SELECT 'pk', sku FROM stock_items WHERE code = '301/5';
