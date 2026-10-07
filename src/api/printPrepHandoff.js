import { supabase } from "@/lib/supabaseClient";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidPrintPrepHandoffArgs({ orderId, lineId, snapshotId } = {}) {
  return Boolean(
    typeof orderId === "string" &&
    UUID_RE.test(orderId) &&
    typeof lineId === "string" &&
    lineId.trim() &&
    typeof snapshotId === "string" &&
    UUID_RE.test(snapshotId)
  );
}

function friendlyHandoffError(message = "") {
  if (message.includes("PRINT_PREP_HANDOFF_BLOCKED")) {
    return message.replace(/^.*PRINT_PREP_HANDOFF_BLOCKED:\s*/, "Production is blocked: ");
  }
  if (message.includes("PRINT_PREP_HANDOFF_NOT_PRINT_COMPONENT")) {
    return "Only print-service components can be sent to Print Prep.";
  }
  if (message.includes("PRINT_PREP_HANDOFF_TENANT_DENIED") || message.includes("PRINT_PREP_HANDOFF_FORBIDDEN")) {
    return "You do not have access to this production handoff.";
  }
  if (message.includes("PRINT_PREP_HANDOFF_SNAPSHOT_NOT_FOUND")) {
    return "This production component changed. Refresh the order and try again.";
  }
  if (message.includes("could not find the function") || message.includes("does not exist")) {
    return "The Print Prep handoff migration has not been applied yet.";
  }
  return message || "Could not prepare the Print Prep handoff.";
}

export async function getPrintPrepHandoff({ orderId, lineId, snapshotId }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!isValidPrintPrepHandoffArgs({ orderId, lineId, snapshotId })) {
    return { data: null, error: "Print Prep handoff requires a saved order, line and production component." };
  }

  try {
    const { data, error } = await supabase.rpc("get_print_prep_handoff", {
      p_order_id: orderId,
      p_line_id: lineId,
      p_snapshot_id: snapshotId,
    });

    if (error) return { data: null, error: friendlyHandoffError(error.message) };
    return { data, error: null };
  } catch {
    return { data: null, error: "Could not prepare the Print Prep handoff." };
  }
}

export function printPrepHandoffFileName(payload) {
  const orderId = payload?.order?.id ? String(payload.order.id).slice(0, 8) : "order";
  const placement = String(payload?.production_component?.placement || "print")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `jointx-print-prep-${orderId}-${placement || "print"}.json`;
}
