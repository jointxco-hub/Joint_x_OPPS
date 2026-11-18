import { supabase } from "@/lib/supabaseClient";

// Staff-only read-only triage. Never releases a checkout or takes payment.
// Backend authorizes OPPS staff plus Café operations management.
export async function listUnresolvedCafeQrCheckouts() {
  if (!supabase || import.meta.env.VITE_SUPABASE_URL !== "https://tijiamrfnxrbitafiflj.supabase.co") {
    throw new Error("Staging QR review is unavailable.");
  }
  const { data: auth, error: authError } = await supabase.auth.getSession();
  if (authError || !auth?.session?.access_token) {
    throw new Error("Sign in with an authorized OPPS staff account.");
  }
  const { data, error } = await supabase.rpc("qs_opps106_list_qr_checkout_reviews", { p_limit: 50 });
  if (error) throw new Error("Staff QR review is unavailable or your account has no access.");
  if (!Array.isArray(data)) throw new Error("QR review returned an invalid response.");
  return data.filter(item => item && typeof item.order_number === "string"
    && typeof item.payment_request_id === "string" && Number.isSafeInteger(Number(item.amount_cents)));
}


const REVIEW_TYPES = new Set([
  "case_opened","provider_no_capture_reported","provider_capture_reported",
  "escalated","second_review_confirmed"
]);
const QR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function reviewRpc(name, args) {
  if (!supabase || import.meta.env.VITE_SUPABASE_URL !== "https://tijiamrfnxrbitafiflj.supabase.co") {
    throw Error("Staging QR review is unavailable.");
  }
  const { data: auth, error: authError } = await supabase.auth.getSession();
  if (authError || !auth?.session?.access_token) throw Error("Sign in as an authorized Café manager.");
  const { data, error } = await supabase.rpc(name,args);
  if (error) throw Error("QR review access denied or review service unavailable.");
  return data;
}

export async function listCafeQrCheckoutReviewEvents(requestId) {
  if (!QR_ID.test(requestId || "")) throw Error("Invalid QR review identifier.");
  const data = await reviewRpc("qs_opps106_list_qr_checkout_review_events",{p_request_id:requestId});
  if (!Array.isArray(data)) throw Error("Invalid review history.");
  return data;
}

export async function logCafeQrCheckoutReview({requestId,type,providerReference="",notes=""}) {
  if (!QR_ID.test(requestId || "") || !REVIEW_TYPES.has(type)
    || typeof notes !== "string" || notes.trim().length < 12 || notes.trim().length > 1000) {
    throw Error("Provide a review type and a factual note of at least 12 characters.");
  }
  const evidence=String(providerReference || "").trim();
  if (["provider_no_capture_reported","provider_capture_reported","second_review_confirmed"].includes(type)
      && evidence.length < 6) throw Error("A PayFast/provider case reference is required.");
  const data = await reviewRpc("qs_opps106_log_qr_checkout_review",{
    p_request_id:requestId,p_event_type:type,p_provider_reference:evidence,
    p_notes:notes.trim(),p_operation_key:"review_"+crypto.randomUUID().replaceAll("-","")
  });
  if (data?.ok !== true) throw Error(data?.reason || "QR review could not be recorded.");
  return data;
}

export async function getCafeQrCheckoutReviewStatus(requestId) {
  if (!QR_ID.test(requestId || "")) throw Error("Invalid QR review identifier.");
  const data=await reviewRpc("qs_opps106_get_qr_checkout_review_status", {p_request_id:requestId});
  if (data?.ok !== true || data.cashCardHoldReleased !== false
      || data.gatewayNoCaptureAttested !== false) {
    throw Error("Checkout review is unavailable; payment hold remains in force.");
  }
  return data;
}
