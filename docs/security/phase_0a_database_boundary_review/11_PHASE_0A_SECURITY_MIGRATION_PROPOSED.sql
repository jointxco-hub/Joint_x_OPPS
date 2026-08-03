-- OPPS PHASE 0A SECURITY MIGRATION - PROPOSED, REVIEW ONLY, UNEXECUTED.
-- Intended future migration path after approval:
--   supabase/migrations/<timestamp>_phase_0a_database_boundary_security.sql
-- This file changes only views, function definitions/options, and privileges.
-- It contains no table DDL, RLS-policy change, fixture, or data mutation.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Fail closed if runtime support or the captured output contracts drift.
do $$
declare
  v_columns text[];
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception 'Phase 0A requires PostgreSQL 15+ security-invoker views.';
  end if;

  select array_agg(column_name order by ordinal_position) into v_columns
  from information_schema.columns
  where table_schema = 'public' and table_name = 'active_orders';
  if v_columns is distinct from array[
    'id','client_name','client_email','client_phone','order_number','status',
    'priority','products','total_amount','deposit_paid','print_type',
    'special_instructions','notes','due_date','courier','tracking_number',
    'file_urls','assigned_team','linked_po_id','is_archived','archived_at',
    'archived_by','source','created_at','updated_at'
  ]::text[] then
    raise exception 'active_orders output contract drifted; stop and recapture.';
  end if;

  select array_agg(column_name order by ordinal_position) into v_columns
  from information_schema.columns
  where table_schema = 'public' and table_name = 'v_orders';
  if v_columns is distinct from array[
    'id','client_name','client_email','client_phone','order_number','status',
    'priority','products','total_amount','deposit_paid','print_type',
    'special_instructions','notes','due_date','courier','tracking_number',
    'file_urls','assigned_team','linked_po_id','is_archived','archived_at',
    'archived_by','source','created_at','updated_at','client_id','project_id',
    'client_display_name','client_status','project_name','project_code',
    'linked_po_number','po_status'
  ]::text[] then
    raise exception 'v_orders output contract drifted; stop and recapture.';
  end if;

  select array_agg(column_name order by ordinal_position) into v_columns
  from information_schema.columns
  where table_schema = 'public' and table_name = 'v_purchase_orders';
  if v_columns is distinct from array[
    'id','po_number','supplier_ids','supplier_id','items','subtotal','tax',
    'total','status','expected_delivery','notes','created_at','updated_at',
    'supplier_name','supplier_location','supplier_type'
  ]::text[] then
    raise exception 'v_purchase_orders output contract drifted; stop and recapture.';
  end if;
end;
$$;

-- Preserve exact result columns while making caller RLS effective and requiring
-- tenant membership for authenticated/app-admin callers. Service role remains an
-- explicit compatibility path for unidentified server-side consumers.
create or replace view public.active_orders
with (security_invoker = true)
as
select o.id, o.client_name, o.client_email, o.client_phone, o.order_number,
       o.status, o.priority, o.products, o.total_amount, o.deposit_paid,
       o.print_type, o.special_instructions, o.notes, o.due_date, o.courier,
       o.tracking_number, o.file_urls, o.assigned_team, o.linked_po_id,
       o.is_archived, o.archived_at, o.archived_by, o.source,
       o.created_at, o.updated_at
from public.orders o
where o.is_archived = false
  and (current_user = 'service_role' or public.can_access_tenant(o.tenant_id));

create or replace view public.v_orders
with (security_invoker = true)
as
select o.id, o.client_name, o.client_email, o.client_phone, o.order_number,
       o.status, o.priority, o.products, o.total_amount, o.deposit_paid,
       o.print_type, o.special_instructions, o.notes, o.due_date, o.courier,
       o.tracking_number, o.file_urls, o.assigned_team, o.linked_po_id,
       o.is_archived, o.archived_at, o.archived_by, o.source,
       o.created_at, o.updated_at, o.client_id, o.project_id,
       c.name as client_display_name, c.status as client_status,
       p.name as project_name, p.project_code,
       po.po_number as linked_po_number, po.status as po_status
from public.orders o
left join public.clients c on o.client_id = c.id
left join public.projects p on o.project_id = p.id
left join public.purchase_orders po on o.linked_po_id = po.id
where current_user = 'service_role' or public.can_access_tenant(o.tenant_id);

create or replace view public.v_purchase_orders
with (security_invoker = true)
as
select po.id, po.po_number, po.supplier_ids, po.supplier_id, po.items,
       po.subtotal, po.tax, po.total, po.status, po.expected_delivery,
       po.notes, po.created_at, po.updated_at,
       s.name as supplier_name, s.location as supplier_location,
       s.type as supplier_type
