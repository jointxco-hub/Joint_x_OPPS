-- ════════════════════════════════════════════════════════════════════
--  QUOTES Q1 — disposable behavioural suite
-- ════════════════════════════════════════════════════════════════════
-- Run AFTER 20260906090000_quotes_q1_canonical_schema.sql against a
-- throwaway Postgres that has the minimal prelude
-- (supabase/tests/quotes_q1_disposable_prelude.sql): roles anon/authenticated, auth.uid()
-- /auth.jwt(), tenants / users / tenant_memberships / clients /
-- opps_invoices stubs, and the four RLS helpers
-- (can_access_tenant / is_app_admin / is_opps_staff / user_finance_level).
--
-- Every scenario raises on failure and NOTICEs 'PASS n: ...' on success.
-- 17 scenarios. No external state; self-cleaning.
-- ════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

-- ── seed disposable tenants + identities (as the migration owner) ────
do $seed$
declare
  v_tenant_jx  uuid;
  v_tenant_b   uuid;
begin
  delete from public.opps_quote_events where quote_id in (select id from public.opps_quotes where quote_number like 'QT-%' or quote_number like 'ZT-%');
  delete from public.opps_quote_revisions where quote_id in (select id from public.opps_quotes);
  delete from public.opps_quote_items where quote_id in (select id from public.opps_quotes);
  delete from public.opps_quotes;
  delete from public.opps_quote_number_sequences;
  delete from public.opps_quote_number_config;
  delete from public.tenant_memberships where auth_user_id in (
    '00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-0000000000a3');
  delete from public.users where auth_user_id in (
    '00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-0000000000a3');
  delete from auth.users where id in (
    '00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-0000000000a3');
  delete from public.clients where email in ('q1-client-a@example.test');
  delete from public.tenants where slug in ('joint-x','q1-tenant-b');

  insert into public.tenants (slug, name, status) values ('joint-x','Joint X','active') returning id into v_tenant_jx;
  insert into public.tenants (slug, name, status) values ('q1-tenant-b','Q1 Tenant B','active') returning id into v_tenant_b;

  insert into auth.users (id, email) values
    ('00000000-0000-4000-8000-0000000000a1','q1-staff@example.test'),
    ('00000000-0000-4000-8000-0000000000a2','q1-tenantb@example.test'),
    ('00000000-0000-4000-8000-0000000000a3','q1-outsider@example.test');

  -- a1 = Joint X finance/admin staff; a2 = admin but only in tenant B; a3 = nobody
  insert into public.users (auth_user_id, user_email, full_name, role, is_active) values
    ('00000000-0000-4000-8000-0000000000a1','q1-staff@example.test','Q1 Staff','admin',true),
    ('00000000-0000-4000-8000-0000000000a2','q1-tenantb@example.test','Q1 Tenant B','admin',true),
    ('00000000-0000-4000-8000-0000000000a3','q1-outsider@example.test','Q1 Outsider','user',true);

  insert into public.tenant_memberships (auth_user_id, tenant_id, status) values
    ('00000000-0000-4000-8000-0000000000a1', v_tenant_jx, 'active'),
    ('00000000-0000-4000-8000-0000000000a2', v_tenant_b,  'active');

  insert into public.clients (tenant_id, name, email) values (v_tenant_jx, 'Q1 Client A', 'q1-client-a@example.test');

  raise notice 'SEED ok: joint-x=% tenant-b=%', v_tenant_jx, v_tenant_b;
end
$seed$;

-- helper: resolve ids the scenarios reuse
create temporary table _q1_ctx as
select
  (select id from public.tenants where slug = 'joint-x')     as tenant_jx,
  (select id from public.tenants where slug = 'q1-tenant-b') as tenant_b,
  '00000000-0000-4000-8000-0000000000a1'::uuid as staff_uid,
  '00000000-0000-4000-8000-0000000000a2'::uuid as tenantb_uid,
  '00000000-0000-4000-8000-0000000000a3'::uuid as outsider_uid;

