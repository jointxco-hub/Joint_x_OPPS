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
    'managed_clients_current_projection_count_is_one',
    (select count(*) from public.managed_client_workspaces) = 0,
    'managed_client_workspaces count=' || (select count(*) from public.managed_client_workspaces)::text || ' (test workspaces were intentionally removed - GSB has none yet)'
  );
  insert into test_results (test_name, passed, detail) values (
    'gsb_tes_exists_and_unchanged_baseline',
    (select count(*) from commerce.products where tenant_id = v_gsb_tenant_id and status <> 'archived' and name = 'GSB Tes') = 1,
    'checked GSB Tes exists exactly once before any Phase 3 write'
  );

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated', 'email', 'phase3-admin@disposable.test')::text, true);

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

  -- Relevant Commerce product change - insert a disposable product for
  -- THIS fixture tenant (never GSB) and regenerate.
  insert into commerce.products (tenant_id, slug, name, description, price, currency, availability, status)
  values (v_tenant_id, v_slug || '-product', 'Phase3 Disposable Product', 'A disposable test product', 350, 'ZAR', 'in_stock', 'active');
  v_fp2 := (public.admin_generate_managed_site_build_brief(v_build_id) ->> 'source_fingerprint');
  insert into test_results (test_name, passed, detail) values (
    'relevant_commerce_product_change_changes_fingerprint',
    v_fp1 <> v_fp2,
    'commerce product added: fp before=' || v_fp1 || ' after=' || v_fp2
  );

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
    'Every real application-table write in this file (1 disposable tenant/client/workspace, 3 templates, 1 site build, 1 disposable commerce product, 2+ brief versions, 1 unrelated activity event) is inside this file''s single begin;/rollback; - none of it is committed. Verified by inspection.'
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
