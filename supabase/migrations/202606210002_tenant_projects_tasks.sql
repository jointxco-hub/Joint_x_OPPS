-- Phase 2B: tenant scope projects and operational tasks.

create or replace function public.assign_work_item_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
declare project_tenant uuid; order_tenant uuid; client_tenant uuid; resolved_tenant uuid;
begin
  if tg_table_name = 'projects' then
    if new.client_id is not null then select tenant_id into client_tenant from public.clients where id = new.client_id; end if;
    resolved_tenant := client_tenant;
  elsif tg_table_name = 'tasks' then
    if new.project_id is not null then select tenant_id into project_tenant from public.projects where id = new.project_id; end if;
    if new.linked_order_id is not null then select tenant_id into order_tenant from public.orders where id = new.linked_order_id; end if;
    if new.client_id is not null then select tenant_id into client_tenant from public.clients where id = new.client_id; end if;
    resolved_tenant := coalesce(project_tenant, order_tenant, client_tenant);
  else
    if new.project_id is not null then select tenant_id into project_tenant from public.projects where id = new.project_id; end if;
    if new.order_id is not null then select tenant_id into order_tenant from public.orders where id = new.order_id; end if;
    if new.client_id is not null then select tenant_id into client_tenant from public.clients where id = new.client_id; end if;
    resolved_tenant := coalesce(project_tenant, order_tenant, client_tenant);
  end if;
  if (project_tenant is not null and resolved_tenant <> project_tenant) or (order_tenant is not null and resolved_tenant <> order_tenant) or (client_tenant is not null and resolved_tenant <> client_tenant) then raise exception 'Project, order, and client links must belong to one tenant.'; end if;
  if new.tenant_id is not null and resolved_tenant is not null and new.tenant_id <> resolved_tenant then raise exception 'Work item tenant must match its linked record.'; end if;
  if resolved_tenant is not null then new.tenant_id := resolved_tenant; end if;
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['projects','tasks','ops_tasks'] loop
    execute format('alter table public.%I add column if not exists tenant_id uuid references public.tenants(id) on delete restrict', table_name);
    execute format('create index if not exists %I on public.%I (tenant_id)', 'idx_' || table_name || '_tenant_id', table_name);
    execute format('drop trigger if exists trg_%I_tenant on public.%I', table_name, table_name);
    execute format('create trigger trg_%I_tenant before insert or update on public.%I for each row execute function public.assign_work_item_tenant()', table_name, table_name);
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', 'tenant_manage_' || table_name, table_name);
    execute format('create policy %I on public.%I for all to authenticated using (public.can_access_tenant(tenant_id)) with check (public.can_access_tenant(tenant_id))', 'tenant_manage_' || table_name, table_name);
  end loop;
end$$;

update public.projects p set tenant_id = c.tenant_id from public.clients c where p.client_id = c.id and p.tenant_id is null;
update public.tasks t set tenant_id = coalesce((select tenant_id from public.projects where id = t.project_id), (select tenant_id from public.orders where id = t.linked_order_id), (select tenant_id from public.clients where id = t.client_id), (select id from public.tenants where slug = 'joint-x')) where t.tenant_id is null;
update public.ops_tasks t set tenant_id = coalesce((select tenant_id from public.projects where id = t.project_id), (select tenant_id from public.orders where id = t.order_id), (select tenant_id from public.clients where id = t.client_id), (select id from public.tenants where slug = 'joint-x')) where t.tenant_id is null;
update public.projects set tenant_id = (select id from public.tenants where slug = 'joint-x') where tenant_id is null;