-- ═══════════════════════════════════════════════════════════════════
--  1. anon cannot touch any quote table (grant stripped, before RLS)
-- ═══════════════════════════════════════════════════════════════════
do $t$
declare v_denied boolean := false; t text;
begin
  set local role anon;
  perform set_config('test.uid', '', true);
  foreach t in array array['opps_quotes','opps_quote_items','opps_quote_revisions','opps_quote_events','opps_quote_number_config','opps_quote_number_sequences']
  loop
    begin
      execute format('select 1 from public.%I limit 1', t);
      raise exception 'anon could read public.% — FAIL', t;
    exception when insufficient_privilege then
      null; -- expected
    end;
  end loop;
  reset role;
  raise notice 'PASS 1: anon has no read path to any quote table';
end
$t$;

-- ═══════════════════════════════════════════════════════════════════
--  2. staff (Joint X admin) can create a quote via save_opps_quote_with_items
-- ═══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_res jsonb; v_qid uuid; v_num text;
begin
  select * into c from _q1_ctx;
  set local role authenticated;
  perform set_config('test.uid', c.staff_uid::text, true);

  v_res := public.save_opps_quote_with_items(
    c.tenant_jx, null,
    jsonb_build_object('customer_name','Acme Co','currency_code','ZAR','total', 230.00,
                       'shipping_charge', 30.00),
    jsonb_build_array(
      jsonb_build_object('item_name','Tee print','role','product','quantity',10,'rate',20,'discount',0,'tax_percentage',0),
      jsonb_build_object('item_name','Artwork setup','role','setup_fee','quantity',1,'rate',0,'discount',0)
    )
  );
  v_qid := (v_res->>'quote_id')::uuid;
  v_num := v_res->>'quote_number';
  if v_qid is null then raise exception '2: no quote_id returned'; end if;
  if (v_res->>'revision_number')::int <> 1 then raise exception '2: first save must be revision 1'; end if;
  if v_num !~ '^QT-[0-9]{4}-[0-9]{6}$' then raise exception '2: quote_number % not <prefix>-<year>-<6 digits>', v_num; end if;
  if (select status from public.opps_quotes where id = v_qid) <> 'draft' then raise exception '2: new quote not draft'; end if;
  if (select current_revision_id from public.opps_quotes where id = v_qid) is null then raise exception '2: current_revision_id not set'; end if;
  if (select accepted_revision_id from public.opps_quotes where id = v_qid) is not null then raise exception '2: accepted_revision_id must start null'; end if;
  if (select count(*) from public.opps_quote_items where quote_id = v_qid) <> 2 then raise exception '2: items not persisted'; end if;
  if (select count(*) from public.opps_quote_revisions where quote_id = v_qid) <> 1 then raise exception '2: revision not appended'; end if;
  reset role;
  raise notice 'PASS 2: staff create -> quote % rev 1', v_num;
end
$t$;

