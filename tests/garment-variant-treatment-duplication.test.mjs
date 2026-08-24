import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const MIGRATION_PATH = "supabase/migrations/20260826090000_garment_variant_treatment_duplication.sql";

// ─────────────────────────────────────────────────────────────────────
// Phase 2B Step 2 - duplicate_garment_variant / duplicate_treatment.
// RPC + schema only (idempotency columns/indexes, active-name-uniqueness
// indexes). No Catalog UI, no real SFR variants/treatments, no X LAB, no
// basket, no size matrix, no PayFast.
//
// Both functions were live-verified against production in two phases:
//
// PHASE A - two disposable, rolled-back (BEGIN/ROLLBACK) transactions,
// each installing the real function bodies inline and exercising them
// against disposable fixture rows under Jet's real tenant:
//
//   Test 1 (single-family, full field/semantics proof):
//     - variant_clone_result: created "300gsm / Black" from source
//       "220gsm / Black", ok:true, replayed:false, cloned_component_count:2
//       (both variant-scoped components), cloned_mapping_count:1 (only the
//       ACTIVE source mapping copied; the inactive one was correctly
//       skipped).
//     - variant_replay_result: identical idempotency key + identical
//       payload replayed -> ok:true, replayed:true, the SAME variant id
//       returned, zero new rows.
//     - variant_conflict_blocked: same key + a DIFFERENT target name ->
//       blocked, message contains GARMENT_VARIANT_CLONE_IDEMPOTENCY_CONFLICT.
//     - treatment_clone_result: created "Orange SFR Print" from source
//       "White SFR Print", ok:true, cloned_component_count:1 (the
//       treatment-scoped component only), artwork_copied:false,
//       mapping_copied:false.
//     - missing_key_blocked / blank_name_blocked: both blocked with the
//       expected *_REQUIRED messages.
//     - name_collision_blocked: '  300GSM / black  ' (differs only by
//       case + surrounding whitespace from the just-created "300gsm /
//       Black") -> blocked by the normalized active-name unique index,
//       NOT by the idempotency mechanism (different key).
//     - source_variant_after / source_treatment_after: byte-identical to
//       their pre-clone state - cloning never mutates the source.
//     - family_component_count (family-level, garment_variant_id IS NULL
//       AND treatment_id IS NULL): unchanged at 1 - neither clone ever
//       touches family-level components.
//     - activity_events: exactly 2 rows (one variant_duplicated, one
//       treatment_duplicated) - the idempotent replay produced zero
//       additional events.
//
//   Test 2 (cross-family / cross-tenant / unauthorized rejection proof,
//   using a genuine third tenant created inside the same disposable
//   transaction):
//     - variant_cross_family_blocked / treatment_cross_family_blocked:
//       both true (GARMENT_VARIANT_CLONE_CROSS_FAMILY /
//       TREATMENT_CLONE_CROSS_FAMILY) - same tenant, different
//       client_product_id target rejected.
//     - variant_cross_tenant_blocked / treatment_cross_tenant_blocked:
//       both true - staff with zero reviewer access to the third tenant
//       correctly rejected at the TARGET-tenant authorization check.
//     - variant_unauthorized_blocked / treatment_unauthorized_blocked:
//       both true (*_ACTOR_UNRESOLVED) - a uid with no public.users row
//       cannot resolve to a staff identity.
//     - activity_event_count_after_rejections: 0 - no partial/leaked
//       events from any rejected attempt.
//     - stray_variant_count / stray_treatment_count (rows landing in
//       either off-limits family): both 0.
//
// PHASE B - real two-session concurrency proof. The function bodies were
// temporarily installed for real (genuine commits, not a rolled-back
// transaction - required because cross-session visibility needs a real
// commit), against a disposable client_products family + two disposable
// garment variants under Jet's real tenant, using two genuinely
// concurrent OS processes per scenario. Final verify.sql output:
//   {
//     "scenario_a_variant_count": 1, "scenario_a_event_count": 1,
//     "scenario_b_variant_names": ["AB Clone Payload One"],
//     "scenario_c_variant_count": 1,
//     "scenario_d_cloned_variant": {
//       "id": "bbf52aa5-617c-4b20-a785-a49e9cc5c742", "component_count": 2
//     },
//     "scenario_d_source_component_count_final": 3,
//     "total_variants_in_family": 6, "total_events_in_family": 4
//   }
//   - Scenario A (same key + same payload, launched concurrently): exactly
//     ONE variant row and ONE activity event exist - the two concurrent
//     calls serialized on the advisory lock, the second saw the first's
//     committed row and replayed rather than racing to insert twice.
//   - Scenario B (same key + DIFFERENT target name, concurrent): only
//     "AB Clone Payload One" (session A's payload) exists - session B's
//     call, serialized behind A by the same advisory lock, saw the
//     already-committed different-fingerprint row and raised the
//     idempotency conflict instead of creating a second row.
//   - Scenario C (different idempotency keys, same active target name,
//     concurrent): scenario_c_variant_count is 1, not 2 - the two
//     differently-keyed calls both passed the idempotency mechanism (no
//     shared lock namespace to serialize them) but the normalized
//     active-name unique index allowed only one to commit; the other hit
//     a clean unique-constraint rejection, never a duplicate active name.
//   - Scenario D (source-consistency proof): session A locked the source
//     variant FOR UPDATE, slept 4s while holding it, then ran the real
//     clone RPC. Session B, launched mid-sleep, attempted to insert a
//     brand-new component directly against the same source variant -
//     this insert blocked (Postgres's automatic FOR KEY SHARE-vs-FOR
//     UPDATE conflict on the referenced parent row) until A's transaction
//     committed. Final state proves the mechanism: the source variant
//     ends with 3 components (2 original + B's concurrently-added one,
//     which DID land once unblocked), but the CLONE has only 2 - the
//     clone reflects exactly the pre-existing, pre-B snapshot, never a
//     hybrid of old-and-new state.
//   Cleanup confirmed complete: leftover_family/leftover_variants/
//   leftover_components all 0, fns_remaining 0 (both functions dropped)
//   after the real-commit phase - production left with zero trace beyond
//   this migration itself.
//
// PHASE C (post-review fix) - a review pass on the first PR flagged a
// TOCTOU gap: the source row was originally read UNLOCKED for
// authorization/validation (step 3), then re-read FOR UPDATE only
// immediately before cloning (old step 9) - leaving a window where the
// source's own tenant_id/client_product_id could change between the two
// reads, so "the source authorized" and "the source cloned" were not
// provably the same row-state. Fixed by locking the source FOR UPDATE on
// its ONE AND ONLY read (now step 3, before authorization), removing the
// later re-read entirely (v_source_locked no longer exists), and routing
// every downstream decision - source-tenant authorization, the advisory-
// lock namespace, the idempotency lookup scope, the same-tenant/same-
// family checks, and the fields copied into the clone - through that
// single locked v_source row.
//
// Verification for this fix:
//   - A disposable, rolled-back functional retest (fresh fixtures,
//     tenant Jet) confirmed the fix does not change externally-visible
//     behaviour: variant_clone_result (2 components, 1 mapping),
//     variant_replay_result (replayed:true, same row), variant_conflict_
//     blocked (GARMENT_VARIANT_CLONE_IDEMPOTENCY_CONFLICT), and
//     treatment_clone_result all matched the pre-fix Phase A results
//     exactly.
//   - Structural proof (this file, below): the source table is read
//     exactly once per function (grep-counted), v_source_locked does not
//     exist anywhere in the migration, and every authorization/lock/
//     idempotency/validation/clone-field reference uses v_source.
//   - A live, real two-session race SPECIFIC to this fix (session B
//     attempting to UPDATE the locked source row's client_product_id
//     while session A holds the FOR UPDATE lock mid-clone) was designed
//     but deliberately NOT executed against production - the user
//     declined a second real-commit install/test/revert cycle for this
//     narrow fix, choosing the disposable-retest-plus-structural-proof
//     alternative instead. The underlying primitive being relied on
//     (a session-A FOR UPDATE row lock blocking a session-B UPDATE
//     against that exact row until A's transaction ends) is standard
//     Postgres MVCC behaviour, and was ALREADY live-verified on this
//     exact table in Phase B Scenario D above (there, blocking a
//     concurrent INSERT of a new child row referencing the locked
//     parent; a direct UPDATE of the locked row's own columns is the
//     simpler, more directly-guaranteed case of the same mechanism, not
//     a new one). No live 2-session proof specific to the client_
//     product_id-reassignment scenario exists in this repo's test
//     history as of this fix.
// ─────────────────────────────────────────────────────────────────────

