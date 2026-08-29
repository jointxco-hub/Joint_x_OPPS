import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource() {
  const raw = await readFile(new URL("../supabase/migrations/20260829120001_xos_2_7ab_status_fields.sql", import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

// ─────────────────────────────────────────────────────────────────────
// XOS 2.7A/B - status fields migration.
//
// Discovered during implementation (not anticipated by the audit, which
// expected Phase B to be frontend-only): neither get_xos_orders_for_host
// nor get_xos_order_detail_for_host returns fulfillment_type or
// payment_status today - confirmed live via pg_get_functiondef before
// writing this file. This migration is the smallest possible fix: it
// adds exactly those two fields to each function's existing output
// projection and changes nothing else - confirmed by a normalized diff
// against the live deployed definitions during implementation (every
// other line matched exactly; only the two new jsonb keys and their two
// corresponding SELECT-list entries were new).
//
// Live-tested via a disposable, rolled-back transaction before this
// summary was written: both fields returned correctly for five real GSB
// orders spanning both fulfillment_type values and both payment_status
// values; production confirmed unchanged afterward
// (pg_get_functiondef ... like '%fulfillment_type%' = false).
//
// This migration was NOT applied to production as part of this PR -
// implementation and disposable-transaction validation only, per this
// PR's explicit "STOP AFTER IMPLEMENTATION" instruction.
// ─────────────────────────────────────────────────────────────────────

test("the migration is additive only - CREATE OR REPLACE on two existing functions, no DROP, no new table/column/RLS policy/grant target", async () => {
  const source = await readSource();
  assert.ok(!/drop function|drop table|drop policy|create table|create policy/i.test(source));
  const createCount = (source.match(/create or replace function/g) || []).length;
  assert.equal(createCount, 2, "must touch exactly the two existing XOS order RPCs, nothing else");
});

test("no new RPC is created - both function names and signatures are unchanged from what's currently deployed", async () => {
  const source = await readSource();
  assert.ok(source.includes("create or replace function public.get_xos_orders_for_host(p_hostname text, p_limit integer DEFAULT 20)"));
  assert.ok(source.includes("create or replace function public.get_xos_order_detail_for_host(\n  p_hostname text,\n  p_order_number text\n)"));
});

test("get_xos_orders_for_host: fulfillment_type and payment_status are added to both the output jsonb_build_object and the underlying SELECT - payment_status defaults to 'pending' when null, matching the table's own status semantics", async () => {
  const source = await readSource();
  const start = source.indexOf("function public.get_xos_orders_for_host");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("'fulfillment_type', order_row.fulfillment_type,"));
  assert.ok(body.includes("'payment_status', order_row.payment_status,"));
  assert.ok(body.includes("o.fulfillment_type,"));
  assert.ok(body.includes("coalesce(o.payment_status, 'pending')::text as payment_status,"));
});

test("get_xos_order_detail_for_host: fulfillment_type and payment_status are added to the result object only - the items/thumbnail/price projection from XOS 2.6 is untouched", async () => {
  const source = await readSource();
  const start = source.indexOf("function public.get_xos_order_detail_for_host");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("'fulfillment_type', order_row.fulfillment_type,"));
  assert.ok(body.includes("'payment_status', coalesce(order_row.payment_status, 'pending'),"));
  // XOS 2.6 thumbnail/price fallback logic, byte-identical, still present:
  assert.ok(body.includes("product.tenant_id = resolved_tenant_id"));
  assert.ok(body.includes("nullif(item->>'unit_price', '')"));
});

test("both functions preserve the existing is_archived and tenant-scoping filters exactly - this migration adds fields, it never widens what an XOS caller can see", async () => {
  const source = await readSource();
  const occurrences = (source.match(/coalesce\(o\.is_archived, false\) = false/g) || []).length;
  assert.equal(occurrences, 2);
  const tenantScopeOccurrences = (source.match(/o\.tenant_id = resolved_tenant_id/g) || []).length;
  assert.equal(tenantScopeOccurrences, 2);
});

test("both functions preserve SECURITY DEFINER, the existing search_path, and the existing authenticated-only grant posture - no anon access introduced", async () => {
  const source = await readSource();
  const definerCount = (source.match(/security definer/g) || []).length;
  assert.equal(definerCount, 2);
  const searchPathCount = (source.match(/set search_path to 'public'/g) || []).length;
  assert.equal(searchPathCount, 2);
  assert.ok(source.includes("revoke all on function public.get_xos_orders_for_host(text, integer) from anon;"));
  assert.ok(source.includes("revoke all on function public.get_xos_order_detail_for_host(text, text) from anon;"));
  assert.ok(source.includes("grant execute on function public.get_xos_orders_for_host(text, integer)\n  to authenticated, service_role, postgres;"));
  assert.ok(source.includes("grant execute on function public.get_xos_order_detail_for_host(text, text)\n  to authenticated, service_role, postgres;"));
});

test("no PayFast, checkout, order-number generation, or QA/test-classification content appears in the migration's actual SQL (comments aside, which document what was deliberately kept out)", async () => {
  const raw = await readSource();
  const sql = raw.replace(/^--.*$/gm, "");
  assert.ok(!/payfast/i.test(sql));
  assert.ok(!/create_commerce_checkout_order/.test(sql));
  assert.ok(!/_generate_storefront_order_number/.test(sql));
  assert.ok(!/is_test|excluded_from_reports/.test(sql));
});
