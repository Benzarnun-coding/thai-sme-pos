-- Phase 1: who put a note's items into its Page365 draft, when, and what came of it.
ALTER TABLE order_notes ADD COLUMN filled_at TEXT;
ALTER TABLE order_notes ADD COLUMN filled_by TEXT;
ALTER TABLE order_notes ADD COLUMN fill_order_no INTEGER;
ALTER TABLE order_notes ADD COLUMN fill_error TEXT;
