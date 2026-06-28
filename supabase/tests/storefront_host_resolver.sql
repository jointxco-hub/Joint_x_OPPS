-- Run after 202606270008_tenant_storefront_catalog_backend.sql.
-- Uses disposable tenants and storefront host mappings.

do $$
declare
  tenant_a_id uuid;
  tenant_b_id uuid;
begin
  delete from public.tenant_domains
  where hostname in (
    'phase5b-a.xlab.jointx.co.za',
    'phase5b-b.xlab.jointx.co.za',
    'phase5b-pending.xlab.jointx.co.za',
    'phase5b-disabled.xlab.jointx.co.za',
    'phase5b-xos.xos.jointx.co.za',
    'phase5b-track.xlab.jointx.co.za'
  );

  delete from public.tenants
  where slug in ('phase5b-storefront-a', 'phase5b-storefront-b');

  insert into public.tenants (slug, name, status)
  values
    ('phase5b-storefront-a', 'Phase 5B Storefront Tenant A', 'active'),
    ('phase5b-storefront-b', 'Phase 5B Storefront Tenant B', 'active');

  select id into tenant_a_id from public.tenants where slug = 'phase5b-storefront-a';
  select id into tenant_b_id from public.tenants where slug = 'phase5b-storefront-b';

  insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary, verified_at)
  values
    (tenant_a_id, 'phase5b-a.xlab.jointx.co.za', 'storefront', 'active', true, now()),
    (tenant_b_id, 'phase5b-b.xlab.jointx.co.za', 'storefront', 'active', true, now()),
    (tenant_a_id, 'phase5b-pending.xlab.jointx.co.za', 'storefront', 'pending', false, null),
    (tenant_a_id, 'phase5b-disabled.xlab.jointx.co.za', 'storefront', 'disabled', false, now()),
    (tenant_a_id, 'phase5b-xos.xos.jointx.co.za', 'xos_admin', 'active', false, now()),
    (tenant_a_id, 'phase5b-track.xlab.jointx.co.za', 'public_tracking', 'active', false, now());

  if not exists (
    select 1
    from public.resolve_public_storefront_tenant('PHASE5B-A.XLAB.JOINTX.CO.ZA')
    where tenant_slug = 'phase5b-storefront-a'
      and tenant_name = 'Phase 5B Storefront Tenant A'
      and hostname = 'phase5b-a.xlab.jointx.co.za'
  ) then
    raise exception 'Active storefront host did not resolve Tenant A.';
  end if;

  if exists (
    select 1 from public.resolve_public_storefront_tenant('unknown.example.test')
  ) then
    raise exception 'Unknown storefront host resolved to a tenant.';
  end if;

  if exists (select 1 from public.resolve_public_storefront_tenant('https://phase5b-a.xlab.jointx.co.za/shop'))
    or exists (select 1 from public.resolve_public_storefront_tenant('phase5b-a.xlab.jointx.co.za:443'))
    or exists (select 1 from public.resolve_public_storefront_tenant('phase5b-a.xlab.jointx.co.za.'))
    or exists (select 1 from public.resolve_public_storefront_tenant('phase5b-a.xlab.jointx.co.za?tenant_slug=phase5b-storefront-b'))
  then
    raise exception 'Malformed storefront host resolved to a tenant.';
  end if;

  if exists (select 1 from public.resolve_public_storefront_tenant('phase5b-pending.xlab.jointx.co.za'))
    or exists (select 1 from public.resolve_public_storefront_tenant('phase5b-disabled.xlab.jointx.co.za'))
  then
    raise exception 'Pending or disabled storefront host resolved to a tenant.';
  end if;

  if exists (select 1 from public.resolve_public_storefront_tenant('phase5b-xos.xos.jointx.co.za'))
    or exists (select 1 from public.resolve_public_storefront_tenant('phase5b-track.xlab.jointx.co.za'))
  then
    raise exception 'Non-storefront surface resolved as storefront.';
  end if;

  if exists (
    select 1
    from public.resolve_public_storefront_tenant('phase5b-a.xlab.jointx.co.za') resolved
    where to_jsonb(resolved) ? 'tenant_id'
  ) then
    raise exception 'Public storefront resolver exposed tenant_id.';
  end if;

  delete from public.tenant_domains
  where hostname in (
    'phase5b-a.xlab.jointx.co.za',
    'phase5b-b.xlab.jointx.co.za',
    'phase5b-pending.xlab.jointx.co.za',
    'phase5b-disabled.xlab.jointx.co.za',
    'phase5b-xos.xos.jointx.co.za',
    'phase5b-track.xlab.jointx.co.za'
  );

  delete from public.tenants
  where slug in ('phase5b-storefront-a', 'phase5b-storefront-b');
end;
$$;
