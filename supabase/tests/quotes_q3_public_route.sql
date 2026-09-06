-- ════════════════════════════════════════════════════════════════════
--  QUOTES Q3 — disposable behavioural suite  (/q/:token public route)
-- ════════════════════════════════════════════════════════════════════
-- Run AFTER: quotes_q1_disposable_prelude.sql + extensions (pgcrypto) +
--            Q1 migration + Q2.5 migration + Q3 migration.  See quotes_q3_run.sh.
-- ════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

do $seed$
declare v_jx uuid; v_b uuid;
begin
  delete from public.opps_quote_events; delete from public.opps_quote_revisions;
  delete from public.opps_quote_items;  delete from public.opps_quotes;
  delete from public.opps_quote_number_sequences; delete from public.opps_quote_number_config;
  delete from public.tenant_memberships where auth_user_id in ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000c3');
  delete from public.users where auth_user_id in ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000c3');
  delete from auth.users where id in ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000c3');
  delete from public.clients where email = 'q3-client@example.test';
  delete from public.tenants where slug in ('joint-x','q3-tenant-b');

  insert into public.tenants (slug,name,status) values ('joint-x','Joint X','active') returning id into v_jx;
  insert into public.tenants (slug,name,status) values ('q3-tenant-b','Q3 B','active') returning id into v_b;
  insert into auth.users (id,email) values
    ('00000000-0000-4000-8000-0000000000c1','q3-staff@example.test'),
    ('00000000-0000-4000-8000-0000000000c2','q3-b@example.test'),
    ('00000000-0000-4000-8000-0000000000c3','q3-out@example.test');
  insert into public.users (auth_user_id,user_email,full_name,role,is_active) values
    ('00000000-0000-4000-8000-0000000000c1','q3-staff@example.test','S','admin',true),
    ('00000000-0000-4000-8000-0000000000c2','q3-b@example.test','B','admin',true),
    ('00000000-0000-4000-8000-0000000000c3','q3-out@example.test','O','user',true);
  insert into public.tenant_memberships (auth_user_id,tenant_id,status) values
    ('00000000-0000-4000-8000-0000000000c1', v_jx, 'active'),
    ('00000000-0000-4000-8000-0000000000c2', v_b,  'active');
  insert into public.clients (tenant_id,name,email) values (v_jx,'Q3 Client','q3-client@example.test');
  raise notice 'SEED ok';
end $seed$;

create temporary table _q3 as select
  (select id from public.tenants where slug='joint-x') as tjx,
  '00000000-0000-4000-8000-0000000000c1'::uuid as staff,
  '00000000-0000-4000-8000-0000000000c2'::uuid as tenantb,
  '00000000-0000-4000-8000-0000000000c3'::uuid as outsider;

-- build a quote at rev2 (valid_until X, distinctive fields), publish rev2,
-- optionally save a rev3 with different fields. Returns (quote_id, token).
create or replace function pg_temp._q3_make(p_valid text, p_ref text, p_pay text, p_total numeric, p_uid uuid)
returns uuid language plpgsql as $$
declare c record; v_qid uuid; v_upd timestamptz;
begin
  select * into c from _q3;
  perform set_config('test.uid', p_uid::text, true); set local role authenticated;
  v_qid := (public.save_opps_quote_with_items(c.tjx, null,
    jsonb_build_object('customer_name','Acme','currency_code','ZAR','total',10),
    jsonb_build_array(jsonb_build_object('item_name','x','role','product','quantity',1,'rate',10)))->>'quote_id')::uuid;
  select updated_at into v_upd from public.opps_quotes where id=v_qid;
  perform public.save_opps_quote_with_items(c.tjx, v_qid,
    jsonb_build_object('customer_name','Acme Streetwear','currency_code','ZAR','total',p_total,
      'valid_until',p_valid,'payment_terms',p_pay,'reference_number',p_ref,'terms','Terms '||p_ref,
      'shipping_address','Ship '||p_ref),
    jsonb_build_array(jsonb_build_object('item_name','Tee','role','product','quantity',5,'rate',p_total/5)),
    v_upd, 1);
  perform public.mark_quote_sent(v_qid);     -- publish rev 2
  reset role;
  return v_qid;
end $$;

