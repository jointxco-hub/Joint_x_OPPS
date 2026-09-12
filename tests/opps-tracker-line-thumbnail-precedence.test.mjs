import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const MIGRATION = "supabase/migrations/20260914090000_public_tracking_line_thumbnail_precedence.sql";

function withoutComments(s) {
  return s.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
}

// Root cause (verified live against production ORD-MTKNJU7S, not guessed):
// OPPS's Set/Change thumbnail writes straight into orders.products[].
// image_url - the SAME field a line is seeded from at add-time (catalogue
// image or Client Product mockup). The public tracker's https-only guard
// correctly rejected the resulting private-upload:// reference, but then
// fell all the way through to the catalogue image, discarding staff's
// deliberate per-order choice. This file locks in the fix: the line's own
// image wins first, exposed as an opaque thumbnail_ref when private,
// falling back to Client Product mockup -> catalogue image only when the
// line's own value is absent or (eventually) fails to resolve.

test("precedence: the line's own image_url is resolved BEFORE the client-product/catalogue fallback chain, not after", async () => {
  const s = await src(MIGRATION);
  const resolvedIdx = s.indexOf("resolved on true");
  const fallbackDeclIdx = s.indexOf("fallback_image_url");
  const resolvedBlockStart = s.lastIndexOf("left join lateral", resolvedIdx);
  const resolvedBlock = s.slice(resolvedBlockStart, resolvedIdx);
  assert.ok(fallbackDeclIdx < resolvedBlockStart, "fallback tier is computed first, then consulted only inside the resolved tier");
  assert.ok(resolvedBlock.includes("when (item ->> 'image_url') ~* '^https://' then item ->> 'image_url'"));
  assert.ok(resolvedBlock.indexOf("item ->> 'image_url'") < resolvedBlock.indexOf("fallback.fallback_image_url"),
    "the line's own https image_url is checked before falling back");
});

test("a private-upload line thumbnail is exposed as an opaque thumbnail_ref, never discarded outright", async () => {
  const s = await src(MIGRATION);
  const exec = withoutComments(s);
  assert.ok(exec.includes("when (item ->> 'image_url') ~* '^private-upload://uploads/' then item ->> 'image_url'"));
  assert.ok(exec.includes("'thumbnail_ref', resolved.thumbnail_ref"));
});

test("thumbnail_ref is restricted to the exact same signable bucket the file resolver already allowlists ('uploads')", async () => {
  const s = await src(MIGRATION);
  assert.ok(s.includes("^private-upload://uploads/"));
});

test("image_url always carries an immediately-safe fallback while thumbnail_ref is pending resolution - never left null just because resolution hasn't happened yet", async () => {
  const s = await src(MIGRATION);
  const exec = withoutComments(s);
  assert.ok(exec.includes("else fallback.fallback_image_url"));
});

test("fallback chain internal order is unchanged: client-product mockup before catalogue image", async () => {
  const s = await src(MIGRATION);
  const exec = withoutComments(s);
  const fbStart = exec.indexOf("as fallback_image_url");
  const fbBlockStart = exec.lastIndexOf("select case", fbStart);
  const fbBlock = exec.slice(fbBlockStart, fbStart);
  const cpIdx = fbBlock.indexOf("cp_match.primary_mockup_url");
  const catIdx = fbBlock.indexOf("catalog_match.image_url");
  assert.ok(cpIdx > -1 && catIdx > cpIdx, "client-product mockup still checked before catalogue image inside the fallback tier");
});

test("catalog/client-product identity and safety checks are unchanged: exact uuid identity, tenant match, store_visible, active, https-only", async () => {
  const s = await src(MIGRATION);
  const exec = withoutComments(s);
  assert.ok(exec.includes("cp.id = (item ->> 'client_product_id')::uuid"));
  assert.ok(exec.includes("cp.tenant_id = o.tenant_id"));
  assert.ok(exec.includes("cl.tenant_id = o.tenant_id"));
  assert.ok(exec.includes("p.id = (item ->> 'catalog_item_id')::uuid"));
  assert.ok(exec.includes("p.tenant_id = o.tenant_id"));
  assert.ok(exec.includes("p.store_visible = true"));
  assert.ok(exec.includes("p.status = 'active'"));
});

