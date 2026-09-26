-- ACCESS-01 Phase 1: authorization catalog contracts.
--
-- Read-only against application objects. The DO blocks inspect PostgreSQL
-- catalogs and raise a focused exception when a contract is broken. Run
-- against a disposable/local database after migrations, or against an
-- explicitly authorized read-only target:
--   supabase db query --local --file supabase/tests/access_01_authorization_contracts.sql

\set ON_ERROR_STOP on

begin read only;

do $contracts$
declare
  v_table text;
  v_function regprocedure;
  v_search_path text;
begin
  -- Representative sensitive set only. Authenticated CRUD is intentional:
  -- these are OPPS Data API surfaces whose row authority is RLS. Anonymous
  -- DML and dangerous authenticated table privileges are never intentional.
  foreach v_table in array array[
    'tenants',
    'tenant_memberships',
    'users',
    'clients',
    'orders',
    'transactions',
    'opps_invoices',
    'suppliers',
    'purchase_orders'
  ] loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'required sensitive table public.% does not exist', v_table;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_table
        and c.relrowsecurity
    ) then
      raise exception '% must have RLS enabled', v_table;
    end if;

    if has_table_privilege('anon', format('public.%I', v_table),
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception '% unexpectedly grants a table privilege to anon', v_table;
    end if;

    if has_table_privilege('authenticated', format('public.%I', v_table),
      'TRUNCATE,REFERENCES,TRIGGER') then
      raise exception '% unexpectedly grants a dangerous table privilege to authenticated', v_table;
    end if;

    if not (
      has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT')
      and has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
      and has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
      and has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE')
    ) then
      raise exception '% must retain documented authenticated CRUD; RLS is the row authority', v_table;
    end if;

    if not exists (
      select 1 from pg_catalog.pg_policies p
      where p.schemaname = 'public' and p.tablename = v_table
    ) then
      raise exception '% must have at least one RLS policy', v_table;
    end if;
  end loop;

  -- public.users stores global identity records, so it intentionally uses a
  -- stricter self/app-admin boundary. Tenant admin or ordinary OPPS staff
  -- status must not imply global user-management authority. Policy names are
  -- deliberately ignored; the command, role, and predicate shape are the
  -- contract. Predicate comparison removes only whitespace, parentheses, and
  -- optional public. qualification from pg_policies' rendered expressions.
  if exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'users'
      and p.roles && array['anon', 'public']::name[]
  ) then
    raise exception 'users policies must not target anon or PUBLIC';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'users'
      and p.cmd = 'ALL'
  ) then
    raise exception 'users must not have a FOR ALL policy';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'users'
      and p.roles @> array['authenticated']::name[]
  ) <> 4 then
    raise exception 'users must have exactly four authenticated command-specific policies';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'users'
      and p.cmd = 'SELECT'
      and p.permissive = 'PERMISSIVE'
      and p.roles = array['authenticated']::name[]
      and regexp_replace(
        regexp_replace(lower(coalesce(p.qual, '')), '[[:space:]]+', '', 'g'),
        'public[.]|[()]', '', 'g'
      ) = 'auth_user_id=auth.uidoris_app_admin'
      and p.with_check is null
  ) then
    raise exception 'users SELECT must be limited to self or app admin';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'users'
      and p.cmd = 'INSERT'
      and p.permissive = 'PERMISSIVE'
      and p.roles = array['authenticated']::name[]
      and p.qual is null
      and regexp_replace(
        regexp_replace(lower(coalesce(p.with_check, '')), '[[:space:]]+', '', 'g'),
        'public[.]|[()]', '', 'g'
      ) = 'is_app_admin'
  ) then
    raise exception 'users INSERT must require app admin through WITH CHECK';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'users'
      and p.cmd = 'UPDATE'
      and p.permissive = 'PERMISSIVE'
      and p.roles = array['authenticated']::name[]
      and regexp_replace(
        regexp_replace(lower(coalesce(p.qual, '')), '[[:space:]]+', '', 'g'),
        'public[.]|[()]', '', 'g'
      ) = 'is_app_admin'
      and regexp_replace(
        regexp_replace(lower(coalesce(p.with_check, '')), '[[:space:]]+', '', 'g'),
        'public[.]|[()]', '', 'g'
      ) = 'is_app_admin'
  ) then
    raise exception 'users UPDATE must require app admin through USING and WITH CHECK';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'users'
      and p.cmd = 'DELETE'
      and p.permissive = 'PERMISSIVE'
      and p.roles = array['authenticated']::name[]
      and regexp_replace(
        regexp_replace(lower(coalesce(p.qual, '')), '[[:space:]]+', '', 'g'),
        'public[.]|[()]', '', 'g'
      ) = 'is_app_admin'
      and p.with_check is null
  ) then
    raise exception 'users DELETE must require app admin through USING';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'users'
      and lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''))
        ~ '(is_opps_staff|can_access_tenant|can_manage_opps_user|current_user_tenant_ids|tenant_memberships|tenant_role)'
  ) then
    raise exception 'users policies must not substitute OPPS staff or tenant authority for global identity authority';
  end if;

  -- The remaining tenant operational tables use a restrictive staff gate
  -- combined with their existing permissive tenant/resource policies.

  foreach v_table in array array[
    'tenants', 'tenant_memberships', 'clients', 'orders', 'transactions',
    'opps_invoices', 'suppliers', 'purchase_orders'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = v_table
        and policyname = 'xos1_require_opps_staff'
        and permissive = 'RESTRICTIVE'
    ) then
      raise exception '% must retain restrictive policy xos1_require_opps_staff', v_table;
    end if;

    if not exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = v_table
        and permissive = 'PERMISSIVE'
    ) then
      raise exception '% must retain a permissive tenant/resource policy beneath the staff gate', v_table;
    end if;
  end loop;

  -- Core authority helpers: callable only by authenticated/service roles,
  -- never anon or implicit PUBLIC, and hardened with pg_catalog first.
  foreach v_function in array array[
    'public.is_opps_staff()'::regprocedure,
    'public.is_app_admin()'::regprocedure,
    'public.can_access_tenant(uuid)'::regprocedure,
    'public.current_user_tenant_ids()'::regprocedure
  ] loop
    if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_function) then
      raise exception 'function % must remain SECURITY DEFINER', v_function;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_proc p,
           lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
      where p.oid = v_function and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) then
      raise exception 'function % unexpectedly grants EXECUTE to PUBLIC', v_function;
    end if;

    if has_function_privilege('anon', v_function, 'EXECUTE') then
      raise exception 'function % unexpectedly grants EXECUTE to anon', v_function;
    end if;
    if not has_function_privilege('authenticated', v_function, 'EXECUTE') then
      raise exception 'function % must grant EXECUTE to authenticated', v_function;
    end if;
    if not has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'function % must grant EXECUTE to service_role', v_function;
    end if;

    select array_to_string(p.proconfig, ',') into v_search_path
    from pg_catalog.pg_proc p where p.oid = v_function;
    if coalesce(v_search_path, '') !~ '^search_path=pg_catalog, ?public$' then
      raise exception 'function % must use hardened search_path pg_catalog, public (got %)',
        v_function, coalesce(v_search_path, '(unset)');
    end if;
  end loop;
