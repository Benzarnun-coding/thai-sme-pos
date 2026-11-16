-- How the bills behind order notes ended up (Benz 20 Oct: measure accuracy every day): once a bill has moved on
-- (or is a week old, or gone), its final items/total in Page365 are compared with the admin's note.
CREATE TABLE IF NOT EXISTS fill_audit (
  no INTEGER PRIMARY KEY,         -- Page365 bill number
  mid TEXT NOT NULL,              -- the order note it came from
  note_at TEXT NOT NULL,
  filled_by TEXT,                 -- 'auto' when the system filled it, else null (a person did)
  outcome TEXT NOT NULL,          -- ok | edited | stopped_kept | stopped_changed | deleted | open
  reason TEXT,                    -- why the system stopped (category), when it did
  edits TEXT,                     -- JSON: what differs from the note (items / size / qty / total / payment)
  address TEXT,                   -- JSON flags: phone_in_street, name_in_street, no_phone, no_zip
  final_stage TEXT,
  checked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fill_audit_note_at ON fill_audit (note_at);