-- ═══════════════════════════════════════════════════════════════════
--  3. quote-number allocation is tenant/year scoped and monotonic per tenant
-- ═══════════════════════════════════════════════════════════════════
do $t$
declare c record; n1 text; n2 text; y text := extract(year from now())::text;
begin
  select * into c from _q1_ctx;
  set local role authenticated;
  perform set_config('test.uid', c.staff_uid::text, true);
  n1 := (public.save_opps_quote_with_items(c.tenant_jx, null,
          jsonb_build_object('customer_name','N1','total',10), jsonb_build_array(
            jsonb_build_object('item_name','x','quantity',1,'rate',10)))->>'quote_number');
  n2 := (public.save_opps_quote_with_items(c.tenant_jx, null,
          jsonb_build_object('customer_name','N2','total',10), jsonb_build_array(
            jsonb_build_object('item_name','x','quantity',1,'rate',10)))->>'quote_number');
  if split_part(n1,'-',3)::int + 1 <> split_part(n2,'-',3)::int then
    raise exception '3: not monotonic within tenant/year: % then %', n1, n2;
  end if;
  if split_part(n1,'-',2) <> y then raise exception '3: year segment wrong: %', n1; end if;

  -- tenant B gets its OWN counter starting at 1 (proves per-tenant scope)
  perform set_config('test.uid', c.tenantb_uid::text, true);
  declare nb text;
  begin
    nb := (public.save_opps_quote_with_items(c.tenant_b, null,
            jsonb_build_object('customer_name','B1','total',10), jsonb_build_array(
              jsonb_build_object('item_name','x','quantity',1,'rate',10)))->>'quote_number');
    if split_part(nb,'-',3)::int <> 1 then raise exception '3: tenant B counter did not start at 1: %', nb; end if;
  end;

  -- a configured prefix does not change identity or the sequence
  perform set_config('test.uid', c.staff_uid::text, true);
  update public.opps_quote_number_config set prefix = 'ZT' where tenant_id = c.tenant_jx;
  declare nz text;
  begin
    nz := (public.save_opps_quote_with_items(c.tenant_jx, null,
            jsonb_build_object('customer_name','Z','total',10), jsonb_build_array(
              jsonb_build_object('item_name','x','quantity',1,'rate',10)))->>'quote_number');
    if nz !~ '^ZT-[0-9]{4}-[0-9]{6}$' then raise exception '3: prefix change not honoured: %', nz; end if;
    -- nz is the next Joint X quote after n2 (tenant B used its own counter):
    -- the prefix flip must not perturb the (tenant, year) sequence.
    if split_part(nz,'-',3)::int <> split_part(n2,'-',3)::int + 1 then raise exception '3: prefix change disturbed the counter (n2=% nz=%)', n2, nz; end if;
  end;
  update public.opps_quote_number_config set prefix = 'QT' where tenant_id = c.tenant_jx;
  reset role;
  raise notice 'PASS 3: numbering is per-tenant/year, prefix is config not identity';
end
$t$;

-- ═══════════════════════════════════════════════════════════════════
--  4. cross-tenant write is refused (RLS with check)
-- ═══════════════════════════════════════════════════════════════════
do $t$
declare c record;
begin
  select * into c from _q1_ctx;
  set local role authenticated;
  perform set_config('test.uid', c.tenantb_uid::text, true);   -- tenant B admin
  begin
    perform public.save_opps_quote_with_items(c.tenant_jx, null,     -- ...targeting Joint X
      jsonb_build_object('customer_name','x','total',10),
      jsonb_build_array(jsonb_build_object('item_name','x','quantity',1,'rate',10)));
    raise exception '4: tenant B wrote a Joint X quote — FAIL';
  exception when others then
    if sqlerrm not like '%QUOTE_ACCESS_DENIED%' and sqlerrm not like '%row-level security%' then
      raise exception '4: wrong failure mode: %', sqlerrm;
    end if;
  end;
  reset role;
  raise notice 'PASS 4: cross-tenant quote write refused';
end
$t$;

-- ═══════════════════════════════════════════════════════════════════
--  5. outsider (no membership) cannot read Joint X quotes (restrictive is_opps_staff)
-- ═══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_seen int;
begin
  select * into c from _q1_ctx;
  set local role authenticated;
  perform set_config('test.uid', c.outsider_uid::text, true);
  select count(*) into v_seen from public.opps_quotes;
  if v_seen <> 0 then raise exception '5: outsider saw % quote rows', v_seen; end if;
  reset role;
  raise notice 'PASS 5: non-staff sees zero quotes';
end
$t$;