create or replace function pg_temp._q3_issue(p_qid uuid, p_uid uuid, p_expires timestamptz default null)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('test.uid', p_uid::text, true); set local role authenticated;
  v := public.issue_quote(p_qid, p_expires); reset role; return v;
end $$;

-- ══ 1. valid token -> projection with the frozen offer ══════════════
do $t$
declare c record; v_qid uuid; v_tok text; v_doc jsonb;
begin
  select * into c from _q3;
  v_qid := pg_temp._q3_make('2026-10-06','REF-2','50% deposit',800, c.staff);
  v_tok := pg_temp._q3_issue(v_qid, c.staff)->>'share_token';

  set local role anon; perform set_config('test.uid','',true);
  v_doc := public.get_public_quote(v_tok);
  reset role;

  if v_doc is null then raise exception '1: valid token returned null'; end if;
  if v_doc->>'kind' <> 'quote' then raise exception '1: kind'; end if;
  if (v_doc->>'revision_number')::int <> 2 then raise exception '1: revision_number <> 2'; end if;
  if (v_doc->>'valid_until') <> '2026-10-06' then raise exception '1: valid_until %', v_doc->>'valid_until'; end if;
  if (v_doc->>'payment_terms') <> '50% deposit' then raise exception '1: payment_terms'; end if;
  if (v_doc->>'reference_number') <> 'REF-2' then raise exception '1: reference'; end if;
  if (v_doc->>'total')::numeric <> 800 then raise exception '1: total'; end if;
  if (v_doc->>'status') <> 'sent' then raise exception '1: status'; end if;
  if jsonb_array_length(v_doc->'items') <> 1 then raise exception '1: items'; end if;
  raise notice 'PASS 1: valid token -> frozen offer (rev 2, 2026-10-06, REF-2, R800, status sent)';
end $t$;

-- ══ 2. draft / working head cannot leak ════════════════════════════
do $t$
declare c record; v_qid uuid; v_tok text; v_upd timestamptz; v_doc jsonb;
begin
  select * into c from _q3;
  v_qid := pg_temp._q3_make('2026-10-06','REF-2','50% deposit',800, c.staff);
  v_tok := pg_temp._q3_issue(v_qid, c.staff)->>'share_token';
  -- staff edits to rev 3 with completely different values
  perform set_config('test.uid', c.staff::text, true); set local role authenticated;
  select updated_at into v_upd from public.opps_quotes where id=v_qid;
  perform public.save_opps_quote_with_items(c.tjx, v_qid,
    jsonb_build_object('customer_name','Acme Streetwear','currency_code','ZAR','total',9999,
      'valid_until','2026-12-31','payment_terms','PAID UPFRONT','reference_number','REF-3','terms','Terms REF-3',
      'shipping_address','Ship REF-3'),
    jsonb_build_array(jsonb_build_object('item_name','Tee','role','product','quantity',5,'rate',1999.8)),
    v_upd, 1);
  reset role;

  set local role anon; perform set_config('test.uid','',true);
  v_doc := public.get_public_quote(v_tok);
  reset role;

  if (v_doc->>'revision_number')::int <> 2 then raise exception '2: public route moved to rev 3'; end if;
  if v_doc::text ~ '(2026-12-31|PAID UPFRONT|REF-3|9999|1999)' then raise exception '2: working-head value leaked into public doc: %', v_doc; end if;
  raise notice 'PASS 2: staff edit to rev 3 does not touch the public rev-2 offer';
end $t$;

-- ══ 3. customer-safe allowlist — no internal keys ══════════════════
do $t$
declare c record; v_qid uuid; v_tok text; v_doc jsonb; k text;
begin
  select * into c from _q3;
  v_qid := pg_temp._q3_make('2026-10-06','REF','Net 7',500, c.staff);
  v_tok := pg_temp._q3_issue(v_qid, c.staff)->>'share_token';
  set local role anon; perform set_config('test.uid','',true);
  v_doc := public.get_public_quote(v_tok);
  reset role;
  foreach k in array array['id','tenant_id','customer_id','customer_email','customer_phone',
    'customer_whatsapp','notes','source_request_id','supersedes_quote_id','converted_order_id',
    'converted_invoice_id','share_token','total_override_reason','total_override_by','created_by',
    'updated_by','accepted_actor_user_id','current_revision_id','published_revision_id','source_metadata',
    'source_client_product_id']
  loop
    if v_doc ? k then raise exception '3: public doc leaked key %', k; end if;
  end loop;
  if v_doc::text ~* '(unit_cost|"cost"|margin|supplier|procurement)' then raise exception '3: cost/margin token leaked'; end if;
  raise notice 'PASS 3: public projection has no internal / cost / margin / id keys';
