-- XOS 3B — disposable test matrix for product onboarding.
--
-- Assumes migration 20260823120000_xos_3b_product_onboarding.sql has
-- already been applied. Entirely self-contained and disposable: wrapped in
-- one transaction, every fixture (two brand-new disposable tenants, their
-- clients, tenant_domains, tenant_capabilities, tenant_memberships, and a
-- fixture opps product/xlab product) is created and torn down by the final
-- `rollback;` - nothing here persists. Two REAL, existing, already-active
-- Joint X staff auth_user_ids are reused read-only as JWT subs to simulate
-- is_opps_staff() = true (that authority is global, not fixture-scoped -
-- there is no fixture way to grant it); their real memberships are never
-- modified, only additional disposable fixture-tenant memberships are
-- inserted for them inside this transaction. Nothing here touches any real
-- GSB row, and no GSB fixture is created.
--
-- NOT executed as part of this task (production access here is read-only
-- per the XOS 3B brief) - ready to run once write access is authorized:
--   supabase db query --linked --file supabase/tests/xos_3b_product_onboarding.sql
--
-- Item 22 of the XOS 3B test matrix ("existing XOS 3A security matrix
-- remains green") is intentionally NOT re-run here - it is already covered
-- by the separate, already-validated supabase/tests/xos_products_foundation.sql.

begin;

create temporary table test_results (
  n int generated always as identity,
  test_name text,
  passed boolean,
  detail text
);

do $$
declare
  v_tenant_a uuid := gen_random_uuid();
  v_tenant_b uuid := gen_random_uuid();
  v_host_a text := 'xos3b-test-a.xos.jointx.co.za';
  -- real, existing, active Joint X staff auth_user_ids (is_opps_staff()
  -- authority is global/joint-x-tenant-based, not fixture-creatable)
  v_staff uuid := '5eaa424a-35c4-422d-b8f8-c3e7267d2a7c';
  -- authenticated but never given a public.users row -> is_opps_staff() false
  v_non_staff uuid := gen_random_uuid();
  -- member of Tenant B ONLY - distinct from v_non_staff (which is
  -- deliberately a member of BOTH tenants for the staff-gate isolation
  -- test above) so the cross-tenant-visibility test isn't vacuously true.
  v_tenant_b_only_member uuid := gen_random_uuid();
  v_client_a uuid := gen_random_uuid();
  v_client_b uuid := gen_random_uuid();
  v_opps_product_a uuid := gen_random_uuid();
  v_opps_product_b uuid := gen_random_uuid();
  v_xlab_product uuid := gen_random_uuid();
  v_existing_cp uuid := gen_random_uuid();
  v_result jsonb;
  v_result2 jsonb;
  v_cp_id uuid;
  v_baseline_inventory_count bigint;
  v_keys text[];
begin
  -- ---- fixtures: two disposable tenants + one client each ----
  insert into public.tenants (id, slug, name, status, settings)
  values
    (v_tenant_a, 'xos3b-test-tenant-a', 'XOS 3B Test Tenant A', 'active', '{}'::jsonb),
    (v_tenant_b, 'xos3b-test-tenant-b', 'XOS 3B Test Tenant B', 'active', '{}'::jsonb);

  insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary)
  values (v_tenant_a, v_host_a, 'xos_admin', 'active', true);

  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values (v_tenant_a, v_staff, 'owner', 'active');
  -- v_staff deliberately NOT given membership into v_tenant_b - tests cross-tenant denial.
  -- v_non_staff deliberately given membership into BOTH, isolating "staff gate fails first".
  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values
    (v_tenant_a, v_non_staff, 'member', 'active'),
    (v_tenant_b, v_non_staff, 'member', 'active'),
    (v_tenant_b, v_tenant_b_only_member, 'member', 'active');

  insert into public.tenant_capabilities (tenant_id, capability_key, enabled, config)
  values (v_tenant_a, 'products', true, '{}'::jsonb);

  insert into public.clients (id, name, status, tenant_id, portal_enabled, fulfillment_type)
  values
    (v_client_a, 'XOS 3B Test Client A', 'active', v_tenant_a, false, 'delivery'),
    (v_client_b, 'XOS 3B Test Client B', 'active', v_tenant_b, false, 'delivery');

  insert into public.products (id, name, status, tenant_id)
  values
    (v_opps_product_a, 'XOS 3B Test OPPS Product A', 'active', v_tenant_a),
    (v_opps_product_b, 'XOS 3B Test OPPS Product B', 'active', v_tenant_b);

  insert into public.xlab_products (id, name, category, base_price)
  values (v_xlab_product, 'XOS 3B Test XLAB Product', 'apparel', 100);

  insert into public.client_products (id, tenant_id, client_id, client_facing_name, status)
  values (v_existing_cp, v_tenant_a, v_client_a, 'XOS 3B Pre-existing Managed Product', 'draft');

  select count(*) into v_baseline_inventory_count from public.inventory_products;

  -- ---- Test 2: unauthorized authenticated (non-staff) client denied ----
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_non_staff, 'role', 'authenticated', 'email', 'xos3b-nonstaff@jointx.co.za')::text, true);
  begin
    perform public.admin_onboard_client_commerce_product(
      v_client_a, jsonb_build_object('name', 'Should Not Onboard'), '[]'::jsonb,
      null, null, null, 'xos3b-test-key-nonstaff'
    );
    insert into test_results (test_name, passed, detail) values ('non_staff_denied', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('non_staff_denied', sqlerrm like 'ONBOARD_FORBIDDEN: staff access required%', sqlerrm);
  end;

  -- ---- Test 3: staff without Tenant B access cannot onboard for Tenant B client ----
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_staff, 'role', 'authenticated', 'email', 'xos3b-staff@jointx.co.za')::text, true);
  begin
    perform public.admin_onboard_client_commerce_product(
      v_client_b, jsonb_build_object('name', 'Should Not Onboard Tenant B'), '[]'::jsonb,
      null, null, null, 'xos3b-test-key-crosstenant'
    );
    insert into test_results (test_name, passed, detail) values ('cross_tenant_client_denied', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('cross_tenant_client_denied', sqlerrm like 'ONBOARD_FORBIDDEN: tenant access denied%', sqlerrm);
  end;

  -- ---- Test 20a (partial-rows check, part 1): rejected cross-tenant attempt left nothing ----
  insert into test_results (test_name, passed, detail) values (
    'cross_tenant_rejection_left_no_client_product',
    not exists (select 1 from public.client_products where client_id = v_client_b),
    'client_products rows for client_b: ' || (select count(*) from public.client_products where client_id = v_client_b)::text
  );

  -- ---- Test 1: authorized staff onboards a new product for Tenant A client ----
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_staff, 'role', 'authenticated', 'email', 'xos3b-staff@jointx.co.za')::text, true);
  v_result := public.admin_onboard_client_commerce_product(
    v_client_a,
    jsonb_build_object('name', 'XOS 3B Test Tee', 'description', 'A disposable test product.', 'price', 300, 'client_price', 120, 'currency', 'ZAR'),
    jsonb_build_array(
      jsonb_build_object('title', 'Black / M', 'size', 'M', 'color', 'Black', 'sku', 'TEST-BM', 'sort_order', 0),
      jsonb_build_object('title', 'Black / L', 'size', 'L', 'color', 'Black', 'sku', 'TEST-BL', 'sort_order', 1)
    ),
    null, null, null, 'xos3b-test-key-1'
  );
  insert into test_results (test_name, passed, detail) values (
    'staff_onboards_new_product_succeeds',
    v_result ? 'commerce_product_id' and v_result->>'client_product_created' = 'true',
    v_result::text
  );

  -- ---- Test 4: exactly 1 commerce product, 2 variants, 1 client_product, correct link ----
  insert into test_results (test_name, passed, detail) values (
    'exactly_one_commerce_product',
    (select count(*) from commerce.products where id = (v_result->>'commerce_product_id')::uuid) = 1,
    'count=' || (select count(*) from commerce.products where id = (v_result->>'commerce_product_id')::uuid)::text
  );
  insert into test_results (test_name, passed, detail) values (
    'exactly_two_variants',
    (select count(*) from commerce.product_variants where product_id = (v_result->>'commerce_product_id')::uuid) = 2,
    'count=' || (select count(*) from commerce.product_variants where product_id = (v_result->>'commerce_product_id')::uuid)::text
  );
  insert into test_results (test_name, passed, detail) values (
    'exactly_one_client_product_created',
    (select count(*) from public.client_products where id = (v_result->>'client_product_id')::uuid) = 1,
    'client_product_id=' || (v_result->>'client_product_id')
  );
  insert into test_results (test_name, passed, detail) values (
    'client_product_link_correct',
    exists (
      select 1 from commerce.product_links
      where commerce_product_id = (v_result->>'commerce_product_id')::uuid
        and system_key = 'client_product'
        and external_id = v_result->>'client_product_id'
    ),
    'link check for ' || (v_result->>'commerce_product_id')
  );

  -- ---- Test 5: replay same idempotency key + same payload -> no duplicates ----
  v_result2 := public.admin_onboard_client_commerce_product(
    v_client_a,
    jsonb_build_object('name', 'XOS 3B Test Tee', 'description', 'A disposable test product.', 'price', 300, 'client_price', 120, 'currency', 'ZAR'),
    jsonb_build_array(
      jsonb_build_object('title', 'Black / M', 'size', 'M', 'color', 'Black', 'sku', 'TEST-BM', 'sort_order', 0),
      jsonb_build_object('title', 'Black / L', 'size', 'L', 'color', 'Black', 'sku', 'TEST-BL', 'sort_order', 1)
    ),
    null, null, null, 'xos3b-test-key-1'
  );
  insert into test_results (test_name, passed, detail) values (
    'replay_same_key_same_payload_no_duplicate',
    v_result2 = v_result
      and (select count(*) from commerce.products where id = (v_result->>'commerce_product_id')::uuid) = 1
      and (select count(*) from public.client_products where id = (v_result->>'client_product_id')::uuid) = 1,
    v_result2::text
  );

  -- ---- Test 6: same idempotency key + changed payload -> rejected ----
  begin
    perform public.admin_onboard_client_commerce_product(
      v_client_a,
      jsonb_build_object('name', 'XOS 3B Test Tee CHANGED', 'price', 999),
      '[]'::jsonb,
      null, null, null, 'xos3b-test-key-1'
    );
    insert into test_results (test_name, passed, detail) values ('replay_same_key_changed_payload_rejected', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('replay_same_key_changed_payload_rejected', sqlerrm like 'ONBOARD_IDEMPOTENCY_CONFLICT%', sqlerrm);
  end;

  -- ---- Test 12: no OPPS mapping is valid, yields needs_opps_mapping ----
  insert into test_results (test_name, passed, detail) values (
    'no_opps_mapping_yields_needs_opps_mapping',
    v_result->>'integration_status' = 'needs_opps_mapping' and v_result->>'opps_linked' = 'false',
    v_result::text
  );

  -- ---- Test 13/14: retail price and client price are independent, neither overwrites the other ----
  insert into test_results (test_name, passed, detail) values (
    'retail_price_and_client_price_independent',
    (select price from commerce.products where id = (v_result->>'commerce_product_id')::uuid) = 300
      and (select client_price from public.client_products where id = (v_result->>'client_product_id')::uuid) = 120,
    'commerce.price=' || (select price from commerce.products where id = (v_result->>'commerce_product_id')::uuid)::text
      || ' client_products.client_price=' || (select client_price from public.client_products where id = (v_result->>'client_product_id')::uuid)::text
  );

  -- ---- Test 7: existing client_product onboarding does not create a duplicate CP ----
  v_result2 := public.admin_onboard_client_commerce_product(
    v_client_a,
    jsonb_build_object('name', 'XOS 3B Pre-existing Managed Product'),
    '[]'::jsonb,
    v_existing_cp, null, null, 'xos3b-test-key-existing-cp'
  );
  insert into test_results (test_name, passed, detail) values (
    'existing_client_product_no_duplicate',
    v_result2->>'client_product_id' = v_existing_cp::text
      and v_result2->>'client_product_created' = 'false'
      and (select count(*) from public.client_products where id = v_existing_cp) = 1,
    v_result2::text
  );

  -- ---- Test 8: same-tenant existing OPPS product link succeeds ----
  v_result2 := public.admin_onboard_client_commerce_product(
    v_client_a,
    jsonb_build_object('name', 'XOS 3B Pre-existing Managed Product'),
    '[]'::jsonb,
    v_existing_cp, v_opps_product_a, null, 'xos3b-test-key-opps-link'
  );
  insert into test_results (test_name, passed, detail) values (
    'same_tenant_opps_link_succeeds',
    v_result2->>'opps_linked' = 'true' and v_result2->>'integration_status' = 'complete',
    v_result2::text
  );
  insert into test_results (test_name, passed, detail) values (
    'opps_product_id_persisted_on_client_product',
    (select opps_product_id from public.client_products where id = v_existing_cp) = v_opps_product_a,
    'opps_product_id=' || (select opps_product_id::text from public.client_products where id = v_existing_cp)
  );

  -- ---- Test 9: cross-tenant OPPS product rejected ----
  begin
    perform public.admin_onboard_client_commerce_product(
      v_client_a, jsonb_build_object('name', 'Cross Tenant OPPS Attempt'), '[]'::jsonb,
      null, v_opps_product_b, null, 'xos3b-test-key-opps-crosstenant'
    );
    insert into test_results (test_name, passed, detail) values ('cross_tenant_opps_rejected', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('cross_tenant_opps_rejected', sqlerrm like 'ONBOARD_OPPS_PRODUCT_TENANT_MISMATCH%', sqlerrm);
  end;

  -- ---- Test 20b: rejected cross-tenant OPPS attempt left no partial rows ----
  insert into test_results (test_name, passed, detail) values (
    'cross_tenant_opps_rejection_left_no_rows',
    not exists (select 1 from commerce.onboarding_operations where idempotency_key = 'xos3b-test-key-opps-crosstenant')
      and not exists (select 1 from public.client_products where client_facing_name = 'Cross Tenant OPPS Attempt'),
    'checked absence for xos3b-test-key-opps-crosstenant'
  );

  -- ---- Test 10: existing X LAB product link succeeds ----
  v_result2 := public.admin_onboard_client_commerce_product(
    v_client_a,
    jsonb_build_object('name', 'XOS 3B XLAB Linked Product'),
    '[]'::jsonb,
    null, null, v_xlab_product, 'xos3b-test-key-xlab-link'
  );
  insert into test_results (test_name, passed, detail) values (
    'existing_xlab_link_succeeds',
    v_result2->>'xlab_linked' = 'true'
      and exists (
        select 1 from commerce.product_links
        where commerce_product_id = (v_result2->>'commerce_product_id')::uuid
          and system_key = 'xlab_product' and external_id = v_xlab_product::text
      ),
    v_result2::text
  );

  -- ---- Test 11: missing X LAB product rejected ----
  begin
    perform public.admin_onboard_client_commerce_product(
      v_client_a, jsonb_build_object('name', 'Missing XLAB Attempt'), '[]'::jsonb,
      null, null, gen_random_uuid(), 'xos3b-test-key-xlab-missing'
    );
    insert into test_results (test_name, passed, detail) values ('missing_xlab_rejected', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('missing_xlab_rejected', sqlerrm like 'ONBOARD_XLAB_PRODUCT_NOT_FOUND%', sqlerrm);
  end;

  -- ---- Test 15: commerce variants create no inventory rows ----
  insert into test_results (test_name, passed, detail) values (
    'no_inventory_rows_created',
    (select count(*) from public.inventory_products) = v_baseline_inventory_count,
    'baseline=' || v_baseline_inventory_count::text || ' after=' || (select count(*) from public.inventory_products)::text
  );

  -- ---- Test 16/17: published test product visible via XOS product RPC, no internal fields leaked ----
  v_result2 := public.admin_onboard_client_commerce_product(
    v_client_a,
    jsonb_build_object('name', 'XOS 3B Published Test Product', 'price', 500, 'status', 'published'),
    '[]'::jsonb,
    null, null, null, 'xos3b-test-key-published'
  );
  v_cp_id := (v_result2->>'commerce_product_id')::uuid;

  v_result := public.get_xos_products_for_host(v_host_a, 50);
  insert into test_results (test_name, passed, detail) values (
    'published_product_visible_via_xos_rpc',
    exists (select 1 from jsonb_array_elements(v_result) e where e->>'id' = v_cp_id::text),
    v_result::text
  );
  select array(select jsonb_object_keys(e)) into v_keys
  from jsonb_array_elements(v_result) e where e->>'id' = v_cp_id::text;
  insert into test_results (test_name, passed, detail) values (
    'xos_rpc_hides_internal_mapping_fields',
    v_keys <@ array['id','slug','name','description','price','sale_price','currency','primary_image_url','availability','status','variants']
      and not (select bool_or(e ? 'client_product_id' or e ? 'opps_product_id' or e ? 'xlab_product_id' or e ? 'source_system' or e ? 'source_ref' or e ? 'tenant_id')
               from jsonb_array_elements(v_result) e),
    array_to_string(v_keys, ',')
  );

  -- ---- Test 18: Tenant B member cannot see Tenant A product via XOS RPC ----
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_tenant_b_only_member, 'role', 'authenticated', 'email', 'xos3b-tenantb@jointx.co.za')::text, true);
  begin
    perform public.get_xos_products_for_host(v_host_a, 50);
    insert into test_results (test_name, passed, detail) values ('tenant_b_cannot_see_tenant_a_product', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('tenant_b_cannot_see_tenant_a_product', sqlerrm = 'XOS access denied.', sqlerrm);
  end;

  -- ---- Test 19: audit row created for successful onboarding ----
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_staff, 'role', 'authenticated', 'email', 'xos3b-staff@jointx.co.za')::text, true);
  insert into test_results (test_name, passed, detail) values (
    'audit_row_created',
    exists (
      select 1 from public.opps_activity_events
      where event_type = 'xos_commerce_product_onboarded'
        and entity_id = (v_result2->>'commerce_product_id')::uuid
        and metadata ->> 'idempotency_key' = 'xos3b-test-key-published'
    ),
    'checked audit row for xos3b-test-key-published'
  );

end;
$$;

select * from test_results order by n;

-- ---- Test 21: transaction rollback leaves zero disposable test artifacts ----
-- Guaranteed structurally by this rollback itself, not by an assertion
-- inside test_results (there is nothing left afterward to assert against).
rollback;
