import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const SECTION_PATH = "src/components/clients/ClientProductsSection.jsx";
const EDITOR_PATH = "src/components/clients/CanonicalProductionEditor.jsx";
const XOS_API_PATH = "src/api/xosClientProduct.js";
const API_PATH = "src/api/clientProducts.js";
const LIB_PATH = "src/lib/clientProductProduction.js";
const PGERR_PATH = "src/lib/pgErrorMessages.js";

// XOS Phase C - OPPS Client Product production configuration is now the
// ONE canonical structured-production surface. The Production tab mounts
// CanonicalProductionEditor against a get_client_product_full() payload
// and saves the whole component list through
// admin_set_client_product_production_components. No scoped-component /
// garment-variant / treatment editor, no duplicate_product_composition
// UI, no OPPS-side derivation of the flat summary / required placements /
// readiness. The old composition/* files are kept in the tree but
// unmounted (0 rows in production).
//
// Write authorization is unchanged: admin_set_client_product_production_
// components fails with XOS_CP_REVIEW_FORBIDDEN when the caller is not an
// inventory reviewer for the client's tenant; the tab also probes
// inventory_can_review_tenant (already granted to `authenticated`) to
// render a proactive read-only view.

// ── Pure helpers (composition/* subsystem, still self-consistent) ──
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
});

test("buildAllowedCombinationMatrix is a read-only view keyed by active mapping pairs", () => {
  const m = buildAllowedCombinationMatrix({
    variants: [{ id: "v1", name: "220 Black" }, { id: "v2", name: "220 White", is_active: false }],
    treatments: [{ id: "t1", name: "White SFR" }, { id: "t2", name: "Orange SFR" }],
    mappings: [{ garment_variant_id: "v1", treatment_id: "t1", is_active: true }, { garment_variant_id: "v1", treatment_id: "t2", is_active: false }],
  });
  assert.equal(m.length, 1);
  assert.equal(m[0].variant.id, "v1");
  assert.deepEqual(m[0].allowed.map((a) => a.allowed), [true, false]);
});

