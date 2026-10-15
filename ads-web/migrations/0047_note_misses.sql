-- Shop messages that look like an order note (cod/โอน + a total + a code) but the parser can't read (Benz 15 Oct):
-- the problem channel is told at once, the 3-hourly sweep marks them read once the parser learns the format.
CREATE TABLE IF NOT EXISTS note_misses (
  mid TEXT PRIMARY KEY,
  psid TEXT NOT NULL,
  at TEXT NOT NULL,
  text TEXT NOT NULL,
  alerted_at TEXT,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS note_misses_at ON note_misses (at);
