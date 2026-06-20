-- Phase 2C: tenant ownership for OPPS folder and asset metadata.

create or replace function public.assign_file_metadata_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
declare folder_tenant uuid; project_tenant uuid; order_tenant uuid; client_tenant uuid; resolved_tenant uuid;
begin
  if tg_table_name = 'folders' and (to_jsonb(new)->>'parent_id') is not null then select tenant_id into folder_tenant from public.folders where id = (to_jsonb(new)->>'parent_id')::uuid;
  elsif tg_table_name = 'client_assets' and (to_jsonb(new)->>'folder_id') is not null then select tenant_id into folder_tenant from public.folders where id = (to_jsonb(new)->>'folder_id')::uuid;
  end if;
  if new.project_id is not null then select tenant_id into project_tenant from public.projects where id = new.project_id; end if;
  if new.order_id is not null then select tenant_id into order_tenant from public.orders where id = new.order_id; end if;
  if new.client_id is not null then select tenant_id into client_tenant from public.clients where id = new.client_id; end if;
  resolved_tenant := coalesce(folder_tenant, project_tenant, order_tenant, client_tenant);
  if (folder_tenant is not null and resolved_tenant <> folder_tenant) or (project_tenant is not null and resolved_tenant <> project_tenant) or (order_tenant is not null and resolved_tenant <> order_tenant) or (client_tenant is not null and resolved_tenant <> client_tenant) then raise exception 'Folder and asset links must belong to one tenant.'; end if;
  if new.tenant_id is not null and resolved_tenant is not null and new.tenant_id <> resolved_tenant then raise exception 'File metadata tenant must match its linked record.'; end if;
  if resolved_tenant is not null then new.tenant_id := resolved_tenant; end if;
  return new;
end;
$$;

do $$ declare table_name text; begin
  foreach table_name in array array['folders','client_assets'] loop
    execute format('alter table public.%I add column if not exists tenant_id uuid references public.tenants(id) on delete restrict', table_name);
    execute format('create index if not exists %I on public.%I (tenant_id)', 'idx_' || table_name || '_tenant_id', table_name);
    execute format('drop trigger if exists trg_%I_tenant on public.%I', table_name, table_name);
    execute format('create trigger trg_%I_tenant before insert or update on public.%I for each row execute function public.assign_file_metadata_tenant()', table_name, table_name);
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', 'tenant_manage_' || table_name, table_name);
    execute format('create policy %I on public.%I for all to authenticated using (public.can_access_tenant(tenant_id)) with check (public.can_access_tenant(tenant_id))', 'tenant_manage_' || table_name, table_name);
  end loop;
end$$;

update public.folders f set tenant_id = coalesce((select tenant_id from public.folders where id = f.parent_id), (select tenant_id from public.projects where id = f.project_id), (select tenant_id from public.orders where id = f.order_id), (select tenant_id from public.clients where id = f.client_id), (select id from public.tenants where slug = 'joint-x')) where f.tenant_id is null;
update public.client_assets a set tenant_id = coalesce((select tenant_id from public.folders where id = a.folder_id), (select tenant_id from public.projects where id = a.project_id), (select tenant_id from public.orders where id = a.order_id), (select tenant_id from public.clients where id = a.client_id), (select id from public.tenants where slug = 'joint-x')) where a.tenant_id is null;
