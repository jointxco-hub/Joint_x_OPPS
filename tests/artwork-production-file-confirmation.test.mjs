import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const MIGRATION_PATH = "supabase/migrations/20261011120000_artwork_production_file_confirmation.sql";
const API_PATH = "src/api/artworkLinking.js";
const SECTION_PATH = "src/components/clients/ClientProductsSection.jsx";

// ─────────────────────────────────────────────────────────────────────
// Artwork Approval - Phase B. Production-FILE confirmation, a concept
// kept deliberately separate from the customer concept/design approval
// (client_approvals / approval_type='client_product_concept',
// Client Product Approval Phase B-E). Static-source assertions, same
// convention as every other migration/API/component test in this suite -
// the live behavior is verified separately via a rollback-only rehearsal.
// ─────────────────────────────────────────────────────────────────────

let migration;
let api;
let section;

test.before(async () => {
  migration = await readSource(MIGRATION_PATH);
  api = await readSource(API_PATH);
  section = await readSource(SECTION_PATH);
});

// ── No raw browser-side status update; RPC-only decision path ──────
test("no code anywhere writes client_product_artwork.status directly - only through the new RPC wrapper", async () => {
  for (const src of [api, section]) {
    assert.doesNotMatch(src, /ClientProductArtwork\.(update|create|delete)\(/);
    assert.doesNotMatch(src, /from\(["']client_product_artwork["']\)\s*\.\s*update/);
  }
});

test("the API wrapper calls confirm_client_product_artwork_production_file by name", async () => {
  assert.match(api, /supabase\.rpc\("confirm_client_product_artwork_production_file"/);
});

test("the migration defines the new RPC and never redefines any of the protected functions", () => {
  assert.match(migration, /create or replace function public\.confirm_client_product_artwork_production_file\(/);
  for (const protectedFn of [
    "approve_client_product_concept",
    "_client_product_has_current_approval",
    "record_client_product_approval_on_behalf",
    "_compute_order_line_production_readiness",
    "_compute_artwork_readiness",
  ]) {
    assert.doesNotMatch(migration, new RegExp(`create (or replace )?function public\\.${protectedFn}\\(`));
  }
});

// ── Owner/admin/app-admin authorization, never has_tenant_permission ──
test("authorization is is_app_admin() OR an active owner/admin tenant_memberships row on the ARTWORK'S OWN PRODUCT's tenant_id - never has_tenant_permission(), never a browser-supplied tenant/client/product id", () => {
  const start = migration.indexOf("create or replace function public.confirm_client_product_artwork_production_file(");
  assert.notEqual(start, -1);
  const body = migration.slice(start, migration.indexOf("$function$;", start));
  assert.match(body, /public\.is_app_admin\(\)/);
  assert.match(body, /tm\.tenant_id = v_product\.tenant_id/);
  assert.match(body, /tm\.tenant_role in \('owner', 'admin'\)/);
  assert.match(body, /tm\.status = 'active'/);
  const codeOnly = body.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
  assert.doesNotMatch(codeOnly, /has_tenant_permission/);
  assert.match(body, /ARTWORK_REVIEW_DENIED/);
  // tenant is derived from the artwork row's OWN product - the function
  // signature accepts no tenant/client/product id parameter at all.
  const sigStart = migration.indexOf("function public.confirm_client_product_artwork_production_file(");
  const sigEnd = migration.indexOf(")", migration.indexOf("default null", sigStart));
  const signature = migration.slice(sigStart, sigEnd);
  assert.doesNotMatch(signature, /p_tenant_id|p_client_id|p_client_product_id/);
});

// ── Guards ───────────────────────────────────────────────────────────
test("wrong revision is rejected", () => {
  assert.match(migration, /if p_expected_revision is distinct from v_artwork\.revision then/);
  assert.match(migration, /ARTWORK_REVIEW_REVISION_CHANGED/);
});

test("a non-current (historical) revision is rejected outright - it is never reviewable through this workflow", () => {
  assert.match(migration, /if not v_artwork\.is_current then/);
  assert.match(migration, /ARTWORK_REVIEW_NOT_CURRENT/);
});

test("duplicate/no-op decisions are rejected - a decision identical to the current status writes nothing", () => {
  assert.match(migration, /if v_artwork\.status = v_decision then/);
  assert.match(migration, /ARTWORK_REVIEW_NO_CHANGE/);
});

test("the decision must be exactly 'approved' or 'rejected' - never 'pending' or 'superseded' through this action", () => {
  assert.match(migration, /if v_decision not in \('approved', 'rejected'\) then/);
  assert.match(migration, /ARTWORK_REVIEW_DECISION_INVALID/);
});

// ── Activity event + audit fields ───────────────────────────────────
test("exactly one opps_activity_events row is written per decision, with distinct event types for approve vs reject", () => {
  assert.match(migration, /insert into public\.opps_activity_events \(/);
  assert.match(migration, /'client_product_artwork_production_confirmed'/);
  assert.match(migration, /'client_product_artwork_changes_requested'/);
});

test("the migration adds exactly the 4 additive audit columns and touches no existing column", () => {
  for (const col of ["confirmed_by_user_id uuid null", "confirmed_by_label text null", "confirmed_at timestamptz null", "review_note text null"]) {
    assert.match(migration, new RegExp(`add column if not exists ${col.replace(/\s+/g, "\\s+")}`));
  }
  assert.doesNotMatch(migration, /drop column/);
  assert.doesNotMatch(migration, /alter column/i);
});

test("the update sets status, confirmed_by_user_id/label, confirmed_at, and review_note together in one statement", () => {
  const updateStart = migration.indexOf("update public.client_product_artwork");
  assert.notEqual(updateStart, -1);
  const updateBlock = migration.slice(updateStart, migration.indexOf("returning * into v_artwork;", updateStart));
  assert.match(updateBlock, /status = v_decision/);
  assert.match(updateBlock, /confirmed_by_user_id = v_user_id/);
  assert.match(updateBlock, /confirmed_by_label = v_staff_label/);
  assert.match(updateBlock, /confirmed_at = now\(\)/);
  assert.match(updateBlock, /review_note = v_note/);
});

// ── Readiness: approved vs rejected wording stays the DB's own ──────
test("the UI maps artwork status to the three required labels, never a generic Approve", async () => {
  assert.match(section, /pending: "Pending production confirmation"/);
  assert.match(section, /approved: "Production file confirmed"/);
  assert.match(section, /rejected: "Changes requested"/);
  assert.match(section, /Confirm production file/);
  assert.match(section, /Request changes/);
  assert.doesNotMatch(section, />\s*Approve\s*<\/Button>/);
});

// ── Historical Sky Blue isolation / current-only actions ────────────
test("review actions are rendered only inside the `current` (is_current) placement row, never for a historical row", async () => {
  const tabStart = section.indexOf("function ArtworkTab(");
  assert.notEqual(tabStart, -1);
  const tabBody = section.slice(tabStart, section.indexOf("\nfunction RequiredPlacementsEditor(", tabStart));
  const actionsBlockStart = tabBody.indexOf("Production-file review actions");
  assert.notEqual(actionsBlockStart, -1);
  const before = tabBody.slice(0, actionsBlockStart);
  // the review-actions block must be inside the `{current && ( ... )}` guard
  const guardIndex = before.lastIndexOf("{current && (");
  assert.notEqual(guardIndex, -1, "review actions must be nested inside the current-row guard, not a historical list");
});

// ── Snapshots / client concept approvals untouched ──────────────────
test("the migration never writes order_line_component_snapshots or client_approvals", () => {
  assert.doesNotMatch(migration, /(insert into|update|delete from)\s+public\.order_line_component_snapshots/);
  assert.doesNotMatch(migration, /(insert into|update|delete from)\s+public\.client_approvals/);
});

test("the ArtworkTab review dialog explicitly states this confirms the FILE only, not client design approval", async () => {
  assert.match(section, /This confirms the production FILE only - it does not change whether the client has approved the design\./);
});

// ── ACL ──────────────────────────────────────────────────────────────
test("the new RPC is revoked from public/anon and granted only to authenticated", () => {
  assert.match(migration, /revoke all on function public\.confirm_client_product_artwork_production_file\(uuid, integer, text, text\) from public, anon;/);
  assert.match(migration, /grant execute on function public\.confirm_client_product_artwork_production_file\(uuid, integer, text, text\) to authenticated;/);
});
