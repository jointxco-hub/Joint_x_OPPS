-- feat/opps-quote-approve-on-behalf -- REHEARSAL SCRIPT
--
-- Run inside BEGIN ... ROLLBACK against production. Assemble as:
--   BEGIN;
--   <full contents of supabase/migrations/20260930090000_quote_approve_on_behalf.sql>
--   <this file>
--   ROLLBACK;
--
-- All fixtures (2 disposable tenants, 10 disposable auth.users, 8
-- tenant_memberships rows, 3 disposable quotes + revisions) are created and
-- torn down entirely by the ROLLBACK. Nothing here touches a real tenant,
-- user, or quote.
--
-- Fixture setup is done entirely under the privileged Studio/editor role,
-- BEFORE any role/JWT switch -- switching to 'authenticated' happens only
-- immediately before each individual call to accept_quote_on_behalf, and a
-- fresh switch happens per test so each call is attributed to the correct
-- disposable identity. (Lesson learned from the Slice 01 rehearsal: doing
-- privileged inserts AFTER switching role hits 42501 permission denied.)

do $rehearsal_do$
declare
  v_tenant_a_id       uuid;
  v_tenant_b_id       uuid;
  v_owner_user        uuid := gen_random_uuid();
  v_admin_user        uuid := gen_random_uuid();
  v_member_user       uuid := gen_random_uuid();
  v_staff_user        uuid := gen_random_uuid();
  v_crosstenant_user  uuid := gen_random_uuid();
  v_finance_user       uuid := gen_random_uuid();
  v_manager_user       uuid := gen_random_uuid();
  v_prodstaff_user     uuid := gen_random_uuid();
  v_tenantb_admin_user uuid := gen_random_uuid();
  v_appadmin_user      uuid := gen_random_uuid();
  v_quote_id          uuid;
  v_revision_id       uuid;
  v_quote2_id          uuid;
  v_revision2_id       uuid;
  v_quote3_id          uuid;
  v_revision3_id       uuid;
  v_result            jsonb;
  v_quote_row         public.opps_quotes;
  v_event_row         public.opps_quote_events;
