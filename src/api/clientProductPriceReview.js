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
