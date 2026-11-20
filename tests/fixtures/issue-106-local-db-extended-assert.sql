-- Issue #106 extended local-only checks. Run AFTER setup, grouped RPC and base assert.
-- NEVER run against remote Supabase, staging or production.
\set ON_ERROR_STOP on

-- All inserts below are synthetic fixture data in the disposable PostgreSQL DB.
insert into public.tenant_memberships (tenant_id,auth_user_id,tenant_role,status) values
 ('11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd','owner','active'),
 ('11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','admin','active'),
 ('22222222-2222-4222-8222-222222222222','ffffffff-ffff-4fff-8fff-ffffffffffff','owner','active');

insert into public.opps_invoices (id,tenant_id,invoice_number,source_order_id,customer_name,status,total,balance_due,updated_at) values
 ('20000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','QS-LINKED-PARTIAL','10000000-0000-4000-8000-000000000001','Cafe Fixture','sent',125,45,'2026-11-05T14:00:00Z'),
 ('20000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','QS-LINKED-VOID','10000000-0000-4000-8000-000000000001','Cafe Fixture','void',125,125,'2026-11-05T14:05:00Z'),
 ('20000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','QS-STANDALONE-VOID',null,'Cafe Fixture','void',70,70,'2026-11-05T14:10:00Z'),
 ('20000000-0000-4000-8000-000000000008','22222222-2222-4222-8222-222222222222','OTHER-CROSS-LINK','10000000-0000-4000-8000-000000000001','Other Fixture','sent',999,999,'2026-11-05T14:20:00Z');

set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
do $test$
declare
  v jsonb;
  v_items jsonb;
  v_card jsonb;
  v_invoice jsonb;
  v_cursor text := null;
  v_seen text[] := array[]::text[];
  v_pages integer := 0;
  v_linked integer;
begin
  v := public.qs_cafe_list_work_queue(null,25);
  v_items := v->'items';
  if jsonb_array_length(v_items) <> 4 then
    raise exception 'expected four independent Cafe cards: %',v; end if;
  select value into v_card from jsonb_array_elements(v_items) x(value)
    where value->>'number'='QS-ORDER-1';
  if v_card is null then raise exception 'parent order missing'; end if;
  if jsonb_array_length(v_card->'invoices') <> 3 then
    raise exception 'expected three linked invoices: %',v_card; end if;
  if exists (
    select 1 from jsonb_array_elements(v_items) x(value)
    where value->>'number' in ('QS-LINKED-PAID-1','QS-LINKED-PARTIAL','QS-LINKED-VOID','OTHER-CROSS-LINK')
  ) then raise exception 'linked or foreign invoice exposed as a separate card'; end if;
  if exists (
    select 1 from jsonb_array_elements(v_card->'invoices') x(value)
    where value->>'number'='OTHER-CROSS-LINK'
  ) then raise exception 'other-tenant invoice leaked into linked order'; end if;

  select value into v_invoice from jsonb_array_elements(v_card->'invoices') x(value)
    where value->>'number'='QS-LINKED-PARTIAL';
  if v_invoice->>'balanceDue' <> '45' or v_invoice->>'reviewRequired' <> 'false' then
    raise exception 'partial invoice state changed: %',v_invoice; end if;
  select value into v_invoice from jsonb_array_elements(v_card->'invoices') x(value)
    where value->>'number'='QS-LINKED-VOID';
  if v_invoice->'balanceDue' <> 'null'::jsonb or v_invoice->>'reviewRequired'<>'true' then
    raise exception 'void linked invoice not blocked: %',v_invoice; end if;
  if not exists (
    select 1 from jsonb_array_elements(v_items) x(value)
    where value->>'number'='QS-STANDALONE-VOID'
      and value->'balanceDue'='null'::jsonb
      and value->>'reviewRequired'='true'
  ) then raise exception 'standalone void invoice missing or unsafe'; end if;

  loop
    v := public.qs_cafe_list_work_queue(v_cursor,1);
    if jsonb_array_length(v->'items')=0 then exit; end if;
    v_card := v->'items'->0;
    if v_card->>'id'=any(v_seen) then raise exception 'duplicate page card: %',v_card; end if;
    v_seen := array_append(v_seen,v_card->>'id');
    v_pages := v_pages + 1;
    if v_card->>'number'='QS-ORDER-1' and jsonb_array_length(v_card->'invoices')<>3 then
      raise exception 'pagination detached invoice(s)'; end if;
    v_cursor := v->>'nextCursor';
    exit when v_cursor is null;
    if v_pages > 10 then raise exception 'pagination did not terminate'; end if;
  end loop;
  if v_pages<>4 then raise exception 'page traversal produced % cards',v_pages; end if;

  raise notice 'PASS: linked paid/partial/void, standalone void, isolation and page boundaries';
end
$test$;

select set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',false);
do $test$ begin
 if jsonb_array_length(public.qs_cafe_list_work_queue(null,10)->'items')<>4 then raise exception 'owner cannot read'; end if;
 raise notice 'PASS: Cafe owner authorized';
end $test$;
select set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',false);
do $test$ begin
 if jsonb_array_length(public.qs_cafe_list_work_queue(null,10)->'items')<>4 then raise exception 'admin cannot read'; end if;
 raise notice 'PASS: Cafe admin authorized';
end $test$;
select set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',false);
do $test$ begin
 begin
  perform public.qs_cafe_list_work_queue(null,10);
  raise exception 'OPPS-only/other-tenant identity incorrectly authorized';
 exception when sqlstate '42501' then null; end;
 raise notice 'PASS: other-tenant/OPPS-only identity denied';
end $test$;
reset role;

do $test$ begin
 if has_function_privilege('anon','public.qs_cafe_list_work_queue(text,integer)','EXECUTE')
    or has_function_privilege('service_role','public.qs_cafe_list_work_queue(text,integer)','EXECUTE')
    or not has_function_privilege('authenticated','public.qs_cafe_list_work_queue(text,integer)','EXECUTE')
 then raise exception 'unexpected work queue EXECUTE privilege'; end if;
 raise notice 'PASS: anon and service_role EXECUTE revoked; authenticated only';
end $test$;
