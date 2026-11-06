-- Polished audio and voice cloning.
--
-- 1. One cloned voice per account (ElevenLabs voice id), kept so the clone can be replaced or removed
--    and the account's clones counted against the VOICE_CLONE_LIMIT secret. Only the functions below
--    (service role) touch it.
-- 2. The audio bucket takes MP3 as well as WebM: polished audio is `<note id>.polished.mp3`.

create table public.voice_clones (
  user_id uuid primary key references auth.users (id) on delete cascade,
  voice_id text not null,
  created_at timestamptz not null default now()
);

alter table public.voice_clones enable row level security;
revoke all on public.voice_clones from anon, authenticated;

create function public.voice_clone_get(p_user uuid)
returns table (voice_id text)
language sql
stable
set search_path = ''
as $$
  select c.voice_id from public.voice_clones c where c.user_id = p_user;
$$;

-- All accounts' clones: the cap is on the whole service, since each one is a paid slot at ElevenLabs.
create function public.voice_clone_count()
returns table (n int)
language sql
stable
set search_path = ''
as $$
  select count(*)::int from public.voice_clones;
$$;

-- Saves the account's clone; old_voice_id is the one it replaced (for the caller to delete at ElevenLabs), or null.
create function public.voice_clone_put(p_user uuid, p_voice_id text)
returns table (old_voice_id text)
language plpgsql
set search_path = ''
as $$
declare
  v_old text;
begin
  perform pg_advisory_xact_lock(hashtext('voice_clone:' || p_user::text));
  select c.voice_id into v_old from public.voice_clones c where c.user_id = p_user;
  insert into public.voice_clones as c (user_id, voice_id) values (p_user, p_voice_id)
  on conflict (user_id) do update set voice_id = excluded.voice_id, created_at = now();
  return query select v_old;
end;
$$;

-- Removes the account's clone and says which voice it was; nothing when there was none.
create function public.voice_clone_delete(p_user uuid)
returns table (voice_id text)
language sql
set search_path = ''
as $$
  delete from public.voice_clones c where c.user_id = p_user returning c.voice_id;
$$;

revoke all on function public.voice_clone_get(uuid) from public, anon, authenticated;
revoke all on function public.voice_clone_count() from public, anon, authenticated;
revoke all on function public.voice_clone_put(uuid, text) from public, anon, authenticated;
revoke all on function public.voice_clone_delete(uuid) from public, anon, authenticated;
grant execute on function public.voice_clone_get(uuid) to service_role;
grant execute on function public.voice_clone_count() to service_role;
grant execute on function public.voice_clone_put(uuid, text) to service_role;
grant execute on function public.voice_clone_delete(uuid) to service_role;

update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'audio/mpeg')
where id = 'audio' and not ('audio/mpeg' = any(allowed_mime_types));