-- ═══════════════════════════════════════════════════════════════════
--  6. each successful save appends a new revision; current repoints; prior untouched
-- ═══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_qid uuid; v_res jsonb; v_rev1 uuid; v_rev1_snap jsonb; v_upd timestamptz;
begin
  select * into c from _q1_ctx;
  set local role authenticated;
  perform set_config('test.uid', c.staff_uid::text, true);

  v_res := public.save_opps_quote_with_items(c.tenant_jx, null,
    jsonb_build_object('customer_name','Rev Co','total',100),
    jsonb_build_array(jsonb_build_object('item_name','a','quantity',1,'rate',100)));
  v_qid := (v_res->>'quote_id')::uuid;
  select current_revision_id, updated_at into v_rev1, v_upd from public.opps_quotes where id = v_qid;
  select snapshot into v_rev1_snap from public.opps_quote_revisions where id = v_rev1;

  v_res := public.save_opps_quote_with_items(c.tenant_jx, v_qid,
    jsonb_build_object('customer_name','Rev Co','total',250),
    jsonb_build_array(jsonb_build_object('item_name','a','quantity',1,'rate',250)),
    v_upd, 1);

  if (v_res->>'revision_number')::int <> 2 then raise exception '6: second save not revision 2'; end if;
  if (select count(*) from public.opps_quote_revisions where quote_id = v_qid) <> 2 then raise exception '6: revision count != 2'; end if;
  if (select current_revision_id from public.opps_quotes where id = v_qid) = v_rev1 then raise exception '6: current_revision_id did not move'; end if;
  if (select snapshot from public.opps_quote_revisions where id = v_rev1) is distinct from v_rev1_snap then
    raise exception '6: revision 1 snapshot changed';
  end if;
  if (select (snapshot->>'total')::numeric from public.opps_quote_revisions where id = v_rev1) <> 100 then
    raise exception '6: revision 1 total mutated';
  end if;
  reset role;
  raise notice 'PASS 6: save appends immutable revisions, prior snapshot frozen';
end
$t$;

-- ═══════════════════════════════════════════════════════════════════
--  7. revisions cannot be UPDATEd (trigger) even by staff
-- ═══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_rid uuid;
begin
  select * into c from _q1_ctx;
  set local role authenticated;
  perform set_config('test.uid', c.staff_uid::text, true);
  select id into v_rid from public.opps_quote_revisions limit 1;
  begin
    update public.opps_quote_revisions set snapshot = '{}'::jsonb where id = v_rid;
    raise exception '7: revision UPDATE succeeded — FAIL';
  exception when others then
    if sqlerrm not like '%QUOTE_REVISION_IMMUTABLE%' and sqlerrm not like '%permission denied%' then
      raise exception '7: wrong failure: %', sqlerrm;
    end if;
  end;
  reset role;
  raise notice 'PASS 7: revision UPDATE refused';
end
$t$;

-- ═══════════════════════════════════════════════════════════════════
--  8. revisions cannot be DELETEd directly (trigger) — but cascade on quote delete works
-- ═══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_qid uuid; v_rid uuid; v_before int;
begin
  select * into c from _q1_ctx;
  set local role authenticated;
  perform set_config('test.uid', c.staff_uid::text, true);
  select r.id, r.quote_id into v_rid, v_qid from public.opps_quote_revisions r limit 1;

  begin
    delete from public.opps_quote_revisions where id = v_rid;
    raise exception '8: direct revision DELETE succeeded — FAIL';
  exception when others then
    if sqlerrm not like '%QUOTE_REVISION_IMMUTABLE%' and sqlerrm not like '%permission denied%' then
      raise exception '8: wrong failure: %', sqlerrm;
    end if;
  end;

  -- cascade path: deleting the parent quote must still clean its revisions
  set local role postgres;   -- deletes need owner (authenticated has DELETE on quotes but not revisions)
  select count(*) into v_before from public.opps_quote_revisions where quote_id = v_qid;
  delete from public.opps_quotes where id = v_qid;
  if (select count(*) from public.opps_quote_revisions where quote_id = v_qid) <> 0 then
    raise exception '8: cascade did not remove % child revisions', v_before;
  end if;
  reset role;
  raise notice 'PASS 8: direct revision DELETE refused; parent-cascade still clears them';
end
$t$;

