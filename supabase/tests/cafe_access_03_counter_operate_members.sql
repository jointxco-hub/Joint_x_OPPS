-- CAFE-ACCESS-03: behavioral proof that a plain ACTIVE Cafe member holds
-- `cafe.counter.operate` and nothing else.
--
-- Run only against an isolated database containing the combined OPPS and Quick Solution
-- effective schema after applying, in order:
--   20260924232724_cafe_access_01_tenant_capability_operations.sql
--   20260926190000_cafe_access_02_counter_operate_capability.sql
--   20260926200000_cafe_access_03_counter_operate_members.sql
-- (the Cafe repo's local harness, supabase/tests/harness/run-local-sql-tests.ps1, does
-- exactly that on a throwaway PostgreSQL).
--
-- Fixtures are synthetic and enclosed by BEGIN/ROLLBACK. Every check runs under the real
-- `authenticated` API role with identity supplied only through JWT claims. Each expected
-- result is an EXACT true or false: a NULL (which an `IF NOT ...` guard would let
-- through) is a failure.

\set ON_ERROR_STOP on

begin;

-- ═════════ contracts: the two role lists, exactly ═════════
do $contracts$
declare
  v_helper regprocedure := to_regprocedure('public.has_tenant_capability(uuid,text)');
  v_definition text;
  v_names text[];
begin
  if v_helper is null then raise exception 'has_tenant_capability(uuid,text) must exist'; end if;
  v_definition := lower(pg_catalog.pg_get_functiondef(v_helper));

  -- Only the counter arm admits a plain member. The manage arm is still owner/admin.
  if position($$when 'cafe.operations.manage' then membership.tenant_role in ('owner', 'admin')$$ in v_definition) = 0 then
    raise exception 'cafe.operations.manage must still be exactly active owner/admin';
  end if;
  if position($$when 'cafe.counter.operate' then membership.tenant_role in ('owner', 'admin', 'member')$$ in v_definition) = 0 then
    raise exception 'cafe.counter.operate must admit active owner, admin and member';
  end if;
  -- 'member' appears exactly once in the body: in the counter arm and nowhere else.
  if (length(v_definition) - length(replace(v_definition, '''member''', ''))) / length('''member''') <> 1 then
    raise exception 'the role member may appear only in the counter arm';
  end if;

  select coalesce(array_agg(distinct m.g[1] order by m.g[1]), array[]::text[])
  into v_names
  from regexp_matches(v_definition, '''(cafe\.[a-z.]+)''', 'g') as m(g);
  if v_names is distinct from array['cafe.counter.operate', 'cafe.operations.manage'] then
    raise exception 'no other capability may exist: names must be exactly cafe.counter.operate and cafe.operations.manage, got %', v_names;
  end if;
  if v_definition ~ '(is_app_admin|is_opps_staff|can_access_tenant|tenant_capabilities)' then
    raise exception 'still membership-derived only: no app-admin or OPPS-staff bypass';
  end if;
  if v_definition !~ 'coalesce\(' then raise exception 'the result must never be NULL'; end if;

  -- posture and ACL unchanged
  if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_helper)
     or (select p.provolatile from pg_catalog.pg_proc p where p.oid = v_helper) <> 's'
     or not exists (
       select 1 from pg_catalog.pg_proc p, lateral pg_catalog.pg_options_to_table(p.proconfig) c
       where p.oid = v_helper and c.option_name = 'search_path' and btrim(c.option_value, chr(34)) = ''
     ) then
    raise exception 'SECURITY DEFINER, STABLE and an empty search_path must be unchanged';
  end if;
  if has_function_privilege('anon', v_helper, 'EXECUTE') or has_function_privilege('service_role', v_helper, 'EXECUTE')
     or not has_function_privilege('authenticated', v_helper, 'EXECUTE') then
    raise exception 'EXECUTE must stay authenticated-only';
  end if;
end
$contracts$;

