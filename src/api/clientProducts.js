import { supabase } from "@/lib/supabaseClient";

// Phase 1F-A - thin wrappers over the EXISTING shared Client Product
// domain. No new tables, no new RPCs, no second readiness calculation:
// readiness comes only from admin_get_client_product_artwork_readiness
// (which delegates to _compute_artwork_readiness server-side), and
// required placements are set only through
// admin_set_client_product_required_artwork_placements (which normalizes
// the list and is the authoritative readiness input). Result/error shape
// matches src/api/artworkLinking.js.
//
// Pure helpers (deriveReadinessState, buildClientProductCreatePayload,
// the constant lists) live in src/lib/clientProductReadiness.js so they
// stay node --test-able without the supabase client; re-exported here for
// callers that already import from this module.
export {
  READINESS_STATES,
  deriveReadinessState,
  buildClientProductCreatePayload,
  SENSITIVE_CLIENT_PRODUCT_FIELDS,
  CLIENT_PRODUCT_STATUSES,
} from "@/lib/clientProductReadiness";

export async function getClientProductArtworkReadiness({ clientProductId }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!clientProductId) return { data: null, error: "Missing client product id" };
  try {
    const { data, error } = await supabase.rpc("admin_get_client_product_artwork_readiness", {
      p_client_product_id: clientProductId,
    });
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not load artwork readiness." };
  }
}

// placements: string[] - an empty array is valid and means "explicitly no
// artwork required". Passing null/undefined is refused here (the RPC also
// refuses it) - "leave it unconfirmed" is the absence of a call, not a
// null argument.
export async function setClientProductRequiredArtworkPlacements({ clientProductId, placements, updatedBy }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!clientProductId) return { data: null, error: "Missing client product id" };
  if (!Array.isArray(placements)) {
    return { data: null, error: "Provide an explicit placement list (an empty list means no artwork required)" };
  }
  try {
    const { data, error } = await supabase.rpc("admin_set_client_product_required_artwork_placements", {
      p_client_product_id: clientProductId,
      p_placements: placements,
      p_updated_by: updatedBy ?? null,
    });
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not update required placements." };
  }
}
