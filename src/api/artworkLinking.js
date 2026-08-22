import { supabase } from "@/lib/supabaseClient";

// Thin RPC wrapper - the RPC itself (find_or_create_client_product_artwork_from_asset,
// see supabase/migrations/202608220006_client_product_artwork_asset_linking.sql) does
// all authorization/tenant/client verification and the actual find-or-create; this
// just calls it and normalizes the result/error shape for React callers, matching
// the pattern already used by src/api/clientRequests.js.
export async function findOrCreateClientProductArtworkFromAsset({ tenantId, clientProductId, clientAssetId, placement }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!tenantId || !clientProductId || !clientAssetId || !placement) {
    return { data: null, error: "Missing required artwork link parameters" };
  }

  try {
    const { data, error } = await supabase.rpc("find_or_create_client_product_artwork_from_asset", {
      p_tenant_id: tenantId,
      p_client_product_id: clientProductId,
      p_client_asset_id: clientAssetId,
      p_placement: placement,
    });

    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not link artwork." };
  }
}
