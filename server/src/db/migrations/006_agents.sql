-- AI Studio: each assistant is a box the owner can teach by typing.
--
-- An agent row is the whole configuration a non-technical owner edits:
-- plain-language instructions, worked examples, which add-ons it may use
-- (connections, knowledge, actions) and how much it may do on its own.
-- Nothing here is a prompt template — prompt assembly lives in code and
-- reads these rows, so the owner never sees or edits a prompt.

create table if not exists agent (
  id            text primary key,                       -- `${store_id}-${slug}`
  store_id      text not null references store(id),
  slug          text not null,                          -- strategist | copywriter | qa | analyst | chat | wholesale
  name          text not null,
  emoji         text,
  role          text not null,                          -- one line, what it does
  instructions  text not null default '',               -- the owner's teaching, plain Thai
  examples      jsonb not null default '[]',            -- [{ask, answer}] good answers to imitate
  addons        jsonb not null default '{}',            -- {connections:[], knowledge:[], actions:[]}
  autonomy      text not null default 'propose' check (autonomy in ('propose','auto')),
  model         text not null default 'claude-opus-5',
  effort        text not null default 'medium' check (effort in ('low','medium','high','xhigh','max')),
  enabled       boolean not null default true,
  updated_by    text,
  updated_at    timestamptz not null default now(),
  unique (store_id, slug)
);

create table if not exists agent_thread (
  id          text primary key,
  agent_id    text not null references agent(id),
  store_id    text not null references store(id),
  title       text,
  created_at  timestamptz not null default now()
);

create table if not exists agent_message (
  id          bigserial primary key,
  thread_id   text not null references agent_thread(id),
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  -- what the assistant actually saw and used, for audit and for "why did it say that"
  used        jsonb,
  mode        text check (mode in ('claude','demo')),
  tokens_in   int,
  tokens_out  int,
  created_at  timestamptz not null default now()
);
create index if not exists agent_message_thread_idx on agent_message(thread_id, id);

-- 👍 / 👎 on a reply. A 👎 with a note is how the owner corrects the assistant
-- without writing a prompt: the note is fed back as "สิ่งที่เจ้าของเคยแก้".
create table if not exists agent_feedback (
  id          bigserial primary key,
  agent_id    text not null references agent(id),
  message_id  bigint references agent_message(id),
  verdict     text not null check (verdict in ('up','down')),
  note        text,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists agent_feedback_agent_idx on agent_feedback(agent_id, id);
