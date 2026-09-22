import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveEmployeeIdentityMode,
  deriveMyRoleSummary,
  deriveRoleCardView,
  resolveMyTagRoleKeys,
  shouldQueryOrderTags,
  matchesUserRoleAssignment,
} from "../src/lib/employeeIdentity.js";

// src/lib/employeeIdentity.js is pure/Supabase-free by design (same
// reasoning as tests/team-identity-phase2b.test.mjs) so these Phase 2C
// identity/derivation helpers are exercised directly here.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rlsMigrationSql = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20260922100500_opps_employee_hub_phase2c_rls.sql"),
  "utf8"
);
const identityMigrationSql = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20260922100000_opps_employee_hub_phase2c_identity.sql"),
  "utf8"
);

// ── resolveEmployeeIdentityMode ─────────────────────────────────────────

test("resolveEmployeeIdentityMode: canonical when both authUserId and tenantId are present", () => {
  const result = resolveEmployeeIdentityMode({ authUserId: "auth-1", tenantId: "tenant-1", userEmail: "a@example.com" });
  assert.deepEqual(result, { mode: "canonical", authUserId: "auth-1", tenantId: "tenant-1" });
});

test("resolveEmployeeIdentityMode: falls back to legacy email when tenantId is missing", () => {
  const result = resolveEmployeeIdentityMode({ authUserId: "auth-1", tenantId: null, userEmail: "a@example.com" });
  assert.deepEqual(result, { mode: "legacy", userEmail: "a@example.com" });
});

test("resolveEmployeeIdentityMode: falls back to legacy email when authUserId is missing", () => {
  const result = resolveEmployeeIdentityMode({ authUserId: null, tenantId: "tenant-1", userEmail: "a@example.com" });
  assert.deepEqual(result, { mode: "legacy", userEmail: "a@example.com" });
});

test("resolveEmployeeIdentityMode: mode 'none' when nothing is known at all", () => {
  assert.deepEqual(resolveEmployeeIdentityMode({}), { mode: "none" });
  assert.deepEqual(resolveEmployeeIdentityMode(), { mode: "none" });
});

test("resolveEmployeeIdentityMode: two different unresolved people never collide as the same canonical identity", () => {
  // Both people lack an auth_user_id/tenant_id (e.g. two different
  // unresolved legacy rows). Neither may ever resolve to
  // { mode: 'canonical', authUserId: null, ... } - that would make two
  // unrelated "nobody" identities compare as equal to any caller
  // downstream that checks e.g. result.authUserId === result.authUserId.
  const personA = resolveEmployeeIdentityMode({ authUserId: null, tenantId: null, userEmail: "amy@example.com" });
  const personB = resolveEmployeeIdentityMode({ authUserId: null, tenantId: null, userEmail: "ben@example.com" });
  assert.equal(personA.mode, "legacy");
  assert.equal(personB.mode, "legacy");
  assert.notEqual(personA.userEmail, personB.userEmail);
  assert.equal("authUserId" in personA, false);
  assert.equal("authUserId" in personB, false);
});

// ── deriveMyRoleSummary ──────────────────────────────────────────────────

test("deriveMyRoleSummary: picks the row flagged is_primary as primaryRole", () => {
  const assignments = [
    { role_key: "designer", is_primary: false, roles: { name: "Designer" } },
    { role_key: "va", is_primary: true, roles: { name: "VA" } },
  ];
  const { primaryRole } = deriveMyRoleSummary(assignments);
  assert.equal(primaryRole.name, "VA");
});

test("deriveMyRoleSummary: falls back to the first assignment when none is flagged primary", () => {
  const assignments = [
    { role_key: "designer", is_primary: false, roles: { name: "Designer" } },
    { role_key: "va", is_primary: false, roles: { name: "VA" } },
  ];
  const { primaryRole } = deriveMyRoleSummary(assignments);
  assert.equal(primaryRole.name, "Designer");
});

test("deriveMyRoleSummary: empty assignments yields null primaryRole, empty roleKeys, null supportsQbr", () => {
  assert.deepEqual(deriveMyRoleSummary([]), { primaryRole: null, roleKeys: [], supportsQbr: null });
  assert.deepEqual(deriveMyRoleSummary(), { primaryRole: null, roleKeys: [], supportsQbr: null });
});

test("deriveMyRoleSummary: roleKeys is the deduped set of every role_key held, not just the primary one", () => {
  const assignments = [
    { role_key: "designer", is_primary: true, roles: { name: "Designer" } },
    { role_key: "va", is_primary: false, roles: { name: "VA" } },
    { role_key: "designer", is_primary: false, roles: { name: "Designer" } },
  ];
  const { roleKeys } = deriveMyRoleSummary(assignments);
  assert.deepEqual([...roleKeys].sort(), ["designer", "va"]);
});

