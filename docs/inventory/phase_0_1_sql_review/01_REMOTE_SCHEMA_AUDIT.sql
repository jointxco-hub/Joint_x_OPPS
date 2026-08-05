-- OPPS Inventory Phase 0/1: remote schema audit (READ ONLY).
-- Run manually only after authorization against the target database.
-- This script reads PostgreSQL catalogs and information_schema; it changes nothing.

begin;
set transaction read only;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

-- 1. Server/version context. Record this with the report.
select current_database() as database_name,
       current_user as executing_role,
       version() as postgres_version,
       current_setting('server_version_num') as server_version_num,
       now() as inspected_at;

-- 2. Presence, type, owner, RLS, and estimated size of relevant relations.
select n.nspname as schema_name,
       c.relname as relation_name,
       c.relkind,
       pg_get_userbyid(c.relowner) as owner_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced,
       c.reltuples::bigint as estimated_rows,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total_size
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'inventory', 'suppliers', 'purchase_orders', 'orders', 'products',
    'tenants', 'tenant_memberships',
    'inventory_products', 'inventory_variants',
    'inventory_supplier_products', 'inventory_supplier_variants',
    'inventory_legacy_mappings'
  )
order by c.relname;

-- 3. Exact columns, defaults, generated/identity state, and nullability.
select c.table_schema,
       c.table_name,
       c.ordinal_position,
       c.column_name,
       c.data_type,
       c.udt_name,
       c.is_nullable,
       c.column_default,
       c.is_identity,
       c.identity_generation,
       c.is_generated,
       c.generation_expression
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in (
    'inventory', 'suppliers', 'purchase_orders', 'orders', 'products',
    'tenants', 'tenant_memberships',
    'inventory_products', 'inventory_variants',
    'inventory_supplier_products', 'inventory_supplier_variants',
    'inventory_legacy_mappings'
  )
order by c.table_name, c.ordinal_position;

-- 4. Constraints, including the complete definition.
select n.nspname as schema_name,
       c.relname as table_name,
       con.conname as constraint_name,
       con.contype as constraint_type,
       con.convalidated as is_validated,
       pg_get_constraintdef(con.oid, true) as definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'inventory', 'suppliers', 'purchase_orders', 'orders', 'products',
    'tenants', 'tenant_memberships',
    'inventory_products', 'inventory_variants',
    'inventory_supplier_products', 'inventory_supplier_variants',
    'inventory_legacy_mappings'
  )
order by c.relname, con.conname;

-- 5. Exact index definitions.
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'inventory', 'suppliers', 'purchase_orders', 'orders', 'products',
    'tenants', 'tenant_memberships',
    'inventory_products', 'inventory_variants',
    'inventory_supplier_products', 'inventory_supplier_variants',
    'inventory_legacy_mappings'
  )
order by tablename, indexname;

-- 6. Non-internal triggers and their function definitions.
select n.nspname as schema_name,
       c.relname as table_name,
       t.tgname as trigger_name,
       t.tgenabled as enabled_state,
       pg_get_triggerdef(t.oid, true) as trigger_definition,
       pn.nspname || '.' || p.proname as function_name,
       pg_get_functiondef(p.oid) as function_definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
join pg_namespace pn on pn.oid = p.pronamespace
where not t.tgisinternal
  and n.nspname = 'public'
  and c.relname in ('inventory', 'suppliers', 'purchase_orders', 'orders', 'products', 'tenant_memberships')
order by c.relname, t.tgname;

-- 7. RLS policies, roles, expressions, and commands.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'inventory', 'suppliers', 'purchase_orders', 'orders', 'products',
    'tenants', 'tenant_memberships',
    'inventory_products', 'inventory_variants',
    'inventory_supplier_products', 'inventory_supplier_variants',
    'inventory_legacy_mappings'
  )
order by tablename, policyname;

-- 8. Table/view grants, including PUBLIC/anon/authenticated/service_role.
select table_schema, table_name, grantor, grantee, privilege_type, is_grantable
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in (
    'inventory', 'suppliers', 'purchase_orders', 'orders', 'products',
    'tenants', 'tenant_memberships',
    'inventory_products', 'inventory_variants',
    'inventory_supplier_products', 'inventory_supplier_variants',
    'inventory_legacy_mappings'
  )
order by table_name, grantee, privilege_type;

-- 9. Views and materialized views that reference relevant relations.
select schemaname, viewname, viewowner, definition
from pg_views
where schemaname = 'public'
  and (
    viewname ilike '%inventory%'
    or viewname ilike '%supplier%'
    or definition ~* '\m(inventory|suppliers|purchase_orders|orders|products)\M'
  )
order by viewname;

select schemaname, matviewname, matviewowner, definition
from pg_matviews
where schemaname = 'public'
  and (
    matviewname ilike '%inventory%'
    or matviewname ilike '%supplier%'
    or definition ~* '\m(inventory|suppliers|purchase_orders|orders|products)\M'
  )
order by matviewname;

-- 10. Tenant helpers and relevant RPCs, including security mode/search_path.
select n.nspname as schema_name,
       p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as identity_arguments,
       pg_get_function_result(p.oid) as result_type,
       l.lanname as language_name,
       p.prosecdef as security_definer,
       p.provolatile as volatility,
       p.proconfig as function_settings,
       pg_get_userbyid(p.proowner) as owner_name,
       pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname = 'public'
  and p.prokind in ('f', 'p')
  and (
    p.proname in (
      'current_user_tenant_ids', 'can_access_tenant', 'is_app_admin',
      'current_user_app_role', 'assign_purchasing_tenant'
    )
    or p.proname ~* '(inventory|supplier|purchase|order|storefront|tenant)'
  )
order by p.proname, identity_arguments;

-- 11. Function execute grants for the same helpers/RPC family.
select routine_schema, routine_name, specific_name, grantor, grantee, privilege_type, is_grantable
from information_schema.routine_privileges
where routine_schema = 'public'
  and (
    routine_name in ('current_user_tenant_ids', 'can_access_tenant', 'is_app_admin', 'current_user_app_role')
    or routine_name ~* '(inventory|supplier|purchase|order|storefront|tenant)'
  )
order by routine_name, grantee;

-- 12. Extension availability relevant to the proposal.
select e.extname, e.extversion, n.nspname as installed_schema
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where e.extname in ('pgcrypto', 'citext', 'pg_trgm')
order by e.extname;

commit;
