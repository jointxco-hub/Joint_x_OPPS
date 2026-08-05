-- SUPERSEDED COMPONENT DRAFT. Use 11_PHASE_0A_SECURITY_MIGRATION_PROPOSED.sql.
-- PROPOSED PHASE 0A SQL - DO NOT EXECUTE WITHOUT SEPARATE AUTHORIZATION.
-- No view definition or output column is changed by the preferred treatment.

-- A. READ-ONLY PREFLIGHT. Capture and attach this output before finalizing a
-- migration so every deployed definition, grant, owner, and dependency is known.
select n.nspname as view_schema,
       c.relname as view_name,
       pg_get_userbyid(c.relowner) as owner_name,
       c.reloptions,
       pg_get_viewdef(c.oid, true) as view_definition
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('active_orders', 'v_orders', 'v_purchase_orders')
  and c.relkind = 'v'
order by c.relname;

select table_schema, table_name, grantee, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('active_orders', 'v_orders', 'v_purchase_orders')
order by table_name, grantee, privilege_type;

select view_schema, view_name, table_schema as dependency_schema,
       table_name as dependency_name
from information_schema.view_table_usage
where view_schema = 'public'
  and view_name in ('active_orders', 'v_orders', 'v_purchase_orders')
order by view_name, table_schema, table_name;

select usage.view_name, usage.table_schema, usage.table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from information_schema.view_table_usage usage
join pg_namespace n on n.nspname = usage.table_schema
join pg_class c on c.relnamespace = n.oid and c.relname = usage.table_name
where usage.view_schema = 'public'
  and usage.view_name in ('active_orders', 'v_orders', 'v_purchase_orders')
order by usage.view_name, usage.table_schema, usage.table_name;

-- B. PREFERRED CONTAINMENT AND EXPLICIT-TENANT REMEDIATION. Review only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception 'security_invoker views require PostgreSQL 15 or later';
  end if;
  if to_regclass('public.active_orders') is null
     or to_regclass('public.v_orders') is null
     or to_regclass('public.v_purchase_orders') is null then
    raise exception 'Expected Phase 0A view is missing; stop and recapture drift';
  end if;
end;
$$;

-- Remove anonymous access before changing execution context.
revoke all privileges on table public.active_orders from public, anon;
revoke all privileges on table public.v_orders from public, anon;
revoke all privileges on table public.v_purchase_orders from public, anon;

-- Preserve definitions and output columns while making base-table RLS execute
-- as the caller. Changing grants alone would not fix owner-context execution.
alter view public.active_orders set (security_invoker = true);
alter view public.v_orders set (security_invoker = true);
alter view public.v_purchase_orders set (security_invoker = true);

-- Do not restore direct authenticated access. Existing app-admin base policies
-- can be broader than explicit tenant membership. Service-side maintenance is
-- named explicitly and must never use an end-user token.
grant select on table public.active_orders to service_role;
grant select on table public.v_orders to service_role;
grant select on table public.v_purchase_orders to service_role;

-- Preserve the active-orders row shape while requiring explicit, accessible
-- tenant context. App-admin status alone is insufficient.
create or replace function public.get_active_orders_for_tenant(p_tenant_id uuid)
returns setof public.orders
language sql
security invoker
stable
set search_path = pg_catalog, public
as $$
  select order_row.*
  from public.orders order_row
  where order_row.tenant_id = p_tenant_id
    and coalesce(order_row.is_archived, false) = false
    and public.can_access_tenant(p_tenant_id)
$$;

revoke all on function public.get_active_orders_for_tenant(uuid)
  from public, anon, authenticated;
grant execute on function public.get_active_orders_for_tenant(uuid)
  to authenticated, service_role;

-- No INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER grants are restored.
commit;

-- Required follow-up after consumer review:
--   * drop v_orders/v_purchase_orders if truly unused; or
--   * replace a required view with an authenticated RPC that requires an
--     explicit tenant ID and rejects inaccessible tenants with one generic error.
-- Neither alternative is authorized by this draft.
