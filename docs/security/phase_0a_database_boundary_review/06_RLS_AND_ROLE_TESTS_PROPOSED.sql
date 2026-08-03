-- PROPOSED PHASE 0A READ-ONLY TESTS - DO NOT EXECUTE WITHOUT AUTHORIZATION.
-- Run after migration 11 in the fixed two-tenant disposable seed from file 14.

begin;
set transaction read only;
set local statement_timeout = '120s';

do $$
declare v_name text; v_columns text[];
begin
  foreach v_name in array array['active_orders', 'v_orders', 'v_purchase_orders'] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_name and c.relkind = 'v'
        and coalesce(c.reloptions, '{}'::text[]) @> array['security_invoker=true']
    ) then raise exception 'View % is not security-invoker.', v_name; end if;
    if has_table_privilege('anon', format('public.%I', v_name), 'SELECT')
       or not has_table_privilege('authenticated', format('public.%I', v_name), 'SELECT') then
      raise exception 'View % client SELECT grants are incorrect.', v_name;
    end if;
  end loop;

  select array_agg(column_name order by ordinal_position) into v_columns
  from information_schema.columns where table_schema='public' and table_name='active_orders';
  if cardinality(v_columns) <> 25 then raise exception 'active_orders contract changed.'; end if;
  select array_agg(column_name order by ordinal_position) into v_columns
  from information_schema.columns where table_schema='public' and table_name='v_orders';
  if cardinality(v_columns) <> 33 then raise exception 'v_orders contract changed.'; end if;
  select array_agg(column_name order by ordinal_position) into v_columns
  from information_schema.columns where table_schema='public' and table_name='v_purchase_orders';
  if cardinality(v_columns) <> 16 then raise exception 'v_purchase_orders contract changed.'; end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where n.nspname='public'
      and p.proname in (
        'current_user_tenant_ids','can_access_tenant','current_user_app_role',
        'is_app_admin','assign_purchasing_tenant','get_active_orders_for_tenant',
        'get_orders_for_tenant','get_purchase_orders_for_tenant'
      ) and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ) then raise exception 'Internal function still grants PUBLIC execute.'; end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'current_user_tenant_ids','can_access_tenant','current_user_app_role',
        'is_app_admin','assign_purchasing_tenant','get_storefront_catalog_for_host',
        'get_active_orders_for_tenant','get_orders_for_tenant',
        'get_purchase_orders_for_tenant'
      ) and not coalesce(p.proconfig,'{}'::text[])
        @> array['search_path=pg_catalog, public']
  ) then raise exception 'Scoped function lacks safe search_path.'; end if;

  if has_function_privilege('anon','public.current_user_tenant_ids()','EXECUTE')
     or has_function_privilege('anon','public.can_access_tenant(uuid)','EXECUTE')
     or has_function_privilege('anon','public.current_user_app_role()','EXECUTE')
     or has_function_privilege('anon','public.is_app_admin()','EXECUTE')
     or has_function_privilege('anon','public.assign_purchasing_tenant()','EXECUTE')
     or has_function_privilege('anon','public.get_active_orders_for_tenant(uuid)','EXECUTE')
     or has_function_privilege('anon','public.get_orders_for_tenant(uuid)','EXECUTE')
     or has_function_privilege('anon','public.get_purchase_orders_for_tenant(uuid)','EXECUTE') then
    raise exception 'anon can execute an internal function.';
  end if;
  if has_function_privilege('authenticated','public.assign_purchasing_tenant()','EXECUTE') then
    raise exception 'authenticated can directly execute trigger helper.';
  end if;
  if not has_function_privilege('anon','public.get_storefront_catalog_for_host(text,integer)','EXECUTE') then
    raise exception 'Approved storefront RPC lost anon execute.';
  end if;
end;
$$;

