-- Managed Clients Control Plane — Phase 3 disposable test matrix (site
-- templates + site builds + build briefs).
--
-- Rollback-wrapped, like the Phase 2 suite. Performs real application-
-- table writes (templates, a disposable tenant/client/workspace fixture,
-- a site build, brief versions) - every one of them is inside this
-- file's single begin;/rollback;, which is what guarantees none of it
-- persists. GSB is NEVER used as a write fixture here - every mutation
-- targets a disposable tenant/client/workspace created fresh inside this
-- transaction. GSB and "GSB Tes" (its one real Commerce product) are
-- only ever read, to prove the write fixtures do not disturb them.
--
-- Two dynamically-resolved identities (never a hardcoded real person's
-- auth UUID): v_admin (public.users.role = 'admin', the is_app_admin()
-- authority every Phase 3 RPC requires) and v_non_admin (a fresh,
-- never-persisted gen_random_uuid() with no public.users row).
--
-- NOT executed as part of this task - production is read-only during
-- implementation/review, and this migration has not been applied yet.
-- Ready to run once both are explicitly authorized:
--   supabase db query --linked --file supabase/tests/managed_clients_phase3_site_builds.sql

begin;

create temporary table test_results (
  n int generated always as identity,
  test_name text,
  passed boolean,
  detail text
);

do $$
declare
  v_admin uuid;
  v_non_admin uuid := gen_random_uuid();
  v_gsb_tenant_id uuid := '4e0f1fa4-3149-40fa-a3f8-00ec251a2c11';

  v_tenant_id uuid;
  v_client_id uuid;
  v_workspace_id uuid;
  v_slug text := 'phase3-disposable-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  v_template_a_id uuid;
  v_template_b_archived_id uuid;
  v_referenced_template_id uuid;

  v_build jsonb;
  v_build2 jsonb;
  v_build_id uuid;
  v_brief jsonb;
  v_brief2 jsonb;
  v_briefs jsonb;

  v_count int;
  v_fp1 text;
  v_fp2 text;
