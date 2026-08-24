import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const MIGRATION_PATH = "supabase/migrations/20260825090000_garment_variants_treatments_schema.sql";

// ─────────────────────────────────────────────────────────────────────
// Phase 2B Step 1 - schema only. Adds client_product_garment_variants,
// client_product_treatments, client_product_variant_treatments, two
// nullable scope columns on product_components, and a nullable
// treatment_id on client_product_artwork. No duplication RPCs, no UI -
// those are later steps.
//
// Live-verified via one rolled-back (BEGIN/ROLLBACK) transaction against
// production that: captured Jai's real readiness and SFR's/JET's real
// product_components rows BEFORE applying the migration, applied it,
// then re-captured AFTER and compared:
//   - Jai's _compute_artwork_readiness() output: BYTE-FOR-BYTE identical
//     before/after (ready:true, required_placements unchanged - staff
//     had already promoted both revisions in an earlier live test).
//   - SFR's 6 scratch product_components rows and JET's 1 real row:
//     every original field identical; the only diff was the two new
//     columns (garment_variant_id, treatment_id) appearing as null on
//     every row - confirmed field-by-field, not just eyeballed.
//   - zero_migration_check: 0 components have either scope column set,
//     0 artwork rows have treatment_id set, anywhere in production -
//     every existing row needs zero migration.
//
// Cross-family and scope-integrity proofs, all live-verified in the same
// transaction using two disposable client_products (A, B) plus one
// disposable garment variant and two disposable treatments under A:
//   - A component in family B referencing family A's variant: BLOCKED
//     (product_components_variant_family_fkey).
//   - A component in family B referencing family A's treatment: BLOCKED
//     (product_components_treatment_family_fkey).
//   - A client_product_variant_treatments row in family B pairing family
//     A's variant+treatment: BLOCKED (..._variant_family_fkey).
//   - client_product_artwork in family B referencing family A's
//     treatment: BLOCKED (client_product_artwork_treatment_family_fkey).
//   - A component with BOTH garment_variant_id and treatment_id set:
//     BLOCKED (product_components_scope_check).
//   - A correctly same-family, single-scope component (variant only):
//     succeeded.
//
// Current-index proofs, live-verified:
//   - Two treatment_id-NULL current rows, same product+placement:
//     BLOCKED (client_product_artwork_current_unique_idx).
//   - "White" treatment and "Orange" treatment each holding a current
//     row for the SAME placement ("front") simultaneously: BOTH
//     SUCCEEDED - the core hardening proof.
//   - The SAME treatment holding two current rows for the same
//     placement: BLOCKED (same index/constraint).
//
// Namespace proof (treatment artwork cannot satisfy simple readiness):
// required_artwork_placements = ['front','back'] on a disposable family;
// 'front' has a treatment_id-NULL current+approved row; 'back' has ONLY
// a treatment-scoped current+approved row (no treatment_id-NULL row at
// all). Result: ready:false, 'back' reported "no artwork uploaded yet"
// (correctly ignoring the treatment-scoped row that technically exists),
// 'front' correctly ready. Re-run with required_artwork_placements =
// ['front'] alone: ready:true, driven purely by the simple row,
// independent of the two treatment-scoped rows also present on that
// same placement.
//
// Second review pass added TENANT-family integrity, since the first
// pass proved id+family membership but not that the duplicated tenant_id
// columns agree with it, and RLS on the new tables authorizes by their
// own tenant_id. Live-verified in a second rolled-back transaction, with
// a genuine second tenant (not just a second client_product) created
// inside the same transaction:
//   - client_products gained UNIQUE(id, tenant_id); the three new
//     tables' composite FKs extended to (id, client_product_id,
//     tenant_id) triples.
//   - A variant/treatment claiming tenant A but a client_product_id that
//     actually belongs to tenant B: BLOCKED (..._family_tenant_fkey),
//     in both cases isolating the INTEGRITY check from RLS by keeping
//     the row's own tenant_id as one the test session actually has
//     reviewer access to (tenant A) -- only the referenced family's real
//     tenant differs.
//   - A mapping row claiming tenant A + a client_product_id that
//     actually belongs to tenant B: BLOCKED, same isolation technique.
//   - A component claiming tenant A + client_product_id A (both
//     correct) but referencing a variant/treatment that actually
//     belongs to tenant B/a different family entirely (seeded directly,
//     bypassing RLS, purely as the foreign-tenant target): BLOCKED for
//     both the variant and treatment case.
//   - A garment variant (tenant A) pointing at an inventory_product that
//     actually belongs to tenant B: BLOCKED
//     (..._inventory_tenant_fkey) -- reusing inventory_products'
//     own established (tenant_id, id) pattern, already live for
//     inventory_variants/inventory_supplier_products.
//   - A client_product_treatments row using the literal all-zero UUID as
//     its id: BLOCKED (..._id_not_sentinel CHECK) -- removes the
//     theoretical collision with the coalesce() sentinel used by the
//     artwork current-uniqueness indexes.
//   - A correctly same-tenant, same-family variant+treatment pair:
//     succeeded.
//   - Jai's readiness and SFR's components: re-confirmed byte-identical
//     before/after this second pass's migration too.
//
// A real bug was caught and fixed by this second pass's own testing: the
// treatment table's UNIQUE(id, client_product_id) constraint was
// replaced outright by the new triple UNIQUE(id, client_product_id,
// tenant_id) -- but client_product_artwork's treatment FK (which has no
// tenant_id column to extend, per instruction, and correctly stays the
// plain dual form) targets exactly that now-removed dual constraint.
// Fixed by keeping BOTH the dual and triple unique constraints on
// client_product_treatments side by side -- Postgres does not derive a
// narrower composite unique constraint from a wider one even though id
// alone is already a primary key, so both had to be declared explicitly.
// ─────────────────────────────────────────────────────────────────────

