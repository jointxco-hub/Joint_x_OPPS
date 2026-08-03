-- One or more uploaded photos per public.inventory row. Additive only —
-- does not touch public.inventory or current_stock.
--
-- Photos are operational data (like the item's own name/sku/location), not
-- identity administration, so any authenticated tenant member can add/
-- remove them — same permission level as editing the inventory row itself
-- (tenant_manage_inventory), not the reviewer-gated Phase 1 identity tables.
--
-- Stored as a private-upload:// reference into the existing tenant-scoped
-- "uploads" storage bucket (supabase/migrations/202606270001_private_uploads_signed_urls.sql),
-- resolved to a signed URL at render time. No new storage bucket needed.

create table public.inventory_images (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  inventory_id  uuid not null references public.inventory(id) on delete cascade,
  image_ref     text not null,
  sort_order    integer not null default 0,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint inventory_images_ref_not_blank check (btrim(image_ref) <> '')
);

create index idx_inventory_images_inventory_id on public.inventory_images (inventory_id, sort_order);
create index idx_inventory_images_tenant_id on public.inventory_images (tenant_id);

alter table public.inventory_images enable row level security;

create policy tenant_manage_inventory_images on public.inventory_images
  for all to authenticated
  using (public.can_access_tenant(tenant_id))
  with check (public.can_access_tenant(tenant_id));
