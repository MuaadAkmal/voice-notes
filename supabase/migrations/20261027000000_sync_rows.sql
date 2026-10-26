-- Sync rows (piece C1): the server side of two-PC sync. Only the `sync` Edge Function touches these
-- tables, through its direct database connection: RLS is on with no policies, and the Data API roles
-- have no grants, so nothing here is reachable from a client key.

create table public.sync_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  version bigint not null default 0
);

create table public.sync_rows (
  user_id uuid not null references auth.users (id) on delete cascade,
  entity text not null check (entity in ('note', 'page', 'folder')),
  id text not null,
  version bigint not null,
  deleted boolean not null default false,
  data jsonb not null, -- kept for deleted folders (re-homing), never pulled
  primary key (user_id, entity, id)
);
create index sync_rows_user_version on public.sync_rows (user_id, version);
create index sync_rows_user_folder on public.sync_rows (user_id, (data ->> 'folderId'));
create index sync_rows_user_parent on public.sync_rows (user_id, (data ->> 'parentId'));

create table public.sync_prefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  value jsonb,
  version bigint not null,
  primary key (user_id, key)
);
create index sync_prefs_user_version on public.sync_prefs (user_id, version);

create table public.sync_seen (
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  mutation_id text not null,
  version bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, client_id, mutation_id)
);
create index sync_seen_user_created on public.sync_seen (user_id, created_at);

create table public.sync_body_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  page_id text not null,
  version bigint not null,
  client_id text not null,
  device_name text not null,
  op jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, page_id, version)
);
create index sync_body_log_user_created on public.sync_body_log (user_id, created_at);

alter table public.sync_accounts enable row level security;
alter table public.sync_rows enable row level security;
alter table public.sync_prefs enable row level security;
alter table public.sync_seen enable row level security;
alter table public.sync_body_log enable row level security;

revoke all on public.sync_accounts, public.sync_rows, public.sync_prefs, public.sync_seen, public.sync_body_log
  from anon, authenticated;