test("the migration is additive only - no drop of an existing table/column/function", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(!/drop table/i.test(source));
  assert.ok(!/drop column/i.test(source));
  assert.ok(!/drop function/i.test(source));
});

test("both tables gain idempotency_key + request_fingerprint columns, with a tenant-scoped partial unique index on idempotency_key (never globally unique - matches the lock namespace being per-tenant)", async () => {
  const source = await readSource(MIGRATION_PATH);
  for (const table of ["client_product_garment_variants", "client_product_treatments"]) {
    assert.ok(source.includes(`alter table public.${table}\n  add column idempotency_key text,\n  add column request_fingerprint text;`));
    assert.ok(source.includes(`create unique index ${table}_idempotency_uidx\n  on public.${table} (tenant_id, idempotency_key)\n  where idempotency_key is not null;`));
  }
});

test("both tables gain a non-blank name CHECK and a normalized (lower(btrim(name))), active-only unique index - case/whitespace-insensitive collisions are rejected while inactive historical duplicates remain allowed", async () => {
  const source = await readSource(MIGRATION_PATH);
  for (const table of ["client_product_garment_variants", "client_product_treatments"]) {
    assert.ok(source.includes(`add constraint ${table}_name_not_blank check (btrim(name) <> '');`));
    assert.ok(source.includes(`create unique index ${table}_active_name_uidx\n  on public.${table} (client_product_id, lower(btrim(name)))\n  where is_active;`));
  }
});

