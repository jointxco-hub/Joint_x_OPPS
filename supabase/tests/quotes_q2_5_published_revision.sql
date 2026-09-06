-- ════════════════════════════════════════════════════════════════════
--  QUOTES Q2.5 — disposable behavioural suite
-- ════════════════════════════════════════════════════════════════════
-- Run AFTER quotes_q1_disposable_prelude.sql + the Q1 migration + the
-- Q2.5 migration (20260906100000_quotes_q2_5_published_revision.sql)
-- against a throwaway Postgres. See quotes_q2_5_run.sh.
--
-- Each scenario raises on failure and NOTICEs 'PASS n: ...' on success.
-- ════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

do $seed$
declare
  v_tenant_jx uuid;
  v_tenant_b  uuid;
begin
  delete from public.opps_quote_events;
  delete from public.opps_quote_revisions;
  delete from public.opps_quote_items;
  delete from public.opps_quotes;
  delete from public.opps_quote_number_sequences;
  delete from public.opps_quote_number_config;
  delete from public.tenant_memberships where auth_user_id in (
    '00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-0000000000b3');
  delete from public.users where auth_user_id in (
    '00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-0000000000b3');
  delete from auth.users where id in (
    '00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-0000000000b3');
  delete from public.clients where email = 'q25-client@example.test';
  delete from public.tenants where slug in ('joint-x','q25-tenant-b');

  insert into public.tenants (slug, name, status) values ('joint-x','Joint X','active') returning id into v_tenant_jx;
  insert into public.tenants (slug, name, status) values ('q25-tenant-b','Q25 Tenant B','active') returning id into v_tenant_b;

  insert into auth.users (id, email) values
    ('00000000-0000-4000-8000-0000000000b1','q25-staff@example.test'),
    ('00000000-0000-4000-8000-0000000000b2','q25-tenantb@example.test'),
    ('00000000-0000-4000-8000-0000000000b3','q25-outsider@example.test');
  insert into public.users (auth_user_id, user_email, full_name, role, is_active) values
    ('00000000-0000-4000-8000-0000000000b1','q25-staff@example.test','Q25 Staff','admin',true),
    ('00000000-0000-4000-8000-0000000000b2','q25-tenantb@example.test','Q25 Tenant B','admin',true),
    ('00000000-0000-4000-8000-0000000000b3','q25-outsider@example.test','Q25 Outsider','user',true);
  insert into public.tenant_memberships (auth_user_id, tenant_id, status) values
    ('00000000-0000-4000-8000-0000000000b1', v_tenant_jx, 'active'),
    ('00000000-0000-4000-8000-0000000000b2', v_tenant_b,  'active');
  insert into public.clients (tenant_id, name, email) values (v_tenant_jx, 'Q25 Client', 'q25-client@example.test');

  raise notice 'SEED ok: joint-x=% tenant-b=%', v_tenant_jx, v_tenant_b;
end
$seed$;

create temporary table _q25 as
select
  (select id from public.tenants where slug = 'joint-x')       as tenant_jx,
  (select id from public.tenants where slug = 'q25-tenant-b')  as tenant_b,
  '00000000-0000-4000-8000-0000000000b1'::uuid as staff_uid,
  '00000000-0000-4000-8000-0000000000b2'::uuid as tenantb_uid,
  '00000000-0000-4000-8000-0000000000b3'::uuid as outsider_uid;

-- helper: create a draft quote (rev 1) as staff, return quote_id
create or replace function pg_temp._q25_new_quote(p_tenant uuid, p_uid uuid, p_total numeric default 100)
returns uuid language plpgsql as $$
declare v_res jsonb;
begin
  perform set_config('test.uid', p_uid::text, true);
  set local role authenticated;
  v_res := public.save_opps_quote_with_items(
    p_tenant, null,
    jsonb_build_object('customer_name','C','currency_code','ZAR','total',p_total),
    jsonb_build_array(jsonb_build_object('item_name','x','role','product','quantity',1,'rate',p_total)));
  reset role;
  return (v_res->>'quote_id')::uuid;
end $$;

