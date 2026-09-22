-- Work moving between boxes: intel → brief → post → review → approval → publish,
-- plus ad plans, budget changes and learned rules waiting for the owner.
create table if not exists work_item (
  id             bigserial primary key,
  store_id       text not null references store(id),
  kind           text not null check (kind in ('intel','brief','post','ad_plan','adjust','rule')),
  title          text not null,
  body           text not null,
  status         text not null default 'open' check (status in ('open','changes','pending','approved','rejected','done')),
  from_slug      text not null,
  to_slug        text,
  parent_id      bigint references work_item(id),
  review         jsonb,                        -- {pass, issues[]} from the reviewer
  rounds         int not null default 0,       -- how many times the copywriter has had it
  run_id         bigint references agent_run(id),
  directive_id   bigint references directive(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  decided_at     timestamptz,
  decided_by     text,
  decision_note  text,
  published_at   timestamptz,
  published_as   text                          -- 'จริง' | 'จำลอง'
);
create index if not exists work_item_inbox_idx on work_item(store_id, to_slug, status);
create index if not exists work_item_store_idx on work_item(store_id, id desc);
