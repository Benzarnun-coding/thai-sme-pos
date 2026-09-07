-- Facts are append-only. Never UPDATE history; insert new dates.
create table if not exists fact_sales_daily (
  store_id   text not null references store(id),
  date       date not null,
  variant_id text not null references variant(id),
  channel    text not null,                     -- pos | facebook_chat | shopee | tiktok_shop | wholesale
  qty        integer not null default 0,
  revenue    numeric(12,2) not null default 0,
  primary key (store_id, date, variant_id, channel)
);
create index if not exists fact_sales_daily_date on fact_sales_daily(store_id, date desc);

create table if not exists page_snapshot (
  store_id    text not null references store(id),
  channel     text not null,
  date        date not null,
  followers   integer,
  fans        integer,
  raw         jsonb,
  primary key (store_id, channel, date)
);

create table if not exists fact_post_insight_daily (
  store_id         text not null references store(id),
  channel          text not null,
  external_post_id text not null,
  date             date not null,
  created_time     timestamptz,
  message          text,
  permalink        text,
  reach            integer,
  engaged          integer,
  clicks           integer,
  comments         integer,
  shares           integer,
  reactions        integer,
  raw              jsonb,
  primary key (channel, external_post_id, date)
);

create table if not exists fact_ad_insight_daily (
  store_id        text not null references store(id),
  channel         text not null,
  external_ad_id  text not null,
  ad_name         text,
  campaign_name   text,
  date            date not null,
  impressions     integer not null default 0,
  reach           integer not null default 0,
  clicks          integer not null default 0,
  spend           numeric(12,2) not null default 0,
  conversations   integer not null default 0,  -- messaging conversations started
  purchases       integer not null default 0,
  revenue         numeric(12,2) not null default 0,
  raw             jsonb,
  primary key (channel, external_ad_id, date)
);
create index if not exists fact_ad_insight_daily_date on fact_ad_insight_daily(store_id, date desc);