create or replace function pg_temp._q25_save(p_tenant uuid, p_uid uuid, p_qid uuid, p_total numeric, p_upd timestamptz, p_cnt int)
returns jsonb language plpgsql as $$
declare v_res jsonb;
begin
  perform set_config('test.uid', p_uid::text, true);
  set local role authenticated;
  v_res := public.save_opps_quote_with_items(
    p_tenant, p_qid,
    jsonb_build_object('customer_name','C','currency_code','ZAR','total',p_total),
    jsonb_build_array(jsonb_build_object('item_name','x','role','product','quantity',1,'rate',p_total)),
    p_upd, p_cnt);
  reset role;
  return v_res;
end $$;

create or replace function pg_temp._q25_send(p_uid uuid, p_qid uuid)
returns jsonb language plpgsql as $$
declare v_res jsonb;
begin
  perform set_config('test.uid', p_uid::text, true);
  set local role authenticated;
  v_res := public.mark_quote_sent(p_qid);
  reset role;
  return v_res;
end $$;

-- ══════════════════════════════════════════════════════════════════
-- 1 + 2. FIRST SEND: published pinned to current, status sent,
--        one 'sent' event with revision_id = published, resend=false,
--        actor_kind=staff, actor_user_id = the staff uid
-- ══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_qid uuid; v_res jsonb; v_cur uuid; v_pub uuid; v_st text; ev record;
begin
  select * into c from _q25;
  v_qid := pg_temp._q25_new_quote(c.tenant_jx, c.staff_uid, 1000);
  select current_revision_id into v_cur from public.opps_quotes where id = v_qid;

  v_res := pg_temp._q25_send(c.staff_uid, v_qid);
  if (v_res->>'ok')::boolean is not true then raise exception '1: send not ok: %', v_res; end if;
  if (v_res->>'no_change')::boolean is not false then raise exception '1: first send reported no_change'; end if;
  if (v_res->>'resend')::boolean is not false then raise exception '1: first send reported resend=true'; end if;
  if (v_res->>'status') <> 'sent' then raise exception '1: status not sent'; end if;

  select published_revision_id, status into v_pub, v_st from public.opps_quotes where id = v_qid;
  if v_pub is distinct from v_cur then raise exception '1: published_revision_id (%) <> current at send (%)', v_pub, v_cur; end if;
  if v_st <> 'sent' then raise exception '1: row status not sent'; end if;

  select * into ev from public.opps_quote_events where quote_id = v_qid and event_type = 'sent';
  if ev.id is null then raise exception '2: no sent event'; end if;
  if ev.revision_id is distinct from v_pub then raise exception '2: sent event revision_id (%) <> published (%)', ev.revision_id, v_pub; end if;
  if ev.actor_kind <> 'staff' then raise exception '2: sent event actor_kind <> staff'; end if;
  if ev.actor_user_id is distinct from c.staff_uid then raise exception '2: sent event actor_user_id <> staff uid'; end if;
  if coalesce((ev.metadata->>'resend')::boolean, true) <> false then raise exception '2: sent event metadata.resend <> false'; end if;

  raise notice 'PASS 1+2: first send pins published=current; sent event revision_id matches, resend=false, actor=staff';
end
$t$;

-- ══════════════════════════════════════════════════════════════════
-- 3 + 4. A save AFTER send moves current only; published stays frozen;
--        hasUnsentChanges is now true (current <> published, status sent)
-- ══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_qid uuid; v_cur1 uuid; v_pub1 uuid; v_upd timestamptz; v_res jsonb; v_cur2 uuid; v_pub2 uuid; v_st text;
begin
  select * into c from _q25;
  v_qid := pg_temp._q25_new_quote(c.tenant_jx, c.staff_uid, 500);
  perform pg_temp._q25_send(c.staff_uid, v_qid);
  select current_revision_id, published_revision_id, updated_at into v_cur1, v_pub1, v_upd from public.opps_quotes where id = v_qid;

  v_res := pg_temp._q25_save(c.tenant_jx, c.staff_uid, v_qid, 650, v_upd, 1);
  if (v_res->>'revision_number')::int <> 2 then raise exception '3: save did not create revision 2'; end if;

  select current_revision_id, published_revision_id, status into v_cur2, v_pub2, v_st from public.opps_quotes where id = v_qid;
  if v_cur2 = v_cur1 then raise exception '3: save did not move current_revision_id'; end if;
  if v_pub2 is distinct from v_pub1 then raise exception '3: save MOVED published_revision_id (must stay frozen)'; end if;
  if v_st <> 'sent' then raise exception '3: save changed status away from sent'; end if;

  -- hasUnsentChanges definition
  if not (v_cur2 <> v_pub2 and v_st in ('sent','viewed','changes_requested')) then
    raise exception '4: expected unsent-changes state (current<>published, status sent)';
  end if;
  -- published revision total still the sent one (500), current is 650
  if (select (totals->>'total')::numeric from public.opps_quote_revisions where id = v_pub2) <> 500 then
    raise exception '4: published revision total drifted';
  end if;
  if (select (totals->>'total')::numeric from public.opps_quote_revisions where id = v_cur2) <> 650 then
    raise exception '4: current revision total wrong';
  end if;

  raise notice 'PASS 3+4: post-send save moves current only; published frozen; unsent-changes state holds';
