-- Idea #29 (Moss): new products kept at พี่เปีย (BB): 101/1 (28,29,30,31,32,34,36), ST-01 (28,30,32,34,36), 200 (28–36 as 101/1).
-- Takes every colour of those codes in the PK tab of the catalog; only registers where the stock is kept (no pieces
-- are added: the counts are typed on /catalog/stock "รับของเข้า" / "ปรับยอด").
INSERT OR IGNORE INTO stock_items (sku, code, size, sort)
  SELECT c.sku, c.code, c.size, 3000 + CASE c.code WHEN '101/1' THEN 0 WHEN 'ST-01' THEN 1000 ELSE 2000 END + CAST(c.size AS INTEGER)
  FROM catalog c
  WHERE c.tab = 'PK' AND (
    (c.code IN ('101/1', '200') AND c.size IN ('28', '29', '30', '31', '32', '34', '36'))
    OR (c.code = 'ST-01' AND c.size IN ('28', '30', '32', '34', '36')));
INSERT OR IGNORE INTO stock_locs (loc, sku)
  SELECT 'pia', i.sku FROM stock_items i JOIN catalog c ON c.tab = 'PK' AND c.sku = i.sku
  WHERE (c.code IN ('101/1', '200') AND c.size IN ('28', '29', '30', '31', '32', '34', '36'))
    OR (c.code = 'ST-01' AND c.size IN ('28', '30', '32', '34', '36'));