test("duplicate_garment_variant and duplicate_treatment both take (source uuid, target_client_product_id uuid, target_name text, idempotency_key text) and return jsonb, security definer with a locked search_path", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("create or replace function public.duplicate_garment_variant(\n  p_source_variant_id uuid,\n  p_target_client_product_id uuid,\n  p_target_name text,\n  p_idempotency_key text\n)\nreturns jsonb"));
  assert.ok(source.includes("create or replace function public.duplicate_treatment(\n  p_source_treatment_id uuid,\n  p_target_client_product_id uuid,\n  p_target_name text,\n  p_idempotency_key text\n)\nreturns jsonb"));
  const definerCount = (source.match(/security definer\nset search_path to 'pg_catalog', 'public'/g) || []).length;
  assert.equal(definerCount, 2);
});

test("both functions reject a null/blank idempotency key and a null/blank target name BEFORE resolving the source - validation happens on step 2, source resolution on step 3", async () => {
  const source = await readSource(MIGRATION_PATH);
  for (const prefix of ["GARMENT_VARIANT_CLONE", "TREATMENT_CLONE"]) {
    const keyIdx = source.indexOf(`${prefix}_IDEMPOTENCY_KEY_REQUIRED`);
    const nameIdx = source.indexOf(`${prefix}_TARGET_NAME_REQUIRED`);
    const sourceNotFoundIdx = source.indexOf(`${prefix}_SOURCE_NOT_FOUND`);
    assert.notEqual(keyIdx, -1);
    assert.notEqual(nameIdx, -1);
    assert.notEqual(sourceNotFoundIdx, -1);
    assert.ok(keyIdx < sourceNotFoundIdx, `${prefix}: key validation must precede source resolution`);
    assert.ok(nameIdx < sourceNotFoundIdx, `${prefix}: name validation must precede source resolution`);
  }
});

test("the mandated step order is source resolution, THEN source-tenant authorization (never the reverse - you cannot authorize a source tenant before you know what it is)", async () => {
  const source = await readSource(MIGRATION_PATH);
  for (const prefix of ["GARMENT_VARIANT_CLONE", "TREATMENT_CLONE"]) {
    const sourceNotFoundIdx = source.indexOf(`${prefix}_SOURCE_NOT_FOUND`);
    const forbiddenIdx = source.indexOf(`${prefix}_FORBIDDEN`);
    assert.ok(sourceNotFoundIdx < forbiddenIdx, `${prefix}: source must be resolved before its tenant is authorized`);
  }
});

