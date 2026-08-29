import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const MIGRATION_PATH =
  "supabase/migrations/20260829120000_order_line_component_snapshot_artwork_revision.sql";
const PRODUCTS_EDITOR_PATH = "src/components/orders/drawer/ProductsEditor.jsx";
const ARTWORK_API_PATH = "src/api/artworkLinking.js";

// ─────────────────────────────────────────────────────────────────────
// Order Line Coherence Phase 1E - Edit Production + placement-specific
// artwork linking.
//
// Backend: revise_order_line_component_snapshot_artwork - a sibling of
// revise_order_line_component_snapshot (PR #49). Same append/supersede
// revision model; the only field it changes is artwork_revision_ids.
//
// LIVE VERIFICATION (one disposable BEGIN ... ROLLBACK against the linked
// project slhcvyeuqsduaglddqdb, real staff actor
// 2e7f49f6-1bee-456a-8d3b-a623a8df0dec, nothing persisted - post-rollback
// fn_exists:0, ph1e_orders:0, relink_events:0):
//   - positive relink Front r1 -> r2: ok:true, new snapshot revision:2,
//     is_current:true, artwork_revision_ids:[aw_front_r2]; old Front row
//     is_current:false, superseded_by set, revision:1, artwork STILL
//     [aw_front_r1]; exactly one current row for the Front lineage.
//   - BACK ISOLATION: after the Front relink, snap_back is_current:true,
//     revision:1, superseded_by null, artwork STILL [aw_back_r1], and the
//     Back lineage still has exactly ONE row total - the Front relink
//     created no Back revision and touched no Back field.
//   - tracking carried forward: the new Front snapshot has one tracking
//     row carrying production_stage 'print_setup', production_method
//     'dtf', notes 'front tracking note' - exact current state, not
//     reset; the old Front tracking row and the Back tracking row are
//     both untouched.
//   - one production_artwork_relink activity event, metadata
//     artwork_revision_ids.before contains aw_front_r1, .after contains
//     aw_front_r2.
//   - rejections (all explicit, each caught in its own subtransaction):
//       empty/null array          -> SNAPSHOT_ARTWORK_RELINK_ARTWORK_REQUIRED
//       Back artwork vs Front snap -> SNAPSHOT_ARTWORK_RELINK_PLACEMENT_MISMATCH
//       other client_product art   -> SNAPSHOT_ARTWORK_RELINK_CLIENT_PRODUCT_MISMATCH
//       treatment_id != null art   -> SNAPSHOT_ARTWORK_RELINK_TREATMENT_SCOPE_MISMATCH
//       treatment-scoped source    -> SNAPSHOT_ARTWORK_RELINK_SCOPED_COMPONENT
//       p_expected_revision = 99   -> SNAPSHOT_REVISION_STALE
//       relink to already-current  -> SNAPSHOT_ARTWORK_RELINK_NO_CHANGE
//       reuse superseded snap id   -> SNAPSHOT_REVISION_STALE
//   - grants: has_function_privilege authenticated EXECUTE = true, anon =
//     false; prosecdef = true; proconfig search_path = 'pg_catalog,
//     public'; proacl = {postgres, authenticated, service_role} only (no
//     anon, no PUBLIC).
// ─────────────────────────────────────────────────────────────────────

// ---- Migration: shape & safety -------------------------------------

test("migration is a single new function - no new column, no table/grant change to order_line_component_snapshots itself", async () => {
  const sql = await readSource(MIGRATION_PATH);
  assert.match(sql, /create or replace function public\.revise_order_line_component_snapshot_artwork/);
  assert.doesNotMatch(sql, /alter table public\.order_line_component_snapshots/i);
  assert.doesNotMatch(sql, /add column/i);
  // the only grant/revoke STATEMENTS in the file are on the new function
  const grantLines = sql.split("\n").filter((l) => /^\s*(grant|revoke)\s/i.test(l));
  assert.ok(grantLines.length >= 2);
  assert.ok(grantLines.every((l) => /revise_order_line_component_snapshot_artwork/.test(l)));
});

