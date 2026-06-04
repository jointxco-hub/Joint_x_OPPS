-- Internal OPPS replies to X LAB account messages.
-- Replies are inserted into client_messages as client-visible team messages.

create or replace function public.add_internal_client_message_reply(
  p_client_email text,
  p_subject text,
  p_message text,
  p_parent_message_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_email text := lower(trim(coalesce(p_client_email, '')));
  clean_subject text := nullif(trim(coalesce(p_subject, '')), '');
  clean_message text := trim(coalesce(p_message, ''));
  client_row public.clients;
  reply_row public.client_messages;
begin
  if not public.can_manage_internal_client_requests() then
    raise exception 'Not authorised to reply to client messages.';
  end if;

  if clean_email = '' or length(clean_message) < 2 then
    raise exception 'Client email and reply message are required.';
  end if;

  select *
  into client_row
  from public.clients c
  where lower(trim(coalesce(c.email, ''))) = clean_email
  order by c.updated_at desc nulls last, c.created_at desc nulls last
  limit 1;

  insert into public.client_messages (
    client_id,
    client_email,
    subject,
    message,
    sender_type,
    is_internal,
    status,
    source_app
  )
  values (
    client_row.id,
    clean_email,
    coalesce(clean_subject, 'Joint X reply'),
    left(clean_message, 8000),
    'team',
    false,
    'new',
    'opps'
  )
  returning * into reply_row;

  if p_parent_message_id is not null then
    update public.client_messages
    set status = 'actioned'
    where id = p_parent_message_id
      and lower(trim(client_email)) = clean_email
      and coalesce(is_internal, false) = false;
  end if;

  return jsonb_build_object('reply', to_jsonb(reply_row));
end;
$$;

grant execute on function public.add_internal_client_message_reply(text, text, text, uuid) to authenticated;
revoke execute on function public.add_internal_client_message_reply(text, text, text, uuid) from anon;
