-- XOS 3A — disposable test matrix for the products foundation.
--
-- Assumes migration 20260823111500_xos_3a_products_foundation.sql has
-- already been applied (does not create commerce.*, tenant_capabilities,
-- or either RPC itself). Entirely self-contained and disposable: wrapped
-- in one transaction, every fixture (two/three brand-new disposable
-- tenants, domains, memberships, capabilities, products, variants) is
-- created and torn down by the final `rollback;` - nothing here persists,
-- and nothing here touches real production data (Demo XOS, GSB, or any
-- other real tenant/client/membership row).
--
-- Run with: supabase db query --linked --file supabase/tests/xos_products_foundation.sql
--
-- Validated 2026-08-23 against production (read-only from the
-- perspective of anything outside this transaction): 24/24 checks pass.
-- Confirmed zero rows/schema persisted afterward.

begin;

-- =====================================================================
-- Disposable fixtures + full test matrix (real auth_user_ids reused from
-- existing production QA accounts, all fixtures are brand-new
-- tenants/products/variants distinct from Demo/GSB/Joint X real data)
-- =====================================================================

create temporary table test_results (
  n int generated always as identity,
  test_name text,
  passed boolean,
  detail text
);

do $$
declare
  v_tenant_x uuid := gen_random_uuid();
  v_tenant_y uuid := gen_random_uuid();
  v_host_x text := 'xos3a-test-x.xos.jointx.co.za';
  v_host_y text := 'xos3a-test-y.xos.jointx.co.za';
  -- real existing auth.users ids, reused only as JWT subs / membership
  -- rows inside this transaction - never mutated, rolled back at the end
  v_user_a uuid := 'defdceab-cddf-4863-9f2e-7473b6e2818d'; -- member of tenant X only (in this test)
  v_user_b uuid := '202ca0b1-a9f1-4321-80b8-cdcd2c66a98e'; -- member of tenant Y only (in this test)
  v_user_no_membership uuid := gen_random_uuid(); -- never inserted anywhere
  v_product_x uuid;
  v_product_y uuid;
  v_product_x_archived uuid;
  v_variant_x uuid;
  v_result jsonb;
  v_keys text[];
