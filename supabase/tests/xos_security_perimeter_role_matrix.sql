\set ON_ERROR_STOP on

create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'ASSERT_TRUE: %',label;end if;end$$;
create function pg_temp.assert_eq(actual bigint,expected bigint,label text) returns void language plpgsql as $$begin if actual<>expected then raise exception 'ASSERT_EQ %: got %, expected %',label,actual,expected;end if;end$$;
create function pg_temp.expect_denied(sql_text text,label text) returns void language plpgsql as $$begin execute sql_text;raise exception 'EXPECTED_DENIAL: %',label;exception when insufficient_privilege then null;end$$;

set role authenticated;
select set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000002',false);
select pg_temp.assert_true((select allowed from public.resolve_xos_admin_gate('a.xos.test')),'member host gate');
select pg_temp.assert_true(not (select allowed from public.resolve_xos_admin_gate('unknown.xos.test')),'unknown host denied');
select pg_temp.assert_true(not (select allowed from public.resolve_xos_admin_gate('inactive.xos.test')),'inactive tenant denied');
select pg_temp.assert_eq((select count(*) from public.get_xos_orders_for_host('a.xos.test')),1,'member XOS order RPC');
select pg_temp.assert_eq((select count(*) from public.orders),0,'member direct orders hidden');
select pg_temp.assert_eq((select count(*) from public.clients),0,'member direct clients hidden');
select pg_temp.assert_eq((select count(*) from public.products),0,'member direct products hidden');
select pg_temp.assert_eq((select count(*) from public.users),0,'member internal users hidden');
select pg_temp.expect_denied($q$insert into public.orders values(gen_random_uuid(),'20000000-0000-0000-0000-000000000002','BAD','new')$q$,'member direct order insert');
select pg_temp.assert_true(public.create_xos_request_for_host('a.xos.test','Allowed request') is not null,'member request RPC');
delete from public.client_quote_requests;
reset role;
select pg_temp.assert_eq((select count(*) from public.client_quote_requests),1,'member direct request delete filtered by RLS');
set role authenticated;
select set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000002',false);
select pg_temp.assert_true(public.is_private_upload_path_accessible('20000000-0000-0000-0000-000000000002/orders/a.pdf'),'linked private file read');
select pg_temp.assert_true(not public.is_private_upload_path_accessible('20000000-0000-0000-0000-000000000002/orders/guess.pdf'),'unlinked file denied');
select pg_temp.assert_true(not public.is_private_upload_path_accessible('30000000-0000-0000-0000-000000000003/orders/b.pdf'),'cross tenant file denied');
select pg_temp.expect_denied($q$insert into storage.objects values(gen_random_uuid(),'uploads','20000000-0000-0000-0000-000000000002/orders/new.pdf')$q$,'member uploads insert');

select set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000003',false);
select pg_temp.assert_true((select allowed from public.resolve_xos_admin_gate('a.xos.test')),'owner host gate');
select pg_temp.assert_eq((select count(*) from public.orders),0,'owner direct orders hidden');

select set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000004',false);
select pg_temp.assert_true(not (select allowed from public.resolve_xos_admin_gate('a.xos.test')),'cross tenant host denied');
select pg_temp.assert_eq((select count(*) from public.get_xos_orders_for_host('a.xos.test')),0,'cross tenant order RPC denied');

select set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000099',false);
select pg_temp.assert_true(not (select allowed from public.resolve_xos_admin_gate('a.xos.test')),'authenticated outsider denied');

select set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000001',false);
select pg_temp.assert_true(public.is_opps_staff(),'staff authority');
select pg_temp.assert_eq((select count(*) from public.orders),1,'staff tenant-scoped orders preserved');
insert into public.orders values('92000000-0000-0000-0000-000000000099','20000000-0000-0000-0000-000000000002','STAFF-OK','new');
insert into storage.objects values('94000000-0000-0000-0000-000000000001','uploads','20000000-0000-0000-0000-000000000002/orders/staff.pdf');
select pg_temp.assert_eq((select count(*) from public.v_orders),2,'security invoker view preserves staff access');

reset role;
set role anon;
select pg_temp.expect_denied($q$select * from public.orders$q$,'anon orders revoked');
select pg_temp.expect_denied($q$select * from public.active_tasks$q$,'anon internal view');

reset role;
set role service_role;
select pg_temp.assert_eq((select count(*) from public.orders),3,'service role bypass preserved');
select pg_temp.assert_true(has_function_privilege('service_role','public.upsert_opps_conversation(uuid,text,text,text,text)','EXECUTE'),'backend helper service role');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.upsert_opps_conversation(uuid,text,text,text,text)','EXECUTE'),'backend helper end-user denied');

reset role;
select 'XOS_SECURITY_PERIMETER_ROLE_MATRIX_OK' as result;
