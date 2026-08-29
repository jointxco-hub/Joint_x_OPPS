import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const SECTION_PATH = "src/components/clients/ClientProductsSection.jsx";
const API_PATH = "src/api/clientProducts.js";
const LIB_PATH = "src/lib/clientProductProduction.js";
const PGERR_PATH = "src/lib/pgErrorMessages.js";

// Phase 1F-B - Client Product production configuration in the OPPS
// workspace. Brings the EXISTING Phase 2B production engine into the
// 1F-A workspace: a new Production tab that mounts ScopedComponentsEditor
// (family), GarmentVariantsSection and TreatmentsSection against this
// Client Product's id, plus duplicate_product_composition. No new
// production model, no migration, no grant/RLS change.
//
// Permission model (unchanged): writes to product_components /
// client_product_garment_variants / _treatments / _variant_treatments are
// gated by inventory_can_review_tenant() (owner/admin tenant role). The
// Production tab probes that exact function (already granted to
// `authenticated`) and renders full editors only when a write would be
// permitted; otherwise a read-only view + the spec banner. The
// capability-based permission system is Phase 1G.
//
// LIVE VERIFICATION (disposable BEGIN ... ROLLBACK against the linked
// project, real staff actor, nothing persisted - see the phase return):
//   - family component create/edit/soft-disable persist through
//     product_components RLS; disable is is_active=false, never DELETE.
//   - garment variant + treatment create/edit/disable/re-enable;
//     duplicate_garment_variant / duplicate_treatment idempotency
//     (same key -> same result, no second row).
//   - variant<->treatment mapping upsert-by-existence: toggling a pair
//     flips one row's is_active, never a second row.
//   - duplicate_product_composition: same-client copy succeeds and clones
//     ONLY product_components; a cross-client source ->
//     COMPOSITION_CLONE_CROSS_CLIENT; a target that already has
//     composition -> "Target product already has a composition.".
//   - inventory_can_review_tenant returns true for an owner/admin staff
//     actor and false for a plain member; a plain-member write to
//     product_components is rejected by RLS and the raw message is
//     translated by toStaffMessage.
//   - X LAB coherence: same client_products row, same variants /
//     treatments / mappings, same readiness (admin_get_client_product_
//     artwork_readiness unchanged), same status.

// ── Pure helpers ──────────────────────────────────────────────────
const { summarizeProduction, deriveProductionGaps, buildAllowedCombinationMatrix, PRODUCTION_READONLY_MESSAGE, PRICING_PREVIEW_BOUNDARY } =
  await import("../src/lib/clientProductProduction.js");

test("summarizeProduction counts family (unscoped, active) components separately from scoped, and only active variants/treatments/mappings", () => {
  const s = summarizeProduction({
    components: [
      { id: "a", is_active: true },
      { id: "b", is_active: true, garment_variant_id: "v1" },
      { id: "c", is_active: false },
      { id: "d", is_active: true, treatment_id: "t1" },
    ],
    variants: [{ id: "v1", is_active: true }, { id: "v2", is_active: false }],
    treatments: [{ id: "t1", is_active: true }],
    mappings: [{ id: "m1", is_active: true }, { id: "m2", is_active: false }],
  });
  assert.deepEqual(s, { familyComponentCount: 1, totalComponentCount: 3, variantCount: 1, treatmentCount: 1, mappingCount: 1 });
});

test("deriveProductionGaps is advisory only - flags empty composition, unmapped variants+treatments, treatments with no variants", () => {
  assert.deepEqual(deriveProductionGaps({}), ["No production composition yet - add family components or garment variants."]);
  assert.deepEqual(
    deriveProductionGaps({ variants: [{ id: "v1" }], treatments: [{ id: "t1" }], mappings: [] }),
    ["Garment variants and treatments exist but no variant is mapped to any treatment yet."],
  );
  assert.deepEqual(
    deriveProductionGaps({ components: [{ id: "c", is_active: true }], treatments: [{ id: "t1" }] }),
    ["Treatments exist but there are no garment variants to allow them on."],
  );
  assert.deepEqual(
    deriveProductionGaps({ components: [{ id: "c", is_active: true }], variants: [{ id: "v1" }], treatments: [{ id: "t1" }], mappings: [{ garment_variant_id: "v1", treatment_id: "t1", is_active: true }] }),
    [],
  );
});

