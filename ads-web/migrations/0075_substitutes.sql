-- ตัวแทน (Benz 2026-11-19): a model that's sold out is filled into Page365 bills as another model.
-- code = what the admin writes in the order note ("801/1"), sub = what goes on the bill ("501/5").
-- Key is upper case with "-" written as "/" (subKey in worker/substitutes.ts).
CREATE TABLE IF NOT EXISTS substitutes (
  code TEXT PRIMARY KEY,
  sub TEXT NOT NULL,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
