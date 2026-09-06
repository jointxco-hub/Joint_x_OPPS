import { supabase } from "@/lib/supabaseClient";
import { createRetryableMemo } from "@/lib/asyncMemo";
import { OP_ERROR_CODES, createOpError } from "@/lib/opError";
import { selectTenantFromMemberships, validateTenantChoice } from "@/lib/tenantSelection";

// Canonical saved tenant selection. This localStorage key IS the store —
// there is no second tenant-selection mechanism in the app, so
// setCurrentTenantId() writes here and nowhere else.
const TENANT_CACHE_KEY = "jx_current_tenant";

// ── memoised membership I/O ─────────────────────────────────────────────
// We memoise the *round trip* (getUser + tenant_memberships query), NOT
// the final tenant id. Concurrent callers still share one request; a
// FAILED request is never cached (createRetryableMemo clears itself on
// rejection) so a transient network blip no longer poisons every later
// call until a reload; and per-call selection — which can differ, e.g.
// after a switch changed the saved id — always runs on the fresh snapshot.
async function fetchMembershipContext() {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    throw createOpError({
      code: OP_ERROR_CODES.TENANT_CONTEXT_UNRESOLVED,
      operation: "resolve_tenant",
      technical: `auth.getUser failed: ${authError.message || authError}`,
    });
  }
  const authUserId = authData?.user?.id || null;
  if (!authUserId) {
    // Not signed in — legitimately "no tenant", not an error.
    return { authUserId: null, memberships: [] };
  }

  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, tenants!inner(id, slug, status)")
    .eq("auth_user_id", authUserId)
    .eq("status", "active");

  if (error) {
    throw createOpError({
      code: OP_ERROR_CODES.TENANT_CONTEXT_UNRESOLVED,
      operation: "resolve_tenant",
      technical: `tenant_memberships query failed: ${error.message || error}`,
    });
  }

  return { authUserId, memberships: data || [] };
}

const membershipMemo = createRetryableMemo(fetchMembershipContext);

function readSavedTenantId() {
  try {
    return window.localStorage.getItem(TENANT_CACHE_KEY);
  } catch {
    return null;
  }
}

function writeSavedTenantId(tenantId) {
  try {
    window.localStorage.setItem(TENANT_CACHE_KEY, tenantId);
  } catch {
    // private mode / storage disabled — the selection just won't persist
  }
}

// Drop the memoised membership round trip. The next getCurrentTenantId() /
// setCurrentTenantId() re-fetches. Cheap and safe to call often.
export function resetTenantContext() {
  membershipMemo.reset();
}

// Resolve the tenant id for the current identity.
//
// Returns null ONLY when there is no Supabase client (SSR/build) or the
// user is not signed in — both are expected "no tenant" states.
//
// Otherwise throws a typed OpError:
//   TENANT_CONTEXT_UNRESOLVED (retriable) — the membership lookup failed;
//       the memo has already cleared, so calling again simply retries and
//       no full app reload is needed.
//   NO_ACTIVE_TENANT (not retriable) — no active membership, or the saved
//       selection is no longer authorised. Never silently falls back to a
//       different tenant (that fallback was the bug).
export async function getCurrentTenantId() {
  if (!supabase) return null;

  const { authUserId, memberships } = await membershipMemo.get();
  if (!authUserId) return null;

  const { tenantId, changedSelection } = selectTenantFromMemberships({
    memberships,
    savedTenantId: readSavedTenantId(),
    operation: "resolve_tenant",
  });

  if (changedSelection) writeSavedTenantId(tenantId);
  return tenantId;
}

// Explicitly switch the active tenant. Validates the target against the
// current active memberships (never trusts the caller), persists it to the
// one canonical store, and invalidates the memo so the next
// tenant-scoped operation resolves the newly selected tenant.
//
// Throws OpError(NO_ACTIVE_TENANT) if the account is not an active member
// of `tenantId`.
export async function setCurrentTenantId(tenantId) {
  if (!supabase) return null;
  if (!tenantId) {
    throw createOpError({
      code: OP_ERROR_CODES.NO_ACTIVE_TENANT,
      operation: "set_tenant",
      technical: "setCurrentTenantId called without a tenant id",
    });
  }

  const { memberships } = await membershipMemo.get();
  validateTenantChoice({ memberships, tenantId, operation: "set_tenant" });

  writeSavedTenantId(tenantId);
  resetTenantContext();
  return tenantId;
}

// ── auth lifecycle ─────────────────────────────────────────────────────
// Reset the memo on identity-changing events so a sign-out then a
// different account signing in the same tab can't keep serving the first
// account's memberships.
//
// TOKEN_REFRESHED / USER_UPDATED are deliberately NOT reset triggers: a
// same-user token refresh must not disrupt a live session, and the
// saved-tenant validation in selectTenantFromMemberships already catches
// "saved tenant no longer valid" the next time it runs. Resetting on
// every refresh would also risk a churn loop.
if (supabase) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" || event === "SIGNED_IN" || event === "INITIAL_SESSION") {
      resetTenantContext();
    }
  });
}