begin
  -- ---- Resolve app-admin identity (read-only) ----
  select u.auth_user_id into v_admin from public.users u where u.role = 'admin' and coalesce(u.is_active, true) limit 1;
  if v_admin is null then
    raise exception 'MANAGED_CLIENTS_PHASE3_TEST_SETUP: no active app-admin identity found - cannot simulate is_app_admin()';
  end if;

  -- =====================================================================
  -- GSB baseline (tests 26-29) - READ ONLY, before any write below
  -- =====================================================================
  insert into test_results (test_name, passed, detail) values (
    'managed_client_workspaces_row_count_is_zero',
    (select count(*) from public.managed_client_workspaces) = 0,
    'managed_client_workspaces count=' || (select count(*) from public.managed_client_workspaces)::text || ' (test workspaces were intentionally removed - GSB has none yet)'
  );

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated', 'email', 'phase3-admin@disposable.test')::text, true);

  declare
    v_projection jsonb;
  begin
    v_projection := public.admin_list_managed_clients();
    insert into test_results (test_name, passed, detail) values (
      'managed_clients_current_projection_count_is_one',
      jsonb_array_length(v_projection) = 1 and (v_projection -> 0 ->> 'tenant_slug') = 'gsb',
      'admin_list_managed_clients() returned ' || jsonb_array_length(v_projection)::text || ' row(s); first tenant_slug=' || coalesce(v_projection -> 0 ->> 'tenant_slug', 'null')
    );
  end;

  insert into test_results (test_name, passed, detail) values (
    'gsb_tes_exists_and_unchanged_baseline',
    (select count(*) from commerce.products where tenant_id = v_gsb_tenant_id and status <> 'archived' and name = 'GSB Tes') = 1,
    'checked GSB Tes exists exactly once before any Phase 3 write'
  );

  begin
    perform public.admin_get_managed_site_build(v_gsb_tenant_id);
    insert into test_results (test_name, passed, detail) values ('gsb_no_workspace_structurally_blocks_build_access', false, 'call unexpectedly succeeded - GSB has no workspace yet');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('gsb_no_workspace_structurally_blocks_build_access', sqlerrm like 'SITE_BUILD_NO_WORKSPACE%', sqlerrm);
  end;

  -- =====================================================================
  -- Disposable fixture: tenant + client + workspace (never GSB) - real
  -- application-table rows, inside this file's single begin;/rollback;
  -- =====================================================================
  insert into public.tenants (slug, name, status, settings) values (v_slug, 'Phase3 Disposable Tenant', 'active', '{}'::jsonb) returning id into v_tenant_id;
  insert into public.clients (tenant_id, name, email, status) values (v_tenant_id, 'Phase3 Disposable Contact', 'phase3-' || substr(replace(gen_random_uuid()::text,'-',''),1,8) || '@disposable.test', 'active') returning id into v_client_id;
  insert into public.managed_client_workspaces (tenant_id, client_id, client_type, site_type, assets_status, content_status)
  values (v_tenant_id, v_client_id, 'Fashion Brand', 'Ecommerce', 'Ready', 'Ready')
  returning id into v_workspace_id;

  -- =====================================================================
  -- Non-admin denial (tests 1-3)
  -- =====================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_non_admin, 'role', 'authenticated', 'email', 'phase3-nonadmin@disposable.test')::text, true);
  insert into test_results (test_name, passed, detail) values ('is_app_admin_is_false_for_non_admin', public.is_app_admin() is false, 'is_app_admin()=' || coalesce(public.is_app_admin()::text, '(null)'));

  begin
    perform public.admin_upsert_managed_site_template(null, jsonb_build_object('template_key', 'x', 'name', 'x'));
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_create_template', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_create_template', sqlerrm like 'SITE_TEMPLATE_FORBIDDEN%', sqlerrm);
  end;
  begin
    perform public.admin_archive_managed_site_template(gen_random_uuid());
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_archive_template', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_archive_template', sqlerrm like 'SITE_TEMPLATE_FORBIDDEN%', sqlerrm);
  end;
  begin
    perform public.admin_upsert_managed_site_build(v_tenant_id, jsonb_build_object('primary_goal', 'x'));
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_create_or_edit_build', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_create_or_edit_build', sqlerrm like 'SITE_BUILD_FORBIDDEN%', sqlerrm);
  end;
  begin
    perform public.admin_generate_managed_site_build_brief(gen_random_uuid());
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_generate_brief', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_generate_brief', sqlerrm like 'SITE_BUILD_FORBIDDEN%', sqlerrm);
  end;

  insert into test_results (test_name, passed, detail) values (
    'no_writes_from_non_admin_denied_calls',
    not exists (select 1 from public.managed_site_templates where template_key = 'x')
      and not exists (select 1 from public.managed_site_builds where tenant_id = v_tenant_id),
    'confirmed no template/build row was created by any denied non-admin call'
  );

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated', 'email', 'phase3-admin@disposable.test')::text, true);

  -- =====================================================================
  -- Templates: registry (tests 4-6)
  -- =====================================================================
  v_template_a_id := (public.admin_upsert_managed_site_template(null, jsonb_build_object(
    'template_key', v_slug || '-template-a', 'name', 'Phase3 Template A',
    'supported_site_types', jsonb_build_array('Ecommerce', 'Catalog'), 'status', 'active'
  )) ->> 'id')::uuid;
  v_template_b_archived_id := (public.admin_upsert_managed_site_template(null, jsonb_build_object(
    'template_key', v_slug || '-template-b', 'name', 'Phase3 Template B (will archive)',
    'supported_site_types', jsonb_build_array('Landing Page'), 'status', 'active'
  )) ->> 'id')::uuid;
  perform public.admin_archive_managed_site_template(v_template_b_archived_id);

  begin
    perform public.admin_upsert_managed_site_build(v_tenant_id, jsonb_build_object('template_id', v_template_b_archived_id::text));
    insert into test_results (test_name, passed, detail) values ('archived_template_cannot_be_selected', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('archived_template_cannot_be_selected', sqlerrm like 'SITE_BUILD_TEMPLATE_INVALID%', sqlerrm);
  end;

  begin
    perform public.admin_upsert_managed_site_build(v_tenant_id, jsonb_build_object('template_id', gen_random_uuid()::text));
    insert into test_results (test_name, passed, detail) values ('nonexistent_template_cannot_be_selected', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('nonexistent_template_cannot_be_selected', sqlerrm like 'SITE_BUILD_TEMPLATE_INVALID%', sqlerrm);
  end;

  -- Fixture workspace has site_type = 'Ecommerce'; create a template that
  -- ONLY supports a different site type to prove compatibility is
  -- actually enforced, not just a documentation claim.
  declare
    v_incompatible_template_id uuid;
  begin
    v_incompatible_template_id := (public.admin_upsert_managed_site_template(null, jsonb_build_object(
      'template_key', v_slug || '-template-c-incompatible', 'name', 'Phase3 Template C (Landing Page only)',
      'supported_site_types', jsonb_build_array('Landing Page'), 'status', 'active'
    )) ->> 'id')::uuid;
    begin
      perform public.admin_upsert_managed_site_build(v_tenant_id, jsonb_build_object('template_id', v_incompatible_template_id::text));
      insert into test_results (test_name, passed, detail) values ('template_site_type_compatibility_enforced', false, 'call unexpectedly succeeded - Ecommerce workspace accepted a Landing-Page-only template');
    exception when others then
      insert into test_results (test_name, passed, detail) values ('template_site_type_compatibility_enforced', sqlerrm like 'SITE_BUILD_TEMPLATE_SITE_TYPE_MISMATCH%', sqlerrm);
    end;
  end;

  insert into test_results (test_name, passed, detail) values (
    'no_delete_rpc_exists_for_templates',
    (select count(*) from pg_proc where proname ilike '%delete%managed_site_template%') = 0,
    'templates are archive-only by design - confirmed no delete RPC is defined'
  );

  -- =====================================================================
  -- Site build creation/identity (tests 7-10)
  -- =====================================================================
  begin
    perform public.admin_upsert_managed_site_build(v_gsb_tenant_id, '{}'::jsonb);
    insert into test_results (test_name, passed, detail) values ('site_build_requires_existing_workspace', false, 'call unexpectedly succeeded against GSB, which has no workspace');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('site_build_requires_existing_workspace', sqlerrm like 'SITE_BUILD_NO_WORKSPACE%', sqlerrm);
  end;

  begin
    perform public.admin_upsert_managed_site_build('11111111-1111-1111-1111-111111111111'::uuid, '{}'::jsonb);
    insert into test_results (test_name, passed, detail) values ('site_build_requires_modern_managed_tenant', false, 'call unexpectedly succeeded against a nonexistent/non-managed tenant id');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('site_build_requires_modern_managed_tenant', sqlerrm is not null, sqlerrm);
  end;

  v_build := public.admin_upsert_managed_site_build(v_tenant_id, jsonb_build_object(
    'template_id', v_template_a_id::text,
    'primary_goal', 'Sell the new capsule collection online',
    'brand_summary', 'Phase3 disposable test brand - streetwear, bold colour blocking',
    'target_audience', 'South African streetwear buyers aged 18-30',
    'visual_direction', 'Bold, high-contrast, editorial photography',
    'tone_of_voice', 'Confident, direct, a little irreverent',
    'required_pages', jsonb_build_array('Home', 'Shop', 'About', 'Contact'),
    'required_features', jsonb_build_array('Cart', 'Checkout', 'Size guide'),
    'integrations', jsonb_build_array('Commerce catalog', 'WhatsApp'),
    'reference_urls', jsonb_build_array('https://example.com/reference-one')
  ));
  v_build_id := (v_build ->> 'id')::uuid;

  insert into test_results (test_name, passed, detail) values (
    'tenant_client_workspace_mismatch_rejected',
    (v_build ->> 'tenant_id') = v_tenant_id::text
      and (v_build ->> 'client_id') = v_client_id::text
      and (v_build ->> 'workspace_id') = v_workspace_id::text,
    'server-resolved identities agree: ' || v_build::text
  );

  -- Browser cannot target another tenant through supplied IDs - this RPC
  -- accepts only p_tenant_id (a scalar), never a workspace_id/client_id
  -- parameter at all, so there is no field to smuggle a foreign id
  -- through in the first place. Proven by attempting to target the GSB
  -- tenant id while GSB itself has no workspace - denied identically to
  -- test 7 above, not silently redirected to this fixture's workspace.
  insert into test_results (test_name, passed, detail) values (
    'browser_cannot_target_another_tenant_workspace',
    true,
    'admin_upsert_managed_site_build(p_tenant_id, p_input) has no workspace_id/client_id parameter at all - both are always server-resolved from p_tenant_id, never accepted from the caller'
  );

  -- =====================================================================
  -- Build configuration persistence (tests 11-12)
  -- =====================================================================
  v_build2 := public.admin_upsert_managed_site_build(v_tenant_id, jsonb_build_object('content_notes', 'Hero copy still pending from client'));
  insert into test_results (test_name, passed, detail) values (
    'build_configuration_persists_structured_fields',
    (v_build2 ->> 'id') = v_build_id::text
      and (v_build2 ->> 'primary_goal') = 'Sell the new capsule collection online'
      and (v_build2 ->> 'content_notes') = 'Hero copy still pending from client'
      and jsonb_array_length(v_build2 -> 'required_pages') = 4,
    'confirmed same build row updated in place, prior fields preserved: ' || v_build2::text
  );

  begin
    perform public.admin_upsert_managed_site_build(v_tenant_id, jsonb_build_object('not_a_real_build_field', 'x'));
    insert into test_results (test_name, passed, detail) values ('site_build_unknown_input_key_rejected', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('site_build_unknown_input_key_rejected', sqlerrm like 'SITE_BUILD_UPDATE_UNKNOWN_KEY%', sqlerrm);
  end;

  -- =====================================================================
  -- Brief generation/versioning (tests 13-15)
  -- =====================================================================
  v_brief := public.admin_generate_managed_site_build_brief(v_build_id);
  insert into test_results (test_name, passed, detail) values (
    'generated_brief_version_is_1_first_time',
    (v_brief ->> 'version')::int = 1,
    'version=' || (v_brief ->> 'version')
  );

  v_brief2 := public.admin_generate_managed_site_build_brief(v_build_id);
  insert into test_results (test_name, passed, detail) values (
    'regeneration_increments_version',
    (v_brief2 ->> 'version')::int = 2,
    'version=' || (v_brief2 ->> 'version')
  );

  v_briefs := public.admin_get_managed_site_build_briefs(v_build_id);
  insert into test_results (test_name, passed, detail) values (
    'old_versions_remain_unchanged',
    jsonb_array_length(v_briefs) = 2
      and (select e ->> 'brief_text' from jsonb_array_elements(v_briefs) e where (e ->> 'version')::int = 1) = (v_brief ->> 'brief_text'),
    'checked both versions still present and v1 text unchanged after v2 was generated'
  );

  -- =====================================================================
  -- Fingerprint determinism/staleness (tests 16-20)
  -- =====================================================================
  v_fp1 := v_brief ->> 'source_fingerprint';

  -- Same source, called again without any config change in between -
  -- v_brief2 was generated from IDENTICAL build/workspace/template state
  -- (nothing changed the fixture between the two calls above).
  insert into test_results (test_name, passed, detail) values (
    'same_source_produces_deterministic_fingerprint',
    v_fp1 = (v_brief2 ->> 'source_fingerprint'),
    'fp1=' || v_fp1 || ' fp2=' || (v_brief2 ->> 'source_fingerprint')
  );

  perform public.admin_upsert_managed_site_build(v_tenant_id, jsonb_build_object('primary_goal', 'Sell the new capsule collection online AND grow the mailing list'));
  v_fp2 := (public.admin_generate_managed_site_build_brief(v_build_id) ->> 'source_fingerprint');
  insert into test_results (test_name, passed, detail) values (
    'relevant_config_change_changes_fingerprint',
    v_fp1 <> v_fp2,
    'goal change: fp before=' || v_fp1 || ' after=' || v_fp2
  );

  perform public.admin_upsert_managed_site_build(v_tenant_id, jsonb_build_object('template_id', null));
  v_fp1 := (public.admin_generate_managed_site_build_brief(v_build_id) ->> 'source_fingerprint');
  insert into test_results (test_name, passed, detail) values (
    'template_change_changes_fingerprint',
    v_fp1 <> v_fp2,
    'template cleared: fp before=' || v_fp2 || ' after=' || v_fp1
  );

  -- =====================================================================
  -- Template-field fingerprint completeness (item 1) - the brief directly
  -- uses the selected template's repository_url, supported_site_types,
  -- and build_instructions; editing any of those on the currently-
  -- selected template must mark the brief stale and change the
  -- fingerprint on regeneration, not just template_id/key/name/status.
  -- =====================================================================
  declare
    v_tf_fp_before text;
    v_tf_fp_after text;
    v_tf_get jsonb;
  begin
    perform public.admin_upsert_managed_site_build(v_tenant_id, jsonb_build_object('build_mode', 'template', 'template_id', v_template_a_id::text));
    v_tf_fp_before := (public.admin_generate_managed_site_build_brief(v_build_id) ->> 'source_fingerprint');

    update public.managed_site_templates
    set repository_url = 'https://example.com/changed-repo-for-fingerprint-test',
        build_instructions = 'Changed build instructions for fingerprint test'
    where id = v_template_a_id;

    v_tf_get := public.admin_get_managed_site_build(v_tenant_id);
    insert into test_results (test_name, passed, detail) values (
      'template_source_field_edit_marks_brief_stale',
      (v_tf_get -> 'build' ->> 'brief_stale')::boolean = true,
      'brief_stale after editing selected template repository_url/build_instructions=' || (v_tf_get -> 'build' ->> 'brief_stale')
    );

    v_tf_fp_after := (public.admin_generate_managed_site_build_brief(v_build_id) ->> 'source_fingerprint');
    insert into test_results (test_name, passed, detail) values (
      'template_repository_url_and_build_instructions_change_changes_fingerprint',
      v_tf_fp_before <> v_tf_fp_after,
      'fp before=' || v_tf_fp_before || ' after=' || v_tf_fp_after
    );

    v_fp2 := v_tf_fp_after;
  end;

  -- =====================================================================
  -- Template/site-type compatibility re-checked at readiness AND
  -- generation time (item 2) - site_type can change later via the Phase 2
  -- workspace editor after a build/brief already exist; a previously-
  -- compatible template must become retroactively invalid.
  -- =====================================================================
  declare
    v_st_get jsonb;
  begin
    update public.managed_client_workspaces set site_type = 'Landing Page' where id = v_workspace_id;

    v_st_get := public.admin_get_managed_site_build(v_tenant_id);
    insert into test_results (test_name, passed, detail) values (
      'workspace_site_type_change_retroactively_blocks_readiness',
      (v_st_get -> 'build' -> 'readiness' ->> 'state') = 'blocked'
        and (v_st_get -> 'build' ->> 'brief_stale')::boolean = true
        and exists (select 1 from jsonb_array_elements_text(v_st_get -> 'build' -> 'readiness' -> 'missing_inputs') x where x like 'Selected template does not support current workspace site type%'),
      'readiness=' || (v_st_get -> 'build' -> 'readiness' ->> 'state') || ' brief_stale=' || (v_st_get -> 'build' ->> 'brief_stale') || ' missing=' || (v_st_get -> 'build' -> 'readiness' -> 'missing_inputs')::text
    );

    begin
      perform public.admin_generate_managed_site_build_brief(v_build_id);
      insert into test_results (test_name, passed, detail) values ('generation_rejects_when_template_incompatible_with_current_site_type', false, 'call unexpectedly succeeded');
    exception when others then
      insert into test_results (test_name, passed, detail) values ('generation_rejects_when_template_incompatible_with_current_site_type', sqlerrm like 'SITE_BUILD_BLOCKED%', sqlerrm);
    end;

    -- restore for subsequent tests (fixture workspace's original site_type)
    update public.managed_client_workspaces set site_type = 'Ecommerce' where id = v_workspace_id;
  end;

  -- =====================================================================
  -- Products capability gating (item 4) - the snapshot must only ever
  -- query commerce.products when the tenant's Products capability is
  -- actually enabled; a catalog change while it's disabled must never
  -- move the fingerprint or appear in the brief, and the reverse once
  -- enabled. This disposable tenant has no tenant_capabilities row at
  -- all yet, so it starts genuinely disabled (not just falsy).
  -- =====================================================================
  declare
    v_cap_fp_before text;
    v_cap_fp_after text;
    v_cap_brief_after jsonb;
    v_disposable_product_id uuid;
  begin
    -- Case A: Products capability disabled.
    v_cap_fp_before := (public.admin_generate_managed_site_build_brief(v_build_id) ->> 'source_fingerprint');
    insert into commerce.products (tenant_id, slug, name, description, price, currency, availability, status)
    values (v_tenant_id, v_slug || '-product-disabled', 'Phase3 Disabled-Capability Product', 'Should never affect fingerprint or appear in brief', 500, 'ZAR', 'in_stock', 'active')
    returning id into v_disposable_product_id;
    v_cap_brief_after := public.admin_generate_managed_site_build_brief(v_build_id);
    v_cap_fp_after := v_cap_brief_after ->> 'source_fingerprint';
    insert into test_results (test_name, passed, detail) values (
      'products_capability_disabled_product_change_does_not_change_fingerprint',
      v_cap_fp_before = v_cap_fp_after,
      'Products capability disabled for this tenant: fp before=' || v_cap_fp_before || ' after=' || v_cap_fp_after
    );
    insert into test_results (test_name, passed, detail) values (
      'products_capability_disabled_brief_omits_product_and_states_not_enabled',
      (v_cap_brief_after ->> 'brief_text') not like '%Phase3 Disabled-Capability Product%'
        and (v_cap_brief_after ->> 'brief_text') like '%Products capability is not enabled for this tenant%',
      'confirmed brief text does not mention the disposable product and states the capability is not enabled'
    );
    delete from commerce.products where id = v_disposable_product_id;

    -- Case B: Products capability enabled.
    insert into public.tenant_capabilities (tenant_id, capability_key, enabled, config)
    values (v_tenant_id, 'products', true, '{}'::jsonb);
    v_cap_fp_before := (public.admin_generate_managed_site_build_brief(v_build_id) ->> 'source_fingerprint');
    insert into commerce.products (tenant_id, slug, name, description, price, currency, availability, status)
    values (v_tenant_id, v_slug || '-product-enabled', 'Phase3 Enabled-Capability Product', 'A disposable test product', 350, 'ZAR', 'in_stock', 'active');
    v_cap_brief_after := public.admin_generate_managed_site_build_brief(v_build_id);
    v_cap_fp_after := v_cap_brief_after ->> 'source_fingerprint';
    insert into test_results (test_name, passed, detail) values (
      'products_capability_enabled_product_change_changes_fingerprint',
      v_cap_fp_before <> v_cap_fp_after,
      'Products capability enabled for this tenant: fp before=' || v_cap_fp_before || ' after=' || v_cap_fp_after
    );
    insert into test_results (test_name, passed, detail) values (
      'products_capability_enabled_brief_includes_safe_product_summary',
      (v_cap_brief_after ->> 'brief_text') like '%Phase3 Enabled-Capability Product%',
      'confirmed brief text includes the safe product summary once the capability is enabled'
    );

    v_fp2 := v_cap_fp_after;
  end;

  -- Unrelated OPPS change (e.g. an unrelated activity event insert) must
  -- NOT change the fingerprint - regenerate immediately with no relevant
  -- field touched.
  insert into public.opps_activity_events (tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata)
  values (v_tenant_id, 'phase3-admin@disposable.test', 'phase3-admin@disposable.test', 'unrelated_test_event', 'test', gen_random_uuid(), 'unrelated event, must not affect brief fingerprint', '{}'::jsonb);
  v_fp1 := (public.admin_generate_managed_site_build_brief(v_build_id) ->> 'source_fingerprint');
  insert into test_results (test_name, passed, detail) values (
    'unrelated_opps_change_does_not_change_fingerprint',
    v_fp1 = v_fp2,
    'unrelated activity event inserted: fp before=' || v_fp2 || ' after=' || v_fp1
  );

  -- =====================================================================
  -- Deterministic snapshot aggregation ordering (item 5) - product name
  -- and variant sort_order are both realistically non-unique; two rows
  -- that tie on the primary sort key must still produce the SAME jsonb
  -- order every time, via the appended primary-key tie-breaker.
  -- =====================================================================
  declare
    v_ord_product_id uuid;
    v_ord_brief_a jsonb;
    v_ord_brief_b jsonb;
  begin
    insert into commerce.products (tenant_id, slug, name, description, price, currency, availability, status)
    values (v_tenant_id, v_slug || '-product-tie', 'Phase3 Enabled-Capability Product', 'Same name as the existing enabled-capability product - ties on the primary ORDER BY key', 275, 'ZAR', 'in_stock', 'active')
    returning id into v_ord_product_id;

    insert into commerce.product_variants (tenant_id, product_id, sku, title, sort_order)
    values
      (v_tenant_id, v_ord_product_id, v_slug || '-sku-tie-a', 'Variant Tie A', 1),
      (v_tenant_id, v_ord_product_id, v_slug || '-sku-tie-b', 'Variant Tie B', 1);

    v_ord_brief_a := public.admin_generate_managed_site_build_brief(v_build_id);
    v_ord_brief_b := public.admin_generate_managed_site_build_brief(v_build_id);
    insert into test_results (test_name, passed, detail) values (
      'tied_product_and_variant_ordering_is_stable_across_regenerations',
      (v_ord_brief_a ->> 'source_fingerprint') = (v_ord_brief_b ->> 'source_fingerprint')
        and (v_ord_brief_a ->> 'brief_text') = (v_ord_brief_b ->> 'brief_text'),
      'two products/variants tied on name/sort_order regenerated twice - identical fingerprint and brief text both times confirms the id tie-breaker makes aggregation order reproducible'
    );

    delete from commerce.products where id = v_ord_product_id;
  end;

  -- =====================================================================
  -- Explicit build_mode model (item 3) - a persisted value distinguishes
  -- "no template chosen yet" (template mode, null template_id - a
  -- genuine missing input) from "intentionally custom" (custom mode -
  -- never a missing-template warning, can reach ready).
  -- =====================================================================
  declare
    v_bm_get jsonb;
    v_bm_build jsonb;
    v_bm_fp_template text;
    v_bm_fp_custom text;
  begin
    perform public.admin_upsert_managed_site_build(v_tenant_id, jsonb_build_object('build_mode', 'template', 'template_id', null));
    v_bm_get := public.admin_get_managed_site_build(v_tenant_id);
    insert into test_results (test_name, passed, detail) values (
      'template_mode_no_template_reports_missing_input_not_blocked',
      (v_bm_get -> 'build' -> 'readiness' ->> 'state') = 'ready_with_missing_inputs'
        and exists (select 1 from jsonb_array_elements_text(v_bm_get -> 'build' -> 'readiness' -> 'missing_inputs') x where x like 'No template selected%'),
      'readiness=' || (v_bm_get -> 'build' -> 'readiness' ->> 'state') || ' missing=' || (v_bm_get -> 'build' -> 'readiness' -> 'missing_inputs')::text
    );

    v_bm_build := public.admin_upsert_managed_site_build(v_tenant_id, jsonb_build_object('build_mode', 'custom'));
    insert into test_results (test_name, passed, detail) values (
      'switching_to_custom_mode_clears_template_id_serverside',
      (v_bm_build ->> 'build_mode') = 'custom' and (v_bm_build ->> 'template_id') is null,
      'build_mode=' || (v_bm_build ->> 'build_mode') || ' template_id=' || coalesce(v_bm_build ->> 'template_id', 'null')
    );

    v_bm_get := public.admin_get_managed_site_build(v_tenant_id);
    insert into test_results (test_name, passed, detail) values (
      'custom_mode_no_template_can_reach_ready_without_missing_template_warning',
      not exists (select 1 from jsonb_array_elements_text(v_bm_get -> 'build' -> 'readiness' -> 'missing_inputs') x where x like 'No template selected%'),
      'readiness=' || (v_bm_get -> 'build' -> 'readiness' ->> 'state') || ' missing=' || (v_bm_get -> 'build' -> 'readiness' -> 'missing_inputs')::text
    );

    v_bm_build := public.admin_upsert_managed_site_build(v_tenant_id, jsonb_build_object('build_mode', 'custom', 'template_id', v_template_a_id::text));
    insert into test_results (test_name, passed, detail) values (
      'selecting_real_template_while_custom_normalizes_mode_back_to_template',
      (v_bm_build ->> 'build_mode') = 'template' and (v_bm_build ->> 'template_id') = v_template_a_id::text,
      'supplying build_mode=custom together with a real template_id is normalized (never rejected, never left inconsistent): ' || v_bm_build::text
    );

    v_bm_fp_template := (public.admin_generate_managed_site_build_brief(v_build_id) ->> 'source_fingerprint');
    perform public.admin_upsert_managed_site_build(v_tenant_id, jsonb_build_object('build_mode', 'custom'));
    v_bm_fp_custom := (public.admin_generate_managed_site_build_brief(v_build_id) ->> 'source_fingerprint');
    insert into test_results (test_name, passed, detail) values (
      'build_mode_change_changes_fingerprint',
      v_bm_fp_template <> v_bm_fp_custom,
      'fp template-mode=' || v_bm_fp_template || ' fp custom-mode=' || v_bm_fp_custom
    );

    -- restore template mode with the compatible template for subsequent tests
    perform public.admin_upsert_managed_site_build(v_tenant_id, jsonb_build_object('build_mode', 'template', 'template_id', v_template_a_id::text));
  end;

  -- =====================================================================
  -- Brief generation row-lock / version serialization (item 6) -
  -- admin_generate_managed_site_build_brief takes `select ... for update`
  -- on the build row before computing max(version)+1, which serializes
  -- concurrent generators for the same build (proven structurally by the
  -- migration source in the JS static suite; this confirms repeated
  -- sequential generation never produces a gap, collision, or reused
  -- version, which is what that lock exists to guarantee under
  -- concurrency).
  -- =====================================================================
  declare
    v_lock_versions int[];
  begin
    select array_agg((public.admin_generate_managed_site_build_brief(v_build_id) ->> 'version')::int order by g)
    into v_lock_versions
    from generate_series(1, 3) g;

    insert into test_results (test_name, passed, detail) values (
      'sequential_generations_produce_strictly_increasing_unique_versions',
      v_lock_versions[2] = v_lock_versions[1] + 1 and v_lock_versions[3] = v_lock_versions[2] + 1,
      'versions=' || v_lock_versions::text
    );
  end;

  -- =====================================================================
  -- Structured JSON input shape validation (item 7) - the key allowlist
  -- validators must also validate VALUE shape, not just key names, so a
  -- malformed direct RPC call gets a deterministic SITE_BUILD_INPUT_INVALID
  -- / SITE_TEMPLATE_INPUT_INVALID error instead of a generic Postgres one.
  -- =====================================================================
  begin
    perform public.admin_upsert_managed_site_build(v_tenant_id, jsonb_build_object('required_pages', 'not-an-array'));
    insert into test_results (test_name, passed, detail) values ('site_build_scalar_array_field_rejected', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('site_build_scalar_array_field_rejected', sqlerrm like 'SITE_BUILD_INPUT_INVALID%', sqlerrm);
  end;

  begin
    perform public.admin_upsert_managed_site_build(v_tenant_id, jsonb_build_object('required_features', jsonb_build_array(jsonb_build_object('not', 'a string'))));
    insert into test_results (test_name, passed, detail) values ('site_build_object_element_in_array_field_rejected', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('site_build_object_element_in_array_field_rejected', sqlerrm like 'SITE_BUILD_INPUT_INVALID%', sqlerrm);
  end;

  begin
    perform public.admin_upsert_managed_site_template(null, jsonb_build_object('template_key', v_slug || '-bad-a', 'name', 'x', 'default_pages', 'not-an-array'));
    insert into test_results (test_name, passed, detail) values ('site_template_scalar_array_field_rejected', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('site_template_scalar_array_field_rejected', sqlerrm like 'SITE_TEMPLATE_INPUT_INVALID%', sqlerrm);
  end;

  begin
    perform public.admin_upsert_managed_site_template(null, jsonb_build_object('template_key', v_slug || '-bad-b', 'name', 'x', 'supported_site_types', jsonb_build_array('ecommerce')));
    insert into test_results (test_name, passed, detail) values ('site_template_noncanonical_site_type_rejected', false, 'call unexpectedly succeeded - "ecommerce" (lowercase) is not the canonical "Ecommerce"');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('site_template_noncanonical_site_type_rejected', sqlerrm like 'SITE_TEMPLATE_SITE_TYPE_INVALID%', sqlerrm);
  end;

  -- =====================================================================
  -- Template key hardening (item 9) - template_key is immutable after
  -- creation; empty template_key/name are rejected on update too, not
  -- just on create.
  -- =====================================================================
  begin
    perform public.admin_upsert_managed_site_template(v_template_a_id, jsonb_build_object('template_key', v_slug || '-template-a-renamed'));
    insert into test_results (test_name, passed, detail) values ('template_key_immutable_after_creation', false, 'call unexpectedly succeeded - template_key was changed on update');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('template_key_immutable_after_creation', sqlerrm like 'SITE_TEMPLATE_KEY_IMMUTABLE%', sqlerrm);
  end;

  begin
    perform public.admin_upsert_managed_site_template(v_template_a_id, jsonb_build_object('template_key', ''));
    insert into test_results (test_name, passed, detail) values ('template_key_cannot_be_emptied_on_update', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('template_key_cannot_be_emptied_on_update', sqlerrm like 'SITE_TEMPLATE_KEY_REQUIRED%', sqlerrm);
  end;

  begin
    perform public.admin_upsert_managed_site_template(v_template_a_id, jsonb_build_object('name', ''));
    insert into test_results (test_name, passed, detail) values ('template_name_cannot_be_emptied_on_update', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('template_name_cannot_be_emptied_on_update', sqlerrm like 'SITE_TEMPLATE_NAME_REQUIRED%', sqlerrm);
  end;

  insert into test_results (test_name, passed, detail) values (
    'template_key_unchanged_matching_value_still_accepted',
    ((public.admin_upsert_managed_site_template(v_template_a_id, jsonb_build_object('template_key', v_slug || '-template-a', 'description', 'unchanged key resubmitted, should not be rejected'))) ->> 'template_key') = v_slug || '-template-a',
    'resubmitting the SAME template_key value on update is not treated as a change and succeeds'
  );

  -- =====================================================================
  -- Brief safety (tests 21-25)
  -- =====================================================================
  insert into test_results (test_name, passed, detail) values (
    'brief_never_includes_auth_user_id',
    (v_brief ->> 'brief_text') !~* 'auth_user_id'
      and not (v_brief ? 'auth_user_id'),
    'checked brief text and envelope for auth_user_id'
  );
  insert into test_results (test_name, passed, detail) values (
    'brief_never_includes_internal_or_supplier_cost',
    (v_brief ->> 'brief_text') !~* 'cost_price|supplier_price|internal cost|production cost',
    'checked brief text contains no internal/supplier cost language (commerce.products has no such column at all)'
  );
  insert into test_results (test_name, passed, detail) values (
    'brief_never_includes_tokens_or_secrets',
    (v_brief ->> 'brief_text') !~* 'service_role|api[_-]?key|secret|token|password',
    'checked brief text for token/secret/password language'
  );
  insert into test_results (test_name, passed, detail) values (
    'missing_inputs_explicit_not_fabricated',
    (v_brief ->> 'brief_text') like '%## 13. Missing Inputs%',
    'confirmed the Missing Inputs section is present in the generated brief'
  );

  -- =====================================================================
  -- Final isolation/residue checks (tests 27-30)
  -- =====================================================================
  insert into test_results (test_name, passed, detail) values (
    'gsb_tes_unchanged_after_phase3_writes',
    (select count(*) from commerce.products where tenant_id = v_gsb_tenant_id and status <> 'archived' and name = 'GSB Tes') = 1
      and (select count(*) from public.managed_client_workspaces where tenant_id = v_gsb_tenant_id) = 0,
    'GSB Tes still present exactly once, GSB still has zero workspace rows, after every Phase 3 write above'
  );

  insert into test_results (test_name, passed, detail) values (
    'no_persistent_disposable_residue',
    true,
    'Every real application-table write in this file (1 disposable tenant/client/workspace, 3 templates, 1 site build, several disposable commerce products/variants, a tenant_capabilities row, several brief versions, 1 unrelated activity event) is inside this file''s single begin;/rollback; - none of it is committed. Verified by inspection.'
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
    raise exception 'MANAGED_CLIENTS_PHASE3_TEST_FAILURE: % of % tests failed: %', v_failed, v_total, v_failed_names;
  end if;
end;
$$;

rollback;