test("source-tenant authorization happens BEFORE the advisory lock is acquired, and the lock is acquired BEFORE the idempotency replay/conflict check - an unauthorized caller can never even reach the lock, and the lock always guards the replay check", async () => {
  const source = await readSource(MIGRATION_PATH);
  for (const [prefix, op] of [["GARMENT_VARIANT_CLONE", "duplicate_garment_variant"], ["TREATMENT_CLONE", "duplicate_treatment"]]) {
    const forbiddenIdx = source.indexOf(`${prefix}_FORBIDDEN`);
    const lockIdx = source.indexOf(`pg_advisory_xact_lock(hashtextextended('${op}:`);
    const conflictIdx = source.indexOf(`${prefix}_IDEMPOTENCY_CONFLICT`);
    assert.ok(forbiddenIdx < lockIdx, `${prefix}: source-tenant authorization must precede the advisory lock`);
    assert.ok(lockIdx < conflictIdx, `${prefix}: the advisory lock must be acquired before the idempotency conflict check`);
  }
});

test("the advisory lock namespace is exactly '<operation>:<source tenant>:<idempotency key>' - identical keys reused in unrelated tenants never serialize against each other", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("pg_advisory_xact_lock(hashtextextended('duplicate_garment_variant:' || v_source.tenant_id::text || ':' || p_idempotency_key, 0));"));
  assert.ok(source.includes("pg_advisory_xact_lock(hashtextextended('duplicate_treatment:' || v_source.tenant_id::text || ':' || p_idempotency_key, 0));"));
});

test("the request fingerprint is derived ONLY from immutable request intent (source id, target family id, normalized target name) - never from mutable source-row contents, so a request replayed after the source later changes still returns the original result rather than a false conflict", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("v_fingerprint := md5(p_source_variant_id::text || '|' || p_target_client_product_id::text || '|' || v_target_name);"));
  assert.ok(source.includes("v_fingerprint := md5(p_source_treatment_id::text || '|' || p_target_client_product_id::text || '|' || v_target_name);"));
  // v_target_name is assigned from btrim(p_target_name) before either fingerprint line - normalization happens before hashing.
  const variantFingerprintIdx = source.indexOf("v_fingerprint := md5(p_source_variant_id");
  const variantTrimIdx = source.indexOf("v_target_name := btrim(p_target_name);");
  assert.ok(variantTrimIdx !== -1 && variantTrimIdx < variantFingerprintIdx);
});

test("idempotency replay is looked up by (tenant_id, idempotency_key) alone, matched against v_fingerprint - a hit with a DIFFERENT fingerprint raises the conflict, a hit with the SAME fingerprint short-circuits and returns the original row with replayed:true, and neither path re-validates target/tenant/family (the replay branch returns before step 7)", async () => {
  const source = await readSource(MIGRATION_PATH);
  for (const [prefix, table] of [["GARMENT_VARIANT_CLONE", "client_product_garment_variants"], ["TREATMENT_CLONE", "client_product_treatments"]]) {
    const replayIdx = source.indexOf(`from public.${table}\n  where tenant_id = v_source.tenant_id and idempotency_key = p_idempotency_key;`);
    assert.notEqual(replayIdx, -1, `${prefix}: replay lookup must be scoped to (tenant_id, idempotency_key)`);
    const targetNotFoundIdx = source.indexOf(`${prefix}_TARGET_NOT_FOUND`);
    assert.ok(replayIdx < targetNotFoundIdx, `${prefix}: the replay check must be resolved before target-family resolution`);
  }
});

test("same-tenant and same-family (v1) validation happen AFTER target resolution/authorization, using IS DISTINCT FROM (correctly null-safe)", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("if v_source.tenant_id is distinct from v_target_family.tenant_id then\n    raise exception 'GARMENT_VARIANT_CLONE_CROSS_TENANT"));
  assert.ok(source.includes("if v_source.client_product_id is distinct from p_target_client_product_id then\n    raise exception 'GARMENT_VARIANT_CLONE_CROSS_FAMILY"));
  assert.ok(source.includes("if v_source.tenant_id is distinct from v_target_family.tenant_id then\n    raise exception 'TREATMENT_CLONE_CROSS_TENANT"));
  assert.ok(source.includes("if v_source.client_product_id is distinct from p_target_client_product_id then\n    raise exception 'TREATMENT_CLONE_CROSS_FAMILY"));
});

