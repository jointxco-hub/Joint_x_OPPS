-- Phase 1 Meta WhatsApp receiving-only foundation.
-- Additive only: no outbound messaging, no checkout/payment/order writes.

create table if not exists public.opps_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  channel text not null default 'whatsapp',
  wa_id text,
  phone text,
  display_name text,
  linked_client_id uuid,
  linked_order_id uuid,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count integer not null default 0,
  status text not null default 'open' check (status in ('open', 'closed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.opps_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.opps_conversations(id) on delete cascade,
  channel text not null default 'whatsapp',
  direction text not null check (direction in ('inbound', 'outbound', 'status', 'system')),
  meta_message_id text,
  wa_id text,
  phone text,
  message_type text,
  body text,
  raw_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.opps_message_intelligence (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.opps_messages(id) on delete cascade,
  conversation_id uuid not null references public.opps_conversations(id) on delete cascade,
  intent text,
  sentiment text,
  risk_level text not null default 'normal' check (risk_level in ('normal', 'high')),
  suggested_department text,
  suggested_next_action text,
  summary text,
  created_at timestamptz not null default now()
);

create table if not exists public.opps_agent_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'meta_whatsapp_webhook',
  event_type text,
  status text,
  message_id uuid,
  conversation_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.opps_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.opps_messages(id) on delete cascade,
  conversation_id uuid not null references public.opps_conversations(id) on delete cascade,
  media_id text,
  mime_type text,
  sha256 text,
  filename text,
  caption text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.opps_message_order_links (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.opps_messages(id) on delete cascade,
  conversation_id uuid not null references public.opps_conversations(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.opps_daily_activity_signals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  signal_date date not null default current_date,
  signal_key text not null,
  signal_value integer not null default 0,
  source text not null default 'meta_whatsapp_webhook',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, signal_date, signal_key)
);

create index if not exists idx_opps_conversations_wa_id on public.opps_conversations(wa_id) where wa_id is not null;
create index if not exists idx_opps_conversations_phone on public.opps_conversations(phone) where phone is not null;
create index if not exists idx_opps_conversations_last_message_at on public.opps_conversations(last_message_at desc nulls last);
create index if not exists idx_opps_conversations_updated_at on public.opps_conversations(updated_at desc);

create index if not exists idx_opps_messages_meta_message_id on public.opps_messages(meta_message_id) where meta_message_id is not null;
create index if not exists idx_opps_messages_conversation_id on public.opps_messages(conversation_id);
create index if not exists idx_opps_messages_created_at on public.opps_messages(created_at desc);
create index if not exists idx_opps_messages_received_at on public.opps_messages(received_at desc nulls last);

create index if not exists idx_opps_message_intelligence_conversation_id on public.opps_message_intelligence(conversation_id);
create index if not exists idx_opps_message_attachments_conversation_id on public.opps_message_attachments(conversation_id);
create index if not exists idx_opps_message_attachments_created_at on public.opps_message_attachments(created_at desc);
create index if not exists idx_opps_agent_logs_conversation_id on public.opps_agent_logs(conversation_id);
create index if not exists idx_opps_agent_logs_created_at on public.opps_agent_logs(created_at desc);
create index if not exists idx_opps_daily_activity_signals_created_at on public.opps_daily_activity_signals(created_at desc);

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

drop trigger if exists trg_opps_conversations_updated_at on public.opps_conversations;
create trigger trg_opps_conversations_updated_at
  before update on public.opps_conversations
  for each row execute function public.opps_whatsapp_touch_updated_at();

drop trigger if exists trg_opps_daily_activity_signals_updated_at on public.opps_daily_activity_signals;
create trigger trg_opps_daily_activity_signals_updated_at
  before update on public.opps_daily_activity_signals
  for each row execute function public.opps_whatsapp_touch_updated_at();

alter table public.opps_conversations enable row level security;
alter table public.opps_messages enable row level security;
alter table public.opps_message_intelligence enable row level security;
alter table public.opps_agent_logs enable row level security;
alter table public.opps_message_attachments enable row level security;
alter table public.opps_message_order_links enable row level security;
alter table public.opps_daily_activity_signals enable row level security;

drop policy if exists opps_admin_read_conversations on public.opps_conversations;
create policy opps_admin_read_conversations on public.opps_conversations
  for select to authenticated
  using (public.is_app_admin());

drop policy if exists opps_admin_manage_conversations on public.opps_conversations;
create policy opps_admin_manage_conversations on public.opps_conversations
  for all to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists opps_admin_read_messages on public.opps_messages;
create policy opps_admin_read_messages on public.opps_messages
  for select to authenticated
  using (public.is_app_admin());

drop policy if exists opps_admin_manage_messages on public.opps_messages;
create policy opps_admin_manage_messages on public.opps_messages
  for all to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists opps_admin_read_message_intelligence on public.opps_message_intelligence;
create policy opps_admin_read_message_intelligence on public.opps_message_intelligence
  for select to authenticated
  using (public.is_app_admin());

drop policy if exists opps_admin_manage_message_intelligence on public.opps_message_intelligence;
create policy opps_admin_manage_message_intelligence on public.opps_message_intelligence
  for all to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists opps_admin_read_agent_logs on public.opps_agent_logs;
create policy opps_admin_read_agent_logs on public.opps_agent_logs
  for select to authenticated
  using (public.is_app_admin());

drop policy if exists opps_admin_manage_agent_logs on public.opps_agent_logs;
create policy opps_admin_manage_agent_logs on public.opps_agent_logs
  for all to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists opps_admin_read_message_attachments on public.opps_message_attachments;
create policy opps_admin_read_message_attachments on public.opps_message_attachments
  for select to authenticated
  using (public.is_app_admin());

drop policy if exists opps_admin_manage_message_attachments on public.opps_message_attachments;
create policy opps_admin_manage_message_attachments on public.opps_message_attachments
  for all to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists opps_admin_read_message_order_links on public.opps_message_order_links;
create policy opps_admin_read_message_order_links on public.opps_message_order_links
  for select to authenticated
  using (public.is_app_admin());

drop policy if exists opps_admin_manage_message_order_links on public.opps_message_order_links;
create policy opps_admin_manage_message_order_links on public.opps_message_order_links
  for all to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists opps_admin_read_daily_activity_signals on public.opps_daily_activity_signals;
create policy opps_admin_read_daily_activity_signals on public.opps_daily_activity_signals
  for select to authenticated
  using (public.is_app_admin());

drop policy if exists opps_admin_manage_daily_activity_signals on public.opps_daily_activity_signals;
create policy opps_admin_manage_daily_activity_signals on public.opps_daily_activity_signals
  for all to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

create or replace function public.normalize_opps_whatsapp_phone(p_value text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  cleaned text := regexp_replace(lower(trim(coalesce(p_value, ''))), '[^0-9+]', '', 'g');
begin
  if cleaned = '' then
    return null;
  end if;

  return cleaned;
end;
$$;

create or replace function public.upsert_opps_conversation(
  p_tenant_id uuid,
  p_wa_id text,
  p_phone text,
  p_display_name text default null,
  p_channel text default 'whatsapp'
)
returns public.opps_conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.opps_conversations;
  v_phone text := public.normalize_opps_whatsapp_phone(p_phone);
begin
  select *
  into v_conversation
  from public.opps_conversations conversation
  where (p_wa_id is not null and conversation.wa_id = p_wa_id)
     or (v_phone is not null and conversation.phone = v_phone)
  order by conversation.updated_at desc nulls last
  limit 1;

  if found then
    update public.opps_conversations
    set tenant_id = coalesce(tenant_id, p_tenant_id),
        wa_id = coalesce(wa_id, p_wa_id),
        phone = coalesce(phone, v_phone),
        display_name = coalesce(nullif(p_display_name, ''), display_name),
        channel = coalesce(p_channel, channel),
        updated_at = now()
    where id = v_conversation.id
    returning * into v_conversation;
    return v_conversation;
  end if;

  insert into public.opps_conversations (tenant_id, wa_id, phone, display_name, channel)
  values (p_tenant_id, p_wa_id, v_phone, nullif(p_display_name, ''), coalesce(p_channel, 'whatsapp'))
  returning * into v_conversation;

  return v_conversation;
end;
$$;

grant execute on function public.normalize_opps_whatsapp_phone(text) to authenticated;
grant execute on function public.upsert_opps_conversation(uuid, text, text, text, text) to authenticated;
revoke execute on function public.normalize_opps_whatsapp_phone(text) from anon;
revoke execute on function public.upsert_opps_conversation(uuid, text, text, text, text) from anon;

grant execute on function public.upsert_opps_conversation(uuid, text, text, text, text) to service_role;
revoke execute on function public.normalize_opps_whatsapp_phone(text) from service_role;
