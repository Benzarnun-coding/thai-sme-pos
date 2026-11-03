-- Returned parcels (idea #20): scanned by the parcel number, matched to SKUs in the browser from the Bigseller file,
-- held here until an owner/admin approves; approval adds the pieces to the place's stock as an 'in' move.
-- The parcel number itself is not kept: only its hash (to refuse the same parcel twice) and the last 4 characters.
CREATE TABLE IF NOT EXISTS stock_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loc TEXT NOT NULL,
  sku TEXT NOT NULL,
  qty INTEGER NOT NULL,
  track_hash TEXT NOT NULL,
  track_tail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS stock_returns_hash ON stock_returns (track_hash);
CREATE INDEX IF NOT EXISTS stock_returns_status ON stock_returns (status);