end $t$;

-- ══ 4. revoked / expired / unpublished / draft -> null (no signal) ══
do $t$
declare c record; v_qid uuid; v_tok text;
begin
  select * into c from _q3;
  -- revoked
  v_qid := pg_temp._q3_make('2026-10-06','R','x',100, c.staff);
  v_tok := pg_temp._q3_issue(v_qid, c.staff)->>'share_token';
  perform set_config('test.uid', c.staff::text, true); set local role authenticated;
  perform public.revoke_quote_share(v_qid); reset role;
  set local role anon; perform set_config('test.uid','',true);
  if public.get_public_quote(v_tok) is not null then raise exception '4: revoked token still resolves'; end if;
  reset role;

  -- expired link
  v_qid := pg_temp._q3_make('2026-10-06','E','x',100, c.staff);
  v_tok := pg_temp._q3_issue(v_qid, c.staff, now() - interval '1 hour')->>'share_token';
  set local role anon; perform set_config('test.uid','',true);
  if public.get_public_quote(v_tok) is not null then raise exception '4: expired link still resolves'; end if;
  -- wrong token
  if public.get_public_quote('deadbeef') is not null then raise exception '4: bogus token resolves'; end if;
  reset role;

  -- unpublished quote: issue_quote refuses, and even a hand-set token wouldn't resolve
  perform set_config('test.uid', c.staff::text, true); set local role authenticated;
  declare v_draft uuid; v_msg text := 'no error';
  begin
    v_draft := (public.save_opps_quote_with_items(c.tjx, null,
      jsonb_build_object('customer_name','D','total',10),
      jsonb_build_array(jsonb_build_object('item_name','x','quantity',1,'rate',10)))->>'quote_id')::uuid;
    begin perform public.issue_quote(v_draft, null); exception when others then v_msg := sqlerrm; end;
    if v_msg not like '%QUOTE_NOT_PUBLISHED%' then raise exception '4: issue_quote on an unpublished quote not refused (%)', v_msg; end if;
  end;
  reset role;
  raise notice 'PASS 4: revoked / expired / bogus token -> null; unpublished quote cannot be shared';
end $t$;

-- ══ 5. accept the EXACT published revision ═════════════════════════
do $t$
declare c record; v_qid uuid; v_tok text; v_pub uuid; v_doc jsonb; v_res jsonb; ev record;
begin
  select * into c from _q3;
  v_qid := pg_temp._q3_make('2026-10-06','ACC','Net 7',700, c.staff);
  v_tok := pg_temp._q3_issue(v_qid, c.staff)->>'share_token';
  select published_revision_id into v_pub from public.opps_quotes where id=v_qid;

  set local role anon; perform set_config('test.uid','',true);
  v_doc := public.get_public_quote(v_tok);        -- customer "loads" — knows rev 2
  perform public.mark_public_quote_viewed(v_tok); -- sent -> viewed
  v_res := public.accept_public_quote(v_tok, 2, '  Jordan Buyer  ', 'jordan@acme.test', 'UA/1.0');
  reset role;

  if (v_res->>'ok')::boolean is not true then raise exception '5: accept not ok: %', v_res; end if;
  if (v_res->>'status') <> 'accepted' then raise exception '5: status'; end if;
  if (v_res->>'accepted_revision_number')::int <> 2 then raise exception '5: accepted rev <> 2'; end if;

  if (select accepted_revision_id from public.opps_quotes where id=v_qid) is distinct from v_pub then
    raise exception '5: accepted_revision_id <> published_revision_id';
  end if;
  if (select status from public.opps_quotes where id=v_qid) <> 'accepted' then raise exception '5: row status'; end if;
  if (select accepted_at from public.opps_quotes where id=v_qid) is null then raise exception '5: accepted_at null'; end if;
  select * into ev from public.opps_quote_events where quote_id=v_qid and event_type='accepted';
  if ev.id is null then raise exception '5: no accepted event'; end if;
  if ev.revision_id is distinct from v_pub then raise exception '5: accepted event revision_id <> published'; end if;
  if ev.actor_kind <> 'public_link' then raise exception '5: accepted event actor_kind'; end if;
  if ev.actor_label <> 'Jordan Buyer' then raise exception '5: accepted event actor_label not trimmed name'; end if;
  if ev.share_token_used <> v_tok then raise exception '5: accepted event share_token_used'; end if;

  -- a second accept is refused (already accepted)
  declare v_msg2 text := 'no error';
  begin
    begin
      set local role anon; perform set_config('test.uid','',true);
      perform public.accept_public_quote(v_tok, 2, 'Someone', null, null); reset role;
    exception when others then v_msg2 := sqlerrm;
    end;
    if v_msg2 not like '%QUOTE_NOT_ACCEPTABLE%' then raise exception '5: double accept not refused (%)', v_msg2; end if;
  end;

  raise notice 'PASS 5: accept pins accepted_revision_id = published; status accepted; audited event; double-accept refused';
