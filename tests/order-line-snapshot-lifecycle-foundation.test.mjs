import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const MIGRATION_PATH = "supabase/migrations/20260828090000_order_line_snapshot_lifecycle_foundation.sql";

// ─────────────────────────────────────────────────────────────────────
// Order Line Coherence Phase 1C/D - Snapshot Lifecycle Foundation.
// Combined backend foundation: revision-lineage identity/schema, the
// current-row constraint/index, revise_order_line_component_snapshot,
// and duplicate_order_line_with_snapshots. Live-verified via one
// disposable, rolled-back (BEGIN/ROLLBACK) transaction against
// production, using a real authenticated staff actor (the established
// technique throughout this session).
//
// LIVE PREFLIGHT (before writing anything):
//   - Linked project confirmed: slhcvyeuqsduaglddqdb.
//   - order_line_component_snapshots: 18 total rows, 0 with a null
//     source_product_component_id (confirmed live) - null is still
//     structurally reachable (the FK is ON DELETE SET NULL, deliberately,
//     so a snapshot survives its source component being deleted later),
//     which is exactly why component_revision_key exists as an
//     independent lineage identity rather than reusing that column.
//   - Exact pre-existing unique constraint name confirmed:
//     order_line_component_snapshot_order_id_line_id_source_produ_key.
//   - orders.products line_id corruption check: 55 orders with products,
//     106 total lines, 0 orders with a duplicate line_id, 0 lines missing
//     a line_id, 0 non-UUID line_ids - all clean.
//   - None of is_current/revision/superseded_by/component_revision_key,
//     nor either new function, existed yet - clean slate confirmed.
//   - A PREVIOUSLY UNDOCUMENTED live trigger was discovered during
//     testing: trg_enforce_order_product_line_identity on `orders`
//     requires every products[].line_id to be a valid UUID and rejects
//     any UPDATE that introduces a duplicate line_id within one order -
//     this is WHY the live duplicate-line_id-corruption check above came
//     back clean (the trigger has been preventing it structurally all
//     along), and confirms newLineId()'s existing crypto.randomUUID()
//     format is exactly what both this trigger and the new RPCs require.
//
// LIVE TEST RESULTS (exact values from the rolled-back transaction):
//   - direct_update_blocked / direct_delete_blocked: both true,
//     "permission denied for table order_line_component_snapshots" -
//     authenticated still has zero UPDATE/DELETE grant on the base table.
//   - revision_result: ok:true, snapshot.revision:2, is_current:true,
//     superseded_by:null, same component_revision_key as the source,
//     placement "Front & Back" (revised), sell_price 75 (revised).
//   - old_snapshot_after_revision: revision:1 (unchanged), is_current:
//     false, superseded_by:<new row's id> - historical row preserved,
//     not deleted or rewritten.
//   - current_row_count_for_lineage: 1 - exactly one current row per
//     component_revision_key, always.
//   - old_tracking_untouched: still points at the OLD (superseded)
//     snapshot id, values unchanged.
//   - new_tracking_carries_state: a NEW tracking row exists pointed at
//     the NEW snapshot id, carrying forward production_stage
//     "print_setup", production_method "dtf", notes "tracking note" -
//     exact current state carried forward, not reset.
//   - stale_revision_blocked: true, "SNAPSHOT_REVISION_STALE: this
//     component was already revised by someone else - reload and try
//     again" - attempting to revise the now-superseded old snapshot id a
//     second time is explicitly rejected (this IS the concurrent-revision
//     protection: two racing calls serialize on the row lock, the loser
//     observes is_current=false and gets this exact error).
//   - invalid_billing_mode_blocked / negative_price_blocked: both true,
//     with explicit SNAPSHOT_REVISION_INVALID_* messages.
//   - duplicate_result: ok:true, replayed:false, cloned_component_count:2.
//   - order_products_after_duplicate: the new line carries
//     duplicated_from_line_id pointing at the source, plus the exact same
//     commercial fields (image_url, name, price, quantity) as the source.
//   - cloned_snapshots: both rows have revision:1, is_current:true,
//     superseded_by:null - a duplicated line's clones are their OWN fresh
//     history, never revision N of the source's.
//   - cloned_snapshot_ids_distinct_from_source /
//     cloned_component_revision_keys_distinct_from_source: both true.
//   - no_tracking_copied_to_new_line: 0.
//   - replay_result: ok:true, replayed:true, same new_line_id, same
//     cloned_component_count (2) - and snapshot_count_after_replay stayed
//     at 2 (not 4) - a replay writes nothing further.
//   - conflict_blocked: true, "ORDER_LINE_DUPLICATION_IDEMPOTENCY_
//     CONFLICT: target line id already exists with different provenance"
//     - triggered by a genuinely different REAL source line duplicating
//     onto the already-used target (existence alone was deliberately NOT
//     treated as proof of a legitimate replay).
//   - source_missing_blocked: true, explicit SOURCE_NOT_FOUND.
//   - source_ambiguous_blocked: true, explicit SOURCE_AMBIGUOUS - proven
//     by temporarily disabling trg_enforce_order_product_line_identity
//     INSIDE the disposable transaction only (since that trigger already
//     makes this state unreachable through any real write path) to
//     construct the otherwise-impossible corrupted state and confirm the
//     RPC's own defensive check works independently.
//   - no_reservations_for_order: true.
//   - Cleanup: the whole test ran inside BEGIN/ROLLBACK; a follow-up
//     query confirmed zero trace afterward (qa_order_exists:0,
//     is_current_col_exists:0, revise_fn_exists:0,
//     duplicate_fn_exists:0, old_unique_constraint_still_present:1).
//
// Two real implementation bugs were caught and fixed by this live testing
// (documented here since they're not obvious from reading the final SQL
// alone):
//   1. The revision RPC originally inserted the new (is_current=true) row
//      BEFORE marking the old row non-current - this collided with the
//      partial unique index (both rows briefly "current" for the same
//      lineage at once). Fixed by reordering: insert the new row as
//      is_current=false first, mark the old row non-current + point its
//      superseded_by at the new row, THEN promote the new row to current -
//      at every step exactly one current row exists for the lineage.
//   2. Setting superseded_by on the old row to a not-yet-inserted id
//      fails the column's own FK (the referenced row must already exist).
//      This is why the new row is inserted (non-current) BEFORE the old
//      row's superseded_by is set, not after.
//
// PR #49 REVIEW FIX ROUND (both applied to production, live-verified):
//
// 1. Duplication idempotency - target id must survive retry. The frontend
//    originally minted a fresh target line id INSIDE mutationFn, so a
//    retry after a lost RPC response would generate a second target id
//    and create a second real duplicate, defeating the RPC's own
//    provenance replay protection. Fixed in ProductsEditor.jsx: the
//    target id is now generated once in duplicateRow and kept in a
//    per-source-line ref (pendingDuplicateTargetIdsRef) for the entire
//    retry lifecycle of that attempt, cleared only on genuine success.
//    See the "PR #49 review fix" tests below.
//
// 2. Revision null/audit-diff semantics - revise_order_line_component_snapshot
//    originally built changed_fields by comparing the RAW incoming p_*
//    params against v_old, while the actual INSERT used
//    coalesce(p_field, v_old.field). A null param (meaning "preserve")
//    was therefore logged as a false change (e.g. p_specification=null
//    against old "Front chest" logged {"before":"Front chest","after":null}
//    even though the persisted value stayed "Front chest" unchanged).
//    Fixed: the effective new value for every editable field is now
//    computed ONCE into v_new_* (still via coalesce - the NULL contract
//    stays "null means preserve", not "clear", documented inline in the
//    migration), and that exact v_new_* value is used for BOTH the
//    INSERT and the changed_fields diff - never two different sources of
//    truth for what "the new value" is.
//
//    Live-verified via a disposable rolled-back transaction that first
//    replaced the function with the FIXED body inside that same
//    transaction (so nothing touched production until the fix was
//    already proven), then reapplied for real once confirmed:
//      - case_a (every param null): persisted values all unchanged
//        (specification/placement both stayed "Front chest"), and
//        changed_fields came back as {} - completely empty, not a false
//        diff for every field (which is exactly what the OLD buggy
//        function was proven to do in the same test run, before the fix
//        was applied: it logged a "before"-only entry for label,
//        placement, specification, sell_price, and billing_mode purely
//        because every param was null, none of which had actually
//        changed).
//      - case_b (placement + specification genuinely changed): persisted
//        values updated correctly, and changed_fields contained EXACTLY
//        those two fields with correct before/after - production_method,
//        production_colour, production_instructions, sell_price,
//        billing_mode, and label were all correctly absent (unchanged).
//      - case_c1 (sell_price param null against an existing revised row):
//        sell_price stayed unchanged, changed_fields empty.
//      - case_c2 (sell_price param genuinely changed from 50 to 75):
//        changed_fields contained exactly {"sell_price":{"before":50,
//        "after":75}}, nothing else.
//    Post-apply, pg_get_functiondef confirmed the live function body
//    matches this migration file's function definition exactly.
// ─────────────────────────────────────────────────────────────────────

