import { supabase } from "@/lib/supabaseClient";

// ─────────────────────────────────────────────────────────────────────
// XOS Client Products — ONE canonical domain (Phase C).
//
// Thin wrappers over the shared canonical RPCs introduced by X LAB
// migration 20260901150000_xos_client_products_unification.sql (+ the
// asset-reuse RPCs from 20260901120000). OPPS and X LAB are two
// interfaces over the SAME client_product_id: same thumbnail, mockup,
// structured production, required-artwork set, artwork revisions,
// readiness and price/quote state.
//
// Nothing here recomputes readiness, derives the flat production
// summary, or writes product_components directly — the server owns all
// of that. Result/error shape matches src/api/artworkLinking.js and
// src/api/clientProducts.js ({ data, error }).
// ─────────────────────────────────────────────────────────────────────

async function callRpc(fn, args, fallbackMessage) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error?.message || fallbackMessage };
  }
}

// THE canonical projection. Every OPPS Client Product detail/drawer view
// reads this and nothing else — identity, details, variants, pricing,
// flags, thumbnail, mockup, source_order, production.components,
// production.summary, required_artwork_placements, artwork,
// artwork_readiness, product_readiness.
export async function getClientProductFull(clientProductId) {
  if (!clientProductId) return { data: null, error: "Missing client product id" };
  return callRpc(
    "get_client_product_full",
    { p_client_product_id: clientProductId },
    "Could not load the client product.",
  );
}

// THE only structured-production writer. `components` is an array; one
// atomic placement per element:
//   { id?, component_type, production_method, placement, production_colour?,
//     specification?, production_instructions?, quantity_per_unit?,
//     billing_mode?, sort_order?, is_active? }
// The RPC upserts product_components, deletes rows absent from the
// payload, derives the flat summary + required_artwork_placements in the
// same transaction, audits, and returns get_client_product_full.
export async function setClientProductProductionComponents(clientProductId, components) {
  if (!clientProductId) return { data: null, error: "Missing client product id" };
  if (!Array.isArray(components)) return { data: null, error: "Provide a components array" };
  return callRpc(
    "admin_set_client_product_production_components",
    { p_client_product_id: clientProductId, p_components: components },
    "Could not save production.",
  );
}

// THE only thumbnail writer (shared with X LAB). Pointer-only, same
// staff/tenant/client validation as the mockup setter. Never touches
// primary_mockup_*.
export async function setClientProductThumbnailFromAsset(clientProductId, clientAssetId) {
  if (!clientProductId || !clientAssetId) return { data: null, error: "Pick a file for the thumbnail" };
  return callRpc(
    "admin_set_client_product_thumbnail_from_asset",
    { p_client_product_id: clientProductId, p_client_asset_id: clientAssetId },
    "Could not set the thumbnail.",
  );
}

// THE only mockup-from-asset writer (shared with X LAB). Pointer-only.
// Never touches thumbnail_*.
export async function setClientProductMockupFromAsset(clientProductId, clientAssetId) {
  if (!clientProductId || !clientAssetId) return { data: null, error: "Pick a file for the mockup" };
  return callRpc(
    "admin_set_client_product_mockup_from_asset",
    { p_client_product_id: clientProductId, p_client_asset_id: clientAssetId },
    "Could not set the mockup.",
  );
}

// Adds an artwork revision that REFERENCES an existing client asset (no
// blob copy). makeCurrent=false (default) never supersedes the current
// approved revision — staff promotes explicitly. makeCurrent=true only
// for the very first revision of a placement.
export async function linkClientProductArtworkFromAsset(clientProductId, clientAssetId, placement, makeCurrent = false) {
  if (!clientProductId || !clientAssetId || !placement) {
    return { data: null, error: "Missing artwork link details" };
  }
  return callRpc(
    "admin_link_client_product_artwork_from_asset",
    {
      p_client_product_id: clientProductId,
      p_client_asset_id: clientAssetId,
      p_placement: placement,
      p_make_current: makeCurrent === true,
    },
    "Could not link artwork.",
  );
}

