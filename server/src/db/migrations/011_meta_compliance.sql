-- Meta platform requirements for a Live app: know which platform user granted a
-- token (so a deletion or deauthorize callback can find it), and keep a record of
-- every deletion request with a confirmation code the user can check.
alter table oauth_grant add column if not exists external_user_id text;
create index if not exists oauth_grant_user_idx on oauth_grant(channel, external_user_id);

create table if not exists deletion_request (
  code              text primary key,
  channel           text not null,
  external_user_id  text not null,
  kind              text not null check (kind in ('deletion','deauthorize')),
  status            text not null default 'done' check (status in ('received','done')),
  details           jsonb,
  requested_at      timestamptz not null default now(),
  completed_at      timestamptz
);
