-- Owner directives: "ดัน X สัปดาห์นี้", typed from the Trend screen in plain
-- Thai. A directive rides along in the prompt of every targeted AI box until it
-- expires or the owner marks it done, so a trend becomes an instruction with
-- one click instead of being re-typed into five boxes.
create table if not exists directive (
  id          bigserial primary key,
  store_id    text not null references store(id),
  title       text not null,
  text        text not null,
  source      text not null default 'manual' check (source in ('trend','competitor','season','post','manual')),
  targets     jsonb not null default '[]',   -- agent slugs
  status      text not null default 'active' check (status in ('active','done','archived')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  by          text
);
create index if not exists directive_store_idx on directive(store_id, status, id desc);