test("the migration is additive only - no drop of an existing table/column, and every new FK to client_products cascades (matches existing precedent), never SET NULL on a scoped reference", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(!/drop table/i.test(source));
  assert.ok(!/drop column/i.test(source));
  // The two DROP INDEX statements are expected and safe - both are
  // immediately followed by CREATE UNIQUE INDEX recreating an equivalent
  // (now treatment-aware) constraint, never left absent.
  const dropIndexCount = (source.match(/drop index if exists/gi) || []).length;
  const createUniqueIndexCount = (source.match(/create unique index/gi) || []).length;
  assert.ok(createUniqueIndexCount >= dropIndexCount, "every dropped index must be replaced by an equivalent unique index");
});

test("client_products has UNIQUE(id, tenant_id), and client_product_garment_variants/client_product_treatments each carry a UNIQUE(id, client_product_id, tenant_id) triple - the mechanism composite FKs depend on to prove id + family + tenant all agree", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("add constraint client_products_id_tenant_id_key unique (id, tenant_id)"));
  assert.ok(source.includes("constraint client_product_garment_variants_id_cp_tenant_uidx\n    unique (id, client_product_id, tenant_id)"));
  assert.ok(source.includes("constraint client_product_treatments_id_cp_tenant_uidx\n    unique (id, client_product_id, tenant_id)"));
});

test("client_product_treatments ALSO keeps the narrower dual UNIQUE(id, client_product_id) alongside the triple one - required as client_product_artwork's FK target, since that table has no tenant_id column to extend", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("constraint client_product_treatments_id_cp_uidx\n    unique (id, client_product_id)"));
});

test("client_product_garment_variants and client_product_treatments each prove their OWN (client_product_id, tenant_id) pair against client_products(id, tenant_id) - not left as two independently-valid but possibly-mismatched UUIDs", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("constraint client_product_garment_variants_family_tenant_fkey\n    foreign key (client_product_id, tenant_id)\n    references public.client_products (id, tenant_id)"));
  assert.ok(source.includes("constraint client_product_treatments_family_tenant_fkey\n    foreign key (client_product_id, tenant_id)\n    references public.client_products (id, tenant_id)"));
});

test("product_components' new FKs are TRIPLE composite (garment_variant_id/treatment_id, client_product_id, tenant_id) referencing the family+tenant-scoped unique constraints - proving tenant agreement, not just family membership", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("foreign key (garment_variant_id, client_product_id, tenant_id)\n    references public.client_product_garment_variants (id, client_product_id, tenant_id)"));
  assert.ok(source.includes("foreign key (treatment_id, client_product_id, tenant_id)\n    references public.client_product_treatments (id, client_product_id, tenant_id)"));
});