-- ═══════════════════════════════════════════════════════════════════
--  9. stale optimistic-lock save fails
-- ═══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_qid uuid;
begin
  select * into c from _q1_ctx;
  set local role authenticated;
  perform set_config('test.uid', c.staff_uid::text, true);
  v_qid := (public.save_opps_quote_with_items(c.tenant_jx, null,
    jsonb_build_object('customer_name','Lock','total',10),
    jsonb_build_array(jsonb_build_object('item_name','x','quantity',1,'rate',10)))->>'quote_id')::uuid;
  begin
    perform public.save_opps_quote_with_items(c.tenant_jx, v_qid,
      jsonb_build_object('customer_name','Lock','total',10),
      jsonb_build_array(jsonb_build_object('item_name','x','quantity',1,'rate',10)),
      now() - interval '1 day', 1);
    raise exception '9: stale save succeeded — FAIL';
  exception when others then
    if sqlerrm not like '%QUOTE_STALE_VERSION%' then raise exception '9: wrong failure: %', sqlerrm; end if;
  end;
  reset role;
  raise notice 'PASS 9: stale updated_at rejected';
end
$t$;

-- ═══════════════════════════════════════════════════════════════════
-- 10. expected-item-count mismatch fails
-- ═══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_qid uuid; v_upd timestamptz;
begin
  select * into c from _q1_ctx;
  set local role authenticated;
  perform set_config('test.uid', c.staff_uid::text, true);
  v_qid := (public.save_opps_quote_with_items(c.tenant_jx, null,
    jsonb_build_object('customer_name','Cnt','total',20),
    jsonb_build_array(jsonb_build_object('item_name','x','quantity',2,'rate',10)))->>'quote_id')::uuid;
  select updated_at into v_upd from public.opps_quotes where id = v_qid;
  begin
    perform public.save_opps_quote_with_items(c.tenant_jx, v_qid,
      jsonb_build_object('customer_name','Cnt','total',20),
      jsonb_build_array(jsonb_build_object('item_name','x','quantity',2,'rate',10)),
      v_upd, 5);   -- says 5, really 1
    raise exception '10: count mismatch not caught — FAIL';
  exception when others then
    if sqlerrm not like '%QUOTE_ITEM_COUNT_CHANGED%' then raise exception '10: wrong failure: %', sqlerrm; end if;
  end;
  reset role;
  raise notice 'PASS 10: expected-item-count guard fires';
end
$t$;

-- ═══════════════════════════════════════════════════════════════════
-- 11. total mismatch > R0.02 fails; <= R0.02 passes; override needs a reason
-- ═══════════════════════════════════════════════════════════════════
do $t$
declare c record;
begin
  select * into c from _q1_ctx;
  set local role authenticated;
  perform set_config('test.uid', c.staff_uid::text, true);

  -- 3c drift -> rejected
  begin
    perform public.save_opps_quote_with_items(c.tenant_jx, null,
      jsonb_build_object('customer_name','T','total', 100.03),
      jsonb_build_array(jsonb_build_object('item_name','x','quantity',1,'rate',100)));
    raise exception '11: R0.03 drift accepted — FAIL';
  exception when others then
    if sqlerrm not like '%QUOTE_TOTAL_MISMATCH%' then raise exception '11a wrong failure: %', sqlerrm; end if;
  end;

  -- 2c drift -> accepted
  perform public.save_opps_quote_with_items(c.tenant_jx, null,
    jsonb_build_object('customer_name','T','total', 100.02),
    jsonb_build_array(jsonb_build_object('item_name','x','quantity',1,'rate',100)));

  -- big drift + override but no reason -> rejected
  begin
    perform public.save_opps_quote_with_items(c.tenant_jx, null,
      jsonb_build_object('customer_name','T','total', 999),
      jsonb_build_array(jsonb_build_object('item_name','x','quantity',1,'rate',100)),
      null, null, true);
    raise exception '11: override without reason accepted — FAIL';
  exception when others then
    if sqlerrm not like '%QUOTE_TOTAL_OVERRIDE_REASON_REQUIRED%' then raise exception '11c wrong failure: %', sqlerrm; end if;
  end;

  -- big drift + override + reason -> accepted, override recorded
  declare v_qid uuid;
  begin
    v_qid := (public.save_opps_quote_with_items(c.tenant_jx, null,
      jsonb_build_object('customer_name','T','total', 999, 'total_override_reason','client agreed bundle price'),
      jsonb_build_array(jsonb_build_object('item_name','x','quantity',1,'rate',100)),
      null, null, true)->>'quote_id')::uuid;
    if (select total_override_reason from public.opps_quotes where id = v_qid) is null then
      raise exception '11: override reason not stored';
    end if;
  end;
  reset role;
  raise notice 'PASS 11: R0.02 total invariant + reasoned override';
