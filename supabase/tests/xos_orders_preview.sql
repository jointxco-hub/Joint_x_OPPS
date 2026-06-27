-- Run after 202606270006_xos_orders_preview.sql in a disposable or linked QA database.
-- Uses disposable tenants, users, hosts, and orders.

do $$
declare
  tenant_a_id uuid;
  tenant_b_id uuid;
  tenant_a_user_id uuid := '00000000-0000-4000-8000-000000000081'::uuid;
  tenant_b_user_id uuid := '00000000-0000-4000-8000-000000000082'::uuid;
  outsider_user_id uuid := '00000000-0000-4000-8000-000000000083'::uuid;
  result jsonb;
  denied boolean;
begin
  delete from public.orders
  where order_number in ('XOS4C-A-ORDER-1', 'XOS4C-A-ORDER-2', 'XOS4C-B-ORDER-1');
  delete from public.tenant_domains
  where hostname in ('xos4c-a.xos.jointx.co.za', 'xos4c-b.xos.jointx.co.za');
  delete from public.users
  where auth_user_id in (tenant_a_user_id, tenant_b_user_id, outsider_user_id)
     or user_email in ('xos4c-a@example.test', 'xos4c-b@example.test', 'xos4c-outsider@example.test');
  delete from public.tenants
  where slug in ('xos4c-a', 'xos4c-b');
  delete from auth.users
  where id in (tenant_a_user_id, tenant_b_user_id, outsider_user_id);

  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (tenant_a_user_id, 'authenticated', 'authenticated', 'xos4c-a@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (tenant_b_user_id, 'authenticated', 'authenticated', 'xos4c-b@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (outsider_user_id, 'authenticated', 'authenticated', 'xos4c-outsider@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.users (auth_user_id, user_email, full_name, role, department, is_active)
  values
    (tenant_a_user_id, 'xos4c-a@example.test', 'XOS 4C Tenant A', 'user', 'operations', true),
    (tenant_b_user_id, 'xos4c-b@example.test', 'XOS 4C Tenant B', 'user', 'operations', true),
    (outsider_user_id, 'xos4c-outsider@example.test', 'XOS 4C Outsider', 'user', 'operations', true);

  insert into public.tenants (slug, name, status)
  values
    ('xos4c-a', 'XOS 4C Tenant A', 'active'),
    ('xos4c-b', 'XOS 4C Tenant B', 'active');

  select id into tenant_a_id from public.tenants where slug = 'xos4c-a';
  select id into tenant_b_id from public.tenants where slug = 'xos4c-b';

  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values
    (tenant_a_id, tenant_a_user_id, 'member', 'active'),
    (tenant_b_id, tenant_b_user_id, 'member', 'active');

  insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary, verified_at)
  values
    (tenant_a_id, 'xos4c-a.xos.jointx.co.za', 'xos_admin', 'active', true, now()),
    (tenant_b_id, 'xos4c-b.xos.jointx.co.za', 'xos_admin', 'active', true, now());

  insert into public.orders (
    tenant_id,
    client_name,
    client_email,
    order_number,
    status,
    pipeline_stage,
    production_method,
    production_detail_stage,
    production_client_update,
    production_internal_note,
    production_hold_reason,
    products,
    total_amount,
    due_date,
    tracking_number,
    file_urls,
    invoice_files,
    source
  )
  values
    (
      tenant_a_id,
      'XOS 4C Client A',
      'xos4c-client@example.test',
      'XOS4C-A-ORDER-1',
      'confirmed',
      'artwork_check',
      'dtf',
      'artwork_check',
      'Tenant A safe client update.',
      'Tenant A hidden internal note',
      'Tenant A hidden hold reason',
      jsonb_build_array(jsonb_build_object('name', 'Tenant A demo item', 'quantity', 3)),
      1000,
      current_date + 5,
      'XOS4C-A-TRACK',
      array['private-upload://uploads/' || tenant_a_id::text || '/xos4c/a.pdf'],
      jsonb_build_array(jsonb_build_object('url', 'private-upload://uploads/' || tenant_a_id::text || '/xos4c/invoice.pdf')),
      'opps'
    ),
    (
      tenant_a_id,
      'XOS 4C Client A',
      'xos4c-client@example.test',
      'XOS4C-A-ORDER-2',
      'in_production',
      'pressing',
      'mixed',
      'pressing',
      'Tenant A second safe update.',
      'Tenant A second hidden internal note',
      'Tenant A second hidden hold reason',
      jsonb_build_array(jsonb_build_object('name', 'Tenant A second item', 'quantity', 4)),
      2000,
      current_date + 7,
      null,
      array[]::text[],
      '[]'::jsonb,
      'opps'
    ),
    (
      tenant_b_id,
      'XOS 4C Client B',
      'xos4c-client@example.test',
      'XOS4C-B-ORDER-1',
      'ready',
      'packing',
      'embroidery',
      'packing',
      'Tenant B safe update.',
      'Tenant B hidden internal note',
      'Tenant B hidden hold reason',
      jsonb_build_array(jsonb_build_object('name', 'Tenant B demo item', 'quantity', 2)),
      3000,
      current_date + 3,
      'XOS4C-B-TRACK',
      array['private-upload://uploads/' || tenant_b_id::text || '/xos4c/b.pdf'],
      '[]'::jsonb,
      'opps'
    );

  perform set_config('request.jwt.claim.sub', tenant_a_user_id::text, true);
  perform set_config('request.jwt.claim.email', 'xos4c-a@example.test', true);

  result := public.get_xos_orders_for_host('xos4c-a.xos.jointx.co.za', 20);
  if jsonb_array_length(result) <> 2 then
    raise exception 'Tenant A XOS orders did not return exactly two rows.';
  end if;
  if result::text not like '%XOS4C-A-ORDER-1%'
    or result::text not like '%XOS4C-A-ORDER-2%'
    or result::text like '%XOS4C-B-ORDER-1%'
    or result::text like '%tenant_id%'
    or result::text like '%client_email%'
    or result::text like '%private-upload://%'
    or result::text like '%invoice_files%'
    or result::text like '%file_urls%'
    or result::text like '%internal note%'
    or result::text like '%hold reason%'
    or result::text like '%supplier%'
    or result::text like '%profit%'
    or result::text like '%margin%'
    or result::text like '%deposit_paid%'
  then
    raise exception 'Tenant A XOS orders exposed cross-tenant or internal order data.';
  end if;

  denied := false;
  begin
    perform public.get_xos_orders_for_host('xos4c-b.xos.jointx.co.za', 20);
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Tenant A read Tenant B XOS orders by switching host.';
  end if;

  denied := false;
  begin
    perform public.get_xos_orders_for_host('xos4c-a.xos.jointx.co.za?tenant_slug=xos4c-b', 20);
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Query-param host spoofing resolved XOS orders.';
  end if;

  denied := false;
  begin
    perform public.get_xos_orders_for_host('https://xos4c-a.xos.jointx.co.za/orders', 20);
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Path-like host spoofing resolved XOS orders.';
  end if;

  if public.is_private_upload_path_accessible(tenant_b_id::text || '/xos4c/b.pdf') is distinct from false then
    raise exception 'Tenant A signed URL helper path access accepted Tenant B private path.';
  end if;

  perform set_config('request.jwt.claim.sub', outsider_user_id::text, true);
  perform set_config('request.jwt.claim.email', 'xos4c-outsider@example.test', true);

  denied := false;
  begin
    perform public.get_xos_orders_for_host('xos4c-a.xos.jointx.co.za', 20);
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Non-member read XOS orders.';
  end if;

  if has_function_privilege('anon', 'public.get_xos_orders_for_host(text,int)', 'execute') then
    raise exception 'Anon can execute XOS orders RPC.';
  end if;

  if pg_get_function_arguments('public.get_xos_orders_for_host(text,int)'::regprocedure) like '%tenant%' then
    raise exception 'XOS Orders RPC must not accept browser-supplied tenant parameters.';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.email', '', true);

  delete from public.orders
  where order_number in ('XOS4C-A-ORDER-1', 'XOS4C-A-ORDER-2', 'XOS4C-B-ORDER-1');
  delete from public.tenant_domains
  where hostname in ('xos4c-a.xos.jointx.co.za', 'xos4c-b.xos.jointx.co.za');
  delete from public.users
  where auth_user_id in (tenant_a_user_id, tenant_b_user_id, outsider_user_id)
     or user_email in ('xos4c-a@example.test', 'xos4c-b@example.test', 'xos4c-outsider@example.test');
  delete from public.tenants
  where slug in ('xos4c-a', 'xos4c-b');
  delete from auth.users
  where id in (tenant_a_user_id, tenant_b_user_id, outsider_user_id);
end;
$$;