from public.purchase_orders po
left join public.suppliers s on po.supplier_id = s.id
where po.status <> all (array['archived'::text, 'cancelled'::text])
  and (current_user = 'service_role' or public.can_access_tenant(po.tenant_id));

-- Remove every inherited/default client privilege, then restore SELECT only to
-- the two required internal roles. No anonymous view access remains.
revoke all privileges on table public.active_orders
  from public, anon, authenticated, service_role;
revoke all privileges on table public.v_orders
  from public, anon, authenticated, service_role;
revoke all privileges on table public.v_purchase_orders
  from public, anon, authenticated, service_role;
grant select on table public.active_orders to authenticated, service_role;
grant select on table public.v_orders to authenticated, service_role;
grant select on table public.v_purchase_orders to authenticated, service_role;

-- Explicit-tenant equivalents for controlled consumer migration. Return types
-- are the existing view composites, preserving column order and types.
create or replace function public.get_active_orders_for_tenant(p_tenant_id uuid)
returns setof public.active_orders
language sql security invoker stable
set search_path = pg_catalog, public
as $$
  select v.* from public.active_orders v
  join public.orders o on o.id = v.id
  where o.tenant_id = p_tenant_id
    and (current_user = 'service_role' or public.can_access_tenant(p_tenant_id))
$$;

create or replace function public.get_orders_for_tenant(p_tenant_id uuid)
returns setof public.v_orders
language sql security invoker stable
set search_path = pg_catalog, public
as $$
  select v.* from public.v_orders v
  join public.orders o on o.id = v.id
  where o.tenant_id = p_tenant_id
    and (current_user = 'service_role' or public.can_access_tenant(p_tenant_id))
$$;

create or replace function public.get_purchase_orders_for_tenant(p_tenant_id uuid)
returns setof public.v_purchase_orders
language sql security invoker stable
set search_path = pg_catalog, public
as $$
  select v.* from public.v_purchase_orders v
  join public.purchase_orders po on po.id = v.id
  where po.tenant_id = p_tenant_id
    and (current_user = 'service_role' or public.can_access_tenant(p_tenant_id))
$$;

revoke all on function public.get_active_orders_for_tenant(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_orders_for_tenant(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_purchase_orders_for_tenant(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_active_orders_for_tenant(uuid)
  to authenticated, service_role;
grant execute on function public.get_orders_for_tenant(uuid)
  to authenticated, service_role;
grant execute on function public.get_purchase_orders_for_tenant(uuid)
  to authenticated, service_role;

-- RLS helpers remain executable by authenticated policy evaluation, but no
-- longer inherit execution through PUBLIC/anon.
revoke all on function public.current_user_tenant_ids()
  from public, anon, authenticated, service_role;
revoke all on function public.can_access_tenant(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.current_user_app_role()
  from public, anon, authenticated, service_role;
revoke all on function public.is_app_admin()
  from public, anon, authenticated, service_role;
grant execute on function public.current_user_tenant_ids() to authenticated, service_role;
grant execute on function public.can_access_tenant(uuid) to authenticated, service_role;
grant execute on function public.current_user_app_role() to authenticated, service_role;
grant execute on function public.is_app_admin() to authenticated, service_role;
alter function public.current_user_tenant_ids() set search_path = pg_catalog, public;
alter function public.can_access_tenant(uuid) set search_path = pg_catalog, public;
alter function public.current_user_app_role() set search_path = pg_catalog, public;
alter function public.is_app_admin() set search_path = pg_catalog, public;

-- Trigger-only helper: reject unresolved/cross-tenant parents with one generic
-- message and prevent direct client execution. RLS remains the final write gate.
create or replace function public.assign_purchasing_tenant()
returns trigger
language plpgsql security definer
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
     or (nullif(v_row->>'tenant_id', '') is not null and v_resolved_tenant is not null
         and (v_row->>'tenant_id')::uuid is distinct from v_resolved_tenant)
     or (auth.uid() is not null and v_resolved_tenant is not null
         and not public.can_access_tenant(v_resolved_tenant)) then
    raise exception using errcode = '23514', message = 'Invalid purchasing relationship.';
  end if;

  if v_resolved_tenant is not null then new.tenant_id := v_resolved_tenant; end if;
  return new;
exception when invalid_text_representation then
  raise exception using errcode = '23514', message = 'Invalid purchasing relationship.';
end;
$$;
revoke all on function public.assign_purchasing_tenant()
  from public, anon, authenticated, service_role;
grant execute on function public.assign_purchasing_tenant() to service_role;

-- Intentional anonymous exception. PUBLIC stays absent; named roles are explicit.
revoke all on function public.get_storefront_catalog_for_host(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_storefront_catalog_for_host(text, integer)
  to anon, authenticated, service_role;
alter function public.get_storefront_catalog_for_host(text, integer)
  set search_path = pg_catalog, public;

commit;
