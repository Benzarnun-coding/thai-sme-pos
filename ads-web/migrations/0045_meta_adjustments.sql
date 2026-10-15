-- Corrections to Meta's reported purchases, per Bangkok day × campaign × hour, subtracted wherever we use Meta's
-- hourly purchases (order crediting, order-by-order costing). First use: 87 purchases sent by mistake on
-- 2026-10-15 on top of the admins' own tags (Meta can't delete events). campaign_id '' = ad unknown.
CREATE TABLE meta_adjustments (
  date TEXT NOT NULL,
  campaign_id TEXT NOT NULL DEFAULT '',
  hour TEXT NOT NULL,            -- "HH:00", like conversion_hours.hour
  purchases REAL NOT NULL,       -- to subtract
  value REAL NOT NULL,           -- to subtract
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (date, campaign_id, hour, reason)
);
