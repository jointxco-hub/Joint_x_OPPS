import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// ─────────────────────────────────────────────────────────────────────
// XOS 2.7C — QA/test order hygiene migration.
//
// Adds orders.is_test / orders.excluded_from_reports (both additive,
// NOT NULL default false, no backfill), a dedicated
// set_order_test_classification() RPC gated by is_opps_staff() (per the
// live Phase 0 finding that ordinary tenant members can already UPDATE
// arbitrary orders columns via the existing tenant_manage_orders RLS
// policy - see the migration's own header comment), and updates both
// get_xos_orders_for_host / get_xos_order_detail_for_host to exclude
// excluded_from_reports=true rows from XOS client-facing views.
//
// This migration was NOT applied to production as part of this PR -
// implementation and disposable, rolled-back transaction validation
// only, per this PR's explicit "STOP AFTER IMPLEMENTATION" instruction.
// ─────────────────────────────────────────────────────────────────────

async function readSource() {
  const raw = await readFile(
    new URL("../supabase/migrations/20260829130000_xos_2_7c_test_order_hygiene.sql", import.meta.url),
    "utf8"
  );
  return raw.replace(/\r\n/g, "\n");
}

function sqlOnly(raw) {
  return raw.replace(/^--.*$/gm, "");
}

// ── Schema ──────────────────────────────────────────────────────────

test("schema: adds is_test and excluded_from_reports additively, NOT NULL default false, no other column/table/RLS change", async () => {
  const source = await readSource();
  assert.ok(/alter table public\.orders\s+add column if not exists is_test boolean not null default false,\s+add column if not exists excluded_from_reports boolean not null default false;/.test(source));
  assert.ok(!/drop table|drop column|create table|create policy|alter policy|drop policy/i.test(source));
  const alterCount = (source.match(/alter table/gi) || []).length;
  assert.equal(alterCount, 1, "exactly one ALTER TABLE - both columns added together, nothing else altered");
});

test("schema: no backfill - no UPDATE statement targets existing order rows outside the classification RPC's own single-row, parameter-driven UPDATE", async () => {
  const source = await readSource();
  const updateStatements = source.match(/^\s*update\s+public\.orders/gim) || [];
  assert.equal(updateStatements.length, 1, "the only UPDATE on orders must be the one inside set_order_test_classification");
  const rpcStart = source.indexOf("create or replace function public.set_order_test_classification");
  const rpcEnd = source.indexOf("$function$;", rpcStart);
  const updateIndex = source.search(/^\s*update\s+public\.orders/im);
  assert.ok(updateIndex > rpcStart && updateIndex < rpcEnd, "the single UPDATE lives inside the classification RPC, not as a bare migration statement");
});

test("schema: no automatic name/email/prefix/source pattern classification anywhere in the actual SQL", async () => {
  const sql = sqlOnly(await readSource());
  assert.ok(!/order_number\s+(like|ilike|~)/i.test(sql));
  assert.ok(!/client_email\s+(like|ilike|~)/i.test(sql));
  assert.ok(!/client_name\s+(like|ilike|~)/i.test(sql));
  assert.ok(!/source\s*=\s*'(test|qa)'/i.test(sql));
});

test("schema: no known real/proof order number is referenced in executable SQL (only in comments, documenting what stays untouched)", async () => {
  const source = await readSource();
  const sql = sqlOnly(source);
  assert.ok(!/XL-2026-647263|XL-2026-268006|ORD-MQNGCL25/.test(sql));
});

// ── Mutation / control RPC ─────────────────────────────────────────

test("RPC: set_order_test_classification is SECURITY DEFINER, resolves a real actor, and rejects when the caller is not is_opps_staff()", async () => {
  const source = await readSource();
  const start = source.indexOf("create or replace function public.set_order_test_classification");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("security definer"));
  assert.ok(body.includes("v_actor_uid := auth.uid();"));
  assert.ok(body.includes("ORDER_CLASSIFICATION_ACTOR_UNRESOLVED"));
  assert.ok(body.includes("if not public.is_opps_staff() then"));
  assert.ok(body.includes("ORDER_CLASSIFICATION_FORBIDDEN"));
  // Strip -- comments first: the function's own explanatory comment
  // legitimately names can_access_tenant() as the thing it deliberately
  // does NOT use - only the executable SQL must avoid calling it.
  const executableBody = body.replace(/--.*$/gm, "");
  assert.ok(!executableBody.includes("can_access_tenant"), "must authorize via is_opps_staff() specifically, never the ordinary tenant-membership check");
});

test("RPC: is_test and excluded_from_reports are independent - each field's effective value is coalesce(param, existing), never derived from the other parameter", async () => {
  const source = await readSource();
  const start = source.indexOf("create or replace function public.set_order_test_classification");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("is_test = coalesce(p_is_test, is_test),"));
  assert.ok(body.includes("excluded_from_reports = coalesce(p_excluded_from_reports, excluded_from_reports)"));
  assert.ok(!body.includes("is_archived = true"), "classification must never automatically archive the order");
});

test("RPC: locks the row with FOR UPDATE as the only read, so authorization and the audit diff observe the identical row", async () => {
  const source = await readSource();
  const start = source.indexOf("create or replace function public.set_order_test_classification");
  const body = source.slice(start, source.indexOf("$function$;", start));
  const selectStatements = body.match(/select \* into v_old/g) || [];
  assert.equal(selectStatements.length, 1);
  assert.ok(body.includes("from public.orders where id = p_order_id for update;"));
});

