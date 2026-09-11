import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const COL_MIGRATION = "supabase/migrations/20260911090000_orders_portal_show_items.sql";
const RPC_MIGRATION = "supabase/migrations/20260911100000_public_order_tracking_safe_items_projection.sql";
const DATA_CLIENT = "src/api/dataClient.js";
const PORTAL_TAB = "src/components/orders/drawer/PortalTab.jsx";

// Root cause (verified against the live production RPC body): OPPS-created
// orders return no line items on the public tracker because
// get_public_order_tracking_for_host's jsonb_build_object(...) simply never
// selects orders.products - not a frontend bug, not a shape mismatch. This
// feature adds ONE staff-toggled visibility flag + ONE allowlisted
// projection, gated on it.

test("portal_show_items: additive boolean column, default false, matches the portal_show_balance/files convention", async () => {
  const s = await src(COL_MIGRATION);
  assert.ok(s.includes("add column if not exists portal_show_items boolean not null default false"),
    "new column, additive, opt-in default - historical AND new orders start hidden");
  assert.ok(!/drop column|drop table|truncate/i.test(s), "never destructive");
  assert.ok(!/create policy|drop policy|enable row level security/i.test(s), "no RLS change");
});

test("get_public_order_tracking_for_host: every pre-existing key/value is preserved verbatim", async () => {
  const s = await src(RPC_MIGRATION);
  // the exact hardening values from 202606270001_private_uploads_signed_urls.sql
  for (const kv of [
    "'id', o.id", "'client_name', o.client_name", "'order_number', o.order_number", "'status', o.status",
    "'pipeline_stage', o.pipeline_stage", "'production_method', o.production_method",
    "'production_detail_stage', o.production_detail_stage", "'production_client_update', o.production_client_update",
    "'due_date', o.due_date", "'courier', o.courier", "'tracking_number', o.tracking_number",
    "'pep_code', o.pep_code", "'portal_message', o.portal_message", "'portal_attention_items', o.portal_attention_items",
    "'portal_show_files', false", "'portal_show_balance', o.portal_show_balance",
    "'portal_visible_file_urls', jsonb_build_array()", "'invoice_files', jsonb_build_array()",
    "'total_amount', o.total_amount", "'deposit_paid', o.deposit_paid",
  ]) {
    assert.ok(s.includes(kv), `pre-existing key/value preserved: ${kv}`);
  }
  // tenant resolution / matching untouched
  assert.ok(s.includes("domain_row.surface = 'public_tracking'"));
  assert.ok(s.includes("domain_row.status = 'active'"));
  assert.ok(s.includes("tenant.status = 'active'"));
  assert.ok(s.includes("public.normalize_tenant_hostname(p_hostname)"));
  assert.ok(s.includes("o.tenant_id = resolved_tenant.tenant_id"), "still strictly single-tenant scoped");
  assert.ok(!/resolved_tenant\.tenant_id is null|coalesce\(resolved_tenant\.tenant_id/.test(s),
    "no fallback tenant - a missing mapping still yields nothing");
  assert.ok(s.includes("security definer") && s.includes("set search_path = public"));
  assert.ok(s.includes("grant execute on function public.get_public_order_tracking_for_host(text, text) to anon, authenticated"));
});

test("items projection is gated on portal_show_items and re-evaluated on every call (no cache)", async () => {
  const s = await src(RPC_MIGRATION);
  assert.ok(s.includes("case when coalesce(o.portal_show_items, false) then ("),
    "OFF -> the items branch never runs; ON -> re-derived live from the current flag + current products[] every call");
  assert.ok(s.includes("else '[]'::jsonb end"), "OFF always yields an empty array, never omits the key or errors");
});

test("items is a hand-built allowlist, never the raw products[] row", async () => {
  const s = await src(RPC_MIGRATION);
  assert.ok(!/'items',\s*coalesce\(o\.products/.test(s), "never passes orders.products[] straight through");
  for (const key of ["'product_name'", "'quantity'", "'size'", "'color'", "'prints'", "'image_url'", "'line_total'"]) {
    assert.ok(s.includes(key), `allowlisted key present: ${key}`);
  }
});

test("internal/unsafe fields are never selected into the items projection", async () => {
  const s = await src(RPC_MIGRATION);
  // executable SQL only - the header comment names these fields BY DESIGN
  // to document that they are excluded; only the code itself must never
  // reference them.
  const code = s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  for (const forbidden of [
    "catalog_item_id", "inventory_item_id", "client_product_id", "source_component_id", "line_id",
    "duplicated_from_line_id", "item ->> 'notes'", "production_instructions", "internal_notes",
    "source_metadata", "price_reviewed", "cost", "margin", "supplier",
  ]) {
    assert.ok(!code.includes(forbidden), `must never appear in executable SQL: ${forbidden}`);
  }
});

test("breakdown / non-billable composed-pricing lines are excluded (forward-compatible, defensive)", async () => {
  const s = await src(RPC_MIGRATION);
  assert.ok(s.includes("coalesce(item ->> 'line_role', 'product') <> 'breakdown'"),
    "a reserved line_role='breakdown' row (informational-only, never billable) is never rendered as an item");
});

test("a line with no name is dropped, never rendered as a blank/undefined row", async () => {
  const s = await src(RPC_MIGRATION);
  assert.ok(s.includes("nullif(btrim(coalesce(item ->> 'name', '')), '') is not null"));
});

test("quantity and price casts are numeric-guarded - a malformed line degrades safely, never raises", async () => {
  const s = await src(RPC_MIGRATION);
  const numericGuard = /\(item ->> 'quantity'\) ~ '\^\[0-9\]\+\(\\\.\[0-9\]\+\)\?\$'/;
  assert.ok(numericGuard.test(s), "quantity is regex-guarded before casting to numeric");
  assert.ok(s.includes("(item ->> 'price') ~ '^[0-9]+(\\.[0-9]+)?$'"), "price is regex-guarded before casting to numeric");
  assert.ok(!/\(item ->> 'quantity'\)::numeric,\s*1\)/.test(s) || s.includes("else 1"),
    "a non-numeric quantity falls back to 1, never a cast error");
});

test("image_url is included ONLY for a genuine https:// URL - never a private-upload:// scheme reference", async () => {
  const s = await src(RPC_MIGRATION);
  const code = s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(code.includes("(item ->> 'image_url') ~* '^https://' then item ->> 'image_url'"));
  assert.ok(!code.includes("private-upload"), "the executable SQL never references or special-cases the private scheme - it simply isn't https, so the guard already excludes it");
});

test("line_total uses the same per-unit-price*quantity convention already used everywhere else in OPPS", async () => {
  const s = await src(RPC_MIGRATION);
  assert.ok(s.includes("round((item ->> 'price')::numeric * (item ->> 'quantity')::numeric, 2)"));
});

test("dataClient.js: portal_show_items is allowlisted on Order writes, next to portal_show_balance/files", async () => {
  const s = await src(DATA_CLIENT);
  assert.ok(/portal_show_balance: payload\.portal_show_balance,\s*\n\s*portal_show_files: payload\.portal_show_files,\s*\n\s*portal_show_items: payload\.portal_show_items,/.test(s),
    "portal_show_items passes through the same allowlist as its siblings");
});

test("PortalTab: Order Items toggle reuses the existing generic toggle() - not a new status/payment/production mutation", async () => {
  const s = await src(PORTAL_TAB);
  assert.ok(s.includes('onClick={() => toggle("portal_show_items")}'), "wired through the existing toggle(field) helper");
  assert.ok(s.includes("const toggle = (field) => onUpdate(order.id, { [field]: !order[field] });"),
    "toggle() only ever writes the one named field - never status/payment/production");
  assert.ok(s.includes("Order Items"), "labelled control present near the other Client Portal toggles");
  assert.ok(!/portal_show_items.*status|status.*portal_show_items/.test(s),
    "never derived from or coupled to order status");
});

test("PortalTab: the control's own copy documents what it does and does not show", async () => {
  const s = await src(PORTAL_TAB);
  assert.ok(/no internal notes, suppliers, or costs/.test(s));
});
