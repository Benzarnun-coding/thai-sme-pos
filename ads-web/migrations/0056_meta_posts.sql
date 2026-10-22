-- ห้องฝึก foundation (Benz 2026-10-22): every post that runs as an ad right now, read from Meta (read only):
-- caption, picture, which ads/campaigns use it and their last-14-day numbers. One row per post (story id), so a post
-- used by several ads is one row. The picture is fetched by the browser through the image proxy, resized and stored.
CREATE TABLE meta_posts (
  key TEXT PRIMARY KEY,                   -- story id, else creative id
  story_id TEXT,
  message TEXT NOT NULL DEFAULT '',
  image_url TEXT,                         -- Meta's address (expires; only used to fetch the picture once)
  permalink TEXT,
  post_read INTEGER NOT NULL DEFAULT 1,
  ads TEXT NOT NULL DEFAULT '[]',         -- JSON [{ad_id, ad_name, campaign_id, campaign_name}]
  spend REAL NOT NULL DEFAULT 0,          -- Meta, last 14 days, summed over the post's ads
  impressions INTEGER NOT NULL DEFAULT 0,
  purchases REAL NOT NULL DEFAULT 0,      -- Meta-tagged
  purchase_value REAL NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  code TEXT NOT NULL DEFAULT '',          -- product code guessed from the campaign name, editable
  active INTEGER NOT NULL DEFAULT 1,      -- still running at the last import
  thumb BLOB, full BLOB, mime TEXT,
  first_seen TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