end
$t$;

-- ══════════════════════════════════════════════════════════════════
-- 5 + 6. RESEND moves published up to current; a SECOND sent event
--        with metadata.resend = true
-- ══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_qid uuid; v_upd timestamptz; v_cur uuid; v_pub uuid; v_res jsonb; v_sent_count int; ev record;
begin
  select * into c from _q25;
  v_qid := pg_temp._q25_new_quote(c.tenant_jx, c.staff_uid, 300);
  perform pg_temp._q25_send(c.staff_uid, v_qid);
  select updated_at into v_upd from public.opps_quotes where id = v_qid;
  perform pg_temp._q25_save(c.tenant_jx, c.staff_uid, v_qid, 400, v_upd, 1);
  select current_revision_id into v_cur from public.opps_quotes where id = v_qid;

  v_res := pg_temp._q25_send(c.staff_uid, v_qid);
  if (v_res->>'resend')::boolean is not true then raise exception '5: resend not flagged'; end if;
  if (v_res->>'no_change')::boolean is not false then raise exception '5: resend reported no_change'; end if;

  select published_revision_id into v_pub from public.opps_quotes where id = v_qid;
  if v_pub is distinct from v_cur then raise exception '5: resend did not move published to current'; end if;
  if (select (totals->>'total')::numeric from public.opps_quote_revisions where id = v_pub) <> 400 then
    raise exception '5: republished revision total wrong';
  end if;

  select count(*) into v_sent_count from public.opps_quote_events where quote_id = v_qid and event_type = 'sent';
  if v_sent_count <> 2 then raise exception '6: expected exactly 2 sent events, got %', v_sent_count; end if;
  -- exactly one first-send (resend=false) and one resend (resend=true)
  if (select count(*) from public.opps_quote_events
        where quote_id = v_qid and event_type = 'sent' and (metadata->>'resend')::boolean = false) <> 1 then
    raise exception '6: expected exactly one resend=false sent event';
  end if;
  if (select count(*) from public.opps_quote_events
        where quote_id = v_qid and event_type = 'sent' and (metadata->>'resend')::boolean = true) <> 1 then
    raise exception '6: expected exactly one resend=true sent event';
  end if;
  -- the resend event points at the new published revision
  if (select revision_id from public.opps_quote_events
        where quote_id = v_qid and event_type = 'sent' and (metadata->>'resend')::boolean = true) is distinct from v_pub then
    raise exception '6: resend event revision_id <> new published';
  end if;

  raise notice 'PASS 5+6: resend moves published to current; second sent event resend=true';
end
$t$;

-- ══════════════════════════════════════════════════════════════════
-- 7. IDEMPOTENT: sending the same already-published revision again
--    returns no_change and appends NO duplicate event
-- ══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_qid uuid; v_before int; v_after int; v_res jsonb;
begin
  select * into c from _q25;
  v_qid := pg_temp._q25_new_quote(c.tenant_jx, c.staff_uid, 200);
  perform pg_temp._q25_send(c.staff_uid, v_qid);
  select count(*) into v_before from public.opps_quote_events where quote_id = v_qid and event_type = 'sent';

  v_res := pg_temp._q25_send(c.staff_uid, v_qid);
  if (v_res->>'no_change')::boolean is not true then raise exception '7: same-revision resend not idempotent: %', v_res; end if;

  select count(*) into v_after from public.opps_quote_events where quote_id = v_qid and event_type = 'sent';
  if v_after <> v_before then raise exception '7: idempotent send appended a duplicate event (% -> %)', v_before, v_after; end if;

  raise notice 'PASS 7: idempotent same-revision send — no_change, no duplicate event';