test("the migration is additive only - no drop of an existing table/column/function", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(!/drop table/i.test(source));
  assert.ok(!/drop column/i.test(source));
  assert.ok(!/drop function/i.test(source));
});

test("revision schema: is_current/revision/superseded_by/component_revision_key columns, correct defaults, superseded_by self-references the same table", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("add column is_current boolean not null default true,"));
  assert.ok(source.includes("add column revision integer not null default 1,"));
  assert.ok(source.includes("add column superseded_by uuid references public.order_line_component_snapshots(id) on delete set null,"));
  assert.ok(source.includes("add column component_revision_key uuid not null default gen_random_uuid();"));
});

test("the old plain unique constraint (exact live name) is dropped and replaced by a partial unique index scoped to is_current, keyed by component_revision_key rather than the nullable source_product_component_id", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("drop constraint order_line_component_snapshot_order_id_line_id_source_produ_key;"));
  assert.ok(source.includes("create unique index order_line_component_snapshots_current_uidx\n  on public.order_line_component_snapshots (order_id, line_id, component_revision_key)\n  where is_current;"));
});

test("no grant changes to the base table itself - authenticated still has no UPDATE/DELETE, matching the original migration's immutability-at-the-grant-level design (live-confirmed: both a direct UPDATE and DELETE attempt were rejected with 'permission denied')", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(!/grant update on public\.order_line_component_snapshots/i.test(source));
  assert.ok(!/grant delete on public\.order_line_component_snapshots/i.test(source));
});

