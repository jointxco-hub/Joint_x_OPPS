-- CAFE-ACCESS-01 Phase 2: tenant-capability proof for the handoff-list RPC.
--
-- Run only against an isolated database containing the combined OPPS and
-- Quick Solution effective schema after applying:
--   20260924232724_cafe_access_01_tenant_capability_operations.sql
--
-- All application fixtures are synthetic and are enclosed by BEGIN/ROLLBACK.
-- The commerce.service_orders / service_order_handoffs fixtures use only
-- columns defined by the Quick Solution migrations (qs_03, qs_04a) and leave
-- every public.orders foreign key null.

\set ON_ERROR_STOP on

begin;

-- Test-only helper. Created in pg_temp inside this transaction, so it is
-- rolled back with everything else. It proves a denial came from the expected
-- boundary: the exact SQLSTATE AND the exact message the migrated RPC raises,
-- so a table-ACL, RLS or other-function 42501 cannot satisfy a deny case.
create function pg_temp.expect_handoffs_error(
  p_slug text,
  p_case text,
  p_sqlstate text,
  p_message text
) returns void
language plpgsql
as $helper$
declare
  v_state text;
  v_message text;
begin
  begin
    perform public.admin_list_quick_solution_opps_handoffs(p_slug);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state is distinct from p_sqlstate or v_message is distinct from p_message then
      raise exception 'CAFE_ACCESS_01: % expected % "%" but got % "%"',
        p_case, p_sqlstate, p_message, v_state, v_message;
    end if;
    return;
  end;
  raise exception 'CAFE_ACCESS_01: % unexpectedly listed handoffs', p_case;
end
$helper$;

do $contracts$
declare
  v_helper regprocedure := to_regprocedure('public.has_tenant_capability(uuid,text)');
  v_rpc regprocedure := to_regprocedure('public.admin_list_quick_solution_opps_handoffs(text)');
  v_definition text;
begin
  if v_helper is null then
    raise exception 'has_tenant_capability(uuid,text) must exist';
  end if;
  if v_rpc is null then
    raise exception 'admin_list_quick_solution_opps_handoffs(text) must exist';
  end if;

  if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid=v_helper) then
    raise exception 'has_tenant_capability(uuid,text) must remain SECURITY DEFINER';
  end if;
  if (select p.provolatile from pg_catalog.pg_proc p where p.oid=v_helper) <> 's' then
    raise exception 'has_tenant_capability(uuid,text) must remain STABLE';
  end if;
  if (select pg_catalog.pg_get_function_result(v_helper)) <> 'boolean' then
    raise exception 'has_tenant_capability(uuid,text) must return boolean';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_proc p,
         lateral pg_catalog.pg_options_to_table(p.proconfig) config
    where p.oid=v_helper
      and config.option_name='search_path'
      and btrim(config.option_value, chr(34))=''
  ) then
    raise exception 'has_tenant_capability(uuid,text) must use an empty hardened search_path';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p,
         lateral pg_catalog.aclexplode(
           coalesce(p.proacl, pg_catalog.acldefault('f',p.proowner))
         ) acl
    where p.oid=v_helper
      and acl.grantee=0
      and acl.privilege_type='EXECUTE'
  ) then
    raise exception 'has_tenant_capability(uuid,text) must not grant EXECUTE to PUBLIC';
  end if;
  if has_function_privilege('anon',v_helper,'EXECUTE') then
    raise exception 'has_tenant_capability(uuid,text) must not grant EXECUTE to anon';
  end if;
  if not has_function_privilege('authenticated',v_helper,'EXECUTE') then
    raise exception 'has_tenant_capability(uuid,text) must grant EXECUTE to authenticated';
  end if;
  if has_function_privilege('service_role',v_helper,'EXECUTE') then
    raise exception 'has_tenant_capability(uuid,text) must not grant direct EXECUTE to service_role';
  end if;

  v_definition := lower(pg_catalog.pg_get_functiondef(v_helper));
  if v_definition ~ '(is_app_admin|is_opps_staff|tenant_capabilities)' then
    raise exception 'has_tenant_capability(uuid,text) must derive authority only from active tenant role membership';
  end if;

  if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid=v_rpc) then
    raise exception 'admin_list_quick_solution_opps_handoffs(text) must remain SECURITY DEFINER';
  end if;
  if (select pg_catalog.pg_get_function_result(v_rpc)) <> 'jsonb' then
    raise exception 'admin_list_quick_solution_opps_handoffs(text) must retain its jsonb return contract';
  end if;
  if (select p.pronargdefaults from pg_catalog.pg_proc p where p.oid=v_rpc) <> 1 then
    raise exception 'admin_list_quick_solution_opps_handoffs(text) must retain its default tenant-slug argument';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_proc p,
         lateral pg_catalog.pg_options_to_table(p.proconfig) config
    where p.oid=v_rpc
      and config.option_name='search_path'
      and btrim(config.option_value, chr(34))=''
  ) then
    raise exception 'admin_list_quick_solution_opps_handoffs(text) must retain an empty hardened search_path';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p,
         lateral pg_catalog.aclexplode(
           coalesce(p.proacl, pg_catalog.acldefault('f',p.proowner))
         ) acl
    where p.oid=v_rpc
      and acl.grantee=0
      and acl.privilege_type='EXECUTE'
  ) then
    raise exception 'admin_list_quick_solution_opps_handoffs(text) must not grant EXECUTE to PUBLIC';
  end if;
  if has_function_privilege('anon',v_rpc,'EXECUTE') then
    raise exception 'admin_list_quick_solution_opps_handoffs(text) must deny anon EXECUTE';
  end if;
  if not has_function_privilege('authenticated',v_rpc,'EXECUTE') then
    raise exception 'admin_list_quick_solution_opps_handoffs(text) must grant EXECUTE to authenticated';
  end if;
  if has_function_privilege('service_role',v_rpc,'EXECUTE') then
    raise exception 'admin_list_quick_solution_opps_handoffs(text) must not grant direct EXECUTE to service_role';
  end if;

  v_definition := lower(pg_catalog.pg_get_functiondef(v_rpc));
  if v_definition not like '%has_tenant_capability%'
     or v_definition not like '%cafe.operations.manage%' then
    raise exception 'admin_list_quick_solution_opps_handoffs(text) must require cafe.operations.manage';
  end if;
  if v_definition ~ '(is_app_admin|is_opps_staff|can_access_tenant)' then
    raise exception 'admin_list_quick_solution_opps_handoffs(text) must not retain a global or OPPS-staff bypass';
  end if;
