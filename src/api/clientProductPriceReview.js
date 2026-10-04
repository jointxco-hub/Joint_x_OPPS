// PRODUCT CONFIGURATION REVIEW v1 — read-only staff diagnostic helpers.
//
// Two responsibilities, both read-only, neither duplicates any pricing
// arithmetic of its own:
//   1. resolveClientProductPrice() wraps the canonical
//      public.resolve_client_product_price(uuid, numeric, numeric) RPC —
//      the single source of truth this panel renders.
//   2. getClientProductHistoricalReference() reads EXISTING tables
//      (orders, order_line_component_snapshots) through EXISTING RLS —
//      no new backend RPC was needed or added for this. Quote/invoice
//      items are deliberately not queried here: reliable quote/invoice
//      linkage is not available in the current model. A future
//      commercial-line identity/linkage design is required before
//      adding this history to the review panel — so a safe, honest
//      "unavailable" is correct for now, not a lookup worth faking.

import { supabase } from "@/lib/supabaseClient";
import { dataClient } from "@/api/dataClient";

// CLIENT PRODUCT PRICING CONFIGURATION — Product Configuration Review v1.
// Thin wrapper, same shape as getClientProductPriceComposition in
// xosClientProduct.js. Adds no arithmetic — every field here is read
// verbatim from the RPC's own jsonb result.
export async function resolveClientProductPrice({ clientProductId, quantity = 1, overrideUnitPrice = null }) {
  if (!clientProductId) return { data: null, error: "Missing client product id" };
  const { data, error } = await supabase.rpc("resolve_client_product_price", {
    p_client_product_id: clientProductId,
    p_quantity: Number(quantity) > 0 ? Number(quantity) : 1,
    p_override_unit_price: overrideUnitPrice == null || overrideUnitPrice === "" ? null : Number(overrideUnitPrice),
  });
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

// Reads whatever real historical evidence already exists for this
// client product — never invents a link the schema doesn't have.
// `orders.products` is a jsonb array; `.contains()` maps to Postgres'
// `@>` containment operator, filtered server-side via the SAME RLS this
// table already enforces everywhere else (no new grant).
export async function getClientProductHistoricalReference({ clientProductId, limit = 5 }) {
  if (!clientProductId) {
    return { data: { orderLines: [], snapshots: [] }, error: "Missing client product id" };
  }

  const [ordersRes, snapshotsRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, created_at, status, products")
      .contains("products", [{ client_product_id: clientProductId }])
      .order("created_at", { ascending: false })
      .limit(limit),
    dataClient.entities.OrderLineComponentSnapshot
      .filter({ client_product_id: clientProductId }, "-snapshot_taken_at", limit)
      .catch(() => []),
  ]);

  if (ordersRes.error) {
    return { data: { orderLines: [], snapshots: [] }, error: ordersRes.error.message };
  }

  // Flatten to just the lines that actually reference this product —
  // an order can have other, unrelated lines in the same jsonb array.
  const orderLines = [];
  for (const order of ordersRes.data || []) {
    const lines = Array.isArray(order.products) ? order.products : [];
    for (const line of lines) {
      if (line?.client_product_id === clientProductId) {
        orderLines.push({
          orderId: order.id,
          orderCreatedAt: order.created_at,
          orderStatus: order.status,
          price: line.price,
          quantity: line.quantity,
          lineRole: line.line_role || "product",
        });
      }
    }
  }

  const snapshots = Array.isArray(snapshotsRes) ? snapshotsRes : [];

  return { data: { orderLines, snapshots }, error: null };
}

