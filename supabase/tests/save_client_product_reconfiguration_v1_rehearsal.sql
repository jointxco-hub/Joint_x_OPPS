-- SAVE V1 (save_client_product_reconfiguration) — REHEARSAL SCRIPT
--
-- Run inside BEGIN ... ROLLBACK against production. Assemble as:
--   BEGIN;
--   <full contents of
--    supabase/migrations/20261004090000_save_client_product_reconfiguration_v1.sql,
--    WITHOUT its own begin;/commit; lines — this file's own outer
--    BEGIN;/ROLLBACK; provides that instead>
--   <this file>
--   ROLLBACK;
--
-- Every fixture here is wholly disposable: one new tenant ("Tenant B"),
-- one disposable client, disposable identities, disposable
-- client_products/product_components. Nothing real is ever written to.
-- The JET/PAN AFRICA "walkthrough" cases are disposable MIRRORS of the
-- real rows' shapes (bf31e82b-... and c309c3f8-...) — the real rows
-- themselves are never touched; they are re-read, read-only, once at the
-- end to confirm they are still exactly as found.
--
-- Same lesson as prior rehearsals in this project: privileged fixture
-- setup happens entirely before any role/JWT switch; a fresh switch
-- happens immediately before each call attributed to a disposable
-- identity; RESET ROLE before every post-call privileged verification.

do $rehearsal_do$
declare
  v_tenant_b        uuid;
  v_client_b        uuid;

  v_reviewer        uuid := gen_random_uuid();  -- app-admin + active Tenant B membership -> passes all 3 Save gates
  v_unauthorized    uuid := gen_random_uuid();  -- zero public.users row at all
  v_no_access       uuid := gen_random_uuid();  -- real public.users row, no Tenant B membership, not app-admin
                                                 -- (NOTE: any public.users insert auto-enrolls as a joint-x
                                                 -- 'member' via add_internal_user_to_joint_x_team(), so this
                                                 -- identity DOES pass is_opps_staff() - it is used to test the
                                                 -- NEXT gate, can_access_tenant(Tenant B), not is_opps_staff()
                                                 -- itself. No real public.users row can fail is_opps_staff(),
                                                 -- since that auto-enrollment is unconditional.)
  v_wrong_tenant    uuid := gen_random_uuid();  -- app-admin, zero Tenant B membership

  v_cp_simple       uuid;  -- reconciled, used for vanilla/price-change/divergence tests
  v_cp_diverged     uuid;  -- diverged, agreed retained
  v_cp_unresolved   uuid;  -- has one unresolved component
  v_cp_xlab         uuid;  -- xlab_product_id set
  v_cp_other        uuid;  -- a SECOND product, used only to hold a "foreign" component id
  v_cp_jet_mirror   uuid;  -- disposable mirror of real JET shape
  v_cp_pan_mirror   uuid;  -- disposable mirror of real PAN AFRICA shape

  v_comp_simple     uuid;
  v_comp_diverged   uuid;
  v_comp_unresolved_priced   uuid;
  v_comp_unresolved_missing  uuid;
  v_comp_foreign    uuid;  -- belongs to v_cp_other
  v_cp_zero_test    uuid;  -- dedicated fixture for the agreed=0/negative/null price tests,
                           -- kept separate from v_cp_other so those price edits don't leave
                           -- v_cp_other diverged for the later component-mechanics tests

  v_result          jsonb;
  v_fp_before        text;
  v_fp_stale          text;
  v_client_price_before numeric;
  v_comp_price_before    numeric;
  v_orders_before     int;
  v_snapshots_before  int;
  v_orders_after      int;
  v_snapshots_after   int;
  v_real_jet          record;
  v_real_pan          record;
  v_passed            int := 0;
  v_failed            int := 0;
  v_fail_msgs         text := '';