end
$contracts$;

do $behavior$
declare
  -- Exact, stable messages raised by the migrated RPC.
  c_denied constant text := 'You do not have access to Quick Solution handoffs.';
  c_signin constant text := 'Staff sign-in is required.';
  c_no_tenant constant text := 'Quick Solution tenant was not found.';

  v_target_tenant uuid := gen_random_uuid();
  v_foreign_tenant uuid := gen_random_uuid();
  v_joint_x_tenant uuid;
  v_no_membership uuid := gen_random_uuid();
  v_inactive_member uuid := gen_random_uuid();
  v_foreign_owner uuid := gen_random_uuid();
  v_target_member uuid := gen_random_uuid();
  v_target_owner uuid := gen_random_uuid();
  v_target_admin uuid := gen_random_uuid();
  v_app_admin uuid := gen_random_uuid();
  v_opps_staff uuid := gen_random_uuid();
  v_suffix text := replace(gen_random_uuid()::text,'-','');
  v_target_slug text;
  v_foreign_slug text;

  -- Synthetic commerce fixtures: two target-tenant orders (one with a
  -- handoff, one without) and one foreign-tenant order with a handoff.
  v_order_a uuid := gen_random_uuid();
  v_order_b uuid := gen_random_uuid();
  v_order_foreign uuid := gen_random_uuid();
  v_order_no_a text;
  v_order_no_b text;
  v_order_no_foreign text;
  v_target_marker text;
  v_foreign_marker text;

  v_actor uuid;
  v_actor_label text;
  v_result jsonb;
  v_row_a jsonb;
  v_row_b jsonb;
