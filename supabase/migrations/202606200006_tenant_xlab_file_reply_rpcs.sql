-- Tenant-scope the X LAB file library and internal reply security-definer RPCs.

create or replace function public.get_internal_client_file_library(
  p_client_email text,
  p_limit int default 80
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_email text := lower(trim(coalesce(p_client_email, '')));
  safe_limit int := least(greatest(coalesce(p_limit, 80), 1), 200);
begin
  if not public.can_manage_internal_client_requests() then
    raise exception 'Not authorised to view client files.';
  end if;
  if clean_email = '' then
    return jsonb_build_object('folders', '[]'::jsonb, 'files', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'folders', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.created_at asc)
      from public.client_file_folders f
      where lower(trim(f.client_email)) = clean_email
        and f.tenant_id in (select public.current_user_tenant_ids())
    ), '[]'::jsonb),
    'files', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at desc)
      from (
        select * from public.client_file_links l
        where lower(trim(l.client_email)) = clean_email
          and l.tenant_id in (select public.current_user_tenant_ids())
        order by l.created_at desc limit safe_limit
      ) l
    ), '[]'::jsonb)
  );
end;
$$;

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
  if not public.can_manage_internal_client_requests() then raise exception 'Not authorised to reply to client messages.'; end if;
  if clean_email = '' or length(clean_message) < 2 then raise exception 'Client email and reply message are required.'; end if;

  select * into client_row from public.clients c
  where lower(trim(coalesce(c.email, ''))) = clean_email
    and c.tenant_id in (select public.current_user_tenant_ids())
  order by c.updated_at desc nulls last, c.created_at desc nulls last limit 1;
  if client_row.id is null then raise exception 'Client was not found in your tenant.'; end if;

  insert into public.client_messages (client_id, client_email, subject, message, sender_type, is_internal, status, source_app, tenant_id)
  values (client_row.id, clean_email, coalesce(clean_subject, 'Joint X reply'), left(clean_message, 8000), 'team', false, 'new', 'opps', client_row.tenant_id)
  returning * into reply_row;

  if p_parent_message_id is not null then
    update public.client_messages set status = 'actioned'
    where id = p_parent_message_id and tenant_id = client_row.tenant_id
      and lower(trim(client_email)) = clean_email and coalesce(is_internal, false) = false;
  end if;
  return jsonb_build_object('reply', to_jsonb(reply_row));
end;
$$;
