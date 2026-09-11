import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const IMAGE_MIGRATION = "supabase/migrations/20260913090000_public_tracking_catalog_image_precedence.sql";
const FILES_MIGRATION = "supabase/migrations/20260913100000_public_tracking_safe_files_projection.sql";

function withoutComments(s) {
  return s.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
}

// Root cause (verified live against production order ORD-MTKNJU7S, not
// guessed): OPPS's ProductsEditor renders exactly item.image_url as the
// line thumbnail; nothing else. A line created from the catalogue picker
// gets that field seeded from the catalogue item's own image, but staff
// can overwrite it per-line with a private upload - which happened here,
// so the tracker's existing https-only guard correctly hid it, with no
// fallback to the still-safe catalogue image. This migration adds that
// fallback tier.

test("catalog image precedence: checked AFTER the client-product mockup, BEFORE the line's own image_url", async () => {
  const s = await src(IMAGE_MIGRATION);
  const cpIdx = s.indexOf("cp_match.primary_mockup_url");
  const catalogIdx = s.indexOf("catalog_match.image_url", cpIdx);
  const lineIdx = s.indexOf("item ->> 'image_url'", catalogIdx);
  assert.ok(cpIdx > -1 && catalogIdx > cpIdx, "catalog tier checked after client-product tier");
  assert.ok(lineIdx > catalogIdx, "the line's own image_url is checked only after both product-level tiers");
});

test("catalog match requires products.tenant_id to agree with the order's own tenant, and identity comes only from catalog_item_id (never product name)", async () => {
  const s = await src(IMAGE_MIGRATION);
  const exec = withoutComments(s);
  assert.ok(exec.includes("p.id = (item ->> 'catalog_item_id')::uuid"));
  assert.ok(exec.includes("p.tenant_id = o.tenant_id"));
  assert.ok(!/p\.name\s*=|item ->> 'name'\)\s*=\s*p\./.test(exec), "must never match by product name/text");
});

