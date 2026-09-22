import assert from "node:assert/strict";
import test from "node:test";
import {
  teamUserIdentity,
  teamUserKey,
  findTeamUserByAuthId,
  findTeamUserByEmail,
  resolveAssignedTeamUser,
  resolveAssignedTeamUsers,
  resolveSelfProfilePatch,
  applyOfflineSelfProfilePatch,
  buildUpdatedLocalUser,
} from "../src/lib/teamUsers.js";

// src/lib/teamUsers.js is pure/Supabase-free by design (same reasoning as
// tests/auth-identity.test.mjs and tests/team-directory-normalize.test.mjs)
// so these Phase 2B identity helpers are exercised directly here.

const directory = [
  { auth_user_id: "auth-1", email: "amy@example.com", full_name: "Amy A" },
  { auth_user_id: "auth-2", email: "ben@example.com", full_name: "Ben B" },
  { auth_user_id: "auth-3", email: null, full_name: "No Email Person" },
];

test("teamUserIdentity: returns the directory member's auth_user_id", () => {
  assert.equal(teamUserIdentity(directory[0]), "auth-1");
});

test("teamUserIdentity: null when the directory member has no auth_user_id, never falls back to email", () => {
  assert.equal(teamUserIdentity({ email: "amy@example.com" }), null);
});

test("findTeamUserByAuthId: finds the exact member", () => {
  assert.equal(findTeamUserByAuthId(directory, "auth-2"), directory[1]);
});

test("findTeamUserByAuthId: null for no match or no id given", () => {
  assert.equal(findTeamUserByAuthId(directory, "auth-missing"), null);
  assert.equal(findTeamUserByAuthId(directory, null), null);
});

test("findTeamUserByEmail: case-insensitive match", () => {
  assert.equal(findTeamUserByEmail(directory, "AMY@EXAMPLE.COM"), directory[0]);
});

test("findTeamUserByEmail: null for no match or no email given", () => {
  assert.equal(findTeamUserByEmail(directory, "missing@example.com"), null);
  assert.equal(findTeamUserByEmail(directory, ""), null);
});

test("resolveAssignedTeamUser: canonical auth_user_id is preferred over legacy email", () => {
  // Deliberately mismatched email so a test that accidentally fell back
  // to email matching would resolve the WRONG person and fail loudly.
  const result = resolveAssignedTeamUser(
    { authUserId: "auth-2", email: "amy@example.com" },
    directory
  );
  assert.equal(result, directory[1]);
});

test("resolveAssignedTeamUser: falls back to legacy email only when no canonical id is present", () => {
  const result = resolveAssignedTeamUser({ authUserId: null, email: "ben@example.com" }, directory);
  assert.equal(result, directory[1]);
});

test("resolveAssignedTeamUser: unresolved legacy identity returns null, never guesses a wrong user", () => {
  const result = resolveAssignedTeamUser(
    { authUserId: null, email: "nobody@example.com" },
    directory
  );
  assert.equal(result, null);
});

test("resolveAssignedTeamUsers: array of canonical ids preferred wholesale over legacy emails", () => {
  const result = resolveAssignedTeamUsers(
    { authUserIds: ["auth-2", "auth-1"], emails: ["nobody@example.com"] },
    directory
  );
  assert.deepEqual(result, [directory[1], directory[0]]);
});

test("resolveAssignedTeamUsers: array order is preserved", () => {
  const result = resolveAssignedTeamUsers({ authUserIds: ["auth-2", "auth-1"] }, directory);
  assert.deepEqual(result.map((u) => u.auth_user_id), ["auth-2", "auth-1"]);
});

test("resolveAssignedTeamUsers: falls back to legacy email array only when id array is empty", () => {
  const result = resolveAssignedTeamUsers(
    { authUserIds: [], emails: ["ben@example.com", "amy@example.com"] },
    directory
  );
  assert.deepEqual(result, [directory[1], directory[0]]);
});

