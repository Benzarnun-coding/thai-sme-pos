-- Key/value settings: guardrails, dry_run, kill_switch, sheet config.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- A section is a product line: which sheet product codes it sells and the per-order cost model → break-even ROAS.
-- Campaigns join a section explicitly (campaigns.section_id) or when their name contains one of `keywords`.
CREATE TABLE sections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '[]',        -- JSON string[]
  products TEXT NOT NULL DEFAULT '[]',        -- JSON {tab, code}[] from the cost sheet
  units_per_order REAL NOT NULL DEFAULT 1,
  extra_cost_per_order REAL NOT NULL DEFAULT 0, -- shipping, packing, platform fee per order
  price_per_order REAL,                       -- null = use AOV reported by Meta
  sort INTEGER NOT NULL DEFAULT 0
);

-- A stage is where a campaign is in its life (experiment → testing → winning → retest). Rules live here.
-- Thresholds can be multiples of break-even, so one stage rule set fits every product's cost.
CREATE TABLE stages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rules TEXT NOT NULL DEFAULT '[]',           -- JSON WebRule[]; action "move" changes the campaign's stage
  automation INTEGER NOT NULL DEFAULT 1,      -- 0 = rules never act on this stage
  sort INTEGER NOT NULL DEFAULT 0
);

-- Per-campaign settings. No stage = not managed by any rule.
-- mode: stage = follow the stage's rules, custom = own rules, off = never automate.
CREATE TABLE campaigns (
  campaign_id TEXT PRIMARY KEY,
  section_id TEXT,
  stage_id TEXT,
  stage_since TEXT,                           -- when it entered stage_id; "move" rules can require N days here
  mode TEXT NOT NULL DEFAULT 'stage',
  rules TEXT,
  updated_at TEXT NOT NULL
);

-- Cost sheet cache, one row per (tab, product code), averaged over its SKUs.
CREATE TABLE costs (
  tab TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sku_count INTEGER NOT NULL,
  avg_cost REAL NOT NULL,
  min_cost REAL NOT NULL,
  max_cost REAL NOT NULL,
  avg_price REAL NOT NULL,
  PRIMARY KEY (tab, code)
);

-- `${rule_id}:${entity_id}` → last time that rule acted on that entity.
CREATE TABLE cooldowns (
  key TEXT PRIMARY KEY,
  at TEXT NOT NULL
);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at TEXT NOT NULL,
  trigger TEXT NOT NULL,
  dry_run INTEGER NOT NULL,
  summary TEXT NOT NULL,
  report TEXT NOT NULL
);

-- Every change made through the dashboard, plus automatic stage moves (actor = 'อัตโนมัติ').
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('dry_run', 'true'),
  ('kill_switch', 'false'),
  ('guardrails', '{"max_change_pct_per_run":20,"min_daily_budget":50,"max_daily_budget":3000,"max_total_daily_budget":20000}'),
  -- Entered in the dashboard (ตั้งค่า), not in git: the sheet is link-shared, so its id is effectively a read key.
  ('sheet_id', ''),
  ('sheet_tabs', '["PK","BB","BBW","AR","BT","CM","CN","JW","GG","MNM","MNW","MK","AM","SP"]');

-- Catch-all product line for campaigns that match no section (no cost linked → no break-even).
INSERT INTO sections (id, name, sort) VALUES ('default', 'ยังไม่ระบุสินค้า', 999);

-- The four stages start with no rules: the dashboard only shows data until Benz sets rules per stage.
-- Suggested rule sets live in web/src/stageTemplates.ts ("ใส่กฎแนะนำ" button).
INSERT INTO stages (id, name, description, sort) VALUES
  ('experiment', 'ทดลอง', 'ไอเดียใหม่ ครีเอทีฟใหม่ งบเล็ก', 1),
  ('testing', 'ทดสอบระบบ', 'ขายได้แล้ว กำลังพิสูจน์ว่าได้ซ้ำ', 2),
  ('winning', 'ทำเงิน', 'ตัวหลักที่ทำกำไร ค่อยๆ เพิ่มงบ', 3),
  ('retest', 'ดับ → ทดสอบใหม่', 'เคยทำเงินแต่ดับ ลดงบแล้วลองใหม่', 4);
