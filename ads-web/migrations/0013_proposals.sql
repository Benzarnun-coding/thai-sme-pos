-- Heavy decisions (pause a campaign, move it down to retest) wait for a person to press a button in Discord.
CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,            -- pause | move
  entity_id TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  plan TEXT NOT NULL,            -- what the rule saw, in words
  detail TEXT NOT NULL,          -- JSON: { level, move_from, move_to }
  status TEXT NOT NULL,          -- pending | approved | rejected | expired | failed
  decided_by TEXT,
  decided_at TEXT,
  message_id TEXT
);
CREATE INDEX proposals_status ON proposals (status, created_at);
CREATE INDEX proposals_entity ON proposals (entity_id, rule_id, created_at);
