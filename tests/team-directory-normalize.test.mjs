import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTeamDirectoryMember } from "../src/lib/teamDirectoryNormalize.js";

// src/lib/teamDirectoryNormalize.js is pure/Supabase-free by design (same
// reasoning as tests/auth-identity.test.mjs) so it's exercised directly
// here - listOppsTeamDirectory() itself (in src/lib/teamDirectory.js) is
// the thin IO wrapper around getCurrentTenantId() + supabase.rpc(...),
// which this repo's plain `node --test` runner cannot exercise without a
// live/mocked client.

test("normalizeTeamDirectoryMember: mirrors RPC's `email` onto `user_email`", () => {
  const result = normalizeTeamDirectoryMember({ id: "u1", email: "a@example.com" });
  assert.equal(result.email, "a@example.com");
  assert.equal(result.user_email, "a@example.com");
});

test("normalizeTeamDirectoryMember: falls back to `user_email` if `email` is absent", () => {
  const result = normalizeTeamDirectoryMember({ id: "u1", user_email: "b@example.com" });
  assert.equal(result.email, "b@example.com");
  assert.equal(result.user_email, "b@example.com");
});

test("normalizeTeamDirectoryMember: prefers `email` over `user_email` when both are present but differ", () => {
  const result = normalizeTeamDirectoryMember({ email: "current@example.com", user_email: "stale@example.com" });
  assert.equal(result.email, "current@example.com");
  assert.equal(result.user_email, "current@example.com");
});

test("normalizeTeamDirectoryMember: null when neither field is present, not undefined or empty string", () => {
  const result = normalizeTeamDirectoryMember({ id: "u1", full_name: "No Email User" });
  assert.equal(result.email, null);
  assert.equal(result.user_email, null);
});

test("normalizeTeamDirectoryMember: preserves every other field untouched", () => {
  const input = {
    id: "u1",
    auth_user_id: "auth-1",
    email: "a@example.com",
    full_name: "A User",
    preferred_name: "A",
    avatar_url: null,
    department: "production",
    role: "Head of Production",
    is_active: true,
    tenant_role: "member",
    role_name: "Production Lead",
  };
  const result = normalizeTeamDirectoryMember(input);
  for (const key of Object.keys(input)) {
    if (key === "email" || key === "user_email") continue;
    assert.equal(result[key], input[key], `expected ${key} to be preserved`);
  }
});

test("normalizeTeamDirectoryMember: passes through null/undefined rows instead of throwing", () => {
  assert.equal(normalizeTeamDirectoryMember(null), null);
  assert.equal(normalizeTeamDirectoryMember(undefined), undefined);
});