test("revise_order_line_component_snapshot: signature, security definer, locked search_path", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes(
    "create or replace function public.revise_order_line_component_snapshot(\n" +
    "  p_snapshot_id uuid,\n  p_label text,\n  p_placement text,\n  p_production_method text,\n" +
    "  p_production_colour text,\n  p_specification text,\n  p_production_instructions text,\n" +
    "  p_sell_price numeric,\n  p_billing_mode text\n)\nreturns jsonb"
  ));
  const start = source.indexOf("create or replace function public.revise_order_line_component_snapshot");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("security definer"));
  assert.ok(body.includes("set search_path to 'pg_catalog', 'public'"));
});

test("revise: the source snapshot is locked FOR UPDATE on its one and only read, before authorization - closing the same TOCTOU class Phase 2B Step 2 fixed", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.revise_order_line_component_snapshot");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("select * into v_old from public.order_line_component_snapshots where id = p_snapshot_id for update;"));
  const lockIdx = body.indexOf("where id = p_snapshot_id for update;");
  const authIdx = body.indexOf("if not public.is_opps_staff()");
  assert.ok(lockIdx !== -1 && authIdx !== -1 && lockIdx < authIdx);
});

test("revise: concurrent-revision protection - is_current is re-checked on the LOCKED row after authorization, raising SNAPSHOT_REVISION_STALE rather than silently creating a sibling current successor", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.revise_order_line_component_snapshot");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("if not v_old.is_current then\n    raise exception 'SNAPSHOT_REVISION_STALE:"));
});

