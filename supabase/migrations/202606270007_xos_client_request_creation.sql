-- Phase 4D: XOS client-facing request creation.
-- Host-scoped, membership-gated, insert-only, and intentionally client-facing.

create or replace function public.create_xos_request_for_host(
  p_hostname text,
  p_title text,
  p_message text,
  p_category text default 'general',
  p_priority text default 'normal'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_tenant_id uuid;
  requester_email text := coalesce(
    nullif(lower(trim(coalesce(auth.jwt() ->> 'email', ''))), ''),
    nullif(lower(trim(coalesce(current_setting('request.jwt.claim.email', true), ''))), '')
  );
  requester_name text := nullif(trim(coalesce(auth.jwt() #>> '{user_metadata,full_name}', auth.jwt() #>> '{user_metadata,name}', '')), '');
  clean_title text := regexp_replace(trim(coalesce(p_title, '')), '[[:cntrl:]]', ' ', 'g');
  clean_message text := regexp_replace(trim(coalesce(p_message, '')), '[[:cntrl:]]', ' ', 'g');
  clean_category text := lower(regexp_replace(trim(coalesce(p_category, 'general')), '[^a-zA-Z0-9 _-]', '', 'g'));
  clean_priority text := lower(regexp_replace(trim(coalesce(p_priority, 'normal')), '[^a-zA-Z0-9_-]', '', 'g'));
  safe_details text;
  matched_client_id uuid;
  matched_client_name text;
  inserted_row public.client_quote_requests%rowtype;
begin
  select tenant_id
  into resolved_tenant_id
  from public.resolve_authenticated_tenant_host(p_hostname, 'xos_admin')
  limit 1;

  if resolved_tenant_id is null then
    raise exception 'XOS access denied.';
  end if;

  if requester_email is null then
    raise exception 'Authenticated email is required.';
  end if;

  clean_title := left(clean_title, 160);
  clean_message := left(clean_message, 2000);
  clean_category := left(nullif(clean_category, ''), 40);
  clean_priority := left(nullif(clean_priority, ''), 20);

  if clean_title is null or length(clean_title) < 3 then
    raise exception 'Request title is required.';
  end if;

  if clean_message is null or length(clean_message) < 5 then
    raise exception 'Request details are required.';
  end if;

  if clean_category is null then
    clean_category := 'general';
  end if;

  if clean_priority not in ('low', 'normal', 'high', 'urgent') then
    clean_priority := 'normal';
  end if;

  select c.id, c.name
  into matched_client_id, matched_client_name
  from public.clients c
  where c.tenant_id = resolved_tenant_id
    and lower(c.email) = requester_email
  order by c.created_at desc
  limit 1;

  safe_details := concat_ws(
    E'\n',
    'Category: ' || clean_category,
    'Priority: ' || clean_priority,
    '',
    clean_message
  );

  insert into public.client_quote_requests (
    tenant_id,
    client_id,
    client_email,
    client_name,
    project_name,
    details,
    source_app,
    status
  )
  values (
    resolved_tenant_id,
    matched_client_id,
    requester_email,
    coalesce(matched_client_name, requester_name, requester_email),
    clean_title,
    safe_details,
    'xos',
    'new'
  )
  returning * into inserted_row;

  return jsonb_build_object(
    'id', inserted_row.id,
    'title', inserted_row.project_name,
    'category', clean_category,
    'priority', clean_priority,
    'status', inserted_row.status,
    'created_at', inserted_row.created_at
  );
end;
$$;

revoke execute on function public.create_xos_request_for_host(text, text, text, text, text) from public, anon;
grant execute on function public.create_xos_request_for_host(text, text, text, text, text) to authenticated;
