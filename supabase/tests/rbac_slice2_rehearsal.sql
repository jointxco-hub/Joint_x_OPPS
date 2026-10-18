-- RBAC Remediation Slice 2 -- REHEARSAL SCRIPT (hybrid preservation model)
--
-- Run inside BEGIN ... ROLLBACK against production. Assemble as:
--   BEGIN;
--   <preflight: confirm current live baseline for the 3 RPCs>
--   <full contents of supabase/migrations/20261002090000_rbac_slice2_harden_staff_manage_employee_team.sql>
--   <this file>
--   ROLLBACK;
--
-- IMPORTANT: the new helper public.has_high_trust_workspace_permission()
-- hardcodes its tightened owner/admin-only rule ONLY for the tenant whose
-- slug is literally 'joint-x'. A disposable tenant that merely COPIES
-- joint-x's wildcard shape is NOT 'joint-x' and would fall through to
-- branch 3 (has_tenant_permission(), preserved) -- so testing the
-- tightened behavior requires using the REAL, live joint-x tenant_id
-- (6d371f51-274c-4b49-8d59-2aeaf5e89088, confirmed live) with disposable
-- auth.users + tenant_memberships rows layered on top of it. This is
-- read/write ONLY inside this transaction, entirely undone by ROLLBACK;
-- it never touches any real joint-x member's existing row, and the two
-- list RPCs it exercises are read-only against real joint-x data (which
-- never leaves this transaction). Preservation tests (28-33) use their
-- OWN wholly-disposable, non-'joint-x' tenants instead, since those
-- exercise branch 3 and must NOT be the real joint-x tenant.
--
-- Same lesson as prior rehearsals: privileged fixture setup happens
-- entirely before any role/JWT switch; a fresh switch happens
-- immediately before each call attributed to a disposable identity;
-- RESET ROLE before every post-call verification SELECT.
--
-- TWO bugs were found and fixed while actually running this rehearsal
-- against production (2026-10-02):
--
-- 1. Wrapper-only (not in this file): the assembling wrapper's admin JWT
--    claim (`select set_config('request.jwt.claims', '{"email":
--    "jointx.co@gmail.com"}', true);`), needed so the fixture-setup
--    insert of a public.users row with role='admin' below passes
--    enforce_approved_admin_role_change(), MUST stay active from before
--    `BEGIN` through the end of fixture setup -- do NOT reset it between
--    the preflight check and this file's own content. This file never
--    sets its own claim until TEST 1 (immediately after fixtures are
--    ready), so an external reset placed before that point breaks the
--    fixture-setup insert below with "Only approved owners can assign
--    administrator access." This file has nothing to fix for this one --
--    it's a constraint on how the wrapper assembles this file, recorded
--    here since it is not otherwise self-evident from this file alone.
--
-- 2. In this file (fixed below): inserting the app-admin's public.users
--    row with role='admin' auto-enrolls it into the REAL joint-x tenant
--    via add_internal_user_to_joint_x_team() (same trigger behavior
--    confirmed during the Slice 1 rehearsal). The membership-integrity
--    check near the end of this file must exclude that auto-created row
--    (by including v_appadmin in the auth_user_id exclusion list for the
--    joint-x branch) or it will fail with a false "membership count
--    changed" report.