test("revise: an explicit assertion confirms exactly one current row exists for the lineage before proceeding, not just reliance on the index alone", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.revise_order_line_component_snapshot");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("where component_revision_key = v_old.component_revision_key and is_current;"));
  assert.ok(body.includes("if v_current_count <> 1 then"));
});

test("revise: correct 3-step ordering - new row inserted non-current first, old row marked non-current + superseded_by set to the new row's real id, THEN the new row is promoted to current - never the reverse (this exact bug was live-caught and fixed)", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.revise_order_line_component_snapshot");
  const body = source.slice(start, source.indexOf("$function$;", start));
  const insertIdx = body.indexOf("false, v_old.revision + 1, null, v_old.component_revision_key");
  const supersedeIdx = body.indexOf("set is_current = false, superseded_by = v_new.id");
  const promoteIdx = body.indexOf("set is_current = true\n  where id = v_new.id");
  assert.ok(insertIdx !== -1 && supersedeIdx !== -1 && promoteIdx !== -1);
  assert.ok(insertIdx < supersedeIdx && supersedeIdx < promoteIdx, "must insert non-current, then supersede the old row, then promote the new row - in that exact order");
});

test("revise: component_type is never in the editable parameter list - copied verbatim from the old row, never revisable", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.revise_order_line_component_snapshot");
  const signatureEnd = source.indexOf(")\nreturns jsonb", start);
  const signature = source.slice(start, signatureEnd);
  assert.ok(!/p_component_type/.test(signature));
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("v_old.component_type,\n    v_new_label,"), "component_type is copied straight from v_old, not from a parameter");
});

test("revise: unspecified fields fall back to the old row's own value via coalesce - a caller only needs to pass what's changing", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.revise_order_line_component_snapshot");
  const body = source.slice(start, source.indexOf("$function$;", start));
  for (const field of ["label", "production_method", "placement", "production_colour", "specification", "production_instructions", "sell_price", "billing_mode"]) {
    assert.ok(body.includes(`coalesce(p_${field}, v_old.${field})`), `${field} must fall back to the old value via coalesce`);
  }
});

// ── PR #49 review fix: the audit diff must be computed from the exact
// same effective values that get persisted, never from the raw incoming
// params directly - see the header block above for the exact bug
// (a null param silently preserved by coalesce() in the INSERT was still
// logged as a false before/after change) and the live-verified fix.

test("revise: the effective new value for every editable field is computed exactly once, into v_new_*, before either the diff or the insert reads it", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.revise_order_line_component_snapshot");
  const body = source.slice(start, source.indexOf("$function$;", start));
  const computeIdx = body.indexOf("v_new_label := coalesce(p_label, v_old.label);");
  const diffIdx = body.indexOf("v_changed_fields := jsonb_strip_nulls(");
  const insertIdx = body.indexOf("insert into public.order_line_component_snapshots (");
  assert.ok(computeIdx !== -1 && diffIdx !== -1 && insertIdx !== -1);
  assert.ok(computeIdx < diffIdx && diffIdx < insertIdx, "the v_new_* values must be computed before both the diff and the insert, in that order");
  for (const field of ["label", "placement", "production_method", "production_colour", "specification", "production_instructions", "sell_price", "billing_mode"]) {
    assert.ok(body.includes(`v_new_${field} := coalesce(p_${field}, v_old.${field});`), `v_new_${field} must be computed via coalesce exactly once`);
  }
});

