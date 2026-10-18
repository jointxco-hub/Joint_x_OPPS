-- RBAC Remediation Slice 1 -- REHEARSAL SCRIPT
--
-- Run inside BEGIN ... ROLLBACK against production. Assemble as:
--   BEGIN;
--   <full contents of supabase/migrations/20261001100000_opps_rbac_source_of_truth_restoration.sql>
--   <full contents of supabase/migrations/20261001110000_rbac_slice1_harden_workspace_role_change.sql>
--   <this file>
--   ROLLBACK;
--
-- All fixtures (2 disposable tenants, disposable auth.users, disposable
-- tenant_memberships, disposable tenant_access_roles/
-- tenant_access_role_permissions rows) are created and torn down entirely
-- by the ROLLBACK. Nothing here touches a real tenant, user, membership,
-- or permission row. Tenant A's fixture deliberately replicates joint-x's
-- CURRENT live shape (owner/admin/member all granted '*') specifically so
-- the "member via wildcard" attack path (tests 9/10) can be exercised --
-- this is test-fixture data inside a transaction that always rolls back,
-- not a change to any real tenant's permissions.
--
-- Same lesson as the quote_approve_on_behalf rehearsal: privileged
-- fixture setup happens entirely before any role/JWT switch; a fresh
-- switch happens immediately before each call attributed to a disposable
-- identity; RESET ROLE before every post-call verification SELECT, since
-- tenant_access_audit_log has RLS enabled with ZERO policies (confirmed
-- live) -- as 'authenticated' it would always read back zero rows
-- regardless of actual content unless the role is reset first.