begin
  v_target_slug := 'cafe-access-01-target-' || left(v_suffix,12);
  v_foreign_slug := 'cafe-access-01-foreign-' || right(v_suffix,12);
  v_order_no_a := 'CA01-T-A-' || left(v_suffix,10);
  v_order_no_b := 'CA01-T-B-' || left(v_suffix,10);
  v_order_no_foreign := 'CA01-F-A-' || left(v_suffix,10);
  v_target_marker := 'cafe-access-01-target-marker-' || v_suffix;
  v_foreign_marker := 'cafe-access-01-foreign-marker-' || v_suffix;

  select t.id into v_joint_x_tenant
  from public.tenants t
  where t.slug='joint-x' and t.status='active'
  limit 1;
  if v_joint_x_tenant is null then
    raise exception 'CAFE_ACCESS_01_TEST_SETUP: active joint-x tenant is required';
  end if;

  insert into public.tenants(id,slug,name,status,settings)
  values
    (v_target_tenant,v_target_slug,'CAFE ACCESS 01 target','active','{}'::jsonb),
    (v_foreign_tenant,v_foreign_slug,'CAFE ACCESS 01 foreign','active','{}'::jsonb);

  insert into auth.users(
    id,aud,role,email,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  )
  values
    (v_no_membership,'authenticated','authenticated','cafe-no-membership-'||v_suffix||'@disposable.test',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
    (v_inactive_member,'authenticated','authenticated','cafe-inactive-'||v_suffix||'@disposable.test',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
    (v_foreign_owner,'authenticated','authenticated','cafe-foreign-'||v_suffix||'@disposable.test',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
    (v_target_member,'authenticated','authenticated','cafe-member-'||v_suffix||'@disposable.test',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
    (v_target_owner,'authenticated','authenticated','cafe-owner-'||v_suffix||'@disposable.test',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
    (v_target_admin,'authenticated','authenticated','cafe-admin-'||v_suffix||'@disposable.test',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
    (v_app_admin,'authenticated','authenticated','cafe-app-admin-'||v_suffix||'@disposable.test',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
    (v_opps_staff,'authenticated','authenticated','cafe-opps-staff-'||v_suffix||'@disposable.test',now(),'{}'::jsonb,'{}'::jsonb,now(),now());

  -- SETUP-ONLY approved-actor claim. The real guard trigger
  -- trg_users_enforce_admin_role_change (enforce_approved_admin_role_change())
  -- only lets a public.users row with role='admin' be INSERTED when the JWT
  -- email is on its approved-owner list, so building the synthetic app-admin
  -- fixture requires that claim. It is transaction-local, carries a synthetic
  -- subject (no auth row exists for that email), and is cleared immediately
  -- after the public.users inserts below and asserted gone before any
  -- authorization assertion. The guard trigger is deliberately NOT disabled.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',v_app_admin,
      'role','authenticated',
      'email','jointx.co@gmail.com'
    )::text,
    true
  );

  -- Inserting active public.users rows also fires the real
  -- trg_internal_user_joint_x_membership trigger, which gives each such
  -- identity an active Joint X membership (role admin for role='admin'). The
  -- synthetic app-admin is therefore ALSO a Joint X admin member and OPPS
  -- staff. That is intentional: the property under test is NO QUALIFYING
  -- TARGET CAFE MEMBERSHIP, and an identity that is global app admin + Joint X
  -- admin + OPPS staff must still be denied without Cafe owner/admin authority.
  insert into public.users(auth_user_id,user_email,full_name,role,is_active)
  values
    (v_app_admin,'cafe-app-admin-'||v_suffix||'@disposable.test','CAFE ACCESS 01 app admin','admin',true),
    (v_opps_staff,'cafe-opps-staff-'||v_suffix||'@disposable.test','CAFE ACCESS 01 OPPS staff','user',true);

  perform set_config('request.jwt.claims','{}',true);
  if lower(coalesce(auth.jwt() ->> 'email','')) <> '' then
    raise exception 'CAFE_ACCESS_01_TEST_SETUP: the temporary approved-owner claim must be cleared before any assertion';
  end if;

  insert into public.tenant_memberships(
    tenant_id,auth_user_id,tenant_role,status
  )
  values
    (v_target_tenant,v_inactive_member,'owner','suspended'),
    (v_foreign_tenant,v_foreign_owner,'owner','active'),
    (v_target_tenant,v_target_member,'member','active'),
    (v_target_tenant,v_target_owner,'owner','active'),
    (v_target_tenant,v_target_admin,'admin','active'),
    -- Already created by the trigger above; kept explicit and idempotent.
    (v_joint_x_tenant,v_opps_staff,'member','active')
  on conflict (tenant_id,auth_user_id) do update
    set tenant_role=excluded.tenant_role,status=excluded.status;

  -- The tested property: neither the app-admin nor the OPPS-staff fixture
  -- holds any membership in the target Cafe tenant (yet).
  if exists (
    select 1
    from public.tenant_memberships m
    where m.tenant_id=v_target_tenant
      and m.auth_user_id in (v_app_admin,v_opps_staff)
  ) then
    raise exception 'CAFE_ACCESS_01_TEST_SETUP: app-admin and OPPS-staff fixtures must have no target Cafe membership';
  end if;

  -- Synthetic Quick Solution rows. Only columns defined by qs_03 / qs_04a are
  -- used; public.orders foreign keys (opps_order_id) are left null.
  insert into commerce.service_orders(
    id,tenant_id,order_number,status,customer_name,total_amount,
    payment_status,idempotency_key,submitted_at
  )
  values
    (v_order_a,v_target_tenant,v_order_no_a,'accepted','CAFE ACCESS 01 customer A',125.50,
      'paid','cafe-access-01-'||v_suffix||'-a',now() - interval '1 hour'),
    (v_order_b,v_target_tenant,v_order_no_b,'submitted','CAFE ACCESS 01 customer B',60,
      'unpaid','cafe-access-01-'||v_suffix||'-b',now()),
    (v_order_foreign,v_foreign_tenant,v_order_no_foreign,'submitted','CAFE ACCESS 01 foreign customer',999.99,
      'unpaid','cafe-access-01-'||v_suffix||'-f',now());

  insert into commerce.service_order_handoffs(
    service_order_id,source_tenant_id,target_tenant_id,mapping_version,status,
    preview_payload,blockers,warnings,idempotency_key,last_previewed_at
  )
  values
    (v_order_a,v_target_tenant,v_joint_x_tenant,'cafe-access-01-synthetic-v1','previewed',
      jsonb_build_object('syntheticMarker',v_target_marker),
      '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('code','SYNTHETIC_WARNING')),
      'cafe-access-01-'||v_suffix||'-ha',
      timestamptz '2026-01-02 03:04:05+00'),
    (v_order_foreign,v_foreign_tenant,v_joint_x_tenant,'cafe-access-01-synthetic-v1','previewed',
      jsonb_build_object('syntheticMarker',v_foreign_marker),
      '[]'::jsonb,'[]'::jsonb,
      'cafe-access-01-'||v_suffix||'-hf',
      timestamptz '2026-01-02 03:04:05+00');

  -- Anonymous has neither an identity nor an executable API grant.
  perform set_config('request.jwt.claims','{}',true);
  if public.has_tenant_capability(v_target_tenant,'cafe.operations.manage') then
    raise exception 'anon must be denied cafe.operations.manage';
  end if;
  perform pg_temp.expect_handoffs_error(v_target_slug,'anonymous caller','42501',c_signin);

  -- Authenticated with no target membership.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_no_membership,'role','authenticated')::text,
    true
  );
  if public.has_tenant_capability(v_target_tenant,'cafe.operations.manage') then
    raise exception 'authenticated identity without target membership must be denied';
  end if;
  perform pg_temp.expect_handoffs_error(v_target_slug,'no target membership','42501',c_denied);

  -- Suspended target membership.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_inactive_member,'role','authenticated')::text,
    true
  );
  if public.has_tenant_capability(v_target_tenant,'cafe.operations.manage') then
    raise exception 'inactive target membership must be denied';
  end if;
  perform pg_temp.expect_handoffs_error(v_target_slug,'inactive target membership','42501',c_denied);

  -- Active role in a different tenant only.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_foreign_owner,'role','authenticated')::text,
    true
  );
  if public.has_tenant_capability(v_target_tenant,'cafe.operations.manage') then
    raise exception 'foreign-tenant membership must not grant target capability';
  end if;
  perform pg_temp.expect_handoffs_error(v_target_slug,'foreign-tenant owner listing target','42501',c_denied);

  -- Positive control: the same foreign owner IS authorized for its own tenant
  -- and receives exactly its own synthetic row and none of the target's data.
  v_result := public.admin_list_quick_solution_opps_handoffs(v_foreign_slug);
  if jsonb_typeof(v_result) <> 'array' or jsonb_array_length(v_result) <> 1 then
    raise exception 'foreign owner must receive exactly its own single synthetic row, got %',v_result;
  end if;
  if v_result -> 0 ->> 'serviceOrderId' is distinct from v_order_foreign::text
     or v_result -> 0 -> 'previewPayload' ->> 'syntheticMarker' is distinct from v_foreign_marker then
    raise exception 'foreign owner received the wrong row: %',v_result;
  end if;
  if position(v_target_marker in v_result::text) <> 0
     or position(v_order_no_a in v_result::text) <> 0
     or position(v_order_no_b in v_result::text) <> 0 then
    raise exception 'foreign owner result leaked target-tenant data: %',v_result;
  end if;

  -- Target member is intentionally below the capability baseline.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_target_member,'role','authenticated')::text,
    true
  );
  if public.has_tenant_capability(v_target_tenant,'cafe.operations.manage') then
    raise exception 'target Cafe member must be denied cafe.operations.manage';
  end if;
  perform pg_temp.expect_handoffs_error(v_target_slug,'target Cafe member','42501',c_denied);

  -- Target owner and admin are the only current role baselines allowed. Each
  -- must receive exactly the two target-tenant rows with the enriched payload
  -- preserved, and never any foreign-tenant data.
  foreach v_actor in array array[v_target_owner,v_target_admin] loop
    v_actor_label := case when v_actor=v_target_owner then 'owner' else 'admin' end;

    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub',v_actor,'role','authenticated')::text,
      true
    );
    if public.has_tenant_capability(v_target_tenant,'cafe.operations.manage') is distinct from true then
      raise exception 'target Cafe % must receive cafe.operations.manage',v_actor_label;
    end if;
    if public.has_tenant_capability(v_target_tenant,'unknown.capability') then
      raise exception 'unknown tenant capability must fail closed for target Cafe %',v_actor_label;
    end if;

    v_result := public.admin_list_quick_solution_opps_handoffs(v_target_slug);
    if jsonb_typeof(v_result) <> 'array' or jsonb_array_length(v_result) <> 2 then
      raise exception 'target Cafe % must receive exactly the two target synthetic rows, got %',v_actor_label,v_result;
    end if;
    if v_result -> 0 ->> 'serviceOrderId' is distinct from v_order_b::text
       or v_result -> 1 ->> 'serviceOrderId' is distinct from v_order_a::text then
      raise exception 'target Cafe % rows must be ordered by submitted_at desc, got %',v_actor_label,v_result;
    end if;
    if position(v_foreign_marker in v_result::text) <> 0
       or position(v_order_no_foreign in v_result::text) <> 0
       or position(v_order_foreign::text in v_result::text) <> 0 then
      raise exception 'target Cafe % result leaked foreign-tenant data: %',v_actor_label,v_result;
    end if;

    select e.item into v_row_a
    from jsonb_array_elements(v_result) as e(item)
    where e.item ->> 'serviceOrderId' = v_order_a::text;
    select e.item into v_row_b
    from jsonb_array_elements(v_result) as e(item)
    where e.item ->> 'serviceOrderId' = v_order_b::text;

    if v_row_a is null or v_row_b is null then
      raise exception 'target Cafe % result is missing a synthetic target row: %',v_actor_label,v_result;
    end if;

    -- Order A: has a stored handoff; the enriched payload must be preserved.
    if v_row_a ->> 'orderNumber' is distinct from v_order_no_a
       or v_row_a ->> 'customerName' is distinct from 'CAFE ACCESS 01 customer A'
       or (v_row_a ->> 'totalAmount')::numeric is distinct from 125.50
       or v_row_a ->> 'paymentStatus' is distinct from 'paid'
       or v_row_a ->> 'serviceStatus' is distinct from 'accepted'
       or jsonb_typeof(v_row_a -> 'oppsOrderId') is distinct from 'null'
       or v_row_a ->> 'handoffStatus' is distinct from 'previewed'
       or v_row_a ->> 'mappingVersion' is distinct from 'cafe-access-01-synthetic-v1'
       or (v_row_a ->> 'lastPreviewedAt')::timestamptz is distinct from timestamptz '2026-01-02 03:04:05+00'
       or jsonb_typeof(v_row_a -> 'sentAt') is distinct from 'null'
       or v_row_a -> 'blockers' is distinct from '[]'::jsonb
       or jsonb_array_length(v_row_a -> 'warnings') <> 1
       or v_row_a -> 'warnings' -> 0 ->> 'code' is distinct from 'SYNTHETIC_WARNING'
       or v_row_a -> 'previewPayload' ->> 'syntheticMarker' is distinct from v_target_marker then
      raise exception 'target Cafe % handoff row A did not preserve its contract: %',v_actor_label,v_row_a;
    end if;

    -- Order B: no stored handoff; the left join must still list it as not previewed.
    if v_row_b ->> 'orderNumber' is distinct from v_order_no_b
       or v_row_b ->> 'customerName' is distinct from 'CAFE ACCESS 01 customer B'
       or (v_row_b ->> 'totalAmount')::numeric is distinct from 60
       or v_row_b ->> 'paymentStatus' is distinct from 'unpaid'
       or v_row_b ->> 'serviceStatus' is distinct from 'submitted'
       or v_row_b ->> 'handoffStatus' is distinct from 'not_previewed'
       or jsonb_typeof(v_row_b -> 'mappingVersion') is distinct from 'null'
       or jsonb_typeof(v_row_b -> 'previewPayload') is distinct from 'null'
       or v_row_b -> 'blockers' is distinct from '[]'::jsonb
       or v_row_b -> 'warnings' is distinct from '[]'::jsonb then
      raise exception 'target Cafe % handoff row B did not preserve its contract: %',v_actor_label,v_row_b;
    end if;
  end loop;

  -- Authority in tenant A cannot be reused by supplying tenant B's slug. The
  -- target owner is fully authorized for the target tenant (asserted above)
  -- and holds no membership in the foreign tenant. A target-admin variant is
  -- not repeated: it exercises the identical tenant-scoped membership check.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_target_owner,'role','authenticated')::text,
    true
  );
  if public.has_tenant_capability(v_foreign_tenant,'cafe.operations.manage') then
    raise exception 'target Cafe owner must not hold cafe.operations.manage in the foreign tenant';
  end if;
  perform pg_temp.expect_handoffs_error(
    v_foreign_slug,'target Cafe owner supplying the foreign tenant slug','42501',c_denied
  );

  -- A global app admin without target membership no longer bypasses this RPC.
  -- Under the real triggers this identity is also a Joint X admin member and
  -- OPPS staff; it has no qualifying membership in the target Cafe tenant.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',v_app_admin,
      'role','authenticated',
      'email','cafe-app-admin-'||v_suffix||'@disposable.test'
    )::text,
    true
  );
  -- Authority must come from the public.users role arm of is_app_admin(), not
  -- from the setup-only approved-owner claim: that claim is gone and this
  -- disposable email cannot be on any approved-owner list.
  if (auth.jwt() ->> 'email') not like '%@disposable.test' then
    raise exception 'CAFE_ACCESS_01_TEST_SETUP: app-admin assertions must run under the disposable identity only';
  end if;
  if public.current_user_app_role() is distinct from 'admin' then
    raise exception 'CAFE_ACCESS_01_TEST_SETUP: app-admin fixture must be admin by public.users role';
  end if;
  if public.is_app_admin() is distinct from true then
    raise exception 'CAFE_ACCESS_01_TEST_SETUP: app-admin fixture did not satisfy is_app_admin()';
  end if;
  if public.has_tenant_capability(v_target_tenant,'cafe.operations.manage') then
    raise exception 'global app admin without target membership must be denied';
  end if;
  perform pg_temp.expect_handoffs_error(v_target_slug,'global app admin without target Cafe membership','42501',c_denied);

  -- Joint X OPPS staff status alone, and OPPS staff plus a Cafe member role,
  -- are both insufficient.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',v_opps_staff,
      'role','authenticated',
      'email','cafe-opps-staff-'||v_suffix||'@disposable.test'
    )::text,
    true
  );
  if public.is_opps_staff() is distinct from true then
    raise exception 'CAFE_ACCESS_01_TEST_SETUP: OPPS-staff fixture did not satisfy is_opps_staff()';
  end if;
  if public.has_tenant_capability(v_target_tenant,'cafe.operations.manage') then
    raise exception 'Joint X OPPS staff without target membership must be denied';
  end if;
  perform pg_temp.expect_handoffs_error(v_target_slug,'OPPS staff without target Cafe membership','42501',c_denied);

  insert into public.tenant_memberships(
    tenant_id,auth_user_id,tenant_role,status
  )
  values(v_target_tenant,v_opps_staff,'member','active');

  if public.has_tenant_capability(v_target_tenant,'cafe.operations.manage') then
    raise exception 'Joint X OPPS staff plus Cafe member must be denied';
  end if;
  perform pg_temp.expect_handoffs_error(v_target_slug,'OPPS staff plus target Cafe member','42501',c_denied);
  perform pg_temp.expect_handoffs_error(v_foreign_slug,'OPPS staff listing another tenant without its qualifying role','42501',c_denied);

  -- Even a qualifying role stops granting authority while the target tenant
  -- itself is inactive.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_target_owner,'role','authenticated')::text,
    true
  );
  update public.tenants set status='suspended' where id=v_target_tenant;
  if public.has_tenant_capability(v_target_tenant,'cafe.operations.manage') then
    raise exception 'inactive target tenant must deny cafe.operations.manage';
  end if;
  perform pg_temp.expect_handoffs_error(v_target_slug,'inactive target tenant','22023',c_no_tenant);
end
$behavior$;

rollback;

select 'CAFE-ACCESS-01 tenant capability operations contracts passed' as result;
