import { supabase } from "@/lib/supabaseClient";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidOrderId(orderId) {
  return typeof orderId === "string" && UUID_RE.test(orderId);
}

function isMissingMigration(message = "") {
  const lower = message.toLowerCase();
  return (
    lower.includes("get_order_line_production_readiness") ||
    lower.includes("could not find the function") ||
    lower.includes("does not exist")
  );
}

// Server-side, per-order-line production readiness (ORDERS CLIENT-PRODUCT
// REUSE PHASE 2) — distinct from productionReadiness.js's
// get_order_production_readiness, which is the order-level commercial/
// compliance checklist. This evaluates each production-relevant line's
// frozen composition (snapshots, variant resolution, artwork, approval)
// and returns a per-line status plus an order-level aggregate. One call
// per order — never call this in a loop per line.
export async function getOrderLineProductionReadiness(orderId) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!orderId) return { data: null, error: "Missing order id" };
  if (!isValidOrderId(orderId)) {
    return { data: null, error: "Production readiness requires a saved Supabase order id." };
  }

  try {
    const { data, error } = await supabase.rpc("get_order_line_production_readiness", {
      p_order_id: orderId,
    });

    if (error) {
      if (isMissingMigration(error.message)) {
        return { data: null, error: "Order line production readiness migration has not been applied yet." };
      }
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch {
    return { data: null, error: "Could not load order line production readiness." };
  }
}
