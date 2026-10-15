-- What was actually paid to each supplier for a round of order sheets (our side; checked against what the round
-- says is owed: Σ (qty − out of stock) × cost of that supplier's lines, plus พี่เปีย for the out-of-stock pieces).
CREATE TABLE purchase_payments (
  upload_id TEXT NOT NULL,        -- purchase_uploads.id (`${date}#${round}`)
  grp TEXT NOT NULL,              -- supplier / warehouse / "พี่เปีย"
  paid REAL,                      -- amount paid (null = not entered)
  done INTEGER NOT NULL DEFAULT 0,-- 1 = settled
  note TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (upload_id, grp)
) WITHOUT ROWID;