do $rehearsal_do$
declare
  v_joint_x_id         uuid := '6d371f51-274c-4b49-8d59-2aeaf5e89088';

  -- Real-joint-x-tenant disposable identities (tests 1-18, 25-27)
  v_jx_owner           uuid := gen_random_uuid();
  v_jx_admin           uuid := gen_random_uuid();
  v_jx_member          uuid := gen_random_uuid();
  v_jx_staff           uuid := gen_random_uuid();
  v_jx_target          uuid := gen_random_uuid();  -- mutation target +
                                                    -- Employee Hub "someone
                                                    -- else" row
  v_appadmin           uuid := gen_random_uuid();

  -- Unrelated disposable tenant (test 7, cross-tenant rejection)
  v_tenant_b_id        uuid;
  v_tenantb_owner      uuid := gen_random_uuid();

  -- Preservation-tenant disposable identities (tests 28-33)
  v_tenant_c_id        uuid;  -- no permission rows at all (demo-xos shape)
  v_c_owner            uuid := gen_random_uuid();
  v_c_target           uuid := gen_random_uuid();

  v_tenant_d_id        uuid;  -- explicit, non-wildcard grants (preserved)
  v_d_owner            uuid := gen_random_uuid();
  v_d_target           uuid := gen_random_uuid();

  v_m_jx_owner         uuid;  -- tenant_memberships.id per identity
  v_m_jx_admin         uuid;
  v_m_jx_target         uuid;

  v_qbr_jx_target_id   uuid;
  v_qbr_jx_member_id   uuid;
  v_qbr_c_target_id    uuid;
  v_qbr_d_target_id    uuid;
  v_ur_jx_target_id    uuid;

  v_result             jsonb;
  v_row                record;
  v_count              int;
  v_orders_perm_before int;
  v_orders_perm_after  int;
  v_wildcard_before    int;
  v_wildcard_after     int;
  v_outside_memberships_before int;
  v_audit_before       int;
  v_audit_after        int;
  v_qs_perm_before     int;
  v_qs_perm_after      int;
  v_qs_tenant_id       uuid;
  v_noperm_tenants_before int;
  v_noperm_tenants_after  int;