test("revise: changed_fields compares v_new_* against v_old - never the raw p_* parameters directly - for every editable field", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.revise_order_line_component_snapshot");
  const diffStart = source.indexOf("v_changed_fields := jsonb_strip_nulls(", start);
  const diffEnd = source.indexOf("));", diffStart);
  const diffBody = source.slice(diffStart, diffEnd);
  for (const field of ["label", "placement", "production_method", "production_colour", "specification", "production_instructions", "sell_price", "billing_mode"]) {
    assert.ok(
      diffBody.includes(`case when v_new_${field} is distinct from v_old.${field} then jsonb_build_object('before', v_old.${field}, 'after', v_new_${field}) end`),
      `${field}'s diff must compare v_new_${field} (the actual effective/persisted value) against v_old.${field}`
    );
    assert.ok(!diffBody.includes(`p_${field} is distinct from`), `${field}'s diff must never compare the raw incoming parameter directly - that was the exact bug`);
  }
});

test("revise: the INSERT's editable-field values are the same v_new_* variables used for the diff - never a second, separately-computed coalesce() at the insert site", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.revise_order_line_component_snapshot");
  const insertStart = source.indexOf("insert into public.order_line_component_snapshots (", start);
  const insertValuesStart = source.indexOf("v_old.component_type,", insertStart);
  const insertValuesEnd = source.indexOf("v_old.quantity_per_unit, v_old.sort_order,", insertValuesStart);
  const insertValuesBody = source.slice(insertValuesStart, insertValuesEnd);
  assert.ok(!/coalesce\(/.test(insertValuesBody), "the insert's editable-field values must be the already-computed v_new_* variables, not a fresh coalesce() call");
  for (const field of ["label", "placement", "production_method", "production_colour", "specification", "production_instructions", "sell_price", "billing_mode"]) {
    assert.ok(insertValuesBody.includes(`v_new_${field},`), `the insert must use v_new_${field} directly`);
  }
});

test("revise: the NULL contract (null param means preserve, not clear) is documented inline as an explicit design decision, not left implicit", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.revise_order_line_component_snapshot");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes('NULL contract for this RPC version: a null parameter means "leave this'));
  assert.ok(body.includes("field unchanged\", NOT \"clear it\""));
});

test("revise: billing_mode and sell_price are validated with clear staff-facing messages before any write, matching the base table's own CHECK constraints", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.revise_order_line_component_snapshot");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("p_billing_mode not in ('per_unit', 'once_per_order')"));
  assert.ok(body.includes("p_sell_price is not null and p_sell_price < 0"));
});

test("revise: tracking carried forward is an INSERT of a new row against the new snapshot, never an UPDATE that repoints the old tracking row's FK - old tracking is left completely untouched for audit", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.revise_order_line_component_snapshot");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("select * into v_old_tracking from public.order_line_production_tracking where order_line_component_snapshot_id = v_old.id;"));
  assert.ok(body.includes("insert into public.order_line_production_tracking ("));
  assert.ok(!/update public\.order_line_production_tracking/.test(body), "must never UPDATE an existing tracking row - only ever insert a new one");
  assert.ok(body.includes("v_old_tracking.production_method, v_old_tracking.production_stage, v_old_tracking.inventory_supplier_variant_id, v_old_tracking.quantity_allocated, v_old_tracking.notes,"));
});

test("revise: writes exactly one activity event, with actor, changed-field before/after diff, and both the old and new snapshot ids", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.revise_order_line_component_snapshot");
  const body = source.slice(start, source.indexOf("$function$;", start));
  const eventCount = (body.match(/insert into public\.opps_activity_events/g) || []).length;
  assert.equal(eventCount, 1);
  assert.ok(body.includes("'production_revision'"));
  assert.ok(body.includes("'old_snapshot_id', v_old.id,\n      'new_snapshot_id', v_new.id,"));
  assert.ok(body.includes("v_changed_fields"));
});

test("revise: never touches product_components - only order_line_component_snapshots/order_line_production_tracking/opps_activity_events are written", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.revise_order_line_component_snapshot");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(!/insert into public\.product_components|update public\.product_components/.test(body));
});

test("duplicate_order_line_with_snapshots: signature, security definer, locked search_path", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes(
    "create or replace function public.duplicate_order_line_with_snapshots(\n  p_order_id uuid,\n  p_source_line_id text,\n  p_new_line_id text\n)\nreturns jsonb"
  ));
  const start = source.indexOf("create or replace function public.duplicate_order_line_with_snapshots");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("security definer"));
  assert.ok(body.includes("set search_path to 'pg_catalog', 'public'"));
});