end
$t$;

-- ══════════════════════════════════════════════════════════════════
-- 8-11. BLOCKED from accepted / converted / declined / expired
-- ══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_qid uuid; v_msg text; st text;
begin
  select * into c from _q25;
  foreach st in array array['accepted','converted','declined','expired']
  loop
    v_qid := pg_temp._q25_new_quote(c.tenant_jx, c.staff_uid, 100);
    -- move to the blocked status directly (superuser; simulates a later state)
    update public.opps_quotes set status = st,
           accepted_revision_id = case when st = 'accepted' then current_revision_id else accepted_revision_id end
     where id = v_qid;
    v_msg := 'no error';
    begin
      perform pg_temp._q25_send(c.staff_uid, v_qid);
    exception when others then v_msg := sqlerrm;
    end;
    if v_msg not like '%QUOTE_NOT_SENDABLE%' then
      raise exception '8-11 (%): mark_quote_sent not blocked (got: %)', st, v_msg;
    end if;
  end loop;
  raise notice 'PASS 8-11: mark_quote_sent blocked from accepted / converted / declined / expired';
end
$t$;

-- ══════════════════════════════════════════════════════════════════
-- 12. current_revision_id required
-- ══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_qid uuid; v_msg text := 'no error';
begin
  select * into c from _q25;
  -- craft a quote row with no current revision (superuser insert)
  insert into public.opps_quotes (tenant_id, quote_number, customer_name)
    values (c.tenant_jx, 'QT-0000-000001', 'NoRev') returning id into v_qid;
  begin
    perform pg_temp._q25_send(c.staff_uid, v_qid);
  exception when others then v_msg := sqlerrm;
  end;
  if v_msg not like '%QUOTE_NO_REVISION_TO_SEND%' then
    raise exception '12: expected QUOTE_NO_REVISION_TO_SEND, got: %', v_msg;
  end if;
  delete from public.opps_quotes where id = v_qid;
  raise notice 'PASS 12: mark_quote_sent requires current_revision_id';
end
$t$;

-- ══════════════════════════════════════════════════════════════════
-- 13. cross-tenant denied
-- ══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_qid uuid; v_msg text := 'no error';
begin
  select * into c from _q25;
  v_qid := pg_temp._q25_new_quote(c.tenant_jx, c.staff_uid, 100);   -- Joint X quote
  begin
    perform pg_temp._q25_send(c.tenantb_uid, v_qid);                 -- tenant B admin tries to send it
  exception when others then v_msg := sqlerrm;
  end;
  if v_msg not like '%QUOTE_ACCESS_DENIED%' then
    raise exception '13: cross-tenant send not denied (got: %)', v_msg;
  end if;
  raise notice 'PASS 13: cross-tenant mark_quote_sent denied';
end
$t$;

-- ══════════════════════════════════════════════════════════════════
-- 14. anon cannot execute mark_quote_sent at all
-- ══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_qid uuid; v_msg text := 'no error';
begin
  select * into c from _q25;
  v_qid := pg_temp._q25_new_quote(c.tenant_jx, c.staff_uid, 100);
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.mark_quote_sent(v_qid);
  exception when insufficient_privilege then v_msg := 'denied';
            when others then v_msg := sqlerrm;
  end;
  reset role;
  if v_msg <> 'denied' then raise exception '14: anon was not denied EXECUTE (got: %)', v_msg; end if;
  raise notice 'PASS 14: anon has no EXECUTE on mark_quote_sent';
end
$t$;

