-- Voice note titles: titles each account asked for per day, for their own cap on the LLM, apart from
-- voice commands and dictation cleanup so auto-titling a busy day can't use those up. Same shape as
-- count_polish: only the `commands` Edge Function touches it, over REST with the service role.

create table public.title_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (user_id, day)
);

alter table public.title_usage enable row level security;

revoke all on public.title_usage from anon, authenticated;

create function public.count_title(p_user uuid, p_day date, p_keep_days int default 30)
returns integer
language sql
set search_path = ''
as $$
  with old as (
    delete from public.title_usage where user_id = p_user and day < p_day - p_keep_days
  )
  insert into public.title_usage (user_id, day, count) values (p_user, p_day, 1)
  on conflict (user_id, day) do update set count = public.title_usage.count + 1
  returning count;
$$;

revoke all on function public.count_title(uuid, date, int) from public, anon, authenticated;
grant execute on function public.count_title(uuid, date, int) to service_role;
