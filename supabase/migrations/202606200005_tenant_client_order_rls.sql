-- Client and order access is restricted to the active tenant.
-- Public tracking is served only by get_public_order_tracking().

alter table public.clients enable row level security;
alter table public.orders enable row level security;

drop policy if exists tenant_manage_clients on public.clients;
create policy tenant_manage_clients on public.clients
  for all to authenticated
  using (public.can_access_tenant(tenant_id))
  with check (public.can_access_tenant(tenant_id));

drop policy if exists tenant_manage_orders on public.orders;
create policy tenant_manage_orders on public.orders
  for all to authenticated
  using (public.can_access_tenant(tenant_id))
  with check (public.can_access_tenant(tenant_id));
