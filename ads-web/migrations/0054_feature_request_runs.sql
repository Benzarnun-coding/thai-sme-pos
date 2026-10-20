-- /ไอเดีย builds itself (Benz 2026-10-20): ให้ทำ (and ไม่ผ่าน) fire a Claude Code routine that opens a PR on
-- claude/idea-<id>; the Worker finds the PR on GitHub and tells Benz in the post. Benz still merges and deploys.
ALTER TABLE feature_requests ADD COLUMN run_url TEXT;   -- the latest Claude session
ALTER TABLE feature_requests ADD COLUMN run_at TEXT;    -- when it was fired
ALTER TABLE feature_requests ADD COLUMN runs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feature_requests ADD COLUMN pr_url TEXT;
ALTER TABLE feature_requests ADD COLUMN pr_at TEXT;     -- when Benz was told about the PR (for the latest run)
