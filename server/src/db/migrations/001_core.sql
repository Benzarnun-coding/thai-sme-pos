-- Core: store, connections, raw events, audit
create table if not exists store (
  id         text primary key,
  name       text not null,
  type       text,
  timezone   text not null default 'Asia/Bangkok',
  settings   jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists connection (
  id                  text primary key,
  store_id            text not null references store(id),
  channel             text not null check (channel in ('facebook','tiktok','shopee','line','pos')),
  external_account_id text,
  display_name        text,
  capabilities        jsonb not null default '{}',
  token_ref           text,                       -- name of the env var / secret holding the token
  token_expires_at    timestamptz,
  status              text not null default 'disconnected',
  last_sync_at        timestamptz,
  last_error          text,
  unique (store_id, channel, external_account_id)
);

-- Everything received from outside lands here first (replayable)
create table if not exists raw_event (
  id           bigserial primary key,
  store_id     text,
  source       text not null,     -- facebook | tiktok | shopee | pos | import
  kind         text not null,     -- page | posts | ad_insights | sku_import ...
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists raw_event_store_kind on raw_event(store_id, kind, received_at desc);

create table if not exists audit_log (
  id         bigserial primary key,
  store_id   text,
  actor      text not null,
  actor_type text not null check (actor_type in ('human','automation','ai')),
  action     text not null,
  target     text,
  before     jsonb,
  after      jsonb,
  at         timestamptz not null default now()
);
