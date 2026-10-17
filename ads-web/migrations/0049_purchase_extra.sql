-- Items of an order-sheet round that are not from the Bigseller file (2026-10-16): Facebook orders from Page365's
-- per-item export, and lines typed by hand. JSON [{source: 'facebook'|'manual', order, sku, name, option, qty}], kept
-- so a round reopened from its file gets them back. Not in purchase_items: Facebook units are counted from the
-- Page365 upload, and typed lines are not sales.
ALTER TABLE purchase_uploads ADD COLUMN extra TEXT NOT NULL DEFAULT '[]';