-- ═════════ behavior ═════════
do $behavior$
declare
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_target uuid := gen_random_uuid();
  v_foreign uuid := gen_random_uuid();
  v_cafe uuid;                                   -- the real quick-solution tenant, for the admin-RPC checks
  v_target_slug text;

  u_member uuid := gen_random_uuid();
  u_member_b uuid := gen_random_uuid();          -- a second member (isolation, suspension)
  u_foreign_member uuid := gen_random_uuid();
  u_suspended_member uuid := gen_random_uuid();
  u_admin uuid := gen_random_uuid();
  u_owner uuid := gen_random_uuid();
  u_app_admin uuid := gen_random_uuid();
  u_opps_staff uuid := gen_random_uuid();
  u_cafe_member uuid := gen_random_uuid();       -- member of the real Cafe tenant
  u_promoted uuid := gen_random_uuid();

  v_cap text;
  v_got boolean;
  v_state text;
  v_message text;
  v_definition text;
begin
  v_target_slug := 'cafe-access-03-target-' || left(v_suffix, 12);
  select t.id into v_cafe from public.tenants t where t.slug = 'quick-solution' and t.status = 'active' limit 1;
  if v_cafe is null then raise exception 'CAFE_ACCESS_03_TEST_SETUP: the quick-solution tenant must exist'; end if;

  insert into public.tenants(id, slug, name, status, settings)
  values (v_target, v_target_slug, 'CAFE ACCESS 03 target', 'active', '{}'::jsonb),
         (v_foreign, 'cafe-access-03-foreign-' || right(v_suffix, 12), 'CAFE ACCESS 03 foreign', 'active', '{}'::jsonb);

  insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select u.id, 'authenticated', 'authenticated', 'cafe-access-03-' || u.label || '-' || v_suffix || '@disposable.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  from (values
    (u_member, 'member'), (u_member_b, 'memberb'), (u_foreign_member, 'foreignmember'), (u_suspended_member, 'suspendedmember'),
    (u_admin, 'admin'), (u_owner, 'owner'), (u_app_admin, 'appadmin'), (u_opps_staff, 'oppsstaff'),
    (u_cafe_member, 'cafemember'), (u_promoted, 'promoted')
  ) as u(id, label);

  -- SETUP-ONLY approved-owner claim (the real OPPS trigger allows a role='admin' users row only
  -- for an approved-owner JWT email); cleared straight after and asserted gone.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_app_admin, 'role', 'authenticated', 'email', 'jointx.co@gmail.com')::text, true);
  insert into public.users(auth_user_id, user_email, full_name, role, is_active)
  values (u_app_admin, 'cafe-access-03-appadmin-' || v_suffix || '@disposable.test', 'CAFE ACCESS 03 app admin', 'admin', true),
         (u_opps_staff, 'cafe-access-03-oppsstaff-' || v_suffix || '@disposable.test', 'CAFE ACCESS 03 OPPS staff', 'user', true);
  perform set_config('request.jwt.claims', '{}', true);
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> '' then
    raise exception 'CAFE_ACCESS_03_TEST_SETUP: the temporary approved-owner claim must be cleared';
  end if;

  insert into public.tenant_memberships(tenant_id, auth_user_id, tenant_role, status)
  values (v_target, u_member, 'member', 'active'),
         (v_target, u_member_b, 'member', 'active'),
         (v_target, u_suspended_member, 'member', 'suspended'),
         (v_foreign, u_foreign_member, 'member', 'active'),
         (v_target, u_admin, 'admin', 'active'),
         (v_target, u_owner, 'owner', 'active'),
         (v_cafe, u_cafe_member, 'member', 'active'),
         (v_target, u_promoted, 'member', 'active');

  execute 'set local role authenticated';

  -- ── 1. a plain active member: counter yes, manage NO ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_member, 'role', 'authenticated')::text, true);
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from true then
    raise exception 'CAFE_ACCESS_03: an active member must hold cafe.counter.operate';
  end if;
  if public.has_tenant_capability(v_target, 'cafe.operations.manage') is distinct from false then
    raise exception 'CAFE_ACCESS_03: the SAME member must still be denied cafe.operations.manage';
  end if;

  -- ── 2. no other capability becomes available to a member: exactly false, never NULL ──
  foreach v_cap in array array[
    'cafe.operations.manage', 'cafe.counter.manage', 'cafe.counter', 'cafe.counter.*', 'cafe.counter.operate ', ' cafe.counter.operate',
    'CAFE.COUNTER.OPERATE', 'cafe.counter.operate.extra', 'cafe.operations.operate', 'cafe.%', '%', '', 'unknown.capability',
    'app.admin', 'admin', 'owner', 'member', 'finance.read', 'finance.manage', 'products.manage', 'pricing.manage', 'catalogue.admin',
    'tenant.admin', 'users.manage', 'roles.manage', 'opps.access', 'production.manage', 'storefront.manage', 'deploy.manage'
  ] loop
    v_got := public.has_tenant_capability(v_target, v_cap);
    if v_got is distinct from false then
      raise exception 'CAFE_ACCESS_03: capability "%" must be exactly false for a member, got %', v_cap, v_got;
    end if;
  end loop;
  v_got := public.has_tenant_capability(v_target, null);
  if v_got is distinct from false then raise exception 'CAFE_ACCESS_03: a NULL capability must be exactly false for a member, got %', v_got; end if;
  v_got := public.has_tenant_capability(null, 'cafe.counter.operate');
  if v_got is distinct from false then raise exception 'CAFE_ACCESS_03: a NULL tenant must be exactly false for a member, got %', v_got; end if;

  -- ── 3. admin and owner keep both ──
  foreach v_state in array array[u_admin::text, u_owner::text] loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_state, 'role', 'authenticated')::text, true);
    if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from true
       or public.has_tenant_capability(v_target, 'cafe.operations.manage') is distinct from true then
      raise exception 'CAFE_ACCESS_03: admin and owner must hold both capabilities';
    end if;
  end loop;

  -- ── 4. tenant isolation: a member's authority is scoped to THEIR tenant ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_member, 'role', 'authenticated')::text, true);
  if public.has_tenant_capability(v_foreign, 'cafe.counter.operate') is distinct from false
     or public.has_tenant_capability(v_foreign, 'cafe.operations.manage') is distinct from false then
    raise exception 'CAFE_ACCESS_03: a member of tenant A must hold nothing in tenant B';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_foreign_member, 'role', 'authenticated')::text, true);
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from false
     or public.has_tenant_capability(v_target, 'cafe.operations.manage') is distinct from false then
    raise exception 'CAFE_ACCESS_03: a member of ANOTHER tenant must hold nothing in the target tenant';
  end if;
  if public.has_tenant_capability(v_foreign, 'cafe.counter.operate') is distinct from true then
    raise exception 'CAFE_ACCESS_03: positive control - that member does hold the counter capability in their own tenant';
  end if;

  -- ── 5. a suspended member holds nothing; suspension takes effect immediately ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_suspended_member, 'role', 'authenticated')::text, true);
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from false
     or public.has_tenant_capability(v_target, 'cafe.operations.manage') is distinct from false then
    raise exception 'CAFE_ACCESS_03: a suspended member must be denied';
  end if;
  execute 'reset role';
  update public.tenant_memberships set status = 'suspended' where tenant_id = v_target and auth_user_id = u_member_b;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_member_b, 'role', 'authenticated')::text, true);
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from false then
    raise exception 'CAFE_ACCESS_03: a member suspended a moment ago must lose the counter capability';
  end if;
  execute 'reset role';
  update public.tenant_memberships set status = 'active' where tenant_id = v_target and auth_user_id = u_member_b;
  execute 'set local role authenticated';
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from true then
    raise exception 'CAFE_ACCESS_03: re-activating the membership must restore the counter capability';
  end if;

  -- ── 6. an inactive or archived tenant denies even an active member ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_member, 'role', 'authenticated')::text, true);
  execute 'reset role';
  update public.tenants set status = 'suspended' where id = v_target;
  execute 'set local role authenticated';
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from false then
    raise exception 'CAFE_ACCESS_03: a member of a suspended tenant must be denied';
  end if;
  execute 'reset role';
  update public.tenants set status = 'archived' where id = v_target;
  execute 'set local role authenticated';
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from false then
    raise exception 'CAFE_ACCESS_03: a member of an archived tenant must be denied';
  end if;
  execute 'reset role';
  update public.tenants set status = 'active' where id = v_target;
  execute 'set local role authenticated';
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from true then
    raise exception 'CAFE_ACCESS_03: re-activating the tenant must restore the counter capability';
  end if;

  -- ── 7. app admin and OPPS staff WITHOUT a Cafe membership are still denied ──
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_app_admin, 'role', 'authenticated', 'email', 'jointx.co@gmail.com')::text, true);
  if public.is_app_admin() is distinct from true then raise exception 'CAFE_ACCESS_03_TEST_SETUP: the app-admin fixture must be an app admin'; end if;
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from false
     or public.has_tenant_capability(v_target, 'cafe.operations.manage') is distinct from false then
    raise exception 'CAFE_ACCESS_03: an app admin without a Cafe membership must be denied';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_opps_staff, 'role', 'authenticated')::text, true);
  if public.is_opps_staff() is distinct from true then raise exception 'CAFE_ACCESS_03_TEST_SETUP: the OPPS-staff fixture must be OPPS staff'; end if;
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from false
     or public.has_tenant_capability(v_target, 'cafe.operations.manage') is distinct from false then
    raise exception 'CAFE_ACCESS_03: OPPS staff without a Cafe membership must be denied';
  end if;

  -- ── 8. role changes move exactly the right capability ──
  execute 'reset role';
  update public.tenant_memberships set tenant_role = 'admin' where tenant_id = v_target and auth_user_id = u_promoted;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_promoted, 'role', 'authenticated')::text, true);
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from true
     or public.has_tenant_capability(v_target, 'cafe.operations.manage') is distinct from true then
    raise exception 'CAFE_ACCESS_03: a member promoted to admin must gain cafe.operations.manage and keep the counter';
  end if;
  execute 'reset role';
  update public.tenant_memberships set tenant_role = 'member' where tenant_id = v_target and auth_user_id = u_promoted;
  execute 'set local role authenticated';
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from true
     or public.has_tenant_capability(v_target, 'cafe.operations.manage') is distinct from false then
    raise exception 'CAFE_ACCESS_03: demoted back to member, manage must go and the counter must stay';
  end if;

  -- ── 9. holding the counter capability opens NOTHING else: the real Cafe admin RPCs still deny a member ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_cafe_member, 'role', 'authenticated')::text, true);
  if public.has_tenant_capability(v_cafe, 'cafe.counter.operate') is distinct from true
     or public.has_tenant_capability(v_cafe, 'cafe.operations.manage') is distinct from false then
    raise exception 'CAFE_ACCESS_03: the real Cafe tenant member must hold the counter capability and not manage';
  end if;
  if public.is_app_admin() is distinct from false or public.is_opps_staff() is distinct from false then
    raise exception 'CAFE_ACCESS_03: a Cafe member is not an app admin and not OPPS staff';
  end if;
  -- handoff queue (cafe.operations.manage)
  begin
    perform public.admin_list_quick_solution_opps_handoffs('quick-solution');
    raise exception 'CAFE_ACCESS_03: a member must not list OPPS handoffs';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state is distinct from '42501' or v_message <> 'You do not have access to Quick Solution handoffs.' then
      raise exception 'CAFE_ACCESS_03: handoff denial changed: % "%"', v_state, v_message;
    end if;
  end;
  -- product and pricing administration
  begin
    perform public.admin_update_quick_solution_product('quick-solution', 'scan', '{"name":"x"}'::jsonb, '{"strategy":"PER_UNIT","unitPrice":1,"minUnits":1,"maxUnits":5}'::jsonb, 'x');
    raise exception 'CAFE_ACCESS_03: a member must not edit products or prices';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state is distinct from '42501' then
      raise exception 'CAFE_ACCESS_03: product admin must deny a member with 42501, got % "%"', v_state, v_message;
    end if;
  end;
  begin
    perform public.admin_get_quick_solution_catalog('quick-solution');
    raise exception 'CAFE_ACCESS_03: a member must not read the staff-only catalogue (pricing definitions)';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state is distinct from '42501' then
      raise exception 'CAFE_ACCESS_03: the staff catalogue must deny a member with 42501, got % "%"', v_state, v_message;
    end if;
  end;
  execute 'reset role';
end
$behavior$;

rollback;

select 'CAFE-ACCESS-03 counter operate members contracts passed' as result;
