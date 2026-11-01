-- Dictation cleanup: rewrites each account asked for per day, for their own cap on the LLM, apart from
-- voice commands so a day of dictating can't use those up. Same shape as count_command: only the
-- `commands` Edge Function touches it, over REST with the service role.

create table public.polish_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (user_id, day)
);

alter table public.polish_usage enable row level security;

revoke all on public.polish_usage from anon, authenticated;

create function public.count_polish(p_user uuid, p_day date, p_keep_days int default 30)
returns integer
language sql
set search_path = ''
as $$
  with old as (
    delete from public.polish_usage where user_id = p_user and day < p_day - p_keep_days
  )
  insert into public.polish_usage (user_id, day, count) values (p_user, p_day, 1)
  on conflict (user_id, day) do update set count = public.polish_usage.count + 1
  returning count;
$$;

revoke all on function public.count_polish(uuid, date, int) from public, anon, authenticated;
grant execute on function public.count_polish(uuid, date, int) to service_role;
