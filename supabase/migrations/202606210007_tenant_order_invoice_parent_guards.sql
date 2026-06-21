-- QA-found tenant-link guard: parent references must match the row tenant.

create or replace function public.assert_order_tenant_links()
returns trigger language plpgsql security definer set search_path = public as $$
declare client_tenant uuid;
begin
  if new.client_id is not null then
    select tenant_id into client_tenant from public.clients where id = new.client_id;
    if client_tenant is null or client_tenant <> new.tenant_id then
      raise exception 'Order client must belong to the same tenant.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_tenant_links on public.orders;
create trigger trg_orders_tenant_links
  before insert or update of tenant_id, client_id on public.orders
  for each row execute function public.assert_order_tenant_links();

create or replace function public.assert_invoice_tenant_links()
returns trigger language plpgsql security definer set search_path = public as $$
declare client_tenant uuid; order_tenant uuid;
begin
  if new.customer_id is not null then select tenant_id into client_tenant from public.clients where id = new.customer_id; end if;
  if new.source_order_id is not null then select tenant_id into order_tenant from public.orders where id = new.source_order_id; end if;
  if (client_tenant is not null and client_tenant <> new.tenant_id) or (order_tenant is not null and order_tenant <> new.tenant_id) then
    raise exception 'Invoice client and source order must belong to the same tenant.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_opps_invoices_tenant_links on public.opps_invoices;
create trigger trg_opps_invoices_tenant_links
  before insert or update of tenant_id, customer_id, source_order_id on public.opps_invoices
  for each row execute function public.assert_invoice_tenant_links();
