-- rls_auto_enable() is the event trigger that turns RLS on for new public tables; it is never an API call.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