do $rehearsal_do$
declare
  v_tenant_a_id        uuid;
  v_tenant_b_id         uuid;
  v_owner1              uuid := gen_random_uuid();
  v_owner2              uuid := gen_random_uuid();
  v_admin1              uuid := gen_random_uuid();
  v_member1             uuid := gen_random_uuid();
  v_appadmin            uuid := gen_random_uuid();
  v_tenant_b_owner      uuid := gen_random_uuid();
  v_target_a_user       uuid := gen_random_uuid();  -- disposable auth.users
  v_target_b_user       uuid := gen_random_uuid();  -- rows for each target
  v_target_c_user       uuid := gen_random_uuid();  -- membership (required by
  v_target_d_user       uuid := gen_random_uuid();  -- tenant_memberships'
  v_target_e_user       uuid := gen_random_uuid();  -- auth_user_id FK -- a
  v_target_f_user       uuid := gen_random_uuid();  -- bare gen_random_uuid()
  v_target_cross_user   uuid := gen_random_uuid();  -- with no matching row
                                                     -- violates that FK.

  v_m_owner1            uuid;  -- tenant_memberships.id for each actor
  v_m_owner2            uuid;
  v_m_admin1            uuid;
  v_m_member1           uuid;
  v_m_target_a          uuid;  -- disposable target memberships, one per test
  v_m_target_b          uuid;
  v_m_target_c          uuid;
  v_m_target_d          uuid;
  v_m_target_e          uuid;
  v_m_target_f          uuid;
  v_m_target_cross      uuid;

  v_result              jsonb;
  v_row                 public.tenant_memberships;
  v_audit_count_before  int;
  v_audit_count_after   int;
  v_audit_row           public.tenant_access_audit_log;
begin
  -- ============================================================
  -- FIXTURE SETUP (privileged role throughout)
  -- ============================================================
  insert into public.tenants (slug, name, status)
  values ('rehearsal-slice1-a-' || substr(v_owner1::text,1,8), 'Rehearsal Slice1 Tenant A', 'active')
  returning id into v_tenant_a_id;

  insert into public.tenants (slug, name, status)
  values ('rehearsal-slice1-b-' || substr(v_owner1::text,1,8), 'Rehearsal Slice1 Tenant B', 'active')
  returning id into v_tenant_b_id;

  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_owner1,         'authenticated', 'authenticated', 'rehearsal-s1-owner1-'    || substr(v_owner1::text,1,8)    || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_owner2,         'authenticated', 'authenticated', 'rehearsal-s1-owner2-'    || substr(v_owner2::text,1,8)    || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_admin1,         'authenticated', 'authenticated', 'rehearsal-s1-admin1-'    || substr(v_admin1::text,1,8)    || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_member1,        'authenticated', 'authenticated', 'rehearsal-s1-member1-'   || substr(v_member1::text,1,8)   || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_appadmin,       'authenticated', 'authenticated', 'rehearsal-s1-appadmin-'  || substr(v_appadmin::text,1,8)  || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_tenant_b_owner,  'authenticated', 'authenticated', 'rehearsal-s1-tbowner-'   || substr(v_tenant_b_owner::text,1,8) || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  -- Disposable identities for each target membership -- required because
  -- tenant_memberships.auth_user_id has a foreign key to auth.users(id);
  -- a bare gen_random_uuid() with no matching row violates that FK.
  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_target_a_user,     'authenticated', 'authenticated', 'rehearsal-s1-target-a-'     || substr(v_target_a_user::text,1,8)     || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_target_b_user,     'authenticated', 'authenticated', 'rehearsal-s1-target-b-'     || substr(v_target_b_user::text,1,8)     || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_target_c_user,     'authenticated', 'authenticated', 'rehearsal-s1-target-c-'     || substr(v_target_c_user::text,1,8)     || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_target_d_user,     'authenticated', 'authenticated', 'rehearsal-s1-target-d-'     || substr(v_target_d_user::text,1,8)     || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_target_e_user,     'authenticated', 'authenticated', 'rehearsal-s1-target-e-'     || substr(v_target_e_user::text,1,8)     || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_target_f_user,     'authenticated', 'authenticated', 'rehearsal-s1-target-f-'     || substr(v_target_f_user::text,1,8)     || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_target_cross_user, 'authenticated', 'authenticated', 'rehearsal-s1-target-cross-' || substr(v_target_cross_user::text,1,8) || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  -- Tenant A role registry, mirroring joint-x exactly (owner/admin/member,
  -- all wildcard) so the "member via wildcard" path is genuinely reachable.
  insert into public.tenant_access_roles (tenant_id, role_key, name, rank, is_active) values
    (v_tenant_a_id, 'owner',  'Owner',  10, true),
    (v_tenant_a_id, 'admin',  'Admin',  20, true),
    (v_tenant_a_id, 'member', 'Member', 50, true),
    (v_tenant_a_id, 'staff',  'Staff',  50, true);

  insert into public.tenant_access_role_permissions (tenant_id, role_key, permission_key, allowed) values
    (v_tenant_a_id, 'owner',  '*', true),
    (v_tenant_a_id, 'admin',  '*', true),
    (v_tenant_a_id, 'member', '*', true),
    (v_tenant_a_id, 'staff',  '*', true);

  insert into public.tenant_access_roles (tenant_id, role_key, name, rank, is_active) values
    (v_tenant_b_id, 'owner', 'Owner', 10, true);
  insert into public.tenant_access_role_permissions (tenant_id, role_key, permission_key, allowed) values
    (v_tenant_b_id, 'owner', '*', true);

  -- public.users.role = 'admin' is what makes is_app_admin() true for the
  -- app-admin fixture (via current_user_app_role()) -- no tenant
  -- membership needed for that identity at all.
  insert into public.users (auth_user_id, user_email, full_name, role, is_active)
  values (v_appadmin, 'rehearsal-s1-appadmin-' || substr(v_appadmin::text,1,8) || '@example.test', 'Rehearsal App Admin', 'admin', true);

  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status) values
    (v_tenant_a_id, v_owner1,  'owner',  'active'),
    (v_tenant_a_id, v_owner2,  'owner',  'active'),
    (v_tenant_a_id, v_admin1,  'admin',  'active'),
    (v_tenant_a_id, v_member1, 'member', 'active'),
    (v_tenant_b_id, v_tenant_b_owner, 'owner', 'active');

  select id into v_m_owner1  from public.tenant_memberships where tenant_id=v_tenant_a_id and auth_user_id=v_owner1;
  select id into v_m_owner2  from public.tenant_memberships where tenant_id=v_tenant_a_id and auth_user_id=v_owner2;
  select id into v_m_admin1  from public.tenant_memberships where tenant_id=v_tenant_a_id and auth_user_id=v_admin1;
  select id into v_m_member1 from public.tenant_memberships where tenant_id=v_tenant_a_id and auth_user_id=v_member1;

  -- Disposable target memberships (fresh per test, so one test's mutation
  -- never changes another test's precondition) plus one in tenant B for
  -- the cross-tenant test. Each references its own disposable auth.users
  -- row inserted above (satisfying the FK -- see declaration comments).
  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values (v_tenant_a_id, v_target_a_user, 'member', 'active') returning id into v_m_target_a;
  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values (v_tenant_a_id, v_target_b_user, 'admin', 'active') returning id into v_m_target_b;
  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values (v_tenant_a_id, v_target_c_user, 'member', 'active') returning id into v_m_target_c;
  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values (v_tenant_a_id, v_target_d_user, 'admin', 'active') returning id into v_m_target_d;
  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values (v_tenant_a_id, v_target_e_user, 'member', 'active') returning id into v_m_target_e;
  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values (v_tenant_a_id, v_target_f_user, 'admin', 'active') returning id into v_m_target_f;
  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values (v_tenant_b_id, v_target_cross_user, 'member', 'active') returning id into v_m_target_cross;

  select count(*)::int into v_audit_count_before from public.tenant_access_audit_log;

  raise notice '--- fixtures ready: tenant_a=%, tenant_b=%, owner1_m=%, owner2_m=%, admin1_m=%, member1_m=% ---',
    v_tenant_a_id, v_tenant_b_id, v_m_owner1, v_m_owner2, v_m_admin1, v_m_member1;

  -- ============================================================
  -- TEST 1: owner changes member -> staff: succeeds
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner1, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select public.admin_set_workspace_member_role(v_m_target_a, 'staff') into v_result;
  if (v_result->>'ok')::boolean is distinct from true then
    raise exception 'TEST 1 FAILED: owner member->staff did not succeed: %', v_result;
  end if;
  execute 'reset role';
  select * into v_row from public.tenant_memberships where id = v_m_target_a;
  if v_row.tenant_role is distinct from 'staff' then
    raise exception 'TEST 1 FAILED: target role is not staff, got %', v_row.tenant_role;
  end if;
  raise notice 'TEST 1 passed: owner changed member -> staff';

  -- ============================================================
  -- TEST 2: owner changes admin -> member: succeeds
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner1, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select public.admin_set_workspace_member_role(v_m_target_b, 'member') into v_result;
  if (v_result->>'ok')::boolean is distinct from true then
    raise exception 'TEST 2 FAILED: owner admin->member did not succeed: %', v_result;
  end if;
  execute 'reset role';
  select * into v_row from public.tenant_memberships where id = v_m_target_b;
  if v_row.tenant_role is distinct from 'member' then
    raise exception 'TEST 2 FAILED: target role is not member, got %', v_row.tenant_role;
  end if;
  raise notice 'TEST 2 passed: owner changed admin -> member';

  -- ============================================================
  -- TEST 2b: owner promotes member -> admin: succeeds (owner has no
  -- ceiling against admin specifically, per the confirmed correction --
  -- only 'owner' itself is off-limits for a non-app-admin owner caller)
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner1, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select public.admin_set_workspace_member_role(v_m_target_e, 'admin') into v_result;
  if (v_result->>'ok')::boolean is distinct from true then
    raise exception 'TEST 2b FAILED: owner member->admin did not succeed: %', v_result;
  end if;
  execute 'reset role';
  select * into v_row from public.tenant_memberships where id = v_m_target_e;
  if v_row.tenant_role is distinct from 'admin' then
    raise exception 'TEST 2b FAILED: target role is not admin, got %', v_row.tenant_role;
  end if;
  raise notice 'TEST 2b passed: owner promoted member -> admin';

  -- ============================================================
  -- TEST 3 + 17: app-admin override succeeds where a plain admin/owner
  -- would be blocked (3a: demotes an owner while another owner still
  -- exists), THEN last-owner protection rejects app-admin demoting the
  -- sole remaining owner (3b), THEN app-admin promotes an existing admin
  -- straight to owner (3c, product-decision requirement: "app-admin can
  -- assign owner to another user if role registry allows it"). Proves
  -- the override in both directions and that guard 3 still applies to it.
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_appadmin, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select public.admin_set_workspace_member_role(v_m_owner2, 'admin') into v_result;
  if (v_result->>'ok')::boolean is distinct from true then
    raise exception 'TEST 3a FAILED: app-admin demoting owner2 (another owner remains) did not succeed: %', v_result;
  end if;
  raise notice 'TEST 3a passed: app-admin demoted owner2 -> admin (owner1 still owner)';

  begin
    perform public.admin_set_workspace_member_role(v_m_owner1, 'member');
    raise exception 'TEST 3b/17 FAILED: app-admin demoting the LAST owner was accepted';
  exception when others then
    if sqlerrm not like 'A workspace must keep at least one owner%' then
      raise exception 'TEST 3b/17 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 3b/17 passed: last-owner protection rejected app-admin too (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 3c: app-admin can assign 'owner' to another user if the role
  -- registry allows it -- promotes an existing admin target straight to
  -- owner, simultaneously proving app-admin can touch an admin-current-
  -- role target AND can assign the owner destination (still same
  -- app-admin identity/role context from the block above, no re-switch
  -- needed).
  -- ============================================================
  select public.admin_set_workspace_member_role(v_m_target_f, 'owner') into v_result;
  if (v_result->>'ok')::boolean is distinct from true then
    raise exception 'TEST 3c FAILED: app-admin admin->owner did not succeed: %', v_result;
  end if;
  execute 'reset role';
  select * into v_row from public.tenant_memberships where id = v_m_target_f;
  if v_row.tenant_role is distinct from 'owner' then
    raise exception 'TEST 3c FAILED: target role is not owner, got %', v_row.tenant_role;
  end if;
  raise notice 'TEST 3c passed: app-admin promoted admin -> owner';

  -- ============================================================
  -- TEST 4: owner attempts to modify own role: rejected (self-block)
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner1, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_set_workspace_member_role(v_m_owner1, 'admin');
    raise exception 'TEST 4 FAILED: owner self-role-change was accepted';
  exception when others then
    if sqlerrm not like 'You cannot change your own workspace role%' then
      raise exception 'TEST 4 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 4 passed: owner self-role-change rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 5: admin changes member -> staff: succeeds
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin1, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select public.admin_set_workspace_member_role(v_m_target_c, 'staff') into v_result;
  if (v_result->>'ok')::boolean is distinct from true then
    raise exception 'TEST 5 FAILED: admin member->staff did not succeed: %', v_result;
  end if;
  execute 'reset role';
  select * into v_row from public.tenant_memberships where id = v_m_target_c;
  if v_row.tenant_role is distinct from 'staff' then
    raise exception 'TEST 5 FAILED: target role is not staff, got %', v_row.tenant_role;
  end if;
  raise notice 'TEST 5 passed: admin changed member -> staff';

  -- ============================================================
  -- TEST 6: admin promotes member -> owner: rejected
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin1, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_set_workspace_member_role(v_m_target_c, 'owner');
    raise exception 'TEST 6 FAILED: admin promoting to owner was accepted';
  exception when others then
    if sqlerrm not like 'Only an app administrator can grant the owner role%' then
      raise exception 'TEST 6 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 6 passed: admin promote-to-owner rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 7: admin modifies owner: rejected
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin1, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_set_workspace_member_role(v_m_owner1, 'member');
    raise exception 'TEST 7 FAILED: admin modifying an owner was accepted';
  exception when others then
    if sqlerrm not like 'Only an app administrator can modify a workspace owner%' then
      raise exception 'TEST 7 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 7 passed: admin-modifies-owner rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 8: admin modifies own role: rejected (self-block)
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin1, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_set_workspace_member_role(v_m_admin1, 'member');
    raise exception 'TEST 8 FAILED: admin self-role-change was accepted';
  exception when others then
    if sqlerrm not like 'You cannot change your own workspace role%' then
      raise exception 'TEST 8 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 8 passed: admin self-role-change rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 8b: admin -> existing admin modification: rejected (admin's
  -- ceiling is strictly below admin; target_d's current role is 'admin')
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin1, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_set_workspace_member_role(v_m_target_d, 'member');
    raise exception 'TEST 8b FAILED: admin modifying another admin was accepted';
  exception when others then
    if sqlerrm not like 'An admin may only modify roles below admin%' then
      raise exception 'TEST 8b FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 8b passed: admin-modifies-admin rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 8c: admin promoting member -> admin: rejected (destination
  -- 'admin' is also off-limits for an admin caller, independent of the
  -- target's current role -- target_c is 'staff' at this point, below
  -- admin, so only the destination triggers this guard)
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin1, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_set_workspace_member_role(v_m_target_c, 'admin');
    raise exception 'TEST 8c FAILED: admin promoting to admin was accepted';
  exception when others then
    if sqlerrm not like 'An admin may only assign roles below admin%' then
      raise exception 'TEST 8c FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 8c passed: admin-promotes-to-admin rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 9: member with effective staff.manage via wildcard attempts
  -- member -> owner: rejected
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_member1, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_set_workspace_member_role(v_m_target_a, 'owner');
    raise exception 'TEST 9 FAILED: wildcard member promote-to-owner was accepted';
  exception when others then
    if sqlerrm not like 'Workspace role changes require owner or admin standing%' then
      raise exception 'TEST 9 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 9 passed: wildcard member rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 10: member attempts to change own role: rejected
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_member1, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_set_workspace_member_role(v_m_member1, 'admin');
    raise exception 'TEST 10 FAILED: member self-role-change was accepted';
  exception when others then
    if sqlerrm not like 'You cannot change your own workspace role%' then
      raise exception 'TEST 10 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 10 passed: member self-role-change rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 11: cross-tenant target mutation: rejected (pre-existing
  -- has_tenant_permission gate, not a new guard -- regression check)
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner1, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_set_workspace_member_role(v_m_target_cross, 'admin');
    raise exception 'TEST 11 FAILED: cross-tenant mutation was accepted';
  exception when others then
    if sqlerrm not like 'Workspace staff management access is required%' then
      raise exception 'TEST 11 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 11 passed: cross-tenant mutation rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 12: invalid destination role: rejected (pre-existing check)
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner1, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_set_workspace_member_role(v_m_target_a, 'bogus_role_xyz');
    raise exception 'TEST 12 FAILED: invalid destination role was accepted';
  exception when others then
    if sqlerrm not like 'That workspace role is not available%' then
      raise exception 'TEST 12 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 12 passed: invalid destination role rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 13: nonexistent target: rejected (pre-existing check)
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner1, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_set_workspace_member_role(gen_random_uuid(), 'member');
    raise exception 'TEST 13 FAILED: nonexistent target was accepted';
  exception when others then
    if sqlerrm not like 'Workspace member was not found%' then
      raise exception 'TEST 13 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 13 passed: nonexistent target rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 14/15: successful role change writes exactly one audit row,
  -- with correct actor/tenant/target/before/after/timestamp.
  -- ============================================================
  execute 'reset role';
  select count(*)::int into v_audit_count_after from public.tenant_access_audit_log;
  if v_audit_count_after - v_audit_count_before <> 6 then
    raise exception 'TEST 14 FAILED: expected exactly 6 successful-mutation audit rows (tests 1, 2, 2b, 3a, 3c, 5), got delta %', v_audit_count_after - v_audit_count_before;
  end if;
  -- The 6 successful mutations are tests 1, 2, 2b, 3a, 3c, 5 -- every
  -- other test (3b, 4, 6, 7, 8, 8b, 8c, 9, 10, 11, 12, 13) raises before
  -- reaching the insert, so none of them contribute. This assertion is
  -- intentionally exact; if this fires, recount successful tests above
  -- rather than loosen it.

  select * into v_audit_row
  from public.tenant_access_audit_log
  where membership_id = v_m_target_a
  order by created_at desc limit 1;

  if v_audit_row.id is null then
    raise exception 'TEST 15 FAILED: no audit row found for test 1''s mutation';
  end if;
  if v_audit_row.actor_auth_user_id is distinct from v_owner1 then
    raise exception 'TEST 15 FAILED: actor mismatch, expected %, got %', v_owner1, v_audit_row.actor_auth_user_id;
  end if;
  if v_audit_row.tenant_id is distinct from v_tenant_a_id then
    raise exception 'TEST 15 FAILED: tenant mismatch';
  end if;
  if v_audit_row.previous_role is distinct from 'member' or v_audit_row.new_role is distinct from 'staff' then
    raise exception 'TEST 15 FAILED: role transition mismatch, got % -> %', v_audit_row.previous_role, v_audit_row.new_role;
  end if;
  if v_audit_row.created_at is null then
    raise exception 'TEST 15 FAILED: created_at is null';
  end if;
  raise notice 'TEST 14/15 passed: audit row count and content correct';

  -- ============================================================
  -- TEST 16: rejected attempts write no audit row (spot-check against
  -- the cross-tenant target, which was never successfully touched)
  -- ============================================================
  if exists (select 1 from public.tenant_access_audit_log where membership_id = v_m_target_cross) then
    raise exception 'TEST 16 FAILED: a rejected attempt wrote an audit row for the cross-tenant target';
  end if;
  raise notice 'TEST 16 passed: no audit row for any rejected target';

  -- ============================================================
  -- TEST 18: no unrelated memberships changed (spot-check admin1/member1/
  -- tenant B owner, none of which were ever a successful target)
  -- ============================================================
  select * into v_row from public.tenant_memberships where id = v_m_admin1;
  if v_row.tenant_role is distinct from 'admin' then
    raise exception 'TEST 18 FAILED: admin1''s role changed unexpectedly, got %', v_row.tenant_role;
  end if;
  select * into v_row from public.tenant_memberships where id = v_m_member1;
  if v_row.tenant_role is distinct from 'member' then
    raise exception 'TEST 18 FAILED: member1''s role changed unexpectedly, got %', v_row.tenant_role;
  end if;
  select * into v_row from public.tenant_memberships where id = v_m_target_cross;
  if v_row.tenant_role is distinct from 'member' then
    raise exception 'TEST 18 FAILED: tenant B target''s role changed unexpectedly, got %', v_row.tenant_role;
  end if;
  raise notice 'TEST 18 passed: no unrelated membership changed';

  raise notice '=== ALL SLICE 1 REHEARSAL TESTS PASSED ===';
end;
$rehearsal_do$;
