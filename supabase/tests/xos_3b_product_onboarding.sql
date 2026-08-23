-- XOS 3B — disposable test matrix for product onboarding.
--
-- Assumes migration 20260823120000_xos_3b_product_onboarding.sql has
-- already been applied. Entirely self-contained and disposable: wrapped in
-- one transaction, every fixture - including auth identities - is created
-- and torn down by the final `rollback;`; nothing here persists.
--
-- Post-review correction: an earlier revision of this file inserted
-- synthetic gen_random_uuid()s directly into public.tenant_memberships as
-- auth_user_id. That violates the real FK
-- (tenant_memberships.auth_user_id -> auth.users(id) on delete cascade) -
-- confirmed via pg_constraint, not the (misleading, cross-schema-unreliable)
-- information_schema.constraint_column_usage view this repo's earlier
-- verification pass used. This revision creates genuinely disposable
-- auth.users + public.users rows for every simulated identity instead of
-- relying on any real production account. Nothing here touches real GSB
-- auth/users/memberships, and no GSB fixture is created.
--
-- Also corrects the authorization tests themselves to the corrected
-- internal authority contract (is_opps_staff() alone, tenant always
-- resolved server-side from public.clients - see the migration's header
-- note): Joint X OPPS staff can manage a managed client tenant without
-- being a member of that target tenant; a normal authenticated tenant
-- owner/client still cannot call the admin RPCs; tenant and external
-- mapping integrity still cannot be overridden by supplied IDs.
--
-- NOT executed as part of this task (production access here is read-only
-- per the XOS 3B brief) - ready to run once write access is authorized:
--   supabase db query --linked --file supabase/tests/xos_3b_product_onboarding.sql
--
-- Item 22 of the original XOS 3B test matrix ("existing XOS 3A security
-- matrix remains green") is intentionally NOT re-run here - it is already
-- covered by the separate, already-validated
-- supabase/tests/xos_products_foundation.sql.
--
-- A failed assertion here does not just get recorded silently - the final
-- block raises if any test_results row did not pass, so this script
-- returns a non-zero/error result to the caller on failure. The trailing
-- `rollback;` still runs either way (ROLLBACK is valid even against an
-- aborted transaction), so nothing persists regardless of pass/fail.

begin;

create temporary table test_results (
  n int generated always as identity,
  test_name text,
  passed boolean,
  detail text
);

do $$
declare
  v_joint_x_tenant_id uuid;
  v_tenant_a uuid := gen_random_uuid();
  v_tenant_b uuid := gen_random_uuid();
  v_host_a text := 'xos3b-test-a.xos.jointx.co.za';

  -- Disposable auth identities (rolled back with everything else) - see
  -- header note. None of these are real accounts.
  v_staff uuid := gen_random_uuid();
  v_non_staff uuid := gen_random_uuid();
  v_tenant_a_owner uuid := gen_random_uuid();
  v_tenant_b_only_member uuid := gen_random_uuid();

  v_client_a uuid := gen_random_uuid();
  v_client_b uuid := gen_random_uuid();
  v_opps_product_a uuid := gen_random_uuid();
  v_opps_product_a2 uuid := gen_random_uuid();
  v_opps_product_a3 uuid := gen_random_uuid();
  v_opps_product_b uuid := gen_random_uuid();
  v_xlab_product uuid := gen_random_uuid();
  v_xlab_product_2 uuid := gen_random_uuid();
  v_existing_cp uuid := gen_random_uuid();

  v_result jsonb;
  v_result2 jsonb;
  v_result3 jsonb;
  v_cp_id uuid;
  v_baseline_inventory_count bigint;
  v_keys text[];

  -- item 6 (non-destructive mapping-only update) snapshot vars
  v_snapshot_name text; v_snapshot_description text; v_snapshot_price numeric;
  v_snapshot_sale_price numeric; v_snapshot_currency text; v_snapshot_image text;
  v_snapshot_availability text; v_snapshot_status text; v_snapshot_slug text;
  v_snapshot_variant_ids uuid[];
  v_after_variant_ids uuid[];
begin
  select id into v_joint_x_tenant_id from public.tenants where slug = 'joint-x';
  if v_joint_x_tenant_id is null then
    raise exception 'XOS_3B_TEST_SETUP: real joint-x tenant not found - cannot simulate is_opps_staff()';
  end if;

  -- ---- fixtures: disposable auth identities ----
  insert into auth.users (id, email, aud, role) values
    (v_staff, 'xos3b-test-staff@disposable.test', 'authenticated', 'authenticated'),
    (v_non_staff, 'xos3b-test-nonstaff@disposable.test', 'authenticated', 'authenticated'),
    (v_tenant_a_owner, 'xos3b-test-tenant-a-owner@disposable.test', 'authenticated', 'authenticated'),
    (v_tenant_b_only_member, 'xos3b-test-tenant-b-member@disposable.test', 'authenticated', 'authenticated');

  -- public.users row ONLY for v_staff - is_opps_staff() requires a match
  -- here, so v_non_staff/v_tenant_a_owner/v_tenant_b_only_member (no row)
  -- deterministically fail it regardless of any tenant_memberships they hold.
  insert into public.users (auth_user_id, user_email, full_name, is_active)
  values (v_staff, 'xos3b-test-staff@disposable.test', 'XOS 3B Test Staff', true);

  -- v_staff's ONLY membership is the real joint-x tenant (is_opps_staff()
  -- authority) - deliberately NO membership in v_tenant_a/v_tenant_b, to
  -- prove staff can manage a managed tenant without belonging to it.
  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values (v_joint_x_tenant_id, v_staff, 'member', 'active');

  -- ---- fixtures: two disposable tenants + one client each ----
  insert into public.tenants (id, slug, name, status, settings)
  values
    (v_tenant_a, 'xos3b-test-tenant-a', 'XOS 3B Test Tenant A', 'active', '{}'::jsonb),
    (v_tenant_b, 'xos3b-test-tenant-b', 'XOS 3B Test Tenant B', 'active', '{}'::jsonb);

  insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary)
  values (v_tenant_a, v_host_a, 'xos_admin', 'active', true);

  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values
    (v_tenant_a, v_tenant_a_owner, 'owner', 'active'),
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
    (v_opps_product_a2, 'XOS 3B Test OPPS Product A2', 'active', v_tenant_a),
    (v_opps_product_a3, 'XOS 3B Test OPPS Product A3', 'active', v_tenant_a),
    (v_opps_product_b, 'XOS 3B Test OPPS Product B', 'active', v_tenant_b);

  insert into public.xlab_products (id, name, category, base_price)
  values
    (v_xlab_product, 'XOS 3B Test XLAB Product', 'apparel', 100),
    (v_xlab_product_2, 'XOS 3B Test XLAB Product 2', 'apparel', 150);

  insert into public.client_products (id, tenant_id, client_id, client_facing_name, status)
  values (v_existing_cp, v_tenant_a, v_client_a, 'XOS 3B Pre-existing Managed Product', 'draft');

  select count(*) into v_baseline_inventory_count from public.inventory_products;

  ---- ================================================================
  ---- Authority contract (corrected)
  ---- ================================================================

  -- ---- Test: non-staff (authenticated, no public.users row) denied ----
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_non_staff, 'role', 'authenticated', 'email', 'xos3b-nonstaff@disposable.test')::text, true);
  begin
    perform public.admin_onboard_client_commerce_product(
      v_client_a, jsonb_build_object('name', 'Should Not Onboard'), '[]'::jsonb,
      null, null, null, 'xos3b-test-key-nonstaff'
    );
    insert into test_results (test_name, passed, detail) values ('non_staff_denied', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('non_staff_denied', sqlerrm like 'ONBOARD_FORBIDDEN: staff access required%', sqlerrm);
  end;

  -- ---- Test: normal tenant owner (real membership, not joint-x staff) denied ----
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_tenant_a_owner, 'role', 'authenticated', 'email', 'xos3b-tenant-a-owner@disposable.test')::text, true);
  begin
    perform public.admin_onboard_client_commerce_product(
      v_client_a, jsonb_build_object('name', 'Should Not Onboard Either'), '[]'::jsonb,
      null, null, null, 'xos3b-test-key-tenantowner'
    );
    insert into test_results (test_name, passed, detail) values ('tenant_owner_denied', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('tenant_owner_denied', sqlerrm like 'ONBOARD_FORBIDDEN: staff access required%', sqlerrm);
  end;

  -- ---- Test: staff can onboard for a client whose tenant they hold NO membership in ----
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_staff, 'role', 'authenticated', 'email', 'xos3b-staff@disposable.test')::text, true);
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
    'staff_onboards_without_target_tenant_membership',
    v_result ? 'commerce_product_id' and v_result->>'client_product_created' = 'true',
    v_result::text
  );

  -- ---- Test: same staff, no membership in Tenant B either, still succeeds for Tenant B's client ----
  v_result3 := public.admin_onboard_client_commerce_product(
    v_client_b, jsonb_build_object('name', 'XOS 3B Tenant B Cross-Tenant-Staff Product'), '[]'::jsonb,
    null, null, null, 'xos3b-test-key-staff-crosstenant-b'
  );
  insert into test_results (test_name, passed, detail) values (
    'staff_manages_second_tenant_without_membership',
    v_result3 ? 'commerce_product_id',
    v_result3::text
  );

  ---- ================================================================
  ---- Core onboarding / idempotency / non-duplication
  ---- ================================================================

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

  -- ---- replay same idempotency key + same payload -> no duplicates, one product ----
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
    'stable_idempotent_replay_returns_one_product',
    v_result2 = v_result
      and (select count(*) from commerce.products where id = (v_result->>'commerce_product_id')::uuid) = 1
      and (select count(*) from public.client_products where id = (v_result->>'client_product_id')::uuid) = 1,
    v_result2::text
  );

  -- ---- same idempotency key + changed payload -> rejected ----
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

  insert into test_results (test_name, passed, detail) values (
    'no_opps_mapping_yields_needs_opps_mapping',
    v_result->>'integration_status' = 'needs_opps_mapping' and v_result->>'opps_linked' = 'false',
    v_result::text
  );

  insert into test_results (test_name, passed, detail) values (
    'retail_price_and_client_price_independent',
    (select price from commerce.products where id = (v_result->>'commerce_product_id')::uuid) = 300
      and (select client_price from public.client_products where id = (v_result->>'client_product_id')::uuid) = 120,
    'commerce.price=' || (select price from commerce.products where id = (v_result->>'commerce_product_id')::uuid)::text
      || ' client_products.client_price=' || (select client_price from public.client_products where id = (v_result->>'client_product_id')::uuid)::text
  );

  -- ---- existing client_product onboarding does not create a duplicate CP ----
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

  ---- ================================================================
  ---- OPPS link: tenant integrity + deterministic conflict handling
  ---- ================================================================

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

  begin
    perform public.admin_onboard_client_commerce_product(
      v_client_a, jsonb_build_object('name', 'Cross Tenant OPPS Attempt'), '[]'::jsonb,
      null, v_opps_product_b, null, 'xos3b-test-key-opps-crosstenant'
    );
    insert into test_results (test_name, passed, detail) values ('cross_tenant_opps_rejected', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('cross_tenant_opps_rejected', sqlerrm like 'ONBOARD_OPPS_PRODUCT_TENANT_MISMATCH%', sqlerrm);
  end;
  insert into test_results (test_name, passed, detail) values (
    'cross_tenant_opps_rejection_left_no_rows',
    not exists (select 1 from commerce.onboarding_operations where idempotency_key = 'xos3b-test-key-opps-crosstenant')
      and not exists (select 1 from public.client_products where client_facing_name = 'Cross Tenant OPPS Attempt'),
    'checked absence for xos3b-test-key-opps-crosstenant'
  );

  -- ---- OPPS external id already linked to a DIFFERENT commerce product -> ONBOARD_LINK_CONFLICT ----
  v_result3 := public.admin_onboard_client_commerce_product(
    v_client_a, jsonb_build_object('name', 'XOS 3B OPPS Conflict Source Product'), '[]'::jsonb,
    null, v_opps_product_a2, null, 'xos3b-test-key-opps-conflict-source'
  );
  begin
    perform public.admin_onboard_client_commerce_product(
      v_client_a, jsonb_build_object('name', 'XOS 3B OPPS Conflict Target Product'), '[]'::jsonb,
      null, v_opps_product_a2, null, 'xos3b-test-key-opps-conflict-target'
    );
    insert into test_results (test_name, passed, detail) values ('opps_link_conflict_rejected', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('opps_link_conflict_rejected', sqlerrm like 'ONBOARD_LINK_CONFLICT%', sqlerrm);
  end;
  insert into test_results (test_name, passed, detail) values (
    'opps_link_conflict_left_no_rows',
    not exists (select 1 from public.client_products where client_facing_name = 'XOS 3B OPPS Conflict Target Product'),
    'checked absence for the rejected target product'
  );

  ---- ================================================================
  ---- X LAB template: reuse across products, one-per-product cardinality
  ---- ================================================================

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

  begin
    perform public.admin_onboard_client_commerce_product(
      v_client_a, jsonb_build_object('name', 'Missing XLAB Attempt'), '[]'::jsonb,
      null, null, gen_random_uuid(), 'xos3b-test-key-xlab-missing'
    );
    insert into test_results (test_name, passed, detail) values ('missing_xlab_rejected', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('missing_xlab_rejected', sqlerrm like 'ONBOARD_XLAB_PRODUCT_NOT_FOUND%', sqlerrm);
  end;

  -- ---- the SAME X LAB template can link to a SECOND, different commerce product in the same tenant ----
  v_result3 := public.admin_onboard_client_commerce_product(
    v_client_a,
    jsonb_build_object('name', 'XOS 3B XLAB Second Product Same Template'),
    '[]'::jsonb,
    null, null, v_xlab_product, 'xos3b-test-key-xlab-reuse'
  );
  insert into test_results (test_name, passed, detail) values (
    'same_xlab_template_links_two_products',
    v_result3->>'xlab_linked' = 'true'
      and v_result3->>'commerce_product_id' <> v_result2->>'commerce_product_id'
      and (
        select count(distinct commerce_product_id) from commerce.product_links
        where system_key = 'xlab_product' and external_id = v_xlab_product::text
      ) = 2,
    'first=' || (v_result2->>'commerce_product_id') || ' second=' || (v_result3->>'commerce_product_id')
  );

  -- ---- one commerce product cannot carry two DIFFERENT X LAB templates ----
  -- (direct unit test of commerce.ensure_product_link/constraint C - the
  -- full RPC's ensure-mapping semantics never re-target an already-set
  -- client_products.xlab_product_id, so this state is only reachable by
  -- exercising the underlying helper/constraint directly, which is
  -- exactly what needs to be proven structurally impossible)
  begin
    perform commerce.ensure_product_link(
      (v_result2->>'commerce_product_id')::uuid, v_tenant_a, 'xlab_product', v_xlab_product_2::text, false
    );
    insert into test_results (test_name, passed, detail) values ('one_commerce_product_rejects_second_xlab_template', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('one_commerce_product_rejects_second_xlab_template', sqlerrm like 'ONBOARD_LINK_CONFLICT%', sqlerrm);
  end;

  ---- ================================================================
  ---- Non-destructive mapping-only update (item 6)
  ---- ================================================================

  v_result3 := public.admin_onboard_client_commerce_product(
    v_client_a,
    jsonb_build_object(
      'name', 'XOS 3B Mapping Preservation Product', 'description', 'Original description.',
      'price', 450, 'sale_price', 399, 'primary_image_url', 'https://example.com/original.jpg',
      'status', 'published', 'availability', 'available'
    ),
    jsonb_build_array(
      jsonb_build_object('title', 'Only Variant', 'size', 'M', 'color', 'White', 'sku', 'PRESERVE-1', 'sort_order', 0)
    ),
    null, null, null, 'xos3b-test-key-preserve-source'
  );
  v_cp_id := (v_result3->>'commerce_product_id')::uuid;

  select name, description, price, sale_price, currency, primary_image_url, availability, status, slug
  into v_snapshot_name, v_snapshot_description, v_snapshot_price, v_snapshot_sale_price,
       v_snapshot_currency, v_snapshot_image, v_snapshot_availability, v_snapshot_status, v_snapshot_slug
  from commerce.products where id = v_cp_id;
  select array_agg(id order by id) into v_snapshot_variant_ids from commerce.product_variants where product_id = v_cp_id;

  -- mapping-only call: no p_product keys at all, p_variants omitted (NULL) -
  -- adds an OPPS mapping and nothing else.
  perform public.admin_onboard_client_commerce_product(
    v_client_a, '{}'::jsonb, null,
    (v_result3->>'client_product_id')::uuid,
    v_opps_product_a3, null, 'xos3b-test-key-preserve-mapping-only'
  );

  select array_agg(id order by id) into v_after_variant_ids from commerce.product_variants where product_id = v_cp_id;

  insert into test_results (test_name, passed, detail) values (
    'mapping_only_preserves_commerce_fields',
    (select
       name is not distinct from v_snapshot_name
       and description is not distinct from v_snapshot_description
       and price is not distinct from v_snapshot_price
       and sale_price is not distinct from v_snapshot_sale_price
       and currency is not distinct from v_snapshot_currency
       and primary_image_url is not distinct from v_snapshot_image
       and availability is not distinct from v_snapshot_availability
       and status is not distinct from v_snapshot_status
       and slug is not distinct from v_snapshot_slug
     from commerce.products where id = v_cp_id),
    (select row_to_json(commerce.products.*)::text from commerce.products where id = v_cp_id)
  );
  insert into test_results (test_name, passed, detail) values (
    'mapping_only_preserves_variants',
    v_after_variant_ids = v_snapshot_variant_ids,
    'before=' || v_snapshot_variant_ids::text || ' after=' || v_after_variant_ids::text
  );
  insert into test_results (test_name, passed, detail) values (
    'mapping_only_actually_added_opps_mapping',
    exists (select 1 from commerce.product_links where commerce_product_id = v_cp_id and system_key = 'opps_product' and external_id = v_opps_product_a3::text),
    'checked opps link for mapping-only product'
  );

  ---- ================================================================
  ---- Inventory / XOS client RPC boundary (unchanged behavior)
  ---- ================================================================

  insert into test_results (test_name, passed, detail) values (
    'no_inventory_rows_created',
    (select count(*) from public.inventory_products) = v_baseline_inventory_count,
    'baseline=' || v_baseline_inventory_count::text || ' after=' || (select count(*) from public.inventory_products)::text
  );

  v_result2 := public.admin_onboard_client_commerce_product(
    v_client_a,
    jsonb_build_object('name', 'XOS 3B Published Test Product', 'price', 500, 'status', 'published'),
    '[]'::jsonb,
    null, null, null, 'xos3b-test-key-published'
  );
  v_cp_id := (v_result2->>'commerce_product_id')::uuid;

  -- get_xos_products_for_host requires the caller to actually be a member
  -- of Tenant A (unlike the admin RPCs above, its authority model is
  -- unchanged) - v_staff deliberately holds no such membership, so switch
  -- to v_tenant_a_owner, the fixture identity that genuinely has one.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_tenant_a_owner, 'role', 'authenticated', 'email', 'xos3b-tenant-a-owner@disposable.test')::text, true);
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

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_tenant_b_only_member, 'role', 'authenticated', 'email', 'xos3b-tenantb@disposable.test')::text, true);
  begin
    perform public.get_xos_products_for_host(v_host_a, 50);
    insert into test_results (test_name, passed, detail) values ('tenant_b_cannot_see_tenant_a_product', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('tenant_b_cannot_see_tenant_a_product', sqlerrm = 'XOS access denied.', sqlerrm);
  end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_staff, 'role', 'authenticated', 'email', 'xos3b-staff@disposable.test')::text, true);
  insert into test_results (test_name, passed, detail) values (
    'audit_row_created',
    exists (
      select 1 from public.opps_activity_events
      where event_type = 'xos_commerce_product_onboarded'
        and entity_id = v_cp_id
        and metadata ->> 'idempotency_key' = 'xos3b-test-key-published'
    ),
    'checked audit row for xos3b-test-key-published'
  );

  insert into test_results (test_name, passed, detail) values (
    'disposable_fixture_no_real_auth_dependency',
    v_staff not in (
      '5eaa424a-35c4-422d-b8f8-c3e7267d2a7c'::uuid, '7b6275a4-3f22-4c98-91a9-fc8c98aec424'::uuid,
      'defdceab-cddf-4863-9f2e-7473b6e2818d'::uuid, '202ca0b1-a9f1-4321-80b8-cdcd2c66a98e'::uuid,
      '2e7f49f6-1bee-456a-8d3b-a623a8df0dec'::uuid
    ),
    'v_staff=' || v_staff::text || ' is a fresh disposable identity, not a reused real one'
  );
end;
$$;

select * from test_results order by n;

-- Explicit pass/fail gate (item 8): a failed assertion must fail the
-- command, not just sit quietly in test_results.
do $$
declare
  v_failed int;
  v_total int;
  v_failed_names text;
begin
  select count(*) filter (where passed is distinct from true), count(*)
  into v_failed, v_total
  from test_results;

  if v_failed > 0 then
    select string_agg(test_name, ', ') into v_failed_names from test_results where passed is distinct from true;
    raise exception 'XOS_3B_TEST_FAILURE: % of % tests failed: %', v_failed, v_total, v_failed_names;
  end if;
end;
$$;

rollback;