test("buildAllowedCombinationMatrix is a read-only view keyed by active mapping pairs", () => {
  const m = buildAllowedCombinationMatrix({
    variants: [{ id: "v1", name: "220 Black" }, { id: "v2", name: "220 White", is_active: false }],
    treatments: [{ id: "t1", name: "White SFR" }, { id: "t2", name: "Orange SFR" }],
    mappings: [{ garment_variant_id: "v1", treatment_id: "t1", is_active: true }, { garment_variant_id: "v1", treatment_id: "t2", is_active: false }],
  });
  assert.equal(m.length, 1); // v2 inactive is excluded
  assert.equal(m[0].variant.id, "v1");
  assert.deepEqual(m[0].allowed.map((a) => a.allowed), [true, false]);
});

test("the read-only banner is the exact spec text", () => {
  assert.match(PRODUCTION_READONLY_MESSAGE, /read-only for your current role\. Ask an owner\/admin to make structural production changes\./);
});

test("the pricing-preview boundary text disclaims order/invoice/setup-fee authority", () => {
  assert.match(PRICING_PREVIEW_BOUNDARY, /does not automatically change the customer's order price, order totals, invoices or setup fees/);
});

// ── toStaffMessage RLS translation ───────────────────────────────
const { toStaffMessage } = await import("../src/lib/pgErrorMessages.js");

test("toStaffMessage translates a raw RLS / grant rejection into one clean sentence, and still passes CODE: messages and constraints through", () => {
  assert.equal(
    toStaffMessage('new row violates row-level security policy for table "product_components"'),
    "You don't have permission to make this production change. Ask a workspace owner or admin.",
  );
  assert.equal(
    toStaffMessage("permission denied for table client_product_treatments"),
    "You don't have permission to make this production change. Ask a workspace owner or admin.",
  );
  assert.equal(toStaffMessage("GARMENT_VARIANT_CLONE_IDEMPOTENCY_CONFLICT: idempotency key already used"), "idempotency key already used");
  assert.equal(toStaffMessage("value hits _active_name_uidx somewhere"), "An active garment variant/treatment with this name already exists.");
});

test("the RLS-translation source is documented as a Phase-1G-until stopgap, not a permission change", async () => {
  const src = await readSource(PGERR_PATH);
  assert.match(src, /inventory_can_review_tenant\(\)/);
  assert.match(src, /Phase 1G/);
});

// ── API wrappers ─────────────────────────────────────────────────
test("canReviewTenant probes inventory_can_review_tenant (the exact RLS gate) and coerces to a strict boolean", async () => {
  const api = await readSource(API_PATH);
  assert.match(api, /supabase\.rpc\("inventory_can_review_tenant", \{ p_tenant_id: tenantId \}\)/);
  assert.match(api, /data: data === true/);
  assert.match(api, /never a grant change/i);
});

test("duplicateProductComposition wraps the existing RPC unchanged - no client-side clone of artwork/variants/treatments/status", async () => {
  const api = await readSource(API_PATH);
  assert.match(api, /supabase\.rpc\("duplicate_product_composition", \{\s*\n\s*p_source_client_product_id: sourceClientProductId,\s*\n\s*p_target_client_product_id: targetClientProductId,/);
  assert.match(api, /Never clones artwork \/ variants \/ treatments \/ status/);
});

// ── Production tab wiring ────────────────────────────────────────
test("the workspace gains a Production tab (4-col grid) that receives canConfigure from the inventory_can_review_tenant probe", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /grid-cols-4/);
  assert.match(src, /<TabsTrigger value="production">Production<\/TabsTrigger>/);
  assert.match(src, /canReviewTenant\(\{ tenantId: product\.tenant_id \}\)/);
  assert.match(src, /canConfigure=\{canConfigureProduction\}/);
});

test("Production mounts the existing Phase 2B components against this client_product's id - not a rebuilt editor", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /import ScopedComponentsEditor from "@\/components\/composition\/ScopedComponentsEditor"/);
  assert.match(src, /import GarmentVariantsSection from "@\/components\/composition\/GarmentVariantsSection"/);
  assert.match(src, /import TreatmentsSection from "@\/components\/composition\/TreatmentsSection"/);
  const tab = src.slice(src.indexOf("function ProductionTab"), src.indexOf("function ProductionReadOnlyView"));
  assert.match(tab, /<ScopedComponentsEditor[\s\S]*scope=\{\{ type: "family" \}\}[\s\S]*clientProductId=\{product\.id\}/);
  assert.match(tab, /<GarmentVariantsSection[\s\S]*clientProductId=\{product\.id\}/);
  assert.match(tab, /<TreatmentsSection[\s\S]*clientProductId=\{product\.id\}/);
});

