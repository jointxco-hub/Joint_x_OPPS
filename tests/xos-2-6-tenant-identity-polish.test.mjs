import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const MIGRATION = "supabase/migrations/20260829100000_xos_2_6_tenant_identity_polish.sql";
const XOS_PRODUCTS = "src/pages/xos/XOSProducts.jsx";
const PROVISIONING_TEMPLATE = "supabase/provisioning/xos_tenant_provisioning_template.sql";

// ─────────────────────────────────────────────────────────────────────
// XOS 2.6 - Tenant Identity & Client Experience Polish.
//
// Static source-inspection tests (this repo has no live-database test
// harness reachable from `node --test` - matches the established
// convention, e.g. xos-onboarding-canonical-identity.test.mjs).
//
// Behavioral proof lives in a disposable, rolled-back Supabase
// transaction (BEGIN...ROLLBACK), not here - see the PR description /
// handoff notes for the exact live results: GSB generator produced
// GSB-2026-NNNNNN; the no-arg legacy generator still produced
// XL-2026-NNNNNN; a tenant with no configured order_prefix
// (demo-xos) fell back to XL; a real GSB QA checkout produced a
// GSB-prefixed order_number; the GSB product summary returned
// 12 total / 12 published / 9 available / 3 out_of_stock (matching the
// live commerce.products data); the historical XL-2026-725826 Monogram
// Tee thumbnail resolved from commerce.products.primary_image_url,
// scoped to the GSB tenant; that same historical order's order_number
// and products JSON were confirmed byte-identical before/after; and a
// tenant with the products capability disabled (demo-xos) was cleanly
// rejected by get_xos_product_summary_for_host, proving the capability
// check - present in the currently-deployed function but ABSENT from
// the originally-supplied migration bundle - was correctly restored
// during integration (see the restoration test below).
// ─────────────────────────────────────────────────────────────────────

test("the migration is additive - no DROP of any existing table/function, and the existing no-arg order-number generator is never touched", async () => {
  const source = await readSource(MIGRATION);
  assert.ok(!/drop function|drop table/i.test(source));
  assert.ok(!/_generate_storefront_order_number\(\)/.test(source), "the no-arg overload must not appear anywhere in this migration - it is intentionally left completely alone for X LAB/legacy compatibility");
});

test("the tenant order_prefix update is scoped exactly to the active GSB tenant and is idempotent (guarded by a <> check, safe to re-run)", async () => {
  const source = await readSource(MIGRATION);
  const start = source.indexOf("update public.tenants");
  const end = source.indexOf(";", start);
  const body = source.slice(start, end);
  assert.ok(body.includes("where slug = 'gsb'"));
  assert.ok(body.includes("and status = 'active'"));
  assert.ok(body.includes("and coalesce(settings->>'order_prefix', '') <> 'GSB';".replace(/;$/, "")));
});

test("_generate_storefront_order_number(uuid): resolves the prefix from tenants.settings, validates it, falls back to XL for anything invalid or missing - never trusts an unvalidated value into the order number", async () => {
  const source = await readSource(MIGRATION);
  const start = source.indexOf("create or replace function public._generate_storefront_order_number(p_tenant_id uuid)");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("v_prefix text := 'XL';"), "must default to XL before any lookup, so any early-exit path is still safe");
  assert.ok(body.includes("where t.id = p_tenant_id"));
  assert.ok(body.includes("and t.status = 'active'"), "an inactive tenant must not get a custom prefix");
  assert.ok(body.includes("if v_prefix is null or v_prefix !~ '^[A-Z0-9]{2,8}$' then"));
  assert.ok(body.includes("v_prefix := 'XL';"));
  assert.ok(body.includes("v_candidate := v_prefix || '-' || to_char(now(), 'YYYY') || '-' ||"));
});

test("_generate_storefront_order_number(uuid): uniqueness is checked against BOTH orders and xlab_orders, matching the existing no-arg generator's own collision-safety model", async () => {
  const source = await readSource(MIGRATION);
  const start = source.indexOf("create or replace function public._generate_storefront_order_number(p_tenant_id uuid)");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("select 1 from public.xlab_orders xo where xo.order_number = v_candidate"));
  assert.ok(body.includes("select 1 from public.orders o where o.order_number = v_candidate"));
  assert.ok(body.includes("if v_attempt >= 20 then"), "must not loop forever on pathological collision runs");
});

test("_generate_storefront_order_number(uuid) is not reachable by anon - only authenticated/service_role/postgres, matching the no-arg generator's own grant posture", async () => {
  const source = await readSource(MIGRATION);
  assert.ok(source.includes("revoke all on function public._generate_storefront_order_number(uuid) from public;"));
  assert.ok(source.includes("revoke all on function public._generate_storefront_order_number(uuid) from anon;"));
  assert.ok(source.includes("grant execute on function public._generate_storefront_order_number(uuid)\n  to authenticated, service_role, postgres;"));
});