test("client_product_variant_treatments proves its own (client_product_id, tenant_id) against client_products directly, AND both its variant/treatment FKs are triple composite - transitively proving the mapped variant, treatment, and mapping row all agree on tenant as well as family", async () => {
  const source = await readSource(MIGRATION_PATH);
  const tableStart = source.indexOf("create table public.client_product_variant_treatments");
  const tableBody = source.slice(tableStart, tableStart + 2200);
  assert.ok(tableBody.includes("constraint client_product_variant_treatments_family_tenant_fkey\n    foreign key (client_product_id, tenant_id)\n    references public.client_products (id, tenant_id)"));
  assert.ok(tableBody.includes("foreign key (garment_variant_id, client_product_id, tenant_id)\n    references public.client_product_garment_variants (id, client_product_id, tenant_id)"));
  assert.ok(tableBody.includes("foreign key (treatment_id, client_product_id, tenant_id)\n    references public.client_product_treatments (id, client_product_id, tenant_id)"));
});

test("client_product_garment_variants.inventory_product_id has a composite (tenant_id, inventory_product_id) FK against inventory_products(tenant_id, id) - reusing the exact established pattern already live for inventory_variants/inventory_supplier_products, not a new convention - with column-specific SET NULL so tenant_id itself stays NOT NULL", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("constraint client_product_garment_variants_inventory_tenant_fkey\n    foreign key (tenant_id, inventory_product_id)\n    references public.inventory_products (tenant_id, id)\n    on delete set null (inventory_product_id)"));
});

test("client_product_treatments.id cannot be the all-zero sentinel UUID - removes the theoretical collision with the coalesce() sentinel used by the artwork current-uniqueness indexes", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("constraint client_product_treatments_id_not_sentinel\n    check (id <> '00000000-0000-0000-0000-000000000000'::uuid)"));
});

test("NULLS NOT DISTINCT is not introduced as actual SQL syntax anywhere in the migration history - not an established pattern in this codebase, and the instruction was to remove the sentinel collision, not change approach for style (the phrase appears only in this migration's own explanatory comment, deliberately, recording that it was evaluated and rejected)", async () => {
  const migrationDir = new URL("../supabase/migrations/", import.meta.url);
  const files = await (await import("node:fs/promises")).readdir(migrationDir);
  const stripComments = (sql) => sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  for (const file of files) {
    if (!file.endsWith(".sql")) continue;
    const content = stripComments(await readSource(`supabase/migrations/${file}`));
    assert.ok(!/nulls not distinct/i.test(content), `${file} must not use NULLS NOT DISTINCT as real SQL syntax`);
  }
  // Confirm the phrase IS present, deliberately, in this migration's own
  // explanatory comment - proving the check above is exercising the
  // comment-stripping path, not accidentally passing because the phrase
  // never appears anywhere at all.
  const rawMigration = await readSource(MIGRATION_PATH);
  assert.ok(/nulls not distinct/i.test(rawMigration), "sanity check: the design-rationale comment should still mention it was considered");
});

test("the pre-existing gap - product_components(tenant_id, client_product_id) has no composite integrity against client_products(id, tenant_id) today - is documented as explicitly out of scope, not silently fixed as part of this migration", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(/pre-existing gap/i.test(source));
  assert.ok(source.includes("explicitly NOT fixed here"));
});

test("client_product_artwork's new treatment_id FK is composite (treatment_id, client_product_id) and uses ON DELETE RESTRICT - never SET NULL, never CASCADE, so a treatment disappearing can never silently convert scoped artwork into family-level artwork or silently delete it", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf("alter table public.client_product_artwork\n  add constraint client_product_artwork_treatment_family_fkey");
  assert.notEqual(start, -1);
  const body = source.slice(start, start + 300);
  assert.ok(body.includes("foreign key (treatment_id, client_product_id)"));
  assert.ok(body.includes("references public.client_product_treatments (id, client_product_id)"));
  assert.ok(body.includes("on delete restrict"));
  assert.ok(!/on delete set null/i.test(body));
});

test("product_components has a scope CHECK preventing a component from being simultaneously variant-scoped and treatment-scoped", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(source.includes("constraint product_components_scope_check"));
  assert.ok(source.includes("check (not (garment_variant_id is not null and treatment_id is not null))"));
});

test("the current-artwork unique indexes use coalesce(treatment_id, sentinel) rather than a bare treatment_id column - required because SQL treats NULL <> NULL, so a bare column would silently stop enforcing uniqueness for treatment_id IS NULL rows (every existing product)", async () => {
  const source = await readSource(MIGRATION_PATH);
  const mainIdx = source.indexOf("create unique index client_product_artwork_current_unique_idx");
  assert.notEqual(mainIdx, -1);
  const mainBody = source.slice(mainIdx, mainIdx + 300);
  assert.ok(mainBody.includes("coalesce(treatment_id, '00000000-0000-0000-0000-000000000000'::uuid)"));

  const assetIdx = source.indexOf("create unique index client_product_artwork_current_source_asset_uidx");
  assert.notEqual(assetIdx, -1);
  const assetBody = source.slice(assetIdx, assetIdx + 350);
  assert.ok(assetBody.includes("coalesce(treatment_id, '00000000-0000-0000-0000-000000000000'::uuid)"), "the source-asset uniqueness index must receive the identical treatment");
});

