// Phase 0 - Orders client-product reuse. Pure logic only (no React /
// Supabase imports) so it stays node --test-able in isolation, matching
// the convention of src/features/orders/lineConfiguration.js.
//
// Scope (deliberately narrow):
//   * Project an already-fetched public.client_products row into a
//     selectable "Add product" picker item, plus the order-line patch
//     applied when it is picked.
//   * COMMERCIAL projection only - name, client-facing price, mockup,
//     category, and the identity fields. This never builds the
//     production configuration: garment, print method, placement,
//     artwork, exact supplier variant and per-component pricing all
//     still come from the EXISTING "Attach composition" flow
//     (product_components -> order_line_component_snapshots).
//   * Never invents a price. A missing / requires_quote client_price
//     yields price "" + needsPriceReview true, exactly like the live
//     Quotes picker's resolveLineRate.
//   * Never creates a client_products row and never mutates one.

import {
  isClientProductApproved,
  isClientProductArchived,
} from "@/features/quotes/quoteProductMapping";

// Re-exported so callers get the shared classification from one place.
export { isClientProductApproved, isClientProductArchived };

// The client products offered in the OPPS order-line picker for the
// order's client. Archived rows are hidden entirely; every other status
// stays selectable (draft / ready_for_client_review /
// client_changes_requested included) so staff can prepare a draft order
// against an in-progress configuration - the not-yet-approved state is
// surfaced as a flag at selection time, never a hard block.
export function selectableClientProductsForOrder(clientProducts = []) {
  return (Array.isArray(clientProducts) ? clientProducts : []).filter(
    (cp) => cp && cp.id && !isClientProductArchived(cp),
  );
}

function positiveNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Revision as a finite integer, or null when the row has none. Used only
// for the "revision N" display hint at selection time.
export function clientProductRevision(cp = {}) {
  const n = Number(cp.revision);
  return Number.isInteger(n) ? n : null;
}

// Commercial-only picker item. `id` is the client_product id so the
// existing selectedPickerItem lookup (which also matches client_product_id)
// resolves to this row, and so clientProductForLine() in ProductsEditor
// finds it via clientProductsById once the line carries client_product_id.
export function clientProductToPickerItem(cp = {}) {
  const configuredPrice = cp.requires_quote ? null : positiveNumberOrNull(cp.client_price);
  return {
    id: cp.id,
    source: "client_product",
    client_product_id: cp.id,
    // Parent identity preserved when the client product is backed by a
    // catalog (opps_product_id) or stock (inventory_item_id) row - never
    // both (DB check constraint). Left "" for a standalone client product.
    catalog_item_id: cp.opps_product_id || "",
    inventory_item_id: cp.inventory_item_id || "",
    name:
      String(cp.client_facing_name || cp.internal_name || "").trim() ||
      "Client product",
    price: configuredPrice == null ? "" : configuredPrice,
    needsPriceReview: configuredPrice == null,
    requires_quote: Boolean(cp.requires_quote),
    category: cp.category || "",
    image_url: cp.primary_mockup_url || cp.thumbnail_url || "",
    status: cp.status || "",
    approved: isClientProductApproved(cp),
    client_approved: cp.client_approved === true,
    revision: clientProductRevision(cp),
    // Option arrays are intentionally empty: size / colour / print
    // options for a client product come from its own variants and
    // components via Attach composition, never from ad-hoc arrays here.
    sizes: [],
    colors: [],
    print_options: [],
    addons: [],
  };
}

// The order-line (newRow) patch applied when a client product is picked.
// Sets client_product_id directly and preserves the parent catalog /
// inventory id. Clears any option/size/colour carried from a previous
// pick. Never writes a fabricated price - an item with no configured
// price leaves the price field blank for explicit staff entry.
export function applyClientProductPickToNewRow(row = {}, item = {}) {
  return {
    ...row,
    name: item.name || row.name || "",
    price: item.price ? String(item.price) : "",
    catalog_item_id: item.catalog_item_id || "",
    inventory_item_id: item.inventory_item_id || "",
    client_product_id: item.client_product_id || item.id || "",
    image_url: item.image_url || "",
    category: item.category || "",
    source: "client_product",
    size: "",
    color: "",
    selected_print_options: [],
    selected_addons: [],
  };
}

// One-line, hum-readable status label for the picker row + preview card.
export function clientProductStatusLabel(item = {}) {
  if (item.approved) return "Client-approved";
  const raw = String(item.status || "").trim();
  return raw ? raw.replace(/_/g, " ") : "unconfigured";
}
