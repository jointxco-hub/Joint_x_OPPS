import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const MIGRATION = "supabase/migrations/20260823140000_managed_clients_control_plane.sql";
const PAGE = "src/pages/ManagedClients.jsx";

// ─────────────────────────────────────────────────────────────────────
// Static source-inspection tests, matching the pattern already used by
// tests/client-products-source-identity-uniqueness.test.mjs (this repo
// has no live-database test harness reachable from `node --test`). These
// guard the migration/page's committed shape against a specific set of
// pre-production-review findings on PR #35 - not a live re-execution.
// ─────────────────────────────────────────────────────────────────────

test("modern_rows only merges a workspace row when BOTH client_id AND tenant_id match (not client_id alone)", async () => {
  const source = await readSource(MIGRATION);
  assert.match(
    source,
    /left join public\.managed_client_workspaces w on w\.client_id = pc\.id and w\.tenant_id = mt\.id/i,
    "the workspace join must require tenant_id = mt.id, matching the table's real (tenant_id, client_id) uniqueness - client_id alone would silently absorb a tenant-mismatched workspace row into the wrong modern tenant"
  );
});

test("legacy_rows exclusion uses the identical (client_id, tenant_id) key as the modern_rows join, so a mismatched workspace is never dropped", async () => {
  const source = await readSource(MIGRATION);
  assert.match(
    source,
    /where not exists\s*\(\s*select 1\s*from tenant_primary_client pc\s*where pc\.id = w\.client_id and pc\.tenant_id = w\.tenant_id\s*\)/i,
    "exclusion from the legacy set must require both pc.id = w.client_id AND pc.tenant_id = w.tenant_id"
  );
});

test("legacy rows always project tenant_id as null - never the workspace's own raw tenant_id", async () => {
  const source = await readSource(MIGRATION);
  const legacyBlock = source.match(/legacy_rows as \(([\s\S]*?)\n {2}\)/i)?.[1] ?? "";
  assert.match(legacyBlock, /'tenant_id',\s*null::uuid/i, "a legacy-only row must never claim a Commerce-eligible tenant identity, even the workspace's own (possibly Joint-X, possibly mismatched) tenant_id");
});

test("modern_tenants requires structural managed-brand evidence, not slug naming alone", async () => {
  const source = await readSource(MIGRATION);
  const cteBlock = source.match(/modern_tenants as \(([\s\S]*?)\n {2}\),/i)?.[1] ?? "";
  assert.match(cteBlock, /exists \(select 1 from public\.clients c where c\.tenant_id = t\.id\)/i, "must require a linked public.clients row");
  assert.match(cteBlock, /surface in \('xos_admin', 'storefront'\)/i, "must check for a real managed-surface tenant_domain");
  assert.match(cteBlock, /tc\.enabled = true/i, "must check for an enabled tenant_capabilities row as an alternative positive signal");
});

test("the access projection resolves email via coalesce(public.users, auth.users) and returns only email/role/status", async () => {
  const source = await readSource(MIGRATION);
  assert.match(
    source,
    /'email',\s*coalesce\(u\.user_email,\s*au\.email\)/i,
    "a real active tenant_memberships row (e.g. GSB's owner) must not be misrepresented as unknown just because no public.users profile row exists yet"
  );
  // Scope the check to the jsonb_build_object(...) call itself, not the
  // surrounding subquery/joins - auth_user_id legitimately appears in the
  // JOIN ON conditions above it (that's how the email gets resolved at
  // all), which is not the same as returning it in the output.
  const outputBlock = source.match(/jsonb_build_object\(\s*'email',[\s\S]*?'status',\s*m\.status\s*\)/i)?.[0] ?? "";
  assert.ok(outputBlock, "expected to find the access entry's jsonb_build_object call");
  assert.ok(!/auth_user_id/i.test(outputBlock), "must never return auth_user_id");
  assert.ok(!/token|password|provider|raw_app_meta|raw_user_meta/i.test(outputBlock), "must never return auth tokens/provider/metadata internals");
});

test("tenant_status is part of the allowlisted projection for both modern and legacy rows", async () => {
  const source = await readSource(MIGRATION);
  assert.match(source, /'tenant_status',\s*mt\.status/i, "modern rows must expose the tenant's own active/inactive status, distinct from workspace site_status");
  assert.match(source, /'tenant_status',\s*null::text/i, "legacy-only rows have no tenant, so tenant_status must be null there too");
});

test("the already-applied Phase 0/1 migration (20260823140000) still never defines admin_update_managed_client_workspace", async () => {
  // Phase 2 (see supabase/migrations/20260824090000_managed_clients_phase2_operations.sql
  // and tests/managed-clients-phase2-operations.test.mjs) deliberately
  // REINTRODUCES this RPC as a NEW migration, once a real caller (the
  // "Edit Workspace" dialog) exists - so this test no longer asserts the
  // RPC is absent from the whole codebase (that's now false and correct
  // to be false). What must remain true forever is that the ALREADY-
  // APPLIED Phase 0/1 file itself was never retroactively edited to add
  // it - production migrations are immutable once applied.
  const source = await readSource(MIGRATION);
  assert.ok(
    !/create (or replace )?function public\.admin_update_managed_client_workspace/i.test(source),
    "the write RPC must not be defined in the Phase 0/1 migration file itself"
  );
  assert.ok(
    !/grant execute on function public\.admin_update_managed_client_workspace/i.test(source),
    "no grant for the write RPC should be present in the Phase 0/1 migration file either"
  );
});

test("the detail page never renders CommerceProductsSection for a row without a genuine modern tenant identity", async () => {
  const source = await readSource(PAGE);
  assert.match(
    source,
    /function isCommerceEligible\(row\)\s*\{\s*return Boolean\(row\.tenant_id\)\s*&&\s*\(row\.source === "modern" \|\| row\.source === "both"\);\s*\}/,
    "Commerce eligibility must require row.tenant_id AND source in ('modern','both') - a legacy-only row's client still belongs to the Joint X tenant, so onboarding from it would create Commerce state under the wrong tenant"
  );
  assert.match(source, /isCommerceEligible\(row\)\s*\?\s*\(\s*row\.client_id && <CommerceProductsSection/, "CommerceProductsSection must be gated behind isCommerceEligible(row), not just row.client_id");
  assert.match(source, /Commerce onboarding becomes available after this legacy workspace is reconciled to a dedicated managed tenant\./, "a legacy-only row must show the explanatory read-only message instead of Add product");
});
