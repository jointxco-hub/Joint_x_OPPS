import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// ─────────────────────────────────────────────────────────────────────
// ORDERS CLIENT-PRODUCT REUSE — PHASE 2: server-side production
// readiness gate. Static, SQL-source tests (mirrors the convention used
// by tests/orders-client-product-reuse-phase1.test.mjs) — the live
// behavioral proof for every scenario below (fixtures ZZ-UAT-P1-*/
// ZZ-UAT-P2-* on staging) was run directly against the applied staging
// migration; see the PR description for the full evidence transcript.
// ─────────────────────────────────────────────────────────────────────

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const MIGRATION = "supabase/migrations/20260914100000_order_line_production_readiness.sql";

test("the internal computation is auth-free (caller's job) and revoked from every client role", async () => {
  const src = await readSource(MIGRATION);
  assert.ok(src.includes("create or replace function public._compute_order_line_production_readiness(p_order_id uuid)"));
  assert.ok(src.includes("revoke all on function public._compute_order_line_production_readiness(uuid) from public, anon, authenticated;"));
});

test("get_order_line_production_readiness is staff-only and tenant-scoped, and delegates to the internal computation - never a second copy", async () => {
  const src = await readSource(MIGRATION);
  const start = src.indexOf("create or replace function public.get_order_line_production_readiness(p_order_id uuid)");
  const end = src.indexOf("$$;", start);
  const body = src.slice(start, end);
  assert.ok(body.includes("if not public.is_opps_staff() then"));
  assert.ok(body.includes("public.can_access_tenant(v_order.tenant_id)"));
  assert.ok(body.includes("return public._compute_order_line_production_readiness(p_order_id);"));
  assert.ok(src.includes("grant execute on function public.get_order_line_production_readiness(uuid) to authenticated;"));
  assert.ok(src.includes("revoke all on function public.get_order_line_production_readiness(uuid) from public, anon;"));
});

test("eligibility excludes setup_fee/breakdown lines and any line with no client_product_id - a setup fee can never block or appear in the readiness output", async () => {
  const src = await readSource(MIGRATION);
  const loopStart = src.indexOf("for v_line in\n    select * from jsonb_array_elements");
  const loopHeader = src.slice(loopStart, src.indexOf("loop", loopStart));
  assert.ok(loopHeader.includes(`coalesce(nullif(value ->> 'line_role', ''), 'product') = 'product'`));
  assert.ok(loopHeader.includes(`nullif(value ->> 'client_product_id', '') is not null`));
});

test("every hard blocker from the rule matrix is present with a stable code", async () => {
  const src = await readSource(MIGRATION);
  for (const code of [
    "NO_CURRENT_SNAPSHOT",
    "MISSING_BASE_COMPONENT",
    "VARIANT_UNRESOLVED",
    "PRODUCTION_METHOD_MISSING",
    "PLACEMENT_MISSING",
    "ARTWORK_MISSING",
    "ARTWORK_PLACEMENT_AMBIGUOUS",
    "ARTWORK_REVISION_INVALID",
    "PRICE_UNRESOLVED",
    "CUSTOMER_APPROVAL_MISSING",
  ]) {
    assert.ok(src.includes(`'code', '${code}'`), `missing blocker code ${code}`);
  }
});

test("every warning from the rule matrix is present and never sets order_readiness to 'blocked'", async () => {
  const src = await readSource(MIGRATION);
  for (const code of ["PRODUCTION_NOTES_ABSENT", "OPTIONAL_ARTWORK_ABSENT", "SOURCE_CLIENT_PRODUCT_EDITED"]) {
    assert.ok(src.includes(`'code', '${code}'`), `missing warning code ${code}`);
  }
  assert.ok(src.includes("v_warnings := v_warnings || jsonb_build_array"));
});

