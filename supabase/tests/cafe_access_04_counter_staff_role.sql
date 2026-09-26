-- CAFE-ACCESS-04: behavioral proof that an active `counter_staff` membership holds `cafe.counter.operate` and
-- NOT `cafe.operations.manage`, and that every fail-closed property of public.has_tenant_capability is intact.
--
-- Run only against an isolated database containing the combined OPPS and Quick Solution effective schema after
-- applying, in order, CAFE-ACCESS-01, -02, -03 and
--   20260926205000_cafe_access_04_counter_staff_role.sql
-- (the Cafe repo's local harness, supabase/tests/harness/run-local-sql-tests.ps1, does exactly that on a
-- throwaway PostgreSQL). All fixtures are synthetic and enclosed by BEGIN/ROLLBACK. The checks run under the
-- real API roles (SET LOCAL ROLE authenticated / anon / service_role), so grants are exercised, not just read
-- from the catalog. Every expected result is an EXACT true or false: a NULL (which an `IF NOT ...` guard would
-- let through) is a failure.
--
-- The hosted workspace's tenant_memberships.tenant_role already admits `counter_staff` (and staff, manager,
-- production_staff, finance, partner_viewer). A minimal local stand-in for the OPPS base schema may not, so
-- this test - only inside its own rolled-back transaction, and only when the constraint does not already
-- admit counter_staff - widens the role check to that hosted list before creating fixtures.

\set ON_ERROR_STOP on

begin;

-- ═════════ contracts: the two role lists, exactly; posture and ACL unchanged ═════════
do $contracts$
declare
  v_helper regprocedure := to_regprocedure('public.has_tenant_capability(uuid,text)');
  v_definition text;
  v_names text[];
begin
  if v_helper is null then raise exception 'has_tenant_capability(uuid,text) must exist'; end if;
  v_definition := lower(pg_catalog.pg_get_functiondef(v_helper));

  if position($$when 'cafe.operations.manage' then membership.tenant_role in ('owner', 'admin')$$ in v_definition) = 0 then
    raise exception 'cafe.operations.manage must still be exactly active owner/admin';
  end if;
  if position($$when 'cafe.counter.operate' then membership.tenant_role in ('owner', 'admin', 'member', 'counter_staff')$$ in v_definition) = 0 then
    raise exception 'cafe.counter.operate must admit active owner, admin, member and counter_staff, exactly';
  end if;
  -- counter_staff and member each appear exactly once in the body: in the counter arm and nowhere else.
  if (length(v_definition) - length(replace(v_definition, '''counter_staff''', ''))) / length('''counter_staff''') <> 1 then
    raise exception 'the role counter_staff may appear only in the counter arm';
  end if;
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
  if v_definition !~ 'coalesce\(' then raise exception 'the result must be wrapped so it can never be NULL'; end if;
  if v_definition !~ 'membership\.status = ''active''' or v_definition !~ 'tenant\.status = ''active''' or v_definition !~ 'membership\.tenant_id = p_tenant_id'
     or v_definition !~ 'membership\.auth_user_id = auth\.uid\(\)' then
    raise exception 'authority must still come only from an ACTIVE membership of THE asked, ACTIVE tenant, for the caller';
  end if;

  if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_helper) then raise exception 'must stay SECURITY DEFINER'; end if;
  if (select p.provolatile from pg_catalog.pg_proc p where p.oid = v_helper) <> 's' then raise exception 'must stay STABLE'; end if;
  if not exists (select 1 from pg_catalog.pg_proc p, lateral pg_catalog.pg_options_to_table(p.proconfig) c
                 where p.oid = v_helper and c.option_name = 'search_path' and btrim(c.option_value, chr(34)) = '') then
    raise exception 'must keep an empty hardened search_path';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p, lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
             where p.oid = v_helper and acl.grantee = 0 and acl.privilege_type = 'EXECUTE') then
    raise exception 'must not grant EXECUTE to PUBLIC';
  end if;
  if has_function_privilege('anon', v_helper, 'EXECUTE') or has_function_privilege('service_role', v_helper, 'EXECUTE')
     or not has_function_privilege('authenticated', v_helper, 'EXECUTE') then
    raise exception 'EXECUTE for authenticated only';
  end if;
