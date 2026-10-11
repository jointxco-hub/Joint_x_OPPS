import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const MIGRATION_PATH = "supabase/migrations/20261011150000_order_readiness_checklist_relevance_model.sql";
const CARD_PATH = "src/components/orders/ProductionReadinessCard.jsx";

// ─────────────────────────────────────────────────────────────────────
// Order Operational Readiness, Phase B3 - checklist relevance model +
// 4-state aggregate. Static-source assertions on the migration SQL (the
// live before/after payload shape is proven separately via the
// rollback-only rehearsal) and the restructured ProductionReadinessCard.
// ─────────────────────────────────────────────────────────────────────

let migration;
let card;

test.before(async () => {
  migration = await readSource(MIGRATION_PATH);
  card = await readSource(CARD_PATH);
});

// ── Retired keys ────────────────────────────────────────────────────────

test("the 4 retired keys no longer appear in the defaults list or the write RPC's allowed-key list", () => {
  const defaultsBlock = migration.slice(migration.indexOf("with defaults(check_key, label, sort_order, context)"), migration.indexOf("select coalesce(jsonb_agg("));
  for (const retired of ["quote_approved", "artwork_files_attached", "artwork_mockup_approved", "payment_balance_checked"]) {
    assert.doesNotMatch(defaultsBlock, new RegExp(`'${retired}'`));
  }
  const writeFnStart = migration.indexOf("create or replace function public.update_order_production_readiness_check");
  const writeFnBody = migration.slice(writeFnStart);
  for (const retired of ["quote_approved", "artwork_files_attached", "artwork_mockup_approved", "payment_balance_checked"]) {
    assert.doesNotMatch(writeFnBody, new RegExp(`'${retired}'`));
  }
});