// Read-only: { source_order, diff:[{ field, op:'add'|'normalize'|'no_change'|'conflict', to?, reason? }] }.
export async function previewClientProductSourceImport(clientProductId) {
  if (!clientProductId) return { data: null, error: "Missing client product id" };
  return callRpc(
    "admin_preview_client_product_source_import",
    { p_client_product_id: clientProductId },
    "Could not preview the source order import.",
  );
}

// Fills blanks only; normalizes authoritative legacy production; never
// overwrites curated non-empty values; never replaces current artwork;
// no blob copy. Returns get_client_product_full.
export async function importClientProductFromSource(clientProductId) {
  if (!clientProductId) return { data: null, error: "Missing client product id" };
  return callRpc(
    "admin_import_client_product_from_source",
    { p_client_product_id: clientProductId },
    "Could not import from the source order.",
  );
}

// THE only order-based create path. Returns
// { client_product_id, deduplicated, product:<get_client_product_full> }.
// deduplicated:true means the order line already maps to a Client
// Product — open that one, create nothing.
export async function createClientProductFromOrder(orderId, lineId, overrides = {}) {
  if (!orderId || !lineId) return { data: null, error: "Pick an order line" };
  return callRpc(
    "admin_create_client_product_from_order",
    { p_order_id: orderId, p_line_id: lineId, p_overrides: overrides ?? {} },
    "Could not create the client product from this order line.",
  );
}

// P4 — OPPS-native composed order line. Appends a canonical parent
// product line + one setup_fee companion per once-off fee to
// orders.products, and auto-snapshots the frozen composition. Here the
// order is being built now, so the CURRENT Client Product composition is
// the transaction truth (unlike an X LAB reprice). The RPC enforces the
// reviewer/tenant gate and the parent/companion line-role integrity.
export async function xosAddComposedClientProductToOrder(orderId, clientProductId, quantity, unitPrice = null) {
  if (!orderId || !clientProductId) return { data: null, error: "Pick an order and a client product" };
  return callRpc(
    "xos_add_composed_client_product_to_order",
    {
      p_order_id: orderId,
      p_client_product_id: clientProductId,
      p_quantity: Number(quantity) > 0 ? Number(quantity) : 1,
      p_unit_price: unitPrice == null || unitPrice === "" ? null : Number(unitPrice),
    },
    "Could not add the composed client product to this order.",
  );
}

// Read-only order line items for the "create from order" picker. The
// line price is REFERENCE ONLY (line_price_raw) and is never imported as
// the reusable Client Product price.
export async function getClientOrderLinesForImport(orderId) {
  if (!orderId) return { data: null, error: "Missing order id" };
  return callRpc(
    "admin_get_client_order_lines",
    { p_order_id: orderId },
    "Could not load the order lines.",
  );
}

// Client-scoped asset list (server-side client isolation) for the visual
// pickers. Staff RLS would leak the whole tenant; this never does.
export async function listClientAssetsForPicker(clientId, query = "", limit = 100) {
  if (!clientId) return { data: [], error: null };
  return callRpc(
    "admin_list_client_assets",
    { p_client_id: clientId, p_query: query ?? "", p_limit: limit },
    "Could not load client files.",
  );
}

