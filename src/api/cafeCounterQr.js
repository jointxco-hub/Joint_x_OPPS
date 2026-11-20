import { supabase } from "@/lib/supabaseClient";

// OPPS-106: Staff-authenticated API for Café counter QR preflight.
// Browser never submits amount, tenant or gateway information.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATION_KEY = /^[A-Za-z0-9_-]{8,128}$/;

function requireOrderId(orderId) {
  if (typeof orderId !== "string" || !UUID.test(orderId.trim())) {
    throw new Error("Enter a valid Café service-order UUID.");
  }
  return orderId.trim();
}

async function callQrRpc(name, arguments_) {
  if (!supabase) throw new Error("Staging Café QR is unavailable.");
  const { data: session, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.session?.access_token) {
    throw new Error("Sign in to OPPS to check Café QR eligibility.");
  }
  const { data, error } = await supabase.rpc(name, arguments_);
  if (error) throw new Error("Café QR verification is unavailable.");
  if (!data || typeof data !== "object") throw new Error("Unexpected QR server response.");
  return data;
}

export async function checkCafeCounterQr(orderId) {
  return callQrRpc("qs_opps106_counter_qr_preflight", {
    p_order_id: requireOrderId(orderId),
  });
}

export async function issueCafeCounterQr(orderId, operationKey) {
  if (typeof operationKey !== "string" || !OPERATION_KEY.test(operationKey)) {
    throw new Error("Invalid QR request identifier.");
  }
  return callQrRpc("qs_opps106_issue_counter_qr", {
    p_order_id: requireOrderId(orderId),
    p_operation_key: operationKey,
  });
}
