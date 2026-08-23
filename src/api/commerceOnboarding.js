import { supabase } from "@/lib/supabaseClient";

// Thin RPC wrappers - the RPCs themselves (see supabase/migrations/
// 20260823120000_xos_3b_product_onboarding.sql) do all staff/tenant
// authorization, idempotency, and the actual onboarding/read work; this
// just calls them and normalizes the result/error shape for React callers,
// matching the pattern already used by src/api/artworkLinking.js.

export async function adminOnboardClientCommerceProduct({
  clientId,
  product,
  variants,
  existingClientProductId,
  existingOppsProductId,
  existingXlabProductId,
  idempotencyKey,
}) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!clientId || !product || !idempotencyKey) {
    return { data: null, error: "Missing required onboarding parameters" };
  }

  try {
    const { data, error } = await supabase.rpc("admin_onboard_client_commerce_product", {
      p_client_id: clientId,
      p_product: product,
      p_variants: variants || [],
      p_existing_client_product_id: existingClientProductId || null,
      p_existing_opps_product_id: existingOppsProductId || null,
      p_existing_xlab_product_id: existingXlabProductId || null,
      p_idempotency_key: idempotencyKey,
    });

    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not onboard product." };
  }
}

export async function adminGetClientCommerceProducts({ clientId }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!clientId) return { data: null, error: "Missing client id" };

  try {
    const { data, error } = await supabase.rpc("admin_get_client_commerce_products", {
      p_client_id: clientId,
    });

    if (error) return { data: null, error: error.message };
    return { data: data || [], error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not load commerce products." };
  }
}