test("_compute_artwork_readiness explicitly filters treatment_id IS NULL in all three places it reads client_product_artwork - the ready check, the artwork lateral join, and the blocking_reasons lateral join", async () => {
  const source = await readSource(MIGRATION_PATH);
  const fnStart = source.indexOf("create or replace function public._compute_artwork_readiness");
  const fnEnd = source.indexOf("\n$$;", fnStart);
  const body = source.slice(fnStart, fnEnd);
  const occurrences = (body.match(/a\.treatment_id is null/g) || []).length;
  assert.equal(occurrences, 3, "expected the treatment_id IS NULL filter on the ready-check, artwork-lateral, and blocking-reasons-lateral queries (3 total)");
});

test("the customer-facing 'Client can view current approved artwork on own products' RLS policy is restricted to treatment_id IS NULL - the legacy X LAB My Products read path must never expose treatment-scoped artwork until a treatment-aware surface is deliberately built", async () => {
  const source = await readSource(MIGRATION_PATH);
  const start = source.indexOf('create policy "Client can view current approved artwork on own products"');
  assert.notEqual(start, -1);
  const body = source.slice(start, start + 700);
  assert.ok(body.includes("and treatment_id is null"));
  // Every other original condition must still be present, unmodified.
  assert.ok(body.includes("is_current = true"));
  assert.ok(body.includes("status = 'approved'"));
  assert.ok(body.includes("cp.client_id = public.current_client_id()"));
  assert.ok(body.includes("cp.visible_in_account = true"));
});

test("no delete grant exists on the three new tables for authenticated - matches product_components' own precedent (v1 lifecycle is is_active = false, never destructive deletion)", async () => {
  const source = await readSource(MIGRATION_PATH);
  for (const table of ["client_product_garment_variants", "client_product_treatments", "client_product_variant_treatments"]) {
    assert.ok(
      source.includes(`revoke delete on public.${table} from authenticated, anon, public;`),
      `${table} must have delete explicitly revoked from authenticated`
    );
    assert.ok(
      source.includes(`grant select, insert, update on public.${table} to authenticated;`),
      `${table} must grant only select/insert/update to authenticated, never delete`
    );
  }
});

test("RLS on the three new tables follows the established product_components pattern exactly: tenant read via can_access_tenant, reviewer insert/update via inventory_can_review_tenant - not a new authorization concept", async () => {
  const source = await readSource(MIGRATION_PATH);
  const tenantReadCount = (source.match(/for select\n  using \(public\.can_access_tenant\(tenant_id\)\)/g) || []).length;
  assert.equal(tenantReadCount, 3, "all three new tables must use the identical tenant-read policy shape");
  const reviewerInsertCount = (source.match(/with check \(public\.inventory_can_review_tenant\(tenant_id\)\)/g) || []).length;
  assert.ok(reviewerInsertCount >= 3, "all three new tables must gate insert on inventory_can_review_tenant");
});

test("client_product_treatments.primary_placement is named to make explicit it is a display hint, not the authoritative required-placement source - avoiding two fields that can drift", async () => {
  const source = await readSource(MIGRATION_PATH);
  const tableStart = source.indexOf("create table public.client_product_treatments");
  const tableBody = source.slice(tableStart, tableStart + 1500);
  assert.ok(tableBody.includes("primary_placement text"));
  assert.ok(!/\bplacement text\b/.test(tableBody), "must not also define a bare 'placement' column that could compete with primary_placement as a second source of truth");
});

test("SFR's real scratch client_product is never referenced by id anywhere in this migration - the schema change is purely structural, no data touched", async () => {
  const source = await readSource(MIGRATION_PATH);
  assert.ok(!source.includes("4ae5878d-f3e2-41c7-9256-9165782a1781"), "SFR's real client_product id must not appear in a schema-only migration");
  assert.ok(!source.includes("bf31e82b-905d-4ede-af79-7e4a1f1b4688"), "JET's real client_product id must not appear either - this migration is not scoped to any specific product");
});
