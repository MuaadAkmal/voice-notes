-- Connectors: a Google Calendar connection per account. Only the `connectors` Edge Function touches these
-- tables, through its direct database connection: RLS is on with no policies, and the Data API roles
-- have no grants. The refresh token is encrypted by the function (AES-GCM, key in CONNECTORS_KEY).

create table public.connectors (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google-calendar')),
  account_email text not null, -- the Google account that consented (may differ from the sign-in email)
  refresh_token text not null, -- base64(iv || ciphertext)
  scopes text not null,
  connected_at timestamptz not null default now(),
  primary key (user_id, provider)
);

-- One-time states for the consent round trip: the callback carries no token, the state says whose it is.
create table public.connector_states (
  state text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  expires_at timestamptz not null
);
create index connector_states_expires on public.connector_states (expires_at);

alter table public.connectors enable row level security;
alter table public.connector_states enable row level security;

revoke all on public.connectors, public.connector_states from anon, authenticated;