test("RPC: inserts exactly one opps_activity_events row, only when v_changed_fields is non-empty, with before/after values and actor identity", async () => {
  const source = await readSource();
  const start = source.indexOf("create or replace function public.set_order_test_classification");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("if v_changed_fields <> '{}'::jsonb then"));
  assert.ok(body.includes("insert into public.opps_activity_events"));
  assert.ok(body.includes("actor_email, actor_name"));
  assert.ok(body.includes("'before', v_old.is_test, 'after', p_is_test"));
  assert.ok(body.includes("'before', v_old.excluded_from_reports, 'after', p_excluded_from_reports"));
  const insertCount = (body.match(/insert into public\.opps_activity_events/g) || []).length;
  assert.equal(insertCount, 1);
});

test("RPC: grants execute to authenticated/service_role/postgres only, revoked from public and anon - no broadened write authority", async () => {
  const source = await readSource();
  assert.ok(source.includes("revoke all on function public.set_order_test_classification(uuid, boolean, boolean) from public;"));
  assert.ok(source.includes("revoke all on function public.set_order_test_classification(uuid, boolean, boolean) from anon;"));
  assert.ok(source.includes("grant execute on function public.set_order_test_classification(uuid, boolean, boolean)\n  to authenticated, service_role, postgres;"));
});

// ── XOS client-facing exclusion (Phase C5) ─────────────────────────

test("XOS: both get_xos_orders_for_host and get_xos_order_detail_for_host add the excluded_from_reports filter alongside the existing is_archived filter, exactly once each", async () => {
  // Strip -- comments: the Phase C5 header comment above these functions
  // legitimately quotes this exact filter line as documentation.
  const sql = sqlOnly(await readSource());
  const isArchivedOccurrences = (sql.match(/coalesce\(o\.is_archived, false\) = false/g) || []).length;
  const excludedOccurrences = (sql.match(/coalesce\(o\.excluded_from_reports, false\) = false/g) || []).length;
  assert.equal(isArchivedOccurrences, 2);
  assert.equal(excludedOccurrences, 2);
});

test("XOS: tenant scoping, fulfillment_type/payment_status projection (2.7A/B), and the 2.6 thumbnail/price fallback are all still present, unmodified", async () => {
  const source = await readSource();
  const tenantScopeOccurrences = (source.match(/o\.tenant_id = resolved_tenant_id/g) || []).length;
  assert.equal(tenantScopeOccurrences, 2);
  assert.ok(source.includes("'fulfillment_type', order_row.fulfillment_type,"));
  assert.ok(source.includes("'payment_status', order_row.payment_status,"));
  assert.ok(source.includes("'payment_status', coalesce(order_row.payment_status, 'pending'),"));
  assert.ok(source.includes("product.tenant_id = resolved_tenant_id"));
  assert.ok(source.includes("nullif(item->>'unit_price', '')"));
});

test("XOS: SECURITY DEFINER, search_path, and the existing authenticated-only grant posture are unchanged - no anon access introduced", async () => {
  const source = await readSource();
  const xosStart = source.indexOf("create or replace function public.get_xos_orders_for_host");
  const xosSection = source.slice(xosStart);
  const definerCount = (xosSection.match(/security definer/g) || []).length;
  assert.equal(definerCount, 2);
  assert.ok(xosSection.includes("set search_path to 'public'"));
  assert.ok(xosSection.includes("revoke all on function public.get_xos_orders_for_host(text, integer) from anon;"));
  assert.ok(xosSection.includes("revoke all on function public.get_xos_order_detail_for_host(text, text) from anon;"));
  assert.ok(xosSection.includes("grant execute on function public.get_xos_orders_for_host(text, integer)\n  to authenticated, service_role, postgres;"));
  assert.ok(xosSection.includes("grant execute on function public.get_xos_order_detail_for_host(text, text)\n  to authenticated, service_role, postgres;"));
});

test("XOS: an excluded order returns the same generic 'Order not found.' as a nonexistent/cross-tenant one - no distinguishing error message", async () => {
  const source = await readSource();
  const detailStart = source.indexOf("create or replace function public.get_xos_order_detail_for_host");
  const detailBody = source.slice(detailStart, source.indexOf("$function$;", detailStart));
  const notFoundOccurrences = (detailBody.match(/'Order not found\.'/g) || []).length;
  assert.equal(notFoundOccurrences, 1, "exactly one not-found branch handles every exclusion reason identically");
});

// ── Content hygiene ─────────────────────────────────────────────────

test("no PayFast, checkout, order-number generation, or unrelated-migration content appears in the actual SQL (comments aside)", async () => {
  const sql = sqlOnly(await readSource());
  assert.ok(!/payfast/i.test(sql));
  assert.ok(!/create_commerce_checkout_order/.test(sql));
  assert.ok(!/_generate_storefront_order_number/.test(sql));
});

test("the migration is wrapped in a single begin/commit transaction", async () => {
  const source = await readSource();
  assert.ok(source.trimEnd().endsWith("commit;"));
  const beginCount = (source.match(/^begin;$/gm) || []).length;
  const commitCount = (source.match(/^commit;$/gm) || []).length;
  assert.equal(beginCount, 1);
  assert.equal(commitCount, 1);
});
