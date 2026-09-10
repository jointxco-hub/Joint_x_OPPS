import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

// ─────────────────────────────────────────────────────────────────────
// Phase 2A - Product Composition clone primitive. Staff had no way to
// reuse an existing product_components setup; every near-identical
// configuration had to be rebuilt component by component. Foundational
// for the SFR variant system (configure once -> duplicate -> change only
// what differs).
//
// Live-verified via a rolled-back (BEGIN/ROLLBACK) transaction against
// production, run twice (once before, once after fixing a real bug this
// pass's own testing caught - see below):
//
//   Layer 1 (real production sanity, JET as source):
//     - JET T-Shirt (bf31e82b-905d-4ede-af79-7e4a1f1b4688) has exactly
//       one real, clean, active component (print_service/vinyl, R78).
//       (Correction to this phase's original brief: the 6-component set
//       audited earlier belongs to SFR - test/scratch data, correctly
//       excluded as a clone source per instruction - not JET.)
//     - Cloned into a disposable target client_product (same tenant +
//       client as JET): result {ok:true, cloned_count:1}, target got one
//       new component with a new id, client_product_id pointing at the
//       target, created_at/updated_at regenerated (2026-08-24 vs JET's
//       original 2026-08-22), created_by = acting staff auth uid.
//     - JET's own row and its one component were BYTE-FOR-BYTE identical
//       before and after (compared as full jsonb objects) - confirmed via
//       direct comparison, not spot-checked fields.
//     - Retrying the exact same clone call against the now-populated
//       target: rejected with "Target product already has a
//       composition.", target component count stayed at 1, and the
//       opps_activity_events count for that target stayed at 1 (no
//       audit event from the rejected retry) - double-click safety
//       confirmed structurally, not just by inspection.
//
//   Layer 2 (synthetic multi-component, fully disposable pair):
//     - Seeded 6 components on a disposable source: blank_garment (with
//       a real inventory_product_id), print_service (dtf, placement
//       "front", qty 2), packaging (once_per_order), setup_fee
//       (once_per_order), labour (qty 3), and one is_active:false row.
//     - Cloned: {ok:true, cloned_count:6}, 6 new distinct ids, exact
//       sort_order/quantity_per_unit/placement/production_colour/
//       specification/notes/billing_mode/is_active preserved per row
//       (including the inactive row staying inactive), source rows
//       proven byte-for-byte unchanged after the clone (JSON-compared,
//       not just row-counted).
//
//   Negative paths, all live-verified in the same transaction:
//     - Cross-client (JET -> Jai's X1 Crochet Wide Leg Pant, same
//       tenant, different client): rejected with
//       COMPOSITION_CLONE_CROSS_CLIENT before any write.
//     - Cross-tenant (disposable tenant/client/target): rejected with
//       COMPOSITION_CLONE_FORBIDDEN (no reviewer access to target
//       tenant) - fires on the permission guard, ahead of the
//       structural tenant-match guard, matching the required
//       validation order.
//     - Unresolvable actor identity (random auth uid with no
//       public.users row): rejected with COMPOSITION_CLONE_ACTOR_
//       UNRESOLVED.
//     - Empty source (disposable product with zero components):
//       rejected with COMPOSITION_CLONE_EMPTY_SOURCE.
//
// A real bug was caught and fixed by this pass's own testing before any
// of the above ran clean: the original migration draft captured the
// INSERT's own RETURNING clause into a scalar variable
// (`returning id into v_cloned_ids[1]`), which errors on any multi-row
// clone ("query returned more than one row") - exactly the case Layer 2
// exists to prove. Fixed by dropping that RETURNING entirely and
// re-selecting the cloned ids by client_product_id afterward.
//
// Concurrency fix (post-review): the target's target-empty check and the
// clone insert were not serialized against a second concurrent clone
// call targeting the same product - two transactions could both observe
// an empty target before either inserted. Fixed with `select ... for
// update` on the target client_products row, acquired at target
// resolution (before every later check/the insert). Live-verified with
// TWO GENUINELY CONCURRENT database connections (not simulated) against
// a temporarily-installed copy of the function, real disposable fixture
// rows since cross-session visibility requires real commits (rollback
// alone cannot demonstrate blocking across sessions):
//   - Session A: manually pre-acquired the target's row lock, held it
//     under `pg_sleep(4)`, then called duplicate_product_composition
//     (source had 3 components), then committed.
//   - Session B: launched 1.5s into A's sleep, called
//     duplicate_product_composition directly against the same
//     source/target - its own internal `for update` blocked until A
//     committed and released the lock.
//   - Result: A -> {ok:true, cloned_count:3}. B -> genuinely blocked
//     (its response only returned once A committed, ~2.5s later), then
//     rejected with the exact "Target product already has a
//     composition." error, seeing A's now-committed rows.
//   - Final state: target_component_count = 3 = source_component_count
//     (never 6/doubled). activity_event_count = 1, matching A's own
//     activity_event_id exactly - B produced no event.
// The temporarily-installed function and every disposable row (including
// the activity event) were then deleted/dropped, confirmed byte-for-byte
// reverted to the pre-test state - production carries zero trace of this
// test run.
//
// Source consistency was also audited per review: the clone's INSERT ...
// SELECT is one statement, and under this project's default READ
// COMMITTED isolation a single statement reads one consistent snapshot
// of the source composition as of that statement's start - sufficient
// for "one clone sees one transactionally-consistent source." The source
// client_products row is deliberately NOT locked - doing so would only
// block a staff member concurrently editing that source's own
// composition, which this function has no reason to prevent.
// ─────────────────────────────────────────────────────────────────────

