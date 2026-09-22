-- Money and time on the publisher's side:
--   budget_ledger  every baht the loop commits (a plan published) or sees spent (ad insights),
--                  so the daily and monthly caps are enforced before anything goes out
--   publish_at     an approved post or plan can wait for a chosen time
create table if not exists budget_ledger (
  id          bigserial primary key,
  store_id    text not null references store(id),
  date        date not null,
  kind        text not null check (kind in ('planned','spend')),
  ref         text,                          -- work_item id or ad id
  amount      numeric(12,2) not null,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists budget_ledger_day_idx on budget_ledger(store_id, date, kind);

alter table work_item add column if not exists publish_at timestamptz;
alter table work_item add column if not exists budget_thb numeric(12,2);