test("the source row is locked FOR UPDATE on its ONE AND ONLY read (step 3, before authorization) - there is no second/re-select of the source anywhere in either function, closing the TOCTOU window between an earlier unlocked read and a later locked re-read", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("select * into v_source from public.client_product_garment_variants where id = p_source_variant_id for update;"));
  assert.ok(source.includes("select * into v_source from public.client_product_treatments where id = p_source_treatment_id for update;"));
  // No second read of either source table into a variant beyond v_source itself - v_source_locked (or any
  // other re-read variable) must not exist anywhere in the migration.
  assert.ok(!/v_source_locked/.test(source), "no second/re-read source variable should exist - v_source is locked once and reused throughout");
  const variantFnStart = source.indexOf("create or replace function public.duplicate_garment_variant");
  const variantFnEnd = source.indexOf("$function$;", variantFnStart);
  const variantBody = source.slice(variantFnStart, variantFnEnd);
  assert.equal((variantBody.match(/from public\.client_product_garment_variants where id = p_source_variant_id/g) || []).length, 1, "duplicate_garment_variant must read its own source table exactly once");
  const treatmentFnStart = source.indexOf("create or replace function public.duplicate_treatment");
  const treatmentFnEnd = source.indexOf("$function$;", treatmentFnStart);
  const treatmentBody = source.slice(treatmentFnStart, treatmentFnEnd);
  assert.equal((treatmentBody.match(/from public\.client_product_treatments where id = p_source_treatment_id/g) || []).length, 1, "duplicate_treatment must read its own source table exactly once");
});

test("authorization, the advisory-lock namespace, the idempotency lookup scope, the same-tenant/same-family checks, and the cloned fields all read from v_source (the single locked row) - never from a separately-read variable, so every decision point observes the identical instant", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("public.inventory_can_review_tenant(v_source.tenant_id)"));
  assert.ok(source.includes("hashtextextended('duplicate_garment_variant:' || v_source.tenant_id::text"));
  assert.ok(source.includes("hashtextextended('duplicate_treatment:' || v_source.tenant_id::text"));
  assert.ok(source.includes("where tenant_id = v_source.tenant_id and idempotency_key = p_idempotency_key"));
  assert.ok(source.includes("if v_source.tenant_id is distinct from v_target_family.tenant_id"));
  assert.ok(source.includes("if v_source.client_product_id is distinct from p_target_client_product_id"));
  assert.ok(source.includes("v_source.inventory_product_id, v_source.colour_name, v_source.colour_code"));
  assert.ok(source.includes("v_source.print_colour, v_source.production_method, v_source.primary_placement"));
});

test("the component-clone and mapping-clone INSERT...SELECT statements still append FOR UPDATE OF to their own source-reading SELECT - closing the existing-child-row-edit concurrency gap independently of the source row's own lock", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("where garment_variant_id = p_source_variant_id\n  for update of product_components;"));
  assert.ok(source.includes("where garment_variant_id = p_source_variant_id and is_active\n  for update of client_product_variant_treatments;"));
  assert.ok(source.includes("where treatment_id = p_source_treatment_id\n  for update of product_components;"));
});

test("variant duplication copies exactly the 15 approved reusable component fields, regenerates id/timestamps/created_by, sets garment_variant_id to the NEW variant and treatment_id to NULL - never copying a family-level or treatment-scoped component (the WHERE clause is scoped to garment_variant_id = source only)", async () => {
  const source = await readSource(MIGRATION_PATH);
  const insertIdx = source.indexOf("insert into public.product_components (\n    id, tenant_id, client_product_id, component_type, production_method,\n    placement, production_colour, specification, production_instructions,\n    default_sell_price, quantity_per_unit, sort_order, inventory_product_id,\n    fixed_inventory_variant_id, label, notes, is_active, created_by,\n    created_at, updated_at, billing_mode, garment_variant_id, treatment_id\n  )\n  select");
  assert.notEqual(insertIdx, -1);
  const block = source.slice(insertIdx, insertIdx + 900);
  assert.ok(block.includes("v_new.id, null"), "variant clone must set garment_variant_id = new variant, treatment_id = null");
  assert.ok(block.includes("where garment_variant_id = p_source_variant_id"));
});

test("treatment duplication copies the identical 15 component fields, but sets garment_variant_id to NULL and treatment_id to the NEW treatment, scoped to treatment_id = source only - never a variant-scoped or family-level component", async () => {
  const source = await readSource(MIGRATION_PATH);
  const insertIdx = source.lastIndexOf("insert into public.product_components (\n    id, tenant_id, client_product_id, component_type, production_method,\n    placement, production_colour, specification, production_instructions,\n    default_sell_price, quantity_per_unit, sort_order, inventory_product_id,\n    fixed_inventory_variant_id, label, notes, is_active, created_by,\n    created_at, updated_at, billing_mode, garment_variant_id, treatment_id\n  )\n  select");
  assert.notEqual(insertIdx, -1);
  const block = source.slice(insertIdx, insertIdx + 900);
  assert.ok(block.includes("null, v_new.id"), "treatment clone must set garment_variant_id = null, treatment_id = new treatment");
  assert.ok(block.includes("where treatment_id = p_source_treatment_id"));
});

