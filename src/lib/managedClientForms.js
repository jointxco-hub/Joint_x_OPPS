// Pure/React-free/Supabase-free workspace-form and preflight-fingerprint
// logic for the Managed Clients Phase 2 operator UI
// (src/components/managedClients/ManagedClientOperations.jsx). Extracted
// on its own so the patch-style diffing and preflight-staleness detection
// can be exercised directly by node --test, without importing a .jsx file
// that pulls in React/UI-library/Supabase dependencies this harness
// cannot resolve.

// Must match the migration's own allowlist exactly - see
// supabase/migrations/20260824090000_managed_clients_phase2_operations.sql's
// _validate_managed_workspace_update_keys (21 fields; not restated as a
// literal count anywhere else, to avoid the two drifting).
export const EMPTY_WORKSPACE_FORM = {
  client_type: "", onboarding_stage: "", site_type: "", site_status: "", storefront_status: "",
  domain_status: "", assets_status: "", content_status: "", products_services_status: "",
  pricing_status: "", mockup_status: "", launch_readiness_status: "", preview_url: "", live_url: "",
  domain_name: "", site_repo_url: "", next_action: "", next_action_owner: "", next_action_due_at: "",
  launch_target_date: "", internal_notes: "",
};

export function workspaceRowToForm(row) {
  const form = { ...EMPTY_WORKSPACE_FORM };
  Object.keys(form).forEach((key) => {
    if (row?.[key] != null) form[key] = row[key];
  });
  if (form.next_action_due_at) form.next_action_due_at = String(form.next_action_due_at).slice(0, 10);
  return form;
}

// Only allowlisted fields are ever assembled here - matches the RPC's own
// allowlist exactly (see _validate_managed_workspace_update_keys). Empty
// string is sent as null (clears a nullable field); a select left "Not
// set" is also sent as null. Used for INIT mode, where a complete
// payload is fine (there is no prior row to clobber).
export function formToUpdates(form) {
  const updates = {};
  Object.entries(form).forEach(([key, value]) => {
    updates[key] = value === "" ? null : value;
  });
  return updates;
}

// Patch semantics for EDIT mode (post-review, blocker): sending every
// field on every save could silently rewrite an untouched value - most
// concretely, next_action_due_at is a timestamptz truncated to a date-
// only input for display (see workspaceRowToForm), so resubmitting an
// unedited date would drop any non-midnight time component the row
// actually had. Comparing against the ORIGINAL normalized form (captured
// once, before any edits) and only including a key when its current
// value differs means an untouched field is never sent at all.
export function diffWorkspaceForm(current, original) {
  const updates = {};
  Object.keys(current).forEach((key) => {
    if (current[key] !== (original ? original[key] : undefined)) {
      updates[key] = current[key] === "" ? null : current[key];
    }
  });
  return updates;
}

// Post-review (blocker/operator-consent issue): the Add Managed Brand
// wizard let an operator run a successful preflight, go Back, change any
// of these four values, and still reach Review/Provision showing the OLD
// preflight's derived slug/hostname while actually submitting the NEW
// form values - backend revalidation would catch an invalid state, but
// not a VALID one the operator never actually reviewed. This fingerprint
// covers exactly the fields admin_preview_managed_brand_provisioning
// itself reads; the wizard stores it alongside a successful preflight and
// recomputes it on every render, so any edit to a preflight-relevant
// field is detected by simple string comparison.
export function fingerprintPreviewInput(input) {
  return JSON.stringify({
    workspace_name: input?.workspace_name ?? "",
    tenant_slug: input?.tenant_slug ?? "",
    client_email: input?.client_email ?? "",
    client_name: input?.client_name ?? "",
  });
}
