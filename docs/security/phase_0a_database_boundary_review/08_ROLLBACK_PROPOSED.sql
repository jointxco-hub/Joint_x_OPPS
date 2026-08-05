-- PHASE 0A SECURITY-SAFE ROLLBACK - PROPOSED, UNEXECUTED.
-- Reverts new RPCs and purchasing-trigger behavior while retaining the hardened
-- security-invoker tenant boundary. It changes no data or RLS policy.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

revoke all on function public.get_active_orders_for_tenant(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_orders_for_tenant(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_purchase_orders_for_tenant(uuid)
  from public, anon, authenticated, service_role;
drop function if exists public.get_active_orders_for_tenant(uuid);
drop function if exists public.get_orders_for_tenant(uuid);
drop function if exists public.get_purchase_orders_for_tenant(uuid);

-- Preserve finalized output definitions and tenant boundary so rollback does not
-- reopen owner-context or app-admin cross-tenant execution.
create or replace view public.active_orders with (security_invoker=true) as
select id,client_name,client_email,client_phone,order_number,status,priority,
       products,total_amount,deposit_paid,print_type,special_instructions,notes,
       due_date,courier,tracking_number,file_urls,assigned_team,linked_po_id,
       is_archived,archived_at,archived_by,source,created_at,updated_at
from public.orders
where is_archived=false
  and (current_user='service_role' or public.can_access_tenant(tenant_id));

create or replace view public.v_orders with (security_invoker=true) as
select o.id,o.client_name,o.client_email,o.client_phone,o.order_number,o.status,
       o.priority,o.products,o.total_amount,o.deposit_paid,o.print_type,
       o.special_instructions,o.notes,o.due_date,o.courier,o.tracking_number,
       o.file_urls,o.assigned_team,o.linked_po_id,o.is_archived,o.archived_at,
       o.archived_by,o.source,o.created_at,o.updated_at,o.client_id,o.project_id,
       c.name as client_display_name,c.status as client_status,
       p.name as project_name,p.project_code,po.po_number as linked_po_number,
       po.status as po_status
from public.orders o
left join public.clients c on o.client_id=c.id
left join public.projects p on o.project_id=p.id
left join public.purchase_orders po on o.linked_po_id=po.id
where current_user='service_role' or public.can_access_tenant(o.tenant_id);

create or replace view public.v_purchase_orders with (security_invoker=true) as
select po.id,po.po_number,po.supplier_ids,po.supplier_id,po.items,po.subtotal,
       po.tax,po.total,po.status,po.expected_delivery,po.notes,po.created_at,
       po.updated_at,s.name as supplier_name,s.location as supplier_location,
       s.type as supplier_type
from public.purchase_orders po
left join public.suppliers s on po.supplier_id=s.id
where po.status <> all(array['archived'::text,'cancelled'::text])
  and (current_user='service_role' or public.can_access_tenant(po.tenant_id));

revoke all privileges on table public.active_orders from public,anon,authenticated,service_role;
revoke all privileges on table public.v_orders from public,anon,authenticated,service_role;
revoke all privileges on table public.v_purchase_orders from public,anon,authenticated,service_role;
grant select on table public.active_orders to authenticated,service_role;
grant select on table public.v_orders to authenticated,service_role;
grant select on table public.v_purchase_orders to authenticated,service_role;

-- Restore the captured trigger behavior, retaining the safer path and grants.
create or replace function public.assign_purchasing_tenant()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
declare supplier_tenant uuid; project_tenant uuid; order_tenant uuid; resolved_tenant uuid;
begin
  if tg_table_name='inventory' and (to_jsonb(new)->>'preferred_supplier_id') is not null then
    select tenant_id into supplier_tenant from public.suppliers
    where id=(to_jsonb(new)->>'preferred_supplier_id')::uuid;
  elsif tg_table_name='purchase_orders' then
    if (to_jsonb(new)->>'supplier_id') is not null then
      select tenant_id into supplier_tenant from public.suppliers where id=(to_jsonb(new)->>'supplier_id')::uuid;
    end if;
    if (to_jsonb(new)->>'project_id') is not null then
      select tenant_id into project_tenant from public.projects where id=(to_jsonb(new)->>'project_id')::uuid;
    end if;
    if (to_jsonb(new)->>'linked_order_id') is not null then
      select tenant_id into order_tenant from public.orders where id=(to_jsonb(new)->>'linked_order_id')::uuid;
    end if;
  end if;
  resolved_tenant:=coalesce(supplier_tenant,project_tenant,order_tenant);
  if (supplier_tenant is not null and resolved_tenant<>supplier_tenant)
     or (project_tenant is not null and resolved_tenant<>project_tenant)
     or (order_tenant is not null and resolved_tenant<>order_tenant) then
    raise exception 'Supplier, project, and order links must belong to one tenant.';
  end if;
  if new.tenant_id is not null and resolved_tenant is not null and new.tenant_id<>resolved_tenant then
    raise exception 'Purchasing tenant must match linked records.';
  end if;
  if resolved_tenant is not null then new.tenant_id:=resolved_tenant; end if;
  return new;
end $$;
revoke all on function public.assign_purchasing_tenant() from public,anon,authenticated,service_role;
grant execute on function public.assign_purchasing_tenant() to service_role;

-- Keep hardened helper/storefront role boundaries after rollback.
revoke all on function public.current_user_tenant_ids() from public,anon,authenticated,service_role;
revoke all on function public.can_access_tenant(uuid) from public,anon,authenticated,service_role;
revoke all on function public.current_user_app_role() from public,anon,authenticated,service_role;
revoke all on function public.is_app_admin() from public,anon,authenticated,service_role;
grant execute on function public.current_user_tenant_ids() to authenticated,service_role;
grant execute on function public.can_access_tenant(uuid) to authenticated,service_role;
grant execute on function public.current_user_app_role() to authenticated,service_role;
grant execute on function public.is_app_admin() to authenticated,service_role;
revoke all on function public.get_storefront_catalog_for_host(text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.get_storefront_catalog_for_host(text,integer)
  to anon,authenticated,service_role;

commit;

select has_table_privilege('anon','public.active_orders','SELECT') as anon_active_orders,
       has_table_privilege('anon','public.v_orders','SELECT') as anon_v_orders,
       has_table_privilege('anon','public.v_purchase_orders','SELECT') as anon_v_purchase_orders;