const MIGRATION_PATH = "supabase/migrations/20260824100000_product_composition_clone.sql";
const UI_PATH = "src/pages/CatalogManagement.jsx";

test("the migration is additive only - no drop/truncate/delete against product_components or client_products", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(!/drop table|drop column|truncate|delete from/i.test(source));
});

test("clone field mapping: cloned fields copy verbatim from the source SELECT list", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("insert into public.product_components (");
  const selectStart = source.indexOf("select", start);
  const fromStart = source.indexOf("from public.product_components", selectStart);
  const selectList = source.slice(selectStart, fromStart);
  for (const field of [
    "component_type", "production_method", "placement", "production_colour",
    "specification", "production_instructions", "default_sell_price",
    "quantity_per_unit", "sort_order", "inventory_product_id",
    "fixed_inventory_variant_id", "label", "notes", "is_active", "billing_mode",
  ]) {
    assert.ok(selectList.includes(field), `${field} must be selected verbatim from the source row`);
  }
});

test("clone field mapping: id/client_product_id/tenant_id/created_at/updated_at/created_by are all regenerated, never copied from the source row", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("insert into public.product_components (");
  const selectStart = source.indexOf("select", start);
  const fromStart = source.indexOf("from public.product_components", selectStart);
  const selectList = source.slice(selectStart, fromStart);
  assert.ok(selectList.includes("gen_random_uuid()"), "id must be freshly generated, not copied");
  assert.ok(selectList.includes("v_target.tenant_id"), "tenant_id must come from the target, not the source row");
  assert.ok(selectList.includes("p_target_client_product_id"), "client_product_id must point at the target");
  assert.ok(selectList.includes("v_actor_uid"), "created_by must be the acting staff member, not the original author");
  const nowCount = (selectList.match(/now\(\)/g) || []).length;
  assert.equal(nowCount, 2, "created_at and updated_at must both be freshly regenerated with now(), not copied");
});

test("the clone is one INSERT ... SELECT statement - atomic by construction, no per-row loop to fail partway through", async () => {
  const source = await readSource(MIGRATION_PATH);
  const fnStart = source.indexOf("create or replace function public.duplicate_product_composition");
  const fnBody = source.slice(fnStart);
  assert.ok(!/for\s+\w+\s+in\s+select/i.test(fnBody), "must not loop row-by-row over the source composition");
  assert.ok(fnBody.includes("insert into public.product_components"));
});

test("concurrency: the target row is locked (FOR UPDATE) at target resolution, before the target-empty check and before the clone insert - a row lock on one client_products row, not a table lock", async () => {
  const source = await readSource(MIGRATION_PATH);
  const fnStart = source.indexOf("create or replace function public.duplicate_product_composition");
  const body = source.slice(fnStart);
  assert.ok(
    body.includes("select * into v_target from public.client_products where id = p_target_client_product_id for update;"),
    "the target SELECT must carry FOR UPDATE, scoped to a single row by primary key - never a bare table-level LOCK statement"
  );
  assert.ok(!/lock\s+table/i.test(body), "must not use a broad table lock");
  const lockIdx = body.indexOf("for update;");
  const emptyCheckIdx = body.indexOf("select count(*) into v_target_component_count");
  const insertIdx = body.indexOf("insert into public.product_components");
  assert.ok(lockIdx !== -1 && lockIdx < emptyCheckIdx, "the lock must be acquired before the target-empty check");
  assert.ok(lockIdx < insertIdx, "the lock must be acquired before the clone insert");
});

