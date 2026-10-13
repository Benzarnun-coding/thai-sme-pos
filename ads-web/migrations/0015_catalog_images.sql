-- Product pictures added on /catalog, one per product (tab + SKU-without-size, the page's product key).
-- Uploads are resized in the browser first (≈20 KB thumbnail + ≈100 KB large) and kept here so the free plan needs no R2;
-- `url` instead points at a picture elsewhere. Either one replaces column J of the sheet for that product on the page.
CREATE TABLE catalog_images (
  key TEXT PRIMARY KEY,          -- `${tab}|${spu}`
  tab TEXT NOT NULL,
  spu TEXT NOT NULL,
  url TEXT,                      -- a linked picture (https)
  thumb BLOB,                    -- uploaded: small JPEG for cards
  full BLOB,                     -- uploaded: large JPEG for the product view
  mime TEXT,
  bytes INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