test("create_commerce_checkout_order: the ONLY semantic change from the currently-deployed function is switching to the tenant-aware order-number generator - confirmed by a full diff against the live pg_get_functiondef output during integration (see PR description)", async () => {
  const source = await readSource(MIGRATION);
  assert.ok(source.includes("v_order_number := public._generate_storefront_order_number(v_tenant_id);"));
  assert.ok(!source.includes("v_order_number := public._generate_storefront_order_number();"), "must call the tenant-aware overload, not the legacy no-arg one");
  // Every other guardrail from the current production function must survive
  // untouched: idempotency replay, item/price/tenant validation, storefront
  // host resolution, commerce catalog scoping.
  assert.ok(source.includes("checkout_idempotency_key = trim(p_idempotency_key)"));
  assert.ok(source.includes("'replayed', true"));
  assert.ok(source.includes("and p.status = 'published'"));
  assert.ok(source.includes("and p.availability = 'available'"));
  assert.ok(source.includes("and v.availability = 'available'"));
  assert.ok(source.includes("storefront_host,"), "the OPPS order row must still record storefront_host - this is what the earlier PayFast callback-host fix depends on");
});

test("create_commerce_checkout_order keeps its existing anon grant - the storefront checkout entry point must still work for unauthenticated customers", async () => {
  const source = await readSource(MIGRATION);
  const grantIdx = source.indexOf("grant execute on function public.create_commerce_checkout_order(");
  const grantEnd = source.indexOf(";", grantIdx);
  const grantBody = source.slice(grantIdx, grantEnd);
  assert.ok(grantBody.includes("anon"));
  assert.ok(grantBody.includes("authenticated"));
  assert.ok(grantBody.includes("service_role"));
});

test("get_xos_product_summary_for_host restores the products-capability-enabled gate present in the currently-deployed function - the originally-supplied migration silently dropped it; integration restored it rather than shipping a real access-control regression", async () => {
  const source = await readSource(MIGRATION);
  const start = source.indexOf("create or replace function public.get_xos_product_summary_for_host");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("products_enabled boolean;"));
  assert.ok(body.includes("and tc.capability_key = 'products'"));
  assert.ok(body.includes("if not coalesce(products_enabled, false) then"));
  assert.ok(body.includes("raise exception 'Products are not available for this workspace.';"));
  // And the check must run BEFORE the aggregate query, not after.
  const gateIdx = body.indexOf("if not coalesce(products_enabled, false) then");
  const queryIdx = body.indexOf("select jsonb_build_object(\n    'total'");
  assert.ok(gateIdx !== -1 && queryIdx !== -1 && gateIdx < queryIdx);
});

test("get_xos_product_summary_for_host: available/out_of_stock are computed from the real commerce.products.availability values, and 'unavailable' is kept only as a backward-compatible alias of out_of_stock, not a third real state", async () => {
  const source = await readSource(MIGRATION);
  const start = source.indexOf("create or replace function public.get_xos_product_summary_for_host");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("lower(coalesce(product.availability, '')) = 'available'"));
  assert.ok(body.includes("lower(coalesce(product.availability, '')) = 'out_of_stock'"));
  assert.ok(body.includes("-- Backward-compatible alias for any older frontend still reading this key."));
  // The alias must compute the exact same predicate as out_of_stock, not
  // reference a literal 'unavailable' status that never occurs in real data.
  const unavailableBlock = body.slice(body.indexOf("'unavailable', count(*) filter ("));
  assert.ok(unavailableBlock.startsWith("'unavailable', count(*) filter (\n      where lower(coalesce(product.status, '')) = 'published'\n        and lower(coalesce(product.availability, '')) = 'out_of_stock'\n    )::int"));
});

test("get_xos_product_summary_for_host and get_xos_order_detail_for_host remain unreachable by anon - XOS admin data stays authenticated-only", async () => {
  const source = await readSource(MIGRATION);
  for (const fn of ["get_xos_product_summary_for_host(text)", "get_xos_order_detail_for_host(text, text)"]) {
    assert.ok(source.includes(`revoke all on function public.${fn} from public;`));
    assert.ok(source.includes(`revoke all on function public.${fn} from anon;`));
    assert.ok(source.includes(`grant execute on function public.${fn}\n  to authenticated, service_role, postgres;`));
  }
});