end
$contracts$;

-- ═════════ behavior ═════════
do $behavior$
declare
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_target uuid := gen_random_uuid();
  v_foreign uuid := gen_random_uuid();
  v_cafe uuid;

  u_cs uuid := gen_random_uuid();               -- active counter_staff of the target tenant
  u_cs_suspended uuid := gen_random_uuid();     -- suspended counter_staff of the target tenant
  u_cs_foreign uuid := gen_random_uuid();       -- active counter_staff of the FOREIGN tenant only
  u_cs_cafe uuid := gen_random_uuid();          -- active counter_staff of the real quick-solution tenant
  u_member uuid := gen_random_uuid();
  u_admin uuid := gen_random_uuid();
  u_owner uuid := gen_random_uuid();
  u_other uuid := gen_random_uuid();            -- one user reused for every other role
  u_nomember uuid := gen_random_uuid();
  u_app_admin uuid := gen_random_uuid();
  u_opps_staff uuid := gen_random_uuid();

  v_role text;
  v_cap text;
  v_status text;
  v_message text;
  v_state text;
begin
  -- The hosted role list; widen the stand-in constraint only if it does not already admit counter_staff.
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.tenant_memberships'::regclass and c.contype = 'c' and pg_catalog.pg_get_constraintdef(c.oid) like '%counter_staff%'
  ) then
    for v_cap in select c.conname from pg_catalog.pg_constraint c
                 where c.conrelid = 'public.tenant_memberships'::regclass and c.contype = 'c' and pg_catalog.pg_get_constraintdef(c.oid) like '%tenant_role%' loop
      execute format('alter table public.tenant_memberships drop constraint %I', v_cap);
    end loop;
    alter table public.tenant_memberships add constraint tenant_memberships_tenant_role_check
      check (tenant_role in ('owner', 'admin', 'member', 'staff', 'manager', 'counter_staff', 'production_staff', 'finance', 'partner_viewer'));
  end if;

  select t.id into v_cafe from public.tenants t where t.slug = 'quick-solution' and t.status = 'active' limit 1;
  if v_cafe is null then raise exception 'CAFE_ACCESS_04_TEST_SETUP: the quick-solution tenant must exist'; end if;

  insert into public.tenants(id, slug, name, status, settings)
  values (v_target, 'cafe-access-04-target-' || right(v_suffix, 12), 'CAFE ACCESS 04 target', 'active', '{}'::jsonb),
         (v_foreign, 'cafe-access-04-foreign-' || right(v_suffix, 12), 'CAFE ACCESS 04 foreign', 'active', '{}'::jsonb);

  insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select u.id, 'authenticated', 'authenticated', 'cafe-access-04-' || u.label || '-' || v_suffix || '@disposable.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  from (values
    (u_cs, 'cs'), (u_cs_suspended, 'cssuspended'), (u_cs_foreign, 'csforeign'), (u_cs_cafe, 'cscafe'), (u_member, 'member'), (u_admin, 'admin'),
    (u_owner, 'owner'), (u_other, 'other'), (u_nomember, 'nomember'), (u_app_admin, 'appadmin'), (u_opps_staff, 'oppsstaff')
  ) as u(id, label);

  -- SETUP-ONLY approved-owner claim (the real OPPS trigger allows a role='admin' users row only for an approved-owner
  -- JWT email); cleared straight after and asserted gone.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_app_admin, 'role', 'authenticated', 'email', 'jointx.co@gmail.com')::text, true);
  insert into public.users(auth_user_id, user_email, full_name, role, is_active)
  values (u_app_admin, 'cafe-access-04-appadmin-' || v_suffix || '@disposable.test', 'CAFE ACCESS 04 app admin', 'admin', true),
         (u_opps_staff, 'cafe-access-04-oppsstaff-' || v_suffix || '@disposable.test', 'CAFE ACCESS 04 OPPS staff', 'user', true);
  perform set_config('request.jwt.claims', '{}', true);
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> '' then
    raise exception 'CAFE_ACCESS_04_TEST_SETUP: the temporary approved-owner claim must be cleared';
  end if;

  insert into public.tenant_memberships(tenant_id, auth_user_id, tenant_role, status)
  values (v_target, u_cs, 'counter_staff', 'active'),
         (v_target, u_cs_suspended, 'counter_staff', 'suspended'),
         (v_foreign, u_cs_foreign, 'counter_staff', 'active'),
         (v_cafe, u_cs_cafe, 'counter_staff', 'active'),
         (v_target, u_member, 'member', 'active'),
         (v_target, u_admin, 'admin', 'active'),
         (v_target, u_owner, 'owner', 'active'),
         (v_target, u_other, 'finance', 'active');
  if exists (select 1 from public.tenant_memberships m where m.tenant_id in (v_target, v_foreign, v_cafe) and m.auth_user_id in (u_app_admin, u_opps_staff, u_nomember)) then
    raise exception 'CAFE_ACCESS_04_TEST_SETUP: the app-admin, OPPS-staff and no-membership fixtures must have no membership';
  end if;

  execute 'set local role authenticated';

  -- ── 1. an active counter_staff: counter YES, manage NO (exact) ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_cs, 'role', 'authenticated')::text, true);
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from true then
    raise exception 'CAFE_ACCESS_04: an active counter_staff must hold cafe.counter.operate';
  end if;
  if public.has_tenant_capability(v_target, 'cafe.operations.manage') is distinct from false then
    raise exception 'CAFE_ACCESS_04: an active counter_staff must NOT hold cafe.operations.manage (exactly false, never NULL)';
  end if;

  -- ── 2. that counter_staff gets nothing else: exactly false for every other, padded, mis-cased, NULL or empty capability ──
  foreach v_cap in array array[
    'cafe.counter.manage', 'cafe.counter', 'cafe.counter.*', 'cafe.counter.operate ', ' cafe.counter.operate', 'CAFE.COUNTER.OPERATE',
    'cafe.counter.operate.extra', 'cafe.operations.operate', 'cafe.operations.manage ', ' cafe.operations.manage', 'CAFE.OPERATIONS.MANAGE',
    'cafe.%', '%', '', 'unknown.capability', 'app.admin', 'admin', 'owner', 'member', 'counter_staff', 'finance.read', 'finance.manage',
    'products.manage', 'pricing.manage', 'users.manage', 'roles.manage', 'opps.access', 'production.manage', 'deploy.manage'
  ] loop
    if public.has_tenant_capability(v_target, v_cap) is distinct from false then
      raise exception 'CAFE_ACCESS_04: counter_staff must get exactly false for capability "%"', v_cap;
    end if;
  end loop;
  if public.has_tenant_capability(v_target, null) is distinct from false then raise exception 'CAFE_ACCESS_04: a NULL capability is exactly false'; end if;
  if public.has_tenant_capability(null, 'cafe.counter.operate') is distinct from false then raise exception 'CAFE_ACCESS_04: a NULL tenant is exactly false'; end if;
  if public.has_tenant_capability(null, null) is distinct from false then raise exception 'CAFE_ACCESS_04: NULL and NULL is exactly false'; end if;

  -- ── 3. the manage-only admin RPC still refuses counter_staff (the real quick-solution tenant) ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_cs_cafe, 'role', 'authenticated')::text, true);
  if public.has_tenant_capability(v_cafe, 'cafe.counter.operate') is distinct from true
     or public.has_tenant_capability(v_cafe, 'cafe.operations.manage') is distinct from false then
    raise exception 'CAFE_ACCESS_04: counter_staff of the quick-solution tenant: counter yes, manage no';
  end if;
  begin
    perform public.admin_list_quick_solution_opps_handoffs('quick-solution');
    raise exception 'CAFE_ACCESS_04: counter_staff must not list handoffs (cafe.operations.manage)';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state <> '42501' or v_message <> 'You do not have access to Quick Solution handoffs.' then raise; end if;
  end;

  -- ── 4. a SUSPENDED counter_staff gets neither ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_cs_suspended, 'role', 'authenticated')::text, true);
  foreach v_cap in array array['cafe.counter.operate', 'cafe.operations.manage'] loop
    if public.has_tenant_capability(v_target, v_cap) is distinct from false then
      raise exception 'CAFE_ACCESS_04: a suspended counter_staff must be denied % (exactly false)', v_cap;
    end if;
  end loop;

  -- ── 5. a CROSS-TENANT counter_staff gets neither for the tenant they do not belong to ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_cs_foreign, 'role', 'authenticated')::text, true);
  foreach v_cap in array array['cafe.counter.operate', 'cafe.operations.manage'] loop
    if public.has_tenant_capability(v_target, v_cap) is distinct from false then
      raise exception 'CAFE_ACCESS_04: a counter_staff of ANOTHER tenant must be denied % on the target (exactly false)', v_cap;
    end if;
    if public.has_tenant_capability(v_cafe, v_cap) is distinct from false then
      raise exception 'CAFE_ACCESS_04: a counter_staff of ANOTHER tenant must be denied % on the Cafe (exactly false)', v_cap;
    end if;
  end loop;
  -- their own tenant works as designed: counter yes, manage no
  if public.has_tenant_capability(v_foreign, 'cafe.counter.operate') is distinct from true
     or public.has_tenant_capability(v_foreign, 'cafe.operations.manage') is distinct from false then
    raise exception 'CAFE_ACCESS_04: the foreign counter_staff holds counter (not manage) in THEIR OWN tenant only';
  end if;
  -- and the target's counter_staff has nothing in the foreign tenant
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_cs, 'role', 'authenticated')::text, true);
  foreach v_cap in array array['cafe.counter.operate', 'cafe.operations.manage'] loop
    if public.has_tenant_capability(v_foreign, v_cap) is distinct from false then
      raise exception 'CAFE_ACCESS_04: the target counter_staff must be denied % in the foreign tenant', v_cap;
    end if;
  end loop;

  -- ── 6. regression: every other persona is exactly as before ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_member, 'role', 'authenticated')::text, true);
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from true or public.has_tenant_capability(v_target, 'cafe.operations.manage') is distinct from false then
    raise exception 'CAFE_ACCESS_04: an active member is unchanged (counter yes, manage no)';
  end if;
  foreach v_role in array array['admin', 'owner'] loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', case v_role when 'admin' then u_admin else u_owner end, 'role', 'authenticated')::text, true);
    if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from true or public.has_tenant_capability(v_target, 'cafe.operations.manage') is distinct from true then
      raise exception 'CAFE_ACCESS_04: an active % is unchanged (counter yes, manage yes)', v_role;
    end if;
  end loop;
  -- a role that is not in either list gets neither (finance here)
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from false or public.has_tenant_capability(v_target, 'cafe.operations.manage') is distinct from false then
    raise exception 'CAFE_ACCESS_04: a finance role gets neither capability';
  end if;
  -- an app admin (approved-owner email) and an OPPS staff member with NO membership: denied both
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_app_admin, 'role', 'authenticated', 'email', 'jointx.co@gmail.com')::text, true);
  foreach v_cap in array array['cafe.counter.operate', 'cafe.operations.manage'] loop
    if public.has_tenant_capability(v_target, v_cap) is distinct from false or public.has_tenant_capability(v_cafe, v_cap) is distinct from false then
      raise exception 'CAFE_ACCESS_04: an app admin with no membership must be denied % (no bypass)', v_cap;
    end if;
  end loop;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_opps_staff, 'role', 'authenticated')::text, true);
  foreach v_cap in array array['cafe.counter.operate', 'cafe.operations.manage'] loop
    if public.has_tenant_capability(v_target, v_cap) is distinct from false or public.has_tenant_capability(v_cafe, v_cap) is distinct from false then
      raise exception 'CAFE_ACCESS_04: OPPS staff with no membership must be denied % (no bypass)', v_cap;
    end if;
  end loop;
  -- a signed-in user with no membership, and a caller with no identity at all
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_nomember, 'role', 'authenticated')::text, true);
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from false or public.has_tenant_capability(v_target, 'cafe.operations.manage') is distinct from false then
    raise exception 'CAFE_ACCESS_04: a non-member is denied both';
  end if;
  perform set_config('request.jwt.claims', '{}', true);
  foreach v_cap in array array['cafe.counter.operate', 'cafe.operations.manage'] loop
    if public.has_tenant_capability(v_target, v_cap) is distinct from false then
      raise exception 'CAFE_ACCESS_04: no identity (no auth.uid()) is exactly false for %', v_cap;
    end if;
  end loop;

  -- ── 7. live changes take effect at once: role change, suspension, tenant status ──
  execute 'reset role';
  update public.tenant_memberships set tenant_role = 'finance' where tenant_id = v_target and auth_user_id = u_cs;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_cs, 'role', 'authenticated')::text, true);
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from false then
    raise exception 'CAFE_ACCESS_04: a counter_staff changed to another role loses counter access immediately';
  end if;
  execute 'reset role';
  update public.tenant_memberships set tenant_role = 'counter_staff' where tenant_id = v_target and auth_user_id = u_cs;
  update public.tenant_memberships set status = 'suspended' where tenant_id = v_target and auth_user_id = u_cs;
  execute 'set local role authenticated';
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from false then
    raise exception 'CAFE_ACCESS_04: a just-suspended counter_staff is denied immediately';
  end if;
  execute 'reset role';
  update public.tenant_memberships set status = 'active' where tenant_id = v_target and auth_user_id = u_cs;
  foreach v_status in array array['suspended', 'archived'] loop
    update public.tenants set status = v_status where id = v_target;
    execute 'set local role authenticated';
    foreach v_cap in array array['cafe.counter.operate', 'cafe.operations.manage'] loop
      if public.has_tenant_capability(v_target, v_cap) is distinct from false then
        raise exception 'CAFE_ACCESS_04: a % tenant fails closed for % (counter_staff)', v_status, v_cap;
      end if;
    end loop;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u_member, 'role', 'authenticated')::text, true);
    if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from false then
      raise exception 'CAFE_ACCESS_04: a % tenant fails closed for a member too', v_status;
    end if;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u_cs, 'role', 'authenticated')::text, true);
    execute 'reset role';
  end loop;
  update public.tenants set status = 'active' where id = v_target;
  execute 'set local role authenticated';
  if public.has_tenant_capability(v_target, 'cafe.counter.operate') is distinct from true then
    raise exception 'CAFE_ACCESS_04: reactivating the tenant restores the counter_staff counter access';
  end if;

  -- ── 8. API roles: anon and service_role cannot call the primitive at all ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_cs, 'role', 'authenticated')::text, true);
  execute 'reset role';
  foreach v_role in array array['anon', 'service_role'] loop
    execute format('set local role %I', v_role);
    begin
      perform public.has_tenant_capability(v_target, 'cafe.counter.operate');
      raise exception 'CAFE_ACCESS_04: % must not be able to execute has_tenant_capability', v_role;
    exception when insufficient_privilege then
      null;
    end;
    execute 'reset role';
  end loop;
end
$behavior$;

rollback;
select 'CAFE-ACCESS-04 counter_staff role contracts passed' as result;
