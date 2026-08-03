-- SUPERSEDED COMPONENT DRAFT. Use 11_PHASE_0A_SECURITY_MIGRATION_PROPOSED.sql.
-- PROPOSED PHASE 0A SQL - DO NOT EXECUTE WITHOUT SEPARATE AUTHORIZATION.
-- This proposal must be tested against a seeded disposable clone because these
-- helpers are called by RLS policies and triggers.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Remove PostgreSQL's default PUBLIC execution path first.
revoke all on function public.current_user_tenant_ids() from public, anon;
revoke all on function public.can_access_tenant(uuid) from public, anon;
revoke all on function public.current_user_app_role() from public, anon;
revoke all on function public.is_app_admin() from public, anon;
revoke all on function public.assign_purchasing_tenant() from public, anon, authenticated;

-- RLS policy callers require these helpers. Service role is explicit rather
-- than inheriting from PUBLIC.
grant execute on function public.current_user_tenant_ids() to authenticated, service_role;
grant execute on function public.can_access_tenant(uuid) to authenticated, service_role;
grant execute on function public.current_user_app_role() to authenticated, service_role;
grant execute on function public.is_app_admin() to authenticated, service_role;
grant execute on function public.assign_purchasing_tenant() to service_role;

alter function public.current_user_tenant_ids() set search_path = pg_catalog, public;
alter function public.can_access_tenant(uuid) set search_path = pg_catalog, public;
alter function public.current_user_app_role() set search_path = pg_catalog, public;
alter function public.is_app_admin() set search_path = pg_catalog, public;

-- Strengthen the existing trigger without changing rows. Parent failures use one
-- generic message so callers cannot distinguish missing from cross-tenant IDs.
create or replace function public.assign_purchasing_tenant()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_parent_id uuid;
  v_supplier_tenant uuid;
  v_project_tenant uuid;
  v_order_tenant uuid;
  v_resolved_tenant uuid;
begin
  if tg_table_schema <> 'public'
     or tg_table_name not in ('suppliers', 'inventory', 'purchase_orders') then
    raise exception using errcode = '42501', message = 'Invalid purchasing relationship.';
  end if;

  if tg_table_name = 'inventory'
     and nullif(v_row->>'preferred_supplier_id', '') is not null then
    v_parent_id := (v_row->>'preferred_supplier_id')::uuid;
    select tenant_id into v_supplier_tenant from public.suppliers where id = v_parent_id;
    if not found or v_supplier_tenant is null then
      raise exception using errcode = '23514', message = 'Invalid purchasing relationship.';
    end if;
  elsif tg_table_name = 'purchase_orders' then
    if nullif(v_row->>'supplier_id', '') is not null then
      v_parent_id := (v_row->>'supplier_id')::uuid;
      select tenant_id into v_supplier_tenant from public.suppliers where id = v_parent_id;
      if not found or v_supplier_tenant is null then
        raise exception using errcode = '23514', message = 'Invalid purchasing relationship.';
      end if;
    end if;
    if nullif(v_row->>'project_id', '') is not null then
      v_parent_id := (v_row->>'project_id')::uuid;
      select tenant_id into v_project_tenant from public.projects where id = v_parent_id;
      if not found or v_project_tenant is null then
        raise exception using errcode = '23514', message = 'Invalid purchasing relationship.';
      end if;
    end if;
    if nullif(v_row->>'linked_order_id', '') is not null then
      v_parent_id := (v_row->>'linked_order_id')::uuid;
      select tenant_id into v_order_tenant from public.orders where id = v_parent_id;
      if not found or v_order_tenant is null then
        raise exception using errcode = '23514', message = 'Invalid purchasing relationship.';
      end if;
    end if;
  end if;

  v_resolved_tenant := coalesce(v_supplier_tenant, v_project_tenant, v_order_tenant);
  if (v_supplier_tenant is not null and v_supplier_tenant is distinct from v_resolved_tenant)
     or (v_project_tenant is not null and v_project_tenant is distinct from v_resolved_tenant)
     or (v_order_tenant is not null and v_order_tenant is distinct from v_resolved_tenant)
     or ((v_row->>'tenant_id') is not null and v_resolved_tenant is not null
         and (v_row->>'tenant_id')::uuid is distinct from v_resolved_tenant) then
    raise exception using errcode = '23514', message = 'Invalid purchasing relationship.';
  end if;

  if v_resolved_tenant is not null then
    new.tenant_id := v_resolved_tenant;
  end if;
  return new;
exception
  when invalid_text_representation then
    raise exception using errcode = '23514', message = 'Invalid purchasing relationship.';
end;
$$;

revoke all on function public.assign_purchasing_tenant() from public, anon, authenticated;
grant execute on function public.assign_purchasing_tenant() to service_role;

-- Intentional public storefront exception: PUBLIC remains absent; named client
-- roles retain only EXECUTE.
revoke all on function public.get_storefront_catalog_for_host(text, integer)
  from public, anon, authenticated;
grant execute on function public.get_storefront_catalog_for_host(text, integer)
  to anon, authenticated;
alter function public.get_storefront_catalog_for_host(text, integer)
  set search_path = pg_catalog, public;

commit;
