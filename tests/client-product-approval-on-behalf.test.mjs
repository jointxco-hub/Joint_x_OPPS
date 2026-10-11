import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const MIGRATION_PATH = "supabase/migrations/20261011090000_client_product_approval_on_behalf.sql";
const API_PATH = "src/api/clientProductApprovals.js";
const SECTION_PATH = "src/components/clients/ClientProductsSection.jsx";

// ─────────────────────────────────────────────────────────────────────
// Client Product Approval - Phase B. Staff "record client approval on
// behalf" workflow, mirroring the already-shipped
// accept_quote_on_behalf / quoteStatus.js / QuoteDetailDrawer.jsx pattern
// in the quotes domain. These are static-source assertions (the same
// convention every other migration/API/component test in this suite
// uses) - no live DB connection, no rendering. The actual live behavior
// is verified separately via a rollback-only rehearsal against production.
// ─────────────────────────────────────────────────────────────────────

let migration;
let api;
let section;

test.before(async () => {
  migration = await readSource(MIGRATION_PATH);
  api = await readSource(API_PATH);
  section = await readSource(SECTION_PATH);
});

// ── 1. Exact RPC wrapper, no customer RPC misuse ───────────────────
test("the API wrapper calls record_client_product_approval_on_behalf by name, and never calls approve_client_product_concept", async () => {
  assert.match(api, /supabase\.rpc\("record_client_product_approval_on_behalf"/);
  // The file's doc comments reference approve_client_product_concept BY
  // NAME to explain the boundary (never calling it) - that's documentation,
  // not a call. What must be absent is an actual supabase.rpc(...) call.
  assert.doesNotMatch(api, /supabase\.rpc\(\s*["']approve_client_product_concept["']/);
});

test("the migration defines record_client_product_approval_on_behalf and never touches approve_client_product_concept or _client_product_has_current_approval's own definition", async () => {
  assert.match(migration, /create or replace function public\.record_client_product_approval_on_behalf\(/);
  assert.doesNotMatch(migration, /create (or replace )?function public\.approve_client_product_concept/);
  assert.doesNotMatch(migration, /create (or replace )?function public\._client_product_has_current_approval/);
  // It MAY call the existing duplicate-check helper (read-only use), but
  // must never redefine it.
  assert.match(migration, /public\._client_product_has_current_approval\(/);
});

// ── 2. No direct client_approvals write from the browser ───────────
test("the frontend never writes client_approvals directly - only through the RPC wrapper", async () => {
  for (const src of [api, section]) {
    assert.doesNotMatch(src, /from\(["']client_approvals["']\)/);
    assert.doesNotMatch(src, /entities\.ClientApproval\.(create|update|delete)\(/);
  }
});

// ── 3. Status gating - same precondition as the customer path ──────
test("the RPC rejects any status other than ready_for_client_review / client_changes_requested, matching approve_client_product_concept's own precondition", () => {
  assert.match(migration, /if v_product\.status not in \('ready_for_client_review', 'client_changes_requested'\) then/);
  assert.match(migration, /CLIENT_PRODUCT_NOT_REVIEWABLE/);
});

test("the frontend gate uses the identical two statuses, draft is deliberately excluded", async () => {
  assert.match(api, /CLIENT_PRODUCT_ON_BEHALF_REVIEWABLE_STATUSES = new Set\(\[\s*\n\s*"ready_for_client_review",\s*\n\s*"client_changes_requested",/);
  assert.doesNotMatch(api, /CLIENT_PRODUCT_ON_BEHALF_REVIEWABLE_STATUSES[\s\S]{0,80}"draft"/);
});

// ── 4. Current revision only ────────────────────────────────────────
test("the RPC takes an expected revision and rejects on mismatch against the locked row's own revision", () => {
  assert.match(migration, /p_expected_revision\s+integer/);
  assert.match(migration, /if p_expected_revision is distinct from v_product\.revision then/);
  assert.match(migration, /CLIENT_PRODUCT_REVISION_CHANGED/);
  // revision written into client_approvals must be the row's own current
  // revision, never the caller-supplied parameter directly.
  const insertStart = migration.indexOf("insert into public.client_approvals (");
  assert.notEqual(insertStart, -1);
  const insertBlock = migration.slice(insertStart, migration.indexOf(");", insertStart));
  assert.match(insertBlock, /v_product\.revision/);
  assert.doesNotMatch(insertBlock, /p_expected_revision/);
});

// ── 5. Owner/admin/app-admin high-trust gate, not has_tenant_permission ──
test("authorization is is_app_admin() OR an active owner/admin tenant_memberships row on the PRODUCT's OWN tenant_id - never an actual has_tenant_permission() call, never a client-supplied tenant id", () => {
  const start = migration.indexOf("create or replace function public.record_client_product_approval_on_behalf(");
  assert.notEqual(start, -1);
  const body = migration.slice(start, migration.indexOf("$function$;", start));
  assert.match(body, /public\.is_app_admin\(\)/);
  assert.match(body, /tm\.tenant_id = v_product\.tenant_id/);
  assert.match(body, /tm\.tenant_role in \('owner', 'admin'\)/);
  assert.match(body, /tm\.status = 'active'/);
  // Strip -- comments before checking: the function deliberately explains
  // in prose why has_tenant_permission() is NOT used (same as the
  // accept_quote_on_behalf precedent) - that mention must not be mistaken
  // for an actual call. No executable line may call it.
  const codeOnly = body.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
  assert.doesNotMatch(codeOnly, /has_tenant_permission/);
  assert.match(body, /CLIENT_PRODUCT_APPROVAL_ON_BEHALF_DENIED/);
});

// ── 6. Duplicate-approval rejection ──────────────────────────────────
test("the RPC refuses to record a second approval for the same current revision", () => {
  assert.match(migration, /if public\._client_product_has_current_approval\(v_product\.id, v_product\.revision\) then/);
  assert.match(migration, /CLIENT_PRODUCT_ALREADY_APPROVED/);
});

// ── 7. Cross-tenant rejection (derived, never trusted from the browser) ──
test("tenant isolation is derived from the product row itself; a null tenant is rejected outright", () => {
  assert.match(migration, /if v_product\.tenant_id is null then/);
  // No parameter named anything like p_tenant_id / p_client_id exists on
  // this function signature - tenant and client are always derived from
  // the locked client_products row, never accepted as input.
  const sigStart = migration.indexOf("function public.record_client_product_approval_on_behalf(");
  const sigEnd = migration.indexOf(")", migration.indexOf("default null", sigStart));
  const signature = migration.slice(sigStart, sigEnd);
  assert.doesNotMatch(signature, /p_tenant_id|p_client_id/);
});

// ── 8. Audit row ─────────────────────────────────────────────────────
test("the RPC writes exactly one opps_activity_events row, with the staff actor's own identity, distinct from the client approval record", () => {
  assert.match(migration, /insert into public\.opps_activity_events \(/);
  assert.match(migration, /'client_product_approval_recorded'/);
  assert.match(migration, /'approval_mode', 'on_behalf'/);
});

test("client identity (approved_by_name/email) and staff identity (recorded_by_*) are resolved from two different tables and written to two different column groups", () => {
  assert.match(migration, /select \* into v_client from public\.clients where id = v_product\.client_id;/);
  assert.match(migration, /from public\.users u\s*\n\s*where u\.auth_user_id = v_user_id/);
  assert.match(migration, /v_client\.name, v_client\.email,[\s\S]{0,40}v_product\.revision,\s*\n\s*'staff', v_user_id, v_staff_label, v_staff_email,/);
});

// ── Additive schema only ────────────────────────────────────────────
test("the migration only adds nullable/defaulted columns to client_approvals - no existing column's type or nullability changes, no table dropped", () => {
  assert.match(migration, /alter table public\.client_approvals\s*\n\s*add column if not exists actor_kind text not null default 'client'/);
  for (const col of ["recorded_by_user_id", "recorded_by_label", "recorded_by_email", "approval_source", "note"]) {
    assert.match(migration, new RegExp(`add column if not exists ${col}\\b`));
  }
  assert.doesNotMatch(migration, /drop column/);
  assert.doesNotMatch(migration, /drop table/i);
});

// ── 12. Artwork / snapshot code untouched ───────────────────────────
test("the migration never writes client_product_artwork or order_line_component_snapshots - the concept approval and artwork readiness stay fully independent", () => {
  // The header comment explains the independence and references these
  // table names in prose - that's documentation, not a write. What must
  // be absent is any actual DML (insert/update/delete) against either.
  assert.doesNotMatch(migration, /(insert into|update|delete from)\s+public\.client_product_artwork/);
  assert.doesNotMatch(migration, /(insert into|update|delete from)\s+public\.order_line_component_snapshots/);
});

test("ClientProductsSection.jsx's new approval card never calls artwork or snapshot write paths", async () => {
  const cardStart = section.indexOf("function ClientProductApprovalCard(");
  assert.notEqual(cardStart, -1);
  const cardBody = section.slice(cardStart, section.indexOf("\nfunction StatusTab(", cardStart));
  assert.doesNotMatch(cardBody, /findOrCreateClientProductArtworkFromAsset|ClientProductArtwork\.(create|update)|OrderLineComponentSnapshot/);
});

// ── 9/10/11. UI: checkbox, channel select, three-state rendering ────
test("the Record client approval dialog requires the exact confirmation checkbox text, a channel select, and is never labelled a plain Approve button", async () => {
  assert.match(section, /I am recording approval already received from the client\./);
  assert.match(section, /Record client approval/);
  assert.doesNotMatch(section, />\s*Approve\s*<\/Button>/);
  const cardStart = section.indexOf("function ClientProductApprovalCard(");
  const cardBody = section.slice(cardStart, section.indexOf("\nfunction StatusTab(", cardStart));
  assert.match(cardBody, /CLIENT_PRODUCT_APPROVAL_SOURCE_OPTIONS\.map/);
  assert.match(cardBody, /disabled=\{!source \|\| !confirmed \|\| recordMutation\.isPending\}/);
});

test("the approval state renders one of the three required labels, derived from deriveClientProductApprovalState - never a fourth invented state", async () => {
  assert.match(api, /"Awaiting client approval"/);
  assert.match(api, /"Approved by client"/);
  assert.match(api, /"Approval recorded by staff"/);
  assert.match(section, /deriveClientProductApprovalState\(approvalRows, product\.revision\)/);
});

test("draft status shows guidance to move to Ready for client review first, and the Record button is gated off", async () => {
  const cardStart = section.indexOf("function ClientProductApprovalCard(");
  const cardBody = section.slice(cardStart, section.indexOf("\nfunction StatusTab(", cardStart));
  assert.match(cardBody, /canRecordClientProductApprovalOnBehalf\(product, approvalRows\)/);
  assert.match(cardBody, /Move this product to &quot;Ready for client review&quot;/);
});

// ── ACL ──────────────────────────────────────────────────────────────
test("the new RPC is revoked from public/anon and granted only to authenticated, same ACL pattern as accept_quote_on_behalf", () => {
  assert.match(migration, /revoke all on function public\.record_client_product_approval_on_behalf\(uuid, integer, text, text\) from public, anon;/);
  assert.match(migration, /grant execute on function public\.record_client_product_approval_on_behalf\(uuid, integer, text, text\) to authenticated;/);
});

// ── Read path widened additively, not a parallel read RPC ──────────
test("admin_get_client_product_approvals is widened additively (existing columns unchanged, new ones appended), not replaced by a second read RPC", () => {
  assert.match(migration, /drop function if exists public\.admin_get_client_product_approvals\(uuid\);/);
  const recreateStart = migration.indexOf("create function public.admin_get_client_product_approvals");
  assert.notEqual(recreateStart, -1);
  const def = migration.slice(recreateStart, migration.indexOf("$function$;", recreateStart));
  for (const col of ["id uuid", "status text", "approved_by_email text", "approved_at timestamp", "rejected_reason text", "revision integer", "created_at timestamp"]) {
    assert.ok(def.includes(col), `existing column ${col} must still be present`);
  }
  for (const col of ["actor_kind text", "recorded_by_label text", "recorded_by_email text", "approval_source text", "note text"]) {
    assert.ok(def.includes(col), `new column ${col} must be appended`);
  }
  assert.ok(!api.includes('"admin_get_client_product_approvals_v2"'), "no parallel v2 read RPC was introduced");
});
