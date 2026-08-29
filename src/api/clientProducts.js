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

export {
  PRODUCTION_READONLY_MESSAGE,
  PRICING_PREVIEW_BOUNDARY,
  summarizeProduction,
  deriveProductionGaps,
  buildAllowedCombinationMatrix,
} from "@/lib/clientProductProduction";

// Phase 1F-B - the EXACT RLS write-gate for production-configuration
// tables (product_components, client_product_garment_variants /
// _treatments / _variant_treatments), exposed as a boolean so the
// Production tab can render proactive read-only UX instead of only
// reacting to a rejected write. inventory_can_review_tenant is already
// granted to `authenticated`; this is a probe, never a grant change.
export async function canReviewTenant({ tenantId }) {
  if (!supabase) return { data: false, error: "Supabase not configured" };
  if (!tenantId) return { data: false, error: null };
  try {
    const { data, error } = await supabase.rpc("inventory_can_review_tenant", { p_tenant_id: tenantId });
    if (error) return { data: false, error: error.message };
    return { data: data === true, error: null };
  } catch (error) {
    return { data: false, error: error?.message || "Could not check production permissions." };
  }
}

// Thin wrapper over the existing duplicate_product_composition RPC. The
// RPC enforces same-tenant, same-client, reviewer access on BOTH sides,
// non-empty source and empty target; this only normalizes the call and
// error shape. Never clones artwork / variants / treatments / status -
// that is the RPC's contract, unchanged.
export async function duplicateProductComposition({ sourceClientProductId, targetClientProductId }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!sourceClientProductId || !targetClientProductId) {
    return { data: null, error: "Pick a source client product to copy composition from" };
  }
  try {
    const { data, error } = await supabase.rpc("duplicate_product_composition", {
      p_source_client_product_id: sourceClientProductId,
      p_target_client_product_id: targetClientProductId,
    });
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not duplicate composition." };
  }
}

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
