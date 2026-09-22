export function isAssignableTeamUser(user) {
  const role = String(user?.role || '').trim().toLowerCase();
  return Boolean(user?.email || user?.user_email) && user?.is_active !== false && role !== 'investor';
}

export function userDisplayName(user) {
  return user?.preferred_name || user?.full_name || user?.name || user?.email || user?.user_email || 'Team member';
}

export function userRoleLabel(user) {
  const role = String(user?.role || 'team').replace(/_/g, ' ');
  return role.charAt(0).toUpperCase() + role.slice(1);
}

// Phase 2B: builds the jsonb PATCH dataClient.auth.updateMe() sends to
// update_my_opps_profile() (see
// supabase/migrations/20260921224500_opps_self_profile_update_rpc.sql).
// TRUE patch semantics: a key is included ONLY when the caller's payload
// actually mentioned it (under any of its accepted aliases) - never
// merged against the current user's existing values here, because the
// RPC itself now does "key absent -> leave unchanged" server-side. An
// earlier version of this helper (and the RPC) computed a full merged
// replacement client-side, which meant updating only full_name silently
// cleared preferred_name/avatar_url whenever they weren't also passed.
//
// Only full_name/preferred_name/avatar_url can ever appear in the
// output, and only ever from these specific input keys - nothing here
// forwards an arbitrary payload key (like role/department/is_active/
// auth_user_id/user_email) into the patch, even if the caller's payload
// object happens to contain one (e.g. because it also holds unrelated
// local-cache fields). The RPC enforces this same allow-list server-side
// independently (rejecting anything else outright) - this is the
// client-side half of that same contract, not the actual security
// boundary.
//
// A key is considered "mentioned" via `!== undefined`, so an explicit
// `null` (intentionally clear a nullable field) is preserved and passed
// through, distinct from the key being absent entirely.
export function resolveSelfProfilePatch(payload = {}) {
  const patch = {};

  if (payload.full_name !== undefined || payload.name !== undefined) {
    patch.full_name = payload.full_name !== undefined ? payload.full_name : payload.name;
  }

  if (payload.preferred_name !== undefined) {
    patch.preferred_name = payload.preferred_name;
  }

  if (payload.profile_photo !== undefined || payload.avatar_url !== undefined) {
    patch.avatar_url = payload.profile_photo !== undefined ? payload.profile_photo : payload.avatar_url;
  }

  return patch;
}

// Phase 2B: the OFFLINE/unconfigured-Supabase-client branch of
// dataClient.auth.updateMe() - no server round trip is possible there,
// but the local cache must still only ever accept the same three safe
// fields the RPC would. Reads ONLY from `patch` (already filtered by
// resolveSelfProfilePatch above), never from the original caller
// payload, so email/role/department/is_active/auth_user_id/user_email
// can never reach the local cache through this path either, regardless
// of what the caller's payload object contains.
export function applyOfflineSelfProfilePatch(currentUser, patch = {}) {
  return {
    ...(currentUser ?? {}),
    ...('full_name' in patch ? { full_name: patch.full_name } : {}),
    ...('preferred_name' in patch ? { preferred_name: patch.preferred_name } : {}),
    ...('avatar_url' in patch
      ? { profile_photo: patch.avatar_url, avatar_url: patch.avatar_url }
      : {}),
  };
}

// Phase 2B: the ONLINE (post-RPC) branch's local cache update, run after
// update_my_opps_profile() succeeds (or is skipped because the patch was
// empty). `saved` is that RPC's own returned row, or null. Identity
// (email) and every privilege-bearing field (role, department, is_active,
// auth_user_id, user_email, tenant role) always come from the PRE-
// EXISTING `user` object, never from the caller's raw payload and never
// from `saved` - which structurally cannot carry them anyway, since the
// RPC's own return type is narrowed to id/auth_user_id/full_name/
// preferred_name/avatar_url/updated_at (see
// 20260921224500_opps_self_profile_update_rpc.sql). This function's
// signature doesn't even accept a `payload` parameter, so there is no
// way for a caller's arbitrary payload keys to reach the result.
export function buildUpdatedLocalUser({ user, saved }) {
  return {
    ...user,
    email: user.email,
    full_name: saved?.full_name ?? user.full_name,
    preferred_name: saved ? saved.preferred_name : user.preferred_name,
    profile_photo: saved?.avatar_url ?? user.profile_photo ?? user.avatar_url,
    avatar_url: saved?.avatar_url ?? user.profile_photo ?? user.avatar_url,
  };
}

// ── Phase 2B: canonical identity helpers ───────────────────────────────
// Team assignment/mention identity is moving from email to Supabase
// auth_user_id (see supabase/migrations/20260921223000_opps_team_identity_phase2b.sql).
// These are the single, reusable place that decision lives, so no call
// site hand-writes its own "compare emails" or "find by id" matching
// logic - every one of them goes through here instead.