end
$t$;

-- ═══════════════════════════════════════════════════════════════════
-- 12. non-numeric quantity is refused cleanly
-- ═══════════════════════════════════════════════════════════════════
do $t$
declare c record;
begin
  select * into c from _q1_ctx;
  set local role authenticated;
  perform set_config('test.uid', c.staff_uid::text, true);
  begin
    perform public.save_opps_quote_with_items(c.tenant_jx, null,
      jsonb_build_object('customer_name','x','total',10),
      jsonb_build_array(jsonb_build_object('item_name','x','quantity','abc','rate',10)));
    raise exception '12: non-numeric quantity accepted — FAIL';
  exception when others then
    if sqlerrm not like '%QUOTE_ITEM_INVALID_VALUES%' then raise exception '12: wrong failure: %', sqlerrm; end if;
  end;
  -- zero / negative quantity too
  begin
    perform public.save_opps_quote_with_items(c.tenant_jx, null,
      jsonb_build_object('customer_name','x','total',0),
      jsonb_build_array(jsonb_build_object('item_name','x','quantity',0,'rate',10)));
    raise exception '12: zero quantity accepted — FAIL';
  exception when others then
    if sqlerrm not like '%QUOTE_ITEM_INVALID_VALUES%' then raise exception '12b wrong failure: %', sqlerrm; end if;
  end;
  reset role;
  raise notice 'PASS 12: non-numeric / non-positive quantity refused';
end
$t$;

-- ═══════════════════════════════════════════════════════════════════
-- 13. an accepted quote cannot be silently edited by save_
-- ═══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_qid uuid; v_rid uuid; v_upd timestamptz;
begin
  select * into c from _q1_ctx;
  set local role authenticated;
  perform set_config('test.uid', c.staff_uid::text, true);
  v_qid := (public.save_opps_quote_with_items(c.tenant_jx, null,
    jsonb_build_object('customer_name','Acc','total',50),
    jsonb_build_array(jsonb_build_object('item_name','x','quantity',1,'rate',50)))->>'quote_id')::uuid;
  select current_revision_id into v_rid from public.opps_quotes where id = v_qid;

  -- simulate the Q4 accept: point accepted_revision_id at the (already immutable) current revision
  update public.opps_quotes
     set status = 'accepted', accepted_revision_id = v_rid, accepted_at = now(),
         accepted_actor_kind = 'public_link', accepted_ack_name = 'Jordan Buyer'
   where id = v_qid;

  select updated_at into v_upd from public.opps_quotes where id = v_qid;
  begin
    perform public.save_opps_quote_with_items(c.tenant_jx, v_qid,
      jsonb_build_object('customer_name','Acc','total',999),
      jsonb_build_array(jsonb_build_object('item_name','x','quantity',1,'rate',999)),
      v_upd, 1);
    raise exception '13: accepted quote was edited — FAIL';
  exception when others then
    if sqlerrm not like '%QUOTE_NOT_EDITABLE%' then raise exception '13: wrong failure: %', sqlerrm; end if;
  end;

  -- the accepted revision snapshot is still the original
  if (select (snapshot->>'total')::numeric from public.opps_quote_revisions where id = v_rid) <> 50 then
    raise exception '13: accepted revision snapshot changed';
  end if;
  reset role;
  raise notice 'PASS 13: accepted quote is locked to save_; accepted revision frozen';
end
$t$;