end $t$;

-- ══ 6. STALE accept rejected if republished between load and accept ══
do $t$
declare c record; v_qid uuid; v_tok text; v_old_pub uuid; v_upd timestamptz; v_msg text := 'no error';
begin
  select * into c from _q3;
  v_qid := pg_temp._q3_make('2026-10-06','STALE','Net 7',400, c.staff);
  v_tok := pg_temp._q3_issue(v_qid, c.staff)->>'share_token';
  select published_revision_id into v_old_pub from public.opps_quotes where id=v_qid;  -- customer's loaded rev

  -- staff revise + RESEND (published moves to rev 3) between load and accept
  perform set_config('test.uid', c.staff::text, true); set local role authenticated;
  select updated_at into v_upd from public.opps_quotes where id=v_qid;
  perform public.save_opps_quote_with_items(c.tjx, v_qid,
    jsonb_build_object('customer_name','Acme','currency_code','ZAR','total',450,'valid_until','2026-10-06','payment_terms','Net 7','reference_number','STALE'),
    jsonb_build_array(jsonb_build_object('item_name','Tee','role','product','quantity',5,'rate',90)), v_upd, 1);
  perform public.mark_quote_sent(v_qid);   -- resend -> published now rev 3
  reset role;

  set local role anon; perform set_config('test.uid','',true);
  begin
    perform public.accept_public_quote(v_tok, 2, 'Jordan', null, null);  -- accepts the STALE rev
  exception when others then v_msg := sqlerrm; end;
  reset role;

  if v_msg not like '%QUOTE_PUBLISHED_REVISION_CHANGED%' then raise exception '6: stale accept not rejected (%)', v_msg; end if;
  if (select status from public.opps_quotes where id=v_qid) = 'accepted' then raise exception '6: quote was accepted despite stale revision'; end if;
  raise notice 'PASS 6: accept with a stale expected revision -> QUOTE_PUBLISHED_REVISION_CHANGED, not accepted';
end $t$;

-- ══ 7. request changes — no price/revision change, message captured ══
do $t$
declare c record; v_qid uuid; v_tok text; v_pub uuid; v_cur uuid; ev record;
begin
  select * into c from _q3;
  v_qid := pg_temp._q3_make('2026-10-06','RC','Net 7',600, c.staff);
  v_tok := pg_temp._q3_issue(v_qid, c.staff)->>'share_token';
  select published_revision_id, current_revision_id into v_pub, v_cur from public.opps_quotes where id=v_qid;

  set local role anon; perform set_config('test.uid','',true);
  perform public.request_quote_changes(v_tok, 2, 'Please drop the setup fee and use navy.', 'Jordan', 'UA');
  reset role;

  if (select status from public.opps_quotes where id=v_qid) <> 'changes_requested' then raise exception '7: status'; end if;
  if (select published_revision_id from public.opps_quotes where id=v_qid) is distinct from v_pub then raise exception '7: published moved'; end if;
  if (select current_revision_id  from public.opps_quotes where id=v_qid) is distinct from v_cur then raise exception '7: current moved'; end if;
  if (select total from public.opps_quotes where id=v_qid) <> 600 then raise exception '7: total changed'; end if;
  select * into ev from public.opps_quote_events where quote_id=v_qid and event_type='changes_requested';
  if ev.id is null then raise exception '7: no event'; end if;
  if ev.note <> 'Please drop the setup fee and use navy.' then raise exception '7: message not captured: %', ev.note; end if;
  if ev.revision_id is distinct from v_pub then raise exception '7: event revision_id'; end if;
  if ev.actor_kind <> 'public_link' then raise exception '7: actor_kind'; end if;
  raise notice 'PASS 7: request-changes -> changes_requested; published + current + total untouched; message captured';