test("deriveMyRoleSummary: supportsQbr reflects the primary role's roles.supports_qbr flag", () => {
  const supports = deriveMyRoleSummary([{ role_key: "designer", is_primary: true, roles: { supports_qbr: true } }]);
  assert.equal(supports.supportsQbr, true);
  const doesNot = deriveMyRoleSummary([{ role_key: "counter_staff", is_primary: true, roles: { supports_qbr: false } }]);
  assert.equal(doesNot.supportsQbr, false);
});

test("deriveMyRoleSummary: a null joined roles object does not crash and yields null primaryRole", () => {
  const { primaryRole, supportsQbr } = deriveMyRoleSummary([{ role_key: "designer", is_primary: true, roles: null }]);
  assert.equal(primaryRole, null);
  assert.equal(supportsQbr, null);
});

// ── deriveRoleCardView ───────────────────────────────────────────────────

test("deriveRoleCardView: null role yields null", () => {
  assert.equal(deriveRoleCardView(null), null);
  assert.equal(deriveRoleCardView(undefined), null);
});

test("deriveRoleCardView: maps the real schema fields (emoji, not icon; no focus_areas)", () => {
  const view = deriveRoleCardView({ name: "Designer", emoji: "\u{1F3A8}", color: "#fff", purpose: "Make things look good", icon: "should-be-ignored", focus_areas: ["should", "be", "ignored"] });
  assert.deepEqual(view, { name: "Designer", emoji: "\u{1F3A8}", color: "#fff", purpose: "Make things look good" });
  assert.equal("icon" in view, false);
  assert.equal("focus_areas" in view, false);
});

// ── resolveMyTagRoleKeys ─────────────────────────────────────────────────

test("resolveMyTagRoleKeys: dedupes and drops falsy entries", () => {
  assert.deepEqual(resolveMyTagRoleKeys(["designer", "va", "designer", null, undefined, ""]), ["designer", "va"]);
});

test("resolveMyTagRoleKeys: no roles at all yields an empty array (usable directly as an enabled gate)", () => {
  assert.deepEqual(resolveMyTagRoleKeys([]), []);
  assert.deepEqual(resolveMyTagRoleKeys(), []);
  assert.deepEqual(resolveMyTagRoleKeys(null), []);
});

// ── shouldQueryOrderTags — correction: My Tags requires a resolved tenantId ──

test("shouldQueryOrderTags: false when tenantId is missing, even with role_keys present", () => {
  assert.equal(shouldQueryOrderTags({ roleKeys: ["designer"], tenantId: null }), false);
  assert.equal(shouldQueryOrderTags({ roleKeys: ["designer"], tenantId: undefined }), false);
  assert.equal(shouldQueryOrderTags({ roleKeys: ["designer"] }), false);
});

test("shouldQueryOrderTags: false when role_keys is empty, even with a tenantId", () => {
  assert.equal(shouldQueryOrderTags({ roleKeys: [], tenantId: "tenant-1" }), false);
  assert.equal(shouldQueryOrderTags({ tenantId: "tenant-1" }), false);
});

test("shouldQueryOrderTags: true only once both role_keys and tenantId are present", () => {
  assert.equal(shouldQueryOrderTags({ roleKeys: ["designer"], tenantId: "tenant-1" }), true);
});

test("shouldQueryOrderTags: dedupe/falsy-filtering of role_keys still applies before the tenantId check", () => {
  assert.equal(shouldQueryOrderTags({ roleKeys: [null, undefined, ""], tenantId: "tenant-1" }), false);
});

// ── matchesUserRoleAssignment — correction: tenant-scoped role assignment ──
// ── derivation must not cross tenants ────────────────────────────────────

test("matchesUserRoleAssignment: same auth_user_id but a DIFFERENT tenant_id is not a match", () => {
  const row = { auth_user_id: "auth-1", tenant_id: "tenant-cafe", user_email: "amy@example.com" };
  assert.equal(matchesUserRoleAssignment(row, { authUserId: "auth-1", email: "amy@example.com", tenantId: "tenant-joint-x" }), false);
});

test("matchesUserRoleAssignment: same email but a DIFFERENT tenant_id is not a match - a tenant mismatch is always disqualifying, even if the email matches", () => {
  const row = { auth_user_id: null, tenant_id: "tenant-cafe", user_email: "amy@example.com" };
  assert.equal(matchesUserRoleAssignment(row, { authUserId: null, email: "amy@example.com", tenantId: "tenant-joint-x" }), false);
});

