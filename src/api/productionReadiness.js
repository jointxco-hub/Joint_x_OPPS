import { supabase } from "@/lib/supabaseClient";

function isMissingMigration(message = "") {
  const lower = message.toLowerCase();
  return (
    lower.includes("get_order_production_readiness") ||
    lower.includes("update_order_production_readiness_check") ||
    lower.includes("order_production_readiness_checks") ||
    lower.includes("could not find the function") ||
    lower.includes("does not exist")
  );
}

export async function getOrderProductionReadiness(orderId) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!orderId) return { data: null, error: "Missing order id" };

  try {
    const { data, error } = await supabase.rpc("get_order_production_readiness", {
      p_order_id: orderId,
    });

    if (error) {
      if (isMissingMigration(error.message)) {
        return { data: null, error: "Production Readiness migration has not been applied yet." };
      }
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch {
    return { data: null, error: "Could not load production readiness." };
  }
}

export async function updateOrderProductionReadinessCheck({ orderId, checkKey, status, notes }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  try {
    const { data, error } = await supabase.rpc("update_order_production_readiness_check", {
      p_order_id: orderId,
      p_check_key: checkKey,
      p_status: status,
      p_notes: notes || null,
    });

    if (error) {
      if (isMissingMigration(error.message)) {
        return { data: null, error: "Production Readiness migration has not been applied yet." };
      }
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch {
    return { data: null, error: "Could not update production readiness." };
  }
}
