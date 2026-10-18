-- Canonical Price Resolution v1 -- REHEARSAL SCRIPT
--
-- Run inside BEGIN ... ROLLBACK against production. Assemble as:
--   BEGIN;
--   <preflight: confirm current live baseline for the touched/reused functions>
--   <full contents of supabase/migrations/20261003090000_canonical_price_resolution_v1.sql>
--   <this file>
--   ROLLBACK;
--
-- Every fixture here is wholly disposable EXCEPT one identity, which is a
-- disposable auth.users + tenant_memberships row layered onto the REAL,
-- live joint-x tenant_id -- same proven-safe pattern used by the RBAC
-- Slice 2 rehearsal (read/write only inside this transaction, entirely
-- undone by ROLLBACK, never touching any real joint-x member's own row).
-- This is needed specifically for test 18, which the brief phrases in
-- terms of "joint-x staff" -- is_opps_staff()'s joint-x branch only
-- triggers for the real tenant whose slug is literally 'joint-x'. No
-- real client_product, product_component, or any other real row is ever
-- read, written, or depended on by this script -- the two real rows
-- referenced in the migration's own header comment (for the
-- computed_unit_price derivation proof) were verified separately,
-- read-only, before this file was written, and are not re-touched here.
--
-- Same lesson as prior rehearsals: privileged fixture setup happens
-- entirely before any role/JWT switch; a fresh switch happens
-- immediately before each call attributed to a disposable identity;
-- RESET ROLE before every post-call verification SELECT.

do $rehearsal_do$
declare
  v_joint_x_id      uuid := '6d371f51-274c-4b49-8d59-2aeaf5e89088';
  v_staff_jx        uuid := gen_random_uuid();  -- disposable, layered onto real joint-x

  v_tenant_b_id     uuid;  -- wholly disposable "another tenant"
  v_staff_b         uuid := gen_random_uuid();  -- qualifies as opps-staff on tenant B only
  v_unauthorized    uuid := gen_random_uuid();  -- zero staff qualification anywhere
  v_appadmin        uuid := gen_random_uuid();  -- global admin, zero tenant memberships

  v_client_b        uuid;  -- disposable clients row, referenced by every Tenant B client_product

  v_cp_reconciled   uuid;
  v_cp_diverged     uuid;
  v_cp_zero         uuid;  -- JET-like: client_price = 0, nonzero components
  v_cp_null_agreed  uuid;
  v_cp_unresolved   uuid;
  v_cp_no_comp      uuid;
  v_cp_setup_fee    uuid;
  v_cp_qty          uuid;
  v_cp_orphan       uuid;
  v_cp_rq           uuid;  -- requires_quote = true

  v_result          jsonb;
  v_count           int;
  v_tarp_before     int;
  v_tm_before       int;
  v_pc_before       int;
  v_cp_before       int;
  v_clients_before  int;
