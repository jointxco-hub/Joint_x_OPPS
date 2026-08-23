-- XOS 3A — reusable "products" capability activation statement.
--
-- TEMPLATE - NOT executed as part of the 20260823111500 migration, and
-- NOT run against production by this phase. This is a later controlled
-- activation step, performed independently per tenant once the migration
-- itself has been reviewed and applied. Copy this file per activation
-- (e.g. xos_3a_activate_gsb_products.sql), fill in the one variable,
-- review, then run by hand.
--
-- Idempotent: safe to run once per tenant. Re-running with the same slug
-- updates enabled=true again rather than erroring or duplicating.

do $$
declare
  -- ============ CONFIGURE ============
  v_tenant_slug text := 'REPLACE_ME'; -- e.g. 'gsb'
  -- ====================================
  v_tenant_id uuid;
begin
  select id into v_tenant_id from public.tenants where slug = v_tenant_slug;

  if v_tenant_id is null then
    raise exception 'No tenant found with slug "%".', v_tenant_slug;
  end if;

  insert into public.tenant_capabilities (tenant_id, capability_key, enabled, config)
  values (v_tenant_id, 'products', true, '{}'::jsonb)
  on conflict (tenant_id, capability_key)
  do update set enabled = true, updated_at = now();

  raise notice 'Products capability enabled for tenant "%" (id %).', v_tenant_slug, v_tenant_id;
end $$;

-- Verify after running:
--   select tc.* from public.tenant_capabilities tc
--   join public.tenants t on t.id = tc.tenant_id
--   where t.slug = 'REPLACE_ME' and tc.capability_key = 'products';
-- Expect enabled = true. The tenant's XOS workspace will show the
-- Products nav item and an empty "No products yet" screen (or their real
-- catalog, if commerce.products rows already exist for that tenant) on
-- next page load - no deploy or restart needed, this is pure data.
