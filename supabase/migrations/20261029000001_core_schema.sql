-- Satuu AI shared inbox: core schema.
-- Supabase is the single source of truth for conversation state and messages.

create extension if not exists pgcrypto with schema extensions;

create table public.businesses (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  -- Heartbeats written by the n8n-facing functions; the dashboard uses them to
  -- show whether n8n is actually calling us ("Не подключено" otherwise).
  last_ai_check_at timestamptz,
  last_ingest_at   timestamptz,
  created_at       timestamptz not null default now()
);

-- Who may see a business. Rows are created only by the owner provisioning
-- script (service role). There is no INSERT policy, so users cannot add themselves.
create table public.business_memberships (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null default 'owner' check (role in ('owner')),
  created_at  timestamptz not null default now(),
  unique (business_id, user_id)
);
create index business_memberships_user_idx on public.business_memberships (user_id);

-- Keys for n8n. Only the SHA-256 hash is stored; the key maps to one business.
create table public.integration_keys (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  label       text not null,
  key_hash    text not null unique,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

create table public.contacts (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  wa_id        text not null check (length(wa_id) between 3 and 64),
  display_name text,
  created_at   timestamptz not null default now(),
  unique (business_id, wa_id),
  unique (id, business_id)
);

create table public.conversations (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null,
  contact_id           uuid not null,
  state                text not null default 'ai_active'
                         check (state in ('ai_active', 'human_requested', 'human_handling')),
  -- Incremented on every state change. n8n compares it between its two
  -- permission checks to detect that a takeover happened in between.
  state_version        integer not null default 1,
  state_updated_at     timestamptz not null default now(),
  state_updated_by     uuid references auth.users (id) on delete set null,
  state_note           text,
  last_inbound_at      timestamptz,
  last_message_at      timestamptz,
  last_message_preview text,
  manager_last_read_at timestamptz,
  created_at           timestamptz not null default now(),
  unique (business_id, contact_id),
  unique (id, business_id),
  foreign key (contact_id, business_id) references public.contacts (id, business_id) on delete cascade
);
create index conversations_activity_idx on public.conversations (business_id, last_message_at desc nulls last);

create table public.messages (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null,
  conversation_id     uuid not null,
  provider_message_id text,
  idempotency_key     text,
  sender_role         text not null check (sender_role in ('customer', 'ai', 'manager')),
  sender_user_id      uuid references auth.users (id) on delete set null,
  direction           text not null check (direction in ('inbound', 'outbound')),
  message_type        text not null default 'text',
  body                text not null default '',
  is_placeholder      boolean not null default false,
  template_name       text,
  message_timestamp   timestamptz not null default now(),
  status              text not null
                        check (status in ('received', 'pending', 'accepted', 'sent', 'delivered', 'read', 'failed')),
  status_updated_at   timestamptz not null default now(),
  error_code          text,
  error_message       text,
  created_at          timestamptz not null default now(),
  foreign key (conversation_id, business_id) references public.conversations (id, business_id) on delete cascade,
  constraint messages_role_matches_direction check ((sender_role = 'customer') = (direction = 'inbound')),
  constraint messages_inbound_status check (direction = 'outbound' or status = 'received'),
  -- WhatsApp message IDs: a duplicate event can never create a second row.
  -- (NULLs are distinct, so pending manager messages without an ID are fine.)
  constraint messages_provider_id_unique unique (business_id, provider_message_id),
  constraint messages_idempotency_unique unique (business_id, idempotency_key)
);
create index messages_conversation_idx on public.messages (conversation_id, message_timestamp);

-- Status receipts that arrived before the message row exists (WhatsApp can
-- deliver a status webhook faster than we record the send). Replayed on insert.
create table public.status_events (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  provider_message_id text not null,
  status              text not null check (status in ('accepted', 'sent', 'delivered', 'read', 'failed')),
  event_ts            timestamptz,
  error_code          text,
  error_message       text,
  created_at          timestamptz not null default now(),
  unique (business_id, provider_message_id, status)
);

alter publication supabase_realtime add table public.conversations, public.messages, public.contacts;