-- ═══════════════════════════════════════════════════════════════════
-- 14. converted / declined quotes are likewise locked
-- ═══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_qid uuid; v_upd timestamptz; st text;
begin
  select * into c from _q1_ctx;
  set local role authenticated;
  perform set_config('test.uid', c.staff_uid::text, true);
  foreach st in array array['converted','declined']
  loop
    v_qid := (public.save_opps_quote_with_items(c.tenant_jx, null,
      jsonb_build_object('customer_name','L','total',10),
      jsonb_build_array(jsonb_build_object('item_name','x','quantity',1,'rate',10)))->>'quote_id')::uuid;
    update public.opps_quotes set status = st where id = v_qid;
    select updated_at into v_upd from public.opps_quotes where id = v_qid;
    begin
      perform public.save_opps_quote_with_items(c.tenant_jx, v_qid,
        jsonb_build_object('customer_name','L','total',20),
        jsonb_build_array(jsonb_build_object('item_name','x','quantity',2,'rate',10)),
        v_upd, 1);
      raise exception '14: % quote edited — FAIL', st;
    exception when others then
      if sqlerrm not like '%QUOTE_NOT_EDITABLE%' then raise exception '14 (%): wrong failure: %', st, sqlerrm; end if;
    end;
  end loop;
  reset role;
  raise notice 'PASS 14: converted + declined quotes are locked to save_';
end
$t$;