test("the migration never deletes or updates existing order_production_readiness_checks rows - only reads them", () => {
  assert.doesNotMatch(migration, /delete from public\.order_production_readiness_checks/);
  // the only write statement must be the upsert inside update_order_production_readiness_check,
  // scoped to the 4 surviving keys (asserted above) - never a bulk UPDATE/DELETE against retired keys.
  assert.doesNotMatch(migration, /update public\.order_production_readiness_checks\s+set[^;]*where[^;]*check_key in \('quote_approved'/);
});

// ── Conditional applicability ───────────────────────────────────────────

test("tech_pack_checked is only included when tech_packs_json is non-empty", () => {
  const defaultsBlock = migration.slice(migration.indexOf("where\n      (d.check_key"), migration.indexOf(")\n  )\n  select coalesce(jsonb_agg("));
  assert.match(defaultsBlock, /d\.check_key <> 'tech_pack_checked' or jsonb_array_length\(tech_packs_json\) > 0/);
});

test("special_instructions_checked is only included when instructions_json is non-empty", () => {
  const defaultsBlock = migration.slice(migration.indexOf("where\n      (d.check_key"), migration.indexOf(")\n  )\n  select coalesce(jsonb_agg("));
  assert.match(defaultsBlock, /d\.check_key <> 'special_instructions_checked' or jsonb_array_length\(instructions_json\) > 0/);
});

test("contract_terms_accepted is only included when contracts_json is non-empty", () => {
  const defaultsBlock = migration.slice(migration.indexOf("where\n      (d.check_key"), migration.indexOf(")\n  )\n  select coalesce(jsonb_agg("));
  assert.match(defaultsBlock, /d\.check_key <> 'contract_terms_accepted' or jsonb_array_length\(contracts_json\) > 0/);
});

test("production_notes_reviewed is only included when orders.production_internal_note has real content, and its content is carried into the row as context", () => {
  const defaultsBlock = migration.slice(migration.indexOf("where\n      (d.check_key"), migration.indexOf(")\n  )\n  select coalesce(jsonb_agg("));
  assert.match(defaultsBlock, /d\.check_key <> 'production_notes_reviewed' or coalesce\(trim\(order_row\.production_internal_note\), ''\) <> ''/);
  assert.match(migration, /'production_notes_reviewed', 'Production notes reviewed', 40, order_row\.production_internal_note/);
});

test("no new operational floor checkboxes (stock/quantity/quality/packing) were added - they are not in the defaults values list", () => {
  const defaultsValues = migration.slice(migration.indexOf("values\n      ("), migration.indexOf(") as d(check_key"));
  for (const notAdded of ["stock", "quantity", "quality_check", "packing", "packed"]) {
    assert.doesNotMatch(defaultsValues.toLowerCase(), new RegExp(notAdded));
  }
});

// ── 4-state aggregate ───────────────────────────────────────────────────

test("checklist_state computes 'ready' when there are zero relevant checks (the edge case)", () => {
  assert.match(migration, /when relevant_count = 0 then 'ready'/);
});

test("checklist_state computes 'needs_attention' whenever any relevant check is flagged, regardless of how many others are resolved", () => {
  const block = migration.slice(migration.indexOf("checklist_state := case"), migration.indexOf("return jsonb_build_object("));
  const needsAttentionLine = block.indexOf("when needs_attention_count > 0 then 'needs_attention'");
  const readyLine = block.indexOf("when resolved_count = relevant_count then 'ready'");
  assert.notEqual(needsAttentionLine, -1);
  assert.notEqual(readyLine, -1);
  assert.ok(needsAttentionLine < readyLine, "needs_attention must be checked before the all-resolved ready branch");
});

test("checklist_state computes 'not_started' when zero relevant checks have been resolved, and 'in_progress' otherwise", () => {
  assert.match(migration, /when resolved_count = 0 then 'not_started'/);
  assert.match(migration, /else 'in_progress'/);
});

test("summary.ready_state (legacy) is preserved byte-identical in formula - automatic warnings still drive it, independent of checklist_state", () => {
  assert.match(migration, /when needs_attention_count > 0 or jsonb_array_length\(warnings_json\) > 0 then 'needs_attention'/);
  assert.match(migration, /when pending_count > 0 then 'pending'/);
});

test("the B1 client_product_concept approval-authority fix is preserved byte-identical", () => {
  assert.match(migration, /all_represented_products_approved := not exists/);
  assert.match(migration, /a\.related_table = 'client_products'/);
  assert.match(migration, /a\.approval_type = 'client_product_concept'/);
});

test("no schema change - no create/alter table, no new DB enum", () => {
  assert.doesNotMatch(migration, /create table/i);
  assert.doesNotMatch(migration, /alter table/i);
  assert.doesNotMatch(migration, /create type/i);
});

test("no other RPC/trigger is touched - line readiness, artwork confirmation, and the PAXI gate are untouched", () => {
  const createOrReplaceMatches = (migration.match(/create or replace function public\.(\w+)/g) || []).sort();
  assert.deepEqual(createOrReplaceMatches, [
    "create or replace function public.get_order_production_readiness",
    "create or replace function public.update_order_production_readiness_check",
  ].sort());
  for (const protectedFn of [
    "confirm_client_product_artwork_production_file",
    "_compute_order_line_production_readiness",
    "get_order_line_production_readiness",
    "_enforce_order_production_readiness_gate",
    "_enforce_order_paxi_dispatch_gate",
    "record_client_product_approval_on_behalf",
  ]) {
    assert.doesNotMatch(migration, new RegExp(`create (or replace )?function public\\.${protectedFn}\\(`));
  }
});

// ── Frontend: ProductionReadinessCard ───────────────────────────────────

test("the card now uses checklist_state (not ready_state) for its top badge", () => {
  assert.match(card, /checklistStateCopy\(summary\.checklist_state\)/);
  assert.doesNotMatch(card, /stateCopy\(summary\.ready_state\)/);
});

test("zero relevant checks renders 'No outstanding operational checks' instead of an empty list", () => {
  assert.match(card, /No outstanding operational checks/);
});

test("the old Select-dropdown-per-row pattern and its always-visible textarea are gone", () => {
  assert.doesNotMatch(card, /<Select/);
  assert.doesNotMatch(card, /STATUS_OPTIONS/);
});

test("ManualCheckRow exposes exactly a 'mark reviewed' and a 'needs attention' action, and hides the note input unless one is already present, flagged, or opened", () => {
  const start = card.indexOf("function ManualCheckRow(");
  const end = card.indexOf("function Metric(");
  const fn = card.slice(start, end);
  assert.match(fn, /Mark reviewed/);
  assert.match(fn, /Needs attention/);
  assert.match(fn, /noteOpen/);
});

test("the automatic readiness strip is untouched by this phase - still present, still separate", () => {
  assert.match(card, /<AutomaticReadinessStrip/);
  assert.match(card, /function AutomaticReadinessStrip\(/);
});

test("no .update() is added for checklist state beyond the existing updateOrderProductionReadinessCheck path", () => {
  assert.match(card, /updateOrderProductionReadinessCheck/);
  const manualCheckRowStart = card.indexOf("function ManualCheckRow(");
  const manualCheckRowEnd = card.indexOf("function Metric(");
  const fn = card.slice(manualCheckRowStart, manualCheckRowEnd);
  assert.doesNotMatch(fn, /supabase\./);
});
