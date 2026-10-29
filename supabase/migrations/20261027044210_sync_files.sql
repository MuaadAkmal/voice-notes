-- Synced files (C2): audio of voice notes and page images, one folder per account (<user_id>/<name>).
-- Deliberately no policies on storage.objects for these buckets: apps never touch them directly.
-- The `sync` Edge Function (service role) checks ownership and hands out 2-minute signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('audio', 'audio', false, 52428800, '{audio/webm}'),
  ('images', 'images', false, 20971520, '{image/png,image/jpeg,image/gif,image/webp}')
on conflict (id) do nothing;
