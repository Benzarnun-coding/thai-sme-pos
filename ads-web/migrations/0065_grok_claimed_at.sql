-- When ✅ was pressed (status 'working'). A launch that dies in the background (Worker cut off) left the row
-- 'working' forever and the buttons dead; a press after 10 minutes may take it again (worker/index.ts grokAdPress).
ALTER TABLE grok_ads ADD COLUMN claimed_at TEXT;