-- ══════════════════════════════════════════════════════════════════
-- 15. SAVE CONTRACT — save never moves published or accepted;
--     accepted/converted/declined stay non-editable (Q1 rule intact)
-- ══════════════════════════════════════════════════════════════════
do $t$
declare c record; v_qid uuid; v_upd timestamptz; v_pub uuid; v_acc uuid; v_msg text;
begin
  select * into c from _q25;
  v_qid := pg_temp._q25_new_quote(c.tenant_jx, c.staff_uid, 100);
  perform pg_temp._q25_send(c.staff_uid, v_qid);
  select published_revision_id, accepted_revision_id, updated_at into v_pub, v_acc, v_upd from public.opps_quotes where id = v_qid;

  perform pg_temp._q25_save(c.tenant_jx, c.staff_uid, v_qid, 111, v_upd, 1);
  if (select published_revision_id from public.opps_quotes where id = v_qid) is distinct from v_pub then
    raise exception '15: save moved published_revision_id';
  end if;
  if (select accepted_revision_id from public.opps_quotes where id = v_qid) is distinct from v_acc then
    raise exception '15: save moved accepted_revision_id';
  end if;

  -- accepted quote still non-editable
  update public.opps_quotes set status = 'accepted', accepted_revision_id = current_revision_id where id = v_qid;
  select updated_at into v_upd from public.opps_quotes where id = v_qid;
  v_msg := 'no error';
  begin
    perform pg_temp._q25_save(c.tenant_jx, c.staff_uid, v_qid, 222, v_upd, 1);
  exception when others then v_msg := sqlerrm;
  end;
  if v_msg not like '%QUOTE_NOT_EDITABLE%' then raise exception '15: accepted quote became editable (got: %)', v_msg; end if;

  raise notice 'PASS 15: save moves current only — never published/accepted; accepted stays non-editable';
end
$t$;

-- ══════════════════════════════════════════════════════════════════
-- 16. FROZEN PUBLISHED DOCUMENT — the revision snapshot is the sole
--     source of truth for every commercial / customer-facing field.
--     A staff edit to rev N+1 must NOT change any field on the still-
--     published rev N snapshot, and must NOT track through the mutable
--     opps_quotes row for the published view.
--
--     rev2: valid_until 2026-10-06, payment_terms "50% deposit",
--           terms "T-rev2", reference "REF-2", ship "Ship-2"
--     publish rev2
--     rev3: valid_until 2026-10-22, payment_terms "Net 30",
--           terms "T-rev3", reference "REF-3", ship "Ship-3"
-- ══════════════════════════════════════════════════════════════════
do $t$
declare
  c record; v_qid uuid; v_upd timestamptz;
  v_rev2 uuid; v_rev3 uuid; s2 jsonb; s3 jsonb;
  v_row_valid date; v_row_terms text;