begin
  -- ============================================================
  -- FIXTURE SETUP (privileged role throughout)
  -- ============================================================
  select count(*)::int into v_orders_perm_before
  from public.tenant_access_role_permissions
  where permission_key in ('orders.write','production.update','payments.manage','finance.read');

  select count(*)::int into v_wildcard_before
  from public.tenant_access_role_permissions where permission_key = '*';

  select count(*)::int into v_outside_memberships_before
  from public.tenant_memberships;

  select count(*)::int into v_audit_before
  from public.tenant_access_audit_log;

  select id into v_qs_tenant_id from public.tenants where slug = 'quick-solution';
  select count(*)::int into v_qs_perm_before
  from public.tenant_access_role_permissions where tenant_id = v_qs_tenant_id;

  select count(*)::int into v_noperm_tenants_before
  from public.tenant_access_role_permissions
  where tenant_id in (select id from public.tenants where slug in ('demo-xos','gsb','tenant-a-qa','tenant-b-qa'));

  -- --- Real joint-x tenant: disposable identities layered on top ---
  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_jx_owner,  'authenticated', 'authenticated', 'rehearsal-s2-jxowner-'  || substr(v_jx_owner::text,1,8)  || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_jx_admin,  'authenticated', 'authenticated', 'rehearsal-s2-jxadmin-'  || substr(v_jx_admin::text,1,8)  || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_jx_member, 'authenticated', 'authenticated', 'rehearsal-s2-jxmember-' || substr(v_jx_member::text,1,8) || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_jx_staff,  'authenticated', 'authenticated', 'rehearsal-s2-jxstaff-'  || substr(v_jx_staff::text,1,8)  || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_jx_target, 'authenticated', 'authenticated', 'rehearsal-s2-jxtarget-' || substr(v_jx_target::text,1,8) || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_appadmin,  'authenticated', 'authenticated', 'rehearsal-s2-appadmin-' || substr(v_appadmin::text,1,8)  || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.users (auth_user_id, user_email, full_name, role, is_active)
  values (v_appadmin, 'rehearsal-s2-appadmin-' || substr(v_appadmin::text,1,8) || '@example.test', 'Rehearsal App Admin', 'admin', true);

  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status) values
    (v_joint_x_id, v_jx_owner,  'owner',  'active'),
    (v_joint_x_id, v_jx_admin,  'admin',  'active'),
    (v_joint_x_id, v_jx_member, 'member', 'active'),
    (v_joint_x_id, v_jx_staff,  'staff',  'active'),
    (v_joint_x_id, v_jx_target, 'member', 'active');

  select id into v_m_jx_owner  from public.tenant_memberships where tenant_id=v_joint_x_id and auth_user_id=v_jx_owner;
  select id into v_m_jx_admin  from public.tenant_memberships where tenant_id=v_joint_x_id and auth_user_id=v_jx_admin;
  select id into v_m_jx_target from public.tenant_memberships where tenant_id=v_joint_x_id and auth_user_id=v_jx_target;

  insert into public.qbrs (auth_user_id, tenant_id, user_email, role_key, note)
  values (v_jx_target, v_joint_x_id, 'rehearsal-s2-jxtarget@example.test', 'designer', 'jx target original note')
  returning id into v_qbr_jx_target_id;
  insert into public.qbrs (auth_user_id, tenant_id, user_email, role_key, note)
  values (v_jx_member, v_joint_x_id, 'rehearsal-s2-jxmember@example.test', 'designer', 'jx member original note')
  returning id into v_qbr_jx_member_id;
  insert into public.user_roles (auth_user_id, tenant_id, user_email, role_key)
  values (v_jx_target, v_joint_x_id, 'rehearsal-s2-jxtarget@example.test', 'designer')
  returning id into v_ur_jx_target_id;

  -- --- Unrelated disposable tenant B (test 7) ---
  insert into public.tenants (slug, name, status)
  values ('rehearsal-slice2-b-' || substr(v_tenantb_owner::text,1,8), 'Rehearsal Slice2 Tenant B', 'active')
  returning id into v_tenant_b_id;
  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_tenantb_owner, 'authenticated', 'authenticated', 'rehearsal-s2-tbowner-' || substr(v_tenantb_owner::text,1,8) || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
  insert into public.tenant_access_roles (tenant_id, role_key, name, rank, is_active) values
    (v_tenant_b_id, 'owner', 'Owner', 10, true);
  insert into public.tenant_access_role_permissions (tenant_id, role_key, permission_key, allowed) values
    (v_tenant_b_id, 'owner', '*', true);
  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status) values
    (v_tenant_b_id, v_tenantb_owner, 'owner', 'active');

  -- --- Preservation Tenant C: owner/admin membership, ZERO permission
  -- rows at all (reproduces demo-xos/gsb/tenant-a-qa/tenant-b-qa's shape:
  -- must remain REJECTED, not newly granted). ---
  insert into public.tenants (slug, name, status)
  values ('rehearsal-slice2-c-' || substr(v_c_owner::text,1,8), 'Rehearsal Slice2 Tenant C (no perms)', 'active')
  returning id into v_tenant_c_id;
  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_c_owner,  'authenticated', 'authenticated', 'rehearsal-s2-cowner-'  || substr(v_c_owner::text,1,8)  || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_c_target, 'authenticated', 'authenticated', 'rehearsal-s2-ctarget-' || substr(v_c_target::text,1,8) || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
  insert into public.tenant_access_roles (tenant_id, role_key, name, rank, is_active) values
    (v_tenant_c_id, 'owner',  'Owner',  10, true),
    (v_tenant_c_id, 'member', 'Member', 50, true);
  -- deliberately NO tenant_access_role_permissions rows for Tenant C.
  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status) values
    (v_tenant_c_id, v_c_owner,  'owner',  'active'),
    (v_tenant_c_id, v_c_target, 'member', 'active');
  insert into public.qbrs (auth_user_id, tenant_id, user_email, role_key, note)
  values (v_c_target, v_tenant_c_id, 'rehearsal-s2-ctarget@example.test', 'designer', 'c target original note')
  returning id into v_qbr_c_target_id;

  -- --- Preservation Tenant D: owner has EXPLICIT (non-wildcard) grants
  -- for staff.manage / employee.team.read / employee.team.manage --
  -- must retain its EXISTING success behavior unchanged. ---
  insert into public.tenants (slug, name, status)
  values ('rehearsal-slice2-d-' || substr(v_d_owner::text,1,8), 'Rehearsal Slice2 Tenant D (explicit grants)', 'active')
  returning id into v_tenant_d_id;
  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_d_owner,  'authenticated', 'authenticated', 'rehearsal-s2-downer-'  || substr(v_d_owner::text,1,8)  || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_d_target, 'authenticated', 'authenticated', 'rehearsal-s2-dtarget-' || substr(v_d_target::text,1,8) || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
  insert into public.tenant_access_roles (tenant_id, role_key, name, rank, is_active) values
    (v_tenant_d_id, 'owner',  'Owner',  10, true),
    (v_tenant_d_id, 'member', 'Member', 50, true);
  insert into public.tenant_access_role_permissions (tenant_id, role_key, permission_key, allowed) values
    (v_tenant_d_id, 'owner', 'staff.manage', true),
    (v_tenant_d_id, 'owner', 'employee.team.read', true),
    (v_tenant_d_id, 'owner', 'employee.team.manage', true);
  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status) values
    (v_tenant_d_id, v_d_owner,  'owner',  'active'),
    (v_tenant_d_id, v_d_target, 'member', 'active');
  insert into public.qbrs (auth_user_id, tenant_id, user_email, role_key, note)
  values (v_d_target, v_tenant_d_id, 'rehearsal-s2-dtarget@example.test', 'designer', 'd target original note')
  returning id into v_qbr_d_target_id;

  raise notice '--- fixtures ready: joint_x=%, tenant_b=%, tenant_c=%, tenant_d=% ---',
    v_joint_x_id, v_tenant_b_id, v_tenant_c_id, v_tenant_d_id;

  -- ============================================================
  -- TEST 1: app-admin lists workspace roles (on REAL joint-x): succeeds
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_appadmin, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.admin_list_workspace_roles(v_joint_x_id) into v_result;
  if v_result is null or jsonb_array_length(v_result) <> 4 then
    raise exception 'TEST 1 FAILED: app-admin list_workspace_roles on joint-x did not return 4 roles: %', v_result;
  end if;
  raise notice 'TEST 1 passed: app-admin lists workspace roles on joint-x';

  -- ============================================================
  -- TEST 2: app-admin lists workspace members (on REAL joint-x): succeeds
  -- ============================================================
  select public.admin_list_workspace_members(v_joint_x_id) into v_result;
  if v_result is null or jsonb_array_length(v_result) < 5
     or not exists (select 1 from jsonb_array_elements(v_result) e where (e->>'authUserId')::uuid = v_jx_owner) then
    raise exception 'TEST 2 FAILED: app-admin list_workspace_members on joint-x did not include our fixture owner: %', v_result;
  end if;
  raise notice 'TEST 2 passed: app-admin lists workspace members on joint-x';

  -- ============================================================
  -- TEST 3 / 26: joint-x owner lists workspace roles/members: succeeds
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_jx_owner, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.admin_list_workspace_roles(v_joint_x_id) into v_result;
  if v_result is null or jsonb_array_length(v_result) <> 4 then
    raise exception 'TEST 3/26 FAILED: joint-x owner list_workspace_roles failed: %', v_result;
  end if;
  select public.admin_list_workspace_members(v_joint_x_id) into v_result;
  if v_result is null or jsonb_array_length(v_result) < 5 then
    raise exception 'TEST 3/26 FAILED: joint-x owner list_workspace_members failed: %', v_result;
  end if;
  raise notice 'TEST 3/26 passed: joint-x owner lists workspace roles and members';

  -- ============================================================
  -- TEST 4 / 27: joint-x admin lists workspace roles/members: succeeds
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_jx_admin, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.admin_list_workspace_roles(v_joint_x_id) into v_result;
  if v_result is null or jsonb_array_length(v_result) <> 4 then
    raise exception 'TEST 4/27 FAILED: joint-x admin list_workspace_roles failed: %', v_result;
  end if;
  select public.admin_list_workspace_members(v_joint_x_id) into v_result;
  if v_result is null or jsonb_array_length(v_result) < 5 then
    raise exception 'TEST 4/27 FAILED: joint-x admin list_workspace_members failed: %', v_result;
  end if;
  raise notice 'TEST 4/27 passed: joint-x admin lists workspace roles and members';

  -- ============================================================
  -- TEST 5 / 25: joint-x member with wildcard '*': REJECTED from both
  -- list RPCs (the core hardening -- this is the one that was broken
  -- under the old tenant-agnostic design's test fixture; now exercised
  -- against the REAL joint-x tenant so the slug check actually fires).
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_jx_member, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_list_workspace_roles(v_joint_x_id);
    raise exception 'TEST 5/25 FAILED: joint-x wildcard member listed workspace roles';
  exception when others then
    if sqlerrm not like 'Workspace staff management access is required%' then
      raise exception 'TEST 5/25 FAILED: wrong error (roles): %', sqlerrm;
    end if;
  end;
  begin
    perform public.admin_list_workspace_members(v_joint_x_id);
    raise exception 'TEST 5/25 FAILED: joint-x wildcard member listed workspace members';
  exception when others then
    if sqlerrm not like 'Workspace staff management access is required%' then
      raise exception 'TEST 5/25 FAILED: wrong error (members): %', sqlerrm;
    end if;
  end;
  raise notice 'TEST 5/25 passed: joint-x wildcard member rejected from both list RPCs';

  -- ============================================================
  -- TEST 6: joint-x staff with wildcard '*': rejected (both list RPCs)
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_jx_staff, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_list_workspace_roles(v_joint_x_id);
    raise exception 'TEST 6 FAILED: joint-x wildcard staff listed workspace roles';
  exception when others then
    if sqlerrm not like 'Workspace staff management access is required%' then
      raise exception 'TEST 6 FAILED: wrong error (roles): %', sqlerrm;
    end if;
  end;
  begin
    perform public.admin_list_workspace_members(v_joint_x_id);
    raise exception 'TEST 6 FAILED: joint-x wildcard staff listed workspace members';
  exception when others then
    if sqlerrm not like 'Workspace staff management access is required%' then
      raise exception 'TEST 6 FAILED: wrong error (members): %', sqlerrm;
    end if;
  end;
  raise notice 'TEST 6 passed: joint-x wildcard staff rejected from both list RPCs';

  -- ============================================================
  -- TEST 7 / 23: cross-tenant owner cannot list/manage joint-x, and
  -- cannot read its Employee Hub rows either.
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_tenantb_owner, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_list_workspace_roles(v_joint_x_id);
    raise exception 'TEST 7 FAILED: tenant B owner listed joint-x workspace roles';
  exception when others then
    if sqlerrm not like 'Workspace staff management access is required%' then
      raise exception 'TEST 7 FAILED: wrong error: %', sqlerrm;
    end if;
  end;
  begin
    perform public.admin_set_workspace_member_role(v_m_jx_target, 'staff');
    raise exception 'TEST 7 FAILED: tenant B owner mutated a joint-x membership';
  exception when others then
    if sqlerrm not like 'Workspace staff management access is required%' then
      raise exception 'TEST 7 FAILED: wrong error (mutate): %', sqlerrm;
    end if;
  end;
  if exists (select 1 from public.qbrs where id = v_qbr_jx_target_id) then
    raise exception 'TEST 23 FAILED: tenant B owner unexpectedly saw a joint-x qbrs row';
  end if;
  raise notice 'TEST 7/23 passed: cross-tenant owner rejected from list/mutate/team-read on joint-x';

  -- ============================================================
  -- TEST 8: Slice 1 hierarchy protections still hold after the gate swap.
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_jx_owner, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_set_workspace_member_role(v_m_jx_owner, 'admin');
    raise exception 'TEST 8a FAILED: owner self-role-change was accepted';
  exception when others then
    if sqlerrm not like 'You cannot change your own workspace role%' then
      raise exception 'TEST 8a FAILED: wrong error: %', sqlerrm;
    end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_jx_admin, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_set_workspace_member_role(v_m_jx_owner, 'member');
    raise exception 'TEST 8b FAILED: admin modifying an owner was accepted';
  exception when others then
    if sqlerrm not like 'Only an app administrator can modify a workspace owner%' then
      raise exception 'TEST 8b FAILED: wrong error: %', sqlerrm;
    end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_jx_owner, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.admin_set_workspace_member_role(v_m_jx_target, 'staff') into v_result;
  if (v_result->>'ok')::boolean is distinct from true then
    raise exception 'TEST 8c FAILED: owner changing target member->staff did not succeed: %', v_result;
  end if;
  raise notice 'TEST 8 passed: Slice 1 hierarchy guards still hold on joint-x; happy path still works';

  -- ============================================================
  -- TEST 9/10: joint-x owner/admin team read: succeeds
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_jx_owner, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform 1 from public.qbrs where id = v_qbr_jx_target_id;
  if not found then
    raise exception 'TEST 9 FAILED: joint-x owner could not team-read target qbrs row';
  end if;
  raise notice 'TEST 9 passed: joint-x owner team read succeeds';

  perform set_config('request.jwt.claims', json_build_object('sub', v_jx_admin, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform 1 from public.qbrs where id = v_qbr_jx_target_id;
  if not found then
    raise exception 'TEST 10 FAILED: joint-x admin could not team-read target qbrs row';
  end if;
  raise notice 'TEST 10 passed: joint-x admin team read succeeds';

  -- ============================================================
  -- TEST 11/12: joint-x member/staff team read: rejected
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_jx_member, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform 1 from public.qbrs where id = v_qbr_jx_target_id;
  if found then
    raise exception 'TEST 11 FAILED: joint-x wildcard member could team-read target qbrs row';
  end if;
  raise notice 'TEST 11 passed: joint-x member team read rejected';

  perform set_config('request.jwt.claims', json_build_object('sub', v_jx_staff, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform 1 from public.qbrs where id = v_qbr_jx_target_id;
  if found then
    raise exception 'TEST 12 FAILED: joint-x wildcard staff could team-read target qbrs row';
  end if;
  raise notice 'TEST 12 passed: joint-x staff team read rejected';

  -- ============================================================
  -- TEST 13/14: joint-x owner/admin team manage/write: succeeds
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_jx_owner, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.qbrs set note = 'updated by jx owner' where id = v_qbr_jx_target_id;
  if not found then
    raise exception 'TEST 13 FAILED: joint-x owner could not team-update target qbrs row';
  end if;
  execute 'reset role';
  select note into v_row from public.qbrs where id = v_qbr_jx_target_id;
  if v_row.note is distinct from 'updated by jx owner' then
    raise exception 'TEST 13 FAILED: qbrs note not actually updated, got %', v_row.note;
  end if;
  raise notice 'TEST 13 passed: joint-x owner team manage/write succeeds';

  perform set_config('request.jwt.claims', json_build_object('sub', v_jx_admin, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.user_roles set is_primary = true where id = v_ur_jx_target_id;
  if not found then
    raise exception 'TEST 14 FAILED: joint-x admin could not team-update target user_roles row';
  end if;
  execute 'reset role';
  select is_primary into v_row from public.user_roles where id = v_ur_jx_target_id;
  if v_row.is_primary is distinct from true then
    raise exception 'TEST 14 FAILED: user_roles.is_primary not actually updated';
  end if;
  raise notice 'TEST 14 passed: joint-x admin team manage/write succeeds';

  -- ============================================================
  -- TEST 15/16: joint-x member/staff team manage/write: rejected
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_jx_member, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.qbrs set note = 'hijacked by jx member' where id = v_qbr_jx_target_id;
  if found then
    raise exception 'TEST 15 FAILED: joint-x wildcard member could team-update target qbrs row';
  end if;
  raise notice 'TEST 15 passed: joint-x member team manage/write rejected';

  perform set_config('request.jwt.claims', json_build_object('sub', v_jx_staff, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.qbrs set note = 'hijacked by jx staff' where id = v_qbr_jx_target_id;
  if found then
    raise exception 'TEST 16 FAILED: joint-x wildcard staff could team-update target qbrs row';
  end if;
  execute 'reset role';
  select note into v_row from public.qbrs where id = v_qbr_jx_target_id;
  if v_row.note is distinct from 'updated by jx owner' then
    raise exception 'TEST 15/16 FAILED: qbrs note was mutated by an unauthorized caller, got %', v_row.note;
  end if;
  raise notice 'TEST 16 passed: joint-x staff team manage/write rejected; target row confirmed untouched since test 13';

  -- ============================================================
  -- TEST 17: joint-x ordinary member retains full self-service on
  -- their OWN My Hub rows.
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_jx_member, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform 1 from public.qbrs where id = v_qbr_jx_member_id;
  if not found then
    raise exception 'TEST 17 FAILED: joint-x member could not read their OWN qbrs row';
  end if;
  update public.qbrs set note = 'member self-update' where id = v_qbr_jx_member_id;
  if not found then
    raise exception 'TEST 17 FAILED: joint-x member could not update their OWN qbrs row';
  end if;
  execute 'reset role';
  select note into v_row from public.qbrs where id = v_qbr_jx_member_id;
  if v_row.note is distinct from 'member self-update' then
    raise exception 'TEST 17 FAILED: member self-row update did not persist, got %', v_row.note;
  end if;
  raise notice 'TEST 17 passed: joint-x ordinary member retains full self-service on their own My Hub rows';

  -- ============================================================
  -- TEST 18: joint-x ordinary member cannot read/write target's
  -- user_roles row (no self-row branch on that table at all).
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_jx_member, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform 1 from public.user_roles where id = v_ur_jx_target_id;
  if found then
    raise exception 'TEST 18 FAILED: joint-x member could read target''s user_roles row';
  end if;
  update public.user_roles set is_primary = false where id = v_ur_jx_target_id;
  if found then
    raise exception 'TEST 18 FAILED: joint-x member could update target''s user_roles row';
  end if;
  raise notice 'TEST 18 passed: joint-x ordinary member cannot read or write another user''s team row';

  -- ============================================================
  -- TEST 28: non-joint-x owner with NO permission rows at all (Tenant C):
  -- remains rejected from the workspace-admin RPC.
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_c_owner, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_list_workspace_roles(v_tenant_c_id);
    raise exception 'TEST 28 FAILED: Tenant C owner (no permission rows) listed workspace roles';
  exception when others then
    if sqlerrm not like 'Workspace staff management access is required%' then
      raise exception 'TEST 28 FAILED: wrong error: %', sqlerrm;
    end if;
  end;
  raise notice 'TEST 28 passed: non-joint-x owner with zero permission rows remains rejected';

  -- ============================================================
  -- TEST 29: non-joint-x owner WITH an explicit staff.manage grant
  -- (Tenant D): retains existing success behavior.
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_d_owner, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.admin_list_workspace_roles(v_tenant_d_id) into v_result;
  if v_result is null or jsonb_array_length(v_result) <> 2 then
    raise exception 'TEST 29 FAILED: Tenant D owner (explicit staff.manage grant) could not list workspace roles: %', v_result;
  end if;
  raise notice 'TEST 29 passed: non-joint-x owner with an explicit staff.manage grant retains success';

  -- ============================================================
  -- TEST 30: non-joint-x owner with NO employee.team.read grant
  -- (Tenant C): remains rejected from team-wide read.
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_c_owner, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform 1 from public.qbrs where id = v_qbr_c_target_id;
  if found then
    raise exception 'TEST 30 FAILED: Tenant C owner (no employee.team.read grant) could team-read target qbrs row';
  end if;
  raise notice 'TEST 30 passed: non-joint-x owner with no employee.team.read grant remains rejected';

  -- ============================================================
  -- TEST 31: non-joint-x owner WITH an explicit employee.team.read
  -- grant (Tenant D): retains success.
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_d_owner, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform 1 from public.qbrs where id = v_qbr_d_target_id;
  if not found then
    raise exception 'TEST 31 FAILED: Tenant D owner (explicit employee.team.read grant) could not team-read target qbrs row';
  end if;
  raise notice 'TEST 31 passed: non-joint-x owner with an explicit employee.team.read grant retains success';

  -- ============================================================
  -- TEST 32: non-joint-x owner with NO employee.team.manage grant
  -- (Tenant C): remains rejected from team-wide write.
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_c_owner, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.qbrs set note = 'hijacked by c owner' where id = v_qbr_c_target_id;
  if found then
    raise exception 'TEST 32 FAILED: Tenant C owner (no employee.team.manage grant) could team-update target qbrs row';
  end if;
  execute 'reset role';
  select note into v_row from public.qbrs where id = v_qbr_c_target_id;
  if v_row.note is distinct from 'c target original note' then
    raise exception 'TEST 32 FAILED: Tenant C target qbrs row was mutated by an unauthorized caller, got %', v_row.note;
  end if;
  raise notice 'TEST 32 passed: non-joint-x owner with no employee.team.manage grant remains rejected';

  -- ============================================================
  -- TEST 33: non-joint-x owner WITH an explicit employee.team.manage
  -- grant (Tenant D): retains success.
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_d_owner, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.qbrs set note = 'updated by d owner' where id = v_qbr_d_target_id;
  if not found then
    raise exception 'TEST 33 FAILED: Tenant D owner (explicit employee.team.manage grant) could not team-update target qbrs row';
  end if;
  execute 'reset role';
  select note into v_row from public.qbrs where id = v_qbr_d_target_id;
  if v_row.note is distinct from 'updated by d owner' then
    raise exception 'TEST 33 FAILED: Tenant D target qbrs row was not actually updated, got %', v_row.note;
  end if;
  raise notice 'TEST 33 passed: non-joint-x owner with an explicit employee.team.manage grant retains success';

  -- ============================================================
  -- Integrity checks (19-22) + preservation proofs, privileged role
  -- ============================================================
  execute 'reset role';

  select count(*)::int into v_orders_perm_after
  from public.tenant_access_role_permissions
  where permission_key in ('orders.write','production.update','payments.manage','finance.read');
  if v_orders_perm_after <> v_orders_perm_before then
    raise exception 'TEST 19 FAILED: Orders-related permission row count changed (% -> %)', v_orders_perm_before, v_orders_perm_after;
  end if;
  raise notice 'TEST 19 passed: Orders-related permission rows untouched (count=%)', v_orders_perm_after;

  select count(*)::int into v_wildcard_after
  from public.tenant_access_role_permissions where permission_key = '*';
  -- +1 expected: only Tenant B's single disposable wildcard row. Tenant A
  -- (the old all-wildcard design) no longer exists in this script;
  -- Tenant C has zero permission rows and Tenant D's grants are explicit,
  -- not wildcard.
  if v_wildcard_after <> v_wildcard_before + 1 then
    raise exception 'TEST 20 FAILED: wildcard row count changed by an unexpected amount (% -> %, expected +1)', v_wildcard_before, v_wildcard_after;
  end if;
  raise notice 'TEST 20 passed: wildcard row count changed by exactly the expected fixture delta (+1), no real wildcard row touched';

  -- Precise invariant: excluding our 3 wholly-new disposable tenants (B/C/D)
  -- AND our 6 disposable additions layered onto the REAL joint-x tenant
  -- (matched by auth_user_id, since joint-x itself is not a new tenant),
  -- every remaining tenant_memberships row must be exactly what existed
  -- before this transaction started -- we only ever INSERTed into our 4
  -- fixture tenants, never touched any other tenant's memberships, and
  -- admin_set_workspace_member_role's only UPDATE in this whole rehearsal
  -- targeted v_m_jx_target (a row already excluded by the auth_user_id
  -- filter, since it's one of our disposable joint-x additions). The
  -- sixth joint-x row is v_appadmin's OWN membership -- inserting its
  -- public.users row with role='admin' auto-enrolls it into joint-x via
  -- add_internal_user_to_joint_x_team() (same trigger behavior confirmed
  -- during the Slice 1 rehearsal) -- expected, unrelated to anything
  -- this RPC/RLS gate checks, and must be excluded here too.
  select count(*)::int into v_count
  from public.tenant_memberships
  where tenant_id not in (v_tenant_b_id, v_tenant_c_id, v_tenant_d_id)
    and not (tenant_id = v_joint_x_id and auth_user_id in (v_jx_owner, v_jx_admin, v_jx_member, v_jx_staff, v_jx_target, v_appadmin));
  if v_count <> v_outside_memberships_before then
    raise exception 'TEST 21 FAILED: membership count outside fixture rows changed (% -> %)', v_outside_memberships_before, v_count;
  end if;
  raise notice 'TEST 21 passed: tenant memberships outside fixture rows untouched';

  select count(*)::int into v_audit_after from public.tenant_access_audit_log;
  if v_audit_after - v_audit_before <> 1 then
    raise exception 'TEST 22 FAILED: expected exactly 1 new audit row (test 8c''s mutation), got delta %', v_audit_after - v_audit_before;
  end if;
  raise notice 'TEST 22 passed: rejected attempts created zero unintended writes (exactly 1 audit row, from the one successful mutation)';

  select count(*)::int into v_qs_perm_after
  from public.tenant_access_role_permissions where tenant_id = v_qs_tenant_id;
  if v_qs_perm_after <> v_qs_perm_before then
    raise exception 'TEST (preservation) FAILED: quick-solution permission row count changed (% -> %)', v_qs_perm_before, v_qs_perm_after;
  end if;
  raise notice 'Preservation check passed: quick-solution permission rows unchanged (count=%)', v_qs_perm_after;

  select count(*)::int into v_noperm_tenants_after
  from public.tenant_access_role_permissions
  where tenant_id in (select id from public.tenants where slug in ('demo-xos','gsb','tenant-a-qa','tenant-b-qa'));
  if v_noperm_tenants_after <> v_noperm_tenants_before then
    raise exception 'TEST (preservation) FAILED: demo-xos/gsb/QA tenant permission row count changed (% -> %)', v_noperm_tenants_before, v_noperm_tenants_after;
  end if;
  raise notice 'Preservation check passed: demo-xos/gsb/tenant-a-qa/tenant-b-qa permission rows unchanged (count=%, still zero)', v_noperm_tenants_after;

  raise notice '=== RBAC SLICE 2 REHEARSAL PASSED ===';
end $rehearsal_do$;
