import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const RPC_MIGRATION = "supabase/migrations/20260912090000_public_tracking_item_image_precedence.sql";

function withoutComments(s) {
  return s
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

// Root cause: the tracker's items[].image_url only ever read the order
// line's own raw image_url field, never the configured Client Product's
// primary_mockup_url (a separate, already customer-safe field). This
// migration adds a precedence: client product mockup (tenant-verified,
// https-only) -> line's own image_url (https-only) -> omitted.

test("get_public_order_tracking_for_host: image precedence prefers the tenant-verified client product mockup over the line's own image_url", async () => {
  const s = await src(RPC_MIGRATION);
  const cpIdx = s.indexOf("cp_match.primary_mockup_url");
  const itemImageIdx = s.indexOf("item ->> 'image_url'", cpIdx);
  assert.ok(cpIdx > -1, "checks the client product mockup");
  assert.ok(itemImageIdx > cpIdx, "the line's own image_url is checked only as a fallback, after the client product mockup");
});

test("get_public_order_tracking_for_host: client product match requires BOTH client_products.tenant_id and clients.tenant_id to agree with the order's own tenant", async () => {
  const s = await src(RPC_MIGRATION);
  const exec = withoutComments(s);
  assert.ok(exec.includes("cp.tenant_id = o.tenant_id"), "client_products.tenant_id checked directly");
  assert.ok(exec.includes("cl.tenant_id = o.tenant_id"), "clients.tenant_id independently re-checked (client_products.tenant_id alone is not trusted)");
  assert.ok(exec.includes("join public.clients cl on cl.id = cp.client_id"), "clients row is actually joined, not assumed");
});

test("get_public_order_tracking_for_host: client_product_id is validated as a UUID shape before casting (never a raw ::uuid cast on unchecked input)", async () => {
  const s = await src(RPC_MIGRATION);
  const exec = withoutComments(s);
  assert.ok(/\(item ->> 'client_product_id'\) ~\* '\^\[0-9a-f\]\{8\}-/.test(exec),
    "regex-guards client_product_id before the ::uuid cast, so a malformed/absent id never raises");
});

test("get_public_order_tracking_for_host: both image sources are re-validated as https, neither column is trusted as pre-safe", async () => {
  const s = await src(RPC_MIGRATION);
  const exec = withoutComments(s);
  const httpsChecks = exec.match(/~\* '\^https:\/\/'/g) || [];
  assert.ok(httpsChecks.length >= 2, "both the client product mockup and the line's own image_url are https-guarded");
});

test("get_public_order_tracking_for_host: gallery_images is a forward-compatible array of {safe_url, label, sort_order}, derived from the resolved image only", async () => {
  const s = await src(RPC_MIGRATION);
  const exec = withoutComments(s);
  assert.ok(exec.includes("'gallery_images'"), "gallery_images key present in the projection");
  assert.ok(exec.includes("'safe_url', resolved.image_url"));
  assert.ok(exec.includes("'label', null::text"), "no real multi-image label source exists yet - explicitly null, not fabricated");
  assert.ok(exec.includes("'sort_order', 0"));
  assert.ok(exec.includes("when resolved.image_url is not null"), "empty array when no image resolved, never a null/undefined entry");
});

test("get_public_order_tracking_for_host: does NOT join client_product_artwork or order_line_component_snapshots (deferred - no safe public URL path exists yet)", async () => {
  const s = await src(RPC_MIGRATION);
  const exec = withoutComments(s);
  for (const forbidden of ["client_product_artwork", "order_line_component_snapshots", "artwork_revision_ids", "file_path"]) {
    assert.ok(!exec.includes(forbidden), `must not reference ${forbidden} - no anon-safe resolution path exists for it yet`);
  }
});

test("get_public_order_tracking_for_host: every pre-existing key/value from the tracker-items migration is preserved verbatim", async () => {
  const s = await src(RPC_MIGRATION);
  for (const kv of [
    "'id', o.id", "'client_name', o.client_name", "'order_number', o.order_number", "'status', o.status",
    "'pipeline_stage', o.pipeline_stage", "'production_method', o.production_method",
    "'production_detail_stage', o.production_detail_stage", "'production_client_update', o.production_client_update",
    "'due_date', o.due_date", "'courier', o.courier", "'tracking_number', o.tracking_number",
    "'pep_code', o.pep_code", "'portal_message', o.portal_message", "'portal_attention_items', o.portal_attention_items",
    "'portal_show_files', false", "'portal_show_balance', o.portal_show_balance",
    "'portal_visible_file_urls', jsonb_build_array()", "'invoice_files', jsonb_build_array()",
    "'total_amount', o.total_amount", "'deposit_paid', o.deposit_paid",
    "'product_name', nullif(btrim(coalesce(item ->> 'name', '')), '')",
    "'line_total', case",
  ]) {
    assert.ok(s.includes(kv), `missing pre-existing field/value: ${kv}`);
  }
  assert.ok(s.includes("coalesce(item ->> 'line_role', 'product') <> 'breakdown'"), "breakdown-line exclusion preserved");
  assert.ok(s.includes("grant execute on function public.get_public_order_tracking_for_host(text, text) to anon, authenticated;"),
    "grants re-issued, unchanged signature");
});

test("get_public_order_tracking_for_host: no destructive statements, no RLS change, no other table's data mutated", async () => {
  const s = await src(RPC_MIGRATION);
  assert.ok(!/drop column|drop table|truncate|^\s*update\s|^\s*delete\s/im.test(s), "read-only function replacement, no mutation");
  assert.ok(!/create policy|drop policy|enable row level security/i.test(s), "no RLS change");
});
