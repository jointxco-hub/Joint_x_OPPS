import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const MIGRATION = "supabase/migrations/20260829090000_xos_onboarding_canonical_identity.sql";
const SQL_TEST_SUITE = "supabase/tests/xos_onboarding_canonical_identity.sql";
const ORIGINAL_MIGRATION = "supabase/migrations/20260823120000_xos_3b_product_onboarding.sql";

// ─────────────────────────────────────────────────────────────────────
// Static source-inspection tests, matching the convention used by
// tests/public-storefront-commerce-catalog.test.mjs (this repo has no
// live-database test harness reachable from `node --test`).
// ─────────────────────────────────────────────────────────────────────

test("the historical XOS 3B migration file is not edited - this is a CREATE OR REPLACE in a new migration only", async () => {
  const originalSource = await readSource(ORIGINAL_MIGRATION);
  assert.match(originalSource, /create function public\.admin_onboard_client_commerce_product\(/, "the original CREATE (not CREATE OR REPLACE) must remain in its own file, untouched");
  assert.ok(!/ONBOARD_SLUG_INVALID|ONBOARD_SLUG_COLLISION|ONBOARD_SOURCE_IDENTITY_COLLISION/.test(originalSource), "the historical file must not have been edited to add the new error codes");

  const newSource = await readSource(MIGRATION);
  assert.match(newSource, /create or replace function public\.admin_onboard_client_commerce_product\(/);
});

test("a supplied non-blank slug is trimmed, format-validated, used exactly, and never auto-suffixed", async () => {
  const source = await readSource(MIGRATION);
  assert.match(source, /v_supplied_slug := nullif\(btrim\(coalesce\(p_product ->> 'slug', ''\)\), ''\);/);
  assert.match(source, /if v_supplied_slug !~ '\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$' then/, "must validate against the exact same format commerce.products' own CHECK constraint enforces");
  assert.match(source, /ONBOARD_SLUG_INVALID/);
  assert.match(source, /ONBOARD_SLUG_COLLISION/);
  assert.match(source, /v_slug := v_supplied_slug;/);
  // The supplied-slug branch must never reference v_slug_suffix (the
  // auto-suffix counter) at all - confirms structurally that a supplied
  // slug is never silently renamed.
  const suppliedBranch = source.match(/if v_supplied_slug is not null then([\s\S]*?)else/)?.[1] ?? "";
  assert.ok(suppliedBranch, "expected to find the supplied-slug branch");
  assert.ok(!/v_slug_suffix/.test(suppliedBranch), "the supplied-slug branch must never touch the auto-suffix counter");
});

test("omitted slug preserves the exact original generated-slug + numeric-suffix-on-collision behavior", async () => {
  const source = await readSource(MIGRATION);
  const generatedBranch = source.match(/else\s*\n\s*-- Unchanged from the original migration[\s\S]*?end if;\s*\n\s*\n\s*-- ---- source_system/)?.[0] ?? "";
  assert.ok(generatedBranch, "expected to find the unchanged generated-slug branch");
  assert.match(generatedBranch, /v_slug_base := lower\(regexp_replace\(v_name, '\[\^a-zA-Z0-9\]\+', '-', 'g'\)\);/);
  assert.match(generatedBranch, /while exists \(select 1 from commerce\.products where tenant_id = v_tenant_id and slug = v_slug\) loop/);
  assert.match(generatedBranch, /v_slug_suffix := v_slug_suffix \+ 1;/);
});

test("source_system/source_ref: supplied values used exactly; omitted values retain the exact original defaults", async () => {
  const source = await readSource(MIGRATION);
  assert.match(source, /v_supplied_source_system := nullif\(btrim\(coalesce\(p_product ->> 'source_system', ''\)\), ''\);/);
  assert.match(source, /v_supplied_source_ref := nullif\(btrim\(coalesce\(p_product ->> 'source_ref', ''\)\), ''\);/);
  assert.match(source, /v_final_source_system := coalesce\(v_supplied_source_system, 'xos_onboarding'\);/, "omitted source_system must still default to 'xos_onboarding'");
  assert.match(source, /v_final_source_ref := coalesce\(v_supplied_source_ref, p_idempotency_key\);/, "omitted source_ref must still default to the idempotency key");
});

test("supplied source identity collision fails clearly, both via pre-check and a race-safe unique_violation handler on the INSERT", async () => {
  const source = await readSource(MIGRATION);
  assert.match(source, /ONBOARD_SOURCE_IDENTITY_COLLISION/);
  const preCheckIdx = source.indexOf("ONBOARD_SOURCE_IDENTITY_COLLISION");
  const insertIdx = source.indexOf("insert into commerce.products (\n        tenant_id, slug, name, description, price, sale_price, currency,");
  assert.ok(preCheckIdx > -1 && insertIdx > -1 && preCheckIdx < insertIdx, "the pre-check must run BEFORE the INSERT, not only be caught reactively");
  assert.match(source, /exception when unique_violation then\s*\n\s*raise exception using errcode = 'P0001', message =\s*\n\s*format\('ONBOARD_SLUG_COLLISION: slug "%s" or source identity/, "a concurrent race must also fail with a clear message, not a raw constraint violation");
});

test("the fingerprint is unchanged - p_product's full JSON (including any slug/source_system/source_ref keys) is already covered", async () => {
  const migrationSource = await readSource(MIGRATION);
  const originalSource = await readSource(ORIGINAL_MIGRATION);
  const newFingerprint = migrationSource.match(/v_fingerprint := md5\(([\s\S]*?)\);/)?.[0] ?? "";
  const originalFingerprint = originalSource.match(/v_fingerprint := md5\(([\s\S]*?)\);/)?.[0] ?? "";
  assert.ok(newFingerprint && originalFingerprint, "expected to find the fingerprint expression in both files");
  assert.equal(newFingerprint, originalFingerprint, "the fingerprint formula must be byte-for-byte identical - no new fields were added to it, because p_product::text already includes any caller-supplied slug/source_system/source_ref");
});

test("the existing/already-linked commerce product UPDATE branch never references slug/source_system/source_ref", async () => {
  const source = await readSource(MIGRATION);
  const updateBlock = source.match(/update commerce\.products\s*\n\s*set name = case[\s\S]*?where id = v_commerce_product_id;/)?.[0] ?? "";
  assert.ok(updateBlock, "expected to find the existing-product UPDATE statement");
  assert.ok(!/\bslug\s*=/.test(updateBlock), "must never assign slug on the existing-product update path");
  assert.ok(!/source_system\s*=|source_ref\s*=/.test(updateBlock), "must never assign source_system/source_ref on the existing-product update path");
});

test("grants are restated unchanged - still authenticated only, still revoked from public/anon", async () => {
  const source = await readSource(MIGRATION);
  assert.match(source, /revoke all on function public\.admin_onboard_client_commerce_product\(uuid, jsonb, jsonb, uuid, uuid, uuid, text\) from public;/);
  assert.match(source, /revoke all on function public\.admin_onboard_client_commerce_product\(uuid, jsonb, jsonb, uuid, uuid, uuid, text\) from anon;/);
  assert.match(source, /grant execute on function public\.admin_onboard_client_commerce_product\(uuid, jsonb, jsonb, uuid, uuid, uuid, text\) to authenticated;/);
});

test("SQL test suite never references GSB and covers all 12 required scenarios", async () => {
  const source = await readSource(SQL_TEST_SUITE);
  assert.ok(!/4e0f1fa4-3149-40fa-a3f8-00ec251a2c11|fb91a2ea-5400-43a0-a0dc-2c30f1685956/.test(source), "GSB's tenant/client id must never appear anywhere in this disposable suite - not even read-only");
  for (const testName of [
    "supplied_canonical_slug_preserved_exactly",
    "supplied_source_system_and_source_ref_preserved_exactly",
    "supplied_slug_bad_format_rejected",
    "supplied_slug_collision_rejected_not_suffixed",
    "supplied_source_identity_collision_rejected",
    "omitted_slug_retains_generated_slug_with_numeric_suffix_on_collision",
    "omitted_source_fields_retain_xos_onboarding_and_idempotency_key_default",
    "identical_retry_returns_cached_result_no_duplicate_product",
    "changed_payload_same_key_still_conflicts",
    "existing_linked_product_path_never_rewrites_canonical_provenance",
    "opps_mapping_behavior_unchanged",
    "gsb_never_referenced_in_this_suite",
  ]) {
    assert.match(source, new RegExp(testName), `expected to find test '${testName}'`);
  }
  assert.match(source, /rollback;\s*$/);
});