// ── Partial-array-resolution regression (production-proven bug) ────────
// A prior version of resolveAssignedTeamUsers() trusted a non-empty id
// array WHOLESALE and never looked at the email array again - so a
// legacy row with 2 assignees, where the backfill migration only
// resolved 1 of them to a real auth_user_id, silently dropped the
// second person from every display/selection surface. Confirmed against
// production: ops_tasks alone has 19 legacy assignee entries, 16
// resolving, with at least one task where 2 legacy assignees have only
// 1 resolving. These tests pin the fix: position-by-position resolution,
// with an explicit unresolved placeholder (never a silent drop) for any
// position whose id is missing/unmatched AND whose email doesn't match
// anyone in the directory either.

test("resolveAssignedTeamUsers: [valid auth id, null] + [valid email, unresolved legacy email] - the second person is not silently lost", () => {
  // Exactly the shape the migration's LEFT JOIN backfill produces for a
  // partially-resolvable legacy row: position 0 resolved, position 1
  // didn't (id is null) but still has its original legacy email.
  const result = resolveAssignedTeamUsers(
    { authUserIds: ["auth-1", null], emails: ["amy@example.com", "unresolved@example.com"] },
    directory
  );

  assert.equal(result.length, 2, "both people must be present, not just the one that resolved");
  assert.equal(result[0], directory[0]);
  assert.equal(result[1].unresolved, true);
  assert.equal(result[1].auth_user_id, null);
  assert.equal(result[1].email, "unresolved@example.com");
});

test("resolveAssignedTeamUsers: an id that exists but matches no one falls back to that position's email", () => {
  const result = resolveAssignedTeamUsers(
    { authUserIds: ["auth-1", "auth-deactivated"], emails: ["amy@example.com", "ben@example.com"] },
    directory
  );
  // auth-deactivated doesn't match anyone in `directory`, but its
  // position's email (ben@example.com) does - must resolve to Ben, not
  // an unresolved placeholder and not nothing.
  assert.deepEqual(result, [directory[0], directory[1]]);
});

test("resolveAssignedTeamUsers: a position with neither id nor email contributes nothing (not an empty placeholder)", () => {
  const result = resolveAssignedTeamUsers(
    { authUserIds: ["auth-1", null], emails: ["amy@example.com"] },
    directory
  );
  assert.deepEqual(result, [directory[0]]);
});

test("resolveAssignedTeamUsers: avoids duplicate display users when the same person resolves via id at one position and email at another", () => {
  const result = resolveAssignedTeamUsers(
    { authUserIds: ["auth-1", null], emails: ["amy@example.com", "amy@example.com"] },
    directory
  );
  assert.equal(result.length, 1);
  assert.equal(result[0], directory[0]);
});

test("resolveAssignedTeamUsers: mismatched array lengths (ids shorter than emails) still resolve every position by falling back to email", () => {
  const result = resolveAssignedTeamUsers(
    { authUserIds: ["auth-1"], emails: ["amy@example.com", "ben@example.com"] },
    directory
  );
  assert.deepEqual(result, [directory[0], directory[1]]);
});

test("resolveAssignedTeamUsers: empty input yields empty array, not an error", () => {
  assert.deepEqual(resolveAssignedTeamUsers({}, directory), []);
  assert.deepEqual(resolveAssignedTeamUsers(undefined, directory), []);
});

// ── teamUserKey: the null-vs-null collision guard ───────────────────────

test("teamUserKey: uses auth_user_id when present", () => {
  assert.equal(teamUserKey(directory[0]), "auth-1");
});

test("teamUserKey: falls back to email when auth_user_id is absent", () => {
  assert.equal(teamUserKey({ email: "x@example.com" }), "x@example.com");
});

test("teamUserKey: two different unresolved/unlinked entries never collide as the same key", () => {
  // The exact bug this guards against: comparing raw auth_user_id would
  // make these two clearly-different people compare equal (null === null).
  const unresolvedA = { auth_user_id: null, email: "a@example.com", unresolved: true };
  const unlinkedDirectoryMember = { auth_user_id: null, email: "b@example.com" };
  assert.notEqual(teamUserKey(unresolvedA), teamUserKey(unlinkedDirectoryMember));
});

