-- Last Meta answer per dashboard window. The app is on Meta's development access tier, which allows few
-- Marketing API calls, so the dashboard reuses this for a few minutes and falls back to it when rate-limited.
CREATE TABLE meta_cache (
  key TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  data TEXT NOT NULL
);
