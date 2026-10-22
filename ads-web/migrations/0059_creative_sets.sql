-- ห้องจับคู่ (docs/creative.md): a caption and an image the judges passed, of the same product, put together as one
-- post. Approved sets are what the ads side may take later (that hand-off ships off; Benz switches it on).
CREATE TABLE creative_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  caption_id INTEGER NOT NULL,
  image_id INTEGER NOT NULL,
  caption_text TEXT NOT NULL,            -- the caption as it will be posted (a judge's edit wins)
  ai_note TEXT,                          -- Claude's check that caption and picture agree (JSON)
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | approved | rejected
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  UNIQUE (caption_id, image_id)
);
CREATE INDEX creative_sets_status ON creative_sets(status, code);
