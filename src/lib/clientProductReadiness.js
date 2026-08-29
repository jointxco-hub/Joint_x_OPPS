// Phase 1F-A - pure helpers for the OPPS Client Product workspace. No
// React / Supabase imports so this stays node --test-able in isolation
// (same convention as src/lib/artworkFreeze.js and
// src/features/orders/lineConfiguration.js).
//
// deriveReadinessState is a PURE CLASSIFICATION of the readiness RPC's
// OWN output (admin_get_client_product_artwork_readiness ->
// _compute_artwork_readiness). It never recomputes "ready" from raw
// artwork rows - that authority stays server-side. It only maps the
// payload to a display label, preserving the audited semantics exactly:
//   legacy_fallback === true   -> requirements unconfirmed (NULL reqs)
//   required_placements = []    -> explicitly no artwork required
//   ready === true              -> ready
//   not ready, every required
//     placement has an artwork
//     row (revision_id present) -> awaiting approval
//   not ready, a required
//     placement has no row      -> missing artwork

export const READINESS_STATES = {
  ready: { label: "Ready", tone: "emerald" },
  awaiting_approval: { label: "Awaiting approval", tone: "amber" },
  missing_artwork: { label: "Missing artwork", tone: "red" },
  requirements_unconfirmed: { label: "Requirements unconfirmed", tone: "slate" },
  no_artwork_required: { label: "No artwork required", tone: "slate" },
  unknown: { label: "Unknown", tone: "slate" },
};

export function deriveReadinessState(readiness) {
  if (!readiness || typeof readiness !== "object") return "unknown";
  const required = Array.isArray(readiness.required_placements) ? readiness.required_placements : [];
  const artwork = Array.isArray(readiness.artwork) ? readiness.artwork : [];

  if (readiness.legacy_fallback === true) return "requirements_unconfirmed";
  if (required.length === 0) return "no_artwork_required";
  if (readiness.ready === true) return "ready";

  const everyRequiredHasArtwork = required.every((placement) => {
    const row = artwork.find((a) => a.placement === placement);
    return Boolean(row && row.revision_id);
  });
  return everyRequiredHasArtwork ? "awaiting_approval" : "missing_artwork";
}

// The minimum creation shape, mirroring
// ProductsEditor.resolveOrCreateClientProductForLine exactly: client_id +
// client_facing_name are the only required fields (matching X LAB's own
// model). Everything else is optional and defaulted by the column /
// client_products_set_tenant_id trigger. New rows are never
// visible_in_account (column default false).
export function buildClientProductCreatePayload({ clientId, clientFacingName, internalName, oppsProductId, inventoryItemId }) {
  if (!clientId) throw new Error("clientId is required");
  const name = (clientFacingName || "").trim();
  if (!name) throw new Error("A client-facing name is required");
  return {
    client_id: clientId,
    client_facing_name: name,
    internal_name: (internalName || "").trim() || undefined,
    opps_product_id: oppsProductId || undefined,
    inventory_item_id: inventoryItemId || undefined,
  };
}

// Fields whose change alters what customers can order / see / pay - the
// UI must gate each behind an explicit confirm step.
export const SENSITIVE_CLIENT_PRODUCT_FIELDS = ["client_price", "visible_in_account", "reorder_enabled"];

// The audited lifecycle - no invented states.
export const CLIENT_PRODUCT_STATUSES = [
  "draft",
  "ready_for_client_review",
  "client_changes_requested",
  "client_approved",
  "ready_to_order",
  "active",
  "archived",
];
