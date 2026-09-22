// Phase 2C: pure identity/derivation helpers for the OPPS Employee/My Hub
// system (user_roles, qbrs, weekly_scores — see
// supabase/migrations/20260922100000_opps_employee_hub_phase2c_identity.sql).
// Supabase-free by design, same reasoning as src/lib/teamUsers.js: hooks
// stay thin IO wrappers, decision logic lives here where node --test can
// exercise it directly.

// Decides which identity a query should filter by: canonical
// (auth_user_id + tenant_id) when both are known, legacy email only when
// they aren't, or 'none' when there is nothing to filter by at all (the
// caller should leave the query disabled rather than fetch everything).
//
// Deliberately never returns a canonical mode with a null authUserId —
// two different people who both lack an auth_user_id are NOT "the same
// canonical identity: null"; they fall through to the email mode (or
// 'none') instead, so no null-vs-null collision is possible here by
// construction (mirrors teamUserKey() in teamUsers.js, which exists for
// exactly this class of bug).
export function resolveEmployeeIdentityMode({ authUserId, tenantId, userEmail } = {}) {
  if (authUserId && tenantId) {
    return { mode: 'canonical', authUserId, tenantId };
  }
  if (userEmail) {
    return { mode: 'legacy', userEmail };
  }
  return { mode: 'none' };
}

// Given the caller's full set of user_roles rows (each with a joined
// `roles` object, or null if the join didn't resolve), derive the three
// things My Hub needs: the primary role for display, the list of
// role_keys for order_tags filtering, and whether the primary role's
// definition marks it as QBR-relevant (roles.supports_qbr — the one
// existing, real signal this table has for role-specific UI, not an
// invented one).
export function deriveMyRoleSummary(assignments = []) {
  const rows = Array.isArray(assignments) ? assignments : [];
  const primaryAssignment = rows.find((row) => row?.is_primary) || rows[0] || null;
  const primaryRole = primaryAssignment?.roles ?? null;
  const roleKeys = [...new Set(rows.map((row) => row?.role_key).filter(Boolean))];
  return {
    primaryRole,
    roleKeys,
    supportsQbr: primaryRole?.supports_qbr ?? null,
  };
}

// Maps a raw `roles` row onto the exact shape MyRoleCard.jsx renders.
// Exists because the live schema uses `emoji`, not `icon`, and has no
// `focus_areas` column at all — the previous query/component pair
// referenced both non-existent fields (role_id/icon/focus_areas), which
// is why "My Role" never actually rendered anything before this phase.
// Fixes the field names; does not invent new ones.
export function deriveRoleCardView(role) {
  if (!role) return null;
  return {
    name: role.name ?? null,
    emoji: role.emoji ?? null,
    color: role.color ?? null,
    purpose: role.purpose ?? null,
  };
}

// order_tags is role_key-based, not person-based (confirmed: 0 of 282
// live rows have user_email populated). Given the caller's own
// role_keys, this is the list to filter order_tags.role_key IN (...) by.
// Returns [] (not null/undefined) when the caller has no roles at all,
// so the hook consuming this can use it directly as an `enabled` gate —
// querying order_tags with an empty IN-list would just be a wasted round
// trip that always returns nothing.
export function resolveMyTagRoleKeys(roleKeys = []) {
  return [...new Set((Array.isArray(roleKeys) ? roleKeys : []).filter(Boolean))];
}

// The single source of truth for "should a my-tags query even run" -
// used as the `enabled` gate by both useMyTags.js (My Hub) and
// NotificationsPanel.jsx's own separate order_tags query, so the
// tenant-id requirement can't drift out of sync between the two
// consumers of the same table. Requires a non-empty role_keys list
// (order_tags is role-based - see resolveMyTagRoleKeys) AND a resolved
// tenantId - order_tags.tenant_id exists live and this app must not
// rely on RLS alone to keep a My Hub query scoped to one tenant.
export function shouldQueryOrderTags({ roleKeys, tenantId } = {}) {
  return resolveMyTagRoleKeys(roleKeys).length > 0 && Boolean(tenantId);
}

// RolesManagement.jsx (the admin Team Access surface) needs to decide
// "is this user_roles ROW an assignment for THIS person, in THIS
// tenant" for three things: rendering a person's role badges, computing
// which of their rows should be is_primary after a change, and deciding
// whether a brand-new assignment should default to primary. Before this
// correction all three did `row.user_email === targetEmail` with no
// tenant check at all - now that user_roles is tenant-scoped, that could
// let an action meant for the Joint X tenant accidentally read or
// recompute is_primary across a same-email row that belongs to a
// DIFFERENT tenant (the same person, two workspaces).
//
// Precedence: a tenant mismatch is always disqualifying, even if the
// email matches - a cross-tenant row for the same person must never be
// treated as "this assignment". Within a tenant-compatible row, prefer
// matching by auth_user_id (canonical) when both the row and the target
// have one; only fall back to a normalized email comparison when either
// side's auth_user_id is unresolved. A row whose own tenant_id is null
// (unresolved legacy row) is treated as tenant-compatible - it isn't yet
// excludable by tenant, and instruction requires unresolved rows stay
// visible/recoverable, not silently dropped from these comparisons.
export function matchesUserRoleAssignment(row, { authUserId, email, tenantId } = {}) {
  if (!row) return false;

  if (row.tenant_id && tenantId && row.tenant_id !== tenantId) {
    return false;
  }

  if (authUserId && row.auth_user_id) {
    return row.auth_user_id === authUserId;
  }

  const normalizedTarget = String(email || '').trim().toLowerCase();
  const normalizedRow = String(row.user_email || '').trim().toLowerCase();
  return Boolean(normalizedTarget) && normalizedTarget === normalizedRow;
}
