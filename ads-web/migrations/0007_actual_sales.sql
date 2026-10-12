-- Real daily totals from the order system (Page365 shipping labels), typed in once a day. Compared with
-- what Meta attributes to ads to see sales that came without an ad click (organic, came back later, untagged).
CREATE TABLE actual_sales (
  date TEXT PRIMARY KEY,      -- YYYY-MM-DD, Bangkok
  orders INTEGER,
  pieces INTEGER,
  revenue REAL,
  note TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
