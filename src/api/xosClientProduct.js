// ORDERS CLIENT-PRODUCT REUSE — PHASE 1. A minimal, self-contained
// wrapper for the canonical xos_add_composed_client_product_to_order RPC
// (X LAB migration 20260912130000, staging only in this phase).
//
// Deliberately NOT built on the unmerged Phase C "xos client products"
// API surface (PR #59, still open) - that surface (callRpc,
// createClientProductFromOrder, etc.) does not exist on main yet and
// this phase does not depend on it. This file calls supabase.rpc()
// directly, the same way ProductsEditor.jsx already calls
// revise_order_line_component_snapshot inline - one small, independently
// mergeable surface, not a second competing client-API convention.

import { supabase } from "@/lib/supabaseClient";

// Appends a canonical parent product line + one setup_fee companion per
// once-off fee to orders.products (commercial lines only - no snapshot
// writing; see the migration header for why). p_idempotency_key is
// generated ONCE by the caller per add-attempt and reused across any
// retry of the same click, so a double-click/network-retry replays
// safely instead of creating a second line.
export async function xosAddComposedClientProductToOrder({
  orderId,
  clientProductId,
  quantity,
  unitPrice = null,
  idempotencyKey,
}) {
  if (!orderId || !clientProductId) {
    return { data: null, error: "Pick an order and a client product" };
  }
  if (!idempotencyKey) {
    return { data: null, error: "Missing idempotency key" };
  }
  const { data, error } = await supabase.rpc("xos_add_composed_client_product_to_order", {
    p_order_id: orderId,
    p_client_product_id: clientProductId,
    p_quantity: Number(quantity) > 0 ? Number(quantity) : 1,
    p_unit_price: unitPrice == null || unitPrice === "" ? null : Number(unitPrice),
    p_idempotency_key: idempotencyKey,
  });
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

// Maps the RPC's stable error codes to staff-facing copy. Narrow by
// design - only the codes this RPC can actually raise (plus the shared
// tenant-access code every SECURITY DEFINER RPC in this area can raise).
export function mapXosComposedAddError(raw) {
  const m = String(raw || "");
  if (/ORDER_LINE_ADD_IDEMPOTENCY_CONFLICT/.test(m)) return "This add already partially happened under a different product - reload the order and try again.";
  if (/ORDER_SETUP_FEE_PARENT_NOT_FOUND/.test(m)) return "A setup-fee line is missing a valid parent product line - reload and try again.";
  if (/ORDER_LINE_ROLE_INVALID/.test(m)) return "An order line has an unrecognised role - reload and try again.";
  if (/XOS_ORDER_NOT_FOUND/.test(m)) return "That order could not be found.";
  if (/XOS_CP_NOT_FOUND/.test(m)) return "That client product could not be found.";
  if (/TENANT_ACCESS_DENIED/.test(m)) return "You don't have access to this order's tenant.";
  // CLIENT PRODUCT PRICING CONFIGURATION - the compose RPC's price gate.
  if (/XOS_CP_REQUIRES_QUOTE/.test(m)) return "This product still requires a quote - resolve its price before adding it to an order.";
  if (/XOS_CP_PRICE_UNRESOLVED/.test(m)) return "One or more required components have no sell price set - configure pricing before adding this product to an order.";
  return m || "Could not add the composed client product to this order.";
}

// CLIENT PRODUCT PRICING CONFIGURATION - staff-facing "why is this unit
// R250?" preview. Wraps admin_get_client_product_price_composition
// (X LAB migration 20260915090000), which itself only ever calls the
// canonical _xos_freeze_client_product_price_breakdown - this file adds
// no composition logic of its own.
export async function getClientProductPriceComposition({ clientProductId, quantity = 1, unitPrice = null }) {
  if (!clientProductId) return { data: null, error: "Missing client product id" };
  const { data, error } = await supabase.rpc("admin_get_client_product_price_composition", {
    p_client_product_id: clientProductId,
    p_quantity: Number(quantity) > 0 ? Number(quantity) : 1,
    p_unit_price: unitPrice == null || unitPrice === "" ? null : Number(unitPrice),
  });
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}
