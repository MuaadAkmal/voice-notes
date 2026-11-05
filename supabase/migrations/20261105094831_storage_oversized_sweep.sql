-- Files that arrive bigger than their upload was reserved for were only removed on the account's next
-- upload or push, so a client that under-claimed and went quiet kept them. A scheduled job
-- (*_storage_sweep_job.sql) now asks the `sync` function to remove them, every account at once, and
-- lapsed reservations go only once no oversized file needs them to be found.

-- Reservations past every upload URL they were given for (2 hours) and not needed to find an oversized
-- file. p_user null: every account.
create function public.storage_prune_reservations(p_user uuid)
returns void
language sql
set search_path = ''
as $$
  delete from public.storage_reservations r
  where (p_user is null or r.user_id = p_user)
    and r.at < now() - interval '2 hours 15 minutes'
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = r.bucket_id and o.name = r.name
        and o.updated_at >= r.at and (o.metadata ->> 'size')::bigint > r.size
    );
$$;

revoke all on function public.storage_prune_reservations(uuid) from public, anon, authenticated;

-- p_user null: every account's (the scheduled sweep).
create or replace function public.storage_oversized(p_user uuid)
returns table (bucket_id text, name text)
language sql
stable
set search_path = ''
as $$
  select o.bucket_id, o.name
  from public.storage_reservations r
  join storage.objects o on o.bucket_id = r.bucket_id and o.name = r.name
  -- written after its reservation: the upload it was given for, not an older copy it replaces
  where (p_user is null or r.user_id = p_user)
    and o.updated_at >= r.at and (o.metadata ->> 'size')::bigint > r.size;
$$;

-- As before, but lapsed reservations go through storage_prune_reservations.
create or replace function public.storage_reserve(p_user uuid, p_bucket text, p_name text, p_size bigint)
returns table (ok boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_used bigint;
  v_lim bigint;
begin
  perform pg_advisory_xact_lock(hashtext('storage:' || p_user::text));
  perform public.storage_prune_reservations(p_user);
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
