import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = "supabase/migrations/20261007124500_print_prep_handoff_v01.sql";

async function readSource() {
  return (await readFile(new URL(`../${MIGRATION}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

test("Print Prep handoff is staff-only and tenant-scoped", async () => {
  const src = await readSource();
  assert.ok(src.includes("if not public.is_opps_staff() then"));
  assert.ok(src.includes("public.can_access_tenant(v_order.tenant_id)"));
  assert.ok(src.includes("grant execute on function public.get_print_prep_handoff(uuid, text, uuid) to authenticated;"));
});

test("handoff only reads the current frozen snapshot and never live product_components", async () => {
  const src = await readSource();
  assert.ok(src.includes("from public.order_line_component_snapshots"));
  assert.ok(src.includes("and is_current = true"));
  assert.ok(!src.includes("from public.product_components"));
  assert.ok(!/update\s+public\./i.test(src));
  assert.ok(!/insert\s+into\s+public\./i.test(src));
});

test("handoff reuses the canonical production-readiness computation", async () => {
  const src = await readSource();
  assert.ok(src.includes("public._compute_order_line_production_readiness(p_order_id)"));
  assert.ok(src.includes("PRINT_PREP_HANDOFF_BLOCKED"));
});

test("handoff rejects non-print snapshots and carries frozen artwork revision ids", async () => {
  const src = await readSource();
  assert.ok(src.includes("PRINT_PREP_HANDOFF_NOT_PRINT_COMPONENT"));
  assert.ok(src.includes("'revision_ids', to_jsonb(coalesce(v_snapshot.artwork_revision_ids"));
  assert.ok(src.includes("from public.client_product_artwork a"));
  assert.ok(src.includes("where a.id = any (v_snapshot.artwork_revision_ids)"));
});

test("handoff contract is software-agnostic and does not expose Corel identity as canonical data", async () => {
  const src = await readSource();
  assert.ok(src.includes("'contract_version', '0.1'"));
  assert.ok(src.includes("'snapshot_id', v_snapshot.id"));
  assert.ok(src.includes("'piece_quantity', v_piece_qty"));
  assert.ok(!src.includes("StaticID"));
  assert.ok(!src.includes("CSL"));
});
