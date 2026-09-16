-- Back-office runs and competitor watch.

-- One row per time a box did its job — on schedule or by hand. The Studio shows
-- the latest run on every box and the reporter reads today's runs.
create table if not exists agent_run (
  id          bigserial primary key,
  agent_id    text not null references agent(id),
  store_id    text not null references store(id),
  trigger     text not null check (trigger in ('schedule','manual','event')),
  status      text not null check (status in ('ok','skipped','error')),
  summary     text not null,                 -- one line, Thai, for the card
  output      jsonb,                         -- whatever the box produced (text, counts, ids)
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  by          text
);
create index if not exists agent_run_agent_idx on agent_run(agent_id, id desc);
create index if not exists agent_run_store_day_idx on agent_run(store_id, started_at desc);

-- What competitor pages are running, as the scout sees it. Filled by the Ad
-- Library connector (phase 6); demo data until then.
create table if not exists competitor_ad (
  id          text primary key,
  store_id    text not null references store(id),
  page_name   text not null,
  ad_text     text not null,
  hook        text,                          -- the angle: set_price, bogo, free_ship, proof, story
  price_hint  int,                           -- the headline price if one is shown
  format      text,                          -- image | video | carousel
  first_seen  date not null,
  active      boolean not null default true,
  source      text not null default 'demo'
);
create index if not exists competitor_ad_store_idx on competitor_ad(store_id, active);
