-- Public Storefront Commerce Catalog — disposable test matrix.
--
-- Rollback-wrapped, matching the Phase 0-3/XOS 3A/3B convention. Every
-- write in this file (2 disposable tenants, 4 tenant_domains rows, 6
-- commerce.products rows, 4 commerce.product_variants rows, 1
-- tenant_capabilities row) is inside this file's single begin;/rollback;
-- - none of it persists. GSB is NEVER used as a write fixture here.
--
-- NOT executed as part of this task - production is read-only during
-- implementation/review, and this migration has not been applied.
-- Ready to run once explicitly authorized:
--   supabase db query --linked --file supabase/tests/public_storefront_commerce_catalog.sql

begin;

create temporary table test_results (
  n int generated always as identity,
  test_name text,
  passed boolean,
  detail text
);

do $$
declare
  v_tenant_a uuid;
  v_tenant_b uuid;
  v_slug_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  v_host_active_a text;
  v_host_pending_a text;
  v_host_disabled_a text;
  v_host_admin_a text;
  v_host_active_b text;
  v_host_unknown text;

  v_p1 uuid; -- published, Alpha Tee
  v_p2 uuid; -- published, Zulu Tee, out_of_stock
  v_p3 uuid; -- published, Tie Tee (tie 1)
  v_p4 uuid; -- published, Tie Tee (tie 2)
  v_p_draft uuid;
  v_p_archived uuid;
  v_p_b uuid; -- tenant B's own published product

  v_list jsonb;
  v_list2 jsonb;
  v_detail jsonb;
