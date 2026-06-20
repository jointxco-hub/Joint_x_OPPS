-- Phase 2A: tenant ownership and parent-order guards for operational records.

create or replace function public.assign_order_support_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
declare parent_tenant_id uuid;
begin
  select tenant_id into parent_tenant_id from public.orders where id = new.order_id;
  if parent_tenant_id is null then raise exception 'Order support records require a tenant-owned order.'; end if;
  if new.tenant_id is not null and new.tenant_id <> parent_tenant_id then raise exception 'Order support tenant must match its order.'; end if;
  new.tenant_id := parent_tenant_id;
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['order_tags','order_exceptions','order_stage_history','order_production_readiness_checks'] loop
    execute format('alter table public.%I add column if not exists tenant_id uuid references public.tenants(id) on delete restrict', table_name);
    execute format('update public.%I child set tenant_id = parent.tenant_id from public.orders parent where child.order_id = parent.id and child.tenant_id is null', table_name);
    execute format('create index if not exists %I on public.%I (tenant_id, order_id)', 'idx_' || table_name || '_tenant_order', table_name);
    execute format('drop trigger if exists trg_%I_tenant on public.%I', table_name, table_name);
    execute format('create trigger trg_%I_tenant before insert or update of order_id, tenant_id on public.%I for each row execute function public.assign_order_support_tenant()', table_name, table_name);
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', 'tenant_manage_' || table_name, table_name);
    execute format('create policy %I on public.%I for all to authenticated using (public.can_access_tenant(tenant_id)) with check (public.can_access_tenant(tenant_id))', 'tenant_manage_' || table_name, table_name);
  end loop;
end$$;

drop policy if exists "Internal users can read production readiness checks" on public.order_production_readiness_checks;
drop policy if exists "Internal users can manage production readiness checks" on public.order_production_readiness_checks;

create or replace function public.assign_transaction_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
declare parent_tenant_id uuid;
begin
  if new.order_id is not null then select tenant_id into parent_tenant_id from public.orders where id = new.order_id;
  elsif new.client_id is not null then select tenant_id into parent_tenant_id from public.clients where id = new.client_id;
  end if;
  if parent_tenant_id is not null then
    if new.tenant_id is not null and new.tenant_id <> parent_tenant_id then raise exception 'Transaction tenant must match its linked order or client.'; end if;
    new.tenant_id := parent_tenant_id;
  end if;
  return new;
end;
$$;

update public.transactions transaction
set tenant_id = coalesce(
  (select tenant_id from public.orders where id = transaction.order_id),
  (select tenant_id from public.clients where id = transaction.client_id),
  transaction.tenant_id
)
where transaction.tenant_id is null;

create index if not exists idx_transactions_tenant_id on public.transactions(tenant_id);
drop trigger if exists trg_transactions_tenant on public.transactions;
create trigger trg_transactions_tenant before insert or update of order_id, client_id, tenant_id on public.transactions for each row execute function public.assign_transaction_tenant();
alter table public.transactions enable row level security;
drop policy if exists tenant_manage_transactions on public.transactions;
create policy tenant_manage_transactions on public.transactions for all to authenticated using (public.can_access_tenant(tenant_id)) with check (public.can_access_tenant(tenant_id));
