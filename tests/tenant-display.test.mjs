import assert from "node:assert/strict";
import test from "node:test";
import { buildTenantsById, getTenantDisplayMeta } from "../src/lib/tenantDisplay.js";

// ─────────────────────────────────────────────────────────────────────
// XOS 2.7A - OPPS tenant-identity display helper.
//
// Display only - order.tenant_id -> tenants.id is the sole authority,
// enforced by RLS (unchanged by this PR). This file never touches
// order_number, storefront_host, or source, and performs no
// authorization of its own - these tests exist to prove exactly that.
// ─────────────────────────────────────────────────────────────────────

const GSB_TENANT = { id: "gsb-uuid", name: "God's Spoilt Brat", slug: "gsb", settings: { order_prefix: "GSB" } };
const NO_PREFIX_TENANT = { id: "no-prefix-uuid", name: "Kingdom Merch", slug: "kingdom-merch", settings: {} };
const tenantsById = buildTenantsById([GSB_TENANT, NO_PREFIX_TENANT]);

test("1. GSB tenant with order_prefix GSB resolves label GSB", () => {
  const order = { tenant_id: "gsb-uuid", order_number: "GSB-2026-617215" };
  const meta = getTenantDisplayMeta(order, tenantsById);
  assert.equal(meta.label, "GSB");
  assert.equal(meta.name, "God's Spoilt Brat");
  assert.equal(meta.slug, "gsb");
  assert.equal(meta.unknown, false);
});

test("2. a historical XL-prefixed GSB order still resolves the GSB badge from tenant_id, not from the order number", () => {
  const historicalOrder = { tenant_id: "gsb-uuid", order_number: "XL-2026-725826" };
  const meta = getTenantDisplayMeta(historicalOrder, tenantsById);
  assert.equal(meta.label, "GSB", "the badge must come from tenant_id, completely independent of the XL- prefix on this historical order");
  assert.equal(meta.name, "God's Spoilt Brat");
});

test("3. missing/invalid order_prefix falls back to a compact, uppercase, slug-derived label - never blank, never the full slug unmodified", () => {
  const order = { tenant_id: "no-prefix-uuid" };
  const meta = getTenantDisplayMeta(order, tenantsById);
  assert.equal(meta.label, "KING", "expected a compact (<=4 char) uppercase slug-derived fallback");
  assert.equal(meta.name, "Kingdom Merch");
  assert.equal(meta.unknown, false);
});

test("3b. an order_prefix that doesn't match the required shape is treated as absent, not rendered as-is", () => {
  const badPrefixTenant = { id: "bad-uuid", name: "Bad Prefix Co", slug: "bad-prefix-co", settings: { order_prefix: "this is not a valid prefix!!" } };
  const map = buildTenantsById([badPrefixTenant]);
  const meta = getTenantDisplayMeta({ tenant_id: "bad-uuid" }, map);
  assert.equal(meta.label, "BADP", "must fall back to the slug-derived label rather than rendering an invalid prefix");
});

test("4. unknown/missing tenant_id degrades safely and visibly - no raw UUID, no crash", () => {
  const noTenantId = getTenantDisplayMeta({ order_number: "GSB-2026-000001" }, tenantsById);
  assert.equal(noTenantId.label, "—");
  assert.equal(noTenantId.unknown, true);
  assert.ok(!/^[0-9a-f]{8}-/.test(noTenantId.label), "label must never look like a UUID");

  const unresolvedTenantId = getTenantDisplayMeta({ tenant_id: "does-not-exist-in-map" }, tenantsById);
  assert.equal(unresolvedTenantId.label, "—");
  assert.equal(unresolvedTenantId.unknown, true);

  // No crash on a missing/undefined lookup map either.
  assert.doesNotThrow(() => getTenantDisplayMeta({ tenant_id: "gsb-uuid" }, undefined));
  assert.doesNotThrow(() => getTenantDisplayMeta(null, tenantsById));
  assert.doesNotThrow(() => getTenantDisplayMeta(undefined, undefined));
});

test("5. the helper never reads order_number, storefront_host, or source - tenant_id is the only input that can change the result", async () => {
  const raw = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/lib/tenantDisplay.js", import.meta.url), "utf8"));
  // Strip comments first - the file's own JSDoc documents (in prose)
  // that it deliberately does NOT read these fields, which would
  // otherwise false-positive a naive substring check.
  const code = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/order_number|storefront_host|\border\.source\b/.test(code), "tenantDisplay.js's actual code (not comments) must never reference these fields - tenant_id is the sole identity input");

  // Behavioral confirmation: two orders with the same tenant_id but wildly
  // different order_number/storefront_host/source resolve identically.
  const orderA = { tenant_id: "gsb-uuid", order_number: "XL-2026-725826", storefront_host: null, source: "xlab" };
  const orderB = { tenant_id: "gsb-uuid", order_number: "GSB-2026-999999", storefront_host: "gsb-commerce-qa.jointx.co.za", source: "opps" };
  assert.deepEqual(getTenantDisplayMeta(orderA, tenantsById), getTenantDisplayMeta(orderB, tenantsById));
});

test("buildTenantsById tolerates missing/malformed input without throwing", () => {
  assert.deepEqual(buildTenantsById(undefined), {});
  assert.deepEqual(buildTenantsById(null), {});
  assert.deepEqual(buildTenantsById([{ name: "no id" }, null, undefined]), {});
});