test("family composition query is scoped to the correct client_product_id", async () => {
  const src = await readSource(SECTION_PATH);
  const tab = src.slice(src.indexOf("function ProductionTab"), src.indexOf("function ProductionReadOnlyView"));
  assert.match(tab, /ProductComponent\.filter\(\{ client_product_id: product\.id \}/);
});

test("when canConfigure is false: no editor is mounted, only the banner + a read-only view", async () => {
  const src = await readSource(SECTION_PATH);
  const tab = src.slice(src.indexOf("function ProductionTab"), src.indexOf("function ProductionReadOnlyView"));
  assert.match(tab, /\{!canConfigure \? \([\s\S]*PRODUCTION_READONLY_MESSAGE[\s\S]*<ProductionReadOnlyView/);
  // the editors are only in the canConfigure branch
  const readonlyBranch = tab.slice(tab.indexOf("{!canConfigure ? ("), tab.indexOf(") : ("));
  assert.ok(!readonlyBranch.includes("<ScopedComponentsEditor"));
  assert.ok(!readonlyBranch.includes("<GarmentVariantsSection"));
});

test("the family composition editor keeps its family artwork props; variant/treatment sections are not given family artwork props (Phase 2B gating preserved)", async () => {
  const src = await readSource(SECTION_PATH);
  const tab = src.slice(src.indexOf("function ProductionTab"), src.indexOf("function ProductionReadOnlyView"));
  // family scope: currentArtwork + onArtworkLinked present
  const familyEditor = tab.slice(tab.indexOf("<ScopedComponentsEditor"), tab.indexOf("</Section>", tab.indexOf("<ScopedComponentsEditor")));
  assert.match(familyEditor, /currentArtwork=\{currentArtwork\}/);
  assert.match(familyEditor, /onArtworkLinked=/);
  // GarmentVariantsSection / TreatmentsSection are passed no currentArtwork/onArtworkLinked
  const gv = tab.slice(tab.indexOf("<GarmentVariantsSection"), tab.indexOf("/>", tab.indexOf("<GarmentVariantsSection")));
  assert.ok(!gv.includes("currentArtwork"));
  const tr = tab.slice(tab.indexOf("<TreatmentsSection"), tab.indexOf("/>", tab.indexOf("<TreatmentsSection")));
  assert.ok(!tr.includes("currentArtwork"));
});

test("duplicate composition: source picker is scoped to the SAME client and excludes self; success refetches composition", async () => {
  const src = await readSource(SECTION_PATH);
  const dup = src.slice(src.indexOf("function DuplicateCompositionInline"), src.indexOf("export default ClientProductsSection"));
  assert.match(dup, /ClientProduct\.filter\(\{ client_id: product\.client_id \}/);
  assert.match(dup, /\.filter\(\(c\) => c\.id !== product\.id && c\.client_id === product\.client_id\)/);
  assert.match(dup, /duplicateProductComposition\(\{\s*\n\s*sourceClientProductId: sourceId,\s*\n\s*targetClientProductId: product\.id,/);
  assert.match(dup, /invalidateQueries\(\{ queryKey: \["productComponents", product\.id\] \}\)/);
  assert.match(dup, /toStaffMessage\(error\.message\)/);
  assert.match(dup, /Artwork, .*variants, treatments and .*status are not copied/i);
});

test("pricing preview is reference-only and says so; no order/invoice mutation path", async () => {
  const src = await readSource(SECTION_PATH);
  const tab = src.slice(src.indexOf("function ProductionTab"), src.indexOf("function ProductionReadOnlyView"));
  assert.match(tab, /PRICING_PREVIEW_BOUNDARY/);
  assert.doesNotMatch(tab, /order_total|invoice|setup_fee|computeOrderTotal/i);
});

test("status tab shows artwork readiness beside status and warns when a customer-facing status outpaces artwork readiness - no new lifecycle states", async () => {
  const src = await readSource(SECTION_PATH);
  const statusTab = src.slice(src.indexOf("function StatusTab"), src.indexOf("function PriceField"));
  assert.match(statusTab, /Artwork: <ReadinessBadge state=\{readinessState\}/);
  assert.match(statusTab, /customer-facing status but its artwork is not ready/i);
  assert.doesNotMatch(statusTab, /required_artwork_placements\s*=/); // never reimplements the DB guard
});

test("no RLS/grant broadening, no new production model or table, no XOS/PayFast", async () => {
  const src = await readSource(SECTION_PATH);
  const api = await readSource(API_PATH);
  const lib = await readSource(LIB_PATH);
  for (const s of [src, api, lib]) {
    assert.doesNotMatch(s, /grant\s+(select|insert|update|delete)|create policy|alter table|db push|opps_product_components/i);
    assert.doesNotMatch(s, /payfast|checkout/i);
  }
});
