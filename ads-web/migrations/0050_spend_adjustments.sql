-- A correction can also take spend off a day × campaign (hour '' = the whole day): e.g. the 51,157 THB a campaign
-- created by an intruder spent on 2026-11-01. Subtracted from Meta's spend wherever the dashboard, goal, pace line,
-- post ideas and rules read it (worker/metadata.ts); Meta's own report keeps the number.
ALTER TABLE meta_adjustments ADD COLUMN spend REAL NOT NULL DEFAULT 0;