test("signature is (p_snapshot_id uuid, p_artwork_revision_ids uuid[], p_expected_revision integer), SECURITY DEFINER, locked search_path", async () => {
  const sql = await readSource(MIGRATION_PATH);
  assert.match(
    sql,
    /revise_order_line_component_snapshot_artwork\(\s*p_snapshot_id uuid,\s*p_artwork_revision_ids uuid\[\],\s*p_expected_revision integer\s*\)/,
  );
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path to 'pg_catalog', 'public'/i);
});

test("staff authorization via is_opps_staff(), evaluated AFTER the row is locked FOR UPDATE - matching the sibling RPC", async () => {
  const sql = await readSource(MIGRATION_PATH);
  const lockIdx = sql.indexOf("from public.order_line_component_snapshots where id = p_snapshot_id for update");
  const authIdx = sql.indexOf("if not public.is_opps_staff()");
  assert.ok(lockIdx > 0 && authIdx > lockIdx, "is_opps_staff check must come after the FOR UPDATE lock");
});

test("requires is_current = true on the locked row, raising the shared SNAPSHOT_REVISION_STALE token", async () => {
  const sql = await readSource(MIGRATION_PATH);
  assert.match(sql, /if not v_old\.is_current then\s*\n\s*raise exception 'SNAPSHOT_REVISION_STALE/);
});

test("optimistic concurrency: an explicit p_expected_revision vs v_old.revision check, also raising SNAPSHOT_REVISION_STALE", async () => {
  const sql = await readSource(MIGRATION_PATH);
  assert.match(sql, /if v_old\.revision <> p_expected_revision then\s*\n\s*raise exception 'SNAPSHOT_REVISION_STALE/);
});

test("no unlink: an empty or null artwork array is a hard SNAPSHOT_ARTWORK_RELINK_ARTWORK_REQUIRED error, never a silent remove", async () => {
  const sql = await readSource(MIGRATION_PATH);
  assert.match(
    sql,
    /if p_artwork_revision_ids is null\s*\n\s*or array_length\(p_artwork_revision_ids, 1\) is null\s*\n\s*or array_length\(p_artwork_revision_ids, 1\) < 1 then\s*\n\s*raise exception 'SNAPSHOT_ARTWORK_RELINK_ARTWORK_REQUIRED/,
  );
  assert.match(sql, /unnest\(p_artwork_revision_ids\) x where x is null/);
  // no branch anywhere assigns an empty array into the artwork column
  assert.doesNotMatch(sql, /artwork_revision_ids\s*=\s*'\{\}'/);
  assert.doesNotMatch(sql, /artwork_revision_ids\s*:=\s*'\{\}'/);
});

test("every supplied artwork revision is validated: same client_product_id, same placement, family (treatment_id IS NULL) namespace", async () => {
  const sql = await readSource(MIGRATION_PATH);
  assert.match(sql, /count\(\*\) filter \(where a\.client_product_id is distinct from v_old\.client_product_id\)/);
  assert.match(sql, /count\(\*\) filter \(where a\.placement is distinct from v_old\.placement\)/);
  assert.match(sql, /count\(\*\) filter \(where a\.treatment_id is not null\)/);
  assert.match(sql, /SNAPSHOT_ARTWORK_RELINK_CLIENT_PRODUCT_MISMATCH/);
  assert.match(sql, /SNAPSHOT_ARTWORK_RELINK_PLACEMENT_MISMATCH/);
  assert.match(sql, /SNAPSHOT_ARTWORK_RELINK_TREATMENT_SCOPE_MISMATCH/);
  assert.match(sql, /SNAPSHOT_ARTWORK_RELINK_ARTWORK_NOT_FOUND/);
});

test("placement mismatch message names Front/Back independence explicitly", async () => {
  const sql = await readSource(MIGRATION_PATH);
  assert.match(sql, /SNAPSHOT_ARTWORK_RELINK_PLACEMENT_MISMATCH:[^\n]*Front and Back artwork stay independent/);
});

test("defence in depth: a still-resolvable treatment-/variant-scoped source component is refused, but a deleted source is tolerated", async () => {
  const sql = await readSource(MIGRATION_PATH);
  assert.match(sql, /if v_old\.source_product_component_id is not null then/);
  assert.match(sql, /pc\.treatment_id is not null or pc\.garment_variant_id is not null/);
  assert.match(sql, /coalesce\(v_scoped_component, false\)/);
  assert.match(sql, /SNAPSHOT_ARTWORK_RELINK_SCOPED_COMPONENT/);
});

test("no-op guard: relinking to the exact set already linked raises SNAPSHOT_ARTWORK_RELINK_NO_CHANGE (sorted comparison, no wasted revision)", async () => {
  const sql = await readSource(MIGRATION_PATH);
  assert.match(sql, /v_before_sorted := \(select coalesce\(array_agg\(x order by x\)/);
  assert.match(sql, /v_after_sorted := \(select array_agg\(x order by x\) from unnest\(p_artwork_revision_ids\) x\)/);
  assert.match(sql, /if v_before_sorted = v_after_sorted then\s*\n\s*raise exception 'SNAPSHOT_ARTWORK_RELINK_NO_CHANGE/);
});

test("creates a new revision instead of updating the frozen row - same three-step ordering as the sibling RPC", async () => {
  const sql = await readSource(MIGRATION_PATH);
  const insertIdx = sql.indexOf("insert into public.order_line_component_snapshots (");
  const oldNonCurrentIdx = sql.indexOf("set is_current = false, superseded_by = v_new.id");
  const promoteIdx = sql.indexOf("set is_current = true");
  assert.ok(insertIdx > 0 && oldNonCurrentIdx > insertIdx && promoteIdx > oldNonCurrentIdx,
    "must insert new row non-current, then supersede old, then promote new");
  assert.match(sql, /false, v_old\.revision \+ 1, null, v_old\.component_revision_key/);
});

test("all non-artwork snapshot fields are copied verbatim from v_old; only artwork_revision_ids becomes p_artwork_revision_ids", async () => {
  const sql = await readSource(MIGRATION_PATH);
  const valuesBlock = sql.slice(sql.indexOf(") values (", sql.indexOf("insert into public.order_line_component_snapshots (")));
  const insertValues = valuesBlock.slice(0, valuesBlock.indexOf("returning * into v_new"));
  for (const f of [
    "v_old.tenant_id", "v_old.order_id", "v_old.line_id", "v_old.client_product_id",
    "v_old.source_product_component_id", "v_old.component_type", "v_old.label",
    "v_old.production_method", "v_old.placement", "v_old.production_colour",
    "v_old.specification", "v_old.production_instructions", "v_old.sell_price",
    "v_old.billing_mode", "v_old.quantity_per_unit", "v_old.sort_order",
    "v_old.inventory_product_id", "v_old.resolved_inventory_variant_id", "v_old.notes",
  ]) {
    assert.ok(insertValues.includes(f), `new revision must copy ${f} verbatim`);
  }
  assert.ok(insertValues.includes("p_artwork_revision_ids"), "artwork column takes the new value");
  assert.ok(!insertValues.includes("v_old.artwork_revision_ids"), "old artwork array is not carried into the new revision");
});

test("production tracking is carried forward exactly like the sibling RPC - INSERT a new row against the new snapshot, old tracking untouched", async () => {
  const sql = await readSource(MIGRATION_PATH);
  assert.match(sql, /select \* into v_old_tracking from public\.order_line_production_tracking where order_line_component_snapshot_id = v_old\.id/);
  assert.match(sql, /insert into public\.order_line_production_tracking \(/);
  assert.match(sql, /v_old_tracking\.production_method, v_old_tracking\.production_stage, v_old_tracking\.inventory_supplier_variant_id, v_old_tracking\.quantity_allocated, v_old_tracking\.notes/);
  // never an UPDATE that repoints the old tracking row
  assert.doesNotMatch(sql, /update public\.order_line_production_tracking/i);
});

test("writes exactly one production_artwork_relink activity event with before/after artwork revision id arrays", async () => {
  const sql = await readSource(MIGRATION_PATH);
  assert.match(sql, /'production_artwork_relink', 'orders', v_old\.order_id/);
  assert.match(sql, /'artwork_revision_ids', jsonb_build_object\(\s*\n\s*'before', to_jsonb\(coalesce\(v_old\.artwork_revision_ids/);
  assert.match(sql, /'after', to_jsonb\(p_artwork_revision_ids\)/);
  assert.equal(sql.match(/insert into public\.opps_activity_events/g).length, 1);
});

test("authenticated gets EXECUTE only; public and anon are revoked", async () => {
  const sql = await readSource(MIGRATION_PATH);
  assert.match(sql, /revoke execute on function public\.revise_order_line_component_snapshot_artwork\(uuid, uuid\[\], integer\) from public, anon/);
  assert.match(sql, /grant execute on function public\.revise_order_line_component_snapshot_artwork\(uuid, uuid\[\], integer\) to authenticated/);
});

test("the base immutability model is untouched - no UPDATE/DELETE grant to authenticated is introduced anywhere in the migration", async () => {
  const sql = await readSource(MIGRATION_PATH);
  assert.doesNotMatch(sql, /grant[^;]*update[^;]*on[^;]*order_line_component_snapshots/i);
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*on[^;]*order_line_component_snapshots/i);
});

// ---- Frontend RPC wrapper ----------------------------------------

test("artworkLinking.js exposes reviseOrderLineComponentSnapshotArtwork wrapping the new RPC, with the sibling's error/data shape", async () => {
  const src = await readSource(ARTWORK_API_PATH);
  assert.match(src, /export async function reviseOrderLineComponentSnapshotArtwork/);
  assert.match(src, /supabase\.rpc\("revise_order_line_component_snapshot_artwork"/);
  assert.match(src, /p_snapshot_id:/);
  assert.match(src, /p_artwork_revision_ids:/);
  assert.match(src, /p_expected_revision:/);
});

test("the wrapper refuses to call the RPC with an empty artwork array - the no-unlink contract is enforced client-side too", async () => {
  const src = await readSource(ARTWORK_API_PATH);
  assert.match(src, /artworkRevisionIds[\s\S]{0,120}length[\s\S]{0,60}(return|error)/);
});

// ---- ProductsEditor: Edit production modal ------------------------

test("each frozen snapshot renders a Rev N indicator and an Edit production action", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  assert.match(src, /Rev \{snapshot\.revision \|\| 1\}/);
  assert.match(src, /Edit production/);
  assert.match(src, /onEditProduction\?\.\(snapshot\)/);
});

test("Edit production calls the revise RPC (not a direct snapshot update) with all eight editable fields as explicit params", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  const call = src.slice(src.indexOf('supabase.rpc("revise_order_line_component_snapshot"'), src.indexOf('supabase.rpc("revise_order_line_component_snapshot"') + 600);
  for (const p of ["p_snapshot_id", "p_label", "p_placement", "p_production_method", "p_production_colour", "p_specification", "p_production_instructions", "p_sell_price", "p_billing_mode"]) {
    assert.ok(call.includes(p), `revise call must pass ${p}`);
  }
  // never a direct table write to the frozen snapshot
  assert.doesNotMatch(src, /OrderLineComponentSnapshot\.update\(/);
  assert.doesNotMatch(src, /OrderLineComponentSnapshot\.delete\(/);
});

test("the modal submits explicit current values - a blank input falls back to the snapshot's own value, no clear-field path", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  assert.match(src, /const keepOr = \(raw, current\) =>/);
  assert.match(src, /return v === "" \|\| v == null \? current : raw;/);
  assert.match(src, /label: keepOr\(form\.label, snapshot\.label\)/);
  assert.match(src, /sell_price: sellRaw === "" \? snapshot\.sell_price : Number\(sellRaw\)/);
});

test("Cancel writes nothing - the cancel handler only closes the modal, it never calls a mutation", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  assert.match(src, /onCancel=\{\(\) => setEditingSnapshot\(null\)\}/);
  assert.match(src, /<Button variant="outline"[^>]*onClick=\{onCancel\} disabled=\{saving\}>Cancel<\/Button>/);
});

test("duplicate submit is prevented while saving - Save disabled on reviseProduction.isPending, and submit() early-returns when saving", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  assert.match(src, /saving=\{reviseProduction\.isPending\}/);
  assert.match(src, /const submit = \(\) => \{\s*\n\s*if \(saving\) return;/);
  assert.match(src, /onClick=\{submit\} disabled=\{saving\}/);
});

test("on success: snapshot + tracking queries are invalidated and the toast names the new revision number", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  const block = src.slice(src.indexOf("const reviseProduction = useMutation"), src.indexOf("const reviseProduction = useMutation") + 1400);
  assert.match(block, /invalidateQueries\(\{ queryKey: \["orderLineComponentSnapshots", order\.id\] \}\)/);
  assert.match(block, /invalidateQueries\(\{ queryKey: \["orderLineProductionTracking", order\.id\] \}\)/);
  assert.match(block, /Production updated — revision \$\{rev\}/);
});

test("SNAPSHOT_REVISION_STALE is handled explicitly: refetch current snapshots, clear message, close - never a silent retry against the old id", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  const block = src.slice(src.indexOf("const reviseProduction = useMutation"), src.indexOf("const reviseProduction = useMutation") + 1400);
  assert.match(block, /if \(msg\.includes\("SNAPSHOT_REVISION_STALE"\)\)/);
  assert.match(block, /Another change was saved first/);
  assert.doesNotMatch(block, /retry|\.mutate\(/i);
});

test("the modal only edits the phase's fields; immutable/history fields are surfaced as read-only copy, not inputs", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  assert.match(src, /Immutable: snapshot id, revision lineage, source component, inventory identity, artwork revision ids, timestamps/);
});

// ---- ProductsEditor: placement artwork ---------------------------

test("the per-snapshot Artwork section is placement-scoped and only renders for components that have a placement", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  assert.match(src, /\{snapshot\.placement && \(\(\) => \{[\s\S]*?Artwork · \{snapshot\.placement\}/);
});

test("linking flows through the EXISTING artwork RPCs: find_or_create_client_product_artwork_from_asset then revise_order_line_component_snapshot_artwork - no second file store", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  const block = src.slice(src.indexOf("const relinkArtwork = useMutation"), src.indexOf("const relinkArtwork = useMutation") + 1600);
  assert.match(block, /findOrCreateClientProductArtworkFromAsset\(\{/);
  assert.match(block, /placement: snapshot\.placement/);
  assert.match(block, /reviseOrderLineComponentSnapshotArtwork\(\{/);
  assert.match(block, /expectedRevision: snapshot\.revision/);
  // the selected asset is passed by reference, never re-uploaded here
  assert.doesNotMatch(block, /UploadFile|\.create\(\{[\s\S]*file_url/);
});

test("the artwork picker reuses the shared ClientAssetPickerModal in single mode with Upload New enabled (uploadCategory Artwork)", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  const modal = src.slice(src.indexOf("artworkPickerSnapshot && ("), src.indexOf("artworkPickerSnapshot && (") + 1200);
  assert.match(modal, /<ClientAssetPickerModal/);
  assert.match(modal, /selectionMode="single"/);
  assert.match(modal, /uploadCategory="Artwork"/);
  assert.match(modal, /clientId=\{order\.client_id\}/);
});

test("relink passes the snapshot's own placement, so a Front relink resolves a Front artwork revision and a Back relink a Back one - independence is per-snapshot", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  // one picker, keyed by the specific snapshot; placement always comes from that snapshot
  assert.match(src, /onChangeArtwork=\{\(snapshot\) => setArtworkPickerSnapshot\(snapshot\)\}/);
  assert.match(src, /relinkArtwork\.mutate\(\{ snapshot: artworkPickerSnapshot, clientProduct: cp, asset \}\)/);
});

test("artwork relink success invalidates the snapshot query so only the new current revision renders; stale + no-change are handled without a retry", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  const block = src.slice(src.indexOf("const relinkArtwork = useMutation"), src.indexOf("const relinkArtwork = useMutation") + 1800);
  assert.match(block, /invalidateQueries\(\{ queryKey: \["orderLineComponentSnapshots", order\.id\] \}\)/);
  assert.match(block, /SNAPSHOT_REVISION_STALE/);
  assert.match(block, /SNAPSHOT_ARTWORK_RELINK_NO_CHANGE/);
});

test("the live snapshot query still only ever reads is_current rows - the working UI never renders a superseded revision", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  assert.match(src, /OrderLineComponentSnapshot\.filter\(\{ order_id: order\.id, is_current: true \}/);
});

test("treatment/family gating is intact - ComponentFieldsForm's allowArtworkLinking path is untouched by this phase", async () => {
  const src = await readSource("src/components/composition/ComponentFieldsForm.jsx");
  assert.match(src, /allowArtworkLinking = true/);
  assert.match(src, /allowArtworkLinking && form\.component_type === "print_service" && effectivePlacement/);
});

// ---- PR #53 review: placement-vs-artwork consistency guard --------

test("a snapshot with linked artwork disables the placement control (select + custom input), derived from artwork_revision_ids.length > 0", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  assert.match(
    src,
    /const artworkLinked = Array\.isArray\(snapshot\.artwork_revision_ids\) && snapshot\.artwork_revision_ids\.length > 0;/,
  );
  const modal = src.slice(src.indexOf("function EditProductionModal"), src.indexOf("function OptionChipGroup"));
  // placement <select> is disabled on artworkLinked
  assert.match(modal, /<select[\s\S]*?value=\{form\.placementChoice\}[\s\S]*?disabled=\{artworkLinked\}/);
  // the custom placement <Input> is disabled on artworkLinked too
  assert.match(modal, /placeholder="Custom placement"[\s\S]*?disabled=\{artworkLinked\}/);
});

test("submit() can never send a different placement for a linked-artwork snapshot - it is pinned to snapshot.placement", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  assert.match(
    src,
    /placement: artworkLinked \? snapshot\.placement : keepOr\(placementRaw, snapshot\.placement\)/,
  );
});

test("a snapshot with NO linked artwork keeps placement fully editable - the disable is gated only on artworkLinked, nothing else", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  const modal = src.slice(src.indexOf("function EditProductionModal"), src.indexOf("function OptionChipGroup"));
  // the only `disabled=` on the placement select is artworkLinked (not `saving`, not a constant)
  const placementSelect = modal.slice(modal.indexOf("value={form.placementChoice}"), modal.indexOf("</select>", modal.indexOf("value={form.placementChoice}")));
  const disables = placementSelect.match(/disabled=\{[^}]+\}/g) || [];
  assert.deepEqual(disables, ["disabled={artworkLinked}"]);
  // placement select still has a live onChange that updates form state
  assert.match(placementSelect, /onChange=\{\(e\) => set\(\{ placementChoice: e\.target\.value \}\)\}/);
});

test("the placement lock shows the exact reviewer-specified helper text, and only when artwork is linked", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  assert.match(
    src,
    /\{artworkLinked && \(\s*\n\s*<p[^>]*>\s*\n\s*Placement is locked while artwork is linked\. Change\/relink artwork first or use a dedicated placement-change flow\.\s*\n\s*<\/p>/,
  );
});

test("artwork relink behavior is unchanged by the guard - still find_or_create then the relink RPC, still per-snapshot placement", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  const block = src.slice(src.indexOf("const relinkArtwork = useMutation"), src.indexOf("const relinkArtwork = useMutation") + 1600);
  assert.match(block, /findOrCreateClientProductArtworkFromAsset\(\{/);
  assert.match(block, /placement: snapshot\.placement/);
  assert.match(block, /reviseOrderLineComponentSnapshotArtwork\(\{/);
  assert.match(block, /expectedRevision: snapshot\.revision/);
});

test("the guard is client-side only - no change to the migration or the revise RPC signature/params", async () => {
  const src = await readSource(PRODUCTS_EDITOR_PATH);
  const migration = await readSource(MIGRATION_PATH);
  // revise call still passes exactly the original 8 editable params, unchanged
  const call = src.slice(src.indexOf('supabase.rpc("revise_order_line_component_snapshot"'), src.indexOf('supabase.rpc("revise_order_line_component_snapshot"') + 600);
  assert.match(call, /p_placement: values\.placement/);
  // the new migration is still only the artwork-relink function
  assert.doesNotMatch(migration, /create or replace function public\.revise_order_line_component_snapshot\b(?!_artwork)/);
});

test("no XOS / PayFast surface is touched by this phase", async () => {
  const editor = await readSource(PRODUCTS_EDITOR_PATH);
  const api = await readSource(ARTWORK_API_PATH);
  const migration = await readSource(MIGRATION_PATH);
  for (const src of [editor, api, migration]) {
    assert.doesNotMatch(src, /payfast|pay_fast|xos_|x_lab_orders/i);
  }
});