test("duplicate: the order is locked FOR UPDATE on its first/only authoritative read - the order row IS the source, so there is no unlocked-then-relocked gap", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.duplicate_order_line_with_snapshots");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("select * into v_order from public.orders where id = p_order_id for update;"));
  const lockIdx = body.indexOf("where id = p_order_id for update;");
  const authIdx = body.indexOf("if not public.is_opps_staff()");
  assert.ok(lockIdx !== -1 && authIdx !== -1 && lockIdx < authIdx, "the order must be locked before authorization, matching the source-locked-first pattern");
});

test("duplicate: exactly one source line is required - zero raises SOURCE_NOT_FOUND, more than one raises SOURCE_AMBIGUOUS", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.duplicate_order_line_with_snapshots");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("if v_source_line_count = 0 then\n    raise exception 'ORDER_LINE_DUPLICATION_SOURCE_NOT_FOUND:"));
  assert.ok(body.includes("elsif v_source_line_count > 1 then\n    raise exception 'ORDER_LINE_DUPLICATION_SOURCE_AMBIGUOUS:"));
});

test("duplicate: replay proof requires provenance match, not existence alone - a target that exists with a DIFFERENT duplicated_from_line_id raises an explicit conflict, never a silent false-replay", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.duplicate_order_line_with_snapshots");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("if (v_target_line->>'duplicated_from_line_id') is not distinct from p_source_line_id then"));
  assert.ok(body.includes("raise exception 'ORDER_LINE_DUPLICATION_IDEMPOTENCY_CONFLICT:"));
});

test("duplicate: the new commercial line is stamped with duplicated_from_line_id, and the new line_id fully overrides the source's own line_id - everything else copied verbatim from the source line object", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.duplicate_order_line_with_snapshots");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("v_new_line := v_source_line || jsonb_build_object('line_id', p_new_line_id, 'duplicated_from_line_id', p_source_line_id);"));
});

test("duplicate: snapshot clone is scoped to is_current = true only - a superseded historical revision of the source is never cloned into the new line", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.duplicate_order_line_with_snapshots");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("where order_id = p_order_id and line_id = p_source_line_id and is_current\n  for update;"));
});

test("duplicate: every cloned snapshot gets a fresh id, fresh component_revision_key, revision=1, is_current=true, superseded_by=null - a duplicated line starts its OWN history, never revision N of the source's", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.duplicate_order_line_with_snapshots");
  const body = source.slice(start, source.indexOf("$function$;", start));
  assert.ok(body.includes("true, 1, null, gen_random_uuid()"));
  assert.ok(body.includes("gen_random_uuid(), tenant_id, order_id, p_new_line_id, client_product_id, source_product_component_id,"), "id is regenerated, line_id comes from the new target - never copied from the source snapshot's own id/line_id");
});

test("duplicate: artwork_revision_ids and every other reusable production field are copied verbatim; resolved_inventory_variant_id is copied as a resolved reference, not re-resolved", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.duplicate_order_line_with_snapshots");
  const body = source.slice(start, source.indexOf("$function$;", start));
  const selectStart = body.indexOf("select\n    gen_random_uuid(),");
  const selectBody = body.slice(selectStart, selectStart + 700);
  assert.ok(selectBody.includes("artwork_revision_ids"));
  assert.ok(selectBody.includes("resolved_inventory_variant_id"));
});

test("duplicate: never touches order_line_production_tracking, inventory_variant_reservations, or any movement/completion-history table - a duplicated line starts fresh/unstarted by construction", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.duplicate_order_line_with_snapshots");
  const body = source.slice(start, source.indexOf("$function$;", start));
  const codeOnly = body
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.ok(!/order_line_production_tracking|inventory_variant_reservations|inventory_movements/.test(codeOnly));
  // The deliberate omission is documented inline as a comment, not silently absent.
  assert.ok(body.includes("-- Deliberately never touches order_line_production_tracking,"));
});