// The value a selector/form should STORE for a directory member. Never
// falls back to email - callers that need a value even when auth_user_id
// is somehow missing must decide that explicitly, not get it silently
// from here.
export function teamUserIdentity(user) {
  return user?.auth_user_id || null;
}

// A stable "is this the same person" key for comparing two resolved
// user-ish objects (directory members, or resolveAssignedTeamUsers()
// unresolved placeholders) - NEVER compare raw auth_user_id fields
// directly for this purpose: an unresolved placeholder always has
// auth_user_id: null, and so can a genuinely active-but-not-yet-linked
// directory member, so two unrelated "nobody" values would otherwise
// compare equal. Falls back to email so distinct people are still
// distinguished even when neither has an auth_user_id yet. Returns null
// only when there is truly no identifying information at all.
export function teamUserKey(user) {
  return user?.auth_user_id || user?.email || user?.user_email || null;
}

export function findTeamUserByAuthId(users, authUserId) {
  if (!authUserId) return null;
  return (users || []).find((u) => u?.auth_user_id === authUserId) || null;
}

export function findTeamUserByEmail(users, email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  return (
    (users || []).find((u) => {
      const candidate = String(u?.email || u?.user_email || '').trim().toLowerCase();
      return candidate === normalized;
    }) || null
  );
}

// Read-side compatibility for a single assignee: prefer the canonical
// auth_user_id; only resolve the legacy email against the tenant
// directory when no canonical id is present on the record. Returns null
// if neither resolves - it never guesses, and the caller still has the
// raw authUserId/email available to display or preserve as-is (this
// helper only resolves a DIRECTORY MEMBER to show name/role/avatar for;
// it never erases or rewrites the underlying assignment data).
export function resolveAssignedTeamUser({ authUserId, email } = {}, users) {
  return findTeamUserByAuthId(users, authUserId) || findTeamUserByEmail(users, email);
}

// Same, for array assignments (ops_tasks/weekly_tasks/orders.assigned_team).
//
// Resolves POSITION BY POSITION, not "trust the id array wholesale if
// it's non-empty" - that earlier version had a real, production-proven
// bug: the Phase 2B backfill migration can only set an array element
// when the legacy email at that position actually resolves to a known
// auth_user_id. A partially-resolvable legacy row (e.g. 2 assignees,
// only 1 matches a directory account) legitimately produces a non-empty
// but SHORTER-in-effect canonical array - "non-empty, so use it and
// ignore the email array" silently dropped every unresolved person.
// Confirmed against production: ops_tasks alone has 19 legacy assignee
// entries, 16 resolving, with at least one row where 2 legacy assignees
// have only 1 resolving.
//
// Correct handling requires the id array and the email array to be the
// SAME LENGTH, position-aligned, with an explicit null in the id array
// wherever that position didn't resolve (see the migration's LEFT JOIN
// backfill) - authUserIds[i] and emails[i] must describe the same
// person. For each position: canonical id first: if present, resolve by
// id (falling back to that position's email only if the id itself
// doesn't match anyone active in the directory - e.g. deactivated/
// removed); if there is no id at that position at all, resolve by email.
// A position whose email doesn't resolve to anyone either is NOT
// dropped - it comes back as an explicit unresolved placeholder
// ({ auth_user_id: null, email, unresolved: true }) so the person still
// shows up (by their raw email) instead of silently vanishing from
// display/selection surfaces. Never invents an id. Dedupes by resolved
// identity (auth_user_id, or email for an unresolved placeholder) so the
// same person appearing via id at one position and via email at another
// doesn't show up twice.
export function resolveAssignedTeamUsers({ authUserIds, emails } = {}, users) {
  const ids = Array.isArray(authUserIds) ? authUserIds : [];
  const mails = Array.isArray(emails) ? emails : [];
  const length = Math.max(ids.length, mails.length);

  const result = [];
  const seen = new Set();

  for (let i = 0; i < length; i += 1) {
    const id = ids[i] || null;
    const email = mails[i] || null;

    const resolved = (id && findTeamUserByAuthId(users, id)) || (email && findTeamUserByEmail(users, email));

    if (resolved) {
      const key = teamUserKey(resolved);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(resolved);
      continue;
    }

    if (email) {
      // Genuinely unresolved: no id, or an id/email that matches no one
      // currently in the directory. Kept, not dropped.
      if (seen.has(email)) continue;
      seen.add(email);
      result.push({ auth_user_id: null, email, user_email: email, full_name: null, unresolved: true });
    }
    // Neither an id nor an email at this position - nothing to resolve,
    // nothing lost.
  }

  return result;
}