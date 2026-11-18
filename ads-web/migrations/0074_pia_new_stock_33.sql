-- Idea #33 (Moss): 4 new models kept at พี่เปีย (BB), 20 pieces per size: D01 navy, D02 midnight (28,29,30,31,32,34,36),
-- 009/1 navy, 009/2 midnight (28,30,32,34,36). SKUs as Moss gave them. Safe to run twice (ref 'idea-33').
INSERT OR IGNORE INTO stock_items (sku, code, size, sort) VALUES
  ('D01-PK-NV-28', 'D01', '28', 7028),
  ('D01-PK-NV-29', 'D01', '29', 7029),
  ('D01-PK-NV-30', 'D01', '30', 7030),
  ('D01-PK-NV-31', 'D01', '31', 7031),
  ('D01-PK-NV-32', 'D01', '32', 7032),
  ('D01-PK-NV-34', 'D01', '34', 7034),
  ('D01-PK-NV-36', 'D01', '36', 7036),
  ('D02-PK-MD-28', 'D02', '28', 7128),
  ('D02-PK-MD-29', 'D02', '29', 7129),
  ('D02-PK-MD-30', 'D02', '30', 7130),
  ('D02-PK-MD-31', 'D02', '31', 7131),
  ('D02-PK-MD-32', 'D02', '32', 7132),
  ('D02-PK-MD-34', 'D02', '34', 7134),
  ('D02-PK-MD-36', 'D02', '36', 7136),
  ('0091-PK-NV-28', '009/1', '28', 7228),
  ('0091-PK-NV-30', '009/1', '30', 7230),
  ('0091-PK-NV-32', '009/1', '32', 7232),
  ('0091-PK-NV-34', '009/1', '34', 7234),
  ('0091-PK-NV-36', '009/1', '36', 7236),
  ('0092-PK-MD-28', '009/2', '28', 7328),
  ('0092-PK-MD-30', '009/2', '30', 7330),
  ('0092-PK-MD-32', '009/2', '32', 7332),
  ('0092-PK-MD-34', '009/2', '34', 7334),
  ('0092-PK-MD-36', '009/2', '36', 7336);
INSERT OR IGNORE INTO stock_locs (loc, sku) SELECT 'pia', sku FROM stock_items WHERE sku IN ('D01-PK-NV-28','D01-PK-NV-29','D01-PK-NV-30','D01-PK-NV-31','D01-PK-NV-32','D01-PK-NV-34','D01-PK-NV-36','D02-PK-MD-28','D02-PK-MD-29','D02-PK-MD-30','D02-PK-MD-31','D02-PK-MD-32','D02-PK-MD-34','D02-PK-MD-36','0091-PK-NV-28','0091-PK-NV-30','0091-PK-NV-32','0091-PK-NV-34','0091-PK-NV-36','0092-PK-MD-28','0092-PK-MD-30','0092-PK-MD-32','0092-PK-MD-34','0092-PK-MD-36');
INSERT INTO stock_moves (loc, sku, qty, kind, ref, date, note, created_by, created_at)
  SELECT 'pia', i.sku, 20, 'in', 'idea-33', date('now', '+7 hours'), 'ไอเดีย #33 สินค้าใหม่ 20 ตัวต่อไซส์', 'idea-33', datetime('now')
  FROM stock_items i WHERE i.sku IN ('D01-PK-NV-28','D01-PK-NV-29','D01-PK-NV-30','D01-PK-NV-31','D01-PK-NV-32','D01-PK-NV-34','D01-PK-NV-36','D02-PK-MD-28','D02-PK-MD-29','D02-PK-MD-30','D02-PK-MD-31','D02-PK-MD-32','D02-PK-MD-34','D02-PK-MD-36','0091-PK-NV-28','0091-PK-NV-30','0091-PK-NV-32','0091-PK-NV-34','0091-PK-NV-36','0092-PK-MD-28','0092-PK-MD-30','0092-PK-MD-32','0092-PK-MD-34','0092-PK-MD-36')
    AND NOT EXISTS (SELECT 1 FROM stock_moves o WHERE o.ref = 'idea-33' AND o.loc = 'pia' AND o.sku = i.sku);