// ─────────────────────────────────────────────────────────────────────
// Customer-safe error copy for the canonical RPC exception codes. The
// server exceptions are "CODE: detail" — map the ones staff act on and
// fall through to the raw human text otherwise (never hide a new one).
// ─────────────────────────────────────────────────────────────────────
export function mapXosCpError(raw) {
  const m = String(raw || "");
  if (/XOS_CP_NOT_AUTHORIZED|ADMIN_NOT_AUTHORIZED|not signed in|JWT/i.test(m)) {
    return "Your session expired — sign in again.";
  }
  if (/XOS_CP_REVIEW_FORBIDDEN|row-level security|permission denied/i.test(m)) {
    return "You don't have production-review access for this client's tenant. Ask a workspace owner or admin.";
  }
  if (/XOS_CP_ACTOR_UNRESOLVED/.test(m)) return "Your staff account couldn't be resolved — sign in again.";
  if (/XOS_CP_NOT_FOUND|ADMIN_PRODUCT_NOT_FOUND/.test(m)) {
    return "This product isn't available right now — reload and try again.";
  }
  if (/XOS_CP_PLACEMENT_NOT_ATOMIC/.test(m)) {
    return 'Each production component needs one placement — split "Front and back" into a Front component and a Back component.';
  }
  if (/XOS_CP_COMPONENT_TYPE_INVALID/.test(m)) return "One of the components has an unknown type.";
  if (/XOS_CP_PRODUCTION_METHOD_INVALID/.test(m)) return "One of the components has an unknown print method.";
  if (/XOS_CP_(BILLING_MODE|QUANTITY_PER_UNIT)_INVALID/.test(m)) return "One of the components has an invalid value.";
  if (/XOS_CP_COMPONENTS_INVALID/.test(m)) return "The production list couldn't be read — reload and try again.";
  if (/ORDER_SETUP_FEE_PARENT_NOT_FOUND/.test(m)) return "A setup-fee line is missing a valid parent product line — reload and try again.";
  if (/ORDER_LINE_ROLE_INVALID/.test(m)) return "An order line has an unrecognised role — reload and try again.";
  if (/XOS_ORDER_NOT_FOUND/.test(m)) return "That order could not be found.";
  if (/XOS_PRICE_BREAKDOWN_INVALID/.test(m)) return "The price breakdown for this line is malformed and was rejected.";
  if (/TENANT_ACCESS_DENIED/.test(m)) return "You don't have access to this order's tenant.";
  if (/CLIENT_PRODUCT_ARTWORK_PLACEMENT_CONFLICT/.test(m)) {
    let placement = "A placement";
    try {
      const detail = JSON.parse(m.slice(m.indexOf(":") + 1).trim());
      if (detail?.removed_placement) {
        placement = String(detail.removed_placement)
          .replace(/[_-]+/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
      }
    } catch {
      /* keep generic */
    }
    return `${placement} has linked artwork and can't be removed from production automatically. Remove or reassign that artwork first.`;
  }
  if (/SOURCE_ORDER_NO_LINK/.test(m)) return "This product isn't linked to a source order line, so there's nothing to import.";
  if (/SOURCE_ORDER_LINE_AMBIGUOUS/.test(m)) return "The source order has more than one matching line — resolve it on the order first.";
  if (/SOURCE_ORDER_NOT_FOUND/.test(m)) return "The source order isn't available.";
  if (/ADMIN_(MOCKUP|THUMBNAIL|ARTWORK)_ASSET_NOT_FOUND/.test(m)) return "That file isn't available for this client any more.";
  if (/ADMIN_(MOCKUP|THUMBNAIL|ARTWORK)_ASSET_UNUSABLE/.test(m)) return "That file can't be used — try another one.";
  if (/ADMIN_(MOCKUP|THUMBNAIL)_INVALID/.test(m)) return "Pick a file first.";
  // RPC exceptions are "SOME_CODE: human text" — the human text alone.
  const codeMatch = m.match(/^[A-Z_]+:\s*(.+)$/s);
  if (codeMatch) return codeMatch[1];
  return m || "That didn't work — please try again.";
}

// Display fallback for the product visual identity: explicit thumbnail →
// mockup → nothing. Never persists the fallback.
export function resolveProductThumbRef(full) {
  const thumb = full?.thumbnail?.url;
  if (thumb && String(thumb).trim()) return String(thumb).trim();
  const mockup = full?.mockup?.url;
  if (mockup && String(mockup).trim()) return String(mockup).trim();
  return "";
}

// Lower-snake slug → display label ("left_chest" → "Left Chest"). Mirrors
// X LAB's formatPlacementName so both apps label placements identically.
export function formatPlacementName(slug) {
  return String(slug || "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export const PRODUCTION_COMPONENT_TYPES = [
  "blank_garment",
  "print_service",
  "material",
  "packaging",
  "labour",
  "setup_fee",
  "other",
];

export const PRODUCTION_METHODS = [
  "dtf",
  "vinyl",
  "screen",
  "embroidery",
  "pressing",
  "tailoring",
  "cropping",
  "labeling",
  "sublimation",
  "mixed",
  "custom",
];

export const PRODUCT_READINESS_ROWS = [
  ["product_name", "Product name"],
  ["thumbnail", "Thumbnail"],
  ["client_price", "Client-facing price"],
  ["production", "Production configured"],
  ["artwork", "Artwork"],
  ["reorder_enabled", "Reorder enabled"],
];
