-- Per-campaign promo costs synced from the team's sheet (tab "รวมต้นทุน ที่เปิด ADS"), matched by campaign name.
CREATE TABLE campaign_costs (
  name_key TEXT PRIMARY KEY,   -- lowercased, whitespace-collapsed campaign name
  name TEXT NOT NULL,
  tiers TEXT NOT NULL,         -- [{"units":2,"price":299,"cost":175.93}]
  synced_at TEXT NOT NULL
);