test("catalog_item_id is validated as a UUID shape before casting", async () => {
  const s = await src(IMAGE_MIGRATION);
  const exec = withoutComments(s);
  assert.ok(/\(item ->> 'catalog_item_id'\) ~\* '\^\[0-9a-f\]\{8\}-/.test(exec));
});

test("catalog match requires store_visible = true and status = 'active'", async () => {
  const s = await src(IMAGE_MIGRATION);
  const exec = withoutComments(s);
  assert.ok(exec.includes("p.store_visible = true"));
  assert.ok(exec.includes("p.status = 'active'"));
});

test("catalog product image is still re-validated as https before use, exactly like the other two tiers", async () => {
  const s = await src(IMAGE_MIGRATION);
  const exec = withoutComments(s);
  const httpsChecks = exec.match(/~\* '\^https:\/\/'/g) || [];
  assert.ok(httpsChecks.length >= 3, "client-product, catalog, and line image_url are all https-guarded");
});

test("a custom line (no catalog_item_id, no client_product_id) matches neither lateral join and falls through to its own image_url or placeholder", async () => {
  const s = await src(IMAGE_MIGRATION);
  const exec = withoutComments(s);
  // both laterals are conditioned on a uuid-shaped id existing on the item;
  // an empty/absent catalog_item_id or client_product_id never matches the
  // regex, so cp_match/catalog_match resolve to no row (null columns) and
  // `resolved.image_url` falls through to the item's own image_url check.
  assert.ok(exec.includes("left join lateral"));
  assert.ok(exec.match(/left join lateral/g).length >= 3, "client-product tier, catalog tier, and the final resolved-image tier are each their own lateral");
});

test("no field/value from the tracker-items migration was dropped", async () => {
  const s = await src(IMAGE_MIGRATION);
  for (const kv of [
    "'id', o.id", "'order_number', o.order_number", "'status', o.status",
    "'portal_show_balance', o.portal_show_balance", "'total_amount', o.total_amount",
    "'deposit_paid', o.deposit_paid", "'product_name', nullif(btrim(coalesce(item ->> 'name', '')), '')",
    "'line_total', case",
  ]) {
    assert.ok(s.includes(kv), `missing pre-existing field/value: ${kv}`);
  }
  assert.ok(s.includes("grant execute on function public.get_public_order_tracking_for_host(text, text) to anon, authenticated;"));
});

test("no destructive statements, no RLS change", async () => {
  const s = await src(IMAGE_MIGRATION);
  assert.ok(!/drop column|drop table|truncate|^\s*update\s|^\s*delete\s/im.test(s));
  assert.ok(!/create policy|drop policy|enable row level security/i.test(s));
});

// --- files projection (20260913100000) ---

test("files projection: portal_show_files now reads the real column instead of hardcoded false", async () => {
  const s = await src(FILES_MIGRATION);
  assert.ok(s.includes("'portal_show_files', coalesce(o.portal_show_files, false)"));
  assert.ok(!s.includes("'portal_show_files', false"), "the old hardcoded false must be gone");
});

test("files projection: gated on portal_show_files, empty array when off", async () => {
  const s = await src(FILES_MIGRATION);
  assert.ok(s.includes("'files', case when coalesce(o.portal_show_files, false) then ("));
  assert.ok(s.includes("else '[]'::jsonb end"));
});

test("files projection: each entry is only name / file_ref / file_type - never a bucket, client_asset_id, or signed-url internals", async () => {
  const s = await src(FILES_MIGRATION);
  const filesBlockStart = s.indexOf("'files', case");
  const filesBlockEnd = s.indexOf("'invoice_files'", filesBlockStart);
  const block = s.slice(filesBlockStart, filesBlockEnd);
  assert.ok(block.includes("'name',"));
  assert.ok(block.includes("'file_ref', url"));
  assert.ok(block.includes("'file_type',"));
  for (const forbidden of ["bucket", "client_asset_id", "signedUrl", "createSignedUrl", "storage.objects"]) {
    assert.ok(!block.includes(forbidden), `files projection must not reference: ${forbidden}`);
  }
});

test("invoice_files stays hardcoded exactly as before - not in scope of this fix", async () => {
  const s = await src(FILES_MIGRATION);
  assert.ok(s.includes("'invoice_files', jsonb_build_array()"));
});

test("verify_public_tracker_visible_file_ref: mirrors the file ref against portal_visible_file_urls, gated on portal_show_files, tenant-resolved via host", async () => {
  const s = await src(FILES_MIGRATION);
  assert.ok(s.includes("create or replace function public.verify_public_tracker_visible_file_ref("));
  assert.ok(s.includes("coalesce(o.portal_show_files, false)"));
  assert.ok(s.includes("input.clean_ref = any(o.portal_visible_file_urls)"));
  assert.ok(s.includes("grant execute on function public.verify_public_tracker_visible_file_ref(text, text, text) to anon, authenticated;"));
});

test("verify_public_tracker_visible_file_ref returns a plain boolean, never file/order details", async () => {
  const s = await src(FILES_MIGRATION);
  const fnStart = s.indexOf("create or replace function public.verify_public_tracker_visible_file_ref(");
  const fnEnd = s.indexOf("$fn$;", s.indexOf("$fn$", fnStart) + 4) + 5;
  const body = s.slice(fnStart, fnEnd);
  assert.ok(body.includes("returns boolean"));
  assert.ok(!/jsonb_build_object|select\s+o\.\*|select\s+\*/.test(body), "must return only a boolean, never row/order data");
});

test("no other pre-existing field dropped by the files migration", async () => {
  const s = await src(FILES_MIGRATION);
  for (const kv of [
    "'id', o.id", "'order_number', o.order_number", "'status', o.status",
    "'portal_show_balance', o.portal_show_balance", "'items', case when coalesce(o.portal_show_items, false)",
  ]) {
    assert.ok(s.includes(kv), `missing pre-existing field/value: ${kv}`);
  }
});