// ── resolveSelfProfilePatch: true PATCH semantics ───────────────────────
// Builds the jsonb patch src/api/dataClient.js's updateMe() sends to the
// update_my_opps_profile() RPC (see
// supabase/migrations/20260921224500_opps_self_profile_update_rpc.sql).
// An earlier version of this helper (and the RPC) merged against the
// current user's existing values client-side and always sent all three
// fields - so updating only full_name silently cleared
// preferred_name/avatar_url whenever they weren't also passed. Fixed: a
// key is included in the output ONLY when the caller's payload actually
// mentioned it - the RPC's own `p_patch ? 'field_name'` check is the
// real "leave unchanged when absent" guarantee, but the client must
// still not send a field it didn't mean to touch. The RPC itself has no
// role/department/is_active/auth_user_id/user_email/tenant-role
// parameters at all - this is the client-side half of that same
// contract, not the actual security boundary.

test("resolveSelfProfilePatch: changing only full_name produces a patch with ONLY full_name - preferred_name/avatar_url are absent, not null", () => {
  const patch = resolveSelfProfilePatch({ full_name: "New Name" });
  assert.deepEqual(Object.keys(patch), ["full_name"]);
  assert.equal(patch.full_name, "New Name");
  assert.equal("preferred_name" in patch, false);
  assert.equal("avatar_url" in patch, false);
});

test("resolveSelfProfilePatch: changing only the avatar produces a patch with ONLY avatar_url - full_name/preferred_name are absent", () => {
  const patch = resolveSelfProfilePatch({ profile_photo: "https://example.com/new.png" });
  assert.deepEqual(Object.keys(patch), ["avatar_url"]);
  assert.equal(patch.avatar_url, "https://example.com/new.png");
  assert.equal("full_name" in patch, false);
  assert.equal("preferred_name" in patch, false);
});

test("resolveSelfProfilePatch: an explicit null for a nullable field is an intentional clear, kept as a present key with value null", () => {
  const patch = resolveSelfProfilePatch({ preferred_name: null });
  assert.equal("preferred_name" in patch, true);
  assert.equal(patch.preferred_name, null);
  // Nothing else was mentioned, so nothing else is present.
  assert.deepEqual(Object.keys(patch), ["preferred_name"]);
});

test("resolveSelfProfilePatch: privileged keys (role, department, is_active, user_email, auth_user_id) can never enter the patch", () => {
  const patch = resolveSelfProfilePatch({
    full_name: "New Name",
    role: "admin",
    department: "management",
    is_active: false,
    user_email: "attacker@example.com",
    auth_user_id: "someone-elses-id",
  });
  assert.deepEqual(Object.keys(patch), ["full_name"]);
  assert.equal("role" in patch, false);
  assert.equal("department" in patch, false);
  assert.equal("is_active" in patch, false);
  assert.equal("user_email" in patch, false);
  assert.equal("auth_user_id" in patch, false);
});

test("resolveSelfProfilePatch: name/profile_photo aliases are accepted and mapped to the canonical keys", () => {
  const patch = resolveSelfProfilePatch({ name: "Aliased Name", avatar_url: "https://example.com/a.png" });
  assert.equal(patch.full_name, "Aliased Name");
  assert.equal(patch.avatar_url, "https://example.com/a.png");
});

test("resolveSelfProfilePatch: no relevant fields present yields an empty patch, not an error", () => {
  assert.deepEqual(resolveSelfProfilePatch({}), {});
  assert.deepEqual(resolveSelfProfilePatch({ role: "admin" }), {});
});

// ── updateMe()'s local/cache mapping cannot change identity or ─────────
// ── privilege-bearing fields from the caller payload ────────────────────
// dataClient.auth.updateMe() itself is IO-bound (imports supabase), so it
// isn't unit-tested directly here - these are the two pure functions it
// delegates ALL local-cache construction to (applyOfflineSelfProfilePatch
// for the offline/unconfigured-client branch, buildUpdatedLocalUser for
// the online/post-RPC branch). Proving these two never let identity or
// privilege-bearing fields through is equivalent to proving updateMe()
// itself can't, since updateMe() no longer constructs the local cache
// object any other way.

