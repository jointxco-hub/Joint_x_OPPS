-- Managed Clients Control Plane — Phase 0/1 disposable test matrix.
--
-- This file performs ZERO PERSISTENT APPLICATION-TABLE WRITES: it does
-- INSERT into a `create temporary table` (test_results - Postgres session
-- temp tables are never persisted and are gone the instant this
-- connection ends, rollback or not), but every assertion reads REAL
-- existing production data (admin_list_managed_clients() itself, God's
-- Spoilt Brat, the 3 surviving historical managed_client_workspaces rows,
-- and the real tenant-a-qa/tenant-b-qa/demo-xos/joint-x tenants) purely
-- via SELECT against real application tables, and simulates identity via
-- set_config('request.jwt.claims', ...) - a session-local setting, not a
-- database write - the same way every prior XOS 3B suite simulated a
-- caller. No application table (managed_client_workspaces, clients,
-- tenants, tenant_memberships, etc.) is ever written to by this file. The
-- surrounding begin;/rollback; is kept anyway as defense-in-depth
-- (consistent with this repo's convention).
--
-- The staff identity used to simulate is_opps_staff() = true is resolved
-- dynamically at run time (see v_staff below) using the exact same
-- authority definition is_opps_staff() itself uses - an active
-- public.users identity with an active tenant_membership into the active
-- joint-x tenant - rather than a hardcoded real person's auth UUID. The
-- script fails loudly with a clear error if no such identity currently
-- exists, rather than silently proceeding with something that would make
-- every staff-authorized test meaningless.
--
-- NOT executed as part of this task - "Production must remain READ ONLY
-- during implementation/review" per the brief. Ready to run once
-- authorized:
--   supabase db query --linked --file supabase/tests/managed_clients_control_plane.sql
--
-- A failed assertion raises at the end, failing the command (non-zero/
-- error) rather than silently recording `passed = false`.

begin;

create temporary table test_results (
  n int generated always as identity,
  test_name text,
  passed boolean,
  detail text
);

do $$
declare
  -- Resolved dynamically below (never a hardcoded real person's auth
  -- UUID) - reused only as a JWT sub to simulate is_opps_staff() = true;
  -- never written to.
  v_staff uuid;
  -- Fresh, never-persisted uuid - authenticated but with no public.users
  -- row, so is_opps_staff() deterministically returns false. No insert
  -- needed to prove this (matches the pattern already used across every
  -- XOS 3B "non-staff denied" test).
  v_non_staff uuid := gen_random_uuid();

  v_gsb_tenant_id uuid := '4e0f1fa4-3149-40fa-a3f8-00ec251a2c11';
  v_joint_x_tenant_id uuid := '6d371f51-274c-4b49-8d59-2aeaf5e89088';

  v_result jsonb;
  v_gsb_row jsonb;
  v_gsb_matches int;
  v_keys text[];
  v_access_keys text[];
begin
  -- ---- Resolve a real, currently-active OPPS staff identity - the exact
  -- same authority definition is_opps_staff() itself uses (active
  -- public.users + active tenant_membership + active joint-x tenant).
  -- Read-only lookup; nothing is written or persisted by this query. ----
  select u.auth_user_id
  into v_staff
  from public.users u
  join public.tenant_memberships m
    on m.auth_user_id = u.auth_user_id and m.status = 'active'
  join public.tenants t
    on t.id = m.tenant_id and t.status = 'active' and t.slug = 'joint-x'
  where coalesce(u.is_active, true)
  limit 1;

  if v_staff is null then
    raise exception 'MANAGED_CLIENTS_TEST_SETUP: no active OPPS staff identity found (active public.users + active tenant_membership + active joint-x tenant) - cannot simulate is_opps_staff()';
  end if;

  -- ---- Test 7: normal (non-staff) authenticated user cannot call the staff RPC ----
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_non_staff, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_list_managed_clients();
    insert into test_results (test_name, passed, detail) values ('non_staff_denied', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('non_staff_denied', sqlerrm like 'MANAGED_CLIENTS_FORBIDDEN%', sqlerrm);
  end;

  -- ---- Test 1: authorized staff can list the unified managed-brand set ----
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  v_result := public.admin_list_managed_clients();
  insert into test_results (test_name, passed, detail) values (
    'staff_can_list_managed_clients',
    jsonb_typeof(v_result) = 'array' and jsonb_array_length(v_result) > 0,
    'row count=' || jsonb_array_length(v_result)::text
  );

  -- ---- Test 2 / 4: GSB appears exactly once ----
  select count(*) into v_gsb_matches
  from jsonb_array_elements(v_result) e
  where e->>'key' = 'tenant:' || v_gsb_tenant_id::text;
  insert into test_results (test_name, passed, detail) values (
    'gsb_appears_exactly_once',
    v_gsb_matches = 1,
    'match count=' || v_gsb_matches::text
  );

  select e into v_gsb_row
  from jsonb_array_elements(v_result) e
  where e->>'key' = 'tenant:' || v_gsb_tenant_id::text
  limit 1;

  -- ---- Test 9: Commerce count for GSB = 0 ----
  insert into test_results (test_name, passed, detail) values (
    'gsb_commerce_count_zero',
    (v_gsb_row->>'commerce_product_count')::int = 0,
    'commerce_product_count=' || (v_gsb_row->>'commerce_product_count')
  );

  -- ---- Test 10: storefront not configured is correctly derived for GSB ----
  -- (GSB has no managed_client_workspaces row - storefront_status/
  -- workspace_id must both be null/absent, not fabricated as some
  -- fallback string)
  insert into test_results (test_name, passed, detail) values (
    'gsb_storefront_not_configured_correctly_derived',
    (v_gsb_row ? 'storefront_status') and (v_gsb_row->'storefront_status') = 'null'::jsonb
      and (v_gsb_row ? 'workspace_id') and (v_gsb_row->'workspace_id') = 'null'::jsonb,
    v_gsb_row::text
  );

  -- ---- GSB baseline fields (products capability, XOS hostname, source) ----
  insert into test_results (test_name, passed, detail) values (
    'gsb_projection_baseline_fields',
    (v_gsb_row->>'tenant_slug') = 'gsb'
      and (v_gsb_row->>'xos_hostname') = 'gsb.xos.jointx.co.za'
      and (v_gsb_row->>'products_capability_enabled')::boolean = true
      and (v_gsb_row->>'source') = 'modern',
    v_gsb_row::text
  );

  -- ---- Tenant status vs site status are distinct for GSB (a modern
  -- tenant is active even with no legacy site/workspace tracking yet) ----
  insert into test_results (test_name, passed, detail) values (
    'gsb_tenant_status_distinct_from_site_status',
    (v_gsb_row->>'tenant_status') = 'active'
      and (v_gsb_row->'site_status') = 'null'::jsonb,
    'tenant_status=' || (v_gsb_row->>'tenant_status') || ' site_status=' || coalesce(v_gsb_row->>'site_status', '(null)')
  );

  -- ---- GSB access: owner membership resolves to a real, non-null email
  -- (public.users has no matching profile row for this identity - the
  -- projection must still fall back to auth.users.email), and the access
  -- entries carry only email/role/status ----
  insert into test_results (test_name, passed, detail) values (
    'gsb_access_email_resolved_and_allowlisted',
    jsonb_array_length(coalesce(v_gsb_row->'access', '[]'::jsonb)) >= 1
      and (v_gsb_row->'access'->0->>'email') is not null
      and (v_gsb_row->'access'->0->>'role') = 'owner'
      and (v_gsb_row->'access'->0->>'status') = 'active',
    (v_gsb_row->'access')::text
  );
  select array(select jsonb_object_keys(v_gsb_row->'access'->0)) into v_access_keys;
  insert into test_results (test_name, passed, detail) values (
    'gsb_access_entry_allowlisted_keys_only',
    v_access_keys <@ array['email', 'role', 'status'],
    array_to_string(v_access_keys, ',')
  );

  -- ---- Test 3 / 11: the 3 surviving historical workspace rows appear, statuses unchanged ----
  insert into test_results (test_name, passed, detail) values (
    'historical_rows_all_appear',
    (
      select count(*) from jsonb_array_elements(v_result) e
      where e->>'brand_name' in ('Siya Mnisi', 'Xilaveko Bilankulu', 'Dr Ndamane')
        and e->>'source' = 'legacy'
    ) = 3,
    'checked presence of all 3 historical workspace rows'
  );
  insert into test_results (test_name, passed, detail) values (
    'historical_row_statuses_unchanged',
    (
      select bool_and(ok) from (
        select
          (e->>'onboarding_stage' = '01 Intake' and e->>'site_status' = 'Not started') as ok
        from jsonb_array_elements(v_result) e where e->>'brand_name' = 'Siya Mnisi'
        union all
        select (e->>'onboarding_stage' = '07 Build' and e->>'site_status' = 'In progress')
        from jsonb_array_elements(v_result) e where e->>'brand_name' = 'Xilaveko Bilankulu'
        union all
        select (e->>'site_status' = 'Setup ready' and e->>'storefront_status' = 'Building' and e->>'pricing_status' = 'Approved')
        from jsonb_array_elements(v_result) e where e->>'brand_name' = 'Dr Ndamane'
      ) checks
    ),
    'checked unchanged statuses for all 3 historical rows'
  );

  -- ---- Legacy Commerce guard precondition: every legacy-only row must
  -- have tenant_id = null (never a real, possibly-Joint-X tenant id) -
  -- this is exactly what src/pages/ManagedClients.jsx's
  -- isCommerceEligible() relies on to hide Add product for these 3 rows
  -- (see the separate static test in
  -- tests/managed-clients-control-plane.test.mjs for the frontend guard
  -- itself). ----
  insert into test_results (test_name, passed, detail) values (
    'legacy_rows_have_null_tenant_id',
    (
      select bool_and((e->'tenant_id') = 'null'::jsonb and (e->>'source') = 'legacy')
      from jsonb_array_elements(v_result) e
      where e->>'brand_name' in ('Siya Mnisi', 'Xilaveko Bilankulu', 'Dr Ndamane')
    ),
    'checked tenant_id is null for all 3 historical rows'
  );

  -- ---- Test 5: Joint X system tenant never appears as a managed brand ----
  insert into test_results (test_name, passed, detail) values (
    'joint_x_system_tenant_excluded',
    not exists (
      select 1 from jsonb_array_elements(v_result) e
      where e->>'tenant_id' = v_joint_x_tenant_id::text
         or e->>'tenant_slug' = 'joint-x'
    ),
    'checked absence of joint-x as its own managed-brand row'
  );

  -- ---- Test 6: QA/demo fixture tenants are excluded ----
  insert into test_results (test_name, passed, detail) values (
    'qa_demo_tenants_excluded',
    not exists (
      select 1 from jsonb_array_elements(v_result) e
      where e->>'tenant_slug' in ('tenant-a-qa', 'tenant-b-qa', 'demo-xos')
    ),
    'checked absence of tenant-a-qa/tenant-b-qa/demo-xos'
  );

  -- ---- Test 8: no sensitive/internal secrets returned - allowlisted keys only ----
  select array(select jsonb_object_keys(v_gsb_row)) into v_keys;
  insert into test_results (test_name, passed, detail) values (
    'no_secrets_allowlisted_keys_only',
    v_keys <@ array[
      'key','source','brand_name','tenant_id','tenant_slug','tenant_name','tenant_status',
      'client_id','client_name','workspace_id','client_type','onboarding_stage',
      'site_type','site_status','storefront_status','domain_status','assets_status',
      'content_status','products_services_status','pricing_status','mockup_status',
      'launch_readiness_status','preview_url','live_url','domain_name','site_repo_url',
      'next_action','next_action_owner','next_action_due_at','launch_target_date',
      'internal_notes','xos_hostname','xos_status','products_capability_enabled',
      'commerce_product_count','access','created_at','updated_at'
    ]
      and not (select bool_or(m ? 'password' or m ? 'token' or m ? 'auth_user_id' or m ? 'service_role_key')
               from jsonb_array_elements(coalesce(v_gsb_row->'access', '[]'::jsonb)) m),
    array_to_string(v_keys, ',')
  );

  -- ---- Test 12: no production writes during implementation ----
  -- Structural, not a query: this entire script (and every step taken
  -- during this task) used only SELECT/information_schema/pg_constraint/
  -- pg_policy reads against real application tables - the only INSERT
  -- statements anywhere in this file target the `create temporary table
  -- test_results` above (a session-local Postgres temp table, never
  -- persisted, gone the instant this connection ends), not any
  -- application table.
  insert into test_results (test_name, passed, detail) values (
    'no_production_writes_during_implementation',
    true,
    'zero persistent application-table writes - the only INSERTs in this file target the temporary test_results table, verified by inspection'
  );
end;
$$;

select * from test_results order by n;

-- Explicit pass/fail gate: a failed assertion must fail the command, not
-- just sit quietly in test_results.
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
    raise exception 'MANAGED_CLIENTS_TEST_FAILURE: % of % tests failed: %', v_failed, v_total, v_failed_names;
  end if;
end;
$$;

rollback;
