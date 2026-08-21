-- Product Composition & Production Components — Phase 1 (schema-corrected).
--
-- Supersedes the first draft of this migration (never applied to
-- production). That draft parented composition to public.products (the
-- global Shop Catalog) and had no price, no structured placement/method,
-- no artwork linkage, and no order-time snapshot. Architecture review
-- found the real, richer parent for a client-facing composed product
-- already lives at public.client_products (client-specific naming/price,
-- primary_mockup_asset_id, client_product_artwork revisions,
-- status/approval lifecycle, and — via client_product_order_links — a
-- proven order-time snapshot pattern). This revision reparents
-- composition to client_products and reuses that existing snapshot
-- pattern instead of inventing a second one.
--
-- Three tables:
--
--   product_components — what a client_products row is actually made of
--   (blank garment + print/material/packaging/labour lines), each with
--   its own structured method/placement/price. Still references
--   inventory_products (internal identity, not yet a variant) for stock
--   components, per Inventory Phase 1's "demand is internal, allocation
--   is exact" principle - plus an optional fixed_inventory_variant_id for
--   components that are intrinsically one variant (e.g. a fixed-size
--   packaging insert). client_products.opps_product_id already bridges
--   to the global catalog product when a client product is based on one;
--   product_components does not duplicate that link.
--
--   order_line_component_snapshots — immutable, insert-only copy of the
--   components attached to an order line at the moment production
--   tracking begins on it. One row per component per line (a line can
--   snapshot a blank + front DTF + back DTF as three separate rows).
--   Mirrors the design already proven by
--   client_product_order_links.production_snapshot/quantity_snapshot/
--   client_price_snapshot/artwork_revision_ids - no UPDATE or DELETE
--   grant exists on this table, so nothing can silently rewrite history
--   once a snapshot is taken; the master product_components row can keep
--   changing without ever touching rows already snapshotted.
--
--   order_line_production_tracking — current-state production method/
--   stage/allocation, now anchored to the immutable snapshot rather than
--   the live line/product, so production always operates against the
--   exact frozen component that was ordered. Stage/method change history
--   is not re-implemented here; it reuses the existing
--   public.opps_activity_events table (entity_type =
--   'order_line_production_tracking'), the same append-only mechanism
--   OrderDrawer.jsx already writes to for order-level corrections.
--
-- Deliberately still NOT included: actual stock reservation/consumption
-- (needs Inventory Phase 1's later allocation/movement work as its own
-- approval step - the exact inventory_variant_id needed to enable it is
-- captured here, but nothing writes to inventory_movements yet), invoice
-- parent/sub-item rendering, and any X LAB-side change.

create table if not exists public.product_components (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  -- The real client-facing finished product this component belongs to.
  -- NOT public.products (global catalog) - client_products already owns
  -- client-specific naming/pricing/mockup/artwork/approval, and bridges
  -- to a global catalog product itself via opps_product_id when relevant.
  client_product_id uuid not null references public.client_products(id) on delete cascade,
  component_type text not null
    check (component_type in ('blank_garment', 'print_service', 'material', 'packaging', 'labour', 'other')),
  -- Structured fields (not free text) so "Front DTF" vs "Back DTF" is
  -- machine-distinguishable, not just two rows that happen to have
  -- different labels.
  production_method text
    check (production_method in ('dtf', 'vinyl', 'screen', 'embroidery', 'pressing', 'tailoring', 'cropping', 'labeling', 'mixed', 'custom')),
  placement text,
  production_colour text,
  specification text,
  production_instructions text,
  -- Client-facing sell price for this component. Internal inventory/
  -- supplier cost (inventory_supplier_variants.unit_cost) stays entirely
  -- separate - this column never touches it, and nothing here reads it.
  default_sell_price numeric check (default_sell_price is null or default_sell_price >= 0),
  quantity_per_unit numeric not null default 1 check (quantity_per_unit > 0),
  sort_order integer not null default 0,
  -- Internal identity only (not a specific variant) for the common case
  -- where size/colour is resolved per order. Null for non-stock
  -- components (print_service/labour/other).
  inventory_product_id uuid references public.inventory_products(id) on delete set null,
  -- Set only when this component is intrinsically fixed to one variant
  -- (e.g. a packaging insert that only ever comes in one size) rather
  -- than resolved per order.
  fixed_inventory_variant_id uuid references public.inventory_variants(id) on delete set null,
  label text,
  notes text,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Artwork linkage is deliberately NOT a column here. A component's
-- production artwork resolves by joining public.client_product_artwork
-- on (client_product_id, placement) where is_current = true and
-- status = 'approved' - the same revision-tracked table My Products and
-- the client approval flow already use. Storing a direct artwork_id here
-- would create a second pointer that could drift from "current" whenever
-- a new revision is approved; reusing the existing (client_product_id,
-- placement) join keeps one source of truth for "what's approved now".

create index if not exists product_components_client_product_id_idx on public.product_components (client_product_id);
create index if not exists product_components_tenant_id_idx on public.product_components (tenant_id);
create index if not exists product_components_inventory_product_id_idx on public.product_components (inventory_product_id) where inventory_product_id is not null;

alter table public.product_components enable row level security;

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

create table if not exists public.order_line_component_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete cascade,
  -- Matches orders.products[].line_id - no DB FK since the line lives in
  -- a jsonb array, not its own table.
  line_id text not null,
  -- Nullable on both: the snapshot is the historical truth and must
  -- survive even if the client product or the source component row is
  -- later deleted.
  client_product_id uuid references public.client_products(id) on delete set null,
  source_product_component_id uuid references public.product_components(id) on delete set null,
  component_type text not null
    check (component_type in ('blank_garment', 'print_service', 'material', 'packaging', 'labour', 'other')),
  label text,
  production_method text
    check (production_method in ('dtf', 'vinyl', 'screen', 'embroidery', 'pressing', 'tailoring', 'cropping', 'labeling', 'mixed', 'custom')),
  placement text,
  production_colour text,
  specification text,
  production_instructions text,
  -- The price actually charged for this component on this order - copied
  -- from product_components.default_sell_price at snapshot time, or
  -- overridden explicitly for this order only. Either way, editing the
  -- master component afterwards can never change what this order shows.
  sell_price numeric check (sell_price is null or sell_price >= 0),
  quantity_per_unit numeric not null default 1 check (quantity_per_unit > 0),
  sort_order integer not null default 0,
  inventory_product_id uuid references public.inventory_products(id) on delete set null,
  -- The exact size/colour resolved for this order line at snapshot time.
  resolved_inventory_variant_id uuid references public.inventory_variants(id) on delete set null,
  -- client_product_artwork.id values approved for this component at
  -- snapshot time - array, mirrors client_product_order_links.artwork_revision_ids
  -- exactly (that table also carries no FK-on-array constraint).
  artwork_revision_ids uuid[] not null default '{}',
  notes text,
  created_by uuid,
  snapshot_taken_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- One line can snapshot several components (blank + front DTF + back
  -- DTF); uniqueness is per component within a line, not per line.
  unique (order_id, line_id, source_product_component_id)
);

