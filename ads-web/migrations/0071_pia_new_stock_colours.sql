-- Idea #29 round 2 (Moss): the new stock at พี่เปีย is one colour each — 101/1 ดำ and ST-01 ดำ (moved from CM's stock, so the CM
-- SKUs), 200 มิดไนท์ (moved from PK's). Round 1 (0070) registered every colour of the PK tab and missed the CM blacks.
-- 1) drop what 0070 registered that has no stock entries yet; 2) register the right SKUs; 3) 20 pieces each at พี่เปีย,
-- taken out of CM's / PK's stock (PK only once it has a starting balance, as in รับของเข้า). Sizes: 101/1 and 200 28–36
-- (28,29,30,31,32,34,36), ST-01 28,30,32,34,36.
DELETE FROM stock_locs WHERE loc = 'pia' AND sku IN (SELECT sku FROM catalog WHERE tab = 'PK' AND code IN ('101/1', 'ST-01', '200'))
  AND sku NOT IN (SELECT sku FROM stock_moves WHERE loc = 'pia')
  AND sku NOT IN (SELECT sku FROM catalog WHERE tab = 'PK' AND code = '200' AND color = 'MD');
DELETE FROM stock_items WHERE sku NOT IN (SELECT sku FROM stock_locs)
  AND sku IN (SELECT sku FROM catalog WHERE code IN ('101/1', 'ST-01', '200'));

CREATE TEMP TABLE new_pia AS
  SELECT c.tab, c.sku, c.code, c.size FROM catalog c
  WHERE (c.tab = 'CM' AND c.color = 'BL' AND (
          (c.code = '101/1' AND c.size IN ('28', '29', '30', '31', '32', '34', '36'))
          OR (c.code = 'ST-01' AND c.size IN ('28', '30', '32', '34', '36'))))
     OR (c.tab = 'PK' AND c.color = 'MD' AND c.code = '200' AND c.size IN ('28', '29', '30', '31', '32', '34', '36'));

INSERT OR IGNORE INTO stock_items (sku, code, size, sort)
  SELECT sku, code, size, 3000 + CASE code WHEN '101/1' THEN 0 WHEN 'ST-01' THEN 1000 ELSE 2000 END + CAST(size AS INTEGER) FROM new_pia;
INSERT OR IGNORE INTO stock_locs (loc, sku) SELECT 'pia', sku FROM new_pia;

INSERT INTO stock_moves (loc, sku, qty, kind, ref, date, note, created_by, created_at)
  SELECT 'pia', sku, 20, 'in', 'idea-29', date('now', '+7 hours'), 'ไอเดีย #29 สินค้าใหม่ 20 ตัวต่อไซส์', 'idea-29', datetime('now')
  FROM new_pia WHERE NOT EXISTS (SELECT 1 FROM stock_moves o WHERE o.ref = 'idea-29' AND o.loc = 'pia' AND o.sku = new_pia.sku);
INSERT INTO stock_moves (loc, sku, qty, kind, ref, date, note, created_by, created_at)
  SELECT lower(tab), sku, -20, 'out', 'idea-29', date('now', '+7 hours'), 'ย้ายไปพี่เปีย · ไอเดีย #29', 'idea-29', datetime('now')
  FROM new_pia
  WHERE (tab = 'CM' OR EXISTS (SELECT 1 FROM stock_moves o WHERE o.loc = 'pk' AND o.kind = 'open'))
    AND NOT EXISTS (SELECT 1 FROM stock_moves o WHERE o.ref = 'idea-29' AND o.loc = lower(new_pia.tab) AND o.sku = new_pia.sku);
DROP TABLE new_pia;