test("duplicate: exactly one activity event on genuine creation only - the replay branch returns before reaching the activity-event insert", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.duplicate_order_line_with_snapshots");
  const body = source.slice(start, source.indexOf("$function$;", start));
  const eventCount = (body.match(/insert into public\.opps_activity_events/g) || []).length;
  assert.equal(eventCount, 1);
  assert.ok(body.includes("'line_duplicated'"));
  const replayReturnIdx = body.indexOf("'replayed', true,");
  const eventInsertIdx = body.indexOf("insert into public.opps_activity_events");
  assert.ok(replayReturnIdx !== -1 && eventInsertIdx !== -1 && replayReturnIdx < eventInsertIdx, "the replay return must happen before the activity-event insert is ever reached");
});

test("both RPCs are granted to authenticated only, revoked from public/anon", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("revoke execute on function public.revise_order_line_component_snapshot(uuid, text, text, text, text, text, text, numeric, text) from public, anon;"));
  assert.ok(source.includes("grant execute on function public.revise_order_line_component_snapshot(uuid, text, text, text, text, text, text, numeric, text) to authenticated;"));
  assert.ok(source.includes("revoke execute on function public.duplicate_order_line_with_snapshots(uuid, text, text) from public, anon;"));
  assert.ok(source.includes("grant execute on function public.duplicate_order_line_with_snapshots(uuid, text, text) to authenticated;"));
});

test("both RPCs authorize via is_opps_staff() - matching this table's own RLS policy exactly, not a different/invented check", async () => {
  const source = await readSource(MIGRATION_PATH);
  const occurrences = (source.match(/if not public\.is_opps_staff\(\) then/g) || []).length;
  assert.equal(occurrences, 2);
});

// ─────────────────────────────────────────────────────────────────────
// Frontend
// ─────────────────────────────────────────────────────────────────────

test("ProductsEditor: the snapshot read query filters is_current: true - superseded historical revisions never leak into the live working view", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(source.includes("dataClient.entities.OrderLineComponentSnapshot.filter({ order_id: order.id, is_current: true }, \"sort_order\", 300)"));
});

test("ProductsEditor: duplicateRow is entirely RPC-backed - calls duplicate_order_line_with_snapshots directly, no client-side construction of the new line's commercial fields remains", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const mutationStart = source.indexOf("const duplicateLineMutation = useMutation({");
  assert.notEqual(mutationStart, -1);
  const mutationEnd = source.indexOf("const duplicateRow = (", mutationStart);
  const mutationBody = source.slice(mutationStart, mutationEnd);
  assert.ok(mutationBody.includes('supabase.rpc("duplicate_order_line_with_snapshots"'));
  assert.ok(mutationBody.includes("p_order_id: order.id,"));
  assert.ok(mutationBody.includes("p_source_line_id: sourceLineId,"));
  assert.ok(mutationBody.includes("p_new_line_id: targetLineId,"));
  const fullSource = source;
  assert.ok(!/\.\.\.p, quantity: Number\(p\.quantity\) \|\| 1, line_id: newLineId\(\)/.test(fullSource));
});

// ── PR #49 review fix: the target line id (the RPC's idempotency key)
// must survive an entire duplication attempt's retry lifecycle, not be
// re-minted per mutate() call - see the header block above this section
// for the exact bug and the fix.

test("ProductsEditor: the target line id is generated in duplicateRow, NOT inside mutationFn - mutationFn only ever consumes a supplied id, it never mints its own", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const mutationStart = source.indexOf("const duplicateLineMutation = useMutation({");
  const mutationFnStart = source.indexOf("mutationFn: async ({ sourceLineId, targetLineId }) => {", mutationStart);
  assert.notEqual(mutationFnStart, -1, "mutationFn must destructure a pre-generated { sourceLineId, targetLineId } pair, not accept a bare sourceLineId");
  const mutationFnEnd = source.indexOf("onSuccess:", mutationFnStart);
  const mutationFnBody = source.slice(mutationFnStart, mutationFnEnd);
  assert.ok(!/newLineId\(\)/.test(mutationFnBody), "mutationFn must not generate a new target id itself - that would defeat the whole point of a stable id across retries");
  assert.ok(mutationFnBody.includes("p_source_line_id: sourceLineId,"));
  assert.ok(mutationFnBody.includes("p_new_line_id: targetLineId,"));
});

