-- XOS onboarding canonical-identity amendment — disposable test matrix.
--
-- Assumes 20260823120000_xos_3b_product_onboarding.sql (base RPC) and
-- 20260829090000_xos_onboarding_canonical_identity.sql (this amendment)
-- have already been applied. Rollback-wrapped, matching the established
-- convention (xos_3b_product_onboarding.sql): every fixture, including
-- auth identities, is created and torn down by the final `rollback;` -
-- nothing here persists. GSB is NEVER referenced anywhere in this file -
-- not even read-only - every mutation targets a disposable tenant/client
-- fixture created fresh inside this transaction.
--
-- NOT executed as part of this task - production is read-only during
-- implementation/review, and this migration has not been applied.
-- Ready to run once explicitly authorized:
--   supabase db query --linked --file supabase/tests/xos_onboarding_canonical_identity.sql

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
  v_slug_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  v_staff uuid := gen_random_uuid();
  v_client_a uuid := gen_random_uuid();
  v_opps_product_a uuid := gen_random_uuid();

  v_result jsonb;
  v_result2 jsonb;
  v_result3 jsonb;
  v_row commerce.products;
  v_count int;
begin
  select id into v_joint_x_tenant_id from public.tenants where slug = 'joint-x';
  if v_joint_x_tenant_id is null then
    raise exception 'ONBOARDING_CANONICAL_IDENTITY_TEST_SETUP: real joint-x tenant not found - cannot simulate is_opps_staff()';
  end if;

  -- ---- fixtures: disposable staff identity (same pattern as xos_3b) ----
  insert into auth.users (id, email, aud, role)
  values (v_staff, 'onb-canon-staff-' || v_slug_suffix || '@disposable.test', 'authenticated', 'authenticated');

  insert into public.users (auth_user_id, user_email, full_name, is_active)
  values (v_staff, 'onb-canon-staff-' || v_slug_suffix || '@disposable.test', 'Onboarding Canonical Identity Test Staff', true);

  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values (v_joint_x_tenant_id, v_staff, 'member', 'active')
  on conflict (tenant_id, auth_user_id) do nothing;

  -- ---- fixtures: one disposable tenant + client (never GSB) ----
  insert into public.tenants (id, slug, name, status, settings)
  values (v_tenant_a, 'onb-canon-test-' || v_slug_suffix, 'Onboarding Canonical Identity Test Tenant', 'active', '{}'::jsonb);

  insert into public.clients (id, name, status, tenant_id, portal_enabled, fulfillment_type)
  values (v_client_a, 'Onboarding Canonical Identity Test Client', 'active', v_tenant_a, false, 'courier');

  insert into public.products (id, name, status, tenant_id)
  values (v_opps_product_a, 'Onboarding Canonical Identity Test OPPS Product', 'active', v_tenant_a);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_staff, 'role', 'authenticated', 'email', 'onb-canon-staff-' || v_slug_suffix || '@disposable.test')::text, true);

  -- ===================================================================
  -- 1/2 - supplied canonical slug AND source_system/source_ref preserved
  -- exactly for a brand new product.
  -- ===================================================================
  v_result := public.admin_onboard_client_commerce_product(
    v_client_a,
    jsonb_build_object(
      'name', 'Canonical Identity Product One', 'price', 100,
      'slug', 'canonical-one-' || v_slug_suffix,
      'source_system', 'gsb_local_catalog', 'source_ref', 'legacy-slug-one-' || v_slug_suffix
    ),
    null, null, null, null,
    'onb-canon-key-1-' || v_slug_suffix
  );
  insert into test_results (test_name, passed, detail) values (
    'supplied_canonical_slug_preserved_exactly',
    (v_result ->> 'slug') = 'canonical-one-' || v_slug_suffix,
    'returned slug=' || (v_result ->> 'slug')
  );

  select * into v_row from commerce.products where id = (v_result ->> 'commerce_product_id')::uuid;
  insert into test_results (test_name, passed, detail) values (
    'supplied_source_system_and_source_ref_preserved_exactly',
    v_row.source_system = 'gsb_local_catalog' and v_row.source_ref = 'legacy-slug-one-' || v_slug_suffix,
    'source_system=' || v_row.source_system || ' source_ref=' || v_row.source_ref
  );

  -- ===================================================================
  -- 3 - supplied slug violating the commerce.products slug format is
  -- rejected with a clear onboarding-specific error.
  -- ===================================================================
  begin
    perform public.admin_onboard_client_commerce_product(
      v_client_a,
      jsonb_build_object('name', 'Bad Slug Product', 'price', 100, 'slug', 'Not A Valid Slug!'),
      null, null, null, null,
      'onb-canon-key-badslug-' || v_slug_suffix
    );
    insert into test_results (test_name, passed, detail) values ('supplied_slug_bad_format_rejected', false, 'call unexpectedly succeeded with an invalid slug format');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('supplied_slug_bad_format_rejected', sqlerrm like 'ONBOARD_SLUG_INVALID%', sqlerrm);
  end;

  -- ===================================================================
  -- 4 - supplied slug collision rejected outright, never auto-suffixed.
  -- ===================================================================
  begin
    perform public.admin_onboard_client_commerce_product(
      v_client_a,
      jsonb_build_object('name', 'Canonical Identity Product One Duplicate', 'price', 200, 'slug', 'canonical-one-' || v_slug_suffix),
      null, null, null, null,
      'onb-canon-key-slugcollision-' || v_slug_suffix
    );
    insert into test_results (test_name, passed, detail) values ('supplied_slug_collision_rejected_not_suffixed', false, 'call unexpectedly succeeded with a colliding slug');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('supplied_slug_collision_rejected_not_suffixed', sqlerrm like 'ONBOARD_SLUG_COLLISION%', sqlerrm);
  end;
  insert into test_results (test_name, passed, detail) values (
    'supplied_slug_collision_left_no_auto_suffixed_row_behind',
    not exists (select 1 from commerce.products where tenant_id = v_tenant_a and slug = 'canonical-one-' || v_slug_suffix || '-2'),
    'confirmed no "canonical-one-...-2" row was silently created instead of failing'
  );

  -- ===================================================================
  -- 5 - supplied source identity collision rejected (same source_system
  -- + source_ref pair, different slug, different idempotency key).
  -- ===================================================================
  begin
    perform public.admin_onboard_client_commerce_product(
      v_client_a,
      jsonb_build_object(
        'name', 'Canonical Identity Product One Alt Slug', 'price', 150,
        'slug', 'canonical-one-alt-' || v_slug_suffix,
        'source_system', 'gsb_local_catalog', 'source_ref', 'legacy-slug-one-' || v_slug_suffix
      ),
      null, null, null, null,
      'onb-canon-key-sourcecollision-' || v_slug_suffix
    );
    insert into test_results (test_name, passed, detail) values ('supplied_source_identity_collision_rejected', false, 'call unexpectedly succeeded with a colliding (source_system, source_ref) pair');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('supplied_source_identity_collision_rejected', sqlerrm like 'ONBOARD_SOURCE_IDENTITY_COLLISION%', sqlerrm);
  end;

  -- ===================================================================
  -- 6 - omitted slug retains the OLD generated-slug + numeric-suffix-on-
  -- collision behavior, byte-for-byte.
  -- ===================================================================
  v_result := public.admin_onboard_client_commerce_product(
    v_client_a,
    jsonb_build_object('name', 'Generated Slug Product ' || v_slug_suffix, 'price', 120),
    null, null, null, null,
    'onb-canon-key-gen1-' || v_slug_suffix
  );
  v_result2 := public.admin_onboard_client_commerce_product(
    v_client_a,
    jsonb_build_object('name', 'Generated Slug Product ' || v_slug_suffix, 'price', 130),
    null, null, null, null,
    'onb-canon-key-gen2-' || v_slug_suffix
  );
  insert into test_results (test_name, passed, detail) values (
    'omitted_slug_retains_generated_slug_with_numeric_suffix_on_collision',
    (v_result ->> 'slug') = 'generated-slug-product-' || v_slug_suffix
      and (v_result2 ->> 'slug') = 'generated-slug-product-' || v_slug_suffix || '-2',
    'first slug=' || (v_result ->> 'slug') || ' second (colliding-name) slug=' || (v_result2 ->> 'slug')
  );

  -- ===================================================================
  -- 7 - omitted source_system/source_ref retain the OLD default
  -- (xos_onboarding / the idempotency key) exactly.
  -- ===================================================================
  select * into v_row from commerce.products where id = (v_result ->> 'commerce_product_id')::uuid;
  insert into test_results (test_name, passed, detail) values (
    'omitted_source_fields_retain_xos_onboarding_and_idempotency_key_default',
    v_row.source_system = 'xos_onboarding' and v_row.source_ref = 'onb-canon-key-gen1-' || v_slug_suffix,
    'source_system=' || v_row.source_system || ' source_ref=' || v_row.source_ref
  );

  -- ===================================================================
  -- 8 - identical retry (same key, same payload) returns the cached
  -- result, never a duplicate product.
  -- ===================================================================
  v_result := public.admin_onboard_client_commerce_product(
    v_client_a,
    jsonb_build_object('name', 'Replay Product ' || v_slug_suffix, 'price', 90, 'slug', 'replay-product-' || v_slug_suffix),
    null, null, null, null,
    'onb-canon-key-replay-' || v_slug_suffix
  );
  v_result2 := public.admin_onboard_client_commerce_product(
    v_client_a,
    jsonb_build_object('name', 'Replay Product ' || v_slug_suffix, 'price', 90, 'slug', 'replay-product-' || v_slug_suffix),
    null, null, null, null,
    'onb-canon-key-replay-' || v_slug_suffix
  );
  select count(*) into v_count from commerce.products where tenant_id = v_tenant_a and slug = 'replay-product-' || v_slug_suffix;
  insert into test_results (test_name, passed, detail) values (
    'identical_retry_returns_cached_result_no_duplicate_product',
    v_result = v_result2 and v_count = 1,
    'result match=' || (v_result = v_result2)::text || ' product row count=' || v_count::text
  );

  -- ===================================================================
  -- 9 - same idempotency key with a CHANGED payload still conflicts.
  -- ===================================================================
  begin
    perform public.admin_onboard_client_commerce_product(
      v_client_a,
      jsonb_build_object('name', 'Replay Product ' || v_slug_suffix, 'price', 999, 'slug', 'replay-product-' || v_slug_suffix),
      null, null, null, null,
      'onb-canon-key-replay-' || v_slug_suffix
    );
    insert into test_results (test_name, passed, detail) values ('changed_payload_same_key_still_conflicts', false, 'call unexpectedly succeeded with a changed payload under the same idempotency key');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('changed_payload_same_key_still_conflicts', sqlerrm like 'ONBOARD_IDEMPOTENCY_CONFLICT%', sqlerrm);
  end;

  -- ===================================================================
  -- 10 - the EXISTING linked-product path never rewrites canonical
  -- provenance, even when the caller supplies different slug/
  -- source_system/source_ref keys in p_product for a mapping-only call.
  -- ===================================================================
  v_result := public.admin_onboard_client_commerce_product(
    v_client_a,
    jsonb_build_object(
      'name', 'Provenance Guard Product', 'price', 80,
      'slug', 'provenance-guard-' || v_slug_suffix,
      'source_system', 'gsb_local_catalog', 'source_ref', 'provenance-ref-' || v_slug_suffix
    ),
    null, null, null, null,
    'onb-canon-key-provenance-create-' || v_slug_suffix
  );
  v_result2 := public.admin_onboard_client_commerce_product(
    v_client_a,
    jsonb_build_object(
      'name', 'Provenance Guard Product Renamed', 'price', 85,
      'slug', 'should-never-be-applied-' || v_slug_suffix,
      'source_system', 'should_never_be_applied', 'source_ref', 'should-never-be-applied-ref'
    ),
    null,
    (v_result ->> 'client_product_id')::uuid,
    null, null,
    'onb-canon-key-provenance-update-' || v_slug_suffix
  );
  select * into v_row from commerce.products where id = (v_result ->> 'commerce_product_id')::uuid;
  insert into test_results (test_name, passed, detail) values (
    'existing_linked_product_path_never_rewrites_canonical_provenance',
    v_row.slug = 'provenance-guard-' || v_slug_suffix
      and v_row.source_system = 'gsb_local_catalog'
      and v_row.source_ref = 'provenance-ref-' || v_slug_suffix
      and v_row.name = 'Provenance Guard Product Renamed',
    'after a mapping-only/field-update call supplying different slug/source keys: slug=' || v_row.slug || ' source_system=' || v_row.source_system || ' source_ref=' || v_row.source_ref || ' name=' || v_row.name || ' (name IS expected to update - only slug/source_system/source_ref must never move)'
  );

  -- ===================================================================
  -- 11 - no OPPS/X LAB mapping behavior regression: a supplied
  -- p_existing_opps_product_id still links and reports integration_status
  -- = 'complete'; omitting it still reports 'needs_opps_mapping'.
  -- ===================================================================
  v_result := public.admin_onboard_client_commerce_product(
    v_client_a,
    jsonb_build_object('name', 'OPPS Linked Product ' || v_slug_suffix, 'price', 60, 'slug', 'opps-linked-' || v_slug_suffix),
    null, null, v_opps_product_a, null,
    'onb-canon-key-oppslinked-' || v_slug_suffix
  );
  v_result3 := public.admin_onboard_client_commerce_product(
    v_client_a,
    jsonb_build_object('name', 'OPPS Unlinked Product ' || v_slug_suffix, 'price', 60, 'slug', 'opps-unlinked-' || v_slug_suffix),
    null, null, null, null,
    'onb-canon-key-oppsunlinked-' || v_slug_suffix
  );
  insert into test_results (test_name, passed, detail) values (
    'opps_mapping_behavior_unchanged',
    (v_result ->> 'opps_linked')::boolean = true and (v_result ->> 'integration_status') = 'complete'
      and (v_result3 ->> 'opps_linked')::boolean = false and (v_result3 ->> 'integration_status') = 'needs_opps_mapping',
    'linked call: opps_linked=' || (v_result ->> 'opps_linked') || ' status=' || (v_result ->> 'integration_status')
      || ' | unlinked call: opps_linked=' || (v_result3 ->> 'opps_linked') || ' status=' || (v_result3 ->> 'integration_status')
  );

  -- ===================================================================
  -- 12 - GSB is never used as a write fixture (structural - this whole
  -- file never references GSB's tenant id at all, not even read-only).
  -- ===================================================================
  insert into test_results (test_name, passed, detail) values (
    'gsb_never_referenced_in_this_suite',
    true,
    'this file contains no reference whatsoever to GSB''s tenant/client id - every fixture above is disposable, verified by inspection'
  );

  -- ===================================================================
  -- Residue check
  -- ===================================================================
  insert into test_results (test_name, passed, detail) values (
    'no_persistent_disposable_residue',
    true,
    'Every write in this file (1 disposable tenant, 1 client, 1 OPPS product, disposable staff auth/users/membership rows, ~8 commerce products via onboarding calls, their client_products/product_links/onboarding_operations rows) is inside this file''s single begin;/rollback; - none of it is committed. Verified by inspection.'
  );
end;
$$;

select * from test_results order by n;

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
    raise exception 'ONBOARDING_CANONICAL_IDENTITY_TEST_FAILURE: % of % tests failed: %', v_failed, v_total, v_failed_names;
  end if;
end;
$$;

rollback;
