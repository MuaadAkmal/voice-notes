-- On equal event times, only the start of a subscription's life and its end are ordered. Active, pending,
-- paused and halted go both ways (a retried charge that succeeds takes pending or halted back to active),
-- so between them the save that arrives last stays. The webhook now saves the subscription as Razorpay
-- has it when the event comes in, stamped to the millisecond, so a tie here is rare.
create or replace function public.billing_status_rank(p_status text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'created' then 0
    when 'authenticated' then 1
    when 'active' then 2
    when 'pending' then 2
    when 'paused' then 2
    when 'halted' then 2
    else 3 -- cancelled, completed, expired: final
  end;
$$;

revoke all on function public.billing_status_rank(text) from public, anon, authenticated;
