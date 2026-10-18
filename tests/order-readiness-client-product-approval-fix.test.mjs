import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const MIGRATION_PATH = "supabase/migrations/20261011140000_order_readiness_client_product_approval_fix.sql";

// ─────────────────────────────────────────────────────────────────────
// Order Operational Readiness, Phase B1 — static-source assertions for
// the get_order_production_readiness fix. The live behavior (does the
// warning actually disappear for XL-261006-3936, do unrelated/pending
// approvals still fail to satisfy it) is verified separately via the
// rollback-only rehearsal, matching every other migration test in this
// suite. This file asserts the SQL shape itself: the old dead predicate
// is gone, the new per-product-represented logic is present, and
// everything this phase promised not to touch is untouched.
// ─────────────────────────────────────────────────────────────────────

let migration;

test.before(async () => {
  migration = await readSource(MIGRATION_PATH);
});

test("the old dead approval_type predicate ('artwork'/'mockup'/'production_ready') is gone", () => {
  assert.doesNotMatch(migration, /approval_type in \('artwork', 'mockup', 'production_ready'\)/);
});

test("the warning now gates on all_represented_products_approved, not a hardcoded 'at least one approval' exists check", () => {
  assert.match(migration, /where not all_represented_products_approved/);
});

test("represented_client_product_ids is derived from the order's own composition (line_role='product', client_product_id present) — never from the whole client's product list", () => {
  const start = migration.indexOf("represented_client_product_ids uuid[]");
  assert.notEqual(start, -1);
  const derivation = migration.slice(migration.indexOf("select coalesce(array_agg(distinct"), migration.indexOf("all_represented_products_approved := not exists"));
  assert.match(derivation, /jsonb_array_elements\(coalesce\(order_row\.products, '\[\]'::jsonb\)\)/);
  assert.match(derivation, /line_role/);
  assert.match(derivation, /client_product_id/);
});

test("every represented product must have its OWN approved client_product_concept row — one approval never covers another product (NOT EXISTS over unnest, not a plain EXISTS 'any approval')", () => {
  const block = migration.slice(
    migration.indexOf("all_represented_products_approved := not exists"),
    migration.indexOf("with defaults(check_key"),
  );
  assert.match(block, /not exists\s*\(\s*select 1\s*from unnest\(represented_client_product_ids\) as cp_id/);
  assert.match(block, /where not exists \(/);
  assert.match(block, /a\.related_table = 'client_products'/);
  assert.match(block, /a\.related_id = cp_id/);
  assert.match(block, /a\.approval_type = 'client_product_concept'/);
  assert.match(block, /a\.status = 'approved'/);
});

test("the check is keyed to related_id = cp_id (the specific product), never a.client_id alone — an unrelated client product for the same client cannot satisfy it", () => {
  const block = migration.slice(
    migration.indexOf("all_represented_products_approved := not exists"),
    migration.indexOf("with defaults(check_key"),
  );
  assert.doesNotMatch(block, /a\.client_id/);
});

test("approvals_json gains exactly one additional OR clause for related_table='client_products', still scoped to this order's represented product ids and the order's own client_id", () => {
  const approvalsStart = migration.indexOf("into approvals_json");
  const block = migration.slice(approvalsStart, migration.indexOf("limit 10;", approvalsStart) + "limit 10;".length);
  assert.match(block, /a\.client_id = coalesce\(order_row\.client_id, client_row\.id\)/);
  assert.match(block, /a\.related_table in \('orders', 'client_tech_packs', 'client_special_instructions'\)/);
  assert.match(block, /a\.related_table = 'client_products' and a\.related_id = any \(represented_client_product_ids\)/);
});

test("payment, tech-pack, special-instruction, and contract warning/list logic are byte-identical to the pre-fix version", () => {
  assert.match(migration, /'message', 'Payment\/balance still needs checking\.'/);
  assert.match(migration, /where balance_due > 0/);
  assert.match(migration, /'message', 'Tech Pack has unapproved changes\.'/);
  assert.match(migration, /tp\.status in \('needs_client_approval', 'updated_needs_reapproval', 'draft'\)/);
  assert.match(migration, /concat\('Client has active ', replace\(si\.instruction_type, '_', ' '\), ' instruction: ', left\(si\.instruction, 120\)\)/);
  assert.match(migration, /from public\.client_contract_acceptances ca/);
});

test("the 8 manual checklist rows and their defaults are untouched", () => {
  for (const [key, label] of [
    ["quote_approved", "Quote approved"],
    ["artwork_files_attached", "Artwork/files attached"],
    ["artwork_mockup_approved", "Artwork/mockup approved"],
    ["tech_pack_checked", "Tech Pack checked"],
    ["special_instructions_checked", "Special instructions checked"],
    ["payment_balance_checked", "Payment/balance checked"],
    ["contract_terms_accepted", "Contract/terms accepted if required"],
    ["production_notes_reviewed", "Production notes reviewed"],
  ]) {
    assert.match(migration, new RegExp(`\\('${key}', '${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  }
  assert.doesNotMatch(migration, /insert into public\.order_production_readiness_checks/);
  assert.doesNotMatch(migration, /update public\.order_production_readiness_checks/);
});

test("the ready_state formula is untouched", () => {
  assert.match(migration, /when needs_attention_count > 0 or jsonb_array_length\(warnings_json\) > 0 then 'needs_attention'/);
  assert.match(migration, /when pending_count > 0 then 'pending'/);
  assert.match(migration, /else 'ready'/);
});

test("no schema change — no create table, no alter table, no new column", () => {
  assert.doesNotMatch(migration, /create table/i);
  assert.doesNotMatch(migration, /alter table/i);
});

test("only get_order_production_readiness is defined/replaced — no other RPC, trigger, or client approval/artwork function is touched", () => {
  const createOrReplaceMatches = migration.match(/create or replace function public\.(\w+)/g) || [];
  assert.deepEqual(createOrReplaceMatches, ["create or replace function public.get_order_production_readiness"]);
  for (const protectedFn of [
    "record_client_product_approval_on_behalf",
    "confirm_client_product_artwork_production_file",
    "_compute_order_line_production_readiness",
    "get_order_line_production_readiness",
    "_enforce_order_production_readiness_gate",
    "_enforce_order_paxi_dispatch_gate",
    "update_order_production_readiness_check",
  ]) {
    assert.doesNotMatch(migration, new RegExp(`create (or replace )?function public\\.${protectedFn}\\(`));
  }
});

test("the ACL grant/revoke shape is preserved exactly", () => {
  assert.match(migration, /grant execute on function public\.get_order_production_readiness\(uuid\) to authenticated;/);
  assert.match(migration, /revoke execute on function public\.get_order_production_readiness\(uuid\) from anon;/);
});
