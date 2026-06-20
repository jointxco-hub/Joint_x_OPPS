-- Wrap legacy X LAB request RPCs with tenant-scoped gates.

alter function public.get_internal_client_requests(text, text, text, text, int)
  rename to get_internal_client_requests_unscoped;
alter function public.update_internal_client_request_status(text, uuid, text)
  rename to update_internal_client_request_status_unscoped;

create function public.get_internal_client_requests(
  p_type text default null, p_status text default null, p_source_app text default null,
  p_search text default null, p_limit int default 50
)
returns table (id uuid, request_type text, status text, client_id uuid, client_email text, client_name text, source_app text, created_at timestamptz, preview text, payload jsonb)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_manage_internal_client_requests() then raise exception 'Not authorised to view client requests.'; end if;
  return query
  select request.*
  from public.get_internal_client_requests_unscoped(p_type, p_status, p_source_app, p_search, p_limit) request
  join public.clients client on client.id = request.client_id
  where client.tenant_id in (select public.current_user_tenant_ids());
end;
$$;

create function public.update_internal_client_request_status(p_type text, p_id uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare clean_type text := lower(trim(coalesce(p_type, ''))); allowed boolean := false;
begin
  if not public.can_manage_internal_client_requests() then raise exception 'Not authorised to update client requests.'; end if;
  if clean_type in ('quote_request', 'reorder_request') then
    select exists(select 1 from public.client_quote_requests r where r.id = p_id and r.tenant_id in (select public.current_user_tenant_ids())) into allowed;
  elsif clean_type = 'message' then
    select exists(select 1 from public.client_messages r where r.id = p_id and r.tenant_id in (select public.current_user_tenant_ids())) into allowed;
  elsif clean_type = 'profile_update' then
    select exists(select 1 from public.client_profile_requests r where r.id = p_id and r.tenant_id in (select public.current_user_tenant_ids())) into allowed;
  elsif clean_type = 'special_instruction' then
    select exists(select 1 from public.client_special_instructions r join public.clients c on c.id = r.client_id where r.id = p_id and c.tenant_id in (select public.current_user_tenant_ids())) into allowed;
  elsif clean_type = 'tech_pack' then
    select exists(select 1 from public.client_tech_packs r join public.clients c on c.id = r.client_id where r.id = p_id and c.tenant_id in (select public.current_user_tenant_ids())) into allowed;
  end if;
  if not allowed then raise exception 'Request was not found in your tenant.'; end if;
  return public.update_internal_client_request_status_unscoped(p_type, p_id, p_status);
end;
$$;

grant execute on function public.get_internal_client_requests(text, text, text, text, int) to authenticated;
grant execute on function public.update_internal_client_request_status(text, uuid, text) to authenticated;
revoke execute on function public.get_internal_client_requests_unscoped(text, text, text, text, int) from authenticated, anon;
revoke execute on function public.update_internal_client_request_status_unscoped(text, uuid, text) from authenticated, anon;
