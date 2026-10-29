-- The loopback port of the app that started a consent round trip. Google's redirect then goes on to
-- http://127.0.0.1:<port>/connectors/done, a page the app serves (Edge Functions on *.supabase.co serve
-- HTML as text/plain). Null: an older app, or the app couldn't listen; the function answers plain text.
alter table public.connector_states add column return_port int;