test("concurrency: the source row is deliberately NOT locked - a single INSERT...SELECT statement already reads one consistent snapshot under READ COMMITTED, and locking the source would only block unrelated concurrent edits to it", async () => {
  const source = await readSource(MIGRATION_PATH);
  const fnStart = source.indexOf("create or replace function public.duplicate_product_composition");
  const body = source.slice(fnStart);
  const sourceSelectIdx = body.indexOf("select * into v_source from public.client_products where id = p_source_client_product_id;");
  assert.notEqual(sourceSelectIdx, -1, "the source resolution SELECT must not carry FOR UPDATE");
  assert.ok(!body.slice(0, sourceSelectIdx + 120).includes("v_source") || !/select \* into v_source[^;]*for update/i.test(body), "source row must not be locked");
});

test("no uniqueness constraint was added that would prevent legitimate multiple product_components rows per product", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(!/unique\s*\(/i.test(source) && !/add constraint.*unique/i.test(source), "no UNIQUE constraint may be introduced by this migration");
});

test("authorization: reviewer/admin permission (inventory_can_review_tenant) is checked against BOTH source and target tenant contexts, reused rather than reinvented", async () => {
  const source = await readSource(MIGRATION_PATH);
  const occurrences = (source.match(/inventory_can_review_tenant\(/g) || []).length;
  assert.ok(occurrences >= 2, "must check reviewer access on both the source and target tenant");
  assert.ok(source.includes("public.inventory_can_review_tenant(v_source.tenant_id)"));
  assert.ok(source.includes("public.inventory_can_review_tenant(v_target.tenant_id)"));
});

test("authorization: actor identity is resolved server-side from auth.uid() only, never trusts a client-supplied identity, and rejects if unresolvable", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("v_actor_uid := auth.uid();"));
  assert.ok(source.includes("where u.auth_user_id = v_actor_uid"));
  assert.ok(source.includes("if v_actor_email is null then"));
  assert.ok(source.includes("COMPOSITION_CLONE_ACTOR_UNRESOLVED"));
});

test("same-tenant AND same-client are both required server-side - v1 has no override flag", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("if v_source.tenant_id is distinct from v_target.tenant_id then"));
  assert.ok(source.includes("COMPOSITION_CLONE_CROSS_TENANT"));
  assert.ok(source.includes("if v_source.client_id is distinct from v_target.client_id then"));
  assert.ok(source.includes("COMPOSITION_CLONE_CROSS_CLIENT"));
  assert.ok(!/p_allow_cross|p_override|allow_cross_client/i.test(source), "no override parameter may exist in v1");
});

test("target-nonempty rejection: refuses if the target has ANY component row (active or inactive), exact required error text, no merge/replace/append logic", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("select count(*) into v_target_component_count");
  const body = source.slice(start, start + 300);
  assert.ok(body.includes("from public.product_components"));
  assert.ok(!body.includes("is_active"), "the target-emptiness check must count ALL rows, not filter to active-only");
  assert.ok(source.includes("'Target product already has a composition.'"));
  assert.ok(!/on conflict.*do update|merge into|update public\.product_components/i.test(source), "no merge/replace/upsert path may exist in v1");
});

test("empty-source rejection: refuses to clone a source with zero components", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("if v_source_component_count = 0 then"));
  assert.ok(source.includes("COMPOSITION_CLONE_EMPTY_SOURCE"));
});

test("self-clone (source === target) is explicitly rejected", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("if p_source_client_product_id = p_target_client_product_id then"));
  assert.ok(source.includes("COMPOSITION_CLONE_SAME_PRODUCT"));
});

test("validation order matches the required sequence: actor -> source exists -> target exists -> reviewer permission (both) -> self-clone -> tenant -> client -> target-empty -> source-nonempty -> clone -> activity event", async () => {
  const source = await readSource(MIGRATION_PATH);
  const fnStart = source.indexOf("create or replace function public.duplicate_product_composition");
  const body = source.slice(fnStart);
  const idx = (needle) => body.indexOf(needle);
  const order = [
    idx("v_actor_uid := auth.uid();"),
    idx("select * into v_source from public.client_products"),
    idx("select * into v_target from public.client_products"),
    idx("inventory_can_review_tenant(v_source.tenant_id)"),
    idx("inventory_can_review_tenant(v_target.tenant_id)"),
    idx("COMPOSITION_CLONE_SAME_PRODUCT"),
    idx("COMPOSITION_CLONE_CROSS_TENANT"),
    idx("COMPOSITION_CLONE_CROSS_CLIENT"),
    idx("Target product already has a composition."),
    idx("COMPOSITION_CLONE_EMPTY_SOURCE"),
    idx("insert into public.product_components"),
    idx("insert into public.opps_activity_events"),
  ];
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i - 1] < order[i], `step ${i} must appear after step ${i - 1} in source order`);
  }
});

