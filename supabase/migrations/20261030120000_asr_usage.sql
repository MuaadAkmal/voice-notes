-- Cloud transcription: seconds of audio each account sent per month, against its plan's cap. Only the
-- `asr` Edge Function touches these, through the functions below with the service role key:
-- RLS is on with no policies, and the Data API roles have no grants.

create table public.plans (
  id text primary key,
  monthly_seconds integer not null check (monthly_seconds >= 0)
);

insert into public.plans (id, monthly_seconds) values ('free', 7200);

-- No row = the free plan.
create table public.account_plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null references public.plans (id)
);

create table public.asr_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  period date not null, -- first day of the month (UTC)
  seconds_used integer not null default 0 check (seconds_used >= 0),
  primary key (user_id, period)
);

alter table public.plans enable row level security;
alter table public.account_plans enable row level security;
alter table public.asr_usage enable row level security;

revoke all on public.plans from anon, authenticated;
revoke all on public.account_plans from anon, authenticated;
revoke all on public.asr_usage from anon, authenticated;

create function public.asr_limit_for(p_user uuid)
returns table (lim integer, plan text)
language sql
stable
set search_path = ''
as $$
  select coalesce(p.monthly_seconds, f.monthly_seconds), coalesce(p.id, 'free')
  from public.plans f
  left join public.account_plans a on a.user_id = p_user
  left join public.plans p on p.id = a.plan
  where f.id = 'free';
$$;

-- One statement: the upsert adds only while the new total stays within the cap. ON CONFLICT DO UPDATE
-- locks the row and re-checks its WHERE against the latest committed total, so two concurrent
-- reserves can't both pass. Returns the total either way.
create function public.reserve_asr_seconds(p_user uuid, p_period date, p_seconds integer)
returns table (ok boolean, used integer, lim integer)
language sql
set search_path = ''
as $$
  with l as (
    select x.lim from public.asr_limit_for(p_user) x
  ),
  ins as (
    insert into public.asr_usage as u (user_id, period, seconds_used)
    select p_user, p_period, p_seconds from l where p_seconds > 0 and p_seconds <= l.lim
    on conflict (user_id, period) do update
      set seconds_used = u.seconds_used + excluded.seconds_used
      where coalesce(u.seconds_used, 0) + excluded.seconds_used <= (select l.lim from l)
    returning u.seconds_used
  )
  select
    exists (select 1 from ins),
    coalesce(
      (select ins.seconds_used from ins),
      (select a.seconds_used from public.asr_usage a where a.user_id = p_user and a.period = p_period),
      0
    ),
    (select l.lim from l);
$$;

create function public.refund_asr_seconds(p_user uuid, p_period date, p_seconds integer)
returns void
language sql
set search_path = ''
as $$
  update public.asr_usage
  set seconds_used = greatest(0, seconds_used - greatest(p_seconds, 0))
  where user_id = p_user and period = p_period;
$$;

create function public.asr_usage_for(p_user uuid, p_period date)
returns table (used integer, lim integer, plan text)
language sql
stable
set search_path = ''
as $$
  select
    coalesce((select a.seconds_used from public.asr_usage a where a.user_id = p_user and a.period = p_period), 0),
    x.lim,
    x.plan
  from public.asr_limit_for(p_user) x;
$$;

revoke all on function public.asr_limit_for(uuid) from public, anon, authenticated;
revoke all on function public.reserve_asr_seconds(uuid, date, integer) from public, anon, authenticated;
revoke all on function public.refund_asr_seconds(uuid, date, integer) from public, anon, authenticated;
revoke all on function public.asr_usage_for(uuid, date) from public, anon, authenticated;
grant execute on function public.asr_limit_for(uuid) to service_role;
grant execute on function public.reserve_asr_seconds(uuid, date, integer) to service_role;
grant execute on function public.refund_asr_seconds(uuid, date, integer) to service_role;
grant execute on function public.asr_usage_for(uuid, date) to service_role;
