-- Voice to lists: commands each account sent per day, for the daily cap on the LLM. Only the `commands`
-- Edge Function touches it, through its direct database connection: RLS is on with no policies, and
-- the Data API roles have no grants. Rows older than 30 days are deleted by the function.

create table public.command_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (user_id, day)
);

alter table public.command_usage enable row level security;

revoke all on public.command_usage from anon, authenticated;
