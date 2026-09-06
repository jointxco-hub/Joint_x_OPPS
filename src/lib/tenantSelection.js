// Pure tenant-selection decision logic (no Supabase, no I/O — see
// tests/tenant-context-reliability.test.mjs). tenantContext.js is the thin
// I/O wrapper that fetches memberships and calls into here, mirroring the
// authIdentity.js / dataClient.getCurrentUser() split.
//
// Rules (fail closed — a write must never land on a tenant the user did
// not choose):
//
//   * No active membership at all            -> NO_ACTIVE_TENANT
//   * A saved selection that IS still an
//     active membership                       -> use it
//   * A saved selection that is NO LONGER an
//     active membership                       -> NO_ACTIVE_TENANT
//        (do not silently fall back to "some other tenant" — the old
//         behaviour, and the bug this fixes)
//   * No saved selection yet (first run)      -> adopt the first active
//     membership and report changedSelection so the caller persists it.
//     This is initialisation, not a switch.

import { OP_ERROR_CODES, createOpError } from "./opError.js";

export function normalizeActiveMemberships(rawMemberships) {
  const list = Array.isArray(rawMemberships) ? rawMemberships : [];
  return list
    .map((m) => ({
      tenantId: m?.tenant_id ?? m?.tenantId ?? m?.tenants?.id ?? null,
      tenantStatus: m?.tenants?.status ?? m?.tenant_status ?? null,
      membershipStatus: m?.status ?? null,
    }))
    .filter(
      (m) =>
        Boolean(m.tenantId) &&
        (m.membershipStatus == null || m.membershipStatus === "active") &&
        (m.tenantStatus == null || m.tenantStatus === "active"),
    );
}

// Is `tenantId` one this account may act as right now?
export function isAuthorizedTenant(rawMemberships, tenantId) {
  if (!tenantId) return false;
  return normalizeActiveMemberships(rawMemberships).some((m) => m.tenantId === tenantId);
}

// Returns { tenantId, changedSelection }.
// Throws OpError(NO_ACTIVE_TENANT) when nothing safe can be chosen.
export function selectTenantFromMemberships({ memberships, savedTenantId, operation = "resolve_tenant" } = {}) {
  const active = normalizeActiveMemberships(memberships);

  if (active.length === 0) {
    throw createOpError({
      code: OP_ERROR_CODES.NO_ACTIVE_TENANT,
      operation,
      technical: "authenticated account has zero active tenant memberships",
    });
  }

  const saved = savedTenantId || null;

  if (saved) {
    if (active.some((m) => m.tenantId === saved)) {
      return { tenantId: saved, changedSelection: false };
    }
    // Saved tenant is no longer authorised — fail closed, never switch.
    throw createOpError({
      code: OP_ERROR_CODES.NO_ACTIVE_TENANT,
      operation,
      technical: "saved tenant selection is not in the current active memberships",
    });
  }

  // First run for this identity: adopt the first active membership.
  return { tenantId: active[0].tenantId, changedSelection: true };
}

// Validate an explicit switch target. Throws OpError(NO_ACTIVE_TENANT) if
// the account is not an active member of `tenantId`.
export function validateTenantChoice({ memberships, tenantId, operation = "set_tenant" } = {}) {
  if (!isAuthorizedTenant(memberships, tenantId)) {
    throw createOpError({
      code: OP_ERROR_CODES.NO_ACTIVE_TENANT,
      operation,
      technical: `requested tenant "${tenantId}" is not an active membership for this account`,
    });
  }
  return tenantId;
}