test("applyOfflineSelfProfilePatch: an attacker-shaped payload cannot set email/role/department/is_active/auth_user_id/user_email locally", () => {
  const maliciousPatch = resolveSelfProfilePatch({
    full_name: "New Name",
    email: "attacker@example.com",
    role: "admin",
    department: "management",
    is_active: false,
    auth_user_id: "someone-elses-id",
    user_email: "attacker@example.com",
  });
  const currentUser = {
    email: "real@example.com",
    role: "member",
    department: "production",
    is_active: true,
    auth_user_id: "real-auth-id",
    user_email: "real@example.com",
  };

  const result = applyOfflineSelfProfilePatch(currentUser, maliciousPatch);

  assert.equal(result.full_name, "New Name");
  assert.equal(result.email, "real@example.com");
  assert.equal(result.role, "member");
  assert.equal(result.department, "production");
  assert.equal(result.is_active, true);
  assert.equal(result.auth_user_id, "real-auth-id");
  assert.equal(result.user_email, "real@example.com");
});

test("applyOfflineSelfProfilePatch: preserves every existing local field it doesn't touch", () => {
  const currentUser = { id: "u1", email: "real@example.com", full_name: "Old Name", role: "member" };
  const result = applyOfflineSelfProfilePatch(currentUser, { avatar_url: "https://example.com/a.png" });
  assert.equal(result.id, "u1");
  assert.equal(result.email, "real@example.com");
  assert.equal(result.full_name, "Old Name");
  assert.equal(result.role, "member");
  assert.equal(result.avatar_url, "https://example.com/a.png");
  assert.equal(result.profile_photo, "https://example.com/a.png");
});

test("applyOfflineSelfProfilePatch: an empty patch changes nothing", () => {
  const currentUser = { email: "real@example.com", full_name: "Old Name" };
  assert.deepEqual(applyOfflineSelfProfilePatch(currentUser, {}), currentUser);
});

test("buildUpdatedLocalUser: email always comes from the pre-existing user, never from the RPC result or a payload", () => {
  const user = { email: "real@example.com", full_name: "Old Name" };
  // `saved` shaped as if an RPC response somehow carried an email field -
  // it must still never win, because buildUpdatedLocalUser doesn't even
  // read email off `saved`.
  const saved = { full_name: "New Name", email: "attacker@example.com" };
  const result = buildUpdatedLocalUser({ user, saved });
  assert.equal(result.email, "real@example.com");
  assert.equal(result.full_name, "New Name");
});

test("buildUpdatedLocalUser: has no payload parameter at all, so privileged fields cannot flow through even if present on `saved`", () => {
  const user = { email: "real@example.com", role: "member", department: "production", is_active: true };
  // The real RPC's return type can never actually carry these (it's
  // narrowed to id/auth_user_id/full_name/preferred_name/avatar_url/
  // updated_at) - this proves the JS mapping doesn't propagate them
  // even in the hypothetical case that `saved` carried extra keys.
  const saved = { full_name: "New Name", role: "admin", department: "management", is_active: false };
  const result = buildUpdatedLocalUser({ user, saved });
  assert.equal(result.role, "member");
  assert.equal(result.department, "production");
  assert.equal(result.is_active, true);
});

test("buildUpdatedLocalUser: falls back to the existing user's fields when saved is null (patch was empty, RPC not called)", () => {
  const user = { email: "real@example.com", full_name: "Existing", preferred_name: "Pref", avatar_url: "https://example.com/a.png" };
  const result = buildUpdatedLocalUser({ user, saved: null });
  assert.equal(result.email, "real@example.com");
  assert.equal(result.full_name, "Existing");
  assert.equal(result.preferred_name, "Pref");
  assert.equal(result.avatar_url, "https://example.com/a.png");
});