test("ProductsEditor: duplicateRow reuses a still-pending target id for the same source line rather than minting a new one on every call - this is what makes a retry of the same attempt safe", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const refDeclIdx = source.indexOf("const pendingDuplicateTargetIdsRef = useRef(new Map());");
  assert.notEqual(refDeclIdx, -1, "a ref (surviving across renders, unlike component state reset by remount) must track one pending target id per source line id");
  const start = source.indexOf("const duplicateRow = (");
  const end = source.indexOf("\n  };", start);
  const body = source.slice(start, end);
  assert.ok(body.includes("let targetLineId = pendingDuplicateTargetIdsRef.current.get(p.line_id);"));
  assert.ok(body.includes("if (!targetLineId) {"));
  assert.ok(body.includes("targetLineId = newLineId();"));
  assert.ok(body.includes("pendingDuplicateTargetIdsRef.current.set(p.line_id, targetLineId);"));
  assert.ok(body.includes("duplicateLineMutation.mutate({ sourceLineId: p.line_id, targetLineId });"));
});

test("ProductsEditor: a duplicate attempt without a resolved line_id is blocked client-side with a clear message, rather than calling the RPC with a blank source id", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const start = source.indexOf("const duplicateRow = (");
  const end = source.indexOf("\n  };", start);
  const body = source.slice(start, end);
  assert.ok(body.includes("if (!p.line_id) {"));
});

test("ProductsEditor: the pending target id for a source line is cleared ONLY on genuine success (via the actual mutate() variables, not a re-derived value) - so a real retry reuses it, but a later deliberate re-duplication of the same source line mints a fresh one", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const mutationStart = source.indexOf("const duplicateLineMutation = useMutation({");
  const onSuccessStart = source.indexOf("onSuccess: async (data, variables) => {", mutationStart);
  assert.notEqual(onSuccessStart, -1, "onSuccess must receive the mutation's own variables to know exactly which source line just genuinely completed");
  const onErrorIdx = source.indexOf("onError:", onSuccessStart);
  const onSuccessBody = source.slice(onSuccessStart, onErrorIdx);
  assert.ok(onSuccessBody.includes("pendingDuplicateTargetIdsRef.current.delete(variables.sourceLineId);"));
  // And NOT cleared on error - the outcome of a failed/ambiguous attempt is
  // exactly the case a retry needs to reuse the same target id for.
  const onErrorEnd = source.indexOf("});", onErrorIdx);
  const onErrorBody = source.slice(onErrorIdx, onErrorEnd);
  assert.ok(!/pendingDuplicateTargetIdsRef/.test(onErrorBody), "onError must not touch the pending-id map - the entry must survive so a retry reuses the same id");
});

test("ProductsEditor: after a successful duplicate, the snapshot query is invalidated and the drawer's order state is re-synced from a fresh server read - never from a client-side reconstruction of the new line", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const mutationStart = source.indexOf("const duplicateLineMutation = useMutation({");
  const onSuccessStart = source.indexOf("onSuccess: async (data, variables) => {", mutationStart);
  const onErrorIdx = source.indexOf("onError:", onSuccessStart);
  const body = source.slice(onSuccessStart, onErrorIdx);
  assert.ok(body.includes('queryClient.invalidateQueries({ queryKey: ["orderLineComponentSnapshots", order.id] });'));
  assert.ok(body.includes("dataClient.entities.Order.filter({ id: order.id }, undefined, 1)"));
  assert.ok(body.includes("onUpdate(order.id, { products: freshOrder.products });"));
});

test("ProductsEditor: the duplicate button disables while the mutation is pending, preventing a double-submit", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(source.includes("disabled={duplicateLineMutation.isPending}"));
});
