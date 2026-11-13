-- Idea #28 (Moss, round 2): scan a returned parcel on the stock page and the SKUs come from the saved order rounds
-- (no file upload). Only the hash of the parcel number and its last 4 characters are kept, never the number itself.
ALTER TABLE purchase_items ADD COLUMN track_hash TEXT;
ALTER TABLE purchase_items ADD COLUMN track_tail TEXT;
CREATE INDEX IF NOT EXISTS purchase_items_track ON purchase_items (track_hash);
