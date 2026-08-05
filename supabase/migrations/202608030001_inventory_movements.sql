-- Stock movement ledger for public.inventory.
-- Additive only: one nullable column on the existing inventory table, one new
-- append-only audit table. Does not touch current_stock semantics or any
-- other table. public.inventory.current_stock remains the authoritative
-- stock balance; this table only records the history of how it changed.

-- The application form (src/pages/Inventory.jsx ItemFormModal) has always
-- submitted a `location` field on every inventory create/update, but no such
-- column has ever existed on public.inventory. Adding it here both enables
-- the stock-count workflow and fixes that existing silent save failure.
alter table public.inventory
  add column if not exists location text;

create table if not exists public.inventory_movements (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  inventory_id                uuid not null references public.inventory(id) on delete cascade,
  movement_type               text not null check (movement_type in (
                                 'count', 'manual_adjust', 'receive',
                                 'order_pick', 'return', 'damage', 'transfer'
                               )),
  quantity_before              numeric(12, 3) not null,
  quantity_after               numeric(12, 3) not null,
  quantity_delta               numeric(12, 3) not null,
  location                    text,
  reason                      text,
  related_order_id            uuid references public.orders(id) on delete set null,
  related_purchase_order_id   uuid references public.purchase_orders(id) on delete set null,
  created_by                  uuid references auth.users(id) on delete set null,
  created_by_name             text,
  created_at                  timestamptz not null default now()
);

create index if not exists idx_inventory_movements_inventory_id on public.inventory_movements (inventory_id);
create index if not exists idx_inventory_movements_tenant_id    on public.inventory_movements (tenant_id);
create index if not exists idx_inventory_movements_created_at   on public.inventory_movements (created_at desc);

alter table public.inventory_movements enable row level security;

-- Read: any authenticated member of the tenant can see the tenant's history.
drop policy if exists tenant_read_inventory_movements on public.inventory_movements;
create policy tenant_read_inventory_movements on public.inventory_movements
  for select to authenticated
  using (public.can_access_tenant(tenant_id));

-- Insert: any authenticated member of the tenant can record a movement for
-- their own tenant. There is deliberately no update or delete policy —
-- this table is an append-only audit log.
drop policy if exists tenant_insert_inventory_movements on public.inventory_movements;
create policy tenant_insert_inventory_movements on public.inventory_movements
  for insert to authenticated
  with check (public.can_access_tenant(tenant_id));

comment on table public.inventory_movements is
  'Append-only audit log of stock changes: what changed, who changed it, when, why, and any related order/PO. No update or delete policy by design.';
