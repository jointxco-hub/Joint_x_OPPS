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

// Thin RPC wrapper for revise_order_line_component_snapshot_artwork
// (supabase/migrations/20260829120000_order_line_component_snapshot_artwork_revision.sql).
// The RPC itself does every check - staff auth, is_current, expected-revision
// match, same-client-product / same-placement / family-namespace validation
// of each artwork revision, and the append/supersede revision write. This
// only normalizes the call and result/error shape, matching
// findOrCreateClientProductArtworkFromAsset above and the sibling
// duplicate_order_line_with_snapshots call in ProductsEditor.
//
// No-unlink contract (Phase 1E): at least one artwork revision id is
// required. An empty array is refused here before the RPC is ever called,
// so an ambiguous UI state can never reach the server as "clear artwork".
export async function reviseOrderLineComponentSnapshotArtwork({ snapshotId, artworkRevisionIds, expectedRevision }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  const ids = Array.isArray(artworkRevisionIds) ? artworkRevisionIds.filter(Boolean) : [];
  if (!snapshotId || ids.length === 0 || expectedRevision == null) {
    return { data: null, error: "Select at least one artwork revision to link" };
  }

  try {
    const { data, error } = await supabase.rpc("revise_order_line_component_snapshot_artwork", {
      p_snapshot_id: snapshotId,
      p_artwork_revision_ids: ids,
      p_expected_revision: expectedRevision,
    });

    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not relink artwork." };
  }
}
