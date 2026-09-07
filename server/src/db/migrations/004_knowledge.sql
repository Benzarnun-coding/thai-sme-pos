-- Knowledge base: what the AI reads every time (no AI in project 1, but the tables exist now)
create table if not exists brand_doc (
  store_id   text not null references store(id),
  key        text not null,                     -- voice | usp | forbidden | policy | sizes
  content    text not null,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (store_id, key)
);

create table if not exists learned_rule (
  id         text primary key,
  store_id   text not null references store(id),
  rule       text not null,
  evidence   jsonb,
  confidence numeric(4,3),
  status     text not null default 'draft' check (status in ('draft','active','retired')),
  applies_to jsonb,
  created_at timestamptz not null default now()
);