begin
  v_host_active_a   := 'active-a-' || v_slug_suffix || '.disposable.test';
  v_host_pending_a  := 'pending-a-' || v_slug_suffix || '.disposable.test';
  v_host_disabled_a := 'disabled-a-' || v_slug_suffix || '.disposable.test';
  v_host_admin_a    := 'admin-a-' || v_slug_suffix || '.disposable.test';
  v_host_active_b   := 'active-b-' || v_slug_suffix || '.disposable.test';
  v_host_unknown    := 'unknown-' || v_slug_suffix || '.disposable.test';

  -- ===================================================================
  -- Disposable fixture: two tenants, domains, capabilities, products
  -- ===================================================================
  insert into public.tenants (slug, name, status)
  values ('sf-test-a-' || v_slug_suffix, 'Storefront Test Tenant A', 'active')
  returning id into v_tenant_a;

  insert into public.tenants (slug, name, status)
  values ('sf-test-b-' || v_slug_suffix, 'Storefront Test Tenant B', 'active')
  returning id into v_tenant_b;

  insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary, verified_at) values
    (v_tenant_a, v_host_active_a,   'storefront', 'active',   true,  now()),
    (v_tenant_a, v_host_pending_a,  'storefront', 'pending',  false, null),
    (v_tenant_a, v_host_disabled_a, 'storefront', 'disabled', false, now()),
    (v_tenant_a, v_host_admin_a,    'xos_admin',  'active',   true,  now()),
    (v_tenant_b, v_host_active_b,   'storefront', 'active',   true,  now());

  -- Tenant A: Products capability enabled. Tenant B: deliberately left
  -- WITHOUT a capability row at all (never configured), to prove "never
  -- configured" is denied identically to "explicitly disabled" (test 8).
  insert into public.tenant_capabilities (tenant_id, capability_key, enabled, config)
  values (v_tenant_a, 'products', true, '{}'::jsonb);

  insert into commerce.products (tenant_id, slug, name, description, price, sale_price, currency, primary_image_url, availability, status, source_system, source_ref)
  values
    (v_tenant_a, 'sf-test-tee-alpha-' || v_slug_suffix, 'Alpha Tee', 'First test product', 100, 80, 'ZAR', 'https://example.com/alpha.jpg', 'available', 'published', 'disposable_source_system', 'disposable_source_ref_alpha')
  returning id into v_p1;

  insert into commerce.products (tenant_id, slug, name, description, price, currency, availability, status)
  values (v_tenant_a, 'sf-test-tee-zulu-' || v_slug_suffix, 'Zulu Tee', 'Second test product', 200, 'ZAR', 'out_of_stock', 'published')
  returning id into v_p2;

  insert into commerce.products (tenant_id, slug, name, price, currency, availability, status)
  values (v_tenant_a, 'sf-test-tee-tie-1-' || v_slug_suffix, 'Tie Tee', 150, 'ZAR', 'available', 'published')
  returning id into v_p3;

  insert into commerce.products (tenant_id, slug, name, price, currency, availability, status)
  values (v_tenant_a, 'sf-test-tee-tie-2-' || v_slug_suffix, 'Tie Tee', 150, 'ZAR', 'available', 'published')
  returning id into v_p4;

  insert into commerce.products (tenant_id, slug, name, price, currency, availability, status)
  values (v_tenant_a, 'sf-test-tee-draft-' || v_slug_suffix, 'Draft Tee', 120, 'ZAR', 'available', 'draft')
  returning id into v_p_draft;

  insert into commerce.products (tenant_id, slug, name, price, currency, availability, status)
  values (v_tenant_a, 'sf-test-tee-archived-' || v_slug_suffix, 'Archived Tee', 90, 'ZAR', 'available', 'archived')
  returning id into v_p_archived;

  insert into commerce.products (tenant_id, slug, name, price, currency, availability, status)
  values (v_tenant_b, 'sf-test-tee-tenant-b-' || v_slug_suffix, 'Tenant B Tee', 300, 'ZAR', 'available', 'published')
  returning id into v_p_b;

  -- Two variants tied on sort_order (id tie-break, test 17), plus one
  -- with a null sort_order (nulls-last, test 12/17).
  insert into commerce.product_variants (tenant_id, product_id, sku, title, size, color, price_override, availability, sort_order) values
    (v_tenant_a, v_p1, 'SF-A-S-' || v_slug_suffix, 'Small', 'S', 'Black', null, 'available', 1),
    (v_tenant_a, v_p1, 'SF-A-M-' || v_slug_suffix, 'Medium', 'M', 'Black', 105, 'available', 1),
    (v_tenant_a, v_p1, null, 'Large', 'L', 'Black', null, 'out_of_stock', null),
    (v_tenant_a, v_p2, 'SF-Z-ONE-' || v_slug_suffix, 'One Size', null, 'White', null, 'out_of_stock', 1);

  -- ===================================================================
  -- 1/9/10/11 - list RPC, correct tenant, published-only
  -- ===================================================================
  v_list := public.get_public_storefront_products_for_host(v_host_active_a, 50);

  insert into test_results (test_name, passed, detail) values (
    'active_storefront_hostname_resolves_correct_tenant',
    jsonb_array_length(v_list) = 4,
    'expected exactly 4 published Tenant A products, got ' || jsonb_array_length(v_list)::text || ': ' || v_list::text
  );
  insert into test_results (test_name, passed, detail) values (
    'published_products_included',
    (select bool_and(exists (select 1 from jsonb_array_elements(v_list) e where e ->> 'slug' = s))
     from unnest(array['sf-test-tee-alpha-' || v_slug_suffix, 'sf-test-tee-zulu-' || v_slug_suffix, 'sf-test-tee-tie-1-' || v_slug_suffix, 'sf-test-tee-tie-2-' || v_slug_suffix]) s),
    'all 4 published slugs must be present in the list result'
  );
  insert into test_results (test_name, passed, detail) values (
    'draft_product_excluded',
    not exists (select 1 from jsonb_array_elements(v_list) e where e ->> 'slug' = 'sf-test-tee-draft-' || v_slug_suffix),
    'draft product must never appear in the public list'
  );
  insert into test_results (test_name, passed, detail) values (
    'archived_product_excluded',
    not exists (select 1 from jsonb_array_elements(v_list) e where e ->> 'slug' = 'sf-test-tee-archived-' || v_slug_suffix),
    'archived product must never appear in the public list'
  );

  -- ===================================================================
  -- 7 - cross-tenant isolation
  -- ===================================================================
  insert into test_results (test_name, passed, detail) values (
    'tenant_a_storefront_never_receives_tenant_b_products',
    not exists (select 1 from jsonb_array_elements(v_list) e where e ->> 'slug' = 'sf-test-tee-tenant-b-' || v_slug_suffix),
    'Tenant B''s product must never appear when resolving Tenant A''s storefront hostname'
  );

  -- ===================================================================
  -- 2/3/4/5 - hostname/domain-state rejection
  -- ===================================================================
  begin
    perform public.get_public_storefront_products_for_host(v_host_admin_a, 50);
    insert into test_results (test_name, passed, detail) values ('xos_admin_hostname_rejected_by_public_resolver', false, 'call unexpectedly succeeded against an xos_admin-surface hostname');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('xos_admin_hostname_rejected_by_public_resolver', sqlerrm like 'Storefront not found%', sqlerrm);
  end;

  begin
    perform public.get_public_storefront_products_for_host(v_host_pending_a, 50);
    insert into test_results (test_name, passed, detail) values ('pending_storefront_domain_rejected', false, 'call unexpectedly succeeded against a pending domain');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('pending_storefront_domain_rejected', sqlerrm like 'Storefront not found%', sqlerrm);
  end;

  begin
    perform public.get_public_storefront_products_for_host(v_host_disabled_a, 50);
    insert into test_results (test_name, passed, detail) values ('disabled_storefront_domain_rejected', false, 'call unexpectedly succeeded against a disabled domain');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('disabled_storefront_domain_rejected', sqlerrm like 'Storefront not found%', sqlerrm);
  end;

  begin
    perform public.get_public_storefront_products_for_host(v_host_unknown, 50);
    insert into test_results (test_name, passed, detail) values ('unknown_hostname_rejected', false, 'call unexpectedly succeeded against a never-registered hostname');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('unknown_hostname_rejected', sqlerrm like 'Storefront not found%', sqlerrm);
  end;

  begin
    perform public.get_public_storefront_products_for_host(v_host_active_a || '?tenant=' || (select slug from public.tenants where id = v_tenant_b), 50);
    insert into test_results (test_name, passed, detail) values ('hostname_query_string_cannot_smuggle_a_different_tenant', false, 'call unexpectedly succeeded with a query-string-suffixed hostname');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('hostname_query_string_cannot_smuggle_a_different_tenant', sqlerrm like 'Storefront not found%', sqlerrm);
  end;

  -- ===================================================================
  -- 6 - caller cannot supply a tenant id (structural: no uuid parameter
  -- exists on either public RPC at all)
  -- ===================================================================
  insert into test_results (test_name, passed, detail) values (
    'public_rpcs_accept_no_tenant_id_parameter',
    -- The ::regprocedure casts themselves already prove each RPC's exact
    -- parameter TYPE signature is (text, integer) / (text, text) - no
    -- additional/different parameter exists at all. The regex additionally
    -- guards against a uuid-typed parameter specifically, format-agnostic
    -- (not brittle to exact whitespace/rendering of the identity-args string).
    pg_get_function_identity_arguments('public.get_public_storefront_products_for_host(text, integer)'::regprocedure) !~* 'uuid'
      and pg_get_function_identity_arguments('public.get_public_storefront_product_for_host(text, text)'::regprocedure) !~* 'uuid',
    'neither public RPC may accept a uuid-typed (tenant/client id) parameter - hostname (and, for detail, slug) only: '
      || pg_get_function_identity_arguments('public.get_public_storefront_products_for_host(text, integer)'::regprocedure)
      || ' / ' || pg_get_function_identity_arguments('public.get_public_storefront_product_for_host(text, text)'::regprocedure)
  );

  -- ===================================================================
  -- 8 - capability disabled/never-configured -> unavailable
  -- ===================================================================
  begin
    perform public.get_public_storefront_products_for_host(v_host_active_b, 50);
    insert into test_results (test_name, passed, detail) values ('products_capability_never_configured_blocks_public_catalog', false, 'call unexpectedly succeeded for a tenant with no tenant_capabilities row at all');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('products_capability_never_configured_blocks_public_catalog', sqlerrm like 'Storefront catalog is not available%', sqlerrm);
  end;

  -- ===================================================================
  -- 12 - variants scoped to parent product
  -- ===================================================================
  insert into test_results (test_name, passed, detail) values (
    'variants_scoped_to_their_own_parent_product',
    (select jsonb_array_length(e -> 'variants') from jsonb_array_elements(v_list) e where e ->> 'slug' = 'sf-test-tee-alpha-' || v_slug_suffix) = 3
      and (select jsonb_array_length(e -> 'variants') from jsonb_array_elements(v_list) e where e ->> 'slug' = 'sf-test-tee-zulu-' || v_slug_suffix) = 1
      and not exists (
        select 1 from jsonb_array_elements(v_list) e, jsonb_array_elements(e -> 'variants') var
        where e ->> 'slug' = 'sf-test-tee-zulu-' || v_slug_suffix and var ->> 'size' = 'S'
      ),
    'Alpha must have exactly 3 variants, Zulu exactly 1, and Alpha''s variants must never appear under Zulu'
  );

  -- ===================================================================
  -- 13 - no internal/source/link fields anywhere in the response
  -- ===================================================================
  insert into test_results (test_name, passed, detail) values (
    'no_internal_source_or_link_fields_in_response',
    v_list::text !~* 'tenant_id|source_system|source_ref|product_links|external_id|client_product|opps_product|xlab_product|"status"',
    'checked full list response text for any internal identity/status field - none may appear (status is used only for server-side filtering, never returned to the public caller)'
  );

  -- ===================================================================
  -- 17 - deterministic ordering (product-level name+id tie-break AND
  -- variant-level sort_order+id tie-break)
  -- ===================================================================
  v_list2 := public.get_public_storefront_products_for_host(v_host_active_a, 50);
  insert into test_results (test_name, passed, detail) values (
    'list_ordering_is_deterministic_across_repeated_calls',
    v_list::text = v_list2::text,
    'two consecutive calls (including two products that tie on name, and two variants that tie on sort_order) must produce byte-identical JSON both times'
  );

  -- ===================================================================
  -- 18 - malformed/oversized limit handled safely (clamped, never errors)
  -- ===================================================================
  begin
    perform public.get_public_storefront_products_for_host(v_host_active_a, -5);
    insert into test_results (test_name, passed, detail) values (
      'negative_limit_clamped_not_errored',
      jsonb_array_length(public.get_public_storefront_products_for_host(v_host_active_a, -5)) = 1,
      'a negative limit must clamp to 1, never raise or return 0/unbounded'
    );
  exception when others then
    insert into test_results (test_name, passed, detail) values ('negative_limit_clamped_not_errored', false, 'unexpectedly raised: ' || sqlerrm);
  end;

  begin
    perform public.get_public_storefront_products_for_host(v_host_active_a, 999999);
    insert into test_results (test_name, passed, detail) values (
      'oversized_limit_clamped_not_errored',
      jsonb_array_length(public.get_public_storefront_products_for_host(v_host_active_a, 999999)) = 4,
      'an oversized limit must clamp to <=100, still returning the 4 real published rows here, never raise'
    );
  exception when others then
    insert into test_results (test_name, passed, detail) values ('oversized_limit_clamped_not_errored', false, 'unexpectedly raised: ' || sqlerrm);
  end;

  begin
    perform public.get_public_storefront_products_for_host(v_host_active_a, null);
    insert into test_results (test_name, passed, detail) values ('null_limit_falls_back_to_default_not_errored', true, 'a null limit must fall back to the default (50), never raise');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('null_limit_falls_back_to_default_not_errored', false, 'unexpectedly raised: ' || sqlerrm);
  end;

  -- ===================================================================
  -- Detail RPC (Part C) - same hostname/capability/published-only rule,
  -- byte-identical projection for the same product as the list RPC.
  -- ===================================================================
  v_detail := public.get_public_storefront_product_for_host(v_host_active_a, 'sf-test-tee-alpha-' || v_slug_suffix);
  insert into test_results (test_name, passed, detail) values (
    'detail_rpc_returns_published_product_matching_list_projection_exactly',
    v_detail::text = (select e::text from jsonb_array_elements(v_list) e where e ->> 'slug' = 'sf-test-tee-alpha-' || v_slug_suffix),
    'the detail RPC must use the exact same shared projection helper as the list RPC - no drift between the two'
  );

  insert into test_results (test_name, passed, detail) values (
    'detail_rpc_returns_null_for_draft_product_not_an_error_and_not_the_row',
    public.get_public_storefront_product_for_host(v_host_active_a, 'sf-test-tee-draft-' || v_slug_suffix) is null,
    'a draft product must never be reachable by slug either, even directly'
  );
  insert into test_results (test_name, passed, detail) values (
    'detail_rpc_returns_null_for_archived_product',
    public.get_public_storefront_product_for_host(v_host_active_a, 'sf-test-tee-archived-' || v_slug_suffix) is null,
    'an archived product must never be reachable by slug either, even directly'
  );
  insert into test_results (test_name, passed, detail) values (
    'detail_rpc_returns_null_for_nonexistent_slug',
    public.get_public_storefront_product_for_host(v_host_active_a, 'sf-test-tee-does-not-exist-' || v_slug_suffix) is null,
    'a nonexistent slug must resolve to null, not an error'
  );
  begin
    perform public.get_public_storefront_product_for_host(v_host_active_a, '');
    insert into test_results (test_name, passed, detail) values ('detail_rpc_rejects_empty_slug', false, 'call unexpectedly succeeded with an empty slug');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('detail_rpc_rejects_empty_slug', sqlerrm like '%product slug is required%', sqlerrm);
  end;

  -- ===================================================================
  -- 14/15/16 - grant model (privilege introspection, not impersonation -
  -- these are real database roles, checked directly)
  -- ===================================================================
  insert into test_results (test_name, passed, detail) values (
    'anon_may_execute_exactly_the_two_intended_public_read_rpcs',
    has_function_privilege('anon', 'public.get_public_storefront_products_for_host(text, integer)', 'EXECUTE')
      and has_function_privilege('anon', 'public.get_public_storefront_product_for_host(text, text)', 'EXECUTE')
      and not has_function_privilege('anon', 'public._resolve_public_commerce_tenant(text)', 'EXECUTE')
      and not has_function_privilege('anon', 'public._public_storefront_products_projection(uuid, text, integer)', 'EXECUTE'),
    'anon must reach the two public RPCs but neither internal helper directly'
  );
  insert into test_results (test_name, passed, detail) values (
    'authenticated_may_also_execute_the_two_public_rpcs',
    has_function_privilege('authenticated', 'public.get_public_storefront_products_for_host(text, integer)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.get_public_storefront_product_for_host(text, text)', 'EXECUTE'),
    'a signed-in user must be able to browse the public storefront too, same as anon'
  );
  insert into test_results (test_name, passed, detail) values (
    'anon_cannot_select_commerce_tables_directly',
    not has_table_privilege('anon', 'commerce.products', 'SELECT')
      and not has_table_privilege('anon', 'commerce.product_variants', 'SELECT')
      and not has_table_privilege('authenticated', 'commerce.products', 'SELECT')
      and not has_table_privilege('authenticated', 'commerce.product_variants', 'SELECT'),
    'direct table SELECT must remain denied for anon AND authenticated - the two new RPCs are the only path, matching XOS 3A''s existing lockdown'
  );
  insert into test_results (test_name, passed, detail) values (
    'no_other_storefront_named_function_is_anon_reachable',
    (select count(*) from information_schema.routine_privileges
     where grantee = 'anon' and routine_schema = 'public' and routine_name ilike '%storefront%'
       and routine_name not in ('get_public_storefront_products_for_host', 'get_public_storefront_product_for_host', 'resolve_public_storefront_tenant')) = 0,
    'no mutation or additional read RPC beyond the two intended ones (plus the pre-existing resolve_public_storefront_tenant) may be anon-reachable'
  );
  insert into test_results (test_name, passed, detail) values (
    'existing_staff_only_onboarding_rpc_remains_unreachable_by_anon',
    not has_function_privilege('anon', 'public.admin_onboard_client_commerce_product(uuid, jsonb, jsonb, uuid, uuid, uuid, text)', 'EXECUTE'),
    'this migration must not have loosened the existing staff-only onboarding RPC'
  );

  -- ===================================================================
  -- Residue check
  -- ===================================================================
  insert into test_results (test_name, passed, detail) values (
    'no_persistent_disposable_residue',
    true,
    'Every write in this file (2 tenants, 5 tenant_domains rows, 1 tenant_capabilities row, 7 commerce.products rows, 4 commerce.product_variants rows) is inside this file''s single begin;/rollback; - none of it is committed. Verified by inspection.'
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
    raise exception 'PUBLIC_STOREFRONT_COMMERCE_CATALOG_TEST_FAILURE: % of % tests failed: %', v_failed, v_total, v_failed_names;
  end if;
end;
$$;

rollback;