end
$contracts$;

do $rpc_contracts$
declare
  v_function regprocedure;
  v_allow_anon boolean;
  v_search_path text;
  v_spec text;
begin
  -- Small representative SECURITY DEFINER API sample. The XOS gate is
  -- intentionally callable before sign-in so it may reveal only generic
  -- configured/access-denied state; the other RPCs require authentication.
  foreach v_spec in array array[
    'public.resolve_xos_admin_gate(text)|true',
    'public.admin_list_managed_clients()|false',
    'public.get_my_client_products()|false',
    'public.get_my_invoices()|false'
  ] loop
    v_function := split_part(v_spec, '|', 1)::regprocedure;
    v_allow_anon := split_part(v_spec, '|', 2)::boolean;

    if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_function) then
      raise exception 'function % must remain SECURITY DEFINER', v_function;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_proc p,
           lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
      where p.oid = v_function and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) then
      raise exception 'function % unexpectedly grants EXECUTE to PUBLIC', v_function;
    end if;

    if has_function_privilege('anon', v_function, 'EXECUTE') is distinct from v_allow_anon then
      raise exception 'function % anon EXECUTE contract must be %', v_function, v_allow_anon;
    end if;
    if not has_function_privilege('authenticated', v_function, 'EXECUTE') then
      raise exception 'function % must grant EXECUTE to authenticated', v_function;
    end if;

    select array_to_string(p.proconfig, ',') into v_search_path
    from pg_catalog.pg_proc p where p.oid = v_function;
    if coalesce(v_search_path, '') !~ '^search_path=pg_catalog, ?public$' then
      raise exception 'function % must use hardened search_path pg_catalog, public (got %)',
        v_function, coalesce(v_search_path, '(unset)');
    end if;
  end loop;
end
$rpc_contracts$;

-- Compact metadata surface for future behavioral tenant tests; this makes
-- restrictive/permissive composition reviewable without a pg_catalog dump.
select tablename, policyname, permissive, cmd
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in (
    'tenants', 'tenant_memberships', 'users', 'clients', 'orders',
    'transactions', 'opps_invoices', 'suppliers', 'purchase_orders'
  )
order by tablename, permissive, policyname;

rollback;

select 'ACCESS-01 authorization contracts passed' as result;