test("matchesUserRoleAssignment: same auth_user_id and same tenant_id is a match", () => {
  const row = { auth_user_id: "auth-1", tenant_id: "tenant-joint-x", user_email: "amy@example.com" };
  assert.equal(matchesUserRoleAssignment(row, { authUserId: "auth-1", email: "amy@example.com", tenantId: "tenant-joint-x" }), true);
});

test("matchesUserRoleAssignment: prefers auth_user_id over email when both sides have one, even if the email happens to differ (e.g. a stale cached email)", () => {
  const row = { auth_user_id: "auth-1", tenant_id: "tenant-joint-x", user_email: "old-address@example.com" };
  assert.equal(matchesUserRoleAssignment(row, { authUserId: "auth-1", email: "new-address@example.com", tenantId: "tenant-joint-x" }), true);
});

test("matchesUserRoleAssignment: falls back to normalized email comparison when either side lacks an auth_user_id", () => {
  const row = { auth_user_id: null, tenant_id: "tenant-joint-x", user_email: "Amy@Example.com" };
  assert.equal(matchesUserRoleAssignment(row, { authUserId: null, email: "amy@example.com", tenantId: "tenant-joint-x" }), true);
});

test("matchesUserRoleAssignment: an unresolved row (tenant_id null) stays a candidate match - recoverable, not silently excluded", () => {
  const row = { auth_user_id: "auth-1", tenant_id: null, user_email: "amy@example.com" };
  assert.equal(matchesUserRoleAssignment(row, { authUserId: "auth-1", email: "amy@example.com", tenantId: "tenant-joint-x" }), true);
});

test("matchesUserRoleAssignment: no row, or no identifying info on either side, never matches", () => {
  assert.equal(matchesUserRoleAssignment(null, { authUserId: "auth-1", tenantId: "tenant-1" }), false);
  assert.equal(matchesUserRoleAssignment({ user_email: "amy@example.com" }, {}), false);
});

// ── RLS migration text — regression guards for the corrected policies ────
// The corrections in this round change SQL that runs in Postgres, which
// this test environment cannot execute (no live database - "Do not run
// Supabase" is a standing constraint for this whole engagement). These
// assertions read the migration file's own text as the next best
// regression guard: if a future edit reverts a corrected clause, these
// fail loudly instead of the regression only surfacing during a live
// staging/production RLS review.

function policyBlock(sql, policyName) {
  const start = sql.indexOf(`create policy ${policyName}`);
  assert.notEqual(start, -1, `policy ${policyName} not found in the RLS migration`);
  const end = sql.indexOf(";", start);
  return sql.slice(start, end);
}

function assertEveryOwnershipCheckIsTenantQualified(block, policyName) {
  const ownershipOccurrences = (block.match(/auth_user_id = auth\.uid\(\)/g) || []).length;
  const qualifiedOccurrences = (block.match(/auth_user_id = auth\.uid\(\) and tenant_id is not null and public\.can_access_tenant\(tenant_id\)/g) || []).length;
  assert.ok(ownershipOccurrences > 0, `${policyName} should reference auth_user_id = auth.uid() at least once`);
  // Every appearance of the raw ownership check must be the tenant-
  // qualified compound form - not just "at least one qualified branch
  // exists somewhere", which would miss a regression where a bare,
  // unqualified auth_user_id = auth.uid() branch was reintroduced
  // ALONGSIDE the correct one.
  assert.equal(qualifiedOccurrences, ownershipOccurrences, `${policyName} has an auth_user_id = auth.uid() occurrence that is NOT tenant-qualified (tenant_id is not null and can_access_tenant(tenant_id))`);
}

test("RLS migration: user_roles self-read requires BOTH auth_user_id ownership AND active tenant membership, not auth_user_id alone (closes the asymmetry from the previous round)", () => {
  assertEveryOwnershipCheckIsTenantQualified(policyBlock(rlsMigrationSql, "opps_user_roles_read"), "opps_user_roles_read");
});

test("RLS migration: qbrs self-access branches require BOTH auth_user_id ownership AND active tenant membership, not auth_user_id alone", () => {
  for (const policy of ["opps_qbrs_read", "opps_qbrs_insert", "opps_qbrs_update", "opps_qbrs_delete"]) {
    assertEveryOwnershipCheckIsTenantQualified(policyBlock(rlsMigrationSql, policy), policy);
  }
});

test("RLS migration: weekly_scores self-access branches require BOTH auth_user_id ownership AND active tenant membership", () => {
  for (const policy of ["opps_weekly_scores_read", "opps_weekly_scores_insert", "opps_weekly_scores_update", "opps_weekly_scores_delete"]) {
    assertEveryOwnershipCheckIsTenantQualified(policyBlock(rlsMigrationSql, policy), policy);
  }
});

