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
    // variants: undefined/null -> RPC NULL ("preserve existing variants" on
    // a mapping-only call to an already-onboarded product); [] -> RPC []
    // (deliberate clear); [...] -> replace. A plain `variants || []` would
    // collapse the "not supplied" case into "deliberately empty" and could
    // wipe a real variant list on a mapping-only call - see
    // 20260823120000_xos_3b_product_onboarding.sql section 4.
    const { data, error } = await supabase.rpc("admin_onboard_client_commerce_product", {
      p_client_id: clientId,
      p_product: product,
      p_variants: variants === undefined ? null : variants,
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

// Backs the onboarding form's three pickers (existing managed products,
// OPPS products, X LAB templates) without granting the browser
// unrestricted table access - see admin_get_client_commerce_onboarding_options
// in 20260823120000_xos_3b_product_onboarding.sql.
export async function adminGetClientCommerceOnboardingOptions({ clientId }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!clientId) return { data: null, error: "Missing client id" };

  try {
    const { data, error } = await supabase.rpc("admin_get_client_commerce_onboarding_options", {
      p_client_id: clientId,
    });

    if (error) return { data: null, error: error.message };
    return { data: data || { client_products: [], opps_products: [], xlab_templates: [] }, error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not load onboarding options." };
  }
}