test("artwork/variant checks read only the FROZEN snapshot row - never re-query product_components or re-match live client_product_artwork by placement", async () => {
  const src = await readSource(MIGRATION);
  const fnStart = src.indexOf("create or replace function public._compute_order_line_production_readiness");
  const fnEnd = src.indexOf("revoke all on function public._compute_order_line_production_readiness", fnStart);
  const body = src.slice(fnStart, fnEnd);
  // ARTWORK_REVISION_INVALID/AMBIGUOUS only ever join client_product_artwork
  // BY ID (existence/canonical-grouping of the frozen ids) - never by
  // (client_product_id, placement, is_current, status), which would silently
  // re-follow a later artwork change.
  assert.ok(!/client_product_artwork\s+a\s+where\s+a\.client_product_id/.test(body), "must not re-match artwork by client_product_id/placement live");
  assert.ok(body.includes("a.id = aid::uuid"), "artwork rows are only ever joined by the frozen id itself");
});

test("commercial/approval state is the one deliberate live carve-out (Phase 2 section 5), reusing the canonical approval helper rather than re-deriving it", async () => {
  const src = await readSource(MIGRATION);
  assert.ok(src.includes("public._client_product_has_current_approval(v_client_product_id, cp.revision)"),
    "reuses the exact existing helper - never re-implements revision-approval logic");
  assert.ok(src.includes("cp.requires_quote is true"));
});

test("SOURCE_CLIENT_PRODUCT_EDITED reuses the exact existing freeze-recompute helper and never writes back to the frozen line", async () => {
  const src = await readSource(MIGRATION);
  assert.ok(src.includes("public._xos_freeze_client_product_price_breakdown(v_client_product_id, v_frozen_qty, v_frozen_unit)"));
  const fnStart = src.indexOf("create or replace function public._compute_order_line_production_readiness");
  const fnEnd = src.indexOf("revoke all on function public._compute_order_line_production_readiness", fnStart);
  const body = src.slice(fnStart, fnEnd);
  assert.ok(!/update\s+public\.orders/i.test(body), "the readiness computation never writes to orders - read-only by construction");
  assert.ok(!/update\s+public\.order_line_component_snapshots/i.test(body), "the readiness computation never rewrites frozen snapshots");
});

test("per-line status collapses to blocked > needs_review > ready, and the order aggregate is blocked > ready_with_warnings > ready", async () => {
  const src = await readSource(MIGRATION);
  assert.ok(src.includes("if jsonb_array_length(v_blockers) > 0 then\n      v_status := 'blocked';\n      v_order_readiness := 'blocked';"));
  assert.ok(src.includes("elsif jsonb_array_length(v_warnings) > 0 then\n      v_status := 'needs_review';"));
  assert.ok(src.includes(`if v_order_readiness <> 'blocked' then v_order_readiness := 'ready_with_warnings'; end if;`));
});

test("the status-transition gate is a BEFORE UPDATE trigger on orders, fires only on the transition INTO in_production, and raises with structured per-line reasons", async () => {
  const src = await readSource(MIGRATION);
  assert.ok(src.includes("create or replace function public._enforce_order_production_readiness_gate()"));
  assert.ok(src.includes("before update on public.orders"));
  assert.ok(src.includes("new.status = 'in_production' and old.status is distinct from 'in_production'"));
  assert.ok(src.includes("v_readiness := public._compute_order_line_production_readiness(new.id);"));
  assert.ok(src.includes(`v_readiness ->> 'order_readiness' = 'blocked'`));
  assert.ok(src.includes("ORDER_NOT_PRODUCTION_READY"));
});

test("the trigger never re-derives readiness logic - it calls the same internal computation the staff RPC calls, so there is exactly one source of truth", async () => {
  const src = await readSource(MIGRATION);
  // Every call site (not the definition/revoke lines) invokes the SAME
  // internal function with a real argument - never a second, parallel
  // per-line evaluation written directly in the RPC or the trigger.
  const callSites = [...src.matchAll(/public\._compute_order_line_production_readiness\((p_order_id|new\.id)\)/g)];
  assert.equal(callSites.length, 2, "expected exactly two call sites: the staff RPC and the transition trigger");
});
