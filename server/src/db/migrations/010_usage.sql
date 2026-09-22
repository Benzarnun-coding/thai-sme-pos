-- Token meter: what each model call cost, so the owner can see spend per box
-- and the system can stop AI runs at a monthly cap (automation keeps going).
alter table agent_message add column if not exists cache_read int;
alter table agent_message add column if not exists cache_write int;
alter table agent_message add column if not exists model text;
create index if not exists agent_message_created_idx on agent_message(created_at);
