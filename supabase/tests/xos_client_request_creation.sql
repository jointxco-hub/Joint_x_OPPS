-- Run after 202606270007_xos_client_request_creation.sql.
-- Uses disposable tenants, users, hosts, clients, and request rows.

do $$
declare
  tenant_a_id uuid;
  tenant_b_id uuid;
  tenant_a_user_id uuid := '00000000-0000-4000-8000-000000000091'::uuid;
  tenant_b_user_id uuid := '00000000-0000-4000-8000-000000000092'::uuid;
  outsider_user_id uuid := '00000000-0000-4000-8000-000000000093'::uuid;
  client_a_id uuid;
  result jsonb;
  created_id uuid;
  denied boolean;
begin
  delete from public.client_quote_requests
  where client_email in ('xos4d-a@example.test', 'xos4d-b@example.test', 'xos4d-outsider@example.test')
     or project_name like 'XOS4D%';
  delete from public.tenant_domains
  where hostname in ('xos4d-a.xos.jointx.co.za', 'xos4d-b.xos.jointx.co.za');
  delete from public.clients
  where email in ('xos4d-a@example.test', 'xos4d-b@example.test');
  delete from public.users
  where auth_user_id in (tenant_a_user_id, tenant_b_user_id, outsider_user_id)
     or user_email in ('xos4d-a@example.test', 'xos4d-b@example.test', 'xos4d-outsider@example.test');
  delete from public.tenants
  where slug in ('xos4d-a', 'xos4d-b');
  delete from auth.users
  where id in (tenant_a_user_id, tenant_b_user_id, outsider_user_id);

  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (tenant_a_user_id, 'authenticated', 'authenticated', 'xos4d-a@example.test', now(), '{}'::jsonb, jsonb_build_object('full_name', 'XOS 4D Tenant A'), now(), now()),
    (tenant_b_user_id, 'authenticated', 'authenticated', 'xos4d-b@example.test', now(), '{}'::jsonb, jsonb_build_object('full_name', 'XOS 4D Tenant B'), now(), now()),
    (outsider_user_id, 'authenticated', 'authenticated', 'xos4d-outsider@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.users (auth_user_id, user_email, full_name, role, department, is_active)
  values
    (tenant_a_user_id, 'xos4d-a@example.test', 'XOS 4D Tenant A', 'user', 'operations', true),
    (tenant_b_user_id, 'xos4d-b@example.test', 'XOS 4D Tenant B', 'user', 'operations', true),
    (outsider_user_id, 'xos4d-outsider@example.test', 'XOS 4D Outsider', 'user', 'operations', true);

  insert into public.tenants (slug, name, status)
  values
    ('xos4d-a', 'XOS 4D Tenant A', 'active'),
    ('xos4d-b', 'XOS 4D Tenant B', 'active');

  select id into tenant_a_id from public.tenants where slug = 'xos4d-a';
  select id into tenant_b_id from public.tenants where slug = 'xos4d-b';

  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values
    (tenant_a_id, tenant_a_user_id, 'member', 'active'),
    (tenant_b_id, tenant_b_user_id, 'member', 'active');

  insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary, verified_at)
  values
    (tenant_a_id, 'xos4d-a.xos.jointx.co.za', 'xos_admin', 'active', true, now()),
    (tenant_b_id, 'xos4d-b.xos.jointx.co.za', 'xos_admin', 'active', true, now());

  insert into public.clients (tenant_id, name, email, status, portal_enabled)
  values (tenant_a_id, 'XOS 4D Client A', 'xos4d-a@example.test', 'active', true)
  returning id into client_a_id;

  perform set_config('request.jwt.claim.sub', tenant_a_user_id::text, true);
  perform set_config('request.jwt.claim.email', 'xos4d-a@example.test', true);

  result := public.create_xos_request_for_host(
    'xos4d-a.xos.jointx.co.za',
    'XOS4D New Client Request',
    'Please prepare a demo request from XOS.',
    'orders',
    'high'
  );

  created_id := (result->>'id')::uuid;

  if result->>'title' <> 'XOS4D New Client Request'
    or result->>'category' <> 'orders'
    or result->>'priority' <> 'high'
    or result->>'status' <> 'new'
    or result::text like '%tenant_id%'
    or result::text like '%client_id%'
    or result::text like '%staff%'
    or result::text like '%assignment%'
    or result::text like '%internal%'
  then
    raise exception 'XOS request creation returned unsafe or incorrect payload.';
  end if;

  if not exists (
    select 1
    from public.client_quote_requests
    where id = created_id
      and tenant_id = tenant_a_id
      and client_id = client_a_id
      and client_email = 'xos4d-a@example.test'
      and project_name = 'XOS4D New Client Request'
      and details like '%Category: orders%'
      and details like '%Priority: high%'
      and source_app = 'xos'
      and status = 'new'
  ) then
    raise exception 'XOS request was not inserted under the resolved tenant.';
  end if;

  denied := false;
  begin
    perform public.create_xos_request_for_host(
      'xos4d-b.xos.jointx.co.za',
      'XOS4D Cross Tenant Request',
      'Tenant A should not create in Tenant B.',
      'orders',
      'normal'
    );
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Tenant A created a request through Tenant B host.';
  end if;

  denied := false;
  begin
    perform public.create_xos_request_for_host(
      'xos4d-a.xos.jointx.co.za?tenant_slug=xos4d-b',
      'XOS4D Query Override',
      'Query params must not choose tenant.',
      'orders',
      'normal'
    );
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Query-param host spoofing created an XOS request.';
  end if;

  denied := false;
  begin
    perform public.create_xos_request_for_host(
      'https://xos4d-a.xos.jointx.co.za/requests',
      'XOS4D Path Override',
      'Path-like host must not choose tenant.',
      'orders',
      'normal'
    );
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Path-like host spoofing created an XOS request.';
  end if;

  denied := false;
  begin
    perform public.create_xos_request_for_host('xos4d-a.xos.jointx.co.za', '', 'Valid details', 'general', 'normal');
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Empty title was accepted.';
  end if;

  denied := false;
  begin
    perform public.create_xos_request_for_host('xos4d-a.xos.jointx.co.za', 'Valid title', '', 'general', 'normal');
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Empty message was accepted.';
  end if;

  perform set_config('request.jwt.claim.sub', outsider_user_id::text, true);
  perform set_config('request.jwt.claim.email', 'xos4d-outsider@example.test', true);

  denied := false;
  begin
    perform public.create_xos_request_for_host(
      'xos4d-a.xos.jointx.co.za',
      'XOS4D Outsider Request',
      'Outsider should not create.',
      'general',
      'normal'
    );
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Non-member created an XOS request.';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.email', '', true);

  denied := false;
  begin
    perform public.create_xos_request_for_host(
      'xos4d-a.xos.jointx.co.za',
      'XOS4D Anonymous Request',
      'Anonymous should not create.',
      'general',
      'normal'
    );
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Unauthenticated user created an XOS request.';
  end if;

  if has_function_privilege('anon', 'public.create_xos_request_for_host(text,text,text,text,text)', 'execute') then
    raise exception 'Anon can execute XOS request creation RPC.';
  end if;

  if pg_get_function_arguments('public.create_xos_request_for_host(text,text,text,text,text)'::regprocedure) like '%tenant%' then
    raise exception 'XOS request creation RPC must not accept browser-supplied tenant parameters.';
  end if;

  delete from public.client_quote_requests
  where client_email in ('xos4d-a@example.test', 'xos4d-b@example.test', 'xos4d-outsider@example.test')
     or project_name like 'XOS4D%';
  delete from public.tenant_domains
  where hostname in ('xos4d-a.xos.jointx.co.za', 'xos4d-b.xos.jointx.co.za');
  delete from public.clients
  where email in ('xos4d-a@example.test', 'xos4d-b@example.test');
  delete from public.users
  where auth_user_id in (tenant_a_user_id, tenant_b_user_id, outsider_user_id)
     or user_email in ('xos4d-a@example.test', 'xos4d-b@example.test', 'xos4d-outsider@example.test');
  delete from public.tenants
  where slug in ('xos4d-a', 'xos4d-b');
  delete from auth.users
  where id in (tenant_a_user_id, tenant_b_user_id, outsider_user_id);
end;
$$;
