-- CAFE-ACCESS-02: behavioral proof of public.has_tenant_capability for the new capability
-- `cafe.counter.operate`, and a regression proof for `cafe.operations.manage`.
--
-- Run only against an isolated database containing the combined OPPS and Quick Solution
-- effective schema after applying, in order:
--   20260924232724_cafe_access_01_tenant_capability_operations.sql
--   20260926190000_cafe_access_02_counter_operate_capability.sql
-- and, since CAFE-ACCESS-03 makes plain members counter operators, also
--   20260926200000_cafe_access_03_counter_operate_members.sql
-- (the Cafe repo's local harness, supabase/tests/harness/run-local-sql-tests.ps1, does exactly
-- that on a throwaway PostgreSQL).
--
-- All fixtures are synthetic and enclosed by BEGIN/ROLLBACK. The checks run under the real
-- API roles (SET LOCAL ROLE authenticated / anon / service_role), so grants are exercised,
-- not just read from the catalog. Every expected result is an EXACT true or false: a NULL
-- (which an `IF NOT ...` guard would let through) is a failure.

\set ON_ERROR_STOP on

begin;

-- ═════════ contracts: shape, posture, ACL, exact capability names ═════════
do $contracts$
declare
  v_helper regprocedure := to_regprocedure('public.has_tenant_capability(uuid,text)');
  v_rpc regprocedure := to_regprocedure('public.admin_list_quick_solution_opps_handoffs(text)');
  v_definition text;
  v_names text[];
begin
  if v_helper is null then raise exception 'has_tenant_capability(uuid,text) must exist'; end if;
  if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_helper) then
    raise exception 'has_tenant_capability must be SECURITY DEFINER';
  end if;
  if (select p.provolatile from pg_catalog.pg_proc p where p.oid = v_helper) <> 's' then
    raise exception 'has_tenant_capability must be STABLE (it reads, never writes)';
  end if;
  if pg_catalog.pg_get_function_result(v_helper) <> 'boolean' then
    raise exception 'has_tenant_capability must return boolean';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_proc p, lateral pg_catalog.pg_options_to_table(p.proconfig) config
    where p.oid = v_helper and config.option_name = 'search_path' and btrim(config.option_value, chr(34)) = ''
  ) then
    raise exception 'has_tenant_capability must use an empty hardened search_path';
  end if;

  -- ACL: authenticated only. Never PUBLIC, anon or service_role.
  if exists (
    select 1
    from pg_catalog.pg_proc p, lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
    where p.oid = v_helper and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ) then raise exception 'has_tenant_capability must not grant EXECUTE to PUBLIC'; end if;
  if has_function_privilege('anon', v_helper, 'EXECUTE') then raise exception 'anon must not execute has_tenant_capability'; end if;
  if has_function_privilege('service_role', v_helper, 'EXECUTE') then raise exception 'service_role must not execute has_tenant_capability directly'; end if;
  if not has_function_privilege('authenticated', v_helper, 'EXECUTE') then raise exception 'authenticated must execute has_tenant_capability'; end if;

  -- The body: membership-derived only, with exactly the two capability names.
  v_definition := lower(pg_catalog.pg_get_functiondef(v_helper));
  if v_definition ~ '(is_app_admin|is_opps_staff|can_access_tenant|tenant_capabilities)' then
    raise exception 'has_tenant_capability must derive authority only from active tenant role membership';
  end if;
  select coalesce(array_agg(distinct m.g[1] order by m.g[1]), array[]::text[])
  into v_names
  from regexp_matches(v_definition, '''(cafe\.[a-z.]+)''', 'g') as m(g);
  if v_names is distinct from array['cafe.counter.operate', 'cafe.operations.manage'] then
    raise exception 'the capability names must be exactly cafe.counter.operate and cafe.operations.manage, got %', v_names;
  end if;
  if v_definition !~ 'coalesce\(' then
    raise exception 'the result must be wrapped so it can never be NULL';
  end if;

  -- The existing handoff RPC is unchanged in kind: it still requires cafe.operations.manage only.
  v_definition := lower(pg_catalog.pg_get_functiondef(v_rpc));
  if v_definition not like '%has_tenant_capability(v_tenant_id, ''cafe.operations.manage'')%' then
    raise exception 'admin_list_quick_solution_opps_handoffs must still require cafe.operations.manage';
  end if;
  if v_definition like '%cafe.counter.operate%' or v_definition ~ '(is_app_admin|is_opps_staff|can_access_tenant)' then
    raise exception 'the handoff RPC must not accept the counter capability, an app-admin bypass or an OPPS-staff bypass';
  end if;
