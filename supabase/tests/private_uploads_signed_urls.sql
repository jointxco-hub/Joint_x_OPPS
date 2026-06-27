-- Run after 202606270001_private_uploads_signed_urls.sql in a disposable or linked QA database.
-- Uses only disposable tenants, memberships, host mappings, and order fixtures.

do $$
declare
  tenant_a_id uuid;
  tenant_b_id uuid;
  tenant_a_user_id uuid := '00000000-0000-4000-8000-000000000041'::uuid;
  tenant_b_user_id uuid := '00000000-0000-4000-8000-000000000042'::uuid;
  xos_user_id uuid := '00000000-0000-4000-8000-000000000043'::uuid;
  tenant_a_path text;
  tenant_b_path text;
  result jsonb;
begin
  delete from public.orders
  where order_number in ('PHASE2C1-A-FILES', 'PHASE2C1-B-FILES');

  delete from public.tenant_domains
  where hostname in ('phase2c1-a.example.test', 'phase2c1-b.example.test', 'phase2c1-a.xos.jointx.co.za');

  delete from public.tenants
  where slug in ('phase2c1-files-a', 'phase2c1-files-b');

  delete from auth.users
  where id in (tenant_a_user_id, tenant_b_user_id, xos_user_id);

  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (tenant_a_user_id, 'authenticated', 'authenticated', 'phase2c1-a@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (tenant_b_user_id, 'authenticated', 'authenticated', 'phase2c1-b@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (xos_user_id, 'authenticated', 'authenticated', 'phase2c1-xos@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.tenants (slug, name, status)
  values
    ('phase2c1-files-a', 'Phase 2C.1 Files Tenant A', 'active'),
    ('phase2c1-files-b', 'Phase 2C.1 Files Tenant B', 'active');

  select id into tenant_a_id from public.tenants where slug = 'phase2c1-files-a';
  select id into tenant_b_id from public.tenants where slug = 'phase2c1-files-b';

  tenant_a_path := tenant_a_id::text || '/orders/a-secret-artwork.png';
  tenant_b_path := tenant_b_id::text || '/orders/b-secret-artwork.png';

  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values
    (tenant_a_id, tenant_a_user_id, 'member', 'active'),
    (tenant_b_id, tenant_b_user_id, 'member', 'active'),
    (tenant_a_id, xos_user_id, 'member', 'active');

  insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary, verified_at)
  values
    (tenant_a_id, 'phase2c1-a.example.test', 'public_tracking', 'active', true, now()),
    (tenant_b_id, 'phase2c1-b.example.test', 'public_tracking', 'active', true, now()),
    (tenant_a_id, 'phase2c1-a.xos.jointx.co.za', 'xos_admin', 'active', false, now());

  if not exists (select 1 from storage.buckets where id = 'uploads' and public is false) then
    raise exception 'uploads bucket must be private.';
  end if;

  if not exists (select 1 from storage.buckets where id = 'public-assets' and public is true) then
    raise exception 'public-assets bucket must remain explicitly public for intentional public media.';
  end if;

  if public.private_upload_path_tenant_id(tenant_a_path) is distinct from tenant_a_id then
    raise exception 'Private upload tenant parser did not return the tenant UUID path prefix.';
  end if;

  if public.private_upload_path_tenant_id('not-a-uuid/orders/file.png') is not null then
    raise exception 'Private upload tenant parser accepted a malformed tenant path prefix.';
  end if;

  if public.private_upload_path_tenant_id(tenant_b_id::text || '/../' || tenant_a_id::text || '/spoof.png') is not null then
    raise exception 'Private upload tenant parser accepted a traversal-like spoof path.';
  end if;

  if public.is_private_upload_path_accessible(null) is distinct from false
    or public.is_private_upload_path_accessible('') is distinct from false
    or public.is_private_upload_path_accessible('.') is distinct from false
    or public.is_private_upload_path_accessible('..') is distinct from false
    or public.is_private_upload_path_accessible('/' || tenant_a_path) is distinct from false
    or public.is_private_upload_path_accessible('folder//file.png') is distinct from false
    or public.is_private_upload_path_accessible('folder/./file.png') is distinct from false
    or public.is_private_upload_path_accessible('folder\file.png') is distinct from false
    or public.is_private_upload_path_accessible('not-a-uuid/file.png') is distinct from false
  then
    raise exception 'Malformed private upload paths must be rejected before tenant/admin fallback.';
  end if;

  perform set_config('request.jwt.claim.sub', tenant_a_user_id::text, true);

  if public.is_private_upload_path_accessible(tenant_a_path) is distinct from true then
    raise exception 'Tenant A member could not access Tenant A private upload path.';
  end if;

  if public.is_private_upload_path_accessible(tenant_b_path) is distinct from false then
    raise exception 'Tenant A member accessed Tenant B private upload path.';
  end if;

  if public.is_private_upload_path_accessible(tenant_b_id::text || '/../' || tenant_a_id::text || '/spoof.png') is distinct from false then
    raise exception 'Tenant A path spoofing bypassed tenant-prefix isolation.';
  end if;

  perform set_config('request.jwt.claim.sub', tenant_b_user_id::text, true);

  if public.is_private_upload_path_accessible(tenant_b_path) is distinct from true then
    raise exception 'Tenant B member could not access Tenant B private upload path.';
  end if;

  if public.is_private_upload_path_accessible(tenant_a_path) is distinct from false then
    raise exception 'Tenant B member accessed Tenant A private upload path.';
  end if;

  perform set_config('request.jwt.claim.sub', xos_user_id::text, true);

  if public.is_private_upload_path_accessible(tenant_a_path) is distinct from true
    or public.is_private_upload_path_accessible(tenant_b_path) is distinct from false
  then
    raise exception 'XOS-style tenant member file access did not stay within the resolved tenant.';
  end if;

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
  values
    (
      tenant_a_id,
      'Phase 2C.1 Tenant A Client',
      'PHASE2C1-A-FILES',
      'in_production',
      'pressing',
      'dtf',
      'pressing',
      'Tenant A public file update',
      true,
      array['private-upload://uploads/' || tenant_a_path],
      jsonb_build_array(jsonb_build_object('name', 'Tenant A invoice', 'url', 'private-upload://uploads/' || tenant_a_path)),
      array['private-upload://uploads/' || tenant_a_path]
    ),
    (
      tenant_b_id,
      'Phase 2C.1 Tenant B Client',
      'PHASE2C1-B-FILES',
      'ready',
      'packing',
      'embroidery',
      'packing',
      'Tenant B public file update',
      true,
      array['private-upload://uploads/' || tenant_b_path],
      jsonb_build_array(jsonb_build_object('name', 'Tenant B invoice', 'url', 'private-upload://uploads/' || tenant_b_path)),
      array['private-upload://uploads/' || tenant_b_path]
    );

  perform set_config('request.jwt.claim.sub', '', true);

  result := public.get_public_order_tracking_for_host('PHASE2C1-A-FILES', 'phase2c1-a.example.test');

  if result is null then
    raise exception 'Public tracking did not return disposable Tenant A order.';
  end if;

  if result->>'portal_show_files' <> 'false'
    or jsonb_array_length(coalesce(result->'portal_visible_file_urls', '[]'::jsonb)) <> 0
    or jsonb_array_length(coalesce(result->'invoice_files', '[]'::jsonb)) <> 0
  then
    raise exception 'Public tracking exposed private file references.';
  end if;

  if public.get_public_order_tracking_for_host('PHASE2C1-B-FILES', 'phase2c1-a.example.test') is not null then
    raise exception 'Public tracking host cross-returned another tenant order.';
  end if;

  if public.get_public_order_tracking_for_host('PHASE2C1-A-FILES', 'unknown.example.test') is not null then
    raise exception 'Unknown host returned a private-file order.';
  end if;

  if public.get_public_order_tracking_for_host('PHASE2C1-A-FILES', 'https://phase2c1-a.example.test/track') is not null
    or public.get_public_order_tracking_for_host('PHASE2C1-A-FILES', 'phase2c1-a.example.test:443') is not null
    or public.get_public_order_tracking_for_host('PHASE2C1-A-FILES', 'phase2c1-a.example.test.') is not null
  then
    raise exception 'Malformed public tracking host returned a private-file order.';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'private_uploads_read_by_tenant'
  ) then
    raise exception 'Expected storage read policy for tenant-private uploads is missing.';
  end if;

  delete from public.orders
  where order_number in ('PHASE2C1-A-FILES', 'PHASE2C1-B-FILES');

  delete from public.tenant_domains
  where hostname in ('phase2c1-a.example.test', 'phase2c1-b.example.test', 'phase2c1-a.xos.jointx.co.za');

  delete from public.tenants
  where slug in ('phase2c1-files-a', 'phase2c1-files-b');

  delete from auth.users
  where id in (tenant_a_user_id, tenant_b_user_id, xos_user_id);
end;
$$;
