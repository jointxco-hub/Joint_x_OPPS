-- Run in local disposable opps106-pg-test database after setup and RPC draft.
\set ON_ERROR_STOP on
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);

do $test$
declare v jsonb; v_next jsonb; v_all jsonb;
begin
  v := public.qs_cafe_list_work_queue(null,25);
  if jsonb_array_length(v->'items') <> 3 then
    raise exception 'expected 3 Cafe records, got %',v;
  end if;
  if exists (
    select 1 from jsonb_array_elements(v->'items') item
    where (item->>'number') like 'OTHER-%'
  ) then raise exception 'cross-tenant data leaked'; end if;
  if not exists (
    select 1 from jsonb_array_elements(v->'items') item
    where item->>'number'='QS-PAID-1'
      and item->>'balanceDue'='0'
  ) then raise exception 'paid invoice balance not zero'; end if;
  if not exists (
    select 1 from jsonb_array_elements(v->'items') item
    where item->>'number'='QS-DRAFT-1'
      and item->'balanceDue'='null'::jsonb
      and item->>'reviewRequired'='true'
  ) then raise exception 'draft invoice not review-blocked'; end if;
  if not exists (
    select 1 from jsonb_array_elements(v->'items') item
    where item->>'type'='order'
      and item->'balanceDue'='null'::jsonb
  ) then raise exception 'order balance incorrectly inferred'; end if;
  v := public.qs_cafe_list_work_queue(null,2);
  if jsonb_array_length(v->'items')<>2 or v->>'nextCursor' is null then
    raise exception 'pagination first page invalid: %',v; end if;
  v_next := public.qs_cafe_list_work_queue(v->>'nextCursor',2);
  if jsonb_array_length(v_next->'items')<>1 then
    raise exception 'pagination second page invalid: %',v_next; end if;
  begin
    perform public.qs_cafe_list_work_queue(null,51);
    raise exception 'invalid limit unexpectedly accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.qs_cafe_list_work_queue('not-json',25);
    raise exception 'invalid cursor unexpectedly accepted';
  exception when sqlstate '22P02' or sqlstate '22023' then null; end;
  raise notice 'PASS: tenant isolation, paid/draft/order balances and pagination';
end
$test$;

select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
do $test$
begin
  begin
    perform public.qs_cafe_list_work_queue(null,25);
    raise exception 'other-tenant staff unexpectedly authorized';
  exception when sqlstate '42501' then null; end;
  raise notice 'PASS: other-tenant staff denied';
end
$test$;

select set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
do $test$
begin
  begin
    perform public.qs_cafe_list_work_queue(null,25);
    raise exception 'suspended member unexpectedly authorized';
  exception when sqlstate '42501' then null; end;
  raise notice 'PASS: suspended member denied';
end
$test$;

select set_config('request.jwt.claim.sub','',false);
do $test$
begin
  begin
    perform public.qs_cafe_list_work_queue(null,25);
    raise exception 'anonymous identity unexpectedly authorized';
  exception when sqlstate '42501' then null; end;
  raise notice 'PASS: null identity denied';
end
$test$;
reset role;
