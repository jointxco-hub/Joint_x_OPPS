-- Records which exact internal + supplier variant a stock movement was for,
-- snapshotted at the moment of the movement. Without this, knowing what
-- moved requires cross-referencing the row's *current* mapping, which can
-- change (a mapping can be corrected with a new version) — this keeps
-- historical movements accurate even if a later remap happens.
--
-- All four columns are nullable: a movement recorded before the row is
-- mapped correctly has no variant yet, and that must stay honest rather
-- than being backfilled with a guess.

alter table public.inventory_movements
  add column if not exists inventory_product_id uuid references public.inventory_products(id) on delete set null,
  add column if not exists inventory_variant_id uuid references public.inventory_variants(id) on delete set null,
  add column if not exists inventory_supplier_product_id uuid references public.inventory_supplier_products(id) on delete set null,
  add column if not exists inventory_supplier_variant_id uuid references public.inventory_supplier_variants(id) on delete set null;

create index if not exists idx_inventory_movements_variant on public.inventory_movements (inventory_variant_id);
create index if not exists idx_inventory_movements_supplier_variant on public.inventory_movements (inventory_supplier_variant_id);
