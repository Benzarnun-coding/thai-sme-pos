-- Benz Command Center (/command): data pushed from Benz's machine (job metadata only, already summarised) and small
-- caches (RSS, year-to-date). One JSON row per source, replaced whole; everything here can be rebuilt.
CREATE TABLE command_sources (
  source TEXT PRIMARY KEY,        -- 'jobs' | 'rss' | 'ytd'
  updated_at TEXT NOT NULL,       -- ISO UTC: received_at for jobs, fetched_at for caches
  generated_at TEXT,              -- jobs: the machine's generated_at in UTC (replay check); rss: last fetch attempt
  data TEXT NOT NULL,             -- JSON
  error TEXT                      -- last refresh error (rss), else NULL
);