begin
  -- ---- fixtures: two disposable tenants + domains + one membership each ----
  insert into public.tenants (id, slug, name, status, settings)
  values
    (v_tenant_x, 'xos3a-test-tenant-x', 'XOS 3A Test Tenant X', 'active', '{}'::jsonb),
    (v_tenant_y, 'xos3a-test-tenant-y', 'XOS 3A Test Tenant Y', 'active', '{}'::jsonb);

  insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary)
  values
    (v_tenant_x, v_host_x, 'xos_admin', 'active', true),
    (v_tenant_y, v_host_y, 'xos_admin', 'active', true);

  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values
    (v_tenant_x, v_user_a, 'owner', 'active'),
    (v_tenant_y, v_user_b, 'owner', 'active');

  -- ---- fixtures: capabilities - X enabled, Y explicitly disabled, no row for a third case ----
  insert into public.tenant_capabilities (tenant_id, capability_key, enabled, config)
  values
    (v_tenant_x, 'products', true, '{}'::jsonb),
    (v_tenant_y, 'products', false, '{}'::jsonb);

  -- ---- fixtures: products/variants ----
  insert into commerce.products (tenant_id, slug, name, description, price, sale_price, currency, primary_image_url, availability, status, source_system, source_ref)
  values (v_tenant_x, 'test-tee', 'Test Tee', 'A disposable test product.', 250.00, 199.00, 'ZAR', 'https://example.com/tee.jpg', 'available', 'published', 'xos3a-test', 'fixture-1')
  returning id into v_product_x;

  insert into commerce.products (tenant_id, slug, name, price, availability, status)
  values (v_tenant_y, 'test-cap', 'Test Cap', 150.00, 'available', 'published')
  returning id into v_product_y;

  insert into commerce.products (tenant_id, slug, name, price, availability, status)
  values (v_tenant_x, 'test-archived-hoodie', 'Test Archived Hoodie', 400.00, 'available', 'archived')
  returning id into v_product_x_archived;

  insert into commerce.product_variants (tenant_id, product_id, sku, title, size, color, price_override, availability, sort_order)
  values (v_tenant_y, v_product_x, 'WRONG-TENANT-SKU', 'Should be forced to tenant X', 'M', 'Black', null, 'available', 0)
  returning id into v_variant_x;

  -- ---- Test 11: variant tenant mismatch impossible ----
  insert into test_results (test_name, passed, detail)
  select 'variant_tenant_forced_to_parent', (tenant_id = v_tenant_x), 'variant.tenant_id=' || tenant_id
  from commerce.product_variants where id = v_variant_x;

  -- ---- Test 1/10: Tenant X member on Tenant X host sees only X's product ----
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user_a, 'role', 'authenticated')::text, true);
  v_result := public.get_xos_products_for_host(v_host_x, 50);
  insert into test_results (test_name, passed, detail) values (
    'tenant_x_sees_only_own_product',
    jsonb_array_length(v_result) = 1 and (v_result->0->>'id') = v_product_x::text,
    v_result::text
  );

  -- ---- Test 12: archived product excluded ----
  insert into test_results (test_name, passed, detail) values (
    'archived_product_excluded',
    not exists (select 1 from jsonb_array_elements(v_result) e where e->>'id' = v_product_x_archived::text),
    'checked exclusion of ' || v_product_x_archived::text
  );

  -- ---- Test 13/14: allowlisted fields only, no internal leak ----
  select array(select jsonb_object_keys(v_result->0)) into v_keys;
  insert into test_results (test_name, passed, detail) values (
    'response_only_allowlisted_fields',
    v_keys <@ array['id','slug','name','description','price','sale_price','currency','primary_image_url','availability','status','variants']
      and not (v_result->0 ? 'tenant_id') and not (v_result->0 ? 'source_system') and not (v_result->0 ? 'source_ref'),
    array_to_string(v_keys, ',')
  );

  insert into test_results (test_name, passed, detail) values (
    'variant_only_allowlisted_fields',
    (select array(select jsonb_object_keys(elem)) from jsonb_array_elements(v_result->0->'variants') elem limit 1)
      <@ array['id','sku','title','size','color','price_override','availability','sort_order'],
    (v_result->0->'variants')::text
  );

  -- ---- Test 2: Tenant X member on Tenant Y host -> denied ----
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user_a, 'role', 'authenticated')::text, true);
  begin
    perform public.get_xos_products_for_host(v_host_y, 50);
    insert into test_results (test_name, passed, detail) values ('tenant_x_member_denied_on_tenant_y_host', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('tenant_x_member_denied_on_tenant_y_host', sqlerrm = 'XOS access denied.', sqlerrm);
  end;

  -- ---- Test 3: Tenant Y member on Tenant X host -> denied ----
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user_b, 'role', 'authenticated')::text, true);
  begin
    perform public.get_xos_products_for_host(v_host_x, 50);
    insert into test_results (test_name, passed, detail) values ('tenant_y_member_denied_on_tenant_x_host', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('tenant_y_member_denied_on_tenant_x_host', sqlerrm = 'XOS access denied.', sqlerrm);
  end;

  -- ---- Test 4: no tenant membership at all -> denied ----
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user_no_membership, 'role', 'authenticated')::text, true);
  begin
    perform public.get_xos_products_for_host(v_host_x, 50);
    insert into test_results (test_name, passed, detail) values ('no_membership_denied', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('no_membership_denied', sqlerrm = 'XOS access denied.', sqlerrm);
  end;

  -- ---- Test 5: unknown hostname -> denied ----
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user_a, 'role', 'authenticated')::text, true);
  begin
    perform public.get_xos_products_for_host('totally-unregistered-host.example.com', 50);
    insert into test_results (test_name, passed, detail) values ('unknown_hostname_denied', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('unknown_hostname_denied', sqlerrm = 'XOS access denied.', sqlerrm);
  end;

  -- ---- Test 6: hostname injection cannot override tenant ----
  begin
    perform public.get_xos_products_for_host(v_host_x || '/../' || v_host_y, 50);
    insert into test_results (test_name, passed, detail) values ('hostname_injection_path_rejected', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('hostname_injection_path_rejected', sqlerrm = 'XOS access denied.', sqlerrm);
  end;
  begin
    perform public.get_xos_products_for_host(v_host_x || '?tenant=' || v_host_y, 50);
    insert into test_results (test_name, passed, detail) values ('hostname_injection_query_rejected', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('hostname_injection_query_rejected', sqlerrm = 'XOS access denied.', sqlerrm);
  end;

  -- ---- Test 8: capability explicitly disabled (Tenant Y) ----
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user_b, 'role', 'authenticated')::text, true);
  begin
    perform public.get_xos_products_for_host(v_host_y, 50);
    insert into test_results (test_name, passed, detail) values ('capability_disabled_denied', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('capability_disabled_denied', sqlerrm = 'Products are not available for this workspace.', sqlerrm);
  end;

  -- ---- Test 9: capability row missing entirely (third disposable tenant) ----
  declare
    v_tenant_z uuid := gen_random_uuid();
    v_host_z text := 'xos3a-test-z.xos.jointx.co.za';
    v_user_c uuid := '5eaa424a-35c4-422d-b8f8-c3e7267d2a7c';
  begin
    insert into public.tenants (id, slug, name, status, settings)
    values (v_tenant_z, 'xos3a-test-tenant-z', 'XOS 3A Test Tenant Z', 'active', '{}'::jsonb);
    insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary)
    values (v_tenant_z, v_host_z, 'xos_admin', 'active', true);
    insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
    values (v_tenant_z, v_user_c, 'owner', 'active');
    -- deliberately NO tenant_capabilities row for Z at all

    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user_c, 'role', 'authenticated')::text, true);
    begin
      perform public.get_xos_products_for_host(v_host_z, 50);
      insert into test_results (test_name, passed, detail) values ('capability_missing_denied', false, 'call unexpectedly succeeded');
    exception when others then
      insert into test_results (test_name, passed, detail) values ('capability_missing_denied', sqlerrm = 'Products are not available for this workspace.', sqlerrm);
    end;
  end;

  -- ---- Test: get_xos_capabilities_for_host returns only enabled keys, tenant-scoped ----
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user_a, 'role', 'authenticated')::text, true);
  v_result := public.get_xos_capabilities_for_host(v_host_x);
  insert into test_results (test_name, passed, detail) values (
    'capabilities_rpc_returns_only_enabled',
    v_result ? 'products' and (v_result->'products'->>'enabled')::boolean = true,
    v_result::text
  );

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user_b, 'role', 'authenticated')::text, true);
  v_result := public.get_xos_capabilities_for_host(v_host_y);
  insert into test_results (test_name, passed, detail) values (
    'capabilities_rpc_omits_disabled',
    not (v_result ? 'products'),
    v_result::text
  );

