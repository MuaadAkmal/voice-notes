-- Every 10 minutes: drop lapsed reservations, and while any account has a file that arrived bigger than
-- claimed, ask the `sync` function to remove them (only Storage's API can delete a file). The call
-- carries a key made here and kept in the vault, which the function reads to check it; it is never in
-- the repo. Production only: the unit tests' Postgres has no pg_cron, pg_net or vault.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'storage_sweep_key',
  'Sent by the storage-oversized-sweep cron job to sync/sweep');

select cron.schedule('storage-oversized-sweep', '*/10 * * * *', $job$
  select public.storage_prune_reservations(null);
  select net.http_post(
    url := 'https://tpadlhyraittxehfvshc.supabase.co/functions/v1/sync/sweep',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-sweep-key', (select decrypted_secret from vault.decrypted_secrets where name = 'storage_sweep_key')
    ),
    body := '{}'::jsonb
  )
  where exists (select 1 from public.storage_oversized(null));
$job$);