test("RLS migration: unresolved (tenant_id is null) rows are gated by is_app_admin(), not the broad is_opps_staff(), on every read/update/delete policy", () => {
  for (const policy of [
    "opps_user_roles_read", "opps_user_roles_update", "opps_user_roles_delete",
    "opps_qbrs_read", "opps_qbrs_update", "opps_qbrs_delete",
    "opps_weekly_scores_read", "opps_weekly_scores_update", "opps_weekly_scores_delete",
  ]) {
    const block = policyBlock(rlsMigrationSql, policy);
    assert.match(block, /tenant_id is null and public\.is_app_admin\(\)/, `${policy} must fall back to is_app_admin() for unresolved rows`);
    assert.doesNotMatch(block, /tenant_id is null and public\.is_opps_staff\(\)/, `${policy} must not use the broad is_opps_staff() fallback`);
  }
});

test("RLS migration: no INSERT policy has a tenant_id-is-null branch at all - unresolved rows are never insertable, only reconcilable via UPDATE", () => {
  for (const policy of ["opps_user_roles_insert", "opps_qbrs_insert", "opps_weekly_scores_insert"]) {
    const block = policyBlock(rlsMigrationSql, policy);
    assert.doesNotMatch(block, /tenant_id is null/, `${policy} must not permit inserting a tenant_id-null row for anyone, including admins`);
  }
});

// ── Identity migration text — user_roles constraint model ────────────────
// Same reasoning as the RLS text guards above: the actual enforcement
// happens in Postgres, which this environment cannot execute against
// ("Do not run Supabase" is a standing constraint) - these assertions
// read the migration file's own text as the regression guard.
//
// The intended model, in plain terms: the SAME person holding the SAME
// operational role in TWO DIFFERENT tenants must be ALLOWED (that's the
// entire reason user_roles gained a tenant_id column) - it must NOT be
// blocked by a global, tenant-blind uniqueness rule the way the original
// unique(user_email, role_key) constraint would have blocked it.

test("identity migration: the original global unique(user_email, role_key) constraint is dropped", () => {
  assert.match(
    identityMigrationSql,
    /drop constraint if exists user_roles_user_email_role_key_key/,
    "the global user_roles_user_email_role_key_key constraint must be dropped - it conflicts with the tenant-aware model"
  );
});

test("identity migration: the tenant-aware unique index (tenant_id, auth_user_id, role_key) still governs canonical rows", () => {
  assert.match(
    identityMigrationSql,
    /create unique index if not exists user_roles_tenant_auth_role_key_key[\s\S]*?on public\.user_roles \(tenant_id, auth_user_id, role_key\)[\s\S]*?where tenant_id is not null and auth_user_id is not null/,
    "user_roles_tenant_auth_role_key_key must still exist, scoped to (tenant_id, auth_user_id, role_key) for canonical rows only"
  );
});

test("identity migration: a narrow compatibility index protects ONLY unresolved rows (auth_user_id or tenant_id still null), not canonical ones", () => {
  assert.match(
    identityMigrationSql,
    /create unique index if not exists user_roles_unresolved_email_role_key_key[\s\S]*?on public\.user_roles \(lower\(user_email\), role_key\)[\s\S]*?where \(auth_user_id is null or tenant_id is null\) and user_email is not null/,
    "the compatibility index must be scoped to (auth_user_id is null or tenant_id is null) and user_email is not null - it must not apply to fully-canonical rows"
  );
});

test("identity migration: no remaining global/unconditional unique(user_email, role_key) constraint that would block the same email+role across two tenants", () => {
  // A bare "unique (user_email, role_key)" with no WHERE clause, in
  // actual SQL (not prose explaining the OLD constraint being dropped -
  // this file's comments legitimately mention that shape by name), would
  // mean a global rule survived the correction. Strip comment lines
  // first so only executable SQL is checked - this is the direct check
  // that "canonical identical email+role assignments in two different
  // tenants are allowed" holds structurally, not just that the one
  // specific old constraint's name was dropped.
  const sqlOnly = identityMigrationSql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const bareGlobalConstraint = /unique\s*\(\s*user_email\s*,\s*role_key\s*\)/i;
  assert.doesNotMatch(
    sqlOnly,
    bareGlobalConstraint,
    "no unconditional unique(user_email, role_key) constraint may exist in executable SQL - it would block the same person holding the same role in two tenants"
  );
});

test("identity migration: pre-flight verification query for the compatibility index exists, so production safety is checkable before the migration runs, not assumed", () => {
  assert.match(
    identityMigrationSql,
    /group by lower\(user_email\), role_key[\s\S]*?having count\(\*\) > 1/,
    "a pre-flight duplicate-check query (grouped by lower(user_email), role_key) must be present for production verification before this migration runs"
  );
});
