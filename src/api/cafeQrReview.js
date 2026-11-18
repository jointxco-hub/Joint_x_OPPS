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