create index if not exists order_line_component_snapshots_order_id_idx on public.order_line_component_snapshots (order_id);
create index if not exists order_line_component_snapshots_tenant_id_idx on public.order_line_component_snapshots (tenant_id);
create index if not exists order_line_component_snapshots_client_product_id_idx on public.order_line_component_snapshots (client_product_id) where client_product_id is not null;

alter table public.order_line_component_snapshots enable row level security;

create policy order_line_component_snapshots_tenant_read
  on public.order_line_component_snapshots for select
  using (public.can_access_tenant(tenant_id));

create policy order_line_component_snapshots_tenant_insert
  on public.order_line_component_snapshots for insert
  with check (public.is_app_admin() or public.can_access_tenant(tenant_id));

create policy xos1_require_opps_staff
  on public.order_line_component_snapshots for all
  using (public.is_opps_staff())
  with check (public.is_opps_staff());

revoke all on public.order_line_component_snapshots from public, anon;
-- Insert + select only. No update, no delete grant - immutability is
-- enforced at the grant level, not just by convention, so "never
-- silently alter an existing order snapshot" cannot be bypassed by a
-- future edit screen that forgets to check for it.
grant select, insert on public.order_line_component_snapshots to authenticated;

create table if not exists public.order_line_production_tracking (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete cascade,
  line_id text not null,
  -- Production tracking now operates against the exact frozen component
  -- ordered, not the live line or the live product_components row.
  order_line_component_snapshot_id uuid not null references public.order_line_component_snapshots(id) on delete cascade,
  production_method text
    check (production_method in ('dtf', 'vinyl', 'screen', 'embroidery', 'pressing', 'tailoring', 'cropping', 'labeling', 'mixed', 'custom')),
  production_stage text
    check (production_stage in (
      'waiting_design_assets', 'artwork_check', 'artwork_setup', 'awaiting_client_approval',
      'print_setup', 'queued_pressing', 'pressing', 'queued_embroidery', 'embroidering',
      'queued_tailor', 'at_tailor', 'cropping_alterations', 'finishing', 'quality_check',
      'rework', 'waiting_stock', 'packing', 'custom'
    )),
  -- Downstream fulfillment mapping only - which exact supplier stock was
  -- allocated. Never the source of the internal variant demand itself;
  -- that's order_line_component_snapshots.resolved_inventory_variant_id.
  inventory_supplier_variant_id uuid references public.inventory_supplier_variants(id) on delete set null,
  quantity_allocated numeric check (quantity_allocated is null or quantity_allocated > 0),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Current-state tracking: exactly one row per frozen component.
  -- Stage-change history is not re-implemented here - see
  -- opps_activity_events (entity_type = 'order_line_production_tracking').
  unique (order_line_component_snapshot_id)
);

create index if not exists order_line_production_tracking_order_id_idx on public.order_line_production_tracking (order_id);
create index if not exists order_line_production_tracking_tenant_id_idx on public.order_line_production_tracking (tenant_id);
create index if not exists order_line_production_tracking_snapshot_id_idx on public.order_line_production_tracking (order_line_component_snapshot_id);

alter table public.order_line_production_tracking enable row level security;

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
