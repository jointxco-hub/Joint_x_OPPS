-- Run after 202606270005_xos_requests_files_demo.sql in a disposable or linked QA database.
-- Uses disposable tenants, users, hosts, request rows, and file metadata.

do $$
declare
  tenant_a_id uuid;
  tenant_b_id uuid;
  tenant_a_user_id uuid := '00000000-0000-4000-8000-000000000071'::uuid;
  tenant_b_user_id uuid := '00000000-0000-4000-8000-000000000072'::uuid;
  outsider_user_id uuid := '00000000-0000-4000-8000-000000000073'::uuid;
  client_a_id uuid;
  client_b_id uuid;
  folder_a_id uuid;
  folder_b_id uuid;
  result jsonb;
  denied boolean;
begin
  delete from public.client_file_links
  where client_email = 'xos4a-client@example.test';
  delete from public.client_file_folders
  where client_email = 'xos4a-client@example.test';
  delete from public.client_messages
  where client_email = 'xos4a-client@example.test';
  delete from public.client_quote_requests
  where client_email = 'xos4a-client@example.test';
  delete from public.orders
  where order_number in ('XOS4A-A-FILES', 'XOS4A-B-FILES');
  delete from public.tenant_domains
  where hostname in ('xos4a-a.xos.jointx.co.za', 'xos4a-b.xos.jointx.co.za', 'xos4a-a.example.test');
  delete from public.clients
  where email = 'xos4a-client@example.test';
  delete from public.users
  where auth_user_id in (tenant_a_user_id, tenant_b_user_id, outsider_user_id)
     or user_email in ('xos4a-a@example.test', 'xos4a-b@example.test', 'xos4a-outsider@example.test');
  delete from public.tenants
  where slug in ('xos4a-a', 'xos4a-b');
  delete from auth.users
  where id in (tenant_a_user_id, tenant_b_user_id, outsider_user_id);

  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (tenant_a_user_id, 'authenticated', 'authenticated', 'xos4a-a@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (tenant_b_user_id, 'authenticated', 'authenticated', 'xos4a-b@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (outsider_user_id, 'authenticated', 'authenticated', 'xos4a-outsider@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.users (auth_user_id, user_email, full_name, role, department, is_active)
  values
    (tenant_a_user_id, 'xos4a-a@example.test', 'XOS 4A Tenant A', 'user', 'operations', true),
    (tenant_b_user_id, 'xos4a-b@example.test', 'XOS 4A Tenant B', 'user', 'operations', true),
    (outsider_user_id, 'xos4a-outsider@example.test', 'XOS 4A Outsider', 'user', 'operations', true);

  insert into public.tenants (slug, name, status)
  values
    ('xos4a-a', 'XOS 4A Tenant A', 'active'),
    ('xos4a-b', 'XOS 4A Tenant B', 'active');

  select id into tenant_a_id from public.tenants where slug = 'xos4a-a';
  select id into tenant_b_id from public.tenants where slug = 'xos4a-b';

  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values
    (tenant_a_id, tenant_a_user_id, 'member', 'active'),
    (tenant_b_id, tenant_b_user_id, 'member', 'active');

  insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary, verified_at)
  values
    (tenant_a_id, 'xos4a-a.xos.jointx.co.za', 'xos_admin', 'active', true, now()),
    (tenant_b_id, 'xos4a-b.xos.jointx.co.za', 'xos_admin', 'active', true, now()),
    (tenant_a_id, 'xos4a-a.example.test', 'public_tracking', 'active', false, now());

  insert into public.clients (tenant_id, name, email, status, portal_enabled)
  values
    (tenant_a_id, 'XOS 4A Client A', 'xos4a-client@example.test', 'active', true),
    (tenant_b_id, 'XOS 4A Client B', 'xos4a-client@example.test', 'active', true);

  select id into client_a_id from public.clients where tenant_id = tenant_a_id and email = 'xos4a-client@example.test';
  select id into client_b_id from public.clients where tenant_id = tenant_b_id and email = 'xos4a-client@example.test';

  insert into public.client_quote_requests (tenant_id, client_id, client_email, client_name, project_name, details, source_app, status)
  values
    (tenant_a_id, client_a_id, 'xos4a-client@example.test', 'XOS 4A Client A', 'XOS4A Tenant A request', 'Tenant A visible request', 'xos-test', 'new'),
    (tenant_b_id, client_b_id, 'xos4a-client@example.test', 'XOS 4A Client B', 'XOS4A Tenant B request', 'Tenant B visible request', 'xos-test', 'new');

  insert into public.client_messages (tenant_id, client_id, client_email, subject, message, sender_type, is_internal, status, source_app)
  values
    (tenant_a_id, client_a_id, 'xos4a-client@example.test', 'XOS4A Tenant A message', 'Tenant A client-facing message', 'client', false, 'new', 'xos-test'),
    (tenant_a_id, client_a_id, 'xos4a-client@example.test', 'XOS4A Tenant A internal note', 'Tenant A hidden internal note', 'team', true, 'new', 'xos-test'),
    (tenant_b_id, client_b_id, 'xos4a-client@example.test', 'XOS4A Tenant B message', 'Tenant B client-facing message', 'client', false, 'new', 'xos-test');

  insert into public.client_file_folders (tenant_id, client_id, client_email, name, source_app)
  values
    (tenant_a_id, client_a_id, 'xos4a-client@example.test', 'XOS4A Tenant A Files', 'xos-test'),
    (tenant_b_id, client_b_id, 'xos4a-client@example.test', 'XOS4A Tenant B Files', 'xos-test');

  select id into folder_a_id from public.client_file_folders where tenant_id = tenant_a_id and name = 'XOS4A Tenant A Files';
  select id into folder_b_id from public.client_file_folders where tenant_id = tenant_b_id and name = 'XOS4A Tenant B Files';

  insert into public.client_file_links (tenant_id, client_id, client_email, file_url, file_name, file_type, file_size, folder_id, uploaded_by_type, source_app)
  values
    (tenant_a_id, client_a_id, 'xos4a-client@example.test', 'private-upload://uploads/' || tenant_a_id::text || '/xos4a/a-file.pdf', 'XOS4A Tenant A file.pdf', 'application/pdf', 100, folder_a_id, 'internal', 'xos-test'),
    (tenant_a_id, client_a_id, 'xos4a-client@example.test', 'https://example.test/not-private.pdf', 'XOS4A public legacy file.pdf', 'application/pdf', 100, folder_a_id, 'internal', 'xos-test'),
    (tenant_b_id, client_b_id, 'xos4a-client@example.test', 'private-upload://uploads/' || tenant_b_id::text || '/xos4a/b-file.pdf', 'XOS4A Tenant B file.pdf', 'application/pdf', 100, folder_b_id, 'internal', 'xos-test');

  insert into public.orders (
    tenant_id,
    client_name,
    order_number,
    status,
    pipeline_stage,
    production_method,
    production_detail_stage,
    production_client_update,
    portal_show_files,
    portal_visible_file_urls,
    invoice_files,
    file_urls
  )
  values (
    tenant_a_id,
    'XOS 4A Client A',
    'XOS4A-A-FILES',
    'in_production',
    'pressing',
    'dtf',
    'pressing',
    'XOS 4A public-safe status',
    true,
    array['private-upload://uploads/' || tenant_a_id::text || '/xos4a/a-file.pdf'],
    jsonb_build_array(jsonb_build_object('name', 'XOS 4A invoice', 'url', 'private-upload://uploads/' || tenant_a_id::text || '/xos4a/a-file.pdf')),
    array['private-upload://uploads/' || tenant_a_id::text || '/xos4a/a-file.pdf']
  );

  perform set_config('request.jwt.claim.sub', tenant_a_user_id::text, true);
  perform set_config('request.jwt.claim.email', 'xos4a-a@example.test', true);

  result := public.get_xos_requests_for_host('xos4a-a.xos.jointx.co.za', 20);
  if jsonb_array_length(result) <> 2 then
    raise exception 'Tenant A XOS requests did not return exactly two client-facing rows.';
  end if;
  if result::text like '%Tenant B%'
    or result::text like '%internal note%'
    or result::text like '%tenant_id%'
    or result::text like '%client_id%'
    or result::text like '%finance%'
    or result::text like '%supplier%'
    or result::text like '%production_internal%'
  then
    raise exception 'Tenant A XOS requests exposed cross-tenant or internal data.';
  end if;

  result := public.get_xos_files_for_host('xos4a-a.xos.jointx.co.za', 20);
  if jsonb_array_length(result) <> 1 then
    raise exception 'Tenant A XOS files did not return exactly one private tenant file.';
  end if;
  if result::text not like '%private-upload://uploads/' || tenant_a_id::text || '/xos4a/a-file.pdf%'
    or result::text like '%Tenant B%'
    or result::text like '%example.test/not-private%'
    or result::text like '%tenant_id%'
    or result::text like '%client_email%'
  then
    raise exception 'Tenant A XOS files exposed cross-tenant, public legacy, or internal metadata.';
  end if;

  denied := false;
  begin
    perform public.get_xos_requests_for_host('xos4a-b.xos.jointx.co.za', 20);
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Tenant A read Tenant B XOS requests by switching host.';
  end if;

  denied := false;
  begin
    perform public.get_xos_files_for_host('xos4a-b.xos.jointx.co.za', 20);
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Tenant A read Tenant B XOS files by switching host.';
  end if;

  denied := false;
  begin
    perform public.get_xos_requests_for_host('xos4a-a.xos.jointx.co.za?tenant_slug=xos4a-b', 20);
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Query-param host spoofing resolved XOS requests.';
  end if;

  denied := false;
  begin
    perform public.get_xos_files_for_host('https://xos4a-a.xos.jointx.co.za/files', 20);
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Path-like host spoofing resolved XOS files.';
  end if;

  if public.is_private_upload_path_accessible(tenant_b_id::text || '/xos4a/b-file.pdf') is distinct from false then
    raise exception 'Tenant A signed URL helper path access accepted Tenant B private path.';
  end if;

  perform set_config('request.jwt.claim.sub', outsider_user_id::text, true);
  perform set_config('request.jwt.claim.email', 'xos4a-outsider@example.test', true);

  denied := false;
  begin
    perform public.get_xos_requests_for_host('xos4a-a.xos.jointx.co.za', 20);
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Non-member read XOS requests.';
  end if;

  denied := false;
  begin
    perform public.get_xos_files_for_host('xos4a-a.xos.jointx.co.za', 20);
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Non-member read XOS files.';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.email', '', true);

  result := public.get_public_order_tracking_for_host('XOS4A-A-FILES', 'xos4a-a.example.test');
  if result is null then
    raise exception 'Public tracking regression did not return disposable XOS4A order.';
  end if;
  if result::text like '%private-upload://%'
    or result::text like '%tenant_id%'
    or result->>'portal_show_files' <> 'false'
    or jsonb_array_length(coalesce(result->'portal_visible_file_urls', '[]'::jsonb)) <> 0
    or jsonb_array_length(coalesce(result->'invoice_files', '[]'::jsonb)) <> 0
  then
    raise exception 'Public tracking exposed private refs or tenant data after XOS Phase 4A.';
  end if;

  if has_function_privilege('anon', 'public.get_xos_requests_for_host(text,int)', 'execute') then
    raise exception 'Anon can execute XOS requests RPC.';
  end if;
  if has_function_privilege('anon', 'public.get_xos_files_for_host(text,int)', 'execute') then
    raise exception 'Anon can execute XOS files RPC.';
  end if;

  if pg_get_function_arguments('public.get_xos_requests_for_host(text,int)'::regprocedure) like '%tenant%'
    or pg_get_function_arguments('public.get_xos_files_for_host(text,int)'::regprocedure) like '%tenant%'
  then
    raise exception 'XOS Phase 4A RPCs must not accept browser-supplied tenant parameters.';
  end if;

  delete from public.client_file_links
  where client_email = 'xos4a-client@example.test';
  delete from public.client_file_folders
  where client_email = 'xos4a-client@example.test';
  delete from public.client_messages
  where client_email = 'xos4a-client@example.test';
  delete from public.client_quote_requests
  where client_email = 'xos4a-client@example.test';
  delete from public.orders
  where order_number in ('XOS4A-A-FILES', 'XOS4A-B-FILES');
  delete from public.tenant_domains
  where hostname in ('xos4a-a.xos.jointx.co.za', 'xos4a-b.xos.jointx.co.za', 'xos4a-a.example.test');
  delete from public.clients
  where email = 'xos4a-client@example.test';
  delete from public.users
  where auth_user_id in (tenant_a_user_id, tenant_b_user_id, outsider_user_id)
     or user_email in ('xos4a-a@example.test', 'xos4a-b@example.test', 'xos4a-outsider@example.test');
  delete from public.tenants
  where slug in ('xos4a-a', 'xos4a-b');
  delete from auth.users
  where id in (tenant_a_user_id, tenant_b_user_id, outsider_user_id);
end;
$$;
