import { supabase } from "@/lib/supabaseClient";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const validate = value => {
  if (typeof value !== "string" || !UUID.test(value.trim())) {
    throw new Error("Enter a valid Café service-order UUID.");
  }
  return value.trim();
};

async function callStaffHandoff(name, orderId) {
  if (!supabase) throw new Error("Staging OPPS is unavailable.");
  const { data: auth, error: authError } = await supabase.auth.getSession();
  if (authError || !auth?.session?.access_token) {
    throw new Error("Sign in as authorized Café staff to continue.");
  }
  // The database RPC itself verifies auth.uid() and the explicit
  // cafe.operations.manage capability, even if this screen is bypassed.
  const { data, error } = await supabase.rpc(name, {
    p_service_order_id: validate(orderId),
  });
  if (error) throw new Error(error.message || "OPPS handoff failed.");
  if (!data || typeof data !== "object") {
    throw new Error("The handoff server returned an invalid response.");
  }
  return data;
}

export const previewCafeHandoff = orderId =>
  callStaffHandoff("admin_preview_quick_solution_opps_handoff",orderId);

export const sendCafeHandoff = orderId =>
  callStaffHandoff("admin_send_quick_solution_order_to_opps",orderId);
