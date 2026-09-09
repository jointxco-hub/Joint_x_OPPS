import { supabase } from "@/lib/supabaseClient";

// Thin wrapper over the EXISTING shared RPC
// admin_get_client_product_approvals (X LAB migration
// 202608120004_client_products_lifecycle.sql). Verified live on
// production: SECURITY DEFINER, STABLE, tenant-gated via
// can_access_tenant(cp.tenant_id), EXECUTE granted to `authenticated`
// only (anon/public revoked). Returns the client_approvals rows for a
// client product, newest first:
//   { id, status, approved_by_email, approved_at, rejected_reason,
//     revision, created_at }
//
// Read-only. Never writes an approval. Never calls the customer-only
// approve_client_product_concept. No new table, no new RPC.
export async function getClientProductApprovals(clientProductId) {
  if (!clientProductId) return { data: null, error: "Missing client product id" };
  if (!supabase) return { data: null, error: "Supabase not configured" };
  try {
    const { data, error } = await supabase.rpc("admin_get_client_product_approvals", {
      p_client_product_id: clientProductId,
    });
    if (error) return { data: null, error: error.message };
    return { data: Array.isArray(data) ? data : [], error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not load client-product approvals." };
  }
}

// True ONLY when an approved client_approvals row exists for the EXACT
// current client-product revision. Lifecycle status (active /
// ready_to_order / client_approved) is never sufficient on its own - a
// revision bump since the last approval must invalidate it.
export function hasCurrentRevisionApproval(rows, currentRevision) {
  if (!Array.isArray(rows) || currentRevision == null) return false;
  const rev = Number(currentRevision);
  if (!Number.isInteger(rev)) return false;
  return rows.some(
    (r) => r && String(r.status) === "approved" && Number(r.revision) === rev,
  );
}

// The most recent approved row for the current revision (for showing the
// approver email / date), or null.
export function currentRevisionApprovalRecord(rows, currentRevision) {
  if (!Array.isArray(rows) || currentRevision == null) return null;
  const rev = Number(currentRevision);
  if (!Number.isInteger(rev)) return null;
  return (
    rows.find((r) => r && String(r.status) === "approved" && Number(r.revision) === rev) || null
  );
}
