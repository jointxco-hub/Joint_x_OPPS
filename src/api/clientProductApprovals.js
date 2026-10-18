import { supabase } from "@/lib/supabaseClient";

// Thin wrapper over the EXISTING shared RPC
// admin_get_client_product_approvals (X LAB migration
// 202608120004_client_products_lifecycle.sql; column list widened
// additively by 20261011090000_client_product_approval_on_behalf.sql).
// Verified live on production: SECURITY DEFINER, STABLE, tenant-gated via
// can_access_tenant(cp.tenant_id), EXECUTE granted to `authenticated`
// only (anon/public revoked). Returns the client_approvals rows for a
// client product, newest first:
//   { id, status, approved_by_email, approved_at, rejected_reason,
//     revision, created_at,
//     actor_kind, recorded_by_label, recorded_by_email, approval_source, note }
// actor_kind is 'client' for every row approve_client_product_concept ever
// wrote (the only writer before Client Product Approval Phase B) and
// 'staff' only for a row written by record_client_product_approval_on_behalf.
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

// ─────────────────────────────────────────────────────────────────────
// Client Product Approval - Phase B (staff "record client approval on
// behalf" workflow). Mirrors src/features/quotes/quoteStatus.js +
// src/api/quotes.js's acceptQuoteOnBehalf exactly - same vocabulary, same
// error-mapping convention, same "frontend gate is convenience only, the
// server remains authoritative" discipline.
// ─────────────────────────────────────────────────────────────────────

// One of three mutually exclusive, user-facing approval states for the
// CURRENT revision only - never a lifecycle status, never a recomputation
// of anything the server already decided. "awaiting" covers both "no rows
// at all" and "only an older-revision / non-approved row exists".
export const CLIENT_PRODUCT_APPROVAL_STATES = {
  AWAITING: "awaiting",
  APPROVED_BY_CLIENT: "approved_by_client",
  APPROVED_BY_STAFF: "approved_by_staff",
};

const APPROVAL_STATE_LABELS = {
  [CLIENT_PRODUCT_APPROVAL_STATES.AWAITING]: "Awaiting client approval",
  [CLIENT_PRODUCT_APPROVAL_STATES.APPROVED_BY_CLIENT]: "Approved by client",
  [CLIENT_PRODUCT_APPROVAL_STATES.APPROVED_BY_STAFF]: "Approval recorded by staff",
};

export function approvalStateLabel(state) {
  return APPROVAL_STATE_LABELS[state] || APPROVAL_STATE_LABELS[CLIENT_PRODUCT_APPROVAL_STATES.AWAITING];
}

// Classifies the current-revision approval record (if any) into exactly
// one of the three states above. Reuses currentRevisionApprovalRecord -
// never a second "is this approved" calculation.
export function deriveClientProductApprovalState(rows, currentRevision) {
  const record = currentRevisionApprovalRecord(rows, currentRevision);
  if (!record) return CLIENT_PRODUCT_APPROVAL_STATES.AWAITING;
  return record.actor_kind === "staff"
    ? CLIENT_PRODUCT_APPROVAL_STATES.APPROVED_BY_STAFF
    : CLIENT_PRODUCT_APPROVAL_STATES.APPROVED_BY_CLIENT;
}

// Same two statuses record_client_product_approval_on_behalf's own server
// check requires - approve_client_product_concept's exact precondition.
// A draft product is deliberately NOT accepted here: skipping "ready for
// client review" would make a staff-recorded approval a looser concept of
// "approved" than the customer's own path ever allows.
export const CLIENT_PRODUCT_ON_BEHALF_REVIEWABLE_STATUSES = new Set([
  "ready_for_client_review",
  "client_changes_requested",
]);

// Frontend convenience gate only - the server remains authoritative.
// Requires BOTH a reviewable lifecycle status AND no existing
// current-revision approval (recording twice is rejected server-side too,
// this just avoids showing the action when it would obviously fail).
export function canRecordClientProductApprovalOnBehalf(product, approvalRows) {
  if (!product) return false;
  if (!CLIENT_PRODUCT_ON_BEHALF_REVIEWABLE_STATUSES.has(String(product.status || ""))) return false;
  return deriveClientProductApprovalState(approvalRows, product.revision) === CLIENT_PRODUCT_APPROVAL_STATES.AWAITING;
}

export const CLIENT_PRODUCT_APPROVAL_SOURCE_OPTIONS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "in_person", label: "In person" },
  { value: "phone", label: "Phone" },
  { value: "other", label: "Other" },
];

const CLIENT_PRODUCT_APPROVAL_ON_BEHALF_ERROR_MESSAGES = {
  CLIENT_PRODUCT_APPROVAL_AUTH_REQUIRED: "You must be signed in to record an approval.",
  CLIENT_PRODUCT_APPROVAL_ON_BEHALF_DENIED: "You don't have permission to record a client approval on behalf of a client.",
  CLIENT_PRODUCT_NOT_FOUND: "That client product could not be found.",
  CLIENT_PRODUCT_NOT_REVIEWABLE: "This product must be in \"Ready for client review\" (or have changes requested) before an approval can be recorded.",
  CLIENT_PRODUCT_APPROVAL_SOURCE_REQUIRED: "Choose how the client approved before confirming.",
  CLIENT_PRODUCT_REVISION_CHANGED: "This product changed since it was loaded — reopen it and try again.",
  CLIENT_PRODUCT_ALREADY_APPROVED: "The current revision of this product is already approved.",
};

// Records that a high-trust operator captured the client's approval
// through an offline/delegated channel. The server is the sole authority
// on who may call this (is_app_admin() OR an active owner/admin
// tenant_memberships row on the product's own tenant) - this wrapper adds
// no logic of its own, only error-message mapping, same convention as
// acceptQuoteOnBehalf in src/api/quotes.js. Never calls, never weakens,
// the customer-only approve_client_product_concept.
export async function recordClientProductApprovalOnBehalf({ clientProductId, expectedRevision, approvalSource, note = null }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  const { data, error } = await supabase.rpc("record_client_product_approval_on_behalf", {
    p_client_product_id: clientProductId,
    p_expected_revision: expectedRevision,
    p_approval_source: approvalSource,
    p_note: note,
  });
  if (error) {
    const raw = String(error.message || "");
    const code = Object.keys(CLIENT_PRODUCT_APPROVAL_ON_BEHALF_ERROR_MESSAGES).find((k) => raw.includes(k));
    throw Object.assign(
      new Error(code ? CLIENT_PRODUCT_APPROVAL_ON_BEHALF_ERROR_MESSAGES[code] : raw || "Could not record the approval."),
      { code: code || error.code || "CLIENT_PRODUCT_APPROVAL_ON_BEHALF_FAILED", cause: error },
    );
  }
  if (!data?.ok) {
    throw Object.assign(new Error("The approval returned an incomplete result."), { code: "CLIENT_PRODUCT_APPROVAL_ON_BEHALF_RESULT_INVALID" });
  }
  return data;
}
