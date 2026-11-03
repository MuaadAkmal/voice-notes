-- Razorpay subscriptions, one row per subscription, written only by the `billing` Edge Function through
-- the functions below with the service role key (RLS on, no policies, no Data API grants). Each save
-- recomputes the account's plan in `account_plans` from its subscriptions.

create table public.subscriptions (
  id text primary key, -- Razorpay's sub_...
  user_id uuid not null references auth.users (id) on delete cascade,
  razorpay_plan_id text not null,
  plan text not null references public.plans (id),
  status text not null, -- Razorpay's: created, authenticated, active, pending, halted, cancelled, completed, expired, paused
  current_end timestamptz,
  cancel_at_period_end boolean not null default false,
  event_at timestamptz not null, -- when Razorpay produced the state saved here; older states never overwrite it
  created_at timestamptz not null default now()
);

create index subscriptions_user_id on public.subscriptions (user_id);

alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from anon, authenticated;

-- Paid plans come from subscriptions that are active, or pending (a renewal Razorpay is still retrying).
-- Pro wins over Standard. With none, a paid plan row is removed (the account is free again).
create function public.billing_refresh_plan(p_user uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_plan text;
begin
  select s.plan into v_plan
  from public.subscriptions s
  where s.user_id = p_user and s.status in ('active', 'pending')
  order by (s.plan = 'pro') desc, s.created_at desc
  limit 1;
  if v_plan is null then
    delete from public.account_plans a where a.user_id = p_user and a.plan in ('standard', 'pro');
  else
    insert into public.account_plans (user_id, plan) values (p_user, v_plan)
    on conflict (user_id) do update set plan = excluded.plan;
  end if;
end;
$$;

-- Saves a subscription's state unless a newer one is already saved (webhooks can arrive out of order
-- and more than once), then recomputes the plan. One account's saves run one at a time.
create function public.billing_save(
  p_id text, p_user uuid, p_razorpay_plan_id text, p_plan text, p_status text, p_current_end timestamptz, p_event_at timestamptz
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('billing:' || p_user::text));
  insert into public.subscriptions as s (id, user_id, razorpay_plan_id, plan, status, current_end, event_at)
  values (p_id, p_user, p_razorpay_plan_id, p_plan, p_status, p_current_end, p_event_at)
  on conflict (id) do update
    set razorpay_plan_id = excluded.razorpay_plan_id, plan = excluded.plan, status = excluded.status,
        current_end = excluded.current_end, event_at = excluded.event_at
    where s.event_at <= excluded.event_at and s.user_id = excluded.user_id;
  perform public.billing_refresh_plan(p_user);
end;
$$;

create function public.billing_set_cancel(p_id text)
returns void
language sql
set search_path = ''
as $$
  update public.subscriptions set cancel_at_period_end = true where id = p_id;
$$;

create function public.billing_subscription(p_id text)
returns setof public.subscriptions
language sql
stable
set search_path = ''
as $$
  select * from public.subscriptions where id = p_id;
$$;

-- The subscription to show: one that pays for the plan if any, else the newest.
create function public.billing_latest(p_user uuid)
returns setof public.subscriptions
language sql
stable
set search_path = ''
as $$
  select * from public.subscriptions
  where user_id = p_user
  order by (status in ('active', 'pending', 'authenticated')) desc, created_at desc
  limit 1;
$$;

revoke all on function public.billing_refresh_plan(uuid) from public, anon, authenticated;
revoke all on function public.billing_save(text, uuid, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.billing_set_cancel(text) from public, anon, authenticated;
revoke all on function public.billing_subscription(text) from public, anon, authenticated;
revoke all on function public.billing_latest(uuid) from public, anon, authenticated;
grant execute on function public.billing_save(text, uuid, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.billing_set_cancel(text) to service_role;
grant execute on function public.billing_subscription(text) to service_role;
grant execute on function public.billing_latest(uuid) to service_role;