// SAVE V1 — fingerprint fetch. Thin wrapper over the live, already-granted
// (authenticated) read-only helper _xos_client_product_configuration_
// fingerprint(uuid). Called exactly once, when a reconfiguration draft
// opens — the caller is responsible for freezing the returned value for
// the life of that draft session and never silently refetching it before
// Save, or stale-draft protection is defeated.
export async function getClientProductConfigurationFingerprint({ clientProductId }) {
  if (!clientProductId) return { data: null, error: "Missing client product id" };
  const { data, error } = await supabase.rpc("_xos_client_product_configuration_fingerprint", {
    p_client_product_id: clientProductId,
  });
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

// SAVE V1 — the one authoritative write call. Thin wrapper only: every
// field here maps straight to the live save_client_product_reconfiguration
// RPC's own parameters, verbatim. No computed price, canonical total,
// reconciliation status, or component total is ever sent - the server
// owns all of that. Quantity/price values are coerced to Number only
// where the caller already knows they're numeric; null/undefined pass
// through untouched so the server's own explicit-null validation (not
// truthiness) stays authoritative.
export async function saveClientProductReconfiguration({
  clientProductId,
  expectedFingerprint,
  agreedPriceAction,
  newAgreedPrice = null,
  components = [],
  classification = null,
  divergenceReason = null,
  divergenceNote = null,
  incompleteAcknowledged = false,
  context = "reconfiguration_draft_v1",
}) {
  if (!clientProductId) return { data: null, error: "Missing client product id" };
  if (!expectedFingerprint) return { data: null, error: "Missing expected fingerprint" };
  const { data, error } = await supabase.rpc("save_client_product_reconfiguration", {
    p_client_product_id: clientProductId,
    p_expected_fingerprint: expectedFingerprint,
    p_agreed_price_action: agreedPriceAction,
    p_new_agreed_price: newAgreedPrice,
    p_components: components,
    p_classification: classification,
    p_divergence_reason: divergenceReason,
    p_divergence_note: divergenceNote,
    p_incomplete_acknowledged: Boolean(incompleteAcknowledged),
    p_context: context,
  });
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

// SAVE V1 — maps the backend's own named SAVE_* errors (see
// supabase/migrations/20261004090000_save_client_product_reconfiguration_v1.sql)
// to staff-readable messages. Unknown/unparsed errors fall back to a safe
// generic message; the raw technical detail is always returned alongside
// for the caller to console.error, never shown to the user directly.
const SAVE_ERROR_MESSAGES = {
  SAVE_NOT_FOUND: "This product could not be found. It may have been deleted.",
  SAVE_FORBIDDEN: "You don't have permission to save changes to this product.",
  SAVE_TENANT_DENIED: "You don't have access to this client's workspace.",
  SAVE_ACTOR_UNRESOLVED: "Your account isn't recognized as OPPS staff. Contact an administrator.",
  SAVE_BLOCKED_XLAB_COMMERCIAL: "This product is linked to the X LAB storefront and can't be reconfigured here yet.",
  SAVE_BLOCKED_CLASSIFICATION: "Historical Only and Test/Stale products can't be saved through this workflow.",
  SAVE_STALE_FINGERPRINT: "This product changed after you opened this draft.",
  SAVE_NULL_PRICE_NOT_SUPPORTED: "Clearing the agreed price isn't supported yet. Enter a specific amount instead.",
  SAVE_NEGATIVE_PRICE: "The agreed price can't be negative.",
  SAVE_CROSS_PRODUCT_COMPONENT: "One of these components belongs to a different product. Please reopen this draft and try again.",
  SAVE_INVALID_QUANTITY: "Each component needs a consumption quantity greater than zero.",
  SAVE_NEGATIVE_COMPONENT_PRICE: "Component prices can't be negative.",
  SAVE_DIVERGENCE_REASON_REQUIRED: "A reason is required before this can be saved.",
  SAVE_INCOMPLETE_UNACKNOWLEDGED: "Please acknowledge the incomplete pricing before saving.",
};

export function parseSaveError(rawMessage) {
  const message = typeof rawMessage === "string" ? rawMessage : String(rawMessage || "");
  const match = message.match(/SAVE_[A-Z_]+/);
  const code = match ? match[0] : null;
  const friendly = (code && SAVE_ERROR_MESSAGES[code]) || "Something went wrong while saving. Please try again.";
  return { code, friendly, raw: message };
}
