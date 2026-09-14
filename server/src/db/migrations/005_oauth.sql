-- OAuth "Connect account" flow (like GitHub's connect button)
--
-- The owner clicks Connect → we bounce them to the platform's consent screen →
-- they pick which Page / Ad account / Shop → we store an encrypted token here.
-- No more copying tokens into .env by hand.

-- short-lived CSRF state for the redirect round-trip
create table if not exists oauth_state (
  state        text primary key,
  store_id     text not null references store(id),
  channel      text not null,
  redirect_to  text,
  created_at   timestamptz not null default now(),
  consumed_at  timestamptz
);
create index if not exists oauth_state_created on oauth_state(created_at);

-- a single OAuth grant can expose several accounts (many Pages, many ad accounts).
-- We keep the grant once, then let the owner attach the accounts they want.
create table if not exists oauth_grant (
  id             text primary key,
  store_id       text not null references store(id),
  channel        text not null,
  granted_scopes text[],
  -- long-lived USER token, encrypted; page/shop tokens are derived from it
  token_enc      text,
  refresh_enc    text,
  expires_at     timestamptz,
  granted_by     text,                         -- name/email of the person who clicked Connect
  created_at     timestamptz not null default now()
);

alter table connection add column if not exists grant_id      text references oauth_grant(id);
alter table connection add column if not exists token_enc     text;   -- page/shop token, encrypted at rest
alter table connection add column if not exists refresh_enc   text;
alter table connection add column if not exists token_source  text not null default 'env'
  check (token_source in ('env','oauth','demo'));
alter table connection add column if not exists scopes        text[];
alter table connection add column if not exists avatar_url    text;
alter table connection add column if not exists connected_by  text;
alter table connection add column if not exists connected_at  timestamptz;