test("get_xos_order_detail_for_host: item image_url falls back to commerce.products.primary_image_url ONLY when the historical item itself has none, strictly scoped to the authenticated caller's own resolved tenant - never a cross-tenant lookup", async () => {
  const source = await readSource(MIGRATION);
  const start = source.indexOf("create or replace function public.get_xos_order_detail_for_host");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("'image_url', coalesce(\n        nullif(item->>'image_url', ''),"), "the item's own image_url, if present, must always win - the Commerce lookup is a fallback only");
  const fallbackStart = body.indexOf("select nullif(product.primary_image_url, '')");
  const fallbackEnd = body.indexOf(")", body.indexOf("limit 1", fallbackStart));
  const fallbackBody = body.slice(fallbackStart, fallbackEnd);
  assert.ok(fallbackBody.includes("product.id::text = nullif(item->>'commerce_product_id', '')"));
  assert.ok(fallbackBody.includes("product.tenant_id = resolved_tenant_id"), "the fallback lookup must be scoped to the same resolved_tenant_id the order itself was already scoped to - never an unscoped commerce.products read");
});

test("get_xos_order_detail_for_host: price also falls back to unit_price - real Commerce-created checkout line items only ever carry unit_price, never a bare price key, so the un-patched function would have shown a blank price for every real order", async () => {
  const source = await readSource(MIGRATION);
  const start = source.indexOf("create or replace function public.get_xos_order_detail_for_host");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("'price', coalesce(\n        nullif(item->>'price', ''),\n        nullif(item->>'unit_price', '')\n      )::numeric"));
  // create_commerce_checkout_order's own line-item shape (same migration)
  // confirms this: it only ever writes 'unit_price', never 'price'.
  const checkoutStart = source.indexOf("v_line := jsonb_strip_nulls(jsonb_build_object(");
  const checkoutLine = source.slice(checkoutStart, source.indexOf("));", checkoutStart));
  assert.ok(checkoutLine.includes("'unit_price', v_unit_price"));
  assert.ok(!checkoutLine.includes("'price', v_unit_price"));
});

test("get_xos_order_detail_for_host never rewrites the underlying order row - it is a read-only SELECT, order_number/products stay exactly as stored", async () => {
  const source = await readSource(MIGRATION);
  const start = source.indexOf("create or replace function public.get_xos_order_detail_for_host");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(!/update public\.orders|insert into public\.orders|delete from public\.orders/.test(body));
});

// ─────────────────────────────────────────────────────────────────────
// Frontend - XOSProducts.jsx
// ─────────────────────────────────────────────────────────────────────

test("XOSProducts: the stale 'unavailable' filter/tone literal is gone everywhere, replaced by the real out_of_stock value the backend now reports", async () => {
  const source = await readSource(XOS_PRODUCTS);
  assert.ok(!/'unavailable'/.test(source), "no remaining reference to the dead 'unavailable' literal - it never matched real commerce.products.availability data");
  assert.ok(source.includes("{ value: 'out_of_stock', label: 'Out of stock' },"));
  assert.ok(source.includes("if (filter === 'out_of_stock') return product.availability === 'out_of_stock';"));
});

test("XOSProducts: all four availability-tone badges (product list, product detail, variant list) now key off out_of_stock for the destructive tone", async () => {
  const source = await readSource(XOS_PRODUCTS);
  const occurrences = (source.match(/product\.availability === 'available' \? 'success' : product\.availability === 'out_of_stock' \? 'destructive' : 'warning'/g) || []).length;
  assert.equal(occurrences, 3, "expected exactly 3 product-level tone badges using the fixed literal");
  assert.ok(source.includes("variant.availability === 'available' ? 'success' : variant.availability === 'out_of_stock' ? 'destructive' : 'warning'"));
});

// ─────────────────────────────────────────────────────────────────────
// Tenant provisioning template
// ─────────────────────────────────────────────────────────────────────

test("provisioning template: order_prefix is required, validated to 2-8 uppercase letters/numbers before any insert, and flows into the new tenant's settings", async () => {
  const source = await readSource(PROVISIONING_TEMPLATE);
  assert.ok(source.includes("v_order_prefix       text := 'REPLACE';"));
  assert.ok(source.includes("v_order_prefix := upper(trim(coalesce(v_order_prefix, '')));"));
  assert.ok(source.includes("if v_order_prefix !~ '^[A-Z0-9]{2,8}$' then"));
  const validationIdx = source.indexOf("v_order_prefix := upper(trim(coalesce(v_order_prefix, '')));");
  const insertIdx = source.indexOf("insert into public.tenants (slug, name, status, settings)");
  assert.ok(validationIdx !== -1 && insertIdx !== -1 && validationIdx < insertIdx, "validation must run before the tenant is ever inserted");
  assert.ok(source.includes("jsonb_build_object('order_prefix', v_order_prefix)"));
});

test("provisioning template still fails loudly, before any insert, exactly as before this change - the new validation is additive, not a replacement of the existing preflight checks", async () => {
  const source = await readSource(PROVISIONING_TEMPLATE);
  assert.ok(source.includes("if v_owner_auth_user_id is null then"));
  assert.ok(source.includes("if exists (select 1 from public.tenants where slug = v_tenant_slug) then"));
  assert.ok(source.includes("if exists (select 1 from public.tenant_domains where hostname = v_hostname) then"));
});