-- Anonymous denial.
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  begin perform count(*) from public.active_orders; raise exception 'anon selected active_orders';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.v_orders; raise exception 'anon selected v_orders';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.v_purchase_orders; raise exception 'anon selected v_purchase_orders';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.get_orders_for_tenant('92000000-0000-4000-8000-000000000001');
    raise exception 'anon executed internal tenant RPC';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Tenant A direct views and RPCs retain A output and exclude B.
set local role authenticated;
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000011',true);
select set_config('request.jwt.claim.email','phase0a-member-a@example.test',true);
do $$ begin
  if public.can_access_tenant('92000000-0000-4000-8000-000000000001') is distinct from true
     or public.can_access_tenant('92000000-0000-4000-8000-000000000002') is distinct from false then
    raise exception 'Tenant A helper isolation failed.';
  end if;
  if not exists (select 1 from public.active_orders where id='92000000-0000-4000-8000-000000000201')
     or exists (select 1 from public.active_orders where id='92000000-0000-4000-8000-000000000202') then
    raise exception 'Tenant A active_orders isolation/compatibility failed.';
  end if;
  if not exists (select 1 from public.v_orders where id='92000000-0000-4000-8000-000000000201')
     or exists (select 1 from public.v_orders where id='92000000-0000-4000-8000-000000000202') then
    raise exception 'Tenant A v_orders isolation/compatibility failed.';
  end if;
  if not exists (select 1 from public.v_purchase_orders where id='92000000-0000-4000-8000-000000000301')
     or exists (select 1 from public.v_purchase_orders where id='92000000-0000-4000-8000-000000000302') then
    raise exception 'Tenant A v_purchase_orders isolation/compatibility failed.';
  end if;
  if not exists (select 1 from public.get_active_orders_for_tenant('92000000-0000-4000-8000-000000000001'))
     or exists (select 1 from public.get_active_orders_for_tenant('92000000-0000-4000-8000-000000000002'))
     or not exists (select 1 from public.get_orders_for_tenant('92000000-0000-4000-8000-000000000001'))
     or exists (select 1 from public.get_orders_for_tenant('92000000-0000-4000-8000-000000000002'))
     or not exists (select 1 from public.get_purchase_orders_for_tenant('92000000-0000-4000-8000-000000000001'))
     or exists (select 1 from public.get_purchase_orders_for_tenant('92000000-0000-4000-8000-000000000002')) then
    raise exception 'Tenant A explicit RPC isolation failed.';
  end if;
end $$;
reset role;

-- Tenant B symmetry.
set local role authenticated;
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000012',true);
select set_config('request.jwt.claim.email','phase0a-member-b@example.test',true);
do $$ begin
  if exists (select 1 from public.v_orders where id='92000000-0000-4000-8000-000000000201')
     or not exists (select 1 from public.v_orders where id='92000000-0000-4000-8000-000000000202')
     or exists (select 1 from public.v_purchase_orders where id='92000000-0000-4000-8000-000000000301')
     or not exists (select 1 from public.v_purchase_orders where id='92000000-0000-4000-8000-000000000302') then
    raise exception 'Tenant B view isolation failed.';
  end if;
end $$;
reset role;

-- App admin has Tenant A membership only; admin status cannot expose Tenant B.
set local role authenticated;
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000013',true);
select set_config('request.jwt.claim.email','phase0a-admin-a@example.test',true);
do $$ begin
  if public.is_app_admin() is distinct from true then raise exception 'Seeded admin not recognized.'; end if;
  if public.can_access_tenant('92000000-0000-4000-8000-000000000001') is distinct from true
     or public.can_access_tenant('92000000-0000-4000-8000-000000000002') is distinct from false then
    raise exception 'Admin explicit tenant context failed.';
  end if;
  if exists (select 1 from public.v_orders where id='92000000-0000-4000-8000-000000000202')
     or exists (select 1 from public.v_purchase_orders where id='92000000-0000-4000-8000-000000000302')
     or exists (select 1 from public.get_orders_for_tenant('92000000-0000-4000-8000-000000000002')) then
    raise exception 'Admin obtained inaccessible Tenant B data.';
  end if;
end $$;
reset role;

commit;