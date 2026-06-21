-- Additive operational timeline for the receiving-only Meta WhatsApp inbox.
-- Events are internal coordination records, never outbound WhatsApp messages.

create table if not exists public.opps_conversation_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.opps_conversations(id) on delete cascade,
  message_id uuid references public.opps_messages(id) on delete set null,
  tenant_id uuid references public.tenants(id) on delete set null,
  event_type text not null check (event_type in ('draft_reply', 'system_event', 'assignment_event', 'status_event', 'link_event', 'read_event')),
  body text,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_opps_conversation_events_conversation_created
  on public.opps_conversation_events(conversation_id, created_at asc);

alter table public.opps_conversation_events enable row level security;

drop policy if exists opps_admin_read_conversation_events on public.opps_conversation_events;
create policy opps_admin_read_conversation_events on public.opps_conversation_events
  for select to authenticated using (public.is_app_admin());

drop policy if exists opps_admin_manage_conversation_events on public.opps_conversation_events;
create policy opps_admin_manage_conversation_events on public.opps_conversation_events
  for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());

-- TODO: introduce department-scoped policies only after role ownership and finance privacy rules are agreed.