begin
  -- ============================================================
  -- FIXTURE SETUP (privileged role throughout)
  -- ============================================================
  insert into public.tenants (slug, name, status)
  values ('rehearsal-qob-a-' || substr(v_owner_user::text, 1, 8), 'Rehearsal Tenant A', 'active')
  returning id into v_tenant_a_id;

  insert into public.tenants (slug, name, status)
  values ('rehearsal-qob-b-' || substr(v_owner_user::text, 1, 8), 'Rehearsal Tenant B', 'active')
  returning id into v_tenant_b_id;

  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_owner_user,       'authenticated', 'authenticated', 'rehearsal-qob-owner-'       || substr(v_owner_user::text,1,8)       || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_admin_user,       'authenticated', 'authenticated', 'rehearsal-qob-admin-'       || substr(v_admin_user::text,1,8)       || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_member_user,      'authenticated', 'authenticated', 'rehearsal-qob-member-'      || substr(v_member_user::text,1,8)      || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_staff_user,       'authenticated', 'authenticated', 'rehearsal-qob-staff-'       || substr(v_staff_user::text,1,8)       || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_crosstenant_user, 'authenticated', 'authenticated', 'rehearsal-qob-crosstenant-' || substr(v_crosstenant_user::text,1,8) || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  -- Additional fixtures for the coverage gaps flagged in the database
  -- safety review: finance/manager/production_staff denial, a literal
  -- cross-tenant ADMIN (not just owner) denial, and an app-admin with
  -- zero tenant relationship at all (proves the is_app_admin() bypass
  -- is truly unconditional, not just "also passes the tenant check").
  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_finance_user,       'authenticated', 'authenticated', 'rehearsal-qob-finance-'     || substr(v_finance_user::text,1,8)       || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_manager_user,       'authenticated', 'authenticated', 'rehearsal-qob-manager-'     || substr(v_manager_user::text,1,8)       || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_prodstaff_user,     'authenticated', 'authenticated', 'rehearsal-qob-prodstaff-'   || substr(v_prodstaff_user::text,1,8)     || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_tenantb_admin_user, 'authenticated', 'authenticated', 'rehearsal-qob-tenb-admin-'  || substr(v_tenantb_admin_user::text,1,8) || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_appadmin_user,      'authenticated', 'authenticated', 'rehearsal-qob-appadmin-'    || substr(v_appadmin_user::text,1,8)      || '@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status) values
    (v_tenant_a_id, v_owner_user,       'owner',  'active'),
    (v_tenant_a_id, v_admin_user,       'admin',  'active'),
    (v_tenant_a_id, v_member_user,      'member', 'active'),
    (v_tenant_a_id, v_staff_user,       'staff',  'active'),
    (v_tenant_b_id, v_crosstenant_user, 'owner',  'active');  -- owner of B only, NOT a member of A

  -- tenant_role admits 'finance'/'manager'/'production_staff' alongside
  -- owner/admin/member/staff (confirmed live: see
  -- 20260926205000_cafe_access_04_counter_staff_role.sql:4). v_appadmin_user
  -- deliberately gets NO row here at all -- see TEST 22.
  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status) values
    (v_tenant_a_id, v_finance_user,       'finance',          'active'),
    (v_tenant_a_id, v_manager_user,       'manager',          'active'),
    (v_tenant_a_id, v_prodstaff_user,     'production_staff', 'active'),
    (v_tenant_b_id, v_tenantb_admin_user, 'admin',            'active');  -- admin of B only, NOT a member of A

  -- Also register these fake users in public.users so actor_label/email
  -- resolution has something real to find (TEST 14).
  insert into public.users (auth_user_id, user_email, full_name, preferred_name, role, is_active)
  values
    (v_owner_user,  'rehearsal-qob-owner-'  || substr(v_owner_user::text,1,8)  || '@example.test', 'Rehearsal Owner Fullname', 'Reho', 'owner', true),
    (v_admin_user,  'rehearsal-qob-admin-'  || substr(v_admin_user::text,1,8)  || '@example.test', 'Rehearsal Admin Fullname', null,   'admin', true);

  -- public.users.role = 'admin' is the ONLY thing that makes is_app_admin()
  -- true here (via current_user_app_role()) -- this row is the actual
  -- mechanism under test in TEST 22, not just a label lookup convenience.
  -- v_appadmin_user has no tenant_memberships row anywhere (see above).
  insert into public.users (auth_user_id, user_email, full_name, preferred_name, role, is_active)
  values
    (v_appadmin_user, 'rehearsal-qob-appadmin-' || substr(v_appadmin_user::text,1,8) || '@example.test', 'Rehearsal App Admin Fullname', 'RehoAdm', 'admin', true);

  -- Minimal disposable quote directly in tenant A, status='sent' with a
  -- published revision -- accept_quote_on_behalf doesn't care about quote
  -- contents, only tenant_id/status/published_revision_id, so a direct
  -- insert (not save_opps_quote_with_items) keeps this fixture focused on
  -- exactly what's under test.
  insert into public.opps_quotes (
    tenant_id, quote_number, status, customer_name, currency_code,
    subtotal, discount_total, shipping_charge, tax_total, total,
    created_by, updated_by
  ) values (
    v_tenant_a_id, 'REHEARSAL-QOB-' || substr(v_owner_user::text,1,8), 'draft', 'Rehearsal Customer', 'ZAR',
    100, 0, 0, 0, 100,
    v_owner_user, v_owner_user
  ) returning id into v_quote_id;

  insert into public.opps_quote_revisions (quote_id, tenant_id, revision_number, snapshot, totals, created_by)
  values (v_quote_id, v_tenant_a_id, 1, '{}'::jsonb, '{}'::jsonb, v_owner_user)
  returning id into v_revision_id;

  update public.opps_quotes
     set current_revision_id = v_revision_id,
         published_revision_id = v_revision_id,
         status = 'sent'
   where id = v_quote_id;

  -- Two more disposable quotes, same shape as above, dedicated to the new
  -- TEST 21 (tenant admin success) and TEST 22 (app-admin success) --
  -- each mutates its quote to 'accepted', so neither can share v_quote_id
  -- without disturbing TEST 1/15's already-established timeline on it.
  insert into public.opps_quotes (
    tenant_id, quote_number, status, customer_name, currency_code,
    subtotal, discount_total, shipping_charge, tax_total, total,
    created_by, updated_by
  ) values (
    v_tenant_a_id, 'REHEARSAL-QOB2-' || substr(v_owner_user::text,1,8), 'draft', 'Rehearsal Customer 2', 'ZAR',
    100, 0, 0, 0, 100,
    v_owner_user, v_owner_user
  ) returning id into v_quote2_id;

  insert into public.opps_quote_revisions (quote_id, tenant_id, revision_number, snapshot, totals, created_by)
  values (v_quote2_id, v_tenant_a_id, 1, '{}'::jsonb, '{}'::jsonb, v_owner_user)
  returning id into v_revision2_id;

  update public.opps_quotes
     set current_revision_id = v_revision2_id,
         published_revision_id = v_revision2_id,
         status = 'sent'
   where id = v_quote2_id;

  insert into public.opps_quotes (
    tenant_id, quote_number, status, customer_name, currency_code,
    subtotal, discount_total, shipping_charge, tax_total, total,
    created_by, updated_by
  ) values (
    v_tenant_a_id, 'REHEARSAL-QOB3-' || substr(v_owner_user::text,1,8), 'draft', 'Rehearsal Customer 3', 'ZAR',
    100, 0, 0, 0, 100,
    v_owner_user, v_owner_user
  ) returning id into v_quote3_id;

  insert into public.opps_quote_revisions (quote_id, tenant_id, revision_number, snapshot, totals, created_by)
  values (v_quote3_id, v_tenant_a_id, 1, '{}'::jsonb, '{}'::jsonb, v_owner_user)
  returning id into v_revision3_id;

  update public.opps_quotes
     set current_revision_id = v_revision3_id,
         published_revision_id = v_revision3_id,
         status = 'sent'
   where id = v_quote3_id;

  raise notice '--- fixtures ready: tenant_a=%, tenant_b=%, quote=%, revision=%, quote2=%, quote3=% ---', v_tenant_a_id, v_tenant_b_id, v_quote_id, v_revision_id, v_quote2_id, v_quote3_id;

  -- ============================================================
  -- TEST 5/6: missing / invalid source rejected BEFORE the role check
  -- would even matter -- run these first, as the owner, so a failure here
  -- can't be confused with an authorization failure.
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_user, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    perform public.accept_quote_on_behalf(v_quote_id, 1, null, null);
    raise exception 'TEST 5 FAILED: missing approval source was accepted';
  exception when others then
    if sqlerrm not like 'QUOTE_APPROVAL_SOURCE_REQUIRED%' then
      raise exception 'TEST 5 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 5 passed: missing source rejected (%)', sqlerrm;
  end;

  begin
    perform public.accept_quote_on_behalf(v_quote_id, 1, 'carrier_pigeon', null);
    raise exception 'TEST 6 FAILED: invalid approval source was accepted';
  exception when others then
    if sqlerrm not like 'QUOTE_APPROVAL_SOURCE_REQUIRED%' then
      raise exception 'TEST 6 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 6 passed: invalid source rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 2: ordinary member rejected
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_member_user, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.accept_quote_on_behalf(v_quote_id, 1, 'whatsapp', null);
    raise exception 'TEST 2 FAILED: member role was accepted';
  exception when others then
    if sqlerrm not like 'QUOTE_APPROVAL_ON_BEHALF_DENIED%' then
      raise exception 'TEST 2 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 2 passed: member rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 3: ordinary staff rejected
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_user, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.accept_quote_on_behalf(v_quote_id, 1, 'whatsapp', null);
    raise exception 'TEST 3 FAILED: staff role was accepted';
  exception when others then
    if sqlerrm not like 'QUOTE_APPROVAL_ON_BEHALF_DENIED%' then
      raise exception 'TEST 3 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 3 passed: staff rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 4: cross-tenant rejected (owner of tenant B, not a member of A)
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_crosstenant_user, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.accept_quote_on_behalf(v_quote_id, 1, 'whatsapp', null);
    raise exception 'TEST 4 FAILED: cross-tenant owner was accepted';
  exception when others then
    if sqlerrm not like 'QUOTE_APPROVAL_ON_BEHALF_DENIED%' then
      raise exception 'TEST 4 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 4 passed: cross-tenant owner rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 17: finance role rejected (active membership, wrong tenant_role)
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_finance_user, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.accept_quote_on_behalf(v_quote_id, 1, 'whatsapp', null);
    raise exception 'TEST 17 FAILED: finance role was accepted';
  exception when others then
    if sqlerrm not like 'QUOTE_APPROVAL_ON_BEHALF_DENIED%' then
      raise exception 'TEST 17 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 17 passed: finance rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 18: production_staff role rejected
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_prodstaff_user, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.accept_quote_on_behalf(v_quote_id, 1, 'whatsapp', null);
    raise exception 'TEST 18 FAILED: production_staff role was accepted';
  exception when others then
    if sqlerrm not like 'QUOTE_APPROVAL_ON_BEHALF_DENIED%' then
      raise exception 'TEST 18 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 18 passed: production_staff rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 19: manager role rejected
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager_user, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.accept_quote_on_behalf(v_quote_id, 1, 'whatsapp', null);
    raise exception 'TEST 19 FAILED: manager role was accepted';
  exception when others then
    if sqlerrm not like 'QUOTE_APPROVAL_ON_BEHALF_DENIED%' then
      raise exception 'TEST 19 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 19 passed: manager rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 20: literal cross-tenant ADMIN rejected (admin of tenant B,
  -- quote belongs to tenant A -- distinct from TEST 4, which used an
  -- owner of B; this proves tenant_id scoping, not just role, gates
  -- the tenant_memberships branch)
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_tenantb_admin_user, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.accept_quote_on_behalf(v_quote_id, 1, 'whatsapp', null);
    raise exception 'TEST 20 FAILED: cross-tenant admin was accepted';
  exception when others then
    if sqlerrm not like 'QUOTE_APPROVAL_ON_BEHALF_DENIED%' then
      raise exception 'TEST 20 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 20 passed: cross-tenant admin rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 16: stale revision rejected (as the real owner, wrong revision number)
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_user, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.accept_quote_on_behalf(v_quote_id, 999, 'whatsapp', null);
    raise exception 'TEST 16 FAILED: stale/wrong revision number was accepted';
  exception when others then
    if sqlerrm not like 'QUOTE_PUBLISHED_REVISION_CHANGED%' then
      raise exception 'TEST 16 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 16 passed: stale revision rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 1 + 7-14: owner succeeds, and every field is correct
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_user, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select public.accept_quote_on_behalf(v_quote_id, 1, 'whatsapp', 'Confirmed by client on WhatsApp')
    into v_result;

  if (v_result->>'ok')::boolean is distinct from true then
    raise exception 'TEST 1 FAILED: owner call did not succeed: %', v_result;
  end if;
  raise notice 'TEST 1 passed: owner/admin (owner) succeeded';

  -- Verification reads must run as the privileged role, not as the
  -- disposable 'authenticated' test identity -- RLS on opps_quotes/
  -- opps_quote_events otherwise filters these SELECTs out entirely.
  execute 'reset role';

  select * into v_quote_row from public.opps_quotes where id = v_quote_id;
  if not found then
    raise exception 'TEST 1 FAILED: quote row not found after reset role (id=%)', v_quote_id;
  end if;

  if v_quote_row.status is distinct from 'accepted' then
    raise exception 'TEST 1b FAILED: status is not accepted, got %', v_quote_row.status;
  end if;

  if v_quote_row.accepted_actor_kind is distinct from 'staff' then
    raise exception 'TEST 7 FAILED: accepted_actor_kind expected staff, got %', v_quote_row.accepted_actor_kind;
  end if;
  raise notice 'TEST 7 passed: accepted_actor_kind = staff';

  if v_quote_row.accepted_actor_user_id is distinct from v_owner_user then
    raise exception 'TEST 8 FAILED: accepted_actor_user_id mismatch (expected %, got %)', v_owner_user, v_quote_row.accepted_actor_user_id;
  end if;
  raise notice 'TEST 8 passed: accepted_actor_user_id = auth.uid()';

  if v_quote_row.accepted_ack_name is not null or v_quote_row.accepted_ack_email is not null then
    raise exception 'TEST 9 FAILED: accepted_ack_name/email should be null, got name=% email=%', v_quote_row.accepted_ack_name, v_quote_row.accepted_ack_email;
  end if;
  raise notice 'TEST 9 passed: accepted_ack_name/email remain null';

  if v_quote_row.accepted_revision_id is distinct from v_revision_id then
    raise exception 'TEST 10 FAILED: accepted_revision_id does not equal published_revision_id';
  end if;
  raise notice 'TEST 10 passed: accepted revision = published revision';

  select * into v_event_row
  from public.opps_quote_events
  where quote_id = v_quote_id and event_type = 'accepted' and actor_kind = 'staff'
  order by created_at desc limit 1;
  if not found then
    raise exception 'TEST 11 FAILED: event row not found after reset role (quote_id=%)', v_quote_id;
  end if;

  if v_event_row.id is null then
    raise exception 'TEST 11 FAILED: no matching opps_quote_events row found';
  end if;
  raise notice 'TEST 11 passed: event row written';

  if v_event_row.metadata->>'approval_mode' is distinct from 'on_behalf' then
    raise exception 'TEST 12 FAILED: metadata.approval_mode expected on_behalf, got %', v_event_row.metadata->>'approval_mode';
  end if;
  raise notice 'TEST 12 passed: event metadata approval_mode = on_behalf';

  if v_event_row.metadata->>'approval_source' is distinct from 'whatsapp' then
    raise exception 'TEST 13 FAILED: metadata.approval_source expected whatsapp, got %', v_event_row.metadata->>'approval_source';
  end if;
  raise notice 'TEST 13 passed: event metadata approval_source correct';

  if v_event_row.actor_label is distinct from 'Reho' then
    raise exception 'TEST 14 FAILED: actor_label expected preferred_name "Reho", got %', v_event_row.actor_label;
  end if;
  if v_event_row.actor_email is null then
    raise exception 'TEST 14 FAILED: actor_email is null, expected the owner user''s email';
  end if;
  raise notice 'TEST 14 passed: actor label/email correct (label=%, email=%)', v_event_row.actor_label, v_event_row.actor_email;

  -- ============================================================
  -- TEST 15: second acceptance rejected (quote is now 'accepted')
  -- ============================================================
  perform set_config('role', 'authenticated', true);
  begin
    perform public.accept_quote_on_behalf(v_quote_id, 1, 'whatsapp', null);
    raise exception 'TEST 15 FAILED: second acceptance was accepted';
  exception when others then
    if sqlerrm not like 'QUOTE_NOT_ACCEPTABLE%' then
      raise exception 'TEST 15 FAILED: wrong error: %', sqlerrm;
    end if;
    raise notice 'TEST 15 passed: second acceptance rejected (%)', sqlerrm;
  end;

  -- ============================================================
  -- TEST 21: tenant admin succeeds (v_admin_user was already fixtured
  -- for this since the original rehearsal, but never exercised -- this
  -- closes that gap). Runs on quote2 so quote1's accepted/re-accept
  -- timeline from TEST 1/15 above is untouched.
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_user, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select public.accept_quote_on_behalf(v_quote2_id, 1, 'phone', 'Confirmed by client on a call')
    into v_result;

  if (v_result->>'ok')::boolean is distinct from true then
    raise exception 'TEST 21 FAILED: admin call did not succeed: %', v_result;
  end if;

  -- Verification read must run as the privileged role -- see TEST 1.
  execute 'reset role';

  select * into v_quote_row from public.opps_quotes where id = v_quote2_id;
  if not found then
    raise exception 'TEST 21 FAILED: quote row not found after reset role (id=%)', v_quote2_id;
  end if;

  if v_quote_row.status is distinct from 'accepted' then
    raise exception 'TEST 21 FAILED: status is not accepted, got %', v_quote_row.status;
  end if;
  if v_quote_row.accepted_actor_kind is distinct from 'staff' then
    raise exception 'TEST 21 FAILED: accepted_actor_kind expected staff, got %', v_quote_row.accepted_actor_kind;
  end if;
  if v_quote_row.accepted_actor_user_id is distinct from v_admin_user then
    raise exception 'TEST 21 FAILED: accepted_actor_user_id mismatch (expected %, got %)', v_admin_user, v_quote_row.accepted_actor_user_id;
  end if;
  if v_quote_row.accepted_ack_name is not null or v_quote_row.accepted_ack_email is not null then
    raise exception 'TEST 21 FAILED: accepted_ack_name/email should be null, got name=% email=%', v_quote_row.accepted_ack_name, v_quote_row.accepted_ack_email;
  end if;
  if v_quote_row.accepted_revision_id is distinct from v_revision2_id then
    raise exception 'TEST 21 FAILED: accepted_revision_id does not equal published_revision_id';
  end if;
  raise notice 'TEST 21 passed: tenant admin succeeded, all fields correct';

  -- ============================================================
  -- TEST 22: app admin succeeds via public.users.role = 'admin', with
  -- ZERO tenant_memberships row on the QUOTE'S OWN tenant (tenant A) --
  -- proves the is_app_admin() bypass in the RPC works independent of the
  -- tenant-membership check, not just "also happens to pass it". Note:
  -- inserting this fixture row also auto-creates a tenant_memberships row
  -- on the real production 'joint-x' tenant via
  -- add_internal_user_to_joint_x_team() -- that is expected, unrelated
  -- production behavior and is deliberately NOT what this guard checks;
  -- only tenant A (the quote's own tenant) matters for this RPC's
  -- authorization predicate. Runs on quote3, its own disposable row.
  -- ============================================================
  if exists (
    select 1 from public.tenant_memberships
    where auth_user_id = v_appadmin_user
      and tenant_id = v_tenant_a_id
  ) then
    raise exception 'TEST 22 FIXTURE BROKEN: app-admin user unexpectedly has membership on the quote tenant';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_appadmin_user, 'email', 'nobody@example.test', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select public.accept_quote_on_behalf(v_quote3_id, 1, 'email', 'Confirmed by client via email')
    into v_result;

  if (v_result->>'ok')::boolean is distinct from true then
    raise exception 'TEST 22 FAILED: app-admin call did not succeed: %', v_result;
  end if;

  -- Verification read must run as the privileged role -- see TEST 1.
  execute 'reset role';

  select * into v_quote_row from public.opps_quotes where id = v_quote3_id;
  if not found then
    raise exception 'TEST 22 FAILED: quote row not found after reset role (id=%)', v_quote3_id;
  end if;

  if v_quote_row.status is distinct from 'accepted' then
    raise exception 'TEST 22 FAILED: status is not accepted, got %', v_quote_row.status;
  end if;
  if v_quote_row.accepted_actor_kind is distinct from 'staff' then
    raise exception 'TEST 22 FAILED: accepted_actor_kind expected staff (not app_admin/admin), got %', v_quote_row.accepted_actor_kind;
  end if;
  if v_quote_row.accepted_actor_user_id is distinct from v_appadmin_user then
    raise exception 'TEST 22 FAILED: accepted_actor_user_id mismatch (expected %, got %)', v_appadmin_user, v_quote_row.accepted_actor_user_id;
  end if;
  if v_quote_row.accepted_ack_name is not null or v_quote_row.accepted_ack_email is not null then
    raise exception 'TEST 22 FAILED: accepted_ack_name/email should be null, got name=% email=%', v_quote_row.accepted_ack_name, v_quote_row.accepted_ack_email;
  end if;
  if v_quote_row.accepted_revision_id is distinct from v_revision3_id then
    raise exception 'TEST 22 FAILED: accepted_revision_id does not equal published_revision_id';
  end if;
  raise notice 'TEST 22 passed: app admin (zero tenant membership) succeeded via is_app_admin() bypass, all fields correct';

  raise notice '=== ALL REHEARSAL TESTS PASSED ===';
end $rehearsal_do$;
