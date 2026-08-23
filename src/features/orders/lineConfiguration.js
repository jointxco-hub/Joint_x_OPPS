// Configure Product / thumbnail resolution - pure logic only (no
// React/Supabase imports here so this stays node --test-able in
// isolation). Backs the "Added from invoice / Production setup
// required" banner in ProductsEditor.jsx and the order-line thumbnail
// precedence used by both the flat row render and (later) the
// Configure Product dialog.

// A line has a stable-enough identity to compose Product Composition
// against when it carries any ONE of: a catalog product
// (catalog_item_id), a normalized/stock inventory product
// (inventory_item_id - audited against ProductsEditor.jsx's "Add
// Product" picker and the `inventory` table: a flat stock row, source:
// "stock" in the combined picker, distinct from the `products` catalog
// table catalog_item_id references), or a direct client_product link
// (client_product_id - set when "Create client product" has no catalog/
// inventory item to attach to, e.g. a fully custom line). Shared by
// needsConfiguration and isProductionCapableLine below so the two can
// never drift apart the way the original catalog-only check did (a line
// matched to a stock item via Configure Product kept showing "Production
// setup required" forever, since the original needsConfiguration never
// checked inventory_item_id).
function hasProductionIdentity(product) {
  return Boolean(product?.catalog_item_id || product?.inventory_item_id || product?.client_product_id);
}

// True when an invoice-synced order line has never been given a
// production identity of any kind. `added_from_invoice` is permanent
// provenance metadata - it is set once by the invoice sync and must
// NEVER be cleared/overwritten by anything in this module or its
// callers - so this function is the ONLY thing that decides whether
// the warning banner is still shown. Once the line has any production
// identity or is explicitly marked commercial_only_confirmed, this
// flips to false and the banner stops appearing, even though
// added_from_invoice itself is still true.
export function needsConfiguration(product) {
  if (!product || product.added_from_invoice !== true) return false;
  if (hasProductionIdentity(product)) return false;
  if (product.commercial_only_confirmed) return false;
  return true;
}

// The single gate for whether a line can show the Production panel,
// "+ Add print option", artwork, thumbnail, and related-file controls -
// replaces the earlier `p.catalog_item_id && p.line_id` check, which
// incorrectly hid all of this from stock/inventory-sourced lines (never
// fabricated a catalog_item_id, so they had nowhere to attach) and from
// lines pointed directly at a standalone client_product with no catalog/
// inventory parent at all. line_id is always required, independent of
// which identity the line carries, since snapshots/tracking/artwork are
// all keyed by it.
export function isProductionCapableLine(line) {
  if (!line?.line_id) return false;
  return hasProductionIdentity(line);
}

// Mirrors the exact catalog-vs-inventory id convention already used by
// the "Add Product" picker in ProductsEditor.jsx (see the onMouseDown
// handler in the add-row picker list): source === "catalog" sets
// catalog_item_id, source === "stock" sets inventory_item_id. Only the
// side matching pickedItem.source is ever set; the other identity
// field is left as whatever the line already had.
//
// Never touches price. Never overwrites an existing non-empty
// image_url - only backfills when the line has no image yet, so an
// explicit staff-set or invoice-preserved image_url always wins over
// a catalog backfill.
export function applyMatchExistingProduct(product, pickedItem) {
  const base = product || {};
  const picked = pickedItem || {};
  return {
    ...base,
    catalog_item_id: picked.source === "catalog" ? picked.id : (base.catalog_item_id || ""),
    inventory_item_id: picked.source === "stock" ? picked.id : (base.inventory_item_id || ""),
    image_url: base.image_url || picked.image_url || "",
  };
}

// Silences the "needs configuration" banner for lines that are
// genuinely commercial-only (fees/services with no garment/print
// composition to map against - e.g. "X1 - Satin Labels"). Changes
// nothing else on the line.
export function applyKeepCommercialOnly(product) {
  return { ...(product || {}), commercial_only_confirmed: true };
}

// Resolves the thumbnail to show for an order line. Precedence, first
// non-empty wins:
//   1. product.image_url
//   2. clientProduct?.primary_mockup_url
//   3. catalogItem?.image_url
//   4. '' (caller renders the placeholder icon)
//
// This collapses the fuller 5-tier precedence described in the spec
// (explicit staff-set / invoice-preserved / catalog-backfilled are all
// "product.image_url is set") into one tier, because those three cases
// are indistinguishable once stored in image_url AND don't need to be
// distinguished here - they're already correctly ordered by *when*
// each writer is allowed to touch the field: invoice sync only ever
// writes image_url when it was previously empty (metadata.image_url ||
// ""), applyMatchExistingProduct above only backfills when empty, and
// the explicit "Change thumbnail" action is the one and only path
// allowed to overwrite a non-empty image_url. So by the time this
// resolver runs, "image_url is set" already means "the most authoritative
// source available chose to set it" - this function just has to prefer
// it over the two fallback tiers.
export function resolveLineThumbnail(product, { clientProduct, catalogItem } = {}) {
  if (product?.image_url) return product.image_url;
  if (clientProduct?.primary_mockup_url) return clientProduct.primary_mockup_url;
  if (catalogItem?.image_url) return catalogItem.image_url;
  return "";
}
