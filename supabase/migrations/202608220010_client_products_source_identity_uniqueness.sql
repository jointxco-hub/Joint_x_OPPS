-- Closes a gap surfaced while auditing PR #29's inventory_item_id
-- addition (202608220009): there was no existing uniqueness rule to
-- "mirror" for (client_id, opps_product_id) at all - client_products had
-- only its primary key and plain (non-unique) indexes on client_id/
-- tenant_id. "No duplicate client_product per client+catalog-item" was
-- only ever an informal property of ProductsEditor.jsx's find-or-create
-- logic (clientProductByCatalogItemId.get(...) then create if missing),
-- which has a narrow but real race window - two concurrent creates for
-- the same client+catalog pairing could both pass the "not found" check
-- before either insert lands.
--
-- Rather than adding asymmetric protection only for the new
-- inventory_item_id column (which would itself be "a different identity
-- model" - protecting inventory-backed client products but not
-- catalog-backed ones), this adds the same partial-unique-index
-- protection to both, so the two identity types are genuinely mirrored,
-- not just conceptually similar.
--
-- Verified read-only against production before writing this migration:
-- zero existing (client_id, opps_product_id) duplicate pairs today, so
-- no cleanup step is required before either index can be created.
-- inventory_item_id is a brand-new column (this same PR, 202608220009)
-- with no rows in production yet at all, so it trivially has zero
-- duplicates too.
create unique index if not exists client_products_client_catalog_uidx
  on public.client_products (client_id, opps_product_id)
  where opps_product_id is not null;

create unique index if not exists client_products_client_inventory_uidx
  on public.client_products (client_id, inventory_item_id)
  where inventory_item_id is not null;