-- ═══════════════════════════════════════════════════════════════════
-- 15. _quote_document_projection: customer-safe shape, accepted-rev-first, no internal keys
-- ═══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_qid uuid; v_doc jsonb; k text;
begin
  select * into c from _q1_ctx;
  set local role authenticated;
  perform set_config('test.uid', c.staff_uid::text, true);
  v_qid := (public.save_opps_quote_with_items(c.tenant_jx, null,
    jsonb_build_object('customer_name','Proj Co','customer_email','secret@buyer.test',
                       'customer_billing_address','12 Main Rd','notes','INTERNAL: chase deposit','total', 300),
    jsonb_build_array(jsonb_build_object(
      'item_name','Hoodie','role','product','quantity',3,'rate',100,'discount',0,'tax_percentage',0,
      'source_client_product_id', gen_random_uuid(),
      'source_metadata', jsonb_build_object(
        'unit_cost', 40, 'margin', 0.6, 'supplier','ACME',
        'price_breakdown', jsonb_build_object('mode','composed','unit_price',100,'reconciled',true,
          'per_unit', jsonb_build_array(
            jsonb_build_object('label','Blank','role','blank','amount',55,'production_method','stock'),
            jsonb_build_object('label','Print','role','print','amount',45,'production_method','DTF','placement','front')
          ))))
    ))->>'quote_id')::uuid;

  -- projection is internal-only: authenticated cannot call it
  begin
    perform public._quote_document_projection(v_qid);
    raise exception '15: _quote_document_projection callable by authenticated — FAIL';
  exception when insufficient_privilege then null;
  end;

  set local role postgres;
  v_doc := public._quote_document_projection(v_qid);
  if v_doc is null then raise exception '15: projection returned null'; end if;
  if v_doc->>'kind' <> 'quote' then raise exception '15: kind not quote'; end if;

  foreach k in array array['tenant_id','customer_id','customer_email','customer_phone','notes',
                           'source_client_product_id','source_metadata','created_by','updated_by',
                           'source_request_id','converted_order_id','converted_invoice_id',
                           'share_token','total_override_reason','internal_notes']
  loop
    if v_doc ? k then raise exception '15: projection leaked key %', k; end if;
  end loop;
  if v_doc::text ~* '(unit_cost|margin|supplier|procurement|"cost")' then
    raise exception '15: projection leaked cost/margin/supplier text';
  end if;

  -- composed breakdown is present, customer-safe (label/role/amount/method/placement only)
  if jsonb_array_length(v_doc#>'{items,0,price_breakdown,per_unit}') <> 2 then
    raise exception '15: composed per_unit not projected';
  end if;
  if (v_doc#>'{items,0,price_breakdown,per_unit,0}') ?| array['cost','margin','supplier'] then
    raise exception '15: per_unit row leaked internal field';
  end if;

  -- accepted revision wins over current
  update public.opps_quotes set current_revision_id =
    (select id from public.opps_quote_revisions where quote_id = v_qid) where id = v_qid;
  -- add a 2nd revision as "current", accept the FIRST
  set local role authenticated;
  perform set_config('test.uid', c.staff_uid::text, true);
  declare v_upd timestamptz; v_first uuid;
  begin
    select id into v_first from public.opps_quote_revisions where quote_id = v_qid order by revision_number limit 1;
    select updated_at into v_upd from public.opps_quotes where id = v_qid;
    perform public.save_opps_quote_with_items(c.tenant_jx, v_qid,
      jsonb_build_object('customer_name','Proj Co','total', 30),
      jsonb_build_array(jsonb_build_object('item_name','cheap','quantity',1,'rate',30)),
      v_upd, 1);
    update public.opps_quotes set status='accepted', accepted_revision_id = v_first, accepted_at = now() where id = v_qid;
  end;
  set local role postgres;
  v_doc := public._quote_document_projection(v_qid);
  if (v_doc->>'total')::numeric <> 300 then raise exception '15: projection did not prefer the accepted revision (got %)', v_doc->>'total'; end if;
  if (v_doc->>'is_accepted_revision')::boolean is not true then raise exception '15: is_accepted_revision flag wrong'; end if;
  reset role;
  raise notice 'PASS 15: projection is internal-only, customer-safe, accepted-revision-first';
end
$t$;

-- ═══════════════════════════════════════════════════════════════════
-- 16. child tenant_id is forced from the parent even if caller lies
-- ═══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_qid uuid;
begin
  select * into c from _q1_ctx;
  set local role postgres;   -- bypass RLS to attempt the tamper directly
  insert into public.opps_quotes (tenant_id, quote_number, customer_name)
    values (c.tenant_jx, 'QT-9999-999999', 'Tamper') returning id into v_qid;
  insert into public.opps_quote_items (quote_id, tenant_id, line_number, item_name, quantity, rate, item_total)
    values (v_qid, c.tenant_b, 1, 'x', 1, 1, 1);   -- lie: claim tenant B
  if (select tenant_id from public.opps_quote_items where quote_id = v_qid) <> c.tenant_jx then
    raise exception '16: child tenant_id not forced from parent';
  end if;
  delete from public.opps_quotes where id = v_qid;
  reset role;
  raise notice 'PASS 16: child rows always inherit the parent quote tenant';
end
$t$;

-- ═══════════════════════════════════════════════════════════════════
-- 17. opps_invoices is structurally untouched by this migration
-- ═══════════════════════════════════════════════════════════════════
do $t$
declare v_has_quote_status boolean;
begin
  -- the invoice status check must not have gained a 'quote' value
  select exists (
    select 1 from pg_constraint
    where conname like '%opps_invoices%' and pg_get_constraintdef(oid) ilike '%''quote''%'
  ) into v_has_quote_status;
  if v_has_quote_status then raise exception '17: opps_invoices status now allows ''quote'''; end if;
  raise notice 'PASS 17: opps_invoices status enum unchanged';
end
$t$;

-- ── cleanup ────────────────────────────────────────────────────────
do $c$
begin
  set local role postgres;
  delete from public.opps_quotes;
  delete from public.opps_quote_number_sequences;
  delete from public.opps_quote_number_config;
  delete from public.tenant_memberships where auth_user_id in (
    '00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-0000000000a3');
  delete from public.users where auth_user_id in (
    '00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-0000000000a3');
  delete from public.clients where email = 'q1-client-a@example.test';
  delete from auth.users where id in (
    '00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-0000000000a3');
  delete from public.tenants where slug in ('joint-x','q1-tenant-b');
  drop table if exists _q1_ctx;
  raise notice 'CLEANUP ok';
end
$c$;
