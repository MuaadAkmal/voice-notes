-- Billing and storage races.
--
-- 1. Razorpay stamps webhooks in whole seconds and doesn't promise their order, and the first payment
--    sends authenticated, activated and charged in the same second. On a tie, a state earlier in a
--    subscription's life no longer replaces a later one (an `authenticated` arriving after `activated`
--    used to drop the paid plan).
-- 2. One checkout at a time per account: two tabs could each pass the "no subscription yet" check and
--    create a payable subscription. A checkout holds a claim while it talks to Razorpay; a claim older
--    than two minutes is a checkout that died, and is taken over.

-- How far along its life a status is; on equal event times the further one stays.
create function public.billing_status_rank(p_status text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'created' then 0
    when 'authenticated' then 1
    when 'active' then 2
    when 'pending' then 3
    when 'paused' then 3
    when 'halted' then 4
    else 5 -- cancelled, completed, expired: final
  end;
$$;

create or replace function public.billing_save(
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
    where s.user_id = excluded.user_id
      and (s.event_at < excluded.event_at
        or (s.event_at = excluded.event_at
          and public.billing_status_rank(s.status) <= public.billing_status_rank(excluded.status)));
  perform public.billing_refresh_plan(p_user);
end;
$$;

create table public.billing_checkouts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  started_at timestamptz not null
);

alter table public.billing_checkouts enable row level security;
revoke all on public.billing_checkouts from anon, authenticated;

-- Claims the account's checkout; ok is false while another one (under two minutes old) holds it.
create function public.billing_checkout_begin(p_user uuid)
returns table (ok boolean)
language plpgsql
set search_path = ''
as $$
begin
  insert into public.billing_checkouts as c (user_id, started_at) values (p_user, now())
  on conflict (user_id) do update set started_at = excluded.started_at
    where c.started_at < excluded.started_at - interval '2 minutes';
  return query select found;
end;
$$;

create function public.billing_checkout_end(p_user uuid)
returns void
language sql
set search_path = ''
as $$
  delete from public.billing_checkouts where user_id = p_user;
$$;

-- Checkouts started and never paid: each is still payable at Razorpay until cancelled.
create function public.billing_unpaid(p_user uuid)
returns setof public.subscriptions
language sql
stable
set search_path = ''
as $$
  select * from public.subscriptions where user_id = p_user and status = 'created' order by created_at;
$$;

revoke all on function public.billing_status_rank(text) from public, anon, authenticated;
revoke all on function public.billing_checkout_begin(uuid) from public, anon, authenticated;
revoke all on function public.billing_checkout_end(uuid) from public, anon, authenticated;
revoke all on function public.billing_unpaid(uuid) from public, anon, authenticated;

-- 3. Storage quota: reserve room for each upload URL, under a per-account lock. The plain check let
--    parallel uploads each pass against the same free space. A reservation outlives its upload URL
--    (Storage's signed upload URLs last 2 hours); one whose file has arrived stops counting, since the
--    file itself counts then, and re-asking for the same file (a retry, or a replacement) replaces its
--    reservation instead of adding. The size is the client's claim, so a file that arrives bigger than
--    its reservation is listed by storage_oversized for the function to remove, and an account has at
--    most 20 reservations waiting for their files.
create table public.storage_reservations (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket_id text not null,
  name text not null, -- the object's name: '<user id>/<file>'
  size bigint not null,
  at timestamptz not null,
  primary key (bucket_id, name)
);

create index storage_reservations_user_id on public.storage_reservations (user_id);

alter table public.storage_reservations enable row level security;
revoke all on public.storage_reservations from anon, authenticated;

-- ok: the file fits the plan and its room is reserved. A file being replaced doesn't count against itself.
create function public.storage_reserve(p_user uuid, p_bucket text, p_name text, p_size bigint)
returns table (ok boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_used bigint;
  v_lim bigint;
begin
  perform pg_advisory_xact_lock(hashtext('storage:' || p_user::text));
  delete from public.storage_reservations r where r.user_id = p_user and r.at < now() - interval '2 hours 15 minutes';
  select coalesce(p.storage_bytes, f.storage_bytes) into v_lim
  from public.plans f
  left join public.account_plans a on a.user_id = p_user
  left join public.plans p on p.id = a.plan
  where f.id = 'free';
  select
    coalesce((
      select sum((o.metadata ->> 'size')::bigint)
      from storage.objects o
      where o.bucket_id in ('audio', 'images') and o.name like p_user::text || '/%'
        and not (o.bucket_id = p_bucket and o.name = p_name)
    ), 0)
    + coalesce((
      select sum(r.size)
      from public.storage_reservations r
      where r.user_id = p_user
        and not (r.bucket_id = p_bucket and r.name = p_name)
        and not exists (select 1 from storage.objects o where o.bucket_id = r.bucket_id and o.name = r.name)
    ), 0)
  into v_used;
  if v_used + p_size > v_lim
    or (select count(*) from public.storage_reservations r
        where r.user_id = p_user
          and not (r.bucket_id = p_bucket and r.name = p_name)
          and not exists (select 1 from storage.objects o where o.bucket_id = r.bucket_id and o.name = r.name)) >= 20 then
    return query select false;
    return;
  end if;
  insert into public.storage_reservations (user_id, bucket_id, name, size, at)
  values (p_user, p_bucket, p_name, p_size, now())
  on conflict (bucket_id, name) do update set size = excluded.size, at = excluded.at
    where public.storage_reservations.user_id = excluded.user_id;
  return query select true;
end;
$$;

revoke all on function public.storage_reserve(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.storage_reserve(uuid, text, text, bigint) to service_role;

-- Files of the account that arrived bigger than the size their upload URL was given for: the client
-- under-claimed, so the function removes them (the app itself always claims the real size).
create function public.storage_oversized(p_user uuid)
returns table (bucket_id text, name text)
language sql
stable
set search_path = ''
as $$
  select o.bucket_id, o.name
  from public.storage_reservations r
  join storage.objects o on o.bucket_id = r.bucket_id and o.name = r.name
  -- written after its reservation: the upload it was given for, not an older copy it replaces
  where r.user_id = p_user and o.updated_at >= r.at and (o.metadata ->> 'size')::bigint > r.size;
$$;

revoke all on function public.storage_oversized(uuid) from public, anon, authenticated;
grant execute on function public.storage_oversized(uuid) to service_role;
