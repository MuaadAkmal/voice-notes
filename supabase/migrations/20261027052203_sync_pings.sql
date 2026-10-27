-- Sync pings (C3): after a push, the `sync` Edge Function broadcasts on the private topic sync:<user_id>
-- (realtime.send, as its DB role) so the account's other running PCs sync now. No content travels.
-- Users may only listen to their own topic. Deliberately no insert policy: no app can send pings.
create policy "listen to own sync channel" on realtime.messages
for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (select realtime.topic()) = 'sync:' || (select auth.uid())::text
);
