-- Product catalog: every SKU row of the SKU+Price sheet's warehouse tabs, for the /catalog search page and
-- (later) order sheets per supplier and per-SKU costs. The browser reads each tab's CSV and sends only the rows
-- that changed, so a sync costs a few hundred D1 writes on a normal day instead of ~17k.
CREATE TABLE catalog (
  tab TEXT NOT NULL,             -- sheet tab = warehouse (BB, PK, CM …)
  sku TEXT NOT NULL,             -- column B, trimmed, invisible characters removed
  pos INTEGER NOT NULL,          -- sheet row number, for sheet order
  spu TEXT NOT NULL DEFAULT '',  -- column A
  code TEXT NOT NULL DEFAULT '', -- C รหัสสินค้า
  name TEXT NOT NULL DEFAULT '', -- D รายละเอียด
  color TEXT NOT NULL DEFAULT '',-- E colour code
  size TEXT NOT NULL DEFAULT '', -- F
  wh TEXT NOT NULL DEFAULT '',   -- G คลังสินค้า
  cost REAL,                     -- H
  price REAL,                    -- I
  image TEXT NOT NULL DEFAULT '',-- J image link
  shop TEXT NOT NULL DEFAULT '', -- ร้านค้า (BB-style tabs: the supplier to order from)
  alias TEXT NOT NULL DEFAULT '',-- รหัสแทน (the supplier's own code)
  shop_price REAL,               -- ราคาร้านค้า
  old_code TEXT NOT NULL DEFAULT '', -- รหัสเก่า
  PRIMARY KEY (tab, sku)
) WITHOUT ROWID;

-- One row per synced tab: counts here so the page never has to count 17k rows.
CREATE TABLE catalog_tabs (
  tab TEXT PRIMARY KEY,
  gid TEXT NOT NULL,
  sort INTEGER NOT NULL,
  skus INTEGER NOT NULL,
  synced_at TEXT NOT NULL,
  synced_by TEXT NOT NULL
);

-- SKUs added on the website (not in the sheet yet). Sheet syncs never touch these.
CREATE TABLE catalog_web (
  sku TEXT PRIMARY KEY,
  tab TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  cost REAL,
  price REAL,
  image TEXT NOT NULL DEFAULT '',
  shop TEXT NOT NULL DEFAULT '',
  alias TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
