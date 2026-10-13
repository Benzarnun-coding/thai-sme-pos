-- Order sheets keep the marketplace order numbers of each line (shown on the sheets; needed when a supplier later
-- reports something out of stock) and how many pieces the supplier did not have. Tracking numbers are still not kept.
ALTER TABLE purchase_lines ADD COLUMN orders TEXT NOT NULL DEFAULT '[]';   -- JSON string[] of order numbers
ALTER TABLE purchase_lines ADD COLUMN missing INTEGER NOT NULL DEFAULT 0;  -- pieces the supplier did not have
ALTER TABLE purchase_uploads ADD COLUMN missing INTEGER NOT NULL DEFAULT 0;