test("must-not-copy: no reference to order_line_component_snapshots, order ids, line ids, client_product_artwork, or client_products pricing/quote/status/publication fields anywhere in the clone function", async () => {
  const source = await readSource(MIGRATION_PATH);
  const fnStart = source.indexOf("create or replace function public.duplicate_product_composition");
  const fnEnd = source.indexOf("$function$;", fnStart);
  const body = source.slice(fnStart, fnEnd);
  for (const forbidden of [
    "order_line_component_snapshots", "client_product_artwork", "artwork_revision",
    "client_price", "requires_quote", "set status", "visible_in_account", "approved_at", "approved_by",
  ]) {
    assert.ok(!body.includes(forbidden), `clone function must not reference ${forbidden}`);
  }
});

test("activity event: product_composition_cloned, entity_type client_products, entity_id is the TARGET, metadata carries source/target/count/ids, inserted in the same transaction as the clone (no separate commit between them)", async () => {
  const source = await readSource(MIGRATION_PATH);
  const eventStart = source.indexOf("insert into public.opps_activity_events");
  assert.notEqual(eventStart, -1);
  const body = source.slice(eventStart, eventStart + 900);
  assert.ok(body.includes("'product_composition_cloned'"));
  assert.ok(body.includes("'client_products', p_target_client_product_id"));
  assert.ok(body.includes("'source_client_product_id', p_source_client_product_id"));
  assert.ok(body.includes("'target_client_product_id', p_target_client_product_id"));
  assert.ok(body.includes("'cloned_component_count', v_cloned_count"));
  assert.ok(body.includes("'cloned_component_ids', to_jsonb(v_cloned_ids)"));
  // No commit between the product_components insert and this one -
  // both live inside the same top-level `begin ... commit;` migration
  // transaction wrapper and the same plpgsql function body (which is
  // itself always atomic) - structurally provable, not just asserted.
  const cloneInsertIdx = source.indexOf("insert into public.product_components (");
  assert.ok(cloneInsertIdx < eventStart && !/\bcommit\b/i.test(source.slice(cloneInsertIdx, eventStart)));
});

test("grants: revoked from public/anon, granted to authenticated only - security definer with pinned safe search_path", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("security definer"));
  assert.ok(source.includes("set search_path to 'pg_catalog', 'public'"));
  assert.ok(source.includes("revoke execute on function public.duplicate_product_composition(uuid, uuid) from public, anon;"));
  assert.ok(source.includes("grant execute on function public.duplicate_product_composition(uuid, uuid) to authenticated;"));
});

test("not JET-specific: the function signature takes two arbitrary client_product ids, no hard-coded product id anywhere in the migration", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("p_source_client_product_id uuid,\n  p_target_client_product_id uuid"));
  assert.ok(!source.includes("bf31e82b-905d-4ede-af79-7e4a1f1b4688"), "JET's real id must never appear in the migration itself - it is a test fixture id, not a hard-coded dependency");
});

// ── UI ────────────────────────────────────────────────────────────────
// XOS Phase C retired the Catalog Management "Duplicate composition" UI
// (and the whole scoped-component / variant / treatment surface) in
// favour of the ONE canonical production editor. The
// duplicate_product_composition RPC itself is unchanged (all the
// migration tests above still apply); it simply has no OPPS caller in
// this phase.

test("Catalog Management no longer hosts a client-side duplicate-composition UI or a raw product_components editor", async () => {
  const source = await readSource(UI_PATH);
  assert.ok(!source.includes("duplicateCompositionMutation"), "the duplicate-composition mutation is gone");
  assert.ok(!source.includes("duplicate_product_composition"), "no supabase.rpc('duplicate_product_composition') caller in the UI");
  assert.ok(!source.includes("ScopedComponentsEditor"), "no scoped-component editor mounted");
  assert.ok(!/GarmentVariantsSection|TreatmentsSection/.test(source), "no variant / treatment editors mounted");
});

test("Catalog Management edits production through the canonical editor + RPC only", async () => {
  const source = await readSource(UI_PATH);
  assert.ok(source.includes('import CanonicalProductionEditor from "@/components/clients/CanonicalProductionEditor";'));
  assert.ok(source.includes("setClientProductProductionComponents(selectedClientProductId, components)"));
  assert.ok(source.includes("getClientProductFull(selectedClientProductId)"));
  assert.ok(!/\.entities\.ProductComponent\.(create|update|delete)\(/.test(source), "no raw product_components write");
});
