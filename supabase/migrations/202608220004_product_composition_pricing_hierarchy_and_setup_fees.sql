-- Product Composition — pricing hierarchy + setup fees.
--
-- Adds the third pricing tier (order-specific override, already
-- structurally supported by order_line_component_snapshots.sell_price -
-- this migration adds the first tier, a staff-editable master default)
-- and once-off setup fee support. Purely additive: no existing table is
-- rewritten, no historical row's monetary value changes.
--
-- Verified live before writing this migration: product_components,
-- order_line_component_snapshots, order_line_production_tracking, and
-- orders.production_method all share the IDENTICAL 10-value CHECK
-- vocabulary (dtf, vinyl, screen, embroidery, pressing, tailoring,
-- cropping, labeling, mixed, custom) - sublimation is missing from all
-- four, extended consistently below to avoid the exact kind of drift
-- already caught once earlier in this project.

-- ---------------------------------------------------------------------
-- 1. production_method vocabulary - add 'sublimation' everywhere it's
--    already used, so the four tables never diverge.
-- ---------------------------------------------------------------------
alter table public.product_components drop constraint product_components_production_method_check;
alter table public.product_components add constraint product_components_production_method_check
  check (production_method in ('dtf', 'vinyl', 'screen', 'embroidery', 'pressing', 'tailoring', 'cropping', 'labeling', 'sublimation', 'mixed', 'custom'));

alter table public.order_line_component_snapshots drop constraint order_line_component_snapshots_production_method_check;
alter table public.order_line_component_snapshots add constraint order_line_component_snapshots_production_method_check
  check (production_method in ('dtf', 'vinyl', 'screen', 'embroidery', 'pressing', 'tailoring', 'cropping', 'labeling', 'sublimation', 'mixed', 'custom'));

alter table public.order_line_production_tracking drop constraint order_line_production_tracking_production_method_check;
alter table public.order_line_production_tracking add constraint order_line_production_tracking_production_method_check
  check (production_method in ('dtf', 'vinyl', 'screen', 'embroidery', 'pressing', 'tailoring', 'cropping', 'labeling', 'sublimation', 'mixed', 'custom'));

alter table public.orders drop constraint orders_production_method_check;
alter table public.orders add constraint orders_production_method_check
  check (production_method is null or production_method in ('dtf', 'vinyl', 'screen', 'embroidery', 'pressing', 'tailoring', 'cropping', 'labeling', 'sublimation', 'mixed', 'custom'));

-- ---------------------------------------------------------------------
-- 2. component_type vocabulary - add 'setup_fee' as a clearly modeled
--    type (not overloaded onto 'other'/'labour'), on both the master
--    and the snapshot table (a snapshot must be able to freeze whatever
--    component_type its source component had).
-- ---------------------------------------------------------------------
alter table public.product_components drop constraint product_components_component_type_check;
alter table public.product_components add constraint product_components_component_type_check
  check (component_type in ('blank_garment', 'print_service', 'material', 'packaging', 'labour', 'setup_fee', 'other'));

alter table public.order_line_component_snapshots drop constraint order_line_component_snapshots_component_type_check;
alter table public.order_line_component_snapshots add constraint order_line_component_snapshots_component_type_check
  check (component_type in ('blank_garment', 'print_service', 'material', 'packaging', 'labour', 'setup_fee', 'other'));

-- ---------------------------------------------------------------------
-- 3. billing_mode - once-off vs per-garment. Additive with a DEFAULT,
--    so every existing product_components/order_line_component_snapshots
--    row becomes 'per_unit' with zero change to its own monetary values
--    or to how it's already been priced/frozen.
-- ---------------------------------------------------------------------
alter table public.product_components
  add column if not exists billing_mode text not null default 'per_unit' check (billing_mode in ('per_unit', 'once_per_order'));

alter table public.order_line_component_snapshots
  add column if not exists billing_mode text not null default 'per_unit' check (billing_mode in ('per_unit', 'once_per_order'));

-- Deliberately NOT forcing setup_fee rows to once_per_order at the
-- database level - staff may have a legitimate per-unit setup case
-- later. The UI/default strongly prefers once_per_order for setup_fee
-- components; this is a UI convention, not a hard constraint.

-- ---------------------------------------------------------------------
-- 4. production_pricing_defaults - the master/default pricing tier.
--    Staff-editable configuration, never customer-facing, never
--    supplier cost/margin. One active row per (tenant, production_method).
-- ---------------------------------------------------------------------
create table if not exists public.production_pricing_defaults (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  production_method text not null
    check (production_method in ('dtf', 'vinyl', 'screen', 'embroidery', 'pressing', 'tailoring', 'cropping', 'labeling', 'sublimation', 'mixed', 'custom')),
  default_sell_price numeric check (default_sell_price is null or default_sell_price >= 0),
  default_setup_fee numeric check (default_setup_fee is null or default_setup_fee >= 0),
  is_active boolean not null default true,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Partial unique index (not a plain UNIQUE constraint - matches the same
-- "one active row, historical rows can coexist" pattern already used
-- for inventory_variant_reservations): superseding a default later
-- means deactivating the old row, never deleting or overwriting it.
create unique index if not exists production_pricing_defaults_active_uidx
  on public.production_pricing_defaults (tenant_id, production_method)
  where is_active;

create index if not exists production_pricing_defaults_tenant_id_idx
  on public.production_pricing_defaults (tenant_id);

alter table public.production_pricing_defaults enable row level security;

create policy production_pricing_defaults_tenant_read
  on public.production_pricing_defaults for select
  using (public.can_access_tenant(tenant_id));

create policy production_pricing_defaults_reviewer_insert
  on public.production_pricing_defaults for insert
  with check (public.inventory_can_review_tenant(tenant_id));

create policy production_pricing_defaults_reviewer_update
  on public.production_pricing_defaults for update
  using (public.inventory_can_review_tenant(tenant_id))
  with check (public.inventory_can_review_tenant(tenant_id));

create policy xos1_require_opps_staff
  on public.production_pricing_defaults for all
  using (public.is_opps_staff())
  with check (public.is_opps_staff());

revoke all on public.production_pricing_defaults from public, anon;
-- No DELETE grant - superseding a default is an is_active=false update,
-- matching the product_components soft-delete convention, never a
-- physical row removal.
grant select, insert, update on public.production_pricing_defaults to authenticated;

-- ---------------------------------------------------------------------
-- 5. Seed - ONLY the three explicitly approved setup-fee defaults, for
--    the Joint X tenant. No normal per-unit sell prices are seeded here
--    (default_sell_price left null for all three) - none were approved,
--    and guessing production pricing is exactly what this migration's
--    own review process exists to prevent.
-- ---------------------------------------------------------------------
insert into public.production_pricing_defaults (tenant_id, production_method, default_sell_price, default_setup_fee)
values
  ('6d371f51-274c-4b49-8d59-2aeaf5e89088', 'dtf', null, 149),
  ('6d371f51-274c-4b49-8d59-2aeaf5e89088', 'vinyl', null, 149),
  ('6d371f51-274c-4b49-8d59-2aeaf5e89088', 'embroidery', null, 350)
on conflict (tenant_id, production_method) where is_active do nothing;
