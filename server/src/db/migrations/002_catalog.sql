-- Catalog & stock: the heart of a jeans business (size matters)
create table if not exists product (
  id            text primary key,
  store_id      text not null references store(id),
  sku_group     text not null,                 -- [ประเภท] part of the SKU, e.g. KB
  name          text not null,
  category      text,
  base_price    numeric(10,2),
  set_price     jsonb,                         -- {"qty":3,"price":550}
  is_promotable boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (store_id, sku_group)
);

create table if not exists variant (
  id         text primary key,
  product_id text not null references product(id),
  sku        text not null unique,             -- [ประเภท]-[สถานที่]-[สี]-[ขนาด]
  location   text not null,
  color      text not null,
  size       text not null,
  price      numeric(10,2),
  created_at timestamptz not null default now()
);
create index if not exists variant_product on variant(product_id);

-- append-only snapshots; latest per (variant, location) is the truth
create table if not exists stock_level (
  variant_id  text not null references variant(id),
  location    text not null,
  qty         integer not null,
  snapshot_at timestamptz not null default now(),
  primary key (variant_id, location, snapshot_at)
);

create or replace view v_stock_latest as
select distinct on (variant_id, location) variant_id, location, qty, snapshot_at
from stock_level
order by variant_id, location, snapshot_at desc;

-- which sizes must never run out before we advertise a product
create table if not exists size_rule (
  store_id         text not null references store(id),
  category         text not null,               -- '*' = default for the store
  core_sizes       text[] not null,
  min_qty_per_size integer not null default 6,
  primary key (store_id, category)
);