begin
  -- ============================================================
  -- Integrity baselines (test 22), privileged role
  -- ============================================================
  select count(*)::int into v_tarp_before from public.tenant_access_role_permissions;
  select count(*)::int into v_tm_before from public.tenant_memberships;
  select count(*)::int into v_pc_before from public.product_components;
  select count(*)::int into v_cp_before from public.client_products;
  select count(*)::int into v_clients_before from public.clients;

  -- ============================================================
  -- FIXTURE SETUP (privileged role throughout)
  -- ============================================================
  insert into public.tenants (slug, name, status)
  values ('rehearsal-resolver-b-' || substr(v_staff_b::text,1,8), 'Rehearsal Resolver Tenant B', 'active')
  returning id into v_tenant_b_id;

  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_staff_jx,     'authenticated', 'authenticated', 'rehearsal-resolver-staffjx-' || substr(v_staff_jx::text,1,8)     || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_staff_b,      'authenticated', 'authenticated', 'rehearsal-resolver-staffb-'  || substr(v_staff_b::text,1,8)      || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_unauthorized, 'authenticated', 'authenticated', 'rehearsal-resolver-unauth-'  || substr(v_unauthorized::text,1,8) || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_appadmin,     'authenticated', 'authenticated', 'rehearsal-resolver-appadm-'  || substr(v_appadmin::text,1,8)     || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  -- public.users.role='admin' is what makes is_app_admin() true for
  -- v_appadmin -- no tenant membership needed for that identity at all.
  insert into public.users (auth_user_id, user_email, full_name, role, is_active)
  values (v_appadmin, 'rehearsal-resolver-appadm-' || substr(v_appadmin::text,1,8) || '@example.test', 'Rehearsal App Admin', 'admin', true);

  -- v_staff_jx: disposable member of the REAL joint-x tenant -- qualifies
  -- as opps-staff via is_opps_staff()'s joint-x branch, no capability/
  -- permission rows needed.
  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status) values
    (v_joint_x_id, v_staff_jx, 'member', 'active');

  -- v_staff_b: active member of Tenant B, which is given its own
  -- opps_workspace capability + opps.access permission so v_staff_b
  -- qualifies as opps-staff via is_opps_staff()'s SECOND (general,
  -- non-joint-x) branch -- proving the mechanism works generally, not
  -- only for the joint-x special case.
  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status) values
    (v_tenant_b_id, v_staff_b, 'member', 'active');
  insert into public.tenant_capabilities (tenant_id, capability_key, enabled)
  values (v_tenant_b_id, 'opps_workspace', true);
  insert into public.tenant_access_roles (tenant_id, role_key, name, rank, is_active) values
    (v_tenant_b_id, 'member', 'Member', 50, true);
  insert into public.tenant_access_role_permissions (tenant_id, role_key, permission_key, allowed) values
    (v_tenant_b_id, 'member', 'opps.access', true);

  -- v_unauthorized: a real auth user with zero tenant memberships and no
  -- public.users row at all -- fails is_opps_staff() on every branch.

  -- One disposable clients row, referenced by every Tenant B client_product
  -- below (client_products.client_id has a NOT NULL FK to clients.id).
  insert into public.clients (name, tenant_id, status)
  values ('Rehearsal Resolver Test Client', v_tenant_b_id, 'lead')
  returning id into v_client_b;

  -- ── Disposable client_products, all on Tenant B ────────────────────
  insert into public.client_products (tenant_id, client_id, client_facing_name, client_price, requires_quote)
  values (v_tenant_b_id, v_client_b, 'Rehearsal Reconciled Product', 100, false)
  returning id into v_cp_reconciled;
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, is_active)
  values (v_cp_reconciled, v_tenant_b_id, 'blank_garment', 'per_unit', 100, true);

  insert into public.client_products (tenant_id, client_id, client_facing_name, client_price, requires_quote)
  values (v_tenant_b_id, v_client_b, 'Rehearsal Diverged Product', 150, false)
  returning id into v_cp_diverged;
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, is_active)
  values (v_cp_diverged, v_tenant_b_id, 'blank_garment', 'per_unit', 120, true);

  -- JET-like: client_price explicitly 0, nonzero components -- mirrors
  -- the real 'JET T-Shirt' shape found in production (not that row
  -- itself; a disposable equivalent).
  insert into public.client_products (tenant_id, client_id, client_facing_name, client_price, requires_quote)
  values (v_tenant_b_id, v_client_b, 'Rehearsal Zero-Agreed Product', 0, false)
  returning id into v_cp_zero;
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, is_active)
  values (v_cp_zero, v_tenant_b_id, 'blank_garment', 'per_unit', 250, true);

  insert into public.client_products (tenant_id, client_id, client_facing_name, client_price, requires_quote)
  values (v_tenant_b_id, v_client_b, 'Rehearsal Null-Agreed Product', null, false)
  returning id into v_cp_null_agreed;
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, is_active)
  values (v_cp_null_agreed, v_tenant_b_id, 'blank_garment', 'per_unit', 75, true);

  insert into public.client_products (tenant_id, client_id, client_facing_name, client_price, requires_quote)
  values (v_tenant_b_id, v_client_b, 'Rehearsal Unresolved Product', null, false)
  returning id into v_cp_unresolved;
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, is_active)
  values (v_cp_unresolved, v_tenant_b_id, 'blank_garment', 'per_unit', 60, true);
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, is_active)
  values (v_cp_unresolved, v_tenant_b_id, 'print_service', 'per_unit', null, true);

  insert into public.client_products (tenant_id, client_id, client_facing_name, client_price, requires_quote)
  values (v_tenant_b_id, v_client_b, 'Rehearsal No-Composition Product', 500, false)
  returning id into v_cp_no_comp;
  -- deliberately zero product_components rows for this one.

  insert into public.client_products (tenant_id, client_id, client_facing_name, client_price, requires_quote)
  values (v_tenant_b_id, v_client_b, 'Rehearsal Setup-Fee Product', 80, false)
  returning id into v_cp_setup_fee;
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, is_active)
  values (v_cp_setup_fee, v_tenant_b_id, 'blank_garment', 'per_unit', 80, true);
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, is_active)
  values (v_cp_setup_fee, v_tenant_b_id, 'setup_fee', 'once_per_order', 50, true);

  insert into public.client_products (tenant_id, client_id, client_facing_name, client_price, requires_quote)
  values (v_tenant_b_id, v_client_b, 'Rehearsal Quantity Product', 60, false)
  returning id into v_cp_qty;
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, is_active)
  values (v_cp_qty, v_tenant_b_id, 'blank_garment', 'per_unit', 60, true);
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, is_active)
  values (v_cp_qty, v_tenant_b_id, 'setup_fee', 'once_per_order', 40, true);

  insert into public.client_products (tenant_id, client_id, client_facing_name, client_price, requires_quote)
  values (v_tenant_b_id, v_client_b, 'Rehearsal Orphan-Type Product', 90, false)
  returning id into v_cp_orphan;
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, is_active)
  values (v_cp_orphan, v_tenant_b_id, 'blank_garment', 'per_unit', 90, true);
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, is_active)
  values (v_cp_orphan, v_tenant_b_id, 'labour', 'per_unit', 999, true);

  insert into public.client_products (tenant_id, client_id, client_facing_name, client_price, requires_quote)
  values (v_tenant_b_id, v_client_b, 'Rehearsal Requires-Quote Product', null, true)
  returning id into v_cp_rq;
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, is_active)
  values (v_cp_rq, v_tenant_b_id, 'blank_garment', 'per_unit', 300, true);

  raise notice '--- fixtures ready: tenant_b=%, cp_reconciled=%, cp_diverged=%, cp_zero=% ---',
    v_tenant_b_id, v_cp_reconciled, v_cp_diverged, v_cp_zero;

  -- Switch to v_staff_b for every success-path test (1,2,3,4,5,6,11,12,13,14,15,16,19).
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_b, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- TEST 1: client_price X, computed X -> reconciled, agreed=effective=X
  -- ============================================================
  select public.resolve_client_product_price(v_cp_reconciled, 1, null) into v_result;
  if v_result->>'reconciliation_status' is distinct from 'reconciled'
     or (v_result->>'agreed_unit_price')::numeric is distinct from 100
     or (v_result->>'effective_unit_price')::numeric is distinct from 100
     or (v_result->>'computed_unit_price')::numeric is distinct from 100
     or v_result->>'price_source' is distinct from 'agreed' then
    raise exception 'TEST 1 FAILED: %', v_result;
  end if;
  raise notice 'TEST 1 passed: reconciled';

  -- ============================================================
  -- TEST 2: client_price Y, computed X (Y<>X) -> diverged, effective Y, source agreed
  -- ============================================================
  select public.resolve_client_product_price(v_cp_diverged, 1, null) into v_result;
  if v_result->>'reconciliation_status' is distinct from 'diverged'
     or (v_result->>'effective_unit_price')::numeric is distinct from 150
     or (v_result->>'computed_unit_price')::numeric is distinct from 120
     or v_result->>'price_source' is distinct from 'agreed' then
    raise exception 'TEST 2 FAILED: %', v_result;
  end if;
  raise notice 'TEST 2 passed: diverged';

  -- ============================================================
  -- TEST 3: JET-like zero case -> diverged, effective 0, source agreed
  -- ============================================================
  select public.resolve_client_product_price(v_cp_zero, 1, null) into v_result;
  if v_result->>'reconciliation_status' is distinct from 'diverged'
     or (v_result->>'agreed_unit_price')::numeric is distinct from 0
     or (v_result->>'effective_unit_price')::numeric is distinct from 0
     or (v_result->>'computed_unit_price')::numeric is distinct from 250
     or v_result->>'price_source' is distinct from 'agreed' then
    raise exception 'TEST 3 FAILED: %', v_result;
  end if;
  raise notice 'TEST 3 passed: JET-like zero-agreed case (client_price=0 is a valid agreed price)';

  -- ============================================================
  -- TEST 4: NULL client_price, valid computed -> computed returned
  -- diagnostically, effective 0, source default_zero
  -- ============================================================
  select public.resolve_client_product_price(v_cp_null_agreed, 1, null) into v_result;
  if v_result->>'agreed_unit_price' is not null
     or (v_result->>'effective_unit_price')::numeric is distinct from 0
     or (v_result->>'computed_unit_price')::numeric is distinct from 75
     or v_result->>'price_source' is distinct from 'default_zero' then
    raise exception 'TEST 4 FAILED: %', v_result;
  end if;
  raise notice 'TEST 4 passed: null agreed price, computed returned diagnostically only';

  -- ============================================================
  -- TEST 5: override Z -> effective Z, source override
  -- ============================================================
  select public.resolve_client_product_price(v_cp_diverged, 1, 500) into v_result;
  if (v_result->>'effective_unit_price')::numeric is distinct from 500
     or v_result->>'price_source' is distinct from 'override'
     or (v_result->>'override_unit_price')::numeric is distinct from 500 then
    raise exception 'TEST 5 FAILED: %', v_result;
  end if;
  raise notice 'TEST 5 passed: override wins';

  -- ============================================================
  -- TEST 6: override 0 -> effective 0, source override (distinct from
  -- TEST 3's source='agreed' even though both end up effective=0)
  -- ============================================================
  select public.resolve_client_product_price(v_cp_diverged, 1, 0) into v_result;
  if (v_result->>'effective_unit_price')::numeric is distinct from 0
     or v_result->>'price_source' is distinct from 'override' then
    raise exception 'TEST 6 FAILED: %', v_result;
  end if;
  raise notice 'TEST 6 passed: explicit override of 0 still wins over a nonzero client_price (150)';

  -- ============================================================
  -- TEST 7: negative override -> rejected
  -- ============================================================
  begin
    perform public.resolve_client_product_price(v_cp_reconciled, 1, -1);
    raise exception 'TEST 7 FAILED: negative override was accepted';
  exception when others then
    if sqlerrm not like 'RESOLVE_PRICE_INVALID_OVERRIDE%' then
      raise exception 'TEST 7 FAILED: wrong error: %', sqlerrm;
    end if;
  end;
  raise notice 'TEST 7 passed: negative override rejected';

  -- ============================================================
  -- TEST 8: quantity 0 -> rejected
  -- ============================================================
  begin
    perform public.resolve_client_product_price(v_cp_reconciled, 0, null);
    raise exception 'TEST 8 FAILED: quantity 0 was accepted';
  exception when others then
    if sqlerrm not like 'RESOLVE_PRICE_INVALID_QUANTITY%' then
      raise exception 'TEST 8 FAILED: wrong error: %', sqlerrm;
    end if;
  end;
  raise notice 'TEST 8 passed: quantity 0 rejected';

  -- ============================================================
  -- TEST 9: negative quantity -> rejected
  -- ============================================================
  begin
    perform public.resolve_client_product_price(v_cp_reconciled, -3, null);
    raise exception 'TEST 9 FAILED: negative quantity was accepted';
  exception when others then
    if sqlerrm not like 'RESOLVE_PRICE_INVALID_QUANTITY%' then
      raise exception 'TEST 9 FAILED: wrong error: %', sqlerrm;
    end if;
  end;
  raise notice 'TEST 9 passed: negative quantity rejected';

  -- ============================================================
  -- TEST 10: explicit NULL quantity -> rejected (distinct from omitting
  -- the argument, which defaults to 1 via ordinary Postgres semantics
  -- and never reaches the function body as null)
  -- ============================================================
  begin
    perform public.resolve_client_product_price(v_cp_reconciled, null, null);
    raise exception 'TEST 10 FAILED: explicit NULL quantity was accepted';
  exception when others then
    if sqlerrm not like 'RESOLVE_PRICE_INVALID_QUANTITY%' then
      raise exception 'TEST 10 FAILED: wrong error: %', sqlerrm;
    end if;
  end;
  -- Confirm omission truly defaults to 1 (no error) -- same product, no quantity arg at all.
  select public.resolve_client_product_price(v_cp_reconciled) into v_result;
  if (v_result->>'quantity')::numeric is distinct from 1 then
    raise exception 'TEST 10 FAILED: omitted quantity did not default to 1: %', v_result;
  end if;
  raise notice 'TEST 10 passed: explicit NULL rejected; omitted argument correctly defaults to 1';

  -- ============================================================
  -- TEST 11: unresolved component -> unresolved_components
  -- ============================================================
  select public.resolve_client_product_price(v_cp_unresolved, 1, null) into v_result;
  if v_result->>'reconciliation_status' is distinct from 'unresolved_components'
     or jsonb_array_length(v_result->'unresolved_components') <> 1 then
    raise exception 'TEST 11 FAILED: %', v_result;
  end if;
  raise notice 'TEST 11 passed: unresolved component surfaced';

  -- ============================================================
  -- TEST 12: no qualifying composition -> no_composition
  -- ============================================================
  select public.resolve_client_product_price(v_cp_no_comp, 1, null) into v_result;
  if v_result->>'reconciliation_status' is distinct from 'no_composition'
     or v_result->>'computed_unit_price' is not null
     or (v_result->>'effective_unit_price')::numeric is distinct from 500 then
    raise exception 'TEST 12 FAILED: %', v_result;
  end if;
  raise notice 'TEST 12 passed: no_composition, effective still equals agreed price';

  -- ============================================================
  -- TEST 13: once-per-order setup fee remains separate from unit price
  -- ============================================================
  select public.resolve_client_product_price(v_cp_setup_fee, 1, null) into v_result;
  if v_result->>'reconciliation_status' is distinct from 'reconciled'
     or (v_result->>'effective_unit_price')::numeric is distinct from 80
     or jsonb_array_length(v_result->'once_per_order_fees') <> 1
     or ((v_result->'once_per_order_fees'->0)->>'amount')::numeric is distinct from 50 then
    raise exception 'TEST 13 FAILED: %', v_result;
  end if;
  raise notice 'TEST 13 passed: setup fee reported separately, not folded into unit price';

  -- ============================================================
  -- TEST 14: quantity > 1 does not multiply unit price or the
  -- once-per-order fee amount
  -- ============================================================
  select public.resolve_client_product_price(v_cp_qty, 3, null) into v_result;
  if (v_result->>'quantity')::numeric is distinct from 3
     or (v_result->>'effective_unit_price')::numeric is distinct from 60
     or (v_result->>'computed_unit_price')::numeric is distinct from 60
     or ((v_result->'once_per_order_fees'->0)->>'amount')::numeric is distinct from 40 then
    raise exception 'TEST 14 FAILED: quantity incorrectly affected unit price or fee amount: %', v_result;
  end if;
  raise notice 'TEST 14 passed: quantity=3 leaves unit price and once-per-order fee amount unchanged';

  -- ============================================================
  -- TEST 15: requires_quote=true returns full diagnostic result, no mutation
  -- ============================================================
  select public.resolve_client_product_price(v_cp_rq, 1, null) into v_result;
  if (v_result->>'requires_quote')::boolean is distinct from true
     or v_result->>'computed_unit_price' is null
     or v_result is null then
    raise exception 'TEST 15 FAILED: %', v_result;
  end if;
  raise notice 'TEST 15 passed: requires_quote=true still returns full diagnostic output';

  -- ============================================================
  -- TEST 16: material/packaging/labour/other remain excluded
  -- ============================================================
  select public.resolve_client_product_price(v_cp_orphan, 1, null) into v_result;
  if (v_result->>'computed_unit_price')::numeric is distinct from 90 then
    raise exception 'TEST 16 FAILED: orphan-type component (labour, price 999) was NOT excluded: %', v_result;
  end if;
  raise notice 'TEST 16 passed: labour-type component correctly excluded from computed price (90, not 1089)';

  -- ============================================================
  -- TEST 19: valid tenant member/staff behavior matches precedent
  -- (v_staff_b, an ordinary member of Tenant B with opps.access via the
  -- general non-joint-x mechanism, already succeeded on every test
  -- above -- this is that same confirmation, stated explicitly)
  -- ============================================================
  raise notice 'TEST 19 passed: non-joint-x tenant staff (v_staff_b) succeeded on every prior test via the general is_opps_staff() mechanism';

  -- ============================================================
  -- TEST 17: unauthorized user rejected (zero staff qualification anywhere)
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_unauthorized, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.resolve_client_product_price(v_cp_reconciled, 1, null);
    raise exception 'TEST 17 FAILED: unauthorized user was not rejected';
  exception when others then
    if sqlerrm not like 'RESOLVE_PRICE_FORBIDDEN%' then
      raise exception 'TEST 17 FAILED: wrong error: %', sqlerrm;
    end if;
  end;
  raise notice 'TEST 17 passed: unauthorized user rejected';

  -- ============================================================
  -- TEST 18: joint-x staff attempting Tenant B's client_product rejected
  -- (is_opps_staff() passes via the joint-x branch; can_access_tenant on
  -- Tenant B fails since v_staff_jx has no membership there)
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_jx, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.resolve_client_product_price(v_cp_reconciled, 1, null);
    raise exception 'TEST 18 FAILED: joint-x staff with no Tenant B membership was not rejected';
  exception when others then
    if sqlerrm not like 'RESOLVE_PRICE_TENANT_DENIED%' then
      raise exception 'TEST 18 FAILED: wrong error: %', sqlerrm;
    end if;
  end;
  raise notice 'TEST 18 passed: joint-x staff rejected from a tenant they have no membership on';

  -- ============================================================
  -- TEST 20: app-admin, with zero tenant memberships anywhere, is
  -- rejected the same way -- proving no app-admin bypass was invented
  -- (matches can_access_tenant()'s own precedent exactly: it has none)
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_appadmin, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.resolve_client_product_price(v_cp_reconciled, 1, null);
    raise exception 'TEST 20 FAILED: app-admin with no tenant membership was not rejected -- an undocumented bypass exists';
  exception when others then
    if sqlerrm not like 'RESOLVE_PRICE_TENANT_DENIED%' then
      raise exception 'TEST 20 FAILED: wrong error: %', sqlerrm;
    end if;
  end;
  raise notice 'TEST 20 passed: app-admin has no cross-tenant bypass, matching can_access_tenant() precedent exactly';

  -- ============================================================
  -- Integrity check (22): zero table rows modified by any of the above
  -- ============================================================
  execute 'reset role';
  select count(*)::int into v_count from public.tenant_access_role_permissions;
  if v_count <> v_tarp_before + 1 then
    raise exception 'TEST 22 FAILED: tenant_access_role_permissions count changed by an unexpected amount (% -> %, expected +1 for our own fixture)', v_tarp_before, v_count;
  end if;
  -- +3, not +2: the 2 intentional memberships (v_staff_jx on joint-x,
  -- v_staff_b on Tenant B) plus one more -- inserting v_appadmin's
  -- public.users row with role='admin' auto-enrolls it into the REAL
  -- joint-x tenant via add_internal_user_to_joint_x_team() (same trigger
  -- side effect confirmed during the Slice 1 and Slice 2 RBAC
  -- rehearsals) -- expected, unrelated to anything this resolver checks.
  select count(*)::int into v_count from public.tenant_memberships;
  if v_count <> v_tm_before + 3 then
    raise exception 'TEST 22 FAILED: tenant_memberships count changed by an unexpected amount (% -> %, expected +3: 2 intentional fixtures + 1 app-admin auto-enrollment)', v_tm_before, v_count;
  end if;
  select count(*)::int into v_count from public.product_components;
  if v_count <> v_pc_before + 13 then
    raise exception 'TEST 22 FAILED: product_components count changed by an unexpected amount (% -> %, expected +13 for our own fixtures)', v_pc_before, v_count;
  end if;
  select count(*)::int into v_count from public.client_products;
  if v_count <> v_cp_before + 10 then
    raise exception 'TEST 22 FAILED: client_products count changed by an unexpected amount (% -> %, expected +10 for our own fixtures)', v_cp_before, v_count;
  end if;
  select count(*)::int into v_count from public.clients;
  if v_count <> v_clients_before + 1 then
    raise exception 'TEST 22 FAILED: clients count changed by an unexpected amount (% -> %, expected +1 for our own fixture)', v_clients_before, v_count;
  end if;
  raise notice 'TEST 22 passed: every row-count change is accounted for exactly by this script''s own disposable fixtures -- nothing else was modified';

  raise notice '=== CANONICAL PRICE RESOLUTION V1 REHEARSAL PASSED ===';
end $rehearsal_do$;
