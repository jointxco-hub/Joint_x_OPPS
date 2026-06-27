-- Run after 202606240002_xos_admin_gate.sql in a disposable or linked QA database.
-- Uses only disposable XOS host mappings, tenants, memberships, and auth users.

do $$
declare
  joint_tenant_id uuid;
  tenant_a_id uuid;
  tenant_b_id uuid;
  joint_user_id uuid := '00000000-0000-4000-8000-000000000031'::uuid;
  tenant_a_user_id uuid := '00000000-0000-4000-8000-000000000032'::uuid;
  tenant_b_user_id uuid := '00000000-0000-4000-8000-000000000033'::uuid;
  no_membership_user_id uuid := '00000000-0000-4000-8000-000000000034'::uuid;
  result record;
begin
  select id into joint_tenant_id
  from public.tenants
  where slug = 'joint-x'
    and status = 'active';

  if joint_tenant_id is null then
    raise exception 'Joint X tenant is required for XOS gate assertions.';
  end if;

  delete from public.tenant_domains
  where hostname in (
    'phase3-joint-x.xos.jointx.co.za',
    'phase3-a.xos.jointx.co.za',
    'phase3-b.xos.jointx.co.za'
  );

  delete from public.tenants
  where slug in ('phase3-xos-a', 'phase3-xos-b');

  delete from auth.users
  where id in (joint_user_id, tenant_a_user_id, tenant_b_user_id, no_membership_user_id);

  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (joint_user_id, 'authenticated', 'authenticated', 'phase3-joint-x@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (tenant_a_user_id, 'authenticated', 'authenticated', 'phase3-a@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (tenant_b_user_id, 'authenticated', 'authenticated', 'phase3-b@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (no_membership_user_id, 'authenticated', 'authenticated', 'phase3-none@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.tenants (slug, name, status)
  values
    ('phase3-xos-a', 'Phase 3 XOS Tenant A', 'active'),
    ('phase3-xos-b', 'Phase 3 XOS Tenant B', 'active');

  select id into tenant_a_id from public.tenants where slug = 'phase3-xos-a';
  select id into tenant_b_id from public.tenants where slug = 'phase3-xos-b';

  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values
    (joint_tenant_id, joint_user_id, 'member', 'active'),
    (tenant_a_id, tenant_a_user_id, 'member', 'active'),
    (tenant_b_id, tenant_b_user_id, 'member', 'active');

  insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary, verified_at)
  values
    (joint_tenant_id, 'phase3-joint-x.xos.jointx.co.za', 'xos_admin', 'active', false, now()),
    (tenant_a_id, 'phase3-a.xos.jointx.co.za', 'xos_admin', 'active', true, now()),
    (tenant_b_id, 'phase3-b.xos.jointx.co.za', 'xos_admin', 'active', true, now());

  perform set_config('request.jwt.claim.sub', joint_user_id::text, true);

  select * into result
  from public.resolve_xos_admin_gate('phase3-joint-x.xos.jointx.co.za');

  if result.allowed is distinct from true
    or result.reason <> 'allowed'
    or result.tenant_slug <> 'joint-x'
    or result.tenant_name is null
  then
    raise exception 'Joint X member could not access mapped Joint X XOS host.';
  end if;

  perform set_config('request.jwt.claim.sub', tenant_a_user_id::text, true);

  select * into result
  from public.resolve_xos_admin_gate('phase3-a.xos.jointx.co.za');

  if result.allowed is distinct from true
    or result.reason <> 'allowed'
    or result.tenant_slug <> 'phase3-xos-a'
  then
    raise exception 'Tenant A member could not access Tenant A XOS host.';
  end if;

  select * into result
  from public.resolve_xos_admin_gate('phase3-b.xos.jointx.co.za');

  if result.allowed is distinct from false
    or result.reason <> 'access_denied'
    or result.tenant_slug is not null
    or result.tenant_name is not null
  then
    raise exception 'Tenant A member accessed or learned Tenant B host details.';
  end if;

  perform set_config('request.jwt.claim.sub', no_membership_user_id::text, true);

  select * into result
  from public.resolve_xos_admin_gate('phase3-a.xos.jointx.co.za');

  if result.allowed is distinct from false
    or result.reason <> 'access_denied'
    or result.tenant_slug is not null
    or result.tenant_name is not null
  then
    raise exception 'User without membership was not denied cleanly.';
  end if;

  select * into result
  from public.resolve_xos_admin_gate('unknown.xos.jointx.co.za');

  if result.allowed is distinct from false
    or result.reason <> 'site_not_configured'
    or result.tenant_slug is not null
    or result.tenant_name is not null
  then
    raise exception 'Unknown XOS host did not return site_not_configured.';
  end if;

  perform set_config('request.jwt.claim.sub', tenant_a_user_id::text, true);

  select * into result
  from public.resolve_xos_admin_gate('phase3-a.xos.jointx.co.za?tenant_slug=phase3-xos-b');

  if result.allowed is distinct from false
    or result.reason <> 'site_not_configured'
  then
    raise exception 'Query parameters overrode or bypassed XOS host validation.';
  end if;

  select * into result
  from public.resolve_xos_admin_gate('phase3-a.xos.jointx.co.za/localStorageTenant/phase3-xos-b');

  if result.allowed is distinct from false
    or result.reason <> 'site_not_configured'
  then
    raise exception 'Browser cache-like host input overrode XOS host validation.';
  end if;

  if public.can_access_tenant(tenant_b_id) is distinct from false then
    raise exception 'RLS tenant access helper allowed Tenant A user into Tenant B.';
  end if;

  if not exists (
    select 1
    from pg_proc procedure_row
    join pg_namespace namespace_row on namespace_row.oid = procedure_row.pronamespace
    where namespace_row.nspname = 'public'
      and procedure_row.proname = 'resolve_xos_admin_gate'
      and procedure_row.pronargs = 1
      and procedure_row.proargtypes::text = '25'
  ) then
    raise exception 'XOS gate RPC must accept exactly one text hostname argument.';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);

  delete from public.tenant_domains
  where hostname in (
    'phase3-joint-x.xos.jointx.co.za',
    'phase3-a.xos.jointx.co.za',
    'phase3-b.xos.jointx.co.za'
  );

  delete from public.tenants
  where slug in ('phase3-xos-a', 'phase3-xos-b');

  delete from auth.users
  where id in (joint_user_id, tenant_a_user_id, tenant_b_user_id, no_membership_user_id);
end;
$$;