begin
  select * into c from _q25;
  set local role authenticated;
  perform set_config('test.uid', c.staff_uid::text, true);

  -- rev 1 (throwaway) then rev 2 with the real rev-2 field set
  v_qid := (public.save_opps_quote_with_items(
    c.tenant_jx, null,
    jsonb_build_object('customer_name','Acme','currency_code','ZAR','total',100),
    jsonb_build_array(jsonb_build_object('item_name','x','role','product','quantity',1,'rate',100))
  )->>'quote_id')::uuid;
  select updated_at into v_upd from public.opps_quotes where id = v_qid;

  perform public.save_opps_quote_with_items(
    c.tenant_jx, v_qid,
    jsonb_build_object(
      'customer_name','Acme Streetwear','currency_code','ZAR','total',800,
      'valid_until','2026-10-06','payment_terms','50% deposit to start',
      'terms','Terms as at revision 2','reference_number','REF-2',
      'shipping_address','Unit 2, Old Rd'
    ),
    jsonb_build_array(jsonb_build_object('item_name','Tee','role','product','quantity',5,'rate',160)),
    v_upd, 1
  );
  reset role;

  select id into v_rev2 from public.opps_quote_revisions where quote_id = v_qid and revision_number = 2;
  perform pg_temp._q25_send(c.staff_uid, v_qid);           -- publish rev 2

  -- rev 3 — every customer-facing field deliberately different
  set local role authenticated;
  perform set_config('test.uid', c.staff_uid::text, true);
  select updated_at into v_upd from public.opps_quotes where id = v_qid;
  perform public.save_opps_quote_with_items(
    c.tenant_jx, v_qid,
    jsonb_build_object(
      'customer_name','Acme Streetwear','currency_code','ZAR','total',960,
      'valid_until','2026-10-22','payment_terms','Net 30 days',
      'terms','Terms as at revision 3','reference_number','REF-3',
      'shipping_address','Unit 9, New Rd'
    ),
    jsonb_build_array(jsonb_build_object('item_name','Tee','role','product','quantity',5,'rate',192)),
    v_upd, 1
  );
  reset role;

  select id into v_rev3 from public.opps_quote_revisions where quote_id = v_qid and revision_number = 3;
  select snapshot into s2 from public.opps_quote_revisions where id = v_rev2;
  select snapshot into s3 from public.opps_quote_revisions where id = v_rev3;
  select valid_until, terms into v_row_valid, v_row_terms from public.opps_quotes where id = v_qid;

  -- the published (rev 2) snapshot still holds the rev-2 values
  if (s2->>'valid_until') <> '2026-10-06'          then raise exception '16: rev2 snapshot valid_until = % (want 2026-10-06)', s2->>'valid_until'; end if;
  if (s2->>'payment_terms') <> '50% deposit to start' then raise exception '16: rev2 snapshot payment_terms drifted: %', s2->>'payment_terms'; end if;
  if (s2->>'terms') <> 'Terms as at revision 2'    then raise exception '16: rev2 snapshot terms drifted'; end if;
  if (s2->>'reference_number') <> 'REF-2'          then raise exception '16: rev2 snapshot reference drifted'; end if;
  if (s2->>'shipping_address') <> 'Unit 2, Old Rd' then raise exception '16: rev2 snapshot shipping drifted'; end if;
  if (s2->>'total')::numeric <> 800               then raise exception '16: rev2 snapshot total drifted'; end if;

  -- rev 3 snapshot holds the new values (draft preview source)
  if (s3->>'valid_until') <> '2026-10-22'          then raise exception '16: rev3 snapshot valid_until wrong'; end if;
  if (s3->>'payment_terms') <> 'Net 30 days'       then raise exception '16: rev3 snapshot payment_terms wrong'; end if;
  if (s3->>'terms') <> 'Terms as at revision 3'    then raise exception '16: rev3 snapshot terms wrong'; end if;
  if (s3->>'reference_number') <> 'REF-3'          then raise exception '16: rev3 snapshot reference wrong'; end if;
  if (s3->>'shipping_address') <> 'Unit 9, New Rd' then raise exception '16: rev3 snapshot shipping wrong'; end if;
  if (s3->>'total')::numeric <> 960               then raise exception '16: rev3 snapshot total wrong'; end if;

  -- the MUTABLE opps_quotes row has moved to rev 3 — proving the published
  -- view MUST NOT read valid_until / terms from it.
  if v_row_valid <> date '2026-10-22'              then raise exception '16: opps_quotes.valid_until should track the working head'; end if;
  if v_row_terms <> 'Terms as at revision 3'       then raise exception '16: opps_quotes.terms should track the working head'; end if;

  -- published pointer still rev 2, current is rev 3
  if (select published_revision_id from public.opps_quotes where id = v_qid) <> v_rev2 then raise exception '16: published pointer moved'; end if;
  if (select current_revision_id  from public.opps_quotes where id = v_qid) <> v_rev3 then raise exception '16: current pointer wrong'; end if;

  raise notice 'PASS 16: rev2 snapshot frozen (2026-10-06 / REF-2 / 50%% deposit); rev3 snapshot separate (2026-10-22 / REF-3 / Net 30); mutable row tracks rev3';
end
$t$;

-- ── cleanup ──────────────────────────────────────────────────────
do $c$
begin
  set local role postgres;
  delete from public.opps_quotes;
  delete from public.opps_quote_number_sequences;
  delete from public.opps_quote_number_config;
  delete from public.tenant_memberships where auth_user_id in (
    '00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-0000000000b3');
  delete from public.users where auth_user_id in (
    '00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-0000000000b3');
  delete from public.clients where email = 'q25-client@example.test';
  delete from auth.users where id in (
    '00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-0000000000b3');
  delete from public.tenants where slug in ('joint-x','q25-tenant-b');
  drop table if exists _q25;
  raise notice 'CLEANUP ok';
end
$c$;