test("line_id is exposed ONLY alongside thumbnail_ref, never unconditionally, and no other internal id is ever emitted as an OUTPUT key", async () => {
  const s = await src(MIGRATION);
  const exec = withoutComments(s);
  assert.ok(exec.includes("'line_id', case when resolved.thumbnail_ref is not null then item ->> 'line_id' else null end"));
  // forbidden as OUTPUT keys (jsonb_build_object('key', ...)) - reading
  // these fields as INPUT (item ->> 'client_product_id') to resolve the
  // precedence is expected and safe; only emitting them back out would not be.
  for (const forbidden of ["'client_product_id',", "'catalog_item_id',", "'inventory_item_id',"]) {
    assert.ok(!exec.includes(forbidden), `must not expose internal id as an output key: ${forbidden}`);
  }
});

test("does NOT join client_product_artwork or any real gallery table - server-side gallery remains explicitly out of scope", async () => {
  const s = await src(MIGRATION);
  const exec = withoutComments(s);
  for (const forbidden of ["client_product_artwork", "order_line_component_snapshots", "artwork_revision_ids"]) {
    assert.ok(!exec.includes(forbidden), `must not reference ${forbidden} yet`);
  }
});

test("verify_public_tracker_visible_thumbnail_ref: requires the ref to exactly match the line's CURRENT image_url, gated on portal_show_items, host-resolved", async () => {
  const s = await src(MIGRATION);
  assert.ok(s.includes("create or replace function public.verify_public_tracker_visible_thumbnail_ref("));
  assert.ok(s.includes("item ->> 'line_id' = input.clean_line_id"));
  assert.ok(s.includes("item ->> 'image_url' = input.clean_ref"));
  assert.ok(s.includes("coalesce(o.portal_show_items, false)"));
  assert.ok(s.includes("grant execute on function public.verify_public_tracker_visible_thumbnail_ref(text, text, text, text) to anon, authenticated;"));
});

test("verify_public_tracker_visible_thumbnail_ref returns a plain boolean, never row/order/line data", async () => {
  const s = await src(MIGRATION);
  const fnStart = s.indexOf("create or replace function public.verify_public_tracker_visible_thumbnail_ref(");
  const fnEnd = s.indexOf("$fn$;", s.indexOf("$fn$", fnStart) + 4) + 5;
  const body = s.slice(fnStart, fnEnd);
  assert.ok(body.includes("returns boolean"));
  assert.ok(!/jsonb_build_object|select\s+o\.\*|select\s+\*|select\s+item/.test(body), "must return only a boolean, never row/item data");
});

test("verify_public_tracker_visible_thumbnail_ref excludes breakdown lines from matching, same as the main projection", async () => {
  const s = await src(MIGRATION);
  assert.ok(s.includes("coalesce(item ->> 'line_role', 'product') <> 'breakdown'"));
});

test("same public RPC signature, all pre-existing fields preserved, portal_show_items/portal_show_files gating unchanged", async () => {
  const s = await src(MIGRATION);
  assert.ok(s.includes("create or replace function public.get_public_order_tracking_for_host(\n  p_lookup text,\n  p_hostname text\n)"));
  for (const kv of [
    "'id', o.id", "'order_number', o.order_number", "'status', o.status",
    "'portal_show_balance', o.portal_show_balance", "'total_amount', o.total_amount",
    "'files', case when coalesce(o.portal_show_files, false) then (",
    "'items', case when coalesce(o.portal_show_items, false) then (",
  ]) {
    assert.ok(s.includes(kv), `missing pre-existing field/value: ${kv}`);
  }
  assert.ok(s.includes("grant execute on function public.get_public_order_tracking_for_host(text, text) to anon, authenticated;"));
});

test("no destructive statements, no RLS change, no historical data rewrite", async () => {
  const s = await src(MIGRATION);
  assert.ok(!/drop column|drop table|truncate|^\s*update\s|^\s*delete\s/im.test(s));
  assert.ok(!/create policy|drop policy|enable row level security/i.test(s));
});
