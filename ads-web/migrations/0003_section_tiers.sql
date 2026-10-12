-- Promo prices per product line, e.g. [{"units":1,"price":189},{"units":3,"price":549}].
-- Profit is counted per piece: pieces ≈ order value ÷ price per piece.
ALTER TABLE sections ADD COLUMN tiers TEXT NOT NULL DEFAULT '[]';
