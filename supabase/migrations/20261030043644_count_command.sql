-- Voice to lists: the daily counter as one function, so the `commands` Edge Function can call it over
-- HTTP (PostgREST) instead of opening a database connection per request, which took ~1.8 s.
-- Only the service role may run it: the function calls it with that key, server side only.

create function public.count_command(p_user uuid, p_day date, p_keep_days int default 30)
returns integer
language sql
set search_path = ''
as $$
  with old as (
    delete from public.command_usage where user_id = p_user and day < p_day - p_keep_days
  )
  insert into public.command_usage (user_id, day, count) values (p_user, p_day, 1)
  on conflict (user_id, day) do update set count = public.command_usage.count + 1
  returning count;
$$;

revoke all on function public.count_command(uuid, date, int) from public, anon, authenticated;
grant execute on function public.count_command(uuid, date, int) to service_role;
