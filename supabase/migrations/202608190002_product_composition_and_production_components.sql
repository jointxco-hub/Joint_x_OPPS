-- Product Composition & Production Components — Phase 1.
--
-- Continues the existing Inventory Phase 1 roadmap (inventory_products /
-- inventory_variants / inventory_supplier_products / inventory_supplier_variants,
-- see docs/inventory/OPPS_INVENTORY_PHASE_1_HANDOVER_BRIEF.md), which
-- explicitly named "connect Shop Catalog products to this identity" and
-- "wire order fulfillment to exact stock" as its next stages. Two
-- additive, empty-by-default tables:
--
--   product_components — what a Shop Catalog product (public.products)
--   is actually made of: a blank garment (an internal inventory
--   identity, not yet a specific variant/supplier — allocation stays
--   exact, demand stays internal, per the existing roadmap's own
--   principle), plus non-stock components (print service, labour,
--   packaging, other materials).
--
--   order_line_production_tracking — per-order-LINE production method/
--   stage/allocation, additive alongside the existing per-ORDER scalar
--   columns (orders.production_method/production_detail_stage), which
--   stay completely untouched. A multi-item order needing different
--   methods per line (the reason "mixed" exists as an order_method
--   value today) can now track each line independently; orders/lines
--   with no tracking row behave exactly as before.
--
-- Deliberately NOT included: actual stock consumption/reservation on
-- production (needs the allocation/movement work the existing roadmap
-- already stages later, as its own approval step) and any X LAB-side
-- change.

create table if not exists public.product_components (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete cascade,
  component_type text not null
    check (component_type in ('blank_garment', 'print_service', 'material', 'packaging', 'labour', 'other')),
  -- Internal identity only (not a specific variant/supplier) - composition
  -- says "needs a JET blank," not "needs the black/medium one." Null for
  -- non-stock components (print_service/labour/other).
  inventory_product_id uuid references public.inventory_products(id) on delete set null,
  quantity_per_unit numeric not null default 1 check (quantity_per_unit > 0),
  label text,
  notes text,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_components_product_id_idx on public.product_components (product_id);
create index if not exists product_components_tenant_id_idx on public.product_components (tenant_id);
create index if not exists product_components_inventory_product_id_idx on public.product_components (inventory_product_id) where inventory_product_id is not null;

alter table public.product_components enable row level security;

-- Mirrors the exact 4-policy pattern already proven on inventory_products/
-- inventory_variants/inventory_supplier_products/inventory_supplier_variants:
-- tenant read, reviewer insert/update (same stricter owner/admin gate
-- already used for inventory identity mapping - defining what a product
-- is made of is the same kind of deliberate, low-frequency action).
create policy product_components_tenant_read
  on public.product_components for select
  using (public.can_access_tenant(tenant_id));

create policy product_components_reviewer_insert
  on public.product_components for insert
  with check (public.inventory_can_review_tenant(tenant_id));

create policy product_components_reviewer_update
  on public.product_components for update
  using (public.inventory_can_review_tenant(tenant_id))
  with check (public.inventory_can_review_tenant(tenant_id));

create policy xos1_require_opps_staff
  on public.product_components for all
  using (public.is_opps_staff())
  with check (public.is_opps_staff());

revoke all on public.product_components from public, anon;
grant select, insert, update on public.product_components to authenticated;

create table if not exists public.order_line_production_tracking (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete cascade,
  -- Matches orders.products[].line_id (a client-generated string on each
  -- line item, see ProductsEditor.jsx's newLineId()) - not a DB FK since
  -- the line lives inside a jsonb array, not its own table.
  line_id text not null,
  production_method text
    check (production_method in ('dtf', 'vinyl', 'screen', 'embroidery', 'pressing', 'tailoring', 'cropping', 'labeling', 'mixed', 'custom')),
  production_stage text
    check (production_stage in (
      'waiting_design_assets', 'artwork_check', 'artwork_setup', 'awaiting_client_approval',
      'print_setup', 'queued_pressing', 'pressing', 'queued_embroidery', 'embroidering',
      'queued_tailor', 'at_tailor', 'cropping_alterations', 'finishing', 'quality_check',
      'rework', 'waiting_stock', 'packing', 'custom'
    )),
  -- Which exact supplier stock was allocated to this line, filled in once
  -- known - stays a separate, later step from composition itself, per
  -- the roadmap's "allocation is exact" principle.
  inventory_supplier_variant_id uuid references public.inventory_supplier_variants(id) on delete set null,
  quantity_allocated numeric check (quantity_allocated is null or quantity_allocated > 0),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, line_id)
);

create index if not exists order_line_production_tracking_order_id_idx on public.order_line_production_tracking (order_id);
create index if not exists order_line_production_tracking_tenant_id_idx on public.order_line_production_tracking (tenant_id);

alter table public.order_line_production_tracking enable row level security;

-- Matches orders' own write gate exactly (tenant_manage_orders: is_app_admin()
-- OR can_access_tenant(tenant_id)) rather than the stricter inventory-
-- reviewer gate - per-line production tracking should be editable by
-- whoever can already edit the order's own production_method today, not
-- gated behind the separate inventory-mapping reviewer role.
create policy order_line_production_tracking_tenant_read
  on public.order_line_production_tracking for select
  using (public.can_access_tenant(tenant_id));

create policy order_line_production_tracking_tenant_manage
  on public.order_line_production_tracking for all
  using (public.is_app_admin() or public.can_access_tenant(tenant_id))
  with check (public.is_app_admin() or public.can_access_tenant(tenant_id));

create policy xos1_require_opps_staff
  on public.order_line_production_tracking for all
  using (public.is_opps_staff())
  with check (public.is_opps_staff());

revoke all on public.order_line_production_tracking from public, anon;
grant select, insert, update, delete on public.order_line_production_tracking to authenticated;