end
$contracts$;

-- ═════════ behavior: every persona, both capabilities, real roles ═════════
do $behavior$
declare
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_target uuid := gen_random_uuid();
  v_foreign uuid := gen_random_uuid();
  v_joint_x uuid;
  v_target_slug text;
  v_foreign_slug text;

  u_nomember uuid := gen_random_uuid();
  u_suspended uuid := gen_random_uuid();
  u_foreign_owner uuid := gen_random_uuid();
  u_member uuid := gen_random_uuid();
  u_admin uuid := gen_random_uuid();
  u_owner uuid := gen_random_uuid();
  u_app_admin uuid := gen_random_uuid();
  u_opps_staff uuid := gen_random_uuid();
  u_opps_staff_member uuid := gen_random_uuid();
  u_email_only uuid := gen_random_uuid();      -- an approved-owner email claim, no rows at all
  u_attacker uuid := gen_random_uuid();

  v_labels text[]; v_subs uuid[]; v_emails text[]; v_tenants uuid[]; v_counter boolean[]; v_manage boolean[];
  i integer;
  v_got boolean;
  v_cap text;
  v_result jsonb;
  v_state text;
  v_message text;
begin
  v_target_slug := 'cafe-access-02-target-' || left(v_suffix, 12);
  v_foreign_slug := 'cafe-access-02-foreign-' || right(v_suffix, 12);

  select t.id into v_joint_x from public.tenants t where t.slug = 'joint-x' and t.status = 'active' limit 1;
  if v_joint_x is null then raise exception 'CAFE_ACCESS_02_TEST_SETUP: an active joint-x tenant is required'; end if;

  insert into public.tenants(id, slug, name, status, settings)
  values (v_target, v_target_slug, 'CAFE ACCESS 02 target', 'active', '{}'::jsonb),
         (v_foreign, v_foreign_slug, 'CAFE ACCESS 02 foreign', 'active', '{}'::jsonb);

  insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select u.id, 'authenticated', 'authenticated', 'cafe-access-02-' || u.label || '-' || v_suffix || '@disposable.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  from (values
    (u_nomember, 'nomember'), (u_suspended, 'suspended'), (u_foreign_owner, 'foreignowner'), (u_member, 'member'),
    (u_admin, 'admin'), (u_owner, 'owner'), (u_app_admin, 'appadmin'), (u_opps_staff, 'oppsstaff'),
    (u_opps_staff_member, 'oppsstaffmember'), (u_attacker, 'attacker')
  ) as u(id, label);

  -- SETUP-ONLY approved-owner claim, needed only because the real OPPS trigger lets a
  -- role='admin' users row be inserted solely for an approved-owner JWT email. It is cleared
  -- straight after the inserts and asserted gone before any authorization assertion.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_app_admin, 'role', 'authenticated', 'email', 'jointx.co@gmail.com')::text, true);
  insert into public.users(auth_user_id, user_email, full_name, role, is_active)
  values (u_app_admin, 'cafe-access-02-appadmin-' || v_suffix || '@disposable.test', 'CAFE ACCESS 02 app admin', 'admin', true),
         (u_opps_staff, 'cafe-access-02-oppsstaff-' || v_suffix || '@disposable.test', 'CAFE ACCESS 02 OPPS staff', 'user', true),
         (u_opps_staff_member, 'cafe-access-02-oppsstaffmember-' || v_suffix || '@disposable.test', 'CAFE ACCESS 02 OPPS staff member', 'user', true);
  perform set_config('request.jwt.claims', '{}', true);
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> '' then
    raise exception 'CAFE_ACCESS_02_TEST_SETUP: the temporary approved-owner claim must be cleared before any assertion';
  end if;

  insert into public.tenant_memberships(tenant_id, auth_user_id, tenant_role, status)
  values (v_target, u_suspended, 'owner', 'suspended'),
         (v_foreign, u_foreign_owner, 'owner', 'active'),
         (v_target, u_member, 'member', 'active'),
         (v_target, u_admin, 'admin', 'active'),
         (v_target, u_owner, 'owner', 'active'),
         (v_target, u_opps_staff_member, 'member', 'active');

  -- The tested property for the app admin and OPPS staff: NO qualifying membership in the target tenant.
  if exists (select 1 from public.tenant_memberships m where m.tenant_id = v_target and m.auth_user_id in (u_app_admin, u_opps_staff)) then
    raise exception 'CAFE_ACCESS_02_TEST_SETUP: the app-admin and OPPS-staff fixtures must have no target membership';
  end if;

  -- ── the persona matrix: (label, identity, JWT email, tenant asked about, counter?, manage?) ──
  v_labels := array[]::text[]; v_subs := array[]::uuid[]; v_emails := array[]::text[]; v_tenants := array[]::uuid[]; v_counter := array[]::boolean[]; v_manage := array[]::boolean[];
  -- Everything a case adds: label, sub, email, tenant, counter, manage.
  v_labels := v_labels || 'anonymous (no identity)'::text;                                   v_subs := v_subs || null::uuid;              v_emails := v_emails || null::text;                                         v_tenants := v_tenants || v_target;  v_counter := v_counter || false; v_manage := v_manage || false;
  v_labels := v_labels || 'authenticated non-staff, no membership anywhere'::text;           v_subs := v_subs || u_nomember;              v_emails := v_emails || null::text;                                         v_tenants := v_tenants || v_target;  v_counter := v_counter || false; v_manage := v_manage || false;
  v_labels := v_labels || 'suspended owner of the target tenant'::text;                      v_subs := v_subs || u_suspended;             v_emails := v_emails || null::text;                                         v_tenants := v_tenants || v_target;  v_counter := v_counter || false; v_manage := v_manage || false;
  v_labels := v_labels || 'owner of ANOTHER tenant, asking about the target'::text;          v_subs := v_subs || u_foreign_owner;         v_emails := v_emails || null::text;                                         v_tenants := v_tenants || v_target;  v_counter := v_counter || false; v_manage := v_manage || false;
  v_labels := v_labels || 'positive control: that owner asking about their own tenant'::text; v_subs := v_subs || u_foreign_owner;        v_emails := v_emails || null::text;                                         v_tenants := v_tenants || v_foreign; v_counter := v_counter || true;  v_manage := v_manage || true;
  v_labels := v_labels || 'target member (counter yes, manage no)'::text;         v_subs := v_subs || u_member;                v_emails := v_emails || null::text;                                         v_tenants := v_tenants || v_target;  v_counter := v_counter || true;  v_manage := v_manage || false;
  v_labels := v_labels || 'target member asking about another tenant'::text;                 v_subs := v_subs || u_member;                v_emails := v_emails || null::text;                                         v_tenants := v_tenants || v_foreign; v_counter := v_counter || false; v_manage := v_manage || false;
  v_labels := v_labels || 'target admin'::text;                                              v_subs := v_subs || u_admin;                 v_emails := v_emails || null::text;                                         v_tenants := v_tenants || v_target;  v_counter := v_counter || true;  v_manage := v_manage || true;
  v_labels := v_labels || 'target owner'::text;                                              v_subs := v_subs || u_owner;                 v_emails := v_emails || null::text;                                         v_tenants := v_tenants || v_target;  v_counter := v_counter || true;  v_manage := v_manage || true;
  v_labels := v_labels || 'target owner asking about another tenant (authority is not portable)'::text; v_subs := v_subs || u_owner;      v_emails := v_emails || null::text;                                         v_tenants := v_tenants || v_foreign; v_counter := v_counter || false; v_manage := v_manage || false;
  v_labels := v_labels || 'app admin (users.role admin) with no target membership'::text;    v_subs := v_subs || u_app_admin;             v_emails := v_emails || ('cafe-access-02-appadmin-' || v_suffix || '@disposable.test'); v_tenants := v_tenants || v_target; v_counter := v_counter || false; v_manage := v_manage || false;
  v_labels := v_labels || 'app admin AND an approved-owner email claim, no target membership'::text; v_subs := v_subs || u_app_admin;    v_emails := v_emails || 'jointx.co@gmail.com'::text;                              v_tenants := v_tenants || v_target;  v_counter := v_counter || false; v_manage := v_manage || false;
  v_labels := v_labels || 'approved-owner email claim alone (no user rows at all)'::text;    v_subs := v_subs || u_email_only;            v_emails := v_emails || 'jointx.co@gmail.com'::text;                              v_tenants := v_tenants || v_target;  v_counter := v_counter || false; v_manage := v_manage || false;
  v_labels := v_labels || 'OPPS staff (joint-x member) with no target membership'::text;     v_subs := v_subs || u_opps_staff;            v_emails := v_emails || ('cafe-access-02-oppsstaff-' || v_suffix || '@disposable.test'); v_tenants := v_tenants || v_target; v_counter := v_counter || false; v_manage := v_manage || false;
  v_labels := v_labels || 'OPPS staff plus a target member membership (counter yes, manage no)'::text;                v_subs := v_subs || u_opps_staff_member;     v_emails := v_emails || ('cafe-access-02-oppsstaffmember-' || v_suffix || '@disposable.test'); v_tenants := v_tenants || v_target; v_counter := v_counter || true;  v_manage := v_manage || false;
  v_labels := v_labels || 'target owner with a NULL tenant'::text;                           v_subs := v_subs || u_owner;                 v_emails := v_emails || null::text;                                         v_tenants := v_tenants || null::uuid; v_counter := v_counter || false; v_manage := v_manage || false;
  -- Documented, not endorsed: the primitive is tenant-scoped and not module-aware. An
  -- active admin of ANY active tenant holds the capability for THAT tenant (here: the app
  -- admin is also a Joint X admin member via the real OPPS trigger). A counter RPC must
  -- therefore resolve the Cafe tenant itself and never accept an arbitrary tenant.
  v_labels := v_labels || 'documented: a Joint X admin asking about the Joint X tenant itself'::text; v_subs := v_subs || u_app_admin;   v_emails := v_emails || ('cafe-access-02-appadmin-' || v_suffix || '@disposable.test'); v_tenants := v_tenants || v_joint_x; v_counter := v_counter || true;  v_manage := v_manage || true;

  -- Run every case AS the authenticated API role, with the identity supplied only through the JWT claims.
  execute 'set local role authenticated';
  for i in 1 .. array_length(v_labels, 1) loop
    perform set_config('request.jwt.claims',
      case when v_subs[i] is null then '{}'
           else jsonb_strip_nulls(jsonb_build_object('sub', v_subs[i], 'role', 'authenticated', 'email', v_emails[i]))::text end, true);
    v_got := public.has_tenant_capability(v_tenants[i], 'cafe.counter.operate');
    if v_got is distinct from v_counter[i] then
      raise exception 'CAFE_ACCESS_02: cafe.counter.operate for "%" expected % but got %', v_labels[i], v_counter[i], v_got;
    end if;
    v_got := public.has_tenant_capability(v_tenants[i], 'cafe.operations.manage');
    if v_got is distinct from v_manage[i] then
      raise exception 'CAFE_ACCESS_02: cafe.operations.manage (regression) for "%" expected % but got %', v_labels[i], v_manage[i], v_got;
    end if;
  end loop;

  -- ── unknown capabilities deny safely: exactly false, never NULL and never true ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  foreach v_cap in array array[
    'cafe.counter.operate ', ' cafe.counter.operate', 'CAFE.COUNTER.OPERATE', 'Cafe.Counter.Operate', 'cafe.counter', 'cafe.counter.*',
    'cafe.counter.operate.extra', 'cafe.counter.manage', 'cafe.operations.operate', 'cafe.operations.manage ', 'CAFE.OPERATIONS.MANAGE',
    'cafe.%', '%', '', 'unknown.capability', 'app.admin', 'finance.read', 'production.manage', 'storefront.manage', 'deploy.manage'
  ] loop
    v_got := public.has_tenant_capability(v_target, v_cap);
    if v_got is distinct from false then
      raise exception 'CAFE_ACCESS_02: unknown capability "%" must be exactly false for a qualifying owner, got %', v_cap, v_got;
    end if;
  end loop;
  -- The NULL capability is the dangerous one: NULL would slip through `IF NOT has_tenant_capability(...)`.
  v_got := public.has_tenant_capability(v_target, null);
  if v_got is distinct from false then
    raise exception 'CAFE_ACCESS_02: a NULL capability must be exactly false, got % (a NULL would defeat an IF NOT guard)', v_got;
  end if;
  execute 'reset role';

  -- ── the tenant itself must be active ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  update public.tenants set status = 'suspended' where id = v_target;
  execute 'set local role authenticated';
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from false
     or public.has_tenant_capability(v_target, 'cafe.operations.manage') is distinct from false then
    raise exception 'CAFE_ACCESS_02: a suspended tenant must deny even its owner';
  end if;
  execute 'reset role';
  update public.tenants set status = 'archived' where id = v_target;
  execute 'set local role authenticated';
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from false
     or public.has_tenant_capability(v_target, 'cafe.operations.manage') is distinct from false then
    raise exception 'CAFE_ACCESS_02: an archived tenant must deny even its owner';
  end if;
  execute 'reset role';
  update public.tenants set status = 'active' where id = v_target;

  -- ── a membership that becomes suspended stops granting authority immediately ──
  update public.tenant_memberships set status = 'suspended' where tenant_id = v_target and auth_user_id = u_admin;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from false then
    raise exception 'CAFE_ACCESS_02: a just-suspended admin must lose cafe.counter.operate';
  end if;
  execute 'reset role';
  update public.tenant_memberships set status = 'active' where tenant_id = v_target and auth_user_id = u_admin;

  -- ── role behavior: only the authenticated API role may even call it ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  foreach v_cap in array array['anon', 'service_role'] loop
    execute format('set local role %I', v_cap);
    begin
      perform public.has_tenant_capability(v_target, 'cafe.counter.operate');
      execute 'reset role';
      raise exception 'CAFE_ACCESS_02: the % role must not be able to execute has_tenant_capability', v_cap;
    exception when insufficient_privilege then
      execute 'reset role';
    end;
  end loop;
  execute 'set local role authenticated';
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from true then
    raise exception 'CAFE_ACCESS_02: authenticated must be able to execute it (owner control)';
  end if;
  execute 'reset role';

  -- ── search_path hijack: look-alike tables in an attacker-first schema change nothing ──
  create schema cafe_access_02_evil;
  create table cafe_access_02_evil.tenants (id uuid, slug text, name text, status text);
  create table cafe_access_02_evil.tenant_memberships (id uuid, tenant_id uuid, auth_user_id uuid, tenant_role text, status text);
  insert into cafe_access_02_evil.tenants values (v_target, v_target_slug, 'evil', 'active');
  insert into cafe_access_02_evil.tenant_memberships values (gen_random_uuid(), v_target, u_attacker, 'owner', 'active');
  grant usage on schema cafe_access_02_evil to authenticated;
  grant select on all tables in schema cafe_access_02_evil to authenticated;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_attacker, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform set_config('search_path', 'cafe_access_02_evil, public, pg_temp', true);
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from false
     or public.has_tenant_capability(v_target, 'cafe.operations.manage') is distinct from false then
    raise exception 'CAFE_ACCESS_02: a look-alike schema first in search_path must not grant capability';
  end if;
  perform set_config('search_path', '', true);
  execute 'reset role';
  perform set_config('search_path', '"$user", public', true);

  -- ── a stand-in for a FUTURE counter RPC: the gate is server-side, from the JWT alone ──
  create function public._cafe_access_02_probe_counter_rpc(p_tenant_slug text)
  returns text
  language plpgsql
  security definer
  set search_path = ''
  as $probe$
  declare
    v_tenant_id uuid;
  begin
    if auth.uid() is null then
      raise exception using errcode = '42501', message = 'Staff sign-in is required.';
    end if;
    select t.id into v_tenant_id from public.tenants t where t.slug = lower(trim(p_tenant_slug)) and t.status = 'active' limit 1;
    if v_tenant_id is null then
      raise exception using errcode = '22023', message = 'Quick Solution tenant was not found.';
    end if;
    if not public.has_tenant_capability(v_tenant_id, 'cafe.counter.operate') then
      raise exception using errcode = '42501', message = 'Counter access is required.';
    end if;
    return 'counter-ok';
  end
  $probe$;
  revoke all on function public._cafe_access_02_probe_counter_rpc(text) from public, anon, authenticated, service_role;
  grant execute on function public._cafe_access_02_probe_counter_rpc(text) to authenticated;

  execute 'set local role authenticated';
  -- authorized: owner, admin and (CAFE-ACCESS-03) plain member of the target tenant
  foreach v_state in array array[u_owner::text, u_admin::text, u_member::text, u_opps_staff_member::text] loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_state, 'role', 'authenticated')::text, true);
    if public._cafe_access_02_probe_counter_rpc(v_target_slug) is distinct from 'counter-ok' then
      raise exception 'CAFE_ACCESS_02: the probe counter RPC must admit an active owner, admin or member';
    end if;
  end loop;
  -- denied, each with the RPC's own exact error: no identity, no membership, suspended owner, foreign owner, app admin, OPPS staff without a Cafe membership
  for i in 1 .. 6 loop
    perform set_config('request.jwt.claims',
      case i when 1 then '{}'
            when 2 then jsonb_build_object('sub', u_nomember, 'role', 'authenticated')::text
            when 3 then jsonb_build_object('sub', u_suspended, 'role', 'authenticated')::text
            when 4 then jsonb_build_object('sub', u_foreign_owner, 'role', 'authenticated')::text
            when 5 then jsonb_build_object('sub', u_app_admin, 'role', 'authenticated', 'email', 'jointx.co@gmail.com')::text
            else jsonb_build_object('sub', u_opps_staff, 'role', 'authenticated')::text end, true);
    begin
      perform public._cafe_access_02_probe_counter_rpc(v_target_slug);
      raise exception 'CAFE_ACCESS_02: probe case % unexpectedly succeeded', i;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
      if v_state is distinct from '42501' or v_message not in ('Staff sign-in is required.', 'Counter access is required.') then
        raise exception 'CAFE_ACCESS_02: probe case % expected the RPC''s own 42501 denial, got % "%"', i, v_state, v_message;
      end if;
      if i = 1 and v_message <> 'Staff sign-in is required.' then raise exception 'CAFE_ACCESS_02: anonymous must be told to sign in'; end if;
      if i > 1 and v_message <> 'Counter access is required.' then raise exception 'CAFE_ACCESS_02: probe case % must be denied by the capability check, got "%"', i, v_message; end if;
    end;
  end loop;
  -- the wrong tenant: an owner of the target cannot operate the foreign tenant's counter
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  begin
    perform public._cafe_access_02_probe_counter_rpc(v_foreign_slug);
    raise exception 'CAFE_ACCESS_02: an owner of tenant A must not pass the gate for tenant B';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state is distinct from '42501' or v_message <> 'Counter access is required.' then
      raise exception 'CAFE_ACCESS_02: wrong-tenant denial expected the capability error, got % "%"', v_state, v_message;
    end if;
  end;
  execute 'reset role';
  -- anon cannot even reach the RPC (its ACL denies it)
  execute 'set local role anon';
  begin
    perform public._cafe_access_02_probe_counter_rpc(v_target_slug);
    execute 'reset role';
    raise exception 'CAFE_ACCESS_02: anon must not execute a counter RPC';
  exception when insufficient_privilege then
    execute 'reset role';
  end;

  -- ── regression: the existing handoff RPC behaves as CAFE-ACCESS-01 pinned it ──
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  v_result := public.admin_list_quick_solution_opps_handoffs(v_target_slug);
  if jsonb_typeof(v_result) <> 'array' then raise exception 'CAFE_ACCESS_02: the handoff list must still return a jsonb array for an owner'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_member, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_list_quick_solution_opps_handoffs(v_target_slug);
    raise exception 'CAFE_ACCESS_02: a member must still be denied the handoff list';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state is distinct from '42501' or v_message <> 'You do not have access to Quick Solution handoffs.' then
      raise exception 'CAFE_ACCESS_02: handoff denial changed: % "%"', v_state, v_message;
    end if;
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_app_admin, 'role', 'authenticated', 'email', 'jointx.co@gmail.com')::text, true);
  begin
    perform public.admin_list_quick_solution_opps_handoffs(v_target_slug);
    raise exception 'CAFE_ACCESS_02: an app admin without target membership must still be denied the handoff list';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state is distinct from '42501' or v_message <> 'You do not have access to Quick Solution handoffs.' then
      raise exception 'CAFE_ACCESS_02: handoff app-admin denial changed: % "%"', v_state, v_message;
    end if;
  end;
  execute 'reset role';
end
$behavior$;

rollback;

select 'CAFE-ACCESS-02 counter operate capability contracts passed' as result;
