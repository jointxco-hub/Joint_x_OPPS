import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveOfflineUserFromSession,
  resolveOnlineUserFromAuthCheck,
} from "../src/lib/authIdentity.js";

// src/lib/authIdentity.js is pure/Supabase-free by design (see its header
// comment) so its decisions are exercised directly here - dataClient.js's
// getCurrentUser() is the thin IO wrapper around these that actually
// calls supabase.auth.getSession()/getUser(), which this repo's plain
// `node --test` runner cannot exercise without a live/mocked client.
//
// These cases pin the exact bug this file fixes: getCurrentUser()
// previously fell back to a stale local user cache whenever
// supabase.auth.getUser() failed for ANY reason while online, which let
// AuthContext keep reporting isAuthenticated=true (and the UI kept
// showing "logged in") long after the real Supabase session had expired
// or been revoked - every subsequent Supabase request then went out
// with only the anon key, since there was no access token to attach.

test("online + no valid Supabase session is genuinely logged out, never masked by a stale cache", () => {
  const result = resolveOnlineUserFromAuthCheck({
    authError: null,
    authUser: null,
    profile: null,
  });
  assert.equal(result.user, null);
  assert.equal(result.cacheAction, "clear");
});

test("online + a real auth error is genuinely logged out, even with a plausible cached identity nearby", () => {
  const result = resolveOnlineUserFromAuthCheck({
    authError: new Error("invalid_grant: session expired"),
    authUser: null,
    profile: null,
  });
  assert.equal(result.user, null);
  assert.equal(result.cacheAction, "clear");
});

test("online + a valid Supabase user derives the current user and writes the cache", () => {
  const result = resolveOnlineUserFromAuthCheck({
    authError: null,
    authUser: { id: "auth-1", email: "jointx.co@gmail.com", user_metadata: {} },
    profile: { full_name: "Jasper Jai", role: "admin", is_active: true },
  });
  assert.equal(result.cacheAction, "write");
  assert.equal(result.user.id, "auth-1");
  assert.equal(result.user.email, "jointx.co@gmail.com");
  assert.equal(result.user.full_name, "Jasper Jai");
  assert.equal(result.user.role, "admin");
  assert.equal(result.user.auth_user_id, "auth-1");
});

test("a real Supabase user with no matching profile row still resolves (metadata-only fallback), never treated as logged out", () => {
  const result = resolveOnlineUserFromAuthCheck({
    authError: null,
    authUser: { id: "auth-2", email: "new-staff@jointx.co", user_metadata: { full_name: "New Staff" } },
    profile: null,
  });
  assert.equal(result.cacheAction, "write");
  assert.equal(result.user.full_name, "New Staff");
  assert.equal(result.user.role, "user");
});

test("an explicitly deactivated profile is flagged revoked and clears the cache, distinct from a plain missing session", () => {
  const result = resolveOnlineUserFromAuthCheck({
    authError: null,
    authUser: { id: "auth-3", email: "revoked@jointx.co", user_metadata: {} },
    profile: { is_active: false },
  });
  assert.equal(result.user, null);
  assert.equal(result.cacheAction, "clear");
  assert.equal(result.revoked, true);
});

test("offline with a live session in local storage keeps the known identity (does not force a false logged-out state)", () => {
  const result = resolveOfflineUserFromSession({
    sessionUser: { id: "auth-1", email: "jointx.co@gmail.com", user_metadata: { full_name: "Jasper Jai" } },
    cachedUser: { role: "admin", department: "Ops" },
  });
  assert.equal(result.cacheAction, "write");
  assert.equal(result.user.id, "auth-1");
  assert.equal(result.user.role, "admin");
  assert.equal(result.user.department, "Ops");
});

test("offline with no session at all falls back to whatever was cached, without writing (nothing new to persist)", () => {
  const cachedUser = { id: "auth-1", email: "jointx.co@gmail.com" };
  const result = resolveOfflineUserFromSession({ sessionUser: null, cachedUser });
  assert.equal(result.user, cachedUser);
  assert.equal(result.cacheAction, "none");
});

test("offline with no session and no cache resolves to null, not an empty object", () => {
  const result = resolveOfflineUserFromSession({ sessionUser: null, cachedUser: null });
  assert.equal(result.user, null);
  assert.equal(result.cacheAction, "none");
});
