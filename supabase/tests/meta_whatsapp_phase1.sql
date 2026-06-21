-- Verification checks for 202606210009_meta_whatsapp_phase1.sql.
-- Run after the migration in a Supabase SQL environment.

do $$
begin
  if to_regclass('public.opps_conversations') is null then
    raise exception 'opps_conversations table is missing';
  end if;
  if to_regclass('public.opps_messages') is null then
    raise exception 'opps_messages table is missing';
  end if;
  if to_regclass('public.opps_message_intelligence') is null then
    raise exception 'opps_message_intelligence table is missing';
  end if;
  if to_regclass('public.opps_agent_logs') is null then
    raise exception 'opps_agent_logs table is missing';
  end if;
  if to_regclass('public.opps_message_attachments') is null then
    raise exception 'opps_message_attachments table is missing';
  end if;
end;
$$;

select public.upsert_opps_conversation(null, '27820001111', '+27 82 000 1111', 'Demo Client', 'whatsapp');

with conversation as (
  select public.upsert_opps_conversation(null, '27820001111', '+27 82 000 1111', 'Demo Client', 'whatsapp') as conversation_row
), inserted_message as (
  insert into public.opps_messages (
    conversation_id,
    channel,
    direction,
    meta_message_id,
    wa_id,
    phone,
    message_type,
    body,
    raw_payload,
    received_at
  )
  select
    (conversation_row).id,
    'whatsapp',
    'inbound',
    'wamid.test-1',
    '27820001111',
    '+27820001111',
    'text',
    'Need a quote for 50 shirts',
    jsonb_build_object('text', jsonb_build_object('body', 'Need a quote for 50 shirts')),
    now()
  from conversation
  returning *
), inserted_intelligence as (
  insert into public.opps_message_intelligence (
    message_id,
    conversation_id,
    intent,
    sentiment,
    risk_level,
    suggested_department,
    suggested_next_action,
    summary
  )
  select
    inserted_message.id,
    inserted_message.conversation_id,
    'quote_request',
    'neutral',
    'normal',
    'support',
    'Route to quotes review and confirm scope.',
    'Need a quote for 50 shirts'
  from inserted_message
  returning *
), inserted_log as (
  insert into public.opps_agent_logs (
    source,
    event_type,
    status,
    message_id,
    conversation_id,
    details
  )
  select
    'meta_whatsapp_webhook',
    'message_received',
    'success',
    inserted_message.id,
    inserted_message.conversation_id,
    jsonb_build_object('verified', true)
  from inserted_message
  returning *
)
select
  (select count(*) from inserted_message) as message_rows,
  (select count(*) from inserted_intelligence) as intelligence_rows,
  (select count(*) from inserted_log) as log_rows;

select count(*) = 0 as outbound_send_missing
from pg_proc
where proname ilike '%whatsapp%send%';
