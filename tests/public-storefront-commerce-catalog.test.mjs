import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const MIGRATION = "supabase/migrations/20260828090000_public_storefront_commerce_catalog.sql";
const SQL_TEST_SUITE = "supabase/tests/public_storefront_commerce_catalog.sql";
const EXISTING_HOST_ROUTING = "supabase/migrations/202606210008_tenant_host_routing.sql";
const EXISTING_STOREFRONT_BACKEND = "supabase/migrations/202606270008_tenant_storefront_catalog_backend.sql";

// ─────────────────────────────────────────────────────────────────────
// Static source-inspection tests, matching the convention used by
// tests/managed-clients-phase3-site-builds.test.mjs (this repo has no
// live-database test harness reachable from `node --test`).
// ─────────────────────────────────────────────────────────────────────

test("resolve_public_storefront_tenant already exists and is reused, not duplicated or modified", async () => {
  const existingSource = await readSource(EXISTING_STOREFRONT_BACKEND);
  assert.match(existingSource, /create or replace function public\.resolve_public_storefront_tenant\(p_hostname text\)/, "the pre-existing resolver must still exist unmodified in its own file");

  const newSource = await readSource(MIGRATION);
  assert.ok(!/create (or replace )?function public\.resolve_public_storefront_tenant/.test(newSource), "this migration must never redefine resolve_public_storefront_tenant");
  assert.match(newSource, /select t\.id\s*\n\s*from public\.resolve_public_storefront_tenant\(p_hostname\) resolved/, "the new internal helper must CALL the existing resolver, not re-derive its predicate");
});

test("the new internal tenant resolver is never exposed to anon/authenticated", async () => {
  const source = await readSource(MIGRATION);
  assert.match(source, /create function public\._resolve_public_commerce_tenant\(p_hostname text\)/);
  const revokeBlock = source.match(/revoke all on function public\._resolve_public_commerce_tenant\(text\)[\s\S]*?(?=\n\n|create function)/)?.[0] ?? "";
  assert.match(revokeBlock, /revoke all on function public\._resolve_public_commerce_tenant\(text\) from public;/);
  assert.match(revokeBlock, /revoke all on function public\._resolve_public_commerce_tenant\(text\) from anon;/);
  assert.match(revokeBlock, /revoke all on function public\._resolve_public_commerce_tenant\(text\) from authenticated;/);
  assert.ok(!/grant execute on function public\._resolve_public_commerce_tenant/.test(source), "the internal resolver must never itself be granted to any role");
});