end $$;

-- ---- Test 15/16: anon and PUBLIC cannot execute the new RPCs ----
insert into test_results (test_name, passed, detail)
select 'anon_cannot_execute_products_rpc', not has_function_privilege('anon', 'public.get_xos_products_for_host(text,integer)', 'EXECUTE'), '';
insert into test_results (test_name, passed, detail)
select 'anon_cannot_execute_capabilities_rpc', not has_function_privilege('anon', 'public.get_xos_capabilities_for_host(text)', 'EXECUTE'), '';

-- ---- Test 17: anon/authenticated cannot directly touch commerce tables or tenant_capabilities ----
insert into test_results (test_name, passed, detail)
select 'anon_no_select_commerce_products', not has_table_privilege('anon', 'commerce.products', 'SELECT'), '';
insert into test_results (test_name, passed, detail)
select 'authenticated_no_select_commerce_products', not has_table_privilege('authenticated', 'commerce.products', 'SELECT'), '';
insert into test_results (test_name, passed, detail)
select 'anon_no_select_commerce_variants', not has_table_privilege('anon', 'commerce.product_variants', 'SELECT'), '';
insert into test_results (test_name, passed, detail)
select 'authenticated_no_select_commerce_variants', not has_table_privilege('authenticated', 'commerce.product_variants', 'SELECT'), '';
insert into test_results (test_name, passed, detail)
select 'anon_no_select_tenant_capabilities', not has_table_privilege('anon', 'public.tenant_capabilities', 'SELECT'), '';
insert into test_results (test_name, passed, detail)
select 'authenticated_no_select_tenant_capabilities', not has_table_privilege('authenticated', 'public.tenant_capabilities', 'SELECT'), '';

-- ---- Test 18: existing XOS functions untouched (signature sanity, not full regression) ----
insert into test_results (test_name, passed, detail)
select 'existing_xos_functions_still_present',
  count(*) = 5,
  string_agg(proname, ',')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('get_xos_orders_for_host','get_xos_requests_for_host','get_xos_files_for_host','create_xos_request_for_host','get_internal_client_requests');

-- ---- Final report ----
select n, test_name, passed, detail from test_results order by n;

select
  count(*) as total_tests,
  count(*) filter (where passed) as passed_count,
  count(*) filter (where not passed) as failed_count
from test_results;

rollback;
