-- Closes a gap in PR #29 (Configure Product): a stock/inventory-sourced
-- order line (source: "stock", inventory_item_id set, catalog_item_id
-- deliberately empty - inventory items live in public.inventory, not
-- public.products, so they were never eligible to satisfy
-- client_products.opps_product_id's FK to products(id)) had nowhere to
-- point a client_product at, so Configure Product's "Create client
-- product"/addPrintOptionMutation on-demand-create path could only ever
-- create a client_product with opps_product_id = null for a stock line -
-- discarding its real inventory identity rather than preserving it, and
-- leaving the client_product un-lookup-able by that identity on the next
-- render (client_product_id was never written back for the
-- addPrintOptionMutation auto-create path, only the explicit "Create
-- client product with no catalog picked" path sets it).
--
-- This is the smallest additive fix: a second, equally-nullable, equally
-- optional link column mirroring opps_product_id's role exactly, so a
-- stock-sourced line can get a real client_product keyed by its actual
-- inventory identity instead of either faking a catalog_item_id (never
-- allowed) or silently losing the identity.
alter table public.client_products
  add column if not exists inventory_item_id uuid references public.inventory(id) on delete set null;

create index if not exists idx_client_products_inventory_item_id
  on public.client_products (inventory_item_id)
  where inventory_item_id is not null;

-- A client_product should never claim to be sourced from both a global
-- catalog product and a raw inventory item at once - each row picks at
-- most one "what is this backed by" identity (or neither, for a fully
-- custom item created via "Create client product" with no item linked).
alter table public.client_products
  add constraint client_products_single_source_identity_check
  check (opps_product_id is null or inventory_item_id is null);