end $t$;

-- ══ 8. decline — revisions + published + share preserved ═══════════
do $t$
declare c record; v_qid uuid; v_tok text; v_pub uuid; v_revs int; ev record;
begin
  select * into c from _q3;
  v_qid := pg_temp._q3_make('2026-10-06','DEC','Net 7',300, c.staff);
  v_tok := pg_temp._q3_issue(v_qid, c.staff)->>'share_token';
  select published_revision_id into v_pub from public.opps_quotes where id=v_qid;
  select count(*) into v_revs from public.opps_quote_revisions where quote_id=v_qid;

  set local role anon; perform set_config('test.uid','',true);
  perform public.decline_public_quote(v_tok, 2, 'Went with another supplier.', 'Jordan', 'UA');
  reset role;

  if (select status from public.opps_quotes where id=v_qid) <> 'declined' then raise exception '8: status'; end if;
  if (select count(*) from public.opps_quote_revisions where quote_id=v_qid) <> v_revs then raise exception '8: a revision was destroyed'; end if;
  if (select published_revision_id from public.opps_quotes where id=v_qid) is distinct from v_pub then raise exception '8: published moved'; end if;
  if (select share_token from public.opps_quotes where id=v_qid) is null then raise exception '8: share history destroyed'; end if;
  select * into ev from public.opps_quote_events where quote_id=v_qid and event_type='declined';
  if ev.id is null or ev.note <> 'Went with another supplier.' then raise exception '8: declined event / reason'; end if;
  raise notice 'PASS 8: decline -> declined; revisions + published + share_token all preserved; reason captured';
end $t$;

-- ══ 9. anon permission matrix ════════════════════════════════════
do $t$
declare
  c record; v_qid uuid; v_tok text; v_expr text; v_denied boolean;
begin
  select * into c from _q3;
  v_qid := pg_temp._q3_make('2026-10-06','PERM','Net 7',100, c.staff);
  v_tok := pg_temp._q3_issue(v_qid, c.staff)->>'share_token';

  set local role anon; perform set_config('test.uid','',true);
  -- anon CAN: get_public_quote / by_email / viewed
  perform public.get_public_quote(v_tok);
  perform public.get_public_quote_by_email('x','y');
  perform public.mark_public_quote_viewed(v_tok);
  -- anon CANNOT: staff share controls, internal projection / token / guard
  foreach v_expr in array array[
      'select public.issue_quote(' || quote_literal(v_qid) || '::uuid, null)',
      'select public.revoke_quote_share(' || quote_literal(v_qid) || '::uuid)',
      'select public.rotate_quote_share_token(' || quote_literal(v_qid) || '::uuid)',
      'select public._public_quote_projection(' || quote_literal(v_qid) || '::uuid)',
      'select public._generate_quote_share_token()',
      'select public._request_ip_hash()']
  loop
    v_denied := false;
    begin
      execute v_expr;
    exception
      when insufficient_privilege then v_denied := true;
      when others then v_denied := (sqlerrm like '%permission denied%');
    end;
    if not v_denied then raise exception '9: anon was allowed to call [%]', v_expr; end if;
  end loop;
  reset role;
  raise notice 'PASS 9: anon can read+act by token only; staff/internal functions are denied to anon';
end $t$;

-- ── cleanup ──────────────────────────────────────────────────────
do $c$
begin
  set local role postgres;
  delete from public.opps_quotes; delete from public.opps_quote_number_sequences; delete from public.opps_quote_number_config;
  delete from public.tenant_memberships where auth_user_id in ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000c3');
  delete from public.users where auth_user_id in ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000c3');
  delete from public.clients where email='q3-client@example.test';
  delete from auth.users where id in ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000c3');
  delete from public.tenants where slug in ('joint-x','q3-tenant-b');
  drop table if exists _q3;
  raise notice 'CLEANUP ok';
end $c$;