test("both public RPCs are SECURITY DEFINER, hardened search_path, and explicitly schema-qualify commerce tables", async () => {
  const source = await readSource(MIGRATION);
  for (const name of ["get_public_storefront_products_for_host", "get_public_storefront_product_for_host", "_public_storefront_products_projection"]) {
    const fn = source.match(new RegExp(`create function public\\.${name}\\([^)]*\\)[\\s\\S]*?\\$\\$;`))?.[0] ?? "";
    assert.ok(fn, `expected to find create function public.${name}(...)`);
    assert.match(fn, /security definer/);
    assert.match(fn, /set search_path to 'pg_catalog', 'public'/);
  }
  const projectionFn = source.match(/create function public\._public_storefront_products_projection[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(projectionFn, /from commerce\.products/, "must explicitly schema-qualify commerce.products");
  assert.match(projectionFn, /from commerce\.product_variants/, "must explicitly schema-qualify commerce.product_variants");
});

test("public catalog RPCs are granted to anon AND authenticated, revoked from public first", async () => {
  const source = await readSource(MIGRATION);
  for (const name of ["get_public_storefront_products_for_host(text, integer)", "get_public_storefront_product_for_host(text, text)"]) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const block = source.match(new RegExp(`revoke all on function public\\.${escaped}[\\s\\S]*?(?=\\n\\n|-- =====)`))?.[0] ?? "";
    assert.match(block, /revoke all on function public\..*from public;/);
    assert.match(block, /revoke all on function public\..*from anon;/);
    assert.match(block, /revoke all on function public\..*from authenticated;/);
    assert.match(block, /grant execute on function public\..*to anon;/);
    assert.match(block, /grant execute on function public\..*to authenticated;/);
  }
});

test("migration never grants direct SELECT on commerce tables and never touches their existing RLS/policies", async () => {
  const source = await readSource(MIGRATION);
  assert.ok(!/grant select on commerce\./i.test(source), "no direct table grant on any commerce.* table may exist");
  assert.ok(!/create policy/i.test(source), "this migration adds no RLS policies - the two SECURITY DEFINER RPCs remain the only path, matching XOS 3A's zero-policy pattern");
  assert.ok(!/alter table commerce\./i.test(source), "must not alter any existing commerce.* table");
});

test("public projection filters status = 'published' only, never draft/archived, and never returns status/tenant_id/source fields", async () => {
  const source = await readSource(MIGRATION);
  const projectionFn = source.match(/create function public\._public_storefront_products_projection[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(projectionFn, /status = 'published'/);
  assert.ok(!/'status', p\.status/.test(projectionFn), "status must never be included in the returned jsonb object");
  assert.ok(!/'tenant_id'|'source_system'|'source_ref'/.test(projectionFn), "no internal/tenant/source field may appear in the returned jsonb object");
  // Only the allowlisted product fields may appear as jsonb keys.
  const allowedProductFields = ["id", "slug", "name", "description", "price", "sale_price", "currency", "primary_image_url", "availability", "variants"];
  const keyMatches = [...projectionFn.matchAll(/'(\w+)',\s*p\.\w+/g)].map((m) => m[1]);
  for (const key of keyMatches) {
    assert.ok(allowedProductFields.includes(key), `unexpected product field '${key}' returned - not in the safe allowlist`);
  }
  const allowedVariantFields = ["id", "sku", "title", "size", "color", "price_override", "availability", "sort_order"];
  const variantKeyMatches = [...projectionFn.matchAll(/'(\w+)',\s*pv\.\w+/g)].map((m) => m[1]);
  for (const key of variantKeyMatches) {
    assert.ok(allowedVariantFields.includes(key), `unexpected variant field '${key}' returned - not in the safe allowlist`);
  }
});

test("list and detail RPCs both call the SAME shared projection helper - cannot drift", async () => {
  const source = await readSource(MIGRATION);
  const listFn = source.match(/create function public\.get_public_storefront_products_for_host[\s\S]*?\$\$;/)?.[0] ?? "";
  const detailFn = source.match(/create function public\.get_public_storefront_product_for_host[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(listFn, /_public_storefront_products_projection\(v_tenant_id, null, p_limit\)/);
  assert.match(detailFn, /_public_storefront_products_projection\(v_tenant_id, v_slug, null\)/);
});

test("both public RPCs require the Products capability enabled for the resolved tenant, with a generic denial message", async () => {
  const source = await readSource(MIGRATION);
  const listFn = source.match(/create function public\.get_public_storefront_products_for_host[\s\S]*?\$\$;/)?.[0] ?? "";
  const detailFn = source.match(/create function public\.get_public_storefront_product_for_host[\s\S]*?\$\$;/)?.[0] ?? "";
  for (const fn of [listFn, detailFn]) {
    assert.match(fn, /from public\.tenant_capabilities/);
    assert.match(fn, /capability_key = 'products'/);
    assert.match(fn, /Storefront catalog is not available\./);
  }
});

test("neither public RPC accepts a tenant_id/client_id parameter - hostname (and slug for detail) only", async () => {
  const source = await readSource(MIGRATION);
  assert.match(source, /create function public\.get_public_storefront_products_for_host\(\s*\n\s*p_hostname text,\s*\n\s*p_limit integer default 50\s*\n\)/);
  assert.match(source, /create function public\.get_public_storefront_product_for_host\(\s*\n\s*p_hostname text,\s*\n\s*p_slug text\s*\n\)/);
});

test("deterministic ordering: products ordered by name+id, variants by sort_order+id, both with explicit tie-breakers", async () => {
  const source = await readSource(MIGRATION);
  assert.match(source, /order by p\.name asc, p\.id asc/, "product-level ordering must have an id tie-breaker after the non-unique name column");
  assert.match(source, /order by pv\.sort_order nulls last, pv\.id asc/, "variant-level ordering must have an id tie-breaker after the non-unique, nullable sort_order column");
});

test("limit is always clamped (never a raw, unbounded, or negative value reaches the query)", async () => {
  const source = await readSource(MIGRATION);
  assert.match(source, /greatest\(1, least\(coalesce\(p_limit, 50\), 100\)\)/);
});

test("public storefront and XOS admin catalog are architecturally distinct - the new RPCs never call resolve_authenticated_tenant_host, and existing host-routing infra is untouched", async () => {
  const migrationSource = await readSource(MIGRATION);
  // Strip whole-line `--` comments first - the file's own header
  // legitimately explains BY NAME why resolve_authenticated_tenant_host
  // is not reused here; only actual RPC-body code may never call it.
  const codeOnly = migrationSource.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  assert.ok(!/resolve_authenticated_tenant_host/.test(codeOnly), "the public catalog's actual RPC code must never resolve tenant via the authenticated/membership-gated resolver");
  const hostRoutingSource = await readSource(EXISTING_HOST_ROUTING);
  assert.match(hostRoutingSource, /create or replace function public\.resolve_authenticated_tenant_host/, "the existing authenticated resolver must remain untouched in its own file");
});

test("SQL test suite never uses GSB as a write fixture - only disposable tenants", async () => {
  const source = await readSource(SQL_TEST_SUITE);
  assert.ok(!/4e0f1fa4-3149-40fa-a3f8-00ec251a2c11/.test(source), "GSB's tenant id must never appear in this disposable suite at all - not even for a read-only reference, since this phase does not touch GSB");
  assert.match(source, /insert into public\.tenants \(slug, name, status\)/);
  assert.match(source, /rollback;\s*$/);
});

test("SQL test suite covers cross-tenant isolation, draft/archived exclusion, and grant-model checks (privilege introspection, not impersonation)", async () => {
  const source = await readSource(SQL_TEST_SUITE);
  assert.match(source, /tenant_a_storefront_never_receives_tenant_b_products/);
  assert.match(source, /draft_product_excluded/);
  assert.match(source, /archived_product_excluded/);
  assert.match(source, /has_function_privilege\('anon', 'public\.get_public_storefront_products_for_host/);
  assert.match(source, /has_table_privilege\('anon', 'commerce\.products', 'SELECT'\)/);
});
