-- Additive inbox actions for Meta WhatsApp.
-- This migration only adds the inbox-only schema needed after Phase 1.

alter table if exists public.opps_conversations
  add column if not exists assigned_department text;

create table if not exists public.opps_conversation_notes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.opps_conversations(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  note_type text not null default 'internal',
  note text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_opps_conversations_assigned_department
  on public.opps_conversations(assigned_department)
  where assigned_department is not null;

create index if not exists idx_opps_conversation_notes_conversation_id
  on public.opps_conversation_notes(conversation_id);

create index if not exists idx_opps_conversation_notes_created_at
  on public.opps_conversation_notes(created_at desc);

create or replace function public.opps_whatsapp_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_opps_conversation_notes_updated_at on public.opps_conversation_notes;
create trigger trg_opps_conversation_notes_updated_at
  before update on public.opps_conversation_notes
  for each row execute function public.opps_whatsapp_touch_updated_at();

alter table if exists public.opps_conversation_notes enable row level security;

drop policy if exists opps_admin_read_conversation_notes on public.opps_conversation_notes;
create policy opps_admin_read_conversation_notes on public.opps_conversation_notes
  for select to authenticated
  using (public.is_app_admin());

drop policy if exists opps_admin_manage_conversation_notes on public.opps_conversation_notes;
create policy opps_admin_manage_conversation_notes on public.opps_conversation_notes
  for all to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());