test("the read-only banner strings are still exported (used verbatim by the canonical editor / read-only view)", () => {
  assert.match(PRODUCTION_READONLY_MESSAGE, /read-only for your current role/);
  assert.match(PRICING_PREVIEW_BOUNDARY, /does not automatically change the customer's order price/);
});

// ── toStaffMessage RLS translation (unchanged) ───────────────────
const { toStaffMessage } = await import("../src/lib/pgErrorMessages.js");

test("toStaffMessage translates a raw RLS / grant rejection into one clean sentence, and still passes CODE: messages and constraints through", () => {
  assert.equal(
    toStaffMessage('new row violates row-level security policy for table "product_components"'),
    "You don't have permission to make this production change. Ask a workspace owner or admin.",
  );
  assert.equal(toStaffMessage("GARMENT_VARIANT_CLONE_IDEMPOTENCY_CONFLICT: idempotency key already used"), "idempotency key already used");
});

test("the RLS-translation source is documented as a Phase-1G-until stopgap, not a permission change", async () => {
  const src = await readSource(PGERR_PATH);
  assert.match(src, /inventory_can_review_tenant\(\)/);
});

// ── canReviewTenant probe (unchanged) ────────────────────────────
test("canReviewTenant probes inventory_can_review_tenant (the exact RLS gate) and coerces to a strict boolean", async () => {
  const api = await readSource(API_PATH);
  assert.match(api, /supabase\.rpc\("inventory_can_review_tenant", \{ p_tenant_id: tenantId \}\)/);
  assert.match(api, /data: data === true/);
});

// ── Canonical production writer wrapper (source-text only — the module
//    imports the "@/..." alias, so it cannot be imported in a plain node
//    test; every other OPPS test asserts against source text too) ──────
test("xosClientProduct wraps admin_set_client_product_production_components with the exact param names and no client-side derivation", async () => {
  const api = await readSource(XOS_API_PATH);
  assert.match(api, /"admin_set_client_product_production_components"/);
  assert.match(api, /\{ p_client_product_id: clientProductId, p_components: components \}/);
  // the wrapper never derives the flat summary / required placements / readiness
  assert.doesNotMatch(api, /required_artwork_placements\s*=|_compute_artwork_readiness|deriveReadinessState/);
});

test("mapXosCpError maps the canonical production error codes to customer-safe copy, including the artwork-impact conflict", async () => {
  const api = await readSource(XOS_API_PATH);
  assert.match(api, /XOS_CP_PLACEMENT_NOT_ATOMIC[\s\S]{0,120}one placement/i);
  assert.match(api, /XOS_CP_REVIEW_FORBIDDEN[\s\S]{0,140}production-review access/i);
  assert.match(api, /XOS_CP_PRODUCTION_METHOD_INVALID[\s\S]{0,80}unknown print method/i);
  // the conflict branch parses the JSON detail for removed_placement and
  // titlecases it into the sentence
  assert.match(api, /CLIENT_PRODUCT_ARTWORK_PLACEMENT_CONFLICT/);
  assert.match(api, /detail\?\.removed_placement/);
  assert.match(api, /has linked artwork and can.t be removed from production automatically/);
});

// ── CanonicalProductionEditor ───────────────────────────────────
test("CanonicalProductionEditor edits a flat component list and saves the WHOLE list through onSave - never a raw product_components write", async () => {
  const src = await readSource(EDITOR_PATH);
  assert.doesNotMatch(src, /\.entities\.ProductComponent\.(create|update|delete)\(/);
  assert.doesNotMatch(src, /ScopedComponentsEditor|GarmentVariantsSection|TreatmentsSection/);
  // one save call, passing the built payload array to onSave
  assert.match(src, /await onSave\?\.\(payload\)/);
  // payload element shape: id? + component_type + production_method|null + placement|null + sort_order
  assert.match(src, /component_type: r\.component_type/);
  assert.match(src, /production_method: r\.production_method \? r\.production_method : null/);
  assert.match(src, /placement: \(r\.placement \|\| ""\)\.trim\(\) \|\| null/);
  assert.match(src, /sort_order: ix/);
});

test("CanonicalProductionEditor renders the DERIVED flat summary strictly read-only", async () => {
  const src = await readSource(EDITOR_PATH);
  assert.match(src, /Derived summary \(read-only\)/);
  assert.match(src, /full\?\.production\?\.summary/);
  // no editable input bound to print_method / placement (summary) / print_locations
  assert.doesNotMatch(src, /onChange=\{[^}]*print_method/);
  assert.doesNotMatch(src, /onChange=\{[^}]*print_locations/);
});

test("CanonicalProductionEditor offers the full DB CHECK domains for component_type and production_method", async () => {
  const src = await readSource(EDITOR_PATH);
  assert.match(src, /PRODUCTION_COMPONENT_TYPES/);
  assert.match(src, /PRODUCTION_METHODS/);
  const apiSrc = await readSource(XOS_API_PATH);
  for (const t of ["blank_garment", "print_service", "material", "packaging", "labour", "setup_fee", "other"]) {
    assert.ok(apiSrc.includes(`"${t}"`), `component type ${t}`);
  }
  for (const m of ["dtf", "vinyl", "screen", "embroidery", "sublimation", "custom"]) {
    assert.ok(apiSrc.includes(`"${m}"`), `production method ${m}`);
  }
});

test("CanonicalProductionEditor exposes a read-only mode that mounts no editing affordances", async () => {
  const src = await readSource(EDITOR_PATH);
  assert.match(src, /readOnly \?/);
  // the read-only branch shows the server list, no Add/Save/Remove controls
  const roBranch = src.slice(src.indexOf("readOnly ? ("), src.indexOf(") : ("));
  assert.doesNotMatch(roBranch, /addRow|save\(\)|removeRow/);
});

// ── Production tab wiring in the workspace ───────────────────────
test("the Production tab mounts CanonicalProductionEditor against the get_client_product_full payload and the inventory_can_review_tenant probe", async () => {
  const src = await readSource(SECTION_PATH);
  assert.match(src, /<TabsTrigger value="production">Production<\/TabsTrigger>/);
  assert.match(src, /canReviewTenant\(\{ tenantId: product\.tenant_id \}\)/);
  const tab = src.slice(src.indexOf("function ProductionTab"), src.indexOf("// ─── Artwork tab"));
  assert.match(tab, /<CanonicalProductionEditor/);
  assert.match(tab, /full=\{full\}/);
  assert.match(tab, /readOnly=\{!canConfigure\}/);
  assert.match(tab, /setClientProductProductionComponents\(product\.id, components\)/);
  assert.match(tab, /mapXosCpError\(error\?\.message\)/);
});

test("the Production tab never mounts the retired scoped/variant/treatment editors and never writes product_components directly", async () => {
  const src = await readSource(SECTION_PATH);
  assert.doesNotMatch(src, /ScopedComponentsEditor|GarmentVariantsSection|TreatmentsSection|DuplicateCompositionInline/);
  assert.doesNotMatch(src, /\.entities\.ProductComponent\.(create|update|delete)\(/);
  assert.doesNotMatch(src, /duplicate_product_composition/);
});

test("no RLS/grant broadening, no new production model or table, no XOS/PayFast", async () => {
  const src = await readSource(SECTION_PATH);
  const api = await readSource(XOS_API_PATH);
  const lib = await readSource(LIB_PATH);
  for (const s of [src, api, lib]) {
    assert.doesNotMatch(s, /grant\s+(select|insert|update|delete)|create policy|alter table|db push|opps_product_components/i);
    assert.doesNotMatch(s, /payfast|checkout/i);
  }
});
