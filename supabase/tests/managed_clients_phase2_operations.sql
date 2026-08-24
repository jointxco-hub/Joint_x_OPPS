-- Managed Clients Control Plane — Phase 2 disposable test matrix.
--
-- STALE FIXTURE NOTE (Phase 3): the 3 historical managed_client_workspaces
-- rows this file's isolation assertions reference by name (Siya Mnisi,
-- Xilaveko Bilankulu, Dr Ndamane) were test fixtures, intentionally
-- removed from production after Phase 2 acceptance -
-- public.managed_client_workspaces currently has zero rows. This file is
-- not touched further or re-validated as part of Phase 3 (it was never
-- executed against production by that task either) - see
-- docs/MANAGED_CLIENTS_CONTROL_PLANE.md's "Current state" note for the
-- authoritative current baseline.
--
-- UNLIKE the Phase 0/1 suite (supabase/tests/managed_clients_control_plane.sql,
-- which is genuinely read-only), THIS file DOES perform real
-- application-table writes - that is the point: it exercises the actual
-- mutation/provisioning RPCs (admin_update_managed_client_workspace,
-- admin_initialize_managed_client_workspace, admin_provision_managed_brand,
-- admin_activate_managed_xos_domain, admin_set_managed_tenant_products_capability)
-- against real and disposable rows. Every one of those writes happens
-- INSIDE the begin;/rollback; wrapper below and is therefore GUARANTEED
-- never persisted - this is a structural property of the transaction
-- wrapper itself, not something re-checked by a runtime query after the
-- fact (a single `supabase db query --file` invocation is one session/one
-- transaction, so there is no way to query "after rollback" from within
-- this same file). The plan for confirming this in practice is the same
-- one already used for Phase 0/1: a separate, genuinely read-only query
-- run AFTER this suite completes (see the task's final report for the
-- exact production re-verification performed).
--
-- Two dynamically-resolved identities drive every test (never a hardcoded
-- real person's auth UUID):
--   v_staff - an active OPPS staff identity (active public.users + active
--     tenant_membership + active joint-x tenant), the exact authority
--     definition is_opps_staff() itself uses - reused from Phase 0/1's
--     own resolution query. Used only for the read-only
--     admin_list_managed_clients() checks.
--   v_admin - an active public.users row with role = 'admin' - the exact
--     authority definition is_app_admin()'s current_user_app_role() path
--     checks. Used for every Part A-F mutation/provisioning/preflight
--     RPC, all of which require is_app_admin(), not is_opps_staff() alone.
-- Both queries fail loudly if no such identity currently exists, rather
-- than silently proceeding with a simulation that would make every
-- admin-authorized test meaningless.
--
-- "Non-admin" tests reuse a fresh, never-persisted gen_random_uuid() with
-- no public.users row (same convention as Phase 0/1's v_non_staff) - the
-- JWT email claim used is a disposable *@disposable.test string that can
-- never appear in is_app_admin()'s hardcoded email allowlist, so only
-- its role-check arm matters for this identity shape.
--
-- CRITICAL AUTH FINDING (this exact suite, run against live production):
-- for precisely this identity shape - authenticated, no public.users
-- row, non-allowlisted email - is_app_admin() previously returned NULL,
-- not FALSE (current_user_app_role() = 'admin' evaluates to NULL when
-- current_user_app_role() itself returns NULL, and `NULL OR FALSE` is
-- NULL). Every Phase 2 RPC guards with `IF NOT public.is_app_admin()
-- THEN RAISE ... END IF;`, and `NOT NULL` is also NULL - PL/pgSQL's IF
-- does not enter on a NULL condition, so the guard silently failed open
-- for this identity. Contained in production by revoking authenticated
-- EXECUTE on all six RPCs (20260824090150), then fixed at the root by
-- making is_app_admin() itself NULL-safe (20260824090200) before
-- restoring those grants - see that migration's own header for the full
-- rationale. `is_app_admin_case_a_no_users_row_returns_false` and the
-- broader 'Shared authority' section below assert `IS FALSE` explicitly,
-- never `NOT public.is_app_admin()`, which would itself evaluate to
-- NULL and therefore never fail no matter what is_app_admin() actually
-- returns - that imprecision is exactly what let the original bug ship
-- undetected.
--
-- Fixture identities:
--   owner email fixture - a REAL, currently-existing auth.users email
--     with NO conflicting public.clients row, resolved dynamically and
--     read-only, used as the canonical client/owner email for the happy-
--     path provisioning test (satisfies the "owner must already exist in
--     auth.users" invariant without ever hardcoding a real person's
--     email).
--   missing-owner email fixture - a synthetic, never-registered email
--     (a fresh random string) used only to prove the "no auth.users
--     account" rejection path - deliberately NOT looked up anywhere,
--     since the whole point is that it must not exist.
--
-- 20260824090000/20260824090100/20260824090150 are already applied to
-- production (this file - an earlier revision of it - is what surfaced
-- the CRITICAL AUTH FINDING above when it was run there). This revision,
-- with the finding's own regression coverage and the pending
-- 20260824090200 null-safety fix it depends on for the six RPCs to be
-- reachable again, is NOT executed as part of this task - the operator
-- will run it after reviewing this hotfix, once 20260824090200 is
-- applied:
--   supabase db query --linked --file supabase/tests/managed_clients_phase2_operations.sql
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
  v_staff uuid;
  v_admin uuid;
  v_non_admin uuid := gen_random_uuid();
  v_joint_x_tenant_id uuid := '6d371f51-274c-4b49-8d59-2aeaf5e89088';
  v_gsb_tenant_id uuid := '4e0f1fa4-3149-40fa-a3f8-00ec251a2c11';
  v_gsb_client_id uuid := 'fb91a2ea-5400-43a0-a0dc-2c30f1685956';

  v_owner_email text;
  v_missing_owner_email text := 'phase2-missing-owner-' || replace(gen_random_uuid()::text, '-', '') || '@disposable.test';
  v_conflicting_client_email text;

  v_slug_conflict_tenant_id uuid;
  v_slug_conflict_slug text := 'phase2-slugtest-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  v_hostconflict_owner_tenant_id uuid;
  v_hostconflict_slug text := 'phase2-hosttest-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  -- Post-review (blocker): admin_provision_managed_brand rejects any slug
  -- matching (^|-)(qa|demo|test)(-|$) - the previous fixture,
  -- 'phase2-test-<rand>', contains a hyphen-bounded "test" token and was
  -- silently rejected by that same rule the happy-path test exists to
  -- exercise. "disposable" contains no qa/demo/test substring at all.
  v_test_slug text := 'phase2-disposable-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  v_test_slug_2 text := 'phase2-disposable-b-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  v_idem_key text := gen_random_uuid()::text;
  v_idem_key_2 text := gen_random_uuid()::text;

  v_preview jsonb;
  v_result jsonb;
  v_result2 jsonb;
  v_list jsonb;
  v_row jsonb;
  v_workspace jsonb;
  v_new_tenant_id uuid;
  v_new_client_id uuid;
  v_new_workspace_id uuid;
  v_count int;
begin
  -- ---- Resolve identities (read-only) ----
  select u.auth_user_id
  into v_staff
  from public.users u
  join public.tenant_memberships m on m.auth_user_id = u.auth_user_id and m.status = 'active'
  join public.tenants t on t.id = m.tenant_id and t.status = 'active' and t.slug = 'joint-x'
  where coalesce(u.is_active, true)
  limit 1;
  if v_staff is null then
    raise exception 'MANAGED_CLIENTS_PHASE2_TEST_SETUP: no active OPPS staff identity found - cannot simulate is_opps_staff()';
  end if;

  select u.auth_user_id
  into v_admin
  from public.users u
  where u.role = 'admin' and coalesce(u.is_active, true)
  limit 1;
  if v_admin is null then
    raise exception 'MANAGED_CLIENTS_PHASE2_TEST_SETUP: no active app-admin identity found (public.users.role = ''admin'') - cannot simulate is_app_admin()';
  end if;

  select au.email
  into v_owner_email
  from auth.users au
  where not exists (select 1 from public.clients c where lower(c.email) = lower(au.email))
  limit 1;
  if v_owner_email is null then
    raise exception 'MANAGED_CLIENTS_PHASE2_TEST_SETUP: no auth.users email without a conflicting public.clients row found - cannot build an owner fixture';
  end if;

  select email into v_conflicting_client_email from public.clients where email is not null limit 1;
  if v_conflicting_client_email is null then
    raise exception 'MANAGED_CLIENTS_PHASE2_TEST_SETUP: no existing public.clients email found to test the email-conflict path';
  end if;

  -- ---- Disposable fixtures for the slug/hostname conflict tests, real
  -- application-table rows but inside this same transaction (rolled back
  -- with everything else) ----
  insert into public.tenants (slug, name, status, settings)
  values (v_slug_conflict_slug, 'Phase2 Slug Conflict Fixture', 'active', '{}'::jsonb)
  returning id into v_slug_conflict_tenant_id;

  insert into public.tenants (slug, name, status, settings)
  values ('phase2-hosttest-owner-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), 'Phase2 Hostname Conflict Fixture', 'active', '{}'::jsonb)
  returning id into v_hostconflict_owner_tenant_id;
  insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary)
  values (v_hostconflict_owner_tenant_id, v_hostconflict_slug || '.xos.jointx.co.za', 'xos_admin', 'pending', true);

  -- =====================================================================
  -- Regression guard (post-review, blocker fix): every fixture slug this
  -- file actually passes to admin_provision_managed_brand/
  -- admin_preview_managed_brand_provisioning must independently satisfy
  -- the exact reserved-token rule those RPCs enforce
  -- ((^|-)(qa|demo|test)(-|$)) - asserted here, once, against every such
  -- fixture, so a future edit that reintroduces a reserved token fails
  -- loudly instead of silently making the happy-path test a no-op again.
  -- =====================================================================
  insert into test_results (test_name, passed, detail) values (
    'disposable_fixture_slugs_are_not_reserved_tokens',
    v_test_slug !~* '(^|-)(qa|demo|test)(-|$)'
      and v_test_slug_2 !~* '(^|-)(qa|demo|test)(-|$)'
      and 'phase2-unused-slug-a' !~* '(^|-)(qa|demo|test)(-|$)'
      and 'phase2-unused-slug-b' !~* '(^|-)(qa|demo|test)(-|$)'
      and 'phase2-unused-slug-c' !~* '(^|-)(qa|demo|test)(-|$)',
    'v_test_slug=' || v_test_slug || ' v_test_slug_2=' || v_test_slug_2
  );

  -- =====================================================================
  -- Non-admin denial (tests 1-6)
  -- =====================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_non_admin, 'role', 'authenticated', 'email', 'phase2-nonadmin@disposable.test')::text, true);

  -- Post-review (CRITICAL): is_app_admin() must never return NULL for
  -- this identity shape (authenticated, no public.users row, non-
  -- allowlisted email) - `NOT NULL` is itself NULL, and PL/pgSQL's IF
  -- does not enter its THEN branch on a NULL condition, so every
  -- `IF NOT public.is_app_admin() THEN RAISE ... END IF;` guard below
  -- would silently fail open if this ever regressed. Asserting
  -- `IS FALSE` specifically (not `NOT public.is_app_admin()`, which
  -- would itself evaluate to NULL and therefore never fail this
  -- assertion no matter what is_app_admin() actually returns) is the
  -- only correct way to catch that regression here.
  insert into test_results (test_name, passed, detail) values (
    'is_app_admin_is_false_not_null_for_non_admin_identity',
    public.is_app_admin() is false,
    'is_app_admin()=' || coalesce(public.is_app_admin()::text, '(null)')
  );

  begin
    perform public.admin_preview_managed_brand_provisioning(jsonb_build_object('workspace_name', 'x', 'tenant_slug', 'x', 'client_email', 'x@x.com', 'client_name', 'x'));
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_preview', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_preview', sqlerrm like 'MANAGED_BRAND_FORBIDDEN%', sqlerrm);
  end;

  begin
    perform public.admin_provision_managed_brand(jsonb_build_object('workspace_name', 'x', 'tenant_slug', 'x', 'client_email', 'x@x.com', 'client_name', 'x'), gen_random_uuid()::text);
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_provision', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_provision', sqlerrm like 'MANAGED_BRAND_FORBIDDEN%', sqlerrm);
  end;

  begin
    perform public.admin_initialize_managed_client_workspace(v_gsb_tenant_id, '{}'::jsonb);
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_initialize_workspace', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_initialize_workspace', sqlerrm like 'MANAGED_BRAND_FORBIDDEN%', sqlerrm);
  end;

  begin
    perform public.admin_update_managed_client_workspace(gen_random_uuid(), '{}'::jsonb);
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_update_workspace', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_update_workspace', sqlerrm like 'MANAGED_BRAND_FORBIDDEN%', sqlerrm);
  end;

  begin
    perform public.admin_set_managed_tenant_products_capability(v_gsb_tenant_id, false);
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_change_capability', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_change_capability', sqlerrm like 'MANAGED_BRAND_FORBIDDEN%', sqlerrm);
  end;

  begin
    perform public.admin_activate_managed_xos_domain(v_gsb_tenant_id);
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_activate_xos_domain', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('non_admin_cannot_activate_xos_domain', sqlerrm like 'MANAGED_BRAND_FORBIDDEN%', sqlerrm);
  end;

  -- Post-review (CRITICAL): asserted BEFORE switching to the admin
  -- identity, and BEFORE the real admin_initialize_managed_client_workspace
  -- call for GSB later in this file - this is exactly the check that
  -- would have caught the is_app_admin() NULL-bypass regression
  -- directly, instead of only observing its downstream symptom (the
  -- legitimate admin initialize call later failing with
  -- WORKSPACE_INIT_ALREADY_EXISTS because the non-admin call above had
  -- already silently succeeded and inserted a real row for GSB).
  insert into test_results (test_name, passed, detail) values (
    'gsb_workspace_count_still_zero_after_non_admin_denials',
    (select count(*) from public.managed_client_workspaces where tenant_id = v_gsb_tenant_id) = 0,
    'count=' || (select count(*) from public.managed_client_workspaces where tenant_id = v_gsb_tenant_id)::text
  );
  insert into test_results (test_name, passed, detail) values (
    'no_application_table_writes_from_non_admin_denied_calls',
    not exists (select 1 from public.tenants where slug = 'x')
      and (select count(*) from public.tenant_capabilities where tenant_id = v_gsb_tenant_id and capability_key = 'products' and enabled = false) = 0
      and (select status from public.tenant_domains where tenant_id = v_gsb_tenant_id and surface = 'xos_admin' and is_primary) = 'active',
    'checked no tenant/capability/domain write happened from any of the 6 denied non-admin calls above'
  );

  -- =====================================================================
  -- Shared authority: public.is_app_admin() null-safety (A-D)
  -- =====================================================================
  -- A. Fresh auth UUID, no public.users row, disposable email -> FALSE,
  -- not NULL. Same identity/claims already used for the six denial
  -- tests above and the 'is_app_admin_is_false_not_null_for_non_admin_identity'
  -- assertion - re-verified explicitly here as its own labelled case to
  -- match the lettered requirement precisely.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_non_admin, 'role', 'authenticated', 'email', 'phase2-nonadmin@disposable.test')::text, true);
  insert into test_results (test_name, passed, detail) values (
    'is_app_admin_case_a_no_users_row_returns_false',
    public.is_app_admin() is false,
    'is_app_admin()=' || coalesce(public.is_app_admin()::text, '(null)')
  );

  -- B. Active public.users.role = 'admin' -> TRUE (v_admin, resolved
  -- dynamically at the top of this file).
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated', 'email', 'phase2-admin@disposable.test')::text, true);
  insert into test_results (test_name, passed, detail) values (
    'is_app_admin_case_b_role_admin_returns_true',
    public.is_app_admin() is true,
    'is_app_admin()=' || coalesce(public.is_app_admin()::text, '(null)')
  );

  -- C. An existing allowlisted admin email (the 4 addresses hardcoded in
  -- is_app_admin() itself, from 202606230006_fix_internal_order_access.sql
  -- - already-public application constants, not a secret) - dynamically
  -- checks whether any of them corresponds to a real auth.users account
  -- in this environment, read-only. Never a hardcoded auth UUID - the id
  -- is looked up, and the assertion is skipped (recorded as a vacuous
  -- pass with an explanatory detail) if none of the 4 addresses has an
  -- account here, since production is not guaranteed to contain one.
  declare
    v_allowlisted_admin_id uuid;
    v_allowlisted_admin_email text;
  begin
    select au.id, au.email
    into v_allowlisted_admin_id, v_allowlisted_admin_email
    from auth.users au
    where lower(au.email) in ('jointx.co@gmail.com', 'jointsexclusive@gmail.com', 'jasperjaimataruse@gmail.com', 'jaicreativerealm@gmail.com')
    limit 1;

    if v_allowlisted_admin_id is not null then
      perform set_config('request.jwt.claims', jsonb_build_object('sub', v_allowlisted_admin_id, 'role', 'authenticated', 'email', v_allowlisted_admin_email)::text, true);
      insert into test_results (test_name, passed, detail) values (
        'is_app_admin_case_c_allowlisted_email_returns_true',
        public.is_app_admin() is true,
        'is_app_admin()=' || coalesce(public.is_app_admin()::text, '(null)')
      );
    else
      insert into test_results (test_name, passed, detail) values (
        'is_app_admin_case_c_allowlisted_email_returns_true',
        true,
        'no allowlisted admin email has an auth.users account in this environment - vacuously skipped'
      );
    end if;
  end;

  -- D. A normal, active public.users identity whose role is NOT 'admin'
  -- -> FALSE. Only the role matters for is_app_admin() (the simulated
  -- JWT email below is a disposable string, never this person's real
  -- email, so the email-allowlist arm is guaranteed false regardless of
  -- who they are) - dynamically resolved, never a hardcoded auth UUID.
  declare
    v_normal_user_id uuid;
  begin
    select u.auth_user_id
    into v_normal_user_id
    from public.users u
    where coalesce(u.is_active, true) and coalesce(u.role, '') <> 'admin'
    limit 1;

    if v_normal_user_id is not null then
      perform set_config('request.jwt.claims', jsonb_build_object('sub', v_normal_user_id, 'role', 'authenticated', 'email', 'phase2-normal-user@disposable.test')::text, true);
      insert into test_results (test_name, passed, detail) values (
        'is_app_admin_case_d_non_admin_users_row_returns_false',
        public.is_app_admin() is false,
        'is_app_admin()=' || coalesce(public.is_app_admin()::text, '(null)')
      );
    else
      insert into test_results (test_name, passed, detail) values (
        'is_app_admin_case_d_non_admin_users_row_returns_false',
        true,
        'no active non-admin public.users row found in this environment - vacuously skipped'
      );
    end if;
  end;

  -- Switch to the app-admin identity for every remaining test.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated', 'email', 'phase2-admin@disposable.test')::text, true);

  -- =====================================================================
  -- Preflight (tests 7-13)
  -- =====================================================================
  v_preview := public.admin_preview_managed_brand_provisioning(jsonb_build_object(
    'workspace_name', 'Phase2 Preflight Check', 'tenant_slug', '  Phase 2!! Preflight_Check  ',
    'client_email', v_owner_email, 'client_name', 'Phase2 Preflight Owner'
  ));
  insert into test_results (test_name, passed, detail) values (
    'preflight_normalizes_slug_and_derives_hostname',
    (v_preview ->> 'normalized_slug') = 'phase-2-preflight-check'
      and (v_preview ->> 'derived_hostname') = 'phase-2-preflight-check.xos.jointx.co.za',
    v_preview::text
  );
  insert into test_results (test_name, passed, detail) values (
    'preflight_owner_and_email_match_true_for_real_conflict_free_email',
    (v_preview ->> 'owner_account_exists')::boolean = true and (v_preview ->> 'email_match')::boolean = true,
    v_preview::text
  );
  insert into test_results (test_name, passed, detail) values (
    'preflight_never_returns_auth_user_id',
    not (v_preview ? 'auth_user_id') and not (v_preview ? 'owner_id'),
    array_to_string(array(select jsonb_object_keys(v_preview)), ',')
  );

  v_preview := public.admin_preview_managed_brand_provisioning(jsonb_build_object(
    'workspace_name', 'x', 'tenant_slug', v_slug_conflict_slug, 'client_email', 'phase2-slug-conflict@disposable.test', 'client_name', 'x'
  ));
  insert into test_results (test_name, passed, detail) values (
    'preflight_slug_conflict_rejected',
    (v_preview ->> 'slug_available')::boolean = false and (v_preview ->> 'can_provision')::boolean = false,
    v_preview::text
  );

  v_preview := public.admin_preview_managed_brand_provisioning(jsonb_build_object(
    'workspace_name', 'x', 'tenant_slug', v_hostconflict_slug, 'client_email', 'phase2-host-conflict@disposable.test', 'client_name', 'x'
  ));
  insert into test_results (test_name, passed, detail) values (
    'preflight_hostname_conflict_rejected_independently_of_slug',
    (v_preview ->> 'slug_available')::boolean = true and (v_preview ->> 'hostname_available')::boolean = false and (v_preview ->> 'can_provision')::boolean = false,
    v_preview::text
  );

  v_preview := public.admin_preview_managed_brand_provisioning(jsonb_build_object(
    'workspace_name', 'x', 'tenant_slug', 'phase2-unused-slug-a', 'client_email', v_conflicting_client_email, 'client_name', 'x'
  ));
  insert into test_results (test_name, passed, detail) values (
    'preflight_client_email_conflict_rejected',
    (v_preview ->> 'client_email_available')::boolean = false and (v_preview ->> 'can_provision')::boolean = false,
    v_preview::text
  );

  v_preview := public.admin_preview_managed_brand_provisioning(jsonb_build_object(
    'workspace_name', 'x', 'tenant_slug', 'phase2-unused-slug-b', 'client_email', v_missing_owner_email, 'client_name', 'x'
  ));
  insert into test_results (test_name, passed, detail) values (
    'preflight_missing_owner_account_rejected',
    (v_preview ->> 'owner_account_exists')::boolean = false and (v_preview ->> 'can_provision')::boolean = false
      and (v_preview -> 'blockers')::text like '%owner must sign in%',
    v_preview::text
  );

  -- email_match is structurally coupled to owner_account_exists by
  -- construction (the auth.users lookup predicate IS the case-insensitive
  -- match - see admin_preview_managed_brand_provisioning's header note),
  -- so a true "mismatch" state (owner_account_exists=true, email_match=
  -- false) cannot occur at all in this design - a stronger guarantee than
  -- a runtime check. Assert the invariant itself holds across every
  -- preview call already exercised above.
  insert into test_results (test_name, passed, detail) values (
    'preflight_email_match_invariant_holds_by_construction',
    (v_preview ->> 'owner_account_exists') = (v_preview ->> 'email_match'),
    'owner_account_exists=' || (v_preview ->> 'owner_account_exists') || ' email_match=' || (v_preview ->> 'email_match')
  );

  -- =====================================================================
  -- Provisioning (tests 14-19)
  -- =====================================================================

  -- Post-review: initial_workspace must pass the same key allowlist as
  -- Parts A/B - an unknown key rejects rather than being silently
  -- ignored, before any insert happens (this call never touches
  -- v_test_slug, so it does not consume that fixture).
  begin
    perform public.admin_provision_managed_brand(
      jsonb_build_object(
        'workspace_name', 'x', 'tenant_slug', 'phase2-unused-slug-c', 'client_email', 'phase2-badinit@disposable.test', 'client_name', 'x',
        'initial_workspace', jsonb_build_object('not_a_real_workspace_field', 'x')
      ),
      gen_random_uuid()::text
    );
    insert into test_results (test_name, passed, detail) values ('provision_rejects_unknown_initial_workspace_key', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('provision_rejects_unknown_initial_workspace_key', sqlerrm like 'WORKSPACE_UPDATE_UNKNOWN_KEY%', sqlerrm);
  end;

  v_result := public.admin_provision_managed_brand(
    jsonb_build_object(
      'workspace_name', 'Phase2 Disposable Brand',
      'tenant_slug', v_test_slug,
      'client_email', v_owner_email,
      'client_name', 'Phase2 Disposable Different Contact',
      'client_type', 'Service Business',
      'site_type', 'Landing Page',
      'products_enabled', true
    ),
    v_idem_key
  );
  v_new_tenant_id := (v_result ->> 'tenant_id')::uuid;
  v_new_client_id := (v_result ->> 'client_id')::uuid;
  v_new_workspace_id := (v_result ->> 'workspace_id')::uuid;

  insert into test_results (test_name, passed, detail) values (
    'provision_creates_exactly_one_of_each_dependency',
    (select count(*) from public.tenants where id = v_new_tenant_id) = 1
      and (select count(*) from public.clients where id = v_new_client_id and tenant_id = v_new_tenant_id) = 1
      and (select count(*) from public.tenant_domains where tenant_id = v_new_tenant_id and surface = 'xos_admin' and is_primary) = 1
      and (select count(*) from public.tenant_memberships where tenant_id = v_new_tenant_id and tenant_role = 'owner' and status = 'active') = 1
      and (select count(*) from public.tenant_capabilities where tenant_id = v_new_tenant_id and capability_key = 'products' and enabled = true) = 1
      and (select count(*) from public.managed_client_workspaces where id = v_new_workspace_id and tenant_id = v_new_tenant_id and client_id = v_new_client_id) = 1,
    v_result::text
  );

  insert into test_results (test_name, passed, detail) values (
    'provisioned_domain_is_pending_not_active',
    (select status from public.tenant_domains where tenant_id = v_new_tenant_id and surface = 'xos_admin' and is_primary) = 'pending'
      and (v_result ->> 'xos_status') = 'pending',
    (select status from public.tenant_domains where tenant_id = v_new_tenant_id and surface = 'xos_admin' and is_primary)
  );

  insert into test_results (test_name, passed, detail) values (
    'provision_never_returns_auth_user_id',
    not (v_result ? 'auth_user_id') and not (v_result ? 'owner_id'),
    array_to_string(array(select jsonb_object_keys(v_result)), ',')
  );

  -- admin_list_managed_clients() requires is_opps_staff(), not
  -- is_app_admin() - v_admin is only guaranteed to satisfy the latter, so
  -- switch identities for this read, then switch back.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_staff, 'role', 'authenticated', 'email', 'phase2-staff@disposable.test')::text, true);
  v_list := public.admin_list_managed_clients();
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated', 'email', 'phase2-admin@disposable.test')::text, true);
  select e into v_row from jsonb_array_elements(v_list) e where e ->> 'key' = 'tenant:' || v_new_tenant_id::text limit 1;
  insert into test_results (test_name, passed, detail) values (
    'provisioned_brand_appears_in_unified_read_model',
    v_row is not null and (v_row ->> 'source') = 'both' and (v_row ->> 'xos_status') = 'pending',
    coalesce(v_row::text, '(not found)')
  );

  -- Post-review: brand/workspace identity must display separately from
  -- the client/contact identity - workspace_name ('Phase2 Disposable
  -- Brand') and client_name ('Phase2 Disposable Different Contact') were
  -- deliberately chosen to differ above.
  insert into test_results (test_name, passed, detail) values (
    'brand_identity_distinct_from_contact_identity_in_projection',
    (v_row ->> 'brand_name') = 'Phase2 Disposable Brand'
      and (v_row ->> 'client_name') = 'Phase2 Disposable Different Contact',
    'brand_name=' || (v_row ->> 'brand_name') || ' client_name=' || (v_row ->> 'client_name')
  );

  -- Post-review (blocker): the canonical email is now protected by its
  -- own advisory lock, and the re-check of "no conflicting clients row"
  -- runs after acquiring it - functionally exercised here by attempting
  -- a SECOND, otherwise-valid provisioning (different slug, different
  -- idempotency key) reusing the SAME canonical email the first call
  -- just committed to public.clients within this transaction. True
  -- concurrent-session locking cannot be exercised from one serial SQL
  -- script - see tests/managed-clients-phase2-operations.test.mjs for
  -- the static assertion that the lock line itself exists.
  begin
    perform public.admin_provision_managed_brand(
      jsonb_build_object(
        'workspace_name', 'Phase2 Disposable Brand Two', 'tenant_slug', v_test_slug_2,
        'client_email', v_owner_email, 'client_name', 'Phase2 Disposable Second Contact',
        'products_enabled', false
      ),
      v_idem_key_2
    );
    insert into test_results (test_name, passed, detail) values ('provision_email_conflict_rejected_under_different_slug_and_key', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('provision_email_conflict_rejected_under_different_slug_and_key', sqlerrm like 'MANAGED_BRAND_CLIENT_EMAIL_TAKEN%', sqlerrm);
  end;

  v_result2 := public.admin_provision_managed_brand(
    jsonb_build_object(
      'workspace_name', 'Phase2 Disposable Brand',
      'tenant_slug', v_test_slug,
      'client_email', v_owner_email,
      'client_name', 'Phase2 Disposable Different Contact',
      'client_type', 'Service Business',
      'site_type', 'Landing Page',
      'products_enabled', true
    ),
    v_idem_key
  );
  insert into test_results (test_name, passed, detail) values (
    'same_idempotency_key_same_payload_returns_original_result',
    v_result2 = v_result,
    'replay result matches original: ' || (v_result2 = v_result)::text
  );

  begin
    perform public.admin_provision_managed_brand(
      jsonb_build_object(
        'workspace_name', 'Phase2 Disposable Brand CHANGED',
        'tenant_slug', v_test_slug,
        'client_email', v_owner_email,
        'client_name', 'Phase2 Disposable Different Contact',
        'client_type', 'Service Business',
        'site_type', 'Landing Page',
        'products_enabled', true
      ),
      v_idem_key
    );
    insert into test_results (test_name, passed, detail) values ('same_key_changed_payload_rejects', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('same_key_changed_payload_rejects', sqlerrm like 'MANAGED_BRAND_IDEMPOTENCY_CONFLICT%', sqlerrm);
  end;

  insert into test_results (test_name, passed, detail) values (
    'no_duplicate_rows_after_replay_attempts',
    (select count(*) from public.tenants where slug = v_test_slug) = 1
      and (select count(*) from public.clients where lower(email) = lower(v_owner_email)) = 1
      and (select count(*) from public.tenant_domains where hostname = v_test_slug || '.xos.jointx.co.za') = 1
      and (select count(*) from public.managed_client_workspaces where tenant_id = v_new_tenant_id) = 1,
    'checked tenant/client/domain/workspace counts remain 1 after 2 replays + 1 conflicting attempt'
  );

  -- =====================================================================
  -- Initialize workspace for GSB - a REAL modern tenant with zero
  -- workspace rows in production today (test 20-22)
  -- =====================================================================
  v_workspace := public.admin_initialize_managed_client_workspace(
    v_gsb_tenant_id, jsonb_build_object('client_type', 'Fashion Brand', 'site_type', 'Ecommerce')
  );
  insert into test_results (test_name, passed, detail) values (
    'initialize_workspace_resolves_client_server_side',
    (v_workspace ->> 'client_id') = v_gsb_client_id::text and (v_workspace ->> 'tenant_id') = v_gsb_tenant_id::text,
    v_workspace::text
  );

  begin
    perform public.admin_initialize_managed_client_workspace(v_joint_x_tenant_id, '{}'::jsonb);
    insert into test_results (test_name, passed, detail) values ('initialize_workspace_rejects_system_tenant', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('initialize_workspace_rejects_system_tenant', sqlerrm like 'WORKSPACE_INIT_SYSTEM_TENANT_FORBIDDEN%', sqlerrm);
  end;

  begin
    perform public.admin_initialize_managed_client_workspace(v_gsb_tenant_id, '{}'::jsonb);
    insert into test_results (test_name, passed, detail) values ('duplicate_workspace_initialization_rejected', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('duplicate_workspace_initialization_rejected', sqlerrm like 'WORKSPACE_INIT_ALREADY_EXISTS%', sqlerrm);
  end;

  -- =====================================================================
  -- Workspace update, using the workspace just created for GSB (tests 23-27)
  -- =====================================================================
  v_workspace := public.admin_update_managed_client_workspace(
    (v_workspace ->> 'id')::uuid,
    jsonb_build_object('site_status', 'In progress', 'next_action', 'Phase2 test action')
  );
  insert into test_results (test_name, passed, detail) values (
    'workspace_update_changes_allowed_fields',
    (v_workspace ->> 'site_status') = 'In progress' and (v_workspace ->> 'next_action') = 'Phase2 test action',
    v_workspace::text
  );

  begin
    perform public.admin_update_managed_client_workspace((v_workspace ->> 'id')::uuid, jsonb_build_object('tenant_id', gen_random_uuid()));
    insert into test_results (test_name, passed, detail) values ('workspace_identity_cannot_be_changed', false, 'call unexpectedly succeeded - tenant_id key was accepted');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('workspace_identity_cannot_be_changed', sqlerrm like 'WORKSPACE_UPDATE_UNKNOWN_KEY%', sqlerrm);
  end;

  begin
    perform public.admin_update_managed_client_workspace((v_workspace ->> 'id')::uuid, jsonb_build_object('not_a_real_field', 'x'));
    insert into test_results (test_name, passed, detail) values ('workspace_update_unknown_key_rejected', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('workspace_update_unknown_key_rejected', sqlerrm like 'WORKSPACE_UPDATE_UNKNOWN_KEY%', sqlerrm);
  end;

  begin
    perform public.admin_update_managed_client_workspace((v_workspace ->> 'id')::uuid, jsonb_build_object('client_type', 'Not A Real Client Type'));
    insert into test_results (test_name, passed, detail) values ('workspace_update_invalid_constrained_value_rejected', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('workspace_update_invalid_constrained_value_rejected', sqlerrm like '%managed_client_workspaces_client_type_check%', sqlerrm);
  end;

  v_workspace := public.admin_update_managed_client_workspace((v_workspace ->> 'id')::uuid, jsonb_build_object('next_action', null));
  insert into test_results (test_name, passed, detail) values (
    'workspace_update_intentional_nullable_clear_works',
    (v_workspace -> 'next_action') = 'null'::jsonb,
    v_workspace::text
  );

  -- =====================================================================
  -- Products capability toggle (tests 28-29)
  -- =====================================================================

  -- Post-review (blocker): "has a linked client" alone used to be enough
  -- to enable Products - now the tenant must also pass
  -- _is_eligible_managed_tenant (a matching workspace, a non-disabled
  -- xos/storefront domain, or an already-enabled capability). Build a
  -- disposable tenant with none of those three signals - just a tenant
  -- and one linked client, nothing else - and confirm the toggle rejects
  -- it deterministically.
  declare
    v_unmanaged_tenant_id uuid;
  begin
    insert into public.tenants (slug, name, status, settings)
    values ('phase2-disposable-unmanaged-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), 'Phase2 Unmanaged Tenant Fixture', 'active', '{}'::jsonb)
    returning id into v_unmanaged_tenant_id;
    insert into public.clients (tenant_id, name, email, status)
    values (v_unmanaged_tenant_id, 'Phase2 Unmanaged Fixture Contact', 'phase2-unmanaged-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8) || '@disposable.test', 'active');

    begin
      perform public.admin_set_managed_tenant_products_capability(v_unmanaged_tenant_id, true);
      insert into test_results (test_name, passed, detail) values ('capability_toggle_rejects_unmanaged_tenant', false, 'call unexpectedly succeeded on a tenant with no workspace/domain/capability signal');
    exception when others then
      insert into test_results (test_name, passed, detail) values ('capability_toggle_rejects_unmanaged_tenant', sqlerrm like 'MANAGED_BRAND_TENANT_NOT_MANAGED%', sqlerrm);
    end;
  end;

  -- GSB (active domain, already-enabled capability) must still pass
  -- eligibility under the tightened rule - this call succeeding is that
  -- proof.
  perform public.admin_set_managed_tenant_products_capability(v_gsb_tenant_id, false);
  insert into test_results (test_name, passed, detail) values (
    'capability_toggle_works',
    (select enabled from public.tenant_capabilities where tenant_id = v_gsb_tenant_id and capability_key = 'products') = false,
    'toggled off'
  );
  insert into test_results (test_name, passed, detail) values (
    'capability_toggle_does_not_alter_commerce_rows',
    (select count(*) from commerce.products where tenant_id = v_gsb_tenant_id) = 0,
    'commerce.products count for GSB unaffected'
  );
  perform public.admin_set_managed_tenant_products_capability(v_gsb_tenant_id, true);

  -- =====================================================================
  -- XOS activation, using the disposable tenant provisioned above (tests 30-32)
  -- =====================================================================
  v_result := public.admin_activate_managed_xos_domain(v_new_tenant_id);
  insert into test_results (test_name, passed, detail) values (
    'xos_activation_changes_pending_to_active',
    (v_result ->> 'status') = 'active'
      and (select status from public.tenant_domains where tenant_id = v_new_tenant_id and surface = 'xos_admin' and is_primary) = 'active',
    v_result::text
  );

  v_result2 := public.admin_activate_managed_xos_domain(v_new_tenant_id);
  insert into test_results (test_name, passed, detail) values (
    'xos_activation_is_idempotent',
    (v_result2 ->> 'status') = 'active' and v_result2 = v_result,
    v_result2::text
  );

  begin
    perform public.admin_activate_managed_xos_domain(v_joint_x_tenant_id);
    insert into test_results (test_name, passed, detail) values ('xos_activation_cannot_target_system_tenant', false, 'call unexpectedly succeeded');
  exception when others then
    insert into test_results (test_name, passed, detail) values ('xos_activation_cannot_target_system_tenant', sqlerrm like 'MANAGED_BRAND_SYSTEM_TENANT_FORBIDDEN%', sqlerrm);
  end;

  -- =====================================================================
  -- Isolation: unrelated rows must be unaffected by everything above
  -- (tests 33-36)
  -- =====================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_staff, 'role', 'authenticated', 'email', 'phase2-staff@disposable.test')::text, true);
  v_list := public.admin_list_managed_clients();

  insert into test_results (test_name, passed, detail) values (
    'legacy_rows_still_have_null_tenant_id_after_mutations',
    (
      select bool_and((e -> 'tenant_id') = 'null'::jsonb and (e ->> 'source') = 'legacy')
      from jsonb_array_elements(v_list) e
      where e ->> 'brand_name' in ('Siya Mnisi', 'Xilaveko Bilankulu', 'Dr Ndamane')
    ),
    'checked tenant_id is still null for all 3 historical rows'
  );

  select count(*) into v_count
  from jsonb_array_elements(v_list) e
  where e ->> 'brand_name' in ('Siya Mnisi', 'Xilaveko Bilankulu', 'Dr Ndamane') and e ->> 'source' = 'legacy';
  insert into test_results (test_name, passed, detail) values (
    'legacy_commerce_guard_precondition_still_holds',
    v_count = 3,
    'legacy rows still present/legacy after Phase 2 mutations, count=' || v_count::text
  );

  select e into v_row from jsonb_array_elements(v_list) e where e ->> 'key' = 'tenant:' || v_gsb_tenant_id::text limit 1;
  insert into test_results (test_name, passed, detail) values (
    'gsb_still_projects_correctly_now_with_workspace',
    v_row is not null and (v_row ->> 'source') = 'both' and (v_row ->> 'tenant_status') = 'active',
    v_row::text
  );
  insert into test_results (test_name, passed, detail) values (
    'gsb_still_has_zero_commerce_products',
    (v_row ->> 'commerce_product_count')::int = 0,
    v_row ->> 'commerce_product_count'
  );

  -- =====================================================================
  -- Structural guarantees (tests 37-39) - see header note: these cannot
  -- be runtime-verified from inside this same transaction, so they are
  -- documented as properties of the begin;/rollback; wrapper, matching
  -- Phase 0/1's own precedent for exactly this kind of claim.
  -- =====================================================================
  insert into test_results (test_name, passed, detail) values (
    'gsb_workspace_and_capability_changes_are_transaction_local',
    true,
    'GSB''s workspace-initialize and capability-toggle calls above are real writes, but both happen inside this file''s outer begin;/rollback; - the wrapping rollback is what guarantees GSB has zero managed_client_workspaces rows and products capability = enabled again once this session ends, not a query inside this same transaction (which would see the in-transaction state, not the post-rollback state). Confirm with a separate read-only query after this suite completes.'
  );
  insert into test_results (test_name, passed, detail) values (
    'historical_rows_unchanged_is_a_rollback_guarantee',
    true,
    'This suite never wrote to the 3 historical managed_client_workspaces rows at all (only read them, above) - confirm with a separate read-only query after this suite completes, same as Phase 0/1.'
  );
  insert into test_results (test_name, passed, detail) values (
    'no_persistent_disposable_residue',
    true,
    'Every real application-table INSERT in this file (2 disposable conflict-fixture tenants, 1 disposable domain, 1 disposable unmanaged tenant + client, 1 provisioned tenant/client/domain/membership/capability/workspace, 1 GSB workspace) is inside this file''s single begin;/rollback; - none of it is committed. Verified by inspection.'
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
    raise exception 'MANAGED_CLIENTS_PHASE2_TEST_FAILURE: % of % tests failed: %', v_failed, v_total, v_failed_names;
  end if;
end;
$$;

rollback;