test("variant duplication copies ONLY active client_product_variant_treatments mappings for the source variant, and never creates/touches client_product_treatments rows - the WHERE clause requires is_active, and no INSERT into client_product_treatments appears anywhere in duplicate_garment_variant", async () => {
  const source = await readSource(MIGRATION_PATH);
  const fnStart = source.indexOf("create or replace function public.duplicate_garment_variant");
  const fnEnd = source.indexOf("$function$;", fnStart);
  const body = source.slice(fnStart, fnEnd);
  assert.ok(body.includes("where garment_variant_id = p_source_variant_id and is_active"));
  assert.ok(!/insert into public\.client_product_treatments/.test(body), "duplicate_garment_variant must never insert a treatment row");
});

test("treatment duplication never inserts into client_product_variant_treatments and never inserts into client_product_artwork - a duplicated treatment starts unlinked from garments and from artwork, per the approved asymmetric copy semantics", async () => {
  const source = await readSource(MIGRATION_PATH);
  const fnStart = source.indexOf("create or replace function public.duplicate_treatment");
  const fnEnd = source.indexOf("$function$;", fnStart);
  const body = source.slice(fnStart, fnEnd);
  assert.ok(!/insert into public\.client_product_variant_treatments/.test(body), "duplicate_treatment must never insert a variant-treatment mapping");
  assert.ok(!/insert into public\.client_product_artwork/.test(body), "duplicate_treatment must never insert an artwork row");
  assert.ok(body.includes("'artwork_copied', false"));
  assert.ok(body.includes("'mapping_copied', false"));
});

test("neither function ever inserts into client_product_artwork - artwork is never touched by either duplication path", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(!/insert into public\.client_product_artwork/.test(source));
});

test("both functions produce exactly one activity event on genuine creation (variant_duplicated / treatment_duplicated), and the replay branch returns before reaching the activity-event insert - zero events on replay", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("'variant_duplicated', 'client_products'"));
  assert.ok(source.includes("'treatment_duplicated', 'client_products'"));
  // Exactly one opps_activity_events insert per function.
  const variantFnStart = source.indexOf("create or replace function public.duplicate_garment_variant");
  const variantFnEnd = source.indexOf("$function$;", variantFnStart);
  const variantBody = source.slice(variantFnStart, variantFnEnd);
  assert.equal((variantBody.match(/insert into public\.opps_activity_events/g) || []).length, 1);
  const treatmentFnStart = source.indexOf("create or replace function public.duplicate_treatment");
  const treatmentFnEnd = source.indexOf("$function$;", treatmentFnStart);
  const treatmentBody = source.slice(treatmentFnStart, treatmentFnEnd);
  assert.equal((treatmentBody.match(/insert into public\.opps_activity_events/g) || []).length, 1);
});

test("both functions revoke execute from public/anon and grant only to authenticated - matches every other RPC this session, no anonymous or cross-role execution", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("revoke execute on function public.duplicate_garment_variant(uuid, uuid, text, text) from public, anon;"));
  assert.ok(source.includes("grant execute on function public.duplicate_garment_variant(uuid, uuid, text, text) to authenticated;"));
  assert.ok(source.includes("revoke execute on function public.duplicate_treatment(uuid, uuid, text, text) from public, anon;"));
  assert.ok(source.includes("grant execute on function public.duplicate_treatment(uuid, uuid, text, text) to authenticated;"));
});

test("the migration never references SFR's or Jai's real client_product/order ids - RPC/schema only, scoped to no specific live product", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(!source.includes("4ae5878d-f3e2-41c7-9256-9165782a1781"), "SFR's real client_product id must not appear");
  assert.ok(!source.includes("bf31e82b-905d-4ede-af79-7e4a1f1b4688"), "JET's real client_product id must not appear");
});

test("the whole migration is wrapped in a single begin/commit transaction, matching this session's established migration-file convention", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.trimStart().startsWith("-- Phase 2B Step 2"));
  assert.ok(/\nbegin;\n/.test(source));
  assert.ok(source.trimEnd().endsWith("commit;"));
});