begin
  -- ============================================================
  -- Historical-table integrity baseline (scenario 28)
  -- ============================================================
  select count(*)::int into v_orders_before from public.orders;
  select count(*)::int into v_snapshots_before from public.order_line_component_snapshots;

  -- ============================================================
  -- Read-only snapshot of the two REAL rows, BEFORE anything else,
  -- purely so the final comparison has a true "before" to check against.
  -- ============================================================
  select id, client_price, requires_quote, xlab_product_id, status
    into v_real_jet
    from public.client_products where id = 'bf31e82b-905d-4ede-af79-7e4a1f1b4688';
  select id, client_price, requires_quote, xlab_product_id, status
    into v_real_pan
    from public.client_products where id = 'c309c3f8-c251-401d-8a11-9e6c0a3cda92';

  -- ============================================================
  -- FIXTURE SETUP (privileged role throughout)
  -- ============================================================
  insert into public.tenants (slug, name, status)
  values ('rehearsal-savev1-b-' || substr(v_reviewer::text,1,8), 'Rehearsal Save V1 Tenant B', 'active')
  returning id into v_tenant_b;

  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_reviewer,     'authenticated', 'authenticated', 'rehearsal-savev1-reviewer-'  || substr(v_reviewer::text,1,8)     || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_unauthorized, 'authenticated', 'authenticated', 'rehearsal-savev1-unauth-'    || substr(v_unauthorized::text,1,8) || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_no_access,    'authenticated', 'authenticated', 'rehearsal-savev1-noaccess-'  || substr(v_no_access::text,1,8)    || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_wrong_tenant, 'authenticated', 'authenticated', 'rehearsal-savev1-wrongten-'  || substr(v_wrong_tenant::text,1,8) || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  -- v_reviewer and v_wrong_tenant are both app-admins (is_app_admin() ->
  -- is_opps_staff() true unconditionally, and inventory_can_review_tenant()'s
  -- own admin bypass). The ONLY difference between them is that v_reviewer
  -- additionally has a real, active Tenant B membership and v_wrong_tenant
  -- does not — isolating "authorized" from "wrong tenant" to exactly one
  -- variable, proving can_access_tenant() has no app-admin bypass, same
  -- as the resolver rehearsal already proved.
  perform set_config('request.jwt.claims', json_build_object('email','jointx.co@gmail.com')::text, true);
  insert into public.users (auth_user_id, user_email, full_name, role, is_active) values
    (v_reviewer,     'rehearsal-savev1-reviewer-'  || substr(v_reviewer::text,1,8)     || '@example.test', 'Rehearsal Reviewer',     'admin', true),
    (v_wrong_tenant, 'rehearsal-savev1-wrongten-'  || substr(v_wrong_tenant::text,1,8) || '@example.test', 'Rehearsal Wrong Tenant', 'admin', true);

  -- v_no_access: a real OPPS-adjacent identity, but zero tenant
  -- memberships and not an app-admin — fails is_opps_staff() cleanly.
  insert into public.users (auth_user_id, user_email, full_name, role, is_active) values
    (v_no_access, 'rehearsal-savev1-noaccess-' || substr(v_no_access::text,1,8) || '@example.test', 'Rehearsal No Access', 'staff', true);

  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status) values
    (v_tenant_b, v_reviewer, 'owner', 'active');
  -- v_wrong_tenant and v_unauthorized and v_no_access deliberately get
  -- NO Tenant B membership at all.

  insert into public.clients (name, tenant_id, status)
  values ('Rehearsal Save V1 Client', v_tenant_b, 'lead')
  returning id into v_client_b;

  -- ── Disposable client_products on Tenant B ──────────────────────────
  insert into public.client_products (tenant_id, client_id, client_facing_name, client_price, requires_quote)
  values (v_tenant_b, v_client_b, 'Rehearsal Simple Reconciled', 100, false)
  returning id into v_cp_simple;
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, quantity_per_unit, label, is_active)
  values (v_cp_simple, v_tenant_b, 'blank_garment', 'per_unit', 100, 1, 'Blank', true)
  returning id into v_comp_simple;

  insert into public.client_products (tenant_id, client_id, client_facing_name, client_price, requires_quote)
  values (v_tenant_b, v_client_b, 'Rehearsal Diverged Retained', 150, false)
  returning id into v_cp_diverged;
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, quantity_per_unit, label, is_active)
  values (v_cp_diverged, v_tenant_b, 'blank_garment', 'per_unit', 120, 1, 'Blank', true)
  returning id into v_comp_diverged;

  insert into public.client_products (tenant_id, client_id, client_facing_name, client_price, requires_quote)
  values (v_tenant_b, v_client_b, 'Rehearsal Unresolved', 200, false)
  returning id into v_cp_unresolved;
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, quantity_per_unit, label, is_active)
  values (v_cp_unresolved, v_tenant_b, 'blank_garment', 'per_unit', 60, 1, 'Blank', true)
  returning id into v_comp_unresolved_priced;
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, quantity_per_unit, label, is_active)
  values (v_cp_unresolved, v_tenant_b, 'print_service', 'per_unit', null, 1, 'Print - unpriced', true)
  returning id into v_comp_unresolved_missing;

  insert into public.client_products (tenant_id, client_id, client_facing_name, client_price, requires_quote, xlab_product_id)
  select v_tenant_b, v_client_b, 'Rehearsal XLAB Linked', 50, false, id from public.xlab_products limit 1
  returning id into v_cp_xlab;
  if v_cp_xlab is null then
    -- no real xlab_products row exists to reference (consistent with
    -- the audit's own finding of zero live links) — fall back to a
    -- disposable uuid cast purely to exercise the guard; the FK would
    -- normally require a real row, so this fixture is skipped if the
    -- table is truly empty, and the guard test below is skipped too.
    null;
  end if;

  insert into public.client_products (tenant_id, client_id, client_facing_name, client_price, requires_quote)
  values (v_tenant_b, v_client_b, 'Rehearsal Other Product', 10, false)
  returning id into v_cp_other;
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, quantity_per_unit, label, is_active)
  values (v_cp_other, v_tenant_b, 'blank_garment', 'per_unit', 10, 1, 'Foreign', true)
  returning id into v_comp_foreign;

  insert into public.client_products (tenant_id, client_id, client_facing_name, client_price, requires_quote)
  values (v_tenant_b, v_client_b, 'Rehearsal Zero Price Fixture', 50, false)
  returning id into v_cp_zero_test;
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, quantity_per_unit, label, is_active)
  values (v_cp_zero_test, v_tenant_b, 'blank_garment', 'per_unit', 50, 1, 'Blank', true);

  -- Disposable mirrors of the two real production shapes (never the
  -- real rows themselves).
  insert into public.client_products (tenant_id, client_id, client_facing_name, client_price, requires_quote)
  values (v_tenant_b, v_client_b, 'Rehearsal JET Mirror', 229, false)
  returning id into v_cp_jet_mirror;
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, quantity_per_unit, label, is_active) values
    (v_cp_jet_mirror, v_tenant_b, 'print_service', 'per_unit', 78, 1, 'Print A', true),
    (v_cp_jet_mirror, v_tenant_b, 'print_service', 'per_unit', null, 1, 'Print B - unpriced', true);

  insert into public.client_products (tenant_id, client_id, client_facing_name, client_price, requires_quote)
  values (v_tenant_b, v_client_b, 'Rehearsal PAN AFRICA Mirror', 319, false)
  returning id into v_cp_pan_mirror;
  insert into public.product_components (client_product_id, tenant_id, component_type, billing_mode, default_sell_price, quantity_per_unit, label, is_active) values
    (v_cp_pan_mirror, v_tenant_b, 'print_service', 'per_unit', 329, 1, 'Front - A5 DTF', true),
    (v_cp_pan_mirror, v_tenant_b, 'print_service', 'per_unit', null, 1, 'Front - A3', true);

  -- ============================================================
  -- Switch to the authorized reviewer identity for every "happy path" /
  -- validation call below.
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_reviewer, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- TEST 1: vanilla save, no commercial change, no reason needed
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_simple);
  v_result := public.save_client_product_reconfiguration(
    v_cp_simple, v_fp_before, 'keep', null,
    jsonb_build_array(jsonb_build_object('action','update','source_id',v_comp_simple,'component_type','blank_garment','billing_mode','per_unit','default_sell_price',100,'quantity_per_unit',1,'label','Blank (renamed)')),
    null, null, null, false, 'rehearsal'
  );
  if (v_result->>'ok')::boolean and (v_result->'canonical'->>'reconciliation_status') = 'reconciled' then
    v_passed := v_passed + 1;
  else
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST1; ';
  end if;

  -- TEST 2: agreed price changed WITH reason -> accept
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_simple);
  v_result := public.save_client_product_reconfiguration(
    v_cp_simple, v_fp_before, 'set', 120, '[]'::jsonb,
    null, 'Negotiated client rate', null, false, 'rehearsal'
  );
  if (v_result->>'ok')::boolean and (v_result->>'agreed_price')::numeric = 120 then
    v_passed := v_passed + 1;
  else
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST2; ';
  end if;

  -- TEST 3: agreed price changed WITHOUT reason -> reject
  select client_price into v_client_price_before from public.client_products where id = v_cp_simple;
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_simple);
  begin
    v_result := public.save_client_product_reconfiguration(v_cp_simple, v_fp_before, 'set', 135, '[]'::jsonb, null, null, null, false, 'rehearsal');
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST3(no-reject); ';
  exception when others then
    if sqlerrm like 'SAVE_DIVERGENCE_REASON_REQUIRED%' then v_passed := v_passed + 1;
    else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST3(' || sqlerrm || '); '; end if;
  end;
  -- TEST 26: confirm the rejected save left the product unchanged
  perform 1 from public.client_products where id = v_cp_simple and client_price = v_client_price_before;
  if found then v_passed := v_passed + 1; else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST26; '; end if;

  -- TEST 4: intentional retained divergence WITH reason -> accept
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_diverged);
  v_result := public.save_client_product_reconfiguration(
    v_cp_diverged, v_fp_before, 'keep', null, '[]'::jsonb,
    'CLIENT_RECURRING', 'Legacy agreed rate', null, false, 'rehearsal'
  );
  if (v_result->>'ok')::boolean and (v_result->'canonical'->>'reconciliation_status') = 'diverged' then
    v_passed := v_passed + 1;
  else
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST4; ';
  end if;

  -- TEST 5: retained divergence WITHOUT reason -> reject
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_diverged);
  begin
    v_result := public.save_client_product_reconfiguration(v_cp_diverged, v_fp_before, 'keep', null, '[]'::jsonb, null, null, null, false, 'rehearsal');
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST5(no-reject); ';
  exception when others then
    if sqlerrm like 'SAVE_DIVERGENCE_REASON_REQUIRED%' then v_passed := v_passed + 1;
    else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST5(' || sqlerrm || '); '; end if;
  end;

  -- TEST 6: unresolved component + acknowledgment -> accept but stays unresolved
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_unresolved);
  v_result := public.save_client_product_reconfiguration(
    v_cp_unresolved, v_fp_before, 'keep', null,
    jsonb_build_array(jsonb_build_object('action','update','source_id',v_comp_unresolved_priced,'component_type','blank_garment','billing_mode','per_unit','default_sell_price',60,'quantity_per_unit',1,'label','Blank (touched)')),
    null, null, null, true, 'rehearsal'
  );
  if (v_result->>'ok')::boolean and (v_result->'canonical'->>'reconciliation_status') = 'unresolved_components' then
    v_passed := v_passed + 1;
  else
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST6; ';
  end if;

  -- TEST 7: unresolved component WITHOUT acknowledgment -> reject
  select count(*) into v_orders_after from public.product_components where client_product_id = v_cp_unresolved; -- reuse var, component count snapshot
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_unresolved);
  begin
    v_result := public.save_client_product_reconfiguration(v_cp_unresolved, v_fp_before, 'keep', null, '[]'::jsonb, null, null, null, false, 'rehearsal');
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST7(no-reject); ';
  exception when others then
    if sqlerrm like 'SAVE_INCOMPLETE_UNACKNOWLEDGED%' then v_passed := v_passed + 1;
    else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST7(' || sqlerrm || '); '; end if;
  end;
  -- TEST 27: confirm the rejected save left components unchanged
  select count(*) into v_snapshots_after from public.product_components where client_product_id = v_cp_unresolved;
  if v_snapshots_after = v_orders_after then v_passed := v_passed + 1; else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST27; '; end if;

  -- TEST 8: agreed price = 0 is accepted as a real agreed price (with reason, since it's a real change)
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_zero_test);
  v_result := public.save_client_product_reconfiguration(
    v_cp_zero_test, v_fp_before, 'set', 0, '[]'::jsonb, null, 'Manual correction', null, false, 'rehearsal'
  );
  if (v_result->>'ok')::boolean and (v_result->>'agreed_price')::numeric = 0 and (v_result->'canonical'->>'price_source') = 'agreed' then
    v_passed := v_passed + 1;
  else
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST8; ';
  end if;

  -- TEST 9: negative agreed price -> reject
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_zero_test);
  begin
    v_result := public.save_client_product_reconfiguration(v_cp_zero_test, v_fp_before, 'set', -5, '[]'::jsonb, null, 'Other', 'n/a', false, 'rehearsal');
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST9(no-reject); ';
  exception when others then
    if sqlerrm like 'SAVE_NEGATIVE_PRICE%' then v_passed := v_passed + 1;
    else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST9(' || sqlerrm || '); '; end if;
  end;

  -- TEST 10: NULL/clear agreed price attempt -> reject
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_zero_test);
  begin
    v_result := public.save_client_product_reconfiguration(v_cp_zero_test, v_fp_before, 'set', null, '[]'::jsonb, null, null, null, false, 'rehearsal');
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST10(no-reject); ';
  exception when others then
    if sqlerrm like 'SAVE_NULL_PRICE_NOT_SUPPORTED%' then v_passed := v_passed + 1;
    else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST10(' || sqlerrm || '); '; end if;
  end;

  -- TEST 11: stale fingerprint -> reject (fingerprint captured, then the
  -- row is mutated out-of-band before the save call uses the stale value)
  v_fp_stale := public._xos_client_product_configuration_fingerprint(v_cp_simple);
  update public.product_components set label = 'Changed out of band' where id = v_comp_simple;
  begin
    v_result := public.save_client_product_reconfiguration(v_cp_simple, v_fp_stale, 'keep', null, '[]'::jsonb, null, null, null, false, 'rehearsal');
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST11(no-reject); ';
  exception when others then
    if sqlerrm like 'SAVE_STALE_FINGERPRINT%' then v_passed := v_passed + 1;
    else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST11(' || sqlerrm || '); '; end if;
  end;

  -- TEST 12: cross-product sourceId -> reject (v_comp_foreign belongs to v_cp_other, not v_cp_simple)
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_simple);
  begin
    v_result := public.save_client_product_reconfiguration(
      v_cp_simple, v_fp_before, 'keep', null,
      jsonb_build_array(jsonb_build_object('action','update','source_id',v_comp_foreign,'component_type','blank_garment','billing_mode','per_unit','default_sell_price',10,'quantity_per_unit',1,'label','x')),
      null, null, null, false, 'rehearsal'
    );
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST12(no-reject); ';
  exception when others then
    if sqlerrm like 'SAVE_CROSS_PRODUCT_COMPONENT%' then v_passed := v_passed + 1;
    else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST12(' || sqlerrm || '); '; end if;
  end;

  -- TEST 13: valid existing component update (price change, no commercial divergence implication)
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_other);
  v_result := public.save_client_product_reconfiguration(
    v_cp_other, v_fp_before, 'keep', null,
    jsonb_build_array(jsonb_build_object('action','update','source_id',v_comp_foreign,'component_type','blank_garment','billing_mode','per_unit','default_sell_price',12,'quantity_per_unit',1,'label','Foreign (updated)')),
    null, 'Manual correction', null, false, 'rehearsal'
  );
  if (v_result->>'ok')::boolean and jsonb_array_length(v_result->'components_modified') = 1 then
    v_passed := v_passed + 1;
  else
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST13; ';
  end if;

  -- TEST 14: valid new component insert
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_other);
  v_result := public.save_client_product_reconfiguration(
    v_cp_other, v_fp_before, 'keep', null,
    jsonb_build_array(jsonb_build_object('action','insert','component_type','addon','billing_mode','per_unit','default_sell_price',5,'quantity_per_unit',1,'label','New addon')),
    null, 'Manual correction', null, false, 'rehearsal'
  );
  if (v_result->>'ok')::boolean and jsonb_array_length(v_result->'components_added') = 1 then
    v_passed := v_passed + 1;
  else
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST14; ';
  end if;

  -- TEST 15: valid component removal uses the existing soft-delete convention
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_other);
  v_result := public.save_client_product_reconfiguration(
    v_cp_other, v_fp_before, 'keep', null,
    jsonb_build_array(jsonb_build_object('action','remove','source_id',v_comp_foreign)),
    null, 'Manual correction', null, false, 'rehearsal'
  );
  perform 1 from public.product_components where id = v_comp_foreign and is_active = false;
  if (v_result->>'ok')::boolean and found then
    v_passed := v_passed + 1;
  else
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST15; ';
  end if;
  perform 1 from public.product_components where id = v_comp_foreign; -- confirm NOT hard-deleted
  if found then v_passed := v_passed + 1; else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST15b(hard-deleted); '; end if;

  -- TEST 16: new-then-removed component is never sent -> no row appears
  select count(*) into v_orders_after from public.product_components where client_product_id = v_cp_other;
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_other);
  v_result := public.save_client_product_reconfiguration(v_cp_other, v_fp_before, 'keep', null, '[]'::jsonb, null, 'Manual correction', null, false, 'rehearsal');
  select count(*) into v_snapshots_after from public.product_components where client_product_id = v_cp_other;
  if (v_result->>'ok')::boolean and v_snapshots_after = v_orders_after then
    v_passed := v_passed + 1;
  else
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST16; ';
  end if;

  -- TEST 17: Historical Only classification -> reject
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_simple);
  begin
    v_result := public.save_client_product_reconfiguration(v_cp_simple, v_fp_before, 'keep', null, '[]'::jsonb, 'HISTORICAL_ONLY', null, null, false, 'rehearsal');
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST17(no-reject); ';
  exception when others then
    if sqlerrm like 'SAVE_BLOCKED_CLASSIFICATION%' then v_passed := v_passed + 1;
    else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST17(' || sqlerrm || '); '; end if;
  end;

  -- TEST 18: Test/Stale classification -> reject
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_simple);
  begin
    v_result := public.save_client_product_reconfiguration(v_cp_simple, v_fp_before, 'keep', null, '[]'::jsonb, 'TEST_STALE', null, null, false, 'rehearsal');
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST18(no-reject); ';
  exception when others then
    if sqlerrm like 'SAVE_BLOCKED_CLASSIFICATION%' then v_passed := v_passed + 1;
    else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST18(' || sqlerrm || '); '; end if;
  end;

  -- TEST 19: XLAB-linked product -> guard/reject (skipped gracefully if
  -- no real xlab_products row exists to satisfy the FK, consistent with
  -- the audit's own confirmed zero-live-link finding)
  if v_cp_xlab is not null then
    v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_xlab);
    begin
      v_result := public.save_client_product_reconfiguration(v_cp_xlab, v_fp_before, 'keep', null, '[]'::jsonb, null, null, null, false, 'rehearsal');
      v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST19(no-reject); ';
    exception when others then
      if sqlerrm like 'SAVE_BLOCKED_XLAB_COMMERCIAL%' then v_passed := v_passed + 1;
      else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST19(' || sqlerrm || '); '; end if;
    end;
  else
    raise notice 'TEST19 SKIPPED: no real xlab_products row exists to build a fixture FK against (consistent with 0 live xlab links)';
  end if;

  -- TEST 22: resolver sees this call's own tentative writes — fix the
  -- unresolved component's price IN THE SAME CALL and confirm the
  -- returned canonical status is no longer unresolved.
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_unresolved);
  v_result := public.save_client_product_reconfiguration(
    v_cp_unresolved, v_fp_before, 'keep', null,
    jsonb_build_array(jsonb_build_object('action','update','source_id',v_comp_unresolved_missing,'component_type','print_service','billing_mode','per_unit','default_sell_price',140,'quantity_per_unit',1,'label','Print B (now priced)')),
    null, null, null, false, 'rehearsal'
  );
  if (v_result->>'ok')::boolean and (v_result->'canonical'->>'reconciliation_status') <> 'unresolved_components' then
    v_passed := v_passed + 1;
  else
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST22; ';
  end if;

  -- TEST 23 / 24: audit row + activity event written on successful save
  perform 1 from public.client_product_reconfiguration_events
    where client_product_id = v_cp_unresolved and post_fingerprint = (v_result->>'new_fingerprint');
  if found then v_passed := v_passed + 1; else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST23; '; end if;
  perform 1 from public.opps_activity_events
    where entity_id = v_cp_unresolved and event_type = 'client_product_reconfigured';
  if found then v_passed := v_passed + 1; else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST24; '; end if;

  -- ============================================================
  -- TEST 20: unauthorized actor -> reject (zero public.users row at all)
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_unauthorized, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_simple);
  begin
    v_result := public.save_client_product_reconfiguration(v_cp_simple, v_fp_before, 'keep', null, '[]'::jsonb, null, null, null, false, 'rehearsal');
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST20(no-reject); ';
  exception when others then
    if sqlerrm like 'SAVE_ACTOR_UNRESOLVED%' then v_passed := v_passed + 1;
    else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST20(' || sqlerrm || '); '; end if;
  end;

  -- TEST 20b: a real staff identity (auto-enrolled as a joint-x member by
  -- add_internal_user_to_joint_x_team(), so it DOES pass is_opps_staff())
  -- but with no Tenant B membership of its own -> SAVE_TENANT_DENIED
  perform set_config('request.jwt.claims', json_build_object('sub', v_no_access, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_simple);
  begin
    v_result := public.save_client_product_reconfiguration(v_cp_simple, v_fp_before, 'keep', null, '[]'::jsonb, null, null, null, false, 'rehearsal');
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST20b(no-reject); ';
  exception when others then
    if sqlerrm like 'SAVE_TENANT_DENIED%' then v_passed := v_passed + 1;
    else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST20b(' || sqlerrm || '); '; end if;
  end;

  -- TEST 21: app-admin with NO Tenant B membership -> SAVE_TENANT_DENIED
  -- (proves can_access_tenant() has no app-admin bypass, same as the
  -- resolver rehearsal already proved for resolve_client_product_price)
  perform set_config('request.jwt.claims', json_build_object('sub', v_wrong_tenant, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_simple);
  begin
    v_result := public.save_client_product_reconfiguration(v_cp_simple, v_fp_before, 'keep', null, '[]'::jsonb, null, null, null, false, 'rehearsal');
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST21(no-reject); ';
  exception when others then
    if sqlerrm like 'SAVE_TENANT_DENIED%' then v_passed := v_passed + 1;
    else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST21(' || sqlerrm || '); '; end if;
  end;

  -- ============================================================
  -- Back to the authorized reviewer for the two real-shape walkthroughs
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_reviewer, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- JET-mirror walkthrough: unresolved, not acknowledged -> reject
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_jet_mirror);
  begin
    v_result := public.save_client_product_reconfiguration(v_cp_jet_mirror, v_fp_before, 'keep', null, '[]'::jsonb, null, null, null, false, 'rehearsal');
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'JET_WALKTHROUGH_A(no-reject); ';
  exception when others then
    if sqlerrm like 'SAVE_INCOMPLETE_UNACKNOWLEDGED%' then v_passed := v_passed + 1;
    else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'JET_WALKTHROUGH_A(' || sqlerrm || '); '; end if;
  end;
  -- JET-mirror walkthrough: unresolved, acknowledged -> accept, stays unresolved
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_jet_mirror);
  v_result := public.save_client_product_reconfiguration(v_cp_jet_mirror, v_fp_before, 'keep', null, '[]'::jsonb, null, null, null, true, 'rehearsal');
  if (v_result->>'ok')::boolean and (v_result->'canonical'->>'reconciliation_status') = 'unresolved_components' then
    v_passed := v_passed + 1;
  else
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'JET_WALKTHROUGH_B; ';
  end if;

  -- PAN AFRICA-mirror walkthrough: price the missing A3 component in the
  -- same call, no agreed-price change -> accept, resolves to reconciled/diverged
  v_fp_before := public._xos_client_product_configuration_fingerprint(v_cp_pan_mirror);
  v_result := public.save_client_product_reconfiguration(
    v_cp_pan_mirror, v_fp_before, 'keep', null,
    (select jsonb_build_array(jsonb_build_object('action','update','source_id',id,'component_type','print_service','billing_mode','per_unit','default_sell_price',329,'quantity_per_unit',1,'label','Front - A3 (now priced)'))
     from public.product_components where client_product_id = v_cp_pan_mirror and label = 'Front - A3'),
    null, 'Manual correction', null, false, 'rehearsal'
  );
  if (v_result->>'ok')::boolean and (v_result->'canonical'->>'reconciliation_status') <> 'unresolved_components' then
    v_passed := v_passed + 1;
  else
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'PAN_WALKTHROUGH; ';
  end if;

  -- ============================================================
  -- TEST 28 (final): historical tables completely untouched, and the two
  -- REAL rows are byte-identical to how they were found at the very start.
  -- ============================================================
  execute 'reset role';
  select count(*)::int into v_orders_after from public.orders;
  select count(*)::int into v_snapshots_after from public.order_line_component_snapshots;
  if v_orders_after = v_orders_before and v_snapshots_after = v_snapshots_before then
    v_passed := v_passed + 1;
  else
    v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'TEST28(orders/snapshots changed); ';
  end if;

  perform 1 from public.client_products
    where id = v_real_jet.id
      and (client_price is distinct from v_real_jet.client_price
       or requires_quote is distinct from v_real_jet.requires_quote
       or xlab_product_id is distinct from v_real_jet.xlab_product_id
       or status is distinct from v_real_jet.status);
  if not found then v_passed := v_passed + 1; else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'REAL_JET_CHANGED; '; end if;

  perform 1 from public.client_products
    where id = v_real_pan.id
      and (client_price is distinct from v_real_pan.client_price
       or requires_quote is distinct from v_real_pan.requires_quote
       or xlab_product_id is distinct from v_real_pan.xlab_product_id
       or status is distinct from v_real_pan.status);
  if not found then v_passed := v_passed + 1; else v_failed := v_failed + 1; v_fail_msgs := v_fail_msgs || 'REAL_PAN_CHANGED; '; end if;

  raise notice 'SAVE_V1_REHEARSAL_RESULT: % passed, % failed. %', v_passed, v_failed,
    case when v_failed > 0 then 'FAILURES: ' || v_fail_msgs else 'ALL PASSED' end;

  create temp table save_v1_rehearsal_result (passed int, failed int, failures text);
  insert into save_v1_rehearsal_result values (v_passed, v_failed, v_fail_msgs);

  if v_failed > 0 then
    raise exception 'SAVE_V1_REHEARSAL_FAILED: % of % checks failed — %', v_failed, v_passed + v_failed, v_fail_msgs;
  end if;
end;
$rehearsal_do$;

select * from save_v1_rehearsal_result;
