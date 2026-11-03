-- Paid plans: what each plan allows. Free: 30 min of Cloud transcription a month and 250 MB; Standard
-- 5 h and 5 GB; Pro 10 h and 20 GB. Who has which plan stays in `account_plans` (no row = free), which
-- the `billing` function will write from Razorpay's webhooks.

alter table public.plans
  add column storage_bytes bigint not null default 262144000 check (storage_bytes >= 0);

update public.plans set monthly_seconds = 1800, storage_bytes = 262144000 where id = 'free';

insert into public.plans (id, monthly_seconds, storage_bytes) values
  ('standard', 18000, 5368709120),
  ('pro', 36000, 21474836480)
on conflict (id) do update
  set monthly_seconds = excluded.monthly_seconds, storage_bytes = excluded.storage_bytes;

-- Bytes of synced audio and images an account holds, read from Storage's own object sizes, so there
-- is no counter to drift. Paths are `<user_id>/<name>` (see *_sync_files.sql).
create function public.storage_usage_for(p_user uuid)
returns table (used bigint, lim bigint, plan text)
language sql
stable
set search_path = ''
as $$
  select
    coalesce((
      select sum((o.metadata ->> 'size')::bigint)
      from storage.objects o
      where o.bucket_id in ('audio', 'images') and o.name like p_user::text || '/%'
    ), 0)::bigint,
    coalesce(p.storage_bytes, f.storage_bytes),
    coalesce(p.id, 'free')
  from public.plans f
  left join public.account_plans a on a.user_id = p_user
  left join public.plans p on p.id = a.plan
  where f.id = 'free';
$$;

revoke all on function public.storage_usage_for(uuid) from public, anon, authenticated;
grant execute on function public.storage_usage_for(uuid) to service_role;
