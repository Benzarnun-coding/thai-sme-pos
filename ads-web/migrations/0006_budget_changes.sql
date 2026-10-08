-- Daily budget changes, wherever they were made: this dashboard, or Meta directly (seen when the entity list
-- refreshes). Ideas use it so they don't keep suggesting a budget change that was just made.
CREATE TABLE budget_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT NOT NULL,
  name TEXT NOT NULL,
  at TEXT NOT NULL,
  from_budget REAL,
  to_budget REAL,
  source TEXT NOT NULL      -- dashboard | meta
);
CREATE INDEX budget_changes_by_entity ON budget_changes(entity_id, at);
