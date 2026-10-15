-- Purchases sent to Meta at the moment an admin types the order note in the chat (Benz 2026-10-15: the sale
-- belongs to the day the customer agreed, not the day the bill was sent). One row per note; event_id note-<mid>.
CREATE TABLE note_purchases (
  mid TEXT PRIMARY KEY,
  psid TEXT NOT NULL,
  at TEXT NOT NULL,            -- the note's time = the event time sent to Meta
  value REAL NOT NULL,
  status TEXT NOT NULL,        -- sent | skipped | error
  detail TEXT,
  sent_at TEXT NOT NULL
);
CREATE INDEX note_purchases_psid ON note_purchases (psid, at);
