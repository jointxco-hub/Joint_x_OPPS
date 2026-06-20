-- Phase 2D: tenant ownership for purchasing, suppliers, and inventory.

create or replace function public.assign_purchasing_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
declare supplier_tenant uuid; project_tenant uuid; order_tenant uuid; resolved_tenant uuid;
begin
  if tg_table_name = 'inventory' and new.preferred_supplier_id is not null then select tenant_id into supplier_tenant from public.suppliers where id = new.preferred_supplier_id;
  elsif tg_table_name = 'purchase_orders' then
    if new.supplier_id is not null then select tenant_id into supplier_tenant from public.suppliers where id = new.supplier_id; end if;
    if new.project_id is not null then select tenant_id into project_tenant from public.projects where id = new.project_id; end if;
    if new.linked_order_id is not null then select tenant_id into order_tenant from public.orders where id = new.linked_order_id; end if;
  end if;
  resolved_tenant := coalesce(supplier_tenant, project_tenant, order_tenant);
  if (supplier_tenant is not null and resolved_tenant <> supplier_tenant) or (project_tenant is not null and resolved_tenant <> project_tenant) or (order_tenant is not null and resolved_tenant <> order_tenant) then raise exception 'Supplier, project, and order links must belong to one tenant.'; end if;
  if new.tenant_id is not null and resolved_tenant is not null and new.tenant_id <> resolved_tenant then raise exception 'Purchasing tenant must match linked records.'; end if;
  if resolved_tenant is not null then new.tenant_id := resolved_tenant; end if;
  return new;
end;
$$;

do $$ declare table_name text; begin
  foreach table_name in array array['suppliers','inventory','purchase_orders'] loop
    execute format('alter table public.%I add column if not exists tenant_id uuid references public.tenants(id) on delete restrict', table_name);
    execute format('create index if not exists %I on public.%I (tenant_id)', 'idx_' || table_name || '_tenant_id', table_name);
    execute format('drop trigger if exists trg_%I_tenant on public.%I', table_name, table_name);
    execute format('create trigger trg_%I_tenant before insert or update on public.%I for each row execute function public.assign_purchasing_tenant()', table_name, table_name);
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', 'tenant_manage_' || table_name, table_name);
    execute format('create policy %I on public.%I for all to authenticated using (public.can_access_tenant(tenant_id)) with check (public.can_access_tenant(tenant_id))', 'tenant_manage_' || table_name, table_name);
  end loop;
end$$;

drop policy if exists "Auth users manage purchase_orders" on public.purchase_orders;

update public.suppliers set tenant_id = (select id from public.tenants where slug = 'joint-x') where tenant_id is null;
update public.inventory i set tenant_id = coalesce((select tenant_id from public.suppliers where id = i.preferred_supplier_id), (select id from public.tenants where slug = 'joint-x')) where i.tenant_id is null;
update public.purchase_orders p set tenant_id = coalesce((select tenant_id from public.suppliers where id = p.supplier_id), (select tenant_id from public.projects where id = p.project_id), (select tenant_id from public.orders where id = p.linked_order_id), (select id from public.tenants where slug = 'joint-x')) where p.tenant_id is null;